package goldfish.engine;

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
import java.io.Writer;
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.channels.Channels;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
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
 * goldfish home directory, one request and one reply per connection. Sessions live until ended.
 */
public final class Server {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final long WAIT_MILLIS = 120_000;

    private final Path home;
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
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
        Forge.start(res.toString(), false);
        MyRandom.setRandom(new SeededRandom());
        Server server = new Server(home);
        Path socket = home.resolve("engine.sock");
        Files.deleteIfExists(socket);
        try (ServerSocketChannel listener = ServerSocketChannel.open(StandardProtocolFamily.UNIX)) {
            listener.bind(UnixDomainSocketAddress.of(socket));
            System.err.println("goldfish engine ready on " + socket);
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
                session.end();
            }
            Map<String, Object> reply = ok();
            reply.put("bye", "shutdown");
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
                Decision pending = session.channel.pending();
                if (pending == null) {
                    return progress(session);
                }
                if (request.has("defer") && request.get("defer").getAsBoolean()) {
                    session.channel.resume(Channel.DEFER);
                    return progress(session);
                }
                List<Integer> answer = new ArrayList<>();
                request.getAsJsonArray("answer").forEach(e -> answer.add(e.getAsInt()));
                String problem = pending.check(answer);
                if (problem != null) {
                    throw new IllegalArgumentException(problem);
                }
                session.channel.resume(answer);
                return progress(session);
            }
            case "state": {
                session.channel.await(WAIT_MILLIS);
                Map<String, Object> reply = progress(session);
                reply.put("state", session.state());
                return reply;
            }
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
                session.end();
                session.channel.await(WAIT_MILLIS);
                sessions.remove(session.id);
                return progress(session);
            }
            default:
                throw new IllegalArgumentException("unknown command " + cmd);
        }
    }

    private Map<String, Object> start(JsonObject request) throws Exception {
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
        int opponents = request.has("opponents") ? request.get("opponents").getAsInt() : 3;
        boolean stopsAll = request.has("stops") && request.get("stops").getAsString().equals("all");
        Session.ManaChoice mana = Session.ManaChoice.valueOf(
                (request.has("mana") ? request.get("mana").getAsString() : "creatures").toUpperCase(java.util.Locale.ROOT));
        String deckName = request.has("deck") ? request.get("deck").getAsString() : null;
        String deckHash = request.has("hash") ? request.get("hash").getAsString() : null;
        String id;
        synchronized (this) {
            id = "g" + (++lastId);
        }
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
            default -> throw new IllegalArgumentException("ai is default, hybrid or sim");
        };
        Session session = new Session(id, seed, turns, stopsAll, mana, asks, aiMode, home.resolve("runs"));
        sessions.put(id, session);
        session.start(deck, opponents, String.join(" + ", commanders), deckName, deckHash);
        Map<String, Object> reply = progress(session);
        reply.put("seed", seed);
        reply.put("ai_avoids", Session.aiAvoids(deck));
        return reply;
    }

    private static Map<String, Object> ok() {
        Map<String, Object> reply = new LinkedHashMap<>();
        reply.put("ok", true);
        return reply;
    }

    /** Wait for the game to park on a decision or finish, then describe where it stands. */
    private static Map<String, Object> progress(Session session) throws InterruptedException {
        Decision decision = session.channel.await(WAIT_MILLIS);
        Map<String, Object> reply = ok();
        reply.put("session", session.id);
        reply.put("records", session.recordFile.toString());
        if (decision != null) {
            reply.put("decision", decision);
        } else if (session.channel.isFinished()) {
            reply.put("over", session.over);
        } else {
            reply.put("running", true);
        }
        return reply;
    }
}
