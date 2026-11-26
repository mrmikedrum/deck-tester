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
 * The combat on the table, as facts kept for its life: Forge's combat ordinal in the turn, and the combat damage dealt
 * in it, each hit with its source, its target, the defender its source was attacking when it landed, and its amount
 * after prevention, summed over the combat's damage steps (first strike and regular).
 *
 * Forge records each damage instance as an (amount, combat) pair on its source's damage history and its target's
 * received damage, with the last-known source and target ({@code Game.getDamageLKI}). This reads that state on the game
 * thread, from the recorder's event handler, as it happens (Forge is not changed): the instances that exist when a
 * combat begins are not its own, and every combat instance seen after is taken once, by identity, with the defender
 * of the moment. The request thread reads only the published value. Facts only: what they mean is the client's.
 */
final class CombatFacts {
    /** A target or a defender: a player by name, or a card by id. */
    record Entity(String player, Integer card) {
        static Entity of(GameEntity e) {
            return e == null ? null : e instanceof Player p ? new Entity(p.getName(), null) : new Entity(null, e.getId());
        }

        Object wire() {
            return player != null ? player : card;
        }
    }

    /** One hit: who dealt it, to what, what its source was attacking then (null when not an attacker), how much. */
    record Hit(int source, Entity target, Entity defender, int amount) {
    }

    /** What the request thread reads: the combat's ordinal (0 outside combat) and its hits so far. */
    record Published(int ordinal, List<Hit> hits) {
        static final Published NONE = new Published(0, List.of());

        /** The hits summed by source, target and defender: {source, target, defender, amount}, in the order first dealt. */
        List<Map<String, Object>> damage() {
            Map<List<Object>, Map<String, Object>> by = new LinkedHashMap<>();
            for (Hit hit : hits) {
                Map<String, Object> row = by.computeIfAbsent(List.of(hit.source(), hit.target(), hit.defender() == null ? "" : hit.defender()), k -> {
                    Map<String, Object> r = new LinkedHashMap<>();
                    r.put("source", hit.source());
                    r.put("target", hit.target().wire());
                    r.put("defender", hit.defender() == null ? null : hit.defender().wire());
                    r.put("amount", 0);
                    return r;
                });
                row.put("amount", (Integer) row.get("amount") + hit.amount());
            }
            return new ArrayList<>(by.values());
        }
    }

    /** What a session snapshot keeps: the combat's key and its hits. */
    record Saved(String key, int ordinal, List<Hit> hits) {
    }

    // Game-thread state: the combat's key, the instances not its own or already taken, and its hits.
    private String key = "";
    private int ordinal;
    private final Set<Pair<Integer, Boolean>> known = Collections.newSetFromMap(new IdentityHashMap<>());
    private final List<Hit> hits = new ArrayList<>();
    private volatile Published published = Published.NONE;

    /** The latest facts, for the view (any thread). */
    Published published() {
        return published;
    }

    /** Brings the facts up to date (the game thread, on each event): a new combat starts afresh, its hits are taken as
     *  they land, and the end of combat releases them. */
    synchronized void observe(Game game) {
        Combat combat = game == null ? null : game.getCombat();
        if (combat == null) {
            if (!key.isEmpty()) {
                key = "";
                ordinal = 0;
                known.clear();
                hits.clear();
                published = Published.NONE;
            }
            return;
        }
        PhaseHandler phase = game.getPhaseHandler();
        String now = phase.getTurn() + "|" + phase.getNumCombat();
        if (!now.equals(key)) {
            key = now;
            ordinal = phase.getNumCombat();
            hits.clear();
            known.clear();
            known.addAll(instances(game, combat));
            published = new Published(ordinal, List.of());
            return;
        }
        boolean more = false;
        for (Pair<Integer, Boolean> dmg : instances(game, combat)) {
            if (!known.add(dmg) || !Boolean.TRUE.equals(dmg.getRight()) || dmg.getLeft() <= 0) {
                continue;
            }
            Pair<Card, GameEntity> lki = game.getDamageLKI(dmg);
            if (lki == null || lki.getLeft() == null || lki.getRight() == null) {
                continue;
            }
            Card source = lki.getLeft();
            Card attacker = combat.getAttackers().stream().filter(a -> a.getId() == source.getId()).findFirst().orElse(null);
            Entity defender = attacker == null ? null : Entity.of(combat.getDefenderByAttacker(attacker));
            hits.add(new Hit(source.getId(), Entity.of(lki.getRight()), defender, dmg.getLeft()));
            more = true;
        }
        if (more) {
            published = new Published(ordinal, List.copyOf(hits));
        }
    }

    /** The facts as a session snapshot keeps them (the game is parked: called between events). */
    synchronized Saved save() {
        return new Saved(key, ordinal, List.copyOf(hits));
    }

    /** Back to a snapshot's facts in the game just restored: every instance there now is known (its hits are already in
     *  the saved list, or it came before the combat), so only what happens from here is taken. */
    synchronized void restore(Saved saved, Game game) {
        key = saved.key();
        ordinal = saved.ordinal();
        hits.clear();
        hits.addAll(saved.hits());
        known.clear();
        Combat combat = game.getCombat();
        if (combat != null) {
            known.addAll(instances(game, combat));
        }
        published = key.isEmpty() ? Published.NONE : new Published(ordinal, List.copyOf(hits));
    }

    /** Every damage instance this turn Forge holds where a combat's could be: on players, on what is on the battlefield,
     *  and on the attackers' damage histories (which a source's last-known copies share). */
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
