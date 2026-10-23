package goldfish.engine;

import forge.LobbyPlayer;
import forge.ai.AiCardMemory;
import forge.ai.ComputerUtil;
import forge.ai.ComputerUtilCost;
import forge.ai.ComputerUtilMana;
import forge.ai.PlayerControllerAi;
import forge.card.ColorSet;
import forge.card.ICardFace;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.ability.ApiType;
import forge.game.ability.effects.CharmEffect;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.cost.CostPayment;
import forge.game.GameActionUtil;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.player.DelayedReveal;
import forge.game.player.Player;
import forge.game.player.PlayerActionConfirmMode;
import forge.game.player.PlayerController.BinaryChoiceType;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.OptionalCostValue;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.ZoneType;
import forge.util.collect.FCollectionView;
import org.apache.commons.lang3.tuple.ImmutablePair;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * The agent's seat in manual mode: every decision overridden here with more than one legal answer goes to
 * the agent through the session's channel. A few are still Forge's AI's, recorded as such; anything not
 * overridden falls through to the AI unrecorded. docs/architecture.md keeps the list.
 */
public class ManualController extends PlayerControllerAi {
    private static final List<String> YES_NO = List.of("yes", "no");

    private final Session session;

    public ManualController(Game game, Player player, LobbyPlayer lobbyPlayer, Session session) {
        super(game, player, lobbyPlayer);
        this.session = session;
    }

    // ---- asking ----

    private List<Integer> ask(String kind, String prompt, List<String> options, int min, int max) {
        return ask(kind, prompt, options, null, min, max, false);
    }

    /** Ask the agent, unless only one answer is legal. Repeat allows the same option more than once. */
    private List<Integer> ask(String kind, String prompt, List<String> options, List<String> details, int min, int max, boolean repeat) {
        boolean ordered = kind.equals("order");
        if (max == 0) {
            return List.of();
        }
        if (options.size() == 1 && min >= 1 && !repeat) {
            session.recorder.decision(kind, prompt, options, List.of(1), "forced");
            return List.of(1);
        }
        if (!ordered && !repeat && min >= options.size()) {
            List<Integer> all = new ArrayList<>();
            for (int i = 1; i <= options.size(); i++) {
                all.add(i);
            }
            session.recorder.decision(kind, prompt, options, all, "forced");
            return all;
        }
        Decision decision = new Decision(kind, session.turnLabel(), prompt, options, details, min,
                repeat ? max : Math.min(max, options.size()), repeat);
        List<Integer> answer = session.channel.ask(decision);
        session.recorder.decision(kind, prompt, options, answer, "agent");
        return answer;
    }

    private int askNumber(String prompt, int min, int max) {
        if (min >= max) {
            return min;
        }
        Decision decision = new Decision("number", session.turnLabel(), prompt, List.of(), null, min, max, false);
        int value = session.channel.ask(decision).get(0);
        session.recorder.decision("number", prompt, List.of(), List.of(value), "agent");
        return value;
    }

    private boolean askYesNo(String prompt) {
        return ask("confirm", prompt, YES_NO, 1, 1).get(0) == 1;
    }

    /** Ask for some of the items; sorted by label so duplicates sit together. Cards carry their text as detail. */
    <T> List<T> choose(String kind, String prompt, Iterable<T> items, Function<T, String> label, int min, int max) {
        List<T> list = new ArrayList<>();
        items.forEach(list::add);
        list.sort(Comparator.comparing(label));
        List<String> options = new ArrayList<>();
        list.forEach(item -> options.add(label.apply(item)));
        List<String> details = null;
        if (list.stream().anyMatch(item -> item instanceof Card)) {
            details = new ArrayList<>();
            for (T item : list) {
                details.add(item instanceof Card card ? Labels.detail(card) : options.get(details.size()));
            }
        }
        List<T> chosen = new ArrayList<>();
        for (int pick : ask(kind, prompt, options, details, Math.min(min, list.size()), Math.min(max, list.size()), false)) {
            chosen.add(list.get(pick - 1));
        }
        return chosen;
    }

    void recordAi(String kind, String prompt, List<String> answer) {
        session.recorder.ai(kind, prompt, answer);
    }

    private String cardLabel(Card card) {
        return Labels.card(card, getPlayer());
    }

    private String source(SpellAbility sa) {
        return sa == null || sa.getHostCard() == null ? "" : " (" + sa.getHostCard().getName() + ")";
    }

    private static String clean(String text) {
        return text == null ? "" : text.replaceAll("\\s+", " ").trim();
    }

    // ---- priority, casting, targets ----

    /** Abilities the agent could use now and can pay for, mana abilities excluded (payment is automatic). */
    List<SpellAbility> playable() {
        Player me = getPlayer();
        List<SpellAbility> result = new ArrayList<>();
        for (Card card : me.getCardsIn(ZoneType.Hand, ZoneType.Battlefield, ZoneType.Command, ZoneType.Graveyard, ZoneType.Exile)) {
            for (SpellAbility sa : card.getAllPossibleAbilities(me, true)) {
                if (!sa.isManaAbility() && targetable(sa) && (sa.isLandAbility() || ComputerUtilCost.canPayCost(sa, me, false))) {
                    result.add(sa);
                }
            }
        }
        return result;
    }

    /** False when some part of the ability needs more targets than exist; casting it would fail. */
    private static boolean targetable(SpellAbility sa) {
        for (SpellAbility part = sa; part != null; part = part.getSubAbility()) {
            if (part.usesTargeting() && part.getMinTargets() > 0
                    && part.getTargetRestrictions().getAllCandidates(part).size() < part.getMinTargets()) {
                return false;
            }
        }
        return true;
    }

    /** The largest X the player can pay for right now. */
    private int maxX(SpellAbility sa) {
        for (int x = ComputerUtilMana.getAvailableManaEstimate(getPlayer(), false); x > 0; x--) {
            sa.setXManaCostPaid(x);
            if (ComputerUtilCost.canPayCost(sa, getPlayer(), false)) {
                return x;
            }
        }
        return 0;
    }

    private boolean isStop() {
        Game game = getGame();
        if (!game.getStack().isEmpty() || session.stopsAll) {
            return true;
        }
        return game.getPhaseHandler().isPlayerTurn(getPlayer()) && game.getPhaseHandler().getPhase().isMain();
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        while (true) {
            List<SpellAbility> playable = playable();
            if (playable.isEmpty() || !isStop()) {
                return null;
            }
            List<String> options = new ArrayList<>();
            List<String> details = new ArrayList<>();
            options.add("pass");
            details.add("pass priority");
            playable.forEach(sa -> {
                options.add(Labels.ability(sa));
                details.add(Labels.detail(sa));
            });
            int pick;
            try {
                pick = ask("play", "", options, details, 1, 1, false).get(0);
            } catch (Channel.Interrupt interrupt) {
                if (interrupt.restored) {
                    continue; // state was restored under us: ask again from the restored state
                }
                throw interrupt;
            }
            return pick == 1 ? null : List.of(playable.get(pick - 2));
        }
    }

    @Override
    public boolean playChosenSpellAbility(SpellAbility sa) {
        String label = Labels.ability(sa);
        if (sa.isLandAbility()) {
            if (sa.canPlay()) {
                sa.resolve();
            }
            return true;
        }
        Integer x = null;
        if (sa.costHasManaX()) {
            x = askNumber("X for " + label, 0, maxX(sa));
            sa.setXManaCostPaid(x);
        }
        Card host = sa.getHostCard();
        ZoneType origin = host.getZone() == null ? null : host.getZone().getZoneType();
        boolean played;
        try {
            played = cast(sa);
        } catch (Channel.Interrupt interrupt) {
            throw interrupt;
        } catch (RuntimeException forgeError) {
            // Forge's AI cost payment can throw on costs it misjudged as payable; treat it as a failed cast.
            forgeError.printStackTrace();
            played = false;
        }
        if (!played && sa.isSpell() && origin != null) {
            // Forge's AI cast path leaves a failed spell's card in the stack zone; put it back where it was.
            Card stuck = getGame().getCardState(host);
            if (stuck != null && stuck.isInZone(ZoneType.Stack)) {
                getGame().getAction().moveTo(origin, stuck, null, null);
            }
            sa.setSkip(false);
        }
        session.recorder.played(sa, label, x, played);
        return played;
    }

    /**
     * Forge's AI cast sequence (ComputerUtil.handlePlayingSpellAbility) with the agent choosing modes,
     * targets, and the permanents a cost taps or sacrifices. Splicing onto arcane isn't supported.
     */
    private boolean cast(SpellAbility sa) {
        Game game = getGame();
        Card source = sa.getHostCard();
        source.setSplitStateToPlayAbility(sa);
        if (sa.isSpell() && !source.isCopiedSpell()) {
            sa.setHostCard(game.getAction().moveToStack(source, sa));
        }
        if (!sa.isCopied()) {
            sa.resetPaidHash();
            sa.setPaidLife(0);
        }
        sa = GameActionUtil.addExtraKeywordCost(sa);
        if (sa.getApi() == ApiType.Charm && !CharmEffect.makeChoices(sa)) {
            return false;
        }
        chooseTargets(sa);
        if (!sa.isTargetNumberValid()) {
            return false;
        }
        List<Card> sources = sa.getPayCosts().hasManaCost() ? manaSources() : List.of();
        List<Card> held = new ArrayList<>();
        String by = "ai";
        if (askForMana(sources)) {
            String prompt = "sources to pay " + sa.getPayCosts().getTotalMana() + " for " + source.getName() + "; none = automatic";
            List<Card> chosen = choose("pay", prompt, sources, card -> cardLabel(card) + " (" + produces(card) + ")", 0, sources.size());
            if (!chosen.isEmpty()) {
                by = "agent";
                for (Card card : sources) {
                    if (!chosen.contains(card)) {
                        // Forge's AI leaves sources it holds for the next spell alone while paying.
                        AiCardMemory.rememberCard(getPlayer(), card, AiCardMemory.MemorySet.HELD_MANA_SOURCES_FOR_NEXT_SPELL);
                        held.add(card);
                    }
                }
            }
        }
        boolean paid;
        game.getStack().freezeStack(sa);
        try {
            paid = new CostPayment(sa.getPayCosts(), sa).payComputerCosts(new ManualCostDecision(this, sa));
        } finally {
            held.forEach(card -> AiCardMemory.forgetCard(getPlayer(), card, AiCardMemory.MemorySet.HELD_MANA_SOURCES_FOR_NEXT_SPELL));
        }
        List<String> tapped = new ArrayList<>();
        for (Card card : sources) {
            Card now = game.getCardState(card);
            if (now != null && now.isTapped()) {
                tapped.add(now.getName());
            }
        }
        session.recorder.paid(source.getName(), tapped, by);
        if (paid) {
            game.getStack().addAndUnfreeze(sa);
            return true;
        }
        game.getStack().clearFrozen();
        return false;
    }

    /** Permanents of the agent's that could produce mana right now. */
    private List<Card> manaSources() {
        List<Card> sources = new ArrayList<>();
        for (Card card : getPlayer().getCardsIn(ZoneType.Battlefield)) {
            for (SpellAbility ability : card.getManaAbilities()) {
                ability.setActivatingPlayer(getPlayer());
                if (ability.canPlay()) {
                    sources.add(card);
                    break;
                }
            }
        }
        return sources;
    }

    /** Whether choosing sources could matter: always, or when a creature (which could attack or crew instead) can pay. */
    private boolean askForMana(List<Card> sources) {
        return sources.size() > 1 && switch (session.manaChoice) {
            case AUTO -> false;
            case ALWAYS -> true;
            case CREATURES -> sources.stream().anyMatch(Card::isCreature);
        };
    }

    private static String produces(Card card) {
        Set<String> produced = new LinkedHashSet<>();
        for (SpellAbility ability : card.getManaAbilities()) {
            String mana = ability.getManaPart() == null ? null : ability.getManaPart().getOrigProduced();
            if (mana != null && !mana.isEmpty()) {
                produced.add(mana.replace("Combo ", "").replace(" ", ""));
            }
        }
        return String.join("/", produced);
    }

    /** Targets for every part of the ability that targets, asked part by part. */
    void chooseTargets(SpellAbility sa) {
        for (SpellAbility part = sa; part != null; part = part.getSubAbility()) {
            if (!part.usesTargeting() || part.isTargetNumberValid() && !part.getTargets().isEmpty()) {
                continue;
            }
            List<GameEntity> candidates = part.getTargetRestrictions().getAllCandidates(part);
            if (candidates.isEmpty()) {
                continue;
            }
            String prompt = "target for " + Labels.text(part.toString(), part.getHostCard().getName());
            for (GameEntity target : choose("targets", prompt, candidates, e -> Labels.entity(e, getPlayer()),
                    part.getMinTargets(), part.getMaxTargets())) {
                part.getTargets().add(target);
            }
        }
    }

    // ---- choices still left to Forge's AI, recorded so the game record says who decided ----

    @Override
    public byte chooseColor(String message, SpellAbility sa, ColorSet colors) {
        byte color = super.chooseColor(message, sa, colors);
        session.recorder.ai("color", clean(message) + source(sa), List.of(ColorSet.fromMask(color).toString()));
        return color;
    }

    @Override
    public ColorSet chooseColors(String message, SpellAbility sa, int min, int max, ColorSet options) {
        ColorSet colors = super.chooseColors(message, sa, min, max, options);
        session.recorder.ai("color", clean(message) + source(sa), List.of(String.valueOf(colors)));
        return colors;
    }

    @Override
    public String chooseSomeType(String kindOfType, SpellAbility sa, Collection<String> validTypes, boolean isOptional) {
        String type = super.chooseSomeType(kindOfType, sa, validTypes, isOptional);
        session.recorder.ai("type", kindOfType + source(sa), List.of(String.valueOf(type)));
        return type;
    }

    @Override
    public String chooseCardName(SpellAbility sa, Predicate<ICardFace> cpp, String valid, String message) {
        String name = super.chooseCardName(sa, cpp, valid, message);
        session.recorder.ai("name", clean(message) + source(sa), List.of(String.valueOf(name)));
        return name;
    }

    @Override
    public String chooseCardName(SpellAbility sa, List<ICardFace> faces, String message) {
        String name = super.chooseCardName(sa, faces, message);
        session.recorder.ai("name", clean(message) + source(sa), List.of(String.valueOf(name)));
        return name;
    }

    @Override
    public boolean chooseBinary(SpellAbility sa, String question, BinaryChoiceType kindOfChoice, Boolean defaultVal) {
        boolean choice = super.chooseBinary(sa, question, kindOfChoice, defaultVal);
        session.recorder.ai("binary", clean(question) + source(sa), List.of(String.valueOf(choice)));
        return choice;
    }

    @Override
    public CardCollectionView orderMoveToZoneList(CardCollectionView cards, ZoneType destinationZone, SpellAbility source) {
        CardCollectionView ordered = super.orderMoveToZoneList(cards, destinationZone, source);
        if (ordered.size() > 1) {
            List<String> names = new ArrayList<>();
            ordered.forEach(card -> names.add(card.getName()));
            session.recorder.ai("order", "cards to " + destinationZone.name().toLowerCase() + source(source), names);
        }
        return ordered;
    }

    @Override
    public boolean chooseTargetsFor(SpellAbility currentAbility) {
        chooseTargets(currentAbility);
        return currentAbility.isTargetNumberValid();
    }

    // ---- triggers ----

    private boolean prepare(SpellAbility sa) {
        if (sa.getApi() == ApiType.Charm && !CharmEffect.makeChoices(sa)) {
            return false;
        }
        chooseTargets(sa);
        return sa.isTargetNumberValid();
    }

    @Override
    public void orderAndPlaySimultaneousSa(List<SpellAbility> abilities) {
        List<SpellAbility> ordered = abilities;
        if (abilities.size() > 1) {
            List<String> options = new ArrayList<>();
            abilities.forEach(sa -> options.add(Labels.ability(sa)));
            ordered = new ArrayList<>();
            for (int pick : ask("order", "triggers onto the stack, first in resolves last", options, options.size(), options.size())) {
                ordered.add(abilities.get(pick - 1));
            }
        }
        for (SpellAbility sa : ordered) {
            if (sa.isTrigger() && !sa.isCopied()) {
                if (prepare(sa)) {
                    ComputerUtil.playStack(sa, getPlayer(), getGame());
                }
            } else {
                super.orderAndPlaySimultaneousSa(List.of(sa));
            }
        }
    }

    @Override
    public boolean playTrigger(Card host, WrappedAbility wrapperAbility, boolean isMandatory) {
        return prepare(wrapperAbility)
                && ComputerUtil.playNoStack(wrapperAbility.getActivatingPlayer(), wrapperAbility, getGame(), true);
    }

    @Override
    public boolean confirmTrigger(WrappedAbility wrapper) {
        return wrapper.isMandatory() || askYesNo("use " + Labels.ability(wrapper));
    }

    // ---- choices inside effects ----

    @Override
    public List<AbilitySub> chooseModeForAbility(SpellAbility sa, List<AbilitySub> possible, int min, int num, boolean allowRepeat) {
        List<String> options = new ArrayList<>();
        List<String> details = new ArrayList<>();
        possible.forEach(mode -> {
            options.add(Labels.text(mode.getDescription(), sa.getHostCard().getName()));
            details.add(clean(mode.getDescription()));
        });
        String prompt = "modes for " + sa.getHostCard().getName() + (allowRepeat ? ", a mode may repeat" : "");
        List<AbilitySub> chosen = new ArrayList<>();
        for (int pick : ask("mode", prompt, options, details, min, num, allowRepeat)) {
            chosen.add(possible.get(pick - 1));
        }
        return chosen;
    }

    @Override
    public List<OptionalCostValue> chooseOptionalCosts(SpellAbility chosen, List<OptionalCostValue> optionalCostValues) {
        return choose("choose", "optional costs for " + chosen.getHostCard().getName(), optionalCostValues,
                v -> clean(v.toString()), 0, optionalCostValues.size());
    }

    @Override
    public Integer announceRequirements(SpellAbility ability, int min, int max, String announce) {
        return askNumber(announce + source(ability), min, max);
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, int min, int max) {
        return askNumber(clean(title) + source(sa), min, max);
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, int min, int max, Map<String, Object> params) {
        return chooseNumber(sa, title, min, max);
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, List<Integer> values, Player relatedPlayer) {
        return choose("choose", clean(title) + source(sa), values, String::valueOf, 1, 1).get(0);
    }

    @Override
    public boolean confirmAction(SpellAbility sa, PlayerActionConfirmMode mode, String message, List<String> options,
                                 Card cardToShow, Map<String, Object> params) {
        return askYesNo(clean(message) + source(sa));
    }

    @Override
    public CardCollectionView chooseCardsForEffect(CardCollectionView sourceList, SpellAbility sa, String title, int min,
                                                   int max, boolean isOptional, Map<String, Object> params) {
        return new CardCollection(choose("choose", clean(title) + source(sa), sourceList, this::cardLabel, isOptional ? 0 : min, max));
    }

    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(FCollectionView<T> optionList, DelayedReveal delayedReveal,
                                                                SpellAbility sa, String title, boolean isOptional,
                                                                Player relatedPlayer, Map<String, Object> params) {
        if (delayedReveal != null) {
            session.recorder.look(delayedReveal.getCards(), "revealed" + source(sa));
        }
        List<T> chosen = choose("choose", clean(title) + source(sa), optionList, e -> Labels.entity(e, getPlayer()), isOptional ? 0 : 1, 1);
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public <T extends GameEntity> List<T> chooseEntitiesForEffect(FCollectionView<T> optionList, int min, int max,
                                                                  DelayedReveal delayedReveal, SpellAbility sa, String title,
                                                                  Player relatedPlayer, Map<String, Object> params) {
        if (delayedReveal != null) {
            session.recorder.look(delayedReveal.getCards(), "revealed" + source(sa));
        }
        return choose("choose", clean(title) + source(sa), optionList, e -> Labels.entity(e, getPlayer()), min, max);
    }

    @Override
    public Card chooseSingleCardForZoneChange(ZoneType destination, List<ZoneType> origin, SpellAbility sa, CardCollection fetchList,
                                              DelayedReveal delayedReveal, String selectPrompt, boolean isOptional, Player decider) {
        if (origin.contains(ZoneType.Library)) {
            session.recorder.look(fetchList, "searched" + source(sa));
        }
        List<Card> chosen = choose("choose", clean(selectPrompt) + source(sa), fetchList, this::cardLabel, isOptional ? 0 : 1, 1);
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public CardCollectionView choosePermanentsToSacrifice(SpellAbility sa, int min, int max, CardCollectionView validTargets, String message) {
        return new CardCollection(choose("choose", "sacrifice" + source(sa), validTargets, this::cardLabel, min, max));
    }

    @Override
    public CardCollection chooseCardsToDiscardFrom(Player playerDiscard, SpellAbility sa, CardCollection validCards,
                                                       int min, int max, CardCollectionView visibleToChooser) {
        return new CardCollection(choose("choose", "discard" + source(sa), validCards, this::cardLabel, min, max));
    }

    @Override
    public CardCollectionView chooseCardsToDiscardToMaximumHandSize(int numDiscard) {
        return new CardCollection(choose("choose", "discard to hand size", getPlayer().getCardsIn(ZoneType.Hand),
                this::cardLabel, numDiscard, numDiscard));
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(CardCollection topN) {
        session.recorder.look(topN, "scry");
        List<Card> bottom = choose("choose", "scry " + topN.size() + ": cards to put on the bottom", topN, this::cardLabel, 0, topN.size());
        CardCollection top = new CardCollection(topN);
        top.removeAll(bottom);
        return ImmutablePair.of(top, new CardCollection(bottom));
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(CardCollection topN) {
        session.recorder.look(topN, "surveil");
        List<Card> graveyard = choose("choose", "surveil " + topN.size() + ": cards to put in the graveyard", topN, this::cardLabel, 0, topN.size());
        CardCollection top = new CardCollection(topN);
        top.removeAll(graveyard);
        return ImmutablePair.of(top, new CardCollection(graveyard));
    }

    // ---- mulligan and combat ----

    @Override
    public boolean mulliganKeepHand(Player firstPlayer, int cardsToReturn) {
        String bottom = cardsToReturn > 0 ? " (then bottom " + cardsToReturn + ")" : "";
        return ask("mulligan", "keep this hand" + bottom, List.of("keep", "mulligan"), 1, 1).get(0) == 1;
    }

    @Override
    public CardCollectionView tuckCardsViaMulligan(CardCollectionView hand, int cardsToReturn) {
        return new CardCollection(choose("choose", "put " + cardsToReturn + " on the bottom", hand, this::cardLabel, cardsToReturn, cardsToReturn));
    }

    @Override
    public void declareAttackers(Player attacker, Combat combat) {
        List<Card> creatures = new ArrayList<>();
        List<GameEntity> defenders = new ArrayList<>();
        List<String> options = new ArrayList<>();
        for (Card creature : attacker.getCreaturesInPlay()) {
            for (GameEntity defender : combat.getDefenders()) {
                if (CombatUtil.canAttack(creature, defender)) {
                    creatures.add(creature);
                    defenders.add(defender);
                    options.add(cardLabel(creature) + " -> " + Labels.entity(defender, getPlayer()));
                }
            }
        }
        if (options.isEmpty()) {
            return;
        }
        List<Card> declared = new ArrayList<>();
        for (int pick : ask("attack", "attackers, at most one defender each", options, 0, options.size())) {
            Card creature = creatures.get(pick - 1);
            if (!declared.contains(creature)) {
                declared.add(creature);
                combat.addAttacker(creature, defenders.get(pick - 1));
            }
        }
    }
}
