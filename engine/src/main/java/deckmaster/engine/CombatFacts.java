package deckmaster.engine;

import forge.game.Game;
import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.phase.PhaseHandler;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The combat on the table, as facts kept for its life: its key (Forge's turn and combat ordinal) and the combat damage
 * dealt in it, by source and target, after prevention, summed over its damage steps (first strike and regular).
 *
 * Forge records each damage instance as an (amount, combat) pair on its source's damage history and its target's
 * received damage, with the last-known source and target ({@code Game.getDamageLKI}). This reads that state as it
 * happens (Forge is not changed): the instances that exist when a combat begins are not its own; every combat
 * instance seen after is kept by identity, so a hit stays counted when its source or its target leaves the battlefield,
 * and nothing depends on Forge's log. Facts only: what they mean is the client's.
 */
final class CombatFacts {
    /** One hit: who dealt it, to whom (a player's name or a card's id), how much. */
    private record Hit(int source, Object target, int amount) {
    }

    private String key = "";
    private final Set<Pair<Integer, Boolean>> before = Collections.newSetFromMap(new IdentityHashMap<>());
    private final Map<Pair<Integer, Boolean>, Hit> hits = new IdentityHashMap<>();
    /** The order hits were seen, for a stable export. */
    private final List<Pair<Integer, Boolean>> order = new ArrayList<>();

    /** Brings the facts up to date with the game: a new combat starts them afresh; its hits are taken as they land. */
    synchronized void observe(Game game) {
        if (game == null) {
            return;
        }
        Combat combat = game.getCombat();
        if (combat == null) {
            return;
        }
        PhaseHandler phase = game.getPhaseHandler();
        String now = phase.getTurn() + "|" + phase.getNumCombat();
        if (!now.equals(key)) {
            key = now;
            hits.clear();
            order.clear();
            before.clear();
            before.addAll(instances(game, combat));
            return;
        }
        for (Pair<Integer, Boolean> dmg : instances(game, combat)) {
            if (!Boolean.TRUE.equals(dmg.getRight()) || before.contains(dmg) || hits.containsKey(dmg)) {
                continue;
            }
            Pair<Card, GameEntity> lki = game.getDamageLKI(dmg);
            if (lki == null || lki.getLeft() == null || lki.getRight() == null || dmg.getLeft() <= 0) {
                continue;
            }
            GameEntity target = lki.getRight();
            hits.put(dmg, new Hit(lki.getLeft().getId(), target instanceof Player p ? (Object) p.getName() : (Object) target.getId(), dmg.getLeft()));
            order.add(dmg);
        }
    }

    /** Forge's combat ordinal this turn (1 for the first combat). */
    static int ordinal(Game game) {
        return game.getPhaseHandler().getNumCombat();
    }

    /** This combat's damage so far, summed by source and target: {source, target, amount}, in the order first dealt. */
    synchronized List<Map<String, Object>> damage(Game game) {
        observe(game);
        Map<String, Map<String, Object>> by = new LinkedHashMap<>();
        for (Pair<Integer, Boolean> dmg : order) {
            Hit hit = hits.get(dmg);
            Map<String, Object> row = by.computeIfAbsent(hit.source() + ">" + hit.target(), k -> {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("source", hit.source());
                r.put("target", hit.target());
                r.put("amount", 0);
                return r;
            });
            row.put("amount", (Integer) row.get("amount") + hit.amount());
        }
        return new ArrayList<>(by.values());
    }

    /** Every damage instance this turn that Forge holds where a combat's could be: on players, on what is on the
     *  battlefield, and on the attackers' damage histories (which a source's last-known copies share). */
    private static List<Pair<Integer, Boolean>> instances(Game game, Combat combat) {
        List<Pair<Integer, Boolean>> out = new ArrayList<>();
        for (Player p : game.getPlayers()) {
            out.addAll(p.getDamageReceivedThisTurn());
        }
        for (Card c : game.getCardsIn(ZoneType.Battlefield)) {
            out.addAll(c.getDamageReceivedThisTurn());
        }
        for (Card a : combat.getAttackers()) {
            out.addAll(a.getDamageHistory().getAllDmgInstances());
        }
        return out;
    }
}
