package goldfish.engine;

import com.google.common.eventbus.Subscribe;
import com.google.gson.Gson;
import forge.game.card.Card;
import forge.game.card.CardView;
import forge.game.event.GameEvent;
import forge.game.event.GameEventCardChangeZone;
import forge.game.event.GameEventLandPlayed;
import forge.game.event.GameEventPlayerLivesChanged;
import forge.game.event.GameEventSnapshotRestored;
import forge.game.event.GameEventTurnBegan;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Writes the game's facts as JSON lines, one per fact, each tagged with the agent's turn number.
 * Facts only: what to make of them is the Python side's job. Card names, never ids.
 */
final class Recorder {
    private static final Gson GSON = new Gson();

    private final Session session;
    private final Writer out;
    /** Restoring a snapshot moves cards around in bulk; those moves are not game facts. */
    private boolean restoring;

    Recorder(Session session, Path file) throws IOException {
        this.session = session;
        Files.createDirectories(file.getParent());
        this.out = Files.newBufferedWriter(file, StandardCharsets.UTF_8);
    }

    synchronized void write(String type, Object... keyValues) {
        Map<String, Object> fact = new LinkedHashMap<>();
        fact.put("t", type);
        fact.put("turn", session.pilotTurn);
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            if (keyValues[i + 1] != null) {
                fact.put((String) keyValues[i], keyValues[i + 1]);
            }
        }
        try {
            out.write(GSON.toJson(fact));
            out.write('\n');
            out.flush();
        } catch (IOException e) {
            throw new IllegalStateException("cannot write the game record", e);
        }
    }

    void close() {
        try {
            out.close();
        } catch (IOException ignored) {
            // the record is flushed after every fact
        }
    }

    // ---- facts reported by the controller and session ----

    void decision(String kind, String prompt, List<String> options, List<Integer> answer, String by) {
        List<String> picked = new ArrayList<>();
        for (int a : answer) {
            picked.add(options.isEmpty() ? String.valueOf(a) : options.get(a - 1));
        }
        write("decision", "kind", kind, "prompt", prompt.isEmpty() ? null : prompt, "options", options.size(),
                "answer", picked, "by", by);
    }

    /** A choice Forge's AI made for the agent's seat, so the record shows what the agent didn't decide. */
    void ai(String kind, String prompt, List<String> answer) {
        write("decision", "kind", kind, "prompt", prompt.isEmpty() ? null : prompt, "answer", answer, "by", "ai");
    }

    void paid(String card, List<String> sources, String by) {
        if (!sources.isEmpty()) {
            write("paid", "card", card, "sources", sources, "by", by);
        }
    }

    void played(SpellAbility sa, String label, Integer x, boolean ok) {
        write(sa.isSpell() ? "cast" : "activate", "card", sa.getHostCard().getName(), "id", sa.getHostCard().getId(), "as", label, "x", x,
                "failed", ok ? null : true);
    }

    void look(Iterable<?> cards, String why) {
        List<String> names = new ArrayList<>();
        List<Integer> ids = new ArrayList<>();
        for (Object card : cards) {
            names.add(card instanceof Card c ? c.getName() : ((CardView) card).getName());
            ids.add(card instanceof Card c ? c.getId() : ((CardView) card).getId());
        }
        if (!names.isEmpty()) {
            write("look", "cards", names, "ids", ids, "why", why);
        }
    }

    // ---- facts from Forge's events ----

    private boolean isPilot(PlayerView player) {
        return player != null && session.pilot != null && player.getId() == session.pilot.getId();
    }

    @Subscribe
    public void receive(GameEvent event) {
        if (event instanceof GameEventSnapshotRestored restored) {
            restoring = restored.start();
        } else if (restoring) {
            return;
        } else if (event instanceof GameEventTurnBegan turn) {
            if (isPilot(turn.turnOwner()) && session.beginPilotTurn()) {
                write("turn");
            }
        } else if (event instanceof GameEventLandPlayed land && isPilot(land.player())) {
            write("land", "card", land.land().getName(), "id", land.land().getId());
        } else if (event instanceof GameEventPlayerLivesChanged life) {
            write("life", "player", life.player().getName(), "life", life.newLives());
        } else if (event instanceof GameEventCardChangeZone move) {
            zoneChange(move);
        }
    }

    private void zoneChange(GameEventCardChangeZone move) {
        CardView card = move.card();
        boolean mine = isPilot(card.getOwner()) || isPilot(card.getController());
        if (!mine) {
            return;
        }
        ZoneType from = move.from() == null ? null : move.from().zoneType();
        ZoneType to = move.to() == null ? null : move.to().zoneType();
        if (from == ZoneType.Library && to == ZoneType.Hand) {
            write("draw", "card", card.getName(), "id", card.getId());
        } else if (from != to && from != ZoneType.Stack && to != ZoneType.Stack
                && !(from == ZoneType.Hand && to == ZoneType.Battlefield && card.getCurrentState().isLand())) {
            write("move", "card", card.getName(), "from", zone(from), "to", zone(to), "token", card.isToken() ? true : null);
        }
    }

    private static String zone(ZoneType zone) {
        return zone == null ? null : zone.name().toLowerCase();
    }
}
