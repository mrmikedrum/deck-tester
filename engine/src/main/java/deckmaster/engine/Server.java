package deckmaster.engine;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.deck.Deck;
import forge.util.MyRandom;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.channels.Channels;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.Stream;

/**
 * The engine process: loads Forge once, then serves JSON-line requests on a Unix socket under the
 * deckmaster home directory, one request and one reply per connection. Sessions live until ended.
 */
public final class Server {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final long WAIT_MILLIS = 120_000;
    /** How long a fork may play on without asking or ending: lines take a second or two, and one that hangs in
     * Forge would otherwise hold up its seat's decision (and a table) for the full wait. */
    private static final long FORK_WAIT_MILLIS = 15_000;

    private final Path home;
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    /** Whether this engine hosts tables: started with Forge's full model and a headless GUI (see main). */
    private static boolean tableMode;
    private volatile Table table;
    /** The open table's agent seats, released with it. */
    private List<Session> tableSeats = List.of();
    private int lastId;

    private Server(Path home) throws IOException {
        this.home = home;
        Files.createDirectories(home.resolve("runs"));
        try (Stream<Path> runs = Files.list(home.resolve("runs"))) {
            lastId = runs.map(p -> p.getFileName().toString())
                    .filter(n -> n.matches("g\\d+\\.jsonl"))
                    .mapToInt(n -> Integer.parseInt(n.substring(1, n.length() - 6)))
                    .max().orElse(0);
        }
    }

    public static void main(String[] args) throws Exception {
        Path res = Path.of(args[0]);
        Path home = Path.of(args[1]);
        tableMode = args.length > 2 && args[2].equals("table");
        if (tableMode) {
            Forge.startForTables(res, home.resolve("table"));
        } else {
            Forge.start(res.toString(), false);
        }
        MyRandom.setRandom(new SeededRandom());
        Server server = new Server(home);
        Path socket = home.resolve(tableMode ? "table.sock" : "engine.sock");
        if (Files.exists(socket)) {
            try (SocketChannel running = SocketChannel.open(UnixDomainSocketAddress.of(socket))) {
                System.err.println("another deckmaster engine is already listening on " + socket);
                System.exit(0);
            } catch (IOException stale) {
                Files.delete(socket); // left by an engine that has gone
            }
        }
        try (ServerSocketChannel listener = ServerSocketChannel.open(StandardProtocolFamily.UNIX)) {
            listener.bind(UnixDomainSocketAddress.of(socket));
            System.err.println("deckmaster engine ready on " + socket);
            while (true) {
                SocketChannel client = listener.accept();
                Thread handler = new Thread(() -> server.serve(client), "request");
                handler.setDaemon(true);
                handler.start();
            }
        }
    }

    private void serve(SocketChannel client) {
        try (client;
             BufferedReader in = new BufferedReader(Channels.newReader(client, StandardCharsets.UTF_8));
             Writer out = Channels.newWriter(client, StandardCharsets.UTF_8)) {
            String line = in.readLine();
            if (line == null) {
                return; // a liveness probe: connected and closed
            }
            Map<String, Object> reply;
            try {
                reply = handle(JsonParser.parseString(line).getAsJsonObject());
            } catch (Exception e) {
                reply = new LinkedHashMap<>();
                reply.put("ok", false);
                reply.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
            }
            out.write(GSON.toJson(reply));
            out.write('\n');
            out.flush();
            if ("shutdown".equals(reply.get("bye"))) {
                System.exit(0);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private Map<String, Object> handle(JsonObject request) throws Exception {
        String cmd = request.get("cmd").getAsString();
        if (cmd.equals("start")) {
            return start(request);
        }
        if (cmd.equals("sessions")) {
            Map<String, Object> reply = ok();
            List<String> live = new ArrayList<>();
            sessions.forEach((id, session) -> {
                if (!session.channel.isFinished()) {
                    live.add(id);
                }
            });
            live.sort(null);
            reply.put("sessions", live);
            return reply;
        }
        if (cmd.equals("shutdown")) {
            for (Session session : sessions.values()) {
                session.end("shutdown");
            }
            Map<String, Object> reply = ok();
            reply.put("bye", "shutdown");
            return reply;
        }
        if (cmd.equals("table")) {
            Map<String, Object> reply = ok();
            reply.putAll(openTable(request));
            return reply;
        }
        if (cmd.equals("table_end")) {
            endTable();
            return ok();
        }
        if (cmd.equals("table_state")) {
            Map<String, Object> reply = ok();
            reply.put("state", table == null ? "no table" : table.state());
            reply.put("slots", table == null ? List.of() : table.slots());
            return reply;
        }
        Session session = sessions.get(request.get("session").getAsString());
        if (session == null) {
            throw new IllegalArgumentException("no session " + request.get("session").getAsString());
        }
        switch (cmd) {
            case "decision":
                return progress(session);
            case "answer": {
                String by = request.has("by") ? request.get("by").getAsString() : "agent";
                Double confidence = request.has("p") ? request.get("p").getAsDouble() : null;
                boolean defer = request.has("defer") && request.get("defer").getAsBoolean();
                if (request.has("id")) {
                    // a client that shows the game names the decision it answers: refused unless it is still parked
                    List<Integer> picks = new ArrayList<>();
                    if (!defer) {
                        request.getAsJsonArray("answer").forEach(e -> picks.add(e.getAsInt()));
                    }
                    session.channel.answerIf(request.get("id").getAsLong(), defer ? Channel.DEFER : picks, by, confidence);
                    return progress(session);
                }
                Decision pending = session.channel.pending();
                if (pending == null) {
                    return progress(session);
                }
                if (defer) {
                    session.channel.defer(by, confidence);
                    return progress(session);
                }
                List<Integer> answer = new ArrayList<>();
                request.getAsJsonArray("answer").forEach(e -> answer.add(e.getAsInt()));
                String problem = pending.check(answer);
                if (problem != null) {
                    throw new IllegalArgumentException(problem);
                }
                session.channel.answer(answer, by, confidence);
                return progress(session);
            }
            case "state": {
                session.channel.await(WAIT_MILLIS);
                Map<String, Object> reply = progress(session);
                reply.put("state", session.state(request.has("text") && request.get("text").getAsBoolean()));
                return reply;
            }
            case "view": {
                // no waiting: a client shows the game while Forge plays it
                Map<String, Object> reply = ok();
                Channel.Parked parked = session.channel.parked();
                if (parked != null) {
                    reply.put("decision", numbered(parked));
                } else if (session.channel.isFinished()) {
                    reply.put("over", session.over);
                    if (session.startFailure != null) {
                        reply.put("startFailure", session.startFailure);
                    }
                }
                reply.put("view", session.view());
                return reply;
            }
            case "fork":
                return fork(session, request.has("via") ? request.get("via").getAsString() : null,
                        request.has("horizon") ? request.get("horizon").getAsInt() : 0);
            case "snapshot": {
                session.channel.await(WAIT_MILLIS);
                String name = request.has("name") ? request.get("name").getAsString() : null;
                Map<String, Object> reply = progress(session);
                reply.put("result", session.snapshot(name == null ? "s" + System.currentTimeMillis() % 100000 : name));
                return reply;
            }
            case "restore":
                session.channel.await(WAIT_MILLIS);
                session.restore(request.get("name").getAsString());
                return progress(session);
            case "override": {
                session.channel.await(WAIT_MILLIS);
                List<String> args = new ArrayList<>();
                request.getAsJsonArray("args").forEach(e -> args.add(e.getAsString()));
                String result = session.override(args);
                Map<String, Object> reply = progress(session);
                reply.put("result", result);
                return reply;
            }
            case "end": {
                session.end(request.has("over") ? request.get("over").getAsString() : "ended");
                session.channel.await(session.parent == null ? WAIT_MILLIS : FORK_WAIT_MILLIS);
                sessions.remove(session.id);
                Map<String, Object> reply = ok();
                reply.put("session", session.id);
                reply.put("records", session.recordFile.toString());
                reply.put("over", session.over);
                return reply;
            }
            default:
                throw new IllegalArgumentException("unknown command " + cmd);
        }
    }

    private Map<String, Object> start(JsonObject request) throws Exception {
        Session.Setup setup = setup(request, request.has("opponents") ? request.get("opponents").getAsInt() : 3, false);
        Session session = new Session(nextId(), setup, home.resolve("runs"), null, null);
        sessions.put(session.id, session);
        session.start();
        Map<String, Object> reply = progress(session);
        reply.put("seed", setup.seed());
        reply.put("ai_avoids", Session.aiAvoids(setup.deck()));
        return reply;
    }

    /** A game's setup from a start request (or a seat of a table request); forks are copies unless asked to replay. */
    private static Session.Setup setup(JsonObject request, int opponents, boolean table) {
        List<String> commanders = new ArrayList<>();
        request.getAsJsonArray("commanders").forEach(e -> commanders.add(e.getAsString()));
        List<Map.Entry<Integer, String>> main = new ArrayList<>();
        for (JsonElement entry : request.getAsJsonArray("main")) {
            JsonArray pair = entry.getAsJsonArray();
            main.add(new AbstractMap.SimpleEntry<>(pair.get(0).getAsInt(), pair.get(1).getAsString()));
        }
        List<String> unknown = new ArrayList<>();
        Deck deck = Session.deck(commanders, main, unknown);
        if (!unknown.isEmpty()) {
            throw new IllegalArgumentException("Forge doesn't know: " + String.join(", ", unknown));
        }
        long seed = request.has("seed") ? request.get("seed").getAsLong() : ThreadLocalRandom.current().nextLong(1, 1_000_000);
        int turns = request.has("turns") ? request.get("turns").getAsInt() : 0;
        boolean stopsAll = request.has("stops") && request.get("stops").getAsString().equals("all");
        Session.ManaChoice mana = Session.ManaChoice.valueOf(
                (request.has("mana") ? request.get("mana").getAsString() : "creatures").toUpperCase(java.util.Locale.ROOT));
        String deckName = request.has("deck") ? request.get("deck").getAsString() : null;
        String deckHash = request.has("hash") ? request.get("hash").getAsString() : null;
        Set<String> asks = null;
        if (request.has("ask")) {
            asks = new HashSet<>();
            for (JsonElement kind : request.getAsJsonArray("ask")) {
                asks.add(kind.getAsString());
            }
        }
        String ai = request.has("ai") ? request.get("ai").getAsString() : "default";
        forge.ai.AIOption aiMode = switch (ai) {
            case "default" -> null;
            case "hybrid" -> forge.ai.AIOption.USE_HYBRID_SIMULATION;
            case "sim" -> forge.ai.AIOption.USE_FULL_SIMULATION;
            case "flatmc" -> null;
            default -> throw new IllegalArgumentException("ai is default, hybrid, sim or flatmc");
        };
        return new Session.Setup(deck, opponents, seed, turns, stopsAll, mana, asks, aiMode,
                String.join(" + ", commanders), deckName, deckHash, ai.equals("flatmc"),
                table || !(request.has("forks") && request.get("forks").getAsString().equals("replay")));
    }

    /**
     * Opens a Commander table on a port: one seat per entry of "seats" (each like a start request, with a "name"),
     * driven through its own session, and "people" open slots for people joining from their own Forge.
     */
    /** Stops the open table and lets go of its seats, whose games and copies would otherwise stay in memory. */
    private synchronized void endTable() throws InterruptedException {
        if (table != null) {
            table.stop();
            table = null;
        }
        for (Session seat : tableSeats) {
            seat.end("table ended");
            sessions.remove(seat.id);
        }
        tableSeats = List.of();
    }

    private Map<String, Object> openTable(JsonObject request) throws Exception {
        if (!tableMode) {
            throw new IllegalStateException("tables are hosted by the table engine (deckmaster table)");
        }
        if (table != null) {
            throw new IllegalStateException("a table is already open on port " + table.port);
        }
        int people = request.has("people") ? request.get("people").getAsInt() : 1;
        int port = request.has("port") ? request.get("port").getAsInt() : 36743;
        JsonArray seatRequests = request.getAsJsonArray("seats");
        int players = seatRequests.size() + people;
        List<Session> agents = new ArrayList<>();
        List<Deck> decks = new ArrayList<>();
        Map<String, Object> ids = new LinkedHashMap<>();
        for (JsonElement entry : seatRequests) {
            JsonObject seatRequest = entry.getAsJsonObject();
            Session.Setup setup = setup(seatRequest, players - 1, true);
            String name = seatRequest.get("name").getAsString();
            Session seat = Session.atTable(nextId(), setup, home.resolve("runs"), name);
            seat.watching = seatRequest.has("watch") && seatRequest.get("watch").getAsBoolean();
            sessions.put(seat.id, seat);
            agents.add(seat);
            decks.add(setup.deck());
            ids.put(name, seat.id);
        }
        table = new Table(port, agents, decks, people);
        tableSeats = agents;
        Map<String, Object> reply = new LinkedHashMap<>();
        reply.put("port", port);
        reply.put("seats", ids);
        reply.put("slots", table.slots());
        return reply;
    }

    /**
     * A new session that replays this parked one's decisions from the same seed, checks it arrived at the same
     * decision in the same state, and waits there. The parent stays parked; the fork is a game of its own. With a
     * horizon, the fork ends at the first main phase of that turn of its player's (see Session.atHorizon).
     */
    private Map<String, Object> fork(Session parent, String via, int horizon) throws Exception {
        Decision parked = parent.channel.await(WAIT_MILLIS);
        if (parked == null) {
            throw new IllegalStateException("fork while the game waits for a decision");
        }
        long began = System.nanoTime();
        Session fork;
        try {
            fork = via == null ? parent.fork(nextId(), home.resolve("runs"))
                    : parent.fork(nextId(), home.resolve("runs"), via.equals("copy"));
        } catch (IllegalStateException refused) {
            parent.recorder.write("fork", "refused", refused.getMessage());
            throw refused;
        }
        sessions.put(fork.id, fork);
        fork.horizon = horizon;
        fork.start();
        Decision reached = fork.channel.await(WAIT_MILLIS);
        String problem = null;
        if (reached == null) {
            problem = fork.channel.isFinished() ? fork.over : "still replaying after " + WAIT_MILLIS / 1000 + "s";
        } else if (!parked.same(reached)) {
            problem = "replay reached " + reached.kind() + " " + reached.options() + " at " + reached.turn()
                    + " instead of " + parked.kind() + " " + parked.options() + " at " + parked.turn()
                    + " (state: " + Session.firstDifference(parent.fingerprint(), fork.fingerprint()) + ")";
        } else {
            String difference = Session.firstDifference(parent.fingerprint(), fork.fingerprint());
            if (!difference.isEmpty()) {
                problem = "state differs: " + difference;
            }
        }
        if (problem != null) {
            parent.recorder.write("fork", "session", fork.id, "failed", problem);
            fork.end("drift");
            fork.channel.await(WAIT_MILLIS);
            sessions.remove(fork.id);
            throw new IllegalStateException("fork drifted: " + problem);
        }
        String ids = Session.firstDifference(parent.fingerprint(true), fork.fingerprint(true));
        parent.recorder.write("fork", "session", fork.id, "ids", ids.isEmpty() ? null : ids);
        Map<String, Object> reply = progress(fork);
        reply.put("parent", parent.id);
        if (!ids.isEmpty()) {
            reply.put("ids", ids);
        }
        reply.put("replayed", fork.replayed());
        reply.put("ms", (System.nanoTime() - began) / 1_000_000);
        reply.put("setup_ms", fork.setupMillis);
        return reply;
    }

    /** The next free session id. Its record file is claimed here, so the table engine and the goldfish engine,
     * running at once over the same runs folder, never share one. */
    private synchronized String nextId() {
        while (true) {
            String id = "g" + (++lastId);
            try {
                Files.createFile(home.resolve("runs").resolve(id + ".jsonl"));
                return id;
            } catch (FileAlreadyExistsException taken) {
                // the other engine took it
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
    }

    private static Map<String, Object> ok() {
        Map<String, Object> reply = new LinkedHashMap<>();
        reply.put("ok", true);
        return reply;
    }

    /** Wait for the game to park on a decision or finish, then describe where it stands. A fork that does neither
     * in time has stalled: that is recorded on its parent with where Forge was, and the request fails. */
    private Map<String, Object> progress(Session session) throws InterruptedException {
        Channel.Parked parked = session.channel.awaitParked(session.parent == null ? WAIT_MILLIS : FORK_WAIT_MILLIS);
        Decision decision = parked == null ? null : parked.decision();
        if (decision == null && !session.channel.isFinished() && session.parent != null) {
            String where = session.where();
            Session parent = sessions.get(session.parent);
            if (parent != null) {
                parent.recorder.write("fork", "session", session.id, "failed", "stalled: " + where);
            }
            System.err.println("fork " + session.id + " stalled: " + where);
            throw new IllegalStateException("fork stalled: " + where);
        }
        Map<String, Object> reply = ok();
        reply.put("session", session.id);
        reply.put("records", session.recordFile.toString());
        if (decision != null) {
            reply.put("decision", numbered(parked));
        } else if (session.channel.isFinished()) {
            reply.put("over", session.over);
        } else {
            reply.put("running", true);
        }
        return reply;
    }

    /** A parked decision as clients read it: its fields and its number, `id`, which an answer may name. */
    private static JsonObject numbered(Channel.Parked parked) {
        JsonObject json = GSON.toJsonTree(parked.decision()).getAsJsonObject();
        json.addProperty("id", parked.id());
        return json;
    }
}
