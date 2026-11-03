package goldfish.engine;

import forge.StaticData;
import forge.ai.AIOption;
import forge.ai.LobbyPlayerAi;
import forge.ai.PlayerControllerAi;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.GameOutcome;
import forge.game.GameRules;
import forge.game.GameSnapshot;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.card.CounterEnumType;
import forge.game.card.CounterType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.TreeMap;

/**
 * One goldfish game: the agent's deck against passive opponents, run on its own thread.
 *
 * Every decision at the agent's seat is logged with its answer, whoever gave it. A fork is a new session
 * from the same setup that answers from its parent's log (the script) instead of asking, and so replays
 * the same game without Forge's AI weighing anything; it then checks that it reached the same decision in
 * the same state, and from there it is a game of its own.
 */
final class Session {
    static final String PILOT = "You";

    /** When the agent picks which sources pay mana: never, when a creature could pay, or always. */
    enum ManaChoice { AUTO, CREATURES, ALWAYS }

    /** Everything a game starts from; a fork starts from its parent's. */
    record Setup(Deck deck, int opponents, long seed, int turnLimit, boolean stopsAll, ManaChoice manaChoice,
                 Set<String> asks, AIOption aiMode, String commanders, String deckName, String deckHash) { }

    /** One answered decision, however it was answered: what a fork replays. */
    static final class Entry {
        final Decision decision;
        List<Integer> answer;
        String by;
        Double p;

        Entry(Decision decision, List<Integer> answer, String by, Double p) {
            this.decision = decision;
            this.answer = answer;
            this.by = by;
            this.p = p;
        }
    }

    interface ControllerFactory {
        PlayerControllerAi create(Game game, Player player, LobbyPlayerAi lobby);
    }

    /** A lobby seat that creates the controller we choose instead of Forge's AI. */
    static final class Seat extends LobbyPlayerAi {
        private final ControllerFactory factory;

        Seat(String name, ControllerFactory factory) {
            super(name, null);
            this.factory = factory;
        }

        @Override
        public Player createIngamePlayer(Game game, int id) {
            Player player = new Player(getName(), game, id);
            player.setFirstController(factory.create(game, player, this));
            return player;
        }
    }

    private record Snapshot(GameSnapshot copy, int pilotTurn, Random random) { }

    final String id;
    final Setup setup;
    /** The session this one was forked from, if any. */
    final String parent;
    final Path recordFile;
    final Channel channel = new Channel();
    final Recorder recorder;
    /** Every decision answered so far, in order. The game thread appends; others read it only while the game is parked. */
    final List<Entry> log = new ArrayList<>();
    private final List<Entry> script;
    private int cursor;
    volatile int pilotTurn;
    volatile Game game;
    volatile Player pilot;
    volatile String over;
    /** Milliseconds building the game (decks, cards) before the first action, for measuring forks. */
    volatile long setupMillis;
    private volatile SeededRandom.Source random;
    private final Map<String, Snapshot> snapshots = new LinkedHashMap<>();

    Session(String id, Setup setup, Path runsDir, List<Entry> script, String parent) throws IOException {
        this.id = id;
        this.setup = setup;
        this.script = script;
        this.parent = parent;
        this.recordFile = runsDir.resolve(id + ".jsonl");
        this.recorder = new Recorder(this, recordFile);
    }

    /** A fork: the same setup, answering from this session's log so far. Call while this game is parked. */
    Session fork(String id, Path runsDir) throws IOException {
        return new Session(id, setup, runsDir, new ArrayList<>(log), this.id);
    }

    /** Cards whose Forge scripts say its AI can't play them well (AI:RemoveDeck:All). */
    static List<String> aiAvoids(Deck deck) {
        List<String> names = new ArrayList<>();
        for (DeckSection section : List.of(DeckSection.Commander, DeckSection.Main)) {
            if (deck.has(section)) {
                deck.get(section).forEach(entry -> {
                    if (entry.getKey().getRules().getAiHints().getRemAIDecks() && !names.contains(entry.getKey().getName())) {
                        names.add(entry.getKey().getName());
                    }
                });
            }
        }
        return names;
    }

    /** A card by name; a double-faced card listed as "Front // Back" is found by its front face, as Forge names it. */
    static PaperCard card(String name) {
        PaperCard card = StaticData.instance().getCommonCards().getCard(name);
        if (card == null && name.contains(" // ")) {
            card = StaticData.instance().getCommonCards().getCard(name.substring(0, name.indexOf(" // ")));
        }
        return card;
    }

    static Deck deck(List<String> commanders, List<Map.Entry<Integer, String>> main, List<String> unknown) {
        Deck deck = new Deck("goldfish");
        for (String name : commanders) {
            PaperCard card = card(name);
            if (card == null) {
                unknown.add(name);
            } else {
                deck.getOrCreate(DeckSection.Commander).add(card, 1);
            }
        }
        for (Map.Entry<Integer, String> entry : main) {
            PaperCard card = card(entry.getValue());
            if (card == null) {
                unknown.add(entry.getValue());
            } else {
                deck.getMain().add(card, entry.getKey());
            }
        }
        return deck;
    }

    private static Deck passiveDeck() {
        Deck deck = new Deck("passive");
        deck.getOrCreate(DeckSection.Commander).add(StaticData.instance().getCommonCards().getCard("Kozilek, Butcher of Truth"), 1);
        deck.getMain().add(StaticData.instance().getCommonCards().getCard("Wastes"), 99);
        return deck;
    }

    /** Builds and plays the game on its own thread, so every shuffle draws from this session's seed. */
    void start() {
        Thread thread = new Thread(() -> {
            random = SeededRandom.seed(setup.seed());
            long began = System.nanoTime();
            try {
                // Forks share their parent's setup and start several at once; Forge's Deck loads sections lazily
                // and isn't safe to build games from on several threads, so each game gets its own copy.
                Deck deck;
                synchronized (setup.deck()) {
                    deck = new Deck(setup.deck());
                }
                List<RegisteredPlayer> players = new ArrayList<>();
                players.add(RegisteredPlayer.forCommander(deck)
                        .setPlayer(new Seat(PILOT, (g, p, l) -> new ManualController(g, p, l, this))));
                for (int i = 1; i <= setup.opponents(); i++) {
                    players.add(RegisteredPlayer.forCommander(passiveDeck())
                            .setPlayer(new Seat("Opp " + i, PassiveController::new)));
                }
                Match match = new Match(new GameRules(GameType.Commander), players, "goldfish");
                game = match.createGame();
                game.setNoGUIUser();
                pilot = game.getPlayers().stream().filter(p -> p.getName().equals(PILOT)).findFirst().orElseThrow();
                game.subscribeToEvents(recorder);
                setupMillis = (System.nanoTime() - began) / 1_000_000;
                recorder.write("start", "local_cards", System.getProperty("goldfish.localCards"),
                        "local_cards_hash", System.getProperty("goldfish.localCardsHash"), "seed", setup.seed(), "deck", setup.deckName(), "hash", setup.deckHash(),
                        "commander", setup.commanders(), "turns", setup.turnLimit() > 0 ? setup.turnLimit() : null,
                        "opponents", setup.opponents(), "ai", setup.aiMode() == null ? null : setup.aiMode().name().toLowerCase(Locale.ROOT),
                        "fork", parent, "replays", script == null ? null : script.size());
                match.startGame(game);
                if (over == null) {
                    over = outcome();
                }
            } catch (Channel.Drift drift) {
                over = "drift: " + drift.getMessage();
            } catch (Channel.Interrupt interrupt) {
                if (over == null) {
                    over = "ended";
                }
            } catch (Throwable error) {
                over = "error: " + error;
                error.printStackTrace();
            } finally {
                recorder.write("end", "reason", over);
                recorder.close();
                channel.finish();
            }
        }, "game-" + id);
        thread.setDaemon(true);
        thread.start();
    }

    private String outcome() {
        GameOutcome outcome = game.getOutcome();
        if (outcome == null || outcome.isDraw()) {
            return "draw";
        }
        return outcome.isWinner(pilot.getLobbyPlayer()) ? "won" : "lost";
    }

    boolean asks(String kind) {
        return setup.asks() == null || setup.asks().contains(kind);
    }

    // ---- the decision log and a fork's script ----

    void log(Entry entry) {
        log.add(entry);
    }

    /**
     * The next scripted answer, when this is a fork still replaying; it must be an answer to this decision.
     * Overrides the parent made while this decision waited are applied first; a play decision is then asked
     * again, as it was in the parent, since its options changed.
     */
    Entry scripted(Decision decision) {
        if (script == null || cursor >= script.size()) {
            return null;
        }
        boolean overridden = false;
        while (cursor < script.size() && script.get(cursor).decision.kind().equals("override")) {
            applyOverride(script.get(cursor++).decision.options());
            overridden = true;
        }
        if (overridden && decision.kind().equals("play")) {
            throw new Channel.Interrupt(true);
        }
        if (cursor >= script.size()) {
            return null;
        }
        Entry next = script.get(cursor);
        if (!next.decision.same(decision)) {
            throw new Channel.Drift("replay step " + (cursor + 1) + " of " + script.size() + ": recorded "
                    + describe(next.decision) + ", reached " + describe(decision));
        }
        cursor++;
        return next;
    }

    int replayed() {
        return cursor;
    }

    private static String describe(Decision decision) {
        String options = String.valueOf(decision.options());
        if (options.length() > 400) {
            options = options.substring(0, 399) + "…";
        }
        return decision.kind() + (decision.prompt().isEmpty() ? "" : " (" + decision.prompt() + ")") + " " + options + " at " + decision.turn();
    }

    /**
     * The game as text, for checking that a fork replayed into the same game as its parent. Card ids are left
     * out: Forge's AI makes scratch cards while weighing plays, so a fork, where it never weighs, numbers its
     * later cards differently.
     */
    String fingerprint() {
        return fingerprint(false);
    }

    /** With ids, card ids are included: they are expected to differ, but when nothing else does they can explain a later drift. */
    String fingerprint(boolean ids) {
        StringBuilder text = new StringBuilder(turnLabel()).append('\n');
        for (Player player : game.getPlayers()) {
            text.append(player.getName()).append(": life ").append(player.getLife()).append(", poison ").append(player.getPoisonCounters())
                    .append(", pool ").append(player.getManaPool().totalMana()).append(", lands ").append(player.getLandsInPlay().size())
                    .append(", hand ").append(player.getCardsIn(ZoneType.Hand).size()).append('\n');
        }
        for (ZoneType zone : List.of(ZoneType.Library, ZoneType.Hand, ZoneType.Battlefield, ZoneType.Graveyard, ZoneType.Exile, ZoneType.Command)) {
            text.append(zone.name().toLowerCase(Locale.ROOT)).append(':');
            for (Card card : pilot.getCardsIn(zone)) {
                if (card.isImmutable()) {
                    continue; // Forge's own effect cards, named with their id ("Commander Effect Static Effect #1117")
                }
                text.append(' ').append(card.getName());
                if (ids) {
                    text.append('#').append(card.getId());
                }
                if (zone == ZoneType.Battlefield) {
                    if (card.isTapped()) {
                        text.append("/tapped");
                    }
                    if (card.isSick()) {
                        text.append("/sick");
                    }
                    if (card.getDamage() > 0) {
                        text.append("/damage").append(card.getDamage());
                    }
                    Map<String, Integer> counters = new TreeMap<>();
                    card.getCounters().entrySet().forEach(e -> counters.put(e.getElement().getName(), e.getCount()));
                    counters.forEach((name, count) -> text.append('/').append(name).append(count));
                    if (card.isCreature()) {
                        text.append('/').append(card.getNetPower()).append('.').append(card.getNetToughness());
                    }
                }
            }
            text.append('\n');
        }
        // Stack descriptions carry card ids; triggers of the same kind may also be ordered by id, so sort them.
        List<String> stack = new ArrayList<>();
        game.getStack().forEach(item -> stack.add(item.getStackDescription().replaceAll(" \\(\\d+\\)", "")));
        stack.sort(null);
        text.append("stack: ").append(String.join(" | ", stack));
        return text.append('\n').toString();
    }

    /** The first line on which two fingerprints differ, or an empty string when they don't. */
    static String firstDifference(String parent, String fork) {
        String[] a = parent.split("\n");
        String[] b = fork.split("\n");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            String p = i < a.length ? a[i] : "";
            String q = i < b.length ? b[i] : "";
            if (!p.equals(q)) {
                return "parent " + cut(p) + " | fork " + cut(q);
            }
        }
        return "";
    }

    private static String cut(String text) {
        return text.length() <= 300 ? text : text.substring(0, 299) + "…";
    }

    /** Called by the recorder when the agent's turn begins; false once past the turn limit, which ends the game. */
    boolean beginPilotTurn() {
        pilotTurn++;
        if (setup.turnLimit() > 0 && pilotTurn > setup.turnLimit()) {
            over = "turn limit";
            game.setGameOver(GameEndReason.Draw);
            return false;
        }
        return true;
    }

    String turnLabel() {
        if (game == null) {
            return "T0";
        }
        Player active = game.getPhaseHandler().getPlayerTurn();
        String phase = game.getPhaseHandler().getPhase() == null ? "setup" : switch (game.getPhaseHandler().getPhase()) {
            case COMBAT_BEGIN -> "combat";
            case COMBAT_DECLARE_ATTACKERS -> "attackers";
            case COMBAT_DECLARE_BLOCKERS -> "blockers";
            case COMBAT_FIRST_STRIKE_DAMAGE -> "first-strike";
            case COMBAT_DAMAGE -> "damage";
            case COMBAT_END -> "end-combat";
            case END_OF_TURN -> "end";
            default -> game.getPhaseHandler().getPhase().name().toLowerCase(Locale.ROOT);
        };
        String who = active == null || active.equals(pilot) ? "" : active.getName() + " ";
        return "T" + pilotTurn + " " + who + phase;
    }

    // ---- agent actions while the game is parked ----

    private void requirePlayDecision() {
        Decision pending = channel.pending();
        if (pending == null || !pending.kind().equals("play")) {
            throw new IllegalStateException("snapshots and restores happen at a play decision");
        }
    }

    String snapshot(String name) {
        requirePlayDecision();
        GameSnapshot copy = new GameSnapshot(game);
        copy.makeCopy();
        snapshots.put(name, new Snapshot(copy, pilotTurn, random.copy()));
        recorder.write("snapshot", "name", name);
        return "snapshot " + name + " at " + turnLabel();
    }

    /** Restores in place, then sends the parked game thread back to ask again from the restored state. */
    void restore(String name) throws InterruptedException {
        requirePlayDecision();
        Snapshot snapshot = snapshots.get(name);
        if (snapshot == null) {
            throw new IllegalArgumentException("no snapshot " + name + "; have " + snapshots.keySet());
        }
        snapshot.copy().restoreGameState(game);
        // Restoring moves cards back without recomputing static abilities, so a commander cast in the abandoned
        // line isn't castable from the command zone again until something else triggers that.
        game.getAction().checkStaticAbilities();
        pilotTurn = snapshot.pilotTurn();
        random.rewind(snapshot.random()); // the same shuffles and draws as when the snapshot was taken
        // Forge's AI remembers cards between decisions (mana sources it holds for its next spell, and so on),
        // outside the game state; memories of the abandoned line would make the restored one play differently.
        for (Player player : game.getPlayers()) {
            if (player.getController() instanceof PlayerControllerAi ai) {
                ai.getAi().getCardMemory().clearAllRemembered();
            }
        }
        // A restored copy may share objects with the game now, so keep a fresh copy for the next restore.
        GameSnapshot fresh = new GameSnapshot(game);
        fresh.makeCopy();
        snapshots.put(name, new Snapshot(fresh, pilotTurn, snapshot.random()));
        recorder.write("restore", "name", name);
        channel.resume(new Channel.Interrupt(true));
    }

    /** Ends the game; the reason is the client's, such as a turn limit it keeps itself. */
    void end(String reason) throws InterruptedException {
        if (over == null) {
            over = reason;
        }
        if (game != null) {
            game.setGameOver(GameEndReason.Draw);
        }
        if (channel.pending() != null) {
            channel.resume(new Channel.Interrupt(false));
        }
    }

    /**
     * A manual correction to the game state, recorded as such and logged so a fork makes it too. Cards are
     * referred to by name, "Name#2" for the second.
     */
    String override(List<String> args) throws InterruptedException {
        if (channel.pending() == null) {
            throw new IllegalStateException("overrides happen while the game waits for a decision");
        }
        if (args.isEmpty()) {
            throw new IllegalArgumentException("override what?");
        }
        String result = applyOverride(args);
        log.add(new Entry(new Decision("override", turnLabel(), "", List.copyOf(args), null, 0, 0, false), List.of(), "agent", null));
        Decision pending = channel.pending();
        if (pending != null && pending.kind().equals("play")) {
            channel.resume(new Channel.Interrupt(true)); // the options changed with the board: ask again
        }
        return result;
    }

    private String applyOverride(List<String> args) {
        String op = args.get(0);
        // A correction states how the game should be; it must not set off triggers of its own. Destroying is
        // the exception: it is asked for precisely so that what dies triggers.
        boolean quiet = !op.equals("destroy");
        game.getTriggerHandler().setSuppressAllTriggers(quiet);
        String result;
        try {
            result = apply(op, args);
        } finally {
            if (quiet) {
                game.getTriggerHandler().setSuppressAllTriggers(false);
            }
        }
        // Triggers that look at what a card was ("if she was a nonland creature") read the game's last known
        // state, which the game loop refreshes; a correction made while it is parked must refresh it too.
        game.copyLastState();
        recorder.write("override", "what", String.join(" ", args), "result", result);
        return result;
    }

    private String apply(String op, List<String> args) {
        return switch (op) {
            case "move" -> {
                need(args, 3, "move CARD ZONE");
                Card card = find(args.get(1));
                ZoneType zone = zone(args.get(2));
                game.getAction().moveTo(zone, card, null, null);
                yield "moved " + card.getName() + " to " + zone.name().toLowerCase(Locale.ROOT);
            }
            case "create" -> {
                need(args, 2, "create CARD [ZONE]");
                PaperCard paper = StaticData.instance().getCommonCards().getCard(args.get(1));
                if (paper == null) {
                    throw new IllegalArgumentException("unknown card " + args.get(1));
                }
                ZoneType zone = args.size() > 2 ? zone(args.get(2)) : ZoneType.Battlefield;
                Card card = Card.fromPaperCard(paper, pilot);
                game.getAction().moveTo(zone, card, null, null);
                yield "created " + paper.getName() + " in " + zone.name().toLowerCase(Locale.ROOT);
            }
            case "life" -> {
                need(args, 2, "life N [PLAYER]");
                Player player = args.size() > 2 ? player(args.get(2)) : pilot;
                player.setLife(Integer.parseInt(args.get(1)), null);
                yield player.getName() + " life " + player.getLife();
            }
            case "counter" -> {
                need(args, 4, "counter CARD TYPE +N|-N");
                Card card = find(args.get(1));
                CounterType type = counter(args.get(2));
                int count = Math.max(0, card.getCounters(type) + Integer.parseInt(args.get(3)));
                card.setCounters(type, count);
                yield card.getName() + " " + args.get(2) + " counters " + count;
            }
            case "destroy" -> {
                need(args, 2, "destroy CARD");
                Card card = find(args.get(1));
                game.getAction().destroy(card, null, true, null);
                game.getAction().checkStateEffects(true);
                yield "destroyed " + card.getName();
            }
            case "tap" -> {
                need(args, 2, "tap CARD");
                Card card = find(args.get(1));
                card.tap(false, null, null);
                yield "tapped " + card.getName();
            }
            case "untap" -> {
                need(args, 2, "untap CARD");
                Card card = find(args.get(1));
                card.untap();
                yield "untapped " + card.getName();
            }
            default -> throw new IllegalArgumentException("overrides: move, create, life, counter, tap, untap, destroy");
        };
    }

    private static void need(List<String> args, int count, String usage) {
        if (args.size() < count) {
            throw new IllegalArgumentException("usage: " + usage);
        }
    }

    private static ZoneType zone(String name) {
        ZoneType zone = ZoneType.smartValueOf(name);
        if (zone == null) {
            throw new IllegalArgumentException("unknown zone " + name);
        }
        return zone;
    }

    private static CounterType counter(String name) {
        return switch (name.toLowerCase(Locale.ROOT)) {
            case "+1/+1", "p1p1" -> CounterEnumType.P1P1;
            case "-1/-1", "m1m1" -> CounterEnumType.M1M1;
            default -> CounterType.getType(name.toUpperCase(Locale.ROOT));
        };
    }

    private Player player(String name) {
        return game.getPlayers().stream()
                .filter(p -> p.getName().equalsIgnoreCase(name) || (name.equalsIgnoreCase("you") && p.equals(pilot)))
                .findFirst().orElseThrow(() -> new IllegalArgumentException("no player " + name));
    }

    private Card find(String ref) {
        int index = 1;
        String name = ref;
        int hash = ref.lastIndexOf('#');
        if (hash > 0 && ref.substring(hash + 1).matches("\\d+")) {
            index = Integer.parseInt(ref.substring(hash + 1));
            name = ref.substring(0, hash);
        }
        List<Card> exact = new ArrayList<>();
        List<Card> prefix = new ArrayList<>();
        List<Card> cards = new ArrayList<>();
        for (ZoneType zone : List.of(ZoneType.Battlefield, ZoneType.Hand, ZoneType.Graveyard, ZoneType.Exile,
                ZoneType.Command, ZoneType.Stack, ZoneType.Library)) {
            pilot.getCardsIn(zone).forEach(cards::add);
        }
        game.getCardsIn(ZoneType.Battlefield).forEach(c -> {
            if (!cards.contains(c)) {
                cards.add(c);
            }
        });
        String lower = name.toLowerCase(Locale.ROOT);
        for (Card card : cards) {
            String cardName = card.getName().toLowerCase(Locale.ROOT);
            if (cardName.equals(lower)) {
                exact.add(card);
            } else if (cardName.startsWith(lower)) {
                prefix.add(card);
            }
        }
        List<Card> matches = exact.isEmpty() ? prefix : exact;
        if (matches.isEmpty()) {
            throw new IllegalArgumentException("no card named " + name);
        }
        if (exact.isEmpty() && matches.stream().map(Card::getName).distinct().count() > 1) {
            throw new IllegalArgumentException(name + " matches several cards; use the full name");
        }
        if (index > matches.size()) {
            throw new IllegalArgumentException("only " + matches.size() + " " + matches.get(0).getName());
        }
        return matches.get(index - 1);
    }

    // ---- state view ----

    /** The pilot's view of the game; with text, also each nonbasic card's full text by name, for deciders that can't look cards up. */
    Map<String, Object> state(boolean text) {
        Map<String, Object> view = new LinkedHashMap<>();
        if (game == null || pilot == null) {
            return view;
        }
        view.put("turn", turnLabel());
        view.put("life", pilot.getLife());
        view.put("mana", manaEstimate(pilot, true)); // untapped, usable now
        view.put("land_drop", pilot.getMaxLandPlaysInfinite() || pilot.getLandsPlayedThisTurn() < pilot.getMaxLandPlays());
        view.put("library", pilot.getCardsIn(ZoneType.Library).size());
        view.put("hand", names(pilot.getCardsIn(ZoneType.Hand)));
        List<Map<String, Object>> board = new ArrayList<>();
        for (Card card : pilot.getCardsIn(ZoneType.Battlefield)) {
            Map<String, Object> permanent = new LinkedHashMap<>();
            permanent.put("name", card.getName());
            if (card.isTapped()) {
                permanent.put("tapped", true);
            }
            if (card.isCreature()) {
                permanent.put("pt", card.getNetPower() + "/" + card.getNetToughness());
                if (card.isSick()) {
                    permanent.put("sick", true);
                }
            }
            if (!card.getCounters().isEmpty()) {
                Map<String, Integer> counters = new TreeMap<>();
                card.getCounters().entrySet().forEach(e -> counters.put(e.getElement().getName(), e.getCount()));
                permanent.put("counters", counters);
            }
            if (card.isToken()) {
                permanent.put("token", true);
            }
            board.add(permanent);
        }
        view.put("battlefield", board);
        view.put("command", names(pilot.getCardsIn(ZoneType.Command)));
        view.put("graveyard", names(pilot.getCardsIn(ZoneType.Graveyard)));
        view.put("exile", names(pilot.getCardsIn(ZoneType.Exile)));
        List<String> stack = new ArrayList<>();
        game.getStack().forEach(item -> stack.add(Labels.text(item.getStackDescription(), "")));
        view.put("stack", stack);
        List<Map<String, Object>> opponents = new ArrayList<>();
        for (Player player : game.getPlayers()) {
            if (!player.equals(pilot)) {
                Map<String, Object> opponent = new LinkedHashMap<>();
                opponent.put("name", player.getName());
                opponent.put("life", player.getLife());
                opponent.put("lands", player.getLandsInPlay().size());
                opponent.put("other", player.getCardsIn(ZoneType.Battlefield).size() - player.getLandsInPlay().size());
                opponents.add(opponent);
            }
        }
        view.put("opponents", opponents);
        if (text) {
            Map<String, String> texts = new TreeMap<>();
            for (ZoneType zone : List.of(ZoneType.Hand, ZoneType.Battlefield, ZoneType.Command)) {
                for (Card card : pilot.getCardsIn(zone)) {
                    if (!card.isImmutable() && !card.isBasicLand()) {
                        texts.putIfAbsent(card.getName(), Labels.detail(card));
                    }
                }
            }
            view.put("text", texts);
        }
        return view;
    }

    /**
     * Mana the player's sources could make now, one activation each, plus the pool. Forge's AI's own estimate
     * (ComputerUtilMana.getAvailableManaEstimate) counts a land that makes one of two colours as three mana.
     * With untapped, only abilities usable now count.
     */
    static int manaEstimate(Player player, boolean untapped) {
        int total = player.getManaPool().totalMana();
        for (Card card : player.getCardsIn(ZoneType.Battlefield)) {
            int best = 0;
            for (forge.game.spellability.SpellAbility ability : card.getManaAbilities()) {
                ability.setActivatingPlayer(player);
                if (ability.getManaPart() == null || (untapped && !ability.canPlay())) {
                    continue;
                }
                String produced = ability.getManaPart().getOrigProduced();
                int symbols = produced.startsWith("Combo") || produced.contains("Any") || produced.contains("Special")
                        ? 1 : produced.trim().split(" ").length;
                int amount = forge.game.ability.AbilityUtils.calculateAmount(card, ability.getParamOrDefault("Amount", "1"), ability);
                int costs = ability.getPayCosts().getCostMana() == null ? 0 : ability.getPayCosts().getCostMana().convertAmount();
                best = Math.max(best, symbols * amount - costs);
            }
            total += best;
        }
        return total;
    }

    /** Names of real cards; Forge's internal effect objects (such as "Commander Effect") are left out. */
    private static List<String> names(Iterable<Card> cards) {
        List<String> names = new ArrayList<>();
        cards.forEach(card -> {
            if (!card.isImmutable()) {
                names.add(card.getName());
            }
        });
        return names;
    }
}
