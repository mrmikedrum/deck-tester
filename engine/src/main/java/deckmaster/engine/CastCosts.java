package deckmaster.engine;

import forge.card.mana.ManaCost;
import forge.game.card.Card;
import forge.game.cost.CostAdjustment;
import forge.game.keyword.Keyword;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Mana quotes for the main spell before casting choices, computed on the game thread at priority. */
final class CastCosts {
    static Map<Integer, Map<String, Object>> atPriority(Player player) {
        Map<Integer, Map<String, Object>> costs = new LinkedHashMap<>();
        for (Card card : player.getCardsIn(ZoneType.Hand, ZoneType.Command)) {
            if (card.isFaceDown() || card.isSplitCard() || (card.isInZone(ZoneType.Command) && !card.isCommander())) {
                continue;
            }
            SpellAbility spell = card.getSpellAbilities().stream()
                    .filter(sa -> sa.isSpell() && sa.isBasicSpell()).findFirst().orElse(null);
            ManaCost printed = card.getManaCost();
            if (spell == null || spell.getPayCosts() == null
                    || printed == null || printed.isNoCost()) {
                continue;
            }
            Map<String, Object> cost = of(spell, player, printed);
            if (!cost.isEmpty()) {
                costs.put(card.getId(), cost);
            }
        }
        return costs;
    }

    private static Map<String, Object> of(SpellAbility main, Player player, ManaCost printed) {
        Card card = main.getHostCard();
        List<String> payment = new ArrayList<>();
        if (card.hasKeyword(Keyword.CONVOKE) || main.hasParam("TapCreaturesForMana")) {
            payment.add("Convoke");
        }
        if (card.hasKeyword(Keyword.IMPROVISE)) {
            payment.add("Improvise");
        }
        if (card.hasKeyword(Keyword.DELVE)) {
            payment.add("Delve");
        }
        if (card.hasKeyword(Keyword.ASSIST)) {
            payment.add("Assist");
        }
        if (main.isOffering() || main.isEmerge() || main.getPayCosts().getMaxWaterbend() != null) {
            return Map.of();
        }
        if (!payment.isEmpty()) {
            return Map.of("reducibleBy", payment);
        }
        if (main.costHasManaX() || main.hasParam("Announce")) {
            return Map.of();
        }

        SpellAbility spell = main.copy(player);
        // Forge's mana simulation uses the current zone as castFrom before applying commander tax and zone modifiers.
        var previous = card.getCastFrom();
        card.setCastFrom(card.getLastKnownZone());
        try {
            var raised = CostAdjustment.adjust(spell.getPayCosts(), spell, false);
            if (raised.getMaxWaterbend() != null) {
                return Map.of();
            }
            var manaPart = raised.getCostMana();
            var due = new ManaCostBeingPaid(manaPart == null ? ManaCost.ZERO : manaPart.getManaCostFor(spell));
            if (!CostAdjustment.adjust(due, spell, player, null, true, false)) {
                return Map.of();
            }
            ManaCost adjusted = due.toManaCost();
            String mana = adjusted.getShortString();
            if (mana.equals(new ManaCostBeingPaid(printed).toManaCost().getShortString())) {
                return Map.of();
            }
            int change = Integer.compare(adjusted.getCMC(), printed.getCMC());
            return Map.of("mana", mana, "change", change < 0 ? "reduced" : change > 0 ? "increased" : "changed");
        } finally {
            card.setCastFrom(previous);
        }
    }
}
