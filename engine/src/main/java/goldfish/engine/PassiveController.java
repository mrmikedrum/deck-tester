package goldfish.engine;

import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.LobbyPlayer;

import java.util.List;

/** A goldfish opponent: keeps seven, plays a land on each of its turns, and never does anything else. */
public class PassiveController extends PlayerControllerAi {
    public PassiveController(Game game, Player player, LobbyPlayer lobbyPlayer) {
        super(game, player, lobbyPlayer);
    }

    @Override
    public boolean mulliganKeepHand(Player firstPlayer, int cardsToReturn) {
        return true;
    }

    @Override
    public void declareAttackers(Player attacker, Combat combat) { }

    @Override
    public void declareBlockers(Player defender, Combat combat) { }

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
