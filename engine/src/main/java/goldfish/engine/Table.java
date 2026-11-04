package goldfish.engine;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameOutcome;
import forge.game.GameType;
import forge.gamemodes.match.HostedMatch;
import forge.gamemodes.match.LobbySlot;
import forge.gamemodes.match.LobbySlotType;
import forge.gamemodes.net.server.FServerManager;
import forge.gamemodes.net.server.ServerGameLobby;

/**
 * A Commander table hosted over Forge's network play: the engine's own seats (agents, each a {@link Session}) sit in
 * AI slots, and people join the open slots from their own Forge (Online Multiplayer, Join). The game starts once
 * every seat is taken and ready, and runs on Forge's match thread; each seat's session parks its decisions.
 */
final class Table {
    final int port;
    final Map<String, Session> seats = new LinkedHashMap<>();
    private final ServerGameLobby lobby;
    private volatile String state = "waiting for players";
    private volatile Game game;
    private volatile boolean stopped;

    Table(int port, List<Session> agents, List<Deck> decks, int people) {
        this.port = port;
        FServerManager server = FServerManager.getInstance();
        server.startServer(port);
        lobby = new ServerGameLobby();
        server.setLobby(lobby);
        lobby.applyVariant(GameType.Commander);
        int total = agents.size() + people;
        while (lobby.getNumberOfSlots() < total) {
            lobby.addSlot();
        }
        for (int i = 0; i < agents.size(); i++) {
            Session seat = agents.get(i);
            LobbySlot slot = lobby.getSlot(i);
            slot.setType(LobbySlotType.AI);
            slot.setName(seat.seatName());
            slot.setDeck(decks.get(i));
            slot.setIsReady(true);
            seats.put(seat.seatName(), seat);
        }
        for (int i = agents.size(); i < total; i++) {
            LobbySlot slot = lobby.getSlot(i);
            slot.setType(LobbySlotType.OPEN);
            slot.setIsReady(false);
        }
        lobby.setAiSeats(slot -> seats.containsKey(slot.getName()) ? seats.get(slot.getName()).seat() : null);
        Thread host = new Thread(this::host, "table");
        host.setDaemon(true);
        host.start();
    }

    String state() {
        return state;
    }

    /** Waits for every seat to be taken and ready, plays the game, and ends the seats' sessions when it is over. */
    private void host() {
        try {
            while (!allReady()) {
                Thread.sleep(500);
            }
            state = "starting";
            Runnable start = lobby.startGame();
            if (start == null) {
                state = "could not start (a deck failed the lobby's checks)";
                seats.values().forEach(s -> s.finishAtTable(state));
                return;
            }
            start.run();
            HostedMatch match = lobby.getHostedMatch();
            game = match == null ? null : match.getGame();
            state = "playing";
            while (game != null && !game.isGameOver()) {
                Thread.sleep(500);
            }
            GameOutcome outcome = game == null ? null : game.getOutcome();
            if (stopped) {
                state = "stopped";
            } else if (outcome == null || outcome.isDraw() || outcome.getWinningLobbyPlayer() == null) {
                state = "over: a draw";
            } else {
                state = "over: " + outcome.getWinningLobbyPlayer().getName() + " won";
            }
            seats.values().forEach(s -> s.finishAtTable(state));
        } catch (InterruptedException interrupted) {
            state = "stopped";
            seats.values().forEach(s -> s.finishAtTable(state));
        } catch (RuntimeException error) {
            state = "error: " + error;
            error.printStackTrace();
            seats.values().forEach(s -> s.finishAtTable(state));
        }
    }

    /** Ends the game where it stands (a draw) and closes the table to people. */
    void stop() {
        stopped = true;
        Game playing = game;
        if (playing != null && !playing.isGameOver()) {
            playing.setGameOver(forge.game.GameEndReason.Draw);
        }
        FServerManager.getInstance().stopServer();
        state = "stopped";
    }

    private boolean allReady() {
        for (int i = 0; i < lobby.getNumberOfSlots(); i++) {
            LobbySlot slot = lobby.getSlot(i);
            if (slot.getType() == LobbySlotType.OPEN || !slot.isReady()) {
                return false;
            }
        }
        return true;
    }

    /** Who sits where, for the host to show: each slot's name, kind and readiness. */
    List<String> slots() {
        List<String> out = new java.util.ArrayList<>();
        for (int i = 0; i < lobby.getNumberOfSlots(); i++) {
            LobbySlot slot = lobby.getSlot(i);
            out.add((slot.getName() == null || slot.getName().isEmpty() ? "(open)" : slot.getName()) + " · "
                    + slot.getType().name().toLowerCase() + (slot.isReady() ? " · ready" : ""));
        }
        return out;
    }
}
