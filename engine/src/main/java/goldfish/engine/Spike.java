package goldfish.engine;

import com.google.common.eventbus.Subscribe;
import forge.StaticData;
import forge.ai.LobbyPlayerAi;
import forge.ai.PlayerControllerAi;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.GameRules;
import forge.game.GameSnapshot;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.event.GameEvent;
import forge.game.event.GameEventLandPlayed;
import forge.game.event.GameEventSpellAbilityCast;
import forge.game.event.GameEventTurnBegan;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * M0 spike: headless startup, card coverage, an automated game to turn N against three passive
 * opponents, a game driven by an agent through parked decisions, a GameSnapshot round trip, and
 * games in parallel. Measurement harness, rerun after moving the Forge pin; results live in docs/architecture.md.
 */
public final class Spike {
    private static final Pattern CARD = Pattern.compile(
            "^(\\d+)x?\\s+(.+?)(?:\\s+\\([A-Za-z0-9]+\\)(?:\\s+\\S+)?)?(?:\\s+\\*[A-Z]\\*)?$");
    private static final int SEATS = 4;

    interface ControllerFactory {
        PlayerControllerAi create(Game game, Player player, LobbyPlayerAi lobby);
    }

    static final class Seat extends LobbyPlayerAi {
        private final ControllerFactory factory;
        PlayerControllerAi controller;

        Seat(String name, ControllerFactory factory) {
            super(name, null);
            this.factory = factory;
        }

        @Override
        public Player createIngamePlayer(Game game, int id) {
            Player player = new Player(getName(), game, id);
            controller = factory.create(game, player, this);
            player.setFirstController(controller);
            return player;
        }
    }

    /** Collects a one-line digest per pilot turn and ends the game when the pilot reaches its last turn. */
    static final class Digest {
        final Game game;
        final int maxTurns;
        final List<String> lines = new ArrayList<>();
        Player pilot;
        int pilotTurn;
        List<String> lands = new ArrayList<>();
        List<String> casts = new ArrayList<>();

        Digest(Game game, int maxTurns) {
            this.game = game;
            this.maxTurns = maxTurns;
        }

        @Subscribe
        public void receive(GameEvent event) {
            if (pilot == null) {
                pilot = game.getPlayers().stream().filter(p -> p.getName().equals("Pilot")).findFirst().orElse(null);
            }
            if (event instanceof GameEventTurnBegan turn && turn.turnOwner().getId() == pilot.getId()) {
                flush();
                pilotTurn = (turn.turnNumber() - 1) / SEATS + 1;
                if (pilotTurn > maxTurns) {
                    game.setGameOver(GameEndReason.Draw);
                }
            } else if (event instanceof GameEventLandPlayed land && land.player().getId() == pilot.getId()) {
                lands.add(land.land().getName());
            } else if (event instanceof GameEventSpellAbilityCast cast && cast.si() != null
                    && cast.si().getActivatingPlayer() != null
                    && cast.si().getActivatingPlayer().getId() == pilot.getId()) {
                casts.add(cast.sa().getHostCard().getName());
            }
        }

        void flush() {
            if (pilotTurn == 0) {
                return;
            }
            lines.add(String.format("T%d land %s | cast %s | lands %d | hand %d",
                    pilotTurn, lands.isEmpty() ? "-" : String.join(", ", lands),
                    casts.isEmpty() ? "-" : String.join(", ", casts),
                    pilot.getLandsInPlay().size(), pilot.getCardsIn(ZoneType.Hand).size()));
            lands = new ArrayList<>();
            casts = new ArrayList<>();
        }
    }

    record Result(Digest digest, PilotController pilot, long millis) { }

    static Deck loadDeck(Path path, List<String> missing) throws Exception {
        Deck deck = new Deck(path.getFileName().toString());
        boolean commander = false;
        for (String raw : Files.readAllLines(path)) {
            String line = raw.split(" \\| ", 2)[0].trim();
            if (line.isEmpty()) {
                continue;
            }
            if (line.startsWith("~~") || line.startsWith("//") || line.startsWith("#")) {
                commander = line.toLowerCase().contains("commander");
                continue;
            }
            Matcher m = CARD.matcher(line);
            if (!m.matches()) {
                throw new IllegalArgumentException("not a card line: " + raw);
            }
            PaperCard card = StaticData.instance().getCommonCards().getCard(m.group(2));
            if (card == null) {
                missing.add(m.group(2));
                continue;
            }
            deck.getOrCreate(commander ? DeckSection.Commander : DeckSection.Main).add(card, Integer.parseInt(m.group(1)));
        }
        return deck;
    }

    static Deck passiveDeck() {
        Deck deck = new Deck("Passive");
        deck.getOrCreate(DeckSection.Commander).add(StaticData.instance().getCommonCards().getCard("Kozilek, Butcher of Truth"), 1);
        deck.getMain().add(StaticData.instance().getCommonCards().getCard("Wastes"), 99);
        return deck;
    }

    static Result play(Deck deck, int maxTurns, Agent agent, Consumer<PilotController> onPriority) {
        Seat pilotSeat = new Seat("Pilot", (g, p, l) -> new PilotController(g, p, l));
        List<RegisteredPlayer> players = new ArrayList<>();
        players.add(RegisteredPlayer.forCommander(deck).setPlayer(pilotSeat));
        for (int i = 1; i < SEATS; i++) {
            players.add(RegisteredPlayer.forCommander(passiveDeck())
                    .setPlayer(new Seat("Passive " + i, (g, p, l) -> new PassiveController(g, p, l))));
        }
        Match match = new Match(new GameRules(GameType.Commander), players, "goldfish");
        Game game = match.createGame();
        game.setNoGUIUser();
        Digest digest = new Digest(game, maxTurns);
        game.subscribeToEvents(digest);
        // Controllers exist once the game is created; attach the agent before the first decision.
        PilotController[] pilot = new PilotController[1];
        game.getPlayers().forEach(p -> {
            if (p.getController() instanceof PilotController pc) {
                pc.agent = agent;
                pc.onPriority = onPriority;
                pilot[0] = pc;
            }
        });
        long start = System.nanoTime();
        match.startGame(game);
        digest.flush();
        return new Result(digest, pilot[0], (System.nanoTime() - start) / 1_000_000);
    }

    static String summary(Game game) {
        Player pilot = game.getPlayers().stream().filter(p -> p.getName().equals("Pilot")).findFirst().orElseThrow();
        TreeMap<String, Integer> board = new TreeMap<>();
        for (Card c : pilot.getCardsIn(ZoneType.Battlefield)) {
            board.merge(c.getName(), 1, Integer::sum);
        }
        return String.format("turn %d %s life %d hand %d library %d graveyard %d board %s",
                game.getPhaseHandler().getTurn(), game.getPhaseHandler().getPhase(), pilot.getLife(),
                pilot.getCardsIn(ZoneType.Hand).size(), pilot.getCardsIn(ZoneType.Library).size(),
                pilot.getCardsIn(ZoneType.Graveyard).size(), board);
    }

    static long usedMb() {
        Runtime rt = Runtime.getRuntime();
        rt.gc();
        return (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024);
    }

    public static void main(String[] args) throws Exception {
        String res = args[0];
        Path deckPath = Path.of(args[1]);
        int turns = args.length > 2 ? Integer.parseInt(args[2]) : 8;
        boolean lazy = args.length > 3 && args[3].equals("lazy");

        long t0 = System.nanoTime();
        Forge.start(res, lazy);
        System.out.printf("startup: %d ms (%s card loading), heap %d MB%n",
                (System.nanoTime() - t0) / 1_000_000, lazy ? "lazy" : "eager", usedMb());

        List<String> missing = new ArrayList<>();
        Deck deck = loadDeck(deckPath, missing);
        System.out.printf("coverage: %d cards found, missing %s%n",
                deck.getMain().countAll() + deck.get(DeckSection.Commander).countAll(), missing);
        List<String> aiAvoids = new ArrayList<>();
        deck.getMain().forEach(e -> {
            if (e.getKey().getRules().getAiHints().getRemAIDecks()) {
                aiAvoids.add(e.getKey().getName());
            }
        });
        System.out.println("ai marks as hard to play: " + aiAvoids);

        System.out.println("\n== automated game, Forge AI pilot, to turn " + turns);
        Result auto = play(deck, turns, null, null);
        auto.digest().lines.forEach(System.out::println);
        System.out.printf("time %d ms, decisions %s%n", auto.millis(), auto.pilot().decisions);

        Game autoGame = auto.digest().game;
        for (Player p : autoGame.getPlayers()) {
            if (!p.getName().equals("Pilot")) {
                long nonland = p.getCardsIn(ZoneType.Battlefield).stream().filter(c -> !c.isLand()).count();
                System.out.printf("%s: lands %d, nonland permanents %d, life %d%n", p.getName(),
                        p.getLandsInPlay().size(), nonland, p.getLife());
            }
        }

        System.out.println("\n== determinism: two games after seeding Forge's shared RNG with 7");
        forge.util.MyRandom.setRandom(new java.util.Random(7));
        List<String> seededA = play(deck, 4, null, null).digest().lines;
        forge.util.MyRandom.setRandom(new java.util.Random(7));
        List<String> seededB = play(deck, 4, null, null).digest().lines;
        System.out.println("identical: " + seededA.equals(seededB));
        seededA.forEach(System.out::println);
        if (!seededA.equals(seededB)) {
            seededB.forEach(System.out::println);
        }

        System.out.println("\n== manual game: agent answers mulligan and turn-1 priority, then hands back to AI");
        Agent agent = new Agent();
        Result[] manual = new Result[1];
        Thread gameThread = new Thread(() -> manual[0] = play(deck, 3, agent, null));
        gameThread.start();
        Agent.Decision first = agent.next(30_000);
        System.out.println("parked: " + first.kind() + " / " + first.prompt());
        agent.answer("keep");
        boolean playedLand = false;
        while (!playedLand) {
            Agent.Decision d = agent.next(30_000);
            if (d == null) {
                break;
            }
            String land = d.options().stream().filter(o -> o.contains("Play ")).findFirst().orElse("pass");
            if (d.prompt().startsWith("Pilot")) {
                System.out.printf("parked: %s / %s / %s -> %s%n", d.kind(), d.prompt(), d.options(), land);
            }
            playedLand = !land.equals("pass");
            if (playedLand) {
                agent.release(); // the rest of the game runs on Forge AI
            }
            agent.answer(land);
        }
        gameThread.join();
        manual[0].digest().lines.forEach(System.out::println);

        System.out.println("\n== snapshot: copy at pilot turn 3 main 1, restore at pilot turn 5 main 1");
        GameSnapshot[] snap = new GameSnapshot[1];
        String[] before = new String[1];
        boolean[] restored = new boolean[1];
        Result snapResult = play(deck, 6, null, pc -> {
            Game game = pc.getGame();
            if (!game.getPhaseHandler().isPlayerTurn(pc.getPlayer()) || game.getPhaseHandler().getPhase() != PhaseType.MAIN1
                    || !game.getStack().isEmpty()) {
                return;
            }
            int pilotTurn = (game.getPhaseHandler().getTurn() - 1) / SEATS + 1;
            if (pilotTurn == 3 && snap[0] == null) {
                long s = System.nanoTime();
                snap[0] = new GameSnapshot(game);
                snap[0].makeCopy();
                before[0] = summary(game);
                System.out.printf("copied in %d ms: %s%n", (System.nanoTime() - s) / 1_000_000, before[0]);
            } else if (pilotTurn == 5 && snap[0] != null && !restored[0]) {
                restored[0] = true;
                System.out.println("before restore: " + summary(game));
                long s = System.nanoTime();
                snap[0].restoreGameState(game);
                String after = summary(game);
                System.out.printf("restored in %d ms: %s%nmatches copy: %s%n",
                        (System.nanoTime() - s) / 1_000_000, after, after.equals(before[0]));
            }
        });
        snapResult.digest().lines.forEach(System.out::println);

        for (int threads : new int[] {1, 8}) {
            int games = 16;
            ExecutorService pool = Executors.newFixedThreadPool(threads);
            List<Future<Result>> futures = new ArrayList<>();
            long s = System.nanoTime();
            for (int i = 0; i < games; i++) {
                futures.add(pool.submit(() -> play(deck, turns, null, null)));
            }
            int failed = 0;
            long sum = 0;
            for (Future<Result> f : futures) {
                try {
                    sum += f.get().millis();
                } catch (Exception e) {
                    failed++;
                    System.out.println("game failed: " + e.getCause());
                }
            }
            pool.shutdown();
            System.out.printf("%n%d games to turn %d on %d threads: wall %d ms, mean game %d ms, failed %d, heap %d MB%n",
                    games, turns, threads, (System.nanoTime() - s) / 1_000_000, sum / Math.max(1, games - failed), failed, usedMb());
        }
        System.exit(0);
    }
}
