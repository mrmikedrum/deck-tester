package goldfish.engine;

import forge.ai.AiCostDecision;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardLists;
import forge.game.card.CardPredicates;
import forge.game.cost.CostDiscard;
import forge.game.cost.CostExile;
import forge.game.cost.CostPartMana;
import forge.game.cost.CostReturn;
import forge.game.cost.CostSacrifice;
import forge.game.cost.CostTapType;
import forge.game.cost.PaymentDecision;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

/**
 * Cost payment for the agent's casts: which permanents to tap or sacrifice is a decision like any other
 * (the agent's, or Forge's AI's, logged either way); the rest (mana, life, the source itself) is paid as
 * Forge's AI would. Unusual variants of these costs, such as tapping creatures with total power N, stay
 * with the AI unlogged.
 */
final class ManualCostDecision extends AiCostDecision {
    private final ManualController controller;
    /** Mana abilities chosen to pay the mana part, with the colours each makes; empty leaves it to Forge's AI. */
    private final List<SpellAbility> plan;
    private final List<String> planColors;

    ManualCostDecision(ManualController controller, SpellAbility sa, List<SpellAbility> plan, List<String> planColors) {
        super(controller.getPlayer(), sa, false);
        this.controller = controller;
        this.plan = plan;
        this.planColors = planColors;
    }

    /**
     * Just before the mana part is paid (Forge decides every part of a cost before paying any, so this is after
     * the other parts' choices, where Forge's AI taps): activate the chosen abilities, then the pool pays.
     */
    @Override
    public void beforePayingMana(CostPartMana part) {
        // A mana ability that itself costs mana (a Station land's "{G}, {T}: Add {G} for each creature") was
        // paid by another source in Forge's AI's payment, and that source is in the plan too. Activating the
        // free abilities first puts its mana in the pool, where the costly ability's cost is paid from.
        for (boolean costly : new boolean[] {false, true}) {
            for (int i = 0; i < plan.size(); i++) {
                if (plan.get(i).getPayCosts().hasManaCost() == costly) {
                    controller.activate(plan.get(i), planColors.get(i));
                }
            }
        }
    }

    @Override
    public PaymentDecision visit(CostTapType cost) {
        String type = cost.getType();
        if (type.equals("OriginalHost") || type.contains("sharesCreatureTypeWith") || type.contains("withTotalPowerGE")
                || cost.getAmount().equals("Any")) {
            return recorded("tap", super.visit(cost));
        }
        CardCollection valid = CardLists.getValidCards(player.getCardsIn(ZoneType.Battlefield), type.split(";"), player, source, ability);
        valid = CardLists.filter(valid, ability.isCrew() ? CardPredicates.CAN_CREW : CardPredicates.CAN_TAP);
        if (!cost.canTapSource) {
            valid.remove(source);
        }
        return pick(valid, cost.getAbilityAmount(ability), "tap for " + source.getName(), () -> super.visit(cost));
    }

    @Override
    public PaymentDecision visit(CostSacrifice cost) {
        String type = cost.getType();
        if (cost.payCostFromSource()) {
            return super.visit(cost);
        }
        if (type.equals("OriginalHost") || type.contains("+WithDifferentNames") || cost.getAmount().equals("All")) {
            return recorded("sacrifice", super.visit(cost));
        }
        CardCollectionView valid = CardLists.filter(player.getCardsIn(ZoneType.Battlefield), CardPredicates.canBeSacrificedBy(ability, isEffect()));
        valid = CardLists.getValidCards(valid, type.split(";"), player, source, ability);
        return pick(valid, cost.getAbilityAmount(ability), "sacrifice for " + source.getName(), () -> super.visit(cost));
    }

    @Override
    public PaymentDecision visit(CostDiscard cost) {
        return recorded("discard", super.visit(cost));
    }

    @Override
    public PaymentDecision visit(CostExile cost) {
        return cost.payCostFromSource() ? super.visit(cost) : recorded("exile", super.visit(cost));
    }

    @Override
    public PaymentDecision visit(CostReturn cost) {
        return cost.payCostFromSource() ? super.visit(cost) : recorded("return", super.visit(cost));
    }

    /** Record a cost choice Forge's AI made for the agent, unlogged: a fork lets it choose again. */
    private PaymentDecision recorded(String what, PaymentDecision decision) {
        if (decision != null && !decision.cards.isEmpty()) {
            List<String> names = new ArrayList<>();
            decision.cards.forEach(card -> names.add(card.getName()));
            controller.recordAi("cost", what + " for " + source.getName(), names);
        }
        return decision;
    }

    /** The cards for the cost: chosen through the controller, with Forge's AI's choice as the fallback. */
    private PaymentDecision pick(CardCollectionView valid, int count, String prompt, Supplier<PaymentDecision> ai) {
        if (count == 0) {
            return PaymentDecision.number(0);
        }
        if (valid.size() < count) {
            return null;
        }
        List<Card> chosen = controller.choose("choose", prompt, valid, card -> Labels.card(card, player), count, count, () -> {
            PaymentDecision decision = ai.get();
            return decision == null ? List.<Card>of() : decision.cards;
        });
        return chosen.size() < count ? null : PaymentDecision.card(chosen);
    }
}
