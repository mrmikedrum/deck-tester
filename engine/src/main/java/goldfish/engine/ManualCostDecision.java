package goldfish.engine;

import forge.ai.AiCostDecision;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardLists;
import forge.game.card.CardPredicates;
import forge.game.cost.CostSacrifice;
import forge.game.cost.CostTapType;
import forge.game.cost.PaymentDecision;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.List;

/**
 * Cost payment for the agent's casts: which permanents to tap or sacrifice is the agent's choice, the
 * rest (mana, life, the source itself) is paid as Forge's AI would. Unusual variants of these costs,
 * such as tapping creatures with total power N, also stay with the AI.
 */
final class ManualCostDecision extends AiCostDecision {
    private final ManualController controller;

    ManualCostDecision(ManualController controller, SpellAbility sa) {
        super(controller.getPlayer(), sa, false);
        this.controller = controller;
    }

    @Override
    public PaymentDecision visit(CostTapType cost) {
        String type = cost.getType();
        if (type.equals("OriginalHost") || type.contains("sharesCreatureTypeWith") || type.contains("withTotalPowerGE")
                || cost.getAmount().equals("Any")) {
            return super.visit(cost);
        }
        CardCollection valid = CardLists.getValidCards(player.getCardsIn(ZoneType.Battlefield), type.split(";"), player, source, ability);
        valid = CardLists.filter(valid, ability.isCrew() ? CardPredicates.CAN_CREW : CardPredicates.CAN_TAP);
        if (!cost.canTapSource) {
            valid.remove(source);
        }
        return pick(valid, cost.getAbilityAmount(ability), "tap for " + source.getName());
    }

    @Override
    public PaymentDecision visit(CostSacrifice cost) {
        String type = cost.getType();
        if (cost.payCostFromSource() || type.equals("OriginalHost") || type.contains("+WithDifferentNames")
                || cost.getAmount().equals("All")) {
            return super.visit(cost);
        }
        CardCollectionView valid = CardLists.filter(player.getCardsIn(ZoneType.Battlefield), CardPredicates.canBeSacrificedBy(ability, isEffect()));
        valid = CardLists.getValidCards(valid, type.split(";"), player, source, ability);
        return pick(valid, cost.getAbilityAmount(ability), "sacrifice for " + source.getName());
    }

    private PaymentDecision pick(CardCollectionView valid, int count, String prompt) {
        if (count == 0) {
            return PaymentDecision.number(0);
        }
        if (valid.size() < count) {
            return null;
        }
        List<Card> chosen = controller.choose("choose", prompt, valid, card -> Labels.card(card, player), count, count);
        return PaymentDecision.card(chosen);
    }
}
