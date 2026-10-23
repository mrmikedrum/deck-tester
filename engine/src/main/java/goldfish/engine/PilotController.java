package goldfish.engine;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import org.apache.commons.lang3.tuple.ImmutablePair;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * The deck's seat. Spike scope: counts the decisions it sees, and when an agent is attached it routes
 * mulligans and priority to the agent, parking the game thread until the agent answers.
 */
public class PilotController extends PlayerControllerAi {
    public final Map<String, AtomicInteger> decisions = new ConcurrentHashMap<>();
    public volatile Agent agent;
    /** Called on the game thread at each of the pilot's priority stops, before deciding. */
    public volatile Consumer<PilotController> onPriority;

    public PilotController(Game game, Player player, LobbyPlayer lobbyPlayer) {
        super(game, player, lobbyPlayer);
    }

    private void count(String kind) {
        decisions.computeIfAbsent(kind, k -> new AtomicInteger()).incrementAndGet();
    }

    @Override
    public boolean mulliganKeepHand(Player firstPlayer, int cardsToReturn) {
        count("mulligan");
        Agent current = agent;
        if (current == null || current.isReleased()) {
            return super.mulliganKeepHand(firstPlayer, cardsToReturn);
        }
        List<String> hand = new ArrayList<>();
        for (Card card : getPlayer().getCardsIn(ZoneType.Hand)) {
            hand.add(card.getName());
        }
        return current.ask(new Agent.Decision("mulligan", "Keep " + hand + "?", List.of("keep", "mulligan")))
                .equals("keep");
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        count("play");
        if (onPriority != null) {
            onPriority.accept(this);
        }
        Agent current = agent;
        if (current == null || current.isReleased()) {
            return super.chooseSpellAbilityToPlay();
        }
        List<SpellAbility> playable = new ArrayList<>();
        Player me = getPlayer();
        for (Card card : me.getCardsIn(ZoneType.Hand, ZoneType.Battlefield, ZoneType.Command)) {
            playable.addAll(card.getAllPossibleAbilities(me, true));
        }
        List<String> options = new ArrayList<>();
        options.add("pass");
        for (SpellAbility ability : playable) {
            options.add(ability.getHostCard().getName() + ": " + ability);
        }
        String answer = current.ask(new Agent.Decision("play", getGame().getPhaseHandler().getPlayerTurn().getName() + " " + getGame().getPhaseHandler().getPhase(), options));
        int index = options.indexOf(answer);
        return index <= 0 ? null : List.of(playable.get(index - 1));
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(CardCollection topN) {
        count("scry");
        return super.arrangeForScry(topN);
    }
}
