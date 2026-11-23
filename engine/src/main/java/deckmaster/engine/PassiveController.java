package deckmaster.engine;

import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.LobbyPlayer;

import java.util.List;

/**
 * A goldfish opponent: keeps seven, plays a land on each of its turns, and never does anything else. As another
 * player in a table seat's fork it also blocks as Forge's AI would, so a line that attacks meets the blockers
 * that are there; it still casts nothing and attacks only as the rules force it to (a fork assumes the others pass).
 */
public class PassiveController extends PlayerControllerAi {
    private final boolean blocks;

    public PassiveController(Game game, Player player, LobbyPlayer lobbyPlayer) {
        this(game, player, lobbyPlayer, false);
    }

    public PassiveController(Game game, Player player, LobbyPlayer lobbyPlayer, boolean blocks) {
        super(game, player, lobbyPlayer);
        this.blocks = blocks;
    }

    @Override
    public boolean mulliganKeepHand(Player firstPlayer, int cardsToReturn) {
        return true;
    }

    /**
     * No attack, unless the rules force one (goaded creatures, ones that attack each combat if able): then the
     * attack that breaks the fewest requirements. Forge asks again until an attack is legal, so declaring nothing
     * would never end.
     */
    @Override
    public void declareAttackers(Player attacker, Combat combat) {
        if (!CombatUtil.validateAttackers(combat)) {
            combat.getAttackConstraints().getLegalAttackers().getLeft().forEach(combat::addAttacker);
        }
    }

    @Override
    public void declareBlockers(Player defender, Combat combat) {
        if (blocks) {
            super.declareBlockers(defender, combat);
        }
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        Game game = getGame();
        Player me = getPlayer();
        if (!game.getPhaseHandler().isPlayerTurn(me) || !game.getPhaseHandler().getPhase().isMain()
                || !game.getStack().isEmpty()) {
            return null;
        }
        for (Card card : me.getCardsIn(ZoneType.Hand)) {
            if (card.isLand()) {
                for (SpellAbility ability : card.getAllPossibleAbilities(me, true)) {
                    if (ability.isLandAbility()) {
                        return List.of(ability);
                    }
                }
            }
        }
        return null;
    }
}
