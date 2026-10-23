package goldfish.engine;

import forge.StaticData;
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
import forge.ai.ComputerUtilMana;

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

/** One goldfish game: the agent's deck against passive opponents, run on its own thread. */
final class Session {
    static final String PILOT = "You";

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

    /** When the agent picks which sources pay mana: never, when a creature could pay, or always. */
    enum ManaChoice { AUTO, CREATURES, ALWAYS }

    final String id;
    final long seed;
    /** Turns of the agent's after which the game ends; 0 for no limit. */
    final int turnLimit;
    final boolean stopsAll;
    final ManaChoice manaChoice;
    /** The decision kinds the agent answers; null for all of them. Forge's AI answers the rest. */
    private final Set<String> asks;
    final Path recordFile;
    final Channel channel = new Channel();
    final Recorder recorder;
    volatile int pilotTurn;
    volatile Game game;
    volatile Player pilot;
    volatile String over;
    private volatile SeededRandom.Source random;
    private final Map<String, Snapshot> snapshots = new LinkedHashMap<>();

    Session(String id, long seed, int turnLimit, boolean stopsAll, ManaChoice manaChoice, Set<String> asks, Path runsDir) throws IOException {
        this.asks = asks;
        this.id = id;
        this.seed = seed;
        this.turnLimit = turnLimit;
        this.stopsAll = stopsAll;
        this.manaChoice = manaChoice;
        this.recordFile = runsDir.resolve(id + ".jsonl");
        this.recorder = new Recorder(this, recordFile);
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

    static Deck deck(List<String> commanders, List<Map.Entry<Integer, String>> main, List<String> unknown) {
        Deck deck = new Deck("goldfish");
        for (String name : commanders) {
            PaperCard card = StaticData.instance().getCommonCards().getCard(name);
            if (card == null) {
                unknown.add(name);
            } else {
                deck.getOrCreate(DeckSection.Commander).add(card, 1);
            }
        }
        for (Map.Entry<Integer, String> entry : main) {
            PaperCard card = StaticData.instance().getCommonCards().getCard(entry.getValue());
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
    void start(Deck deck, int opponents, String commanderNames, String deckName, String deckHash) {
        Thread thread = new Thread(() -> {
            random = SeededRandom.seed(seed);
            try {
                List<RegisteredPlayer> players = new ArrayList<>();
                players.add(RegisteredPlayer.forCommander(deck)
                        .setPlayer(new Seat(PILOT, (g, p, l) -> new ManualController(g, p, l, this))));
                for (int i = 1; i <= opponents; i++) {
                    players.add(RegisteredPlayer.forCommander(passiveDeck())
                            .setPlayer(new Seat("Opp " + i, PassiveController::new)));
                }
                Match match = new Match(new GameRules(GameType.Commander), players, "goldfish");
                game = match.createGame();
                game.setNoGUIUser();
                pilot = game.getPlayers().stream().filter(p -> p.getName().equals(PILOT)).findFirst().orElseThrow();
                game.subscribeToEvents(recorder);
                recorder.write("start", "seed", seed, "deck", deckName, "hash", deckHash, "commander", commanderNames,
                        "turns", turnLimit > 0 ? turnLimit : null, "opponents", opponents);
                match.startGame(game);
                if (over == null) {
                    over = outcome();
                }
            } catch (Channel.Interrupt interrupt) {
                over = "ended";
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
        return asks == null || asks.contains(kind);
    }

    /** Whether the agent answers every kind (plain manual mode). */
    boolean manual() {
        return asks == null;
    }

    /** Called by the recorder when the agent's turn begins; false once past the turn limit, which ends the game. */
    boolean beginPilotTurn() {
        pilotTurn++;
        if (turnLimit > 0 && pilotTurn > turnLimit) {
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
        pilotTurn = snapshot.pilotTurn();
        random.rewind(snapshot.random()); // the same shuffles and draws as when the snapshot was taken
        // A restored copy may share objects with the game now, so keep a fresh copy for the next restore.
        GameSnapshot fresh = new GameSnapshot(game);
        fresh.makeCopy();
        snapshots.put(name, new Snapshot(fresh, pilotTurn, snapshot.random()));
        recorder.write("restore", "name", name);
        channel.resume(new Channel.Interrupt(true));
    }

    void end() throws InterruptedException {
        if (over == null) {
            over = "ended";
        }
        if (game != null) {
            game.setGameOver(GameEndReason.Draw);
        }
        if (channel.pending() != null) {
            channel.resume(new Channel.Interrupt(false));
        }
    }

    /** A manual correction to the game state, recorded as such. Cards are referred to by name, "Name#2" for the second. */
    String override(List<String> args) throws InterruptedException {
        if (channel.pending() == null) {
            throw new IllegalStateException("overrides happen while the game waits for a decision");
        }
        if (args.isEmpty()) {
            throw new IllegalArgumentException("override what?");
        }
        String op = args.get(0);
        // A correction states how the game should be; it must not set off triggers of its own.
        game.getTriggerHandler().setSuppressAllTriggers(true);
        String result;
        try {
            result = apply(op, args);
        } finally {
            game.getTriggerHandler().setSuppressAllTriggers(false);
        }
        recorder.write("override", "what", String.join(" ", args), "result", result);
        Decision pending = channel.pending();
        if (pending != null && pending.kind().equals("play")) {
            channel.resume(new Channel.Interrupt(true)); // the options changed with the board: ask again
        }
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
            default -> throw new IllegalArgumentException("overrides: move, create, life, counter, tap, untap");
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

    Map<String, Object> state() {
        Map<String, Object> view = new LinkedHashMap<>();
        if (game == null || pilot == null) {
            return view;
        }
        view.put("turn", turnLabel());
        view.put("life", pilot.getLife());
        view.put("mana", ComputerUtilMana.getAvailableManaEstimate(pilot, true)); // untapped, usable now
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
        return view;
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
