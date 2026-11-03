package goldfish.engine;

import forge.LobbyPlayer;
import forge.ai.AiCache;
import forge.ai.AiCardMemory;
import forge.ai.AiCostDecision;
import forge.ai.ComputerUtil;
import forge.ai.ComputerUtilCost;
import forge.ai.ComputerUtilMana;
import forge.ai.PlayerControllerAi;
import forge.card.ColorSet;
import forge.card.ICardFace;
import forge.card.MagicColor;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.ability.ApiType;
import forge.game.ability.effects.CharmEffect;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.cost.CostPayment;
import forge.game.mana.Mana;
import forge.game.GameActionUtil;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.player.DelayedReveal;
import forge.game.player.Player;
import forge.game.player.PlayerActionConfirmMode;
import forge.game.player.PlayerController.BinaryChoiceType;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.OptionalCostValue;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.ZoneType;
import forge.util.collect.FCollection;
import forge.util.collect.FCollectionView;
import org.apache.commons.lang3.tuple.ImmutablePair;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

/**
 * The agent's seat. Every decision overridden here is a Decision with numbered options; it goes to the
 * agent for the kinds the session asks, and to Forge's AI otherwise, but whoever answers, the answer is
 * logged for forks and recorded. Forge's AI weighs its answers on its own random sequence, so a fork that
 * replays the log never needs it to think again. Anything not overridden falls through to the AI unlogged;
 * docs/architecture.md keeps the list.
 */
public class ManualController extends PlayerControllerAi {
    private static final List<String> YES_NO = List.of("yes", "no");

    /** Forge's AI remembers mana sources it means to hold back; what the agent can pay for ignores that. */
    private static final List<AiCardMemory.MemorySet> HELD_MANA = List.of(
            AiCardMemory.MemorySet.HELD_MANA_SOURCES_FOR_MAIN2, AiCardMemory.MemorySet.HELD_MANA_SOURCES_FOR_DECLBLK,
            AiCardMemory.MemorySet.HELD_MANA_SOURCES_FOR_ENEMY_DECLBLK, AiCardMemory.MemorySet.HELD_MANA_SOURCES_FOR_NEXT_SPELL);

    /** GOLDFISH_TRACE in the engine's environment writes each priority and attack to the engine log. */
    private static final boolean TRACE = System.getenv("GOLDFISH_TRACE") != null;

    private final Session session;
    /** True while casting something the agent chose: its targets, modes, X and payment are the agent's too. */
    private boolean casting;
    /** Who answered the last decision, and who chose the play being cast. */
    private String lastBy = "agent";
    private String playedBy = "agent";
    /** Above zero while Forge's AI is answering a decision: choices it asks of the controller meanwhile are its own. */
    private int answering;

    public ManualController(Game game, Player player, LobbyPlayer lobbyPlayer, Session session) {
        super(game, player, lobbyPlayer);
        this.session = session;
        if (session.setup.aiMode() != null) {
            getAi().setUseSimulation(session.setup.aiMode());
        }
    }

    // ---- deciding ----

    /** Whether the agent answers this kind: the session asks it to, or it's casting something it chose. */
    private boolean mine(String kind) {
        return casting || session.asks(kind);
    }

    /**
     * Every decision at this seat passes through here. A fork's script answers first; then a decision with
     * one legal answer is forced; then a preset answer (Forge's AI chose it while weighing the play) is taken;
     * then the agent answers the kinds it asks for; and Forge's AI answers the rest, including what the agent
     * hands over. The answer is logged and recorded whoever gave it.
     */
    private List<Integer> decide(Decision decision, Supplier<List<Integer>> ai, List<Integer> preset) {
        if (!decision.isNumber() && decision.max() == 0) {
            return List.of();
        }
        if (answering > 0) {
            // Forge's AI, answering an outer decision, asks a further one of itself (proliferate chooses its
            // permanents through another choice, say): part of its answer, not a decision of its own.
            return ai.get();
        }
        Session.Entry scripted = session.scripted(decision);
        if (scripted != null) {
            lastBy = scripted.by;
            session.recorder.decision(decision, scripted.answer, scripted.by, scripted.p, null);
            return scripted.answer;
        }
        // A play decision with only "pass" arises after an override emptied the board: the agent is mid-edit,
        // so it stays parked rather than passing on its own.
        List<Integer> answer = decision.kind().equals("play") && decision.options().size() == 1 ? null : forced(decision);
        String by = "forced";
        Double p = null;
        String via = null;
        if (answer == null && preset != null) {
            answer = preset;
            by = "ai";
        }
        if (answer == null && mine(decision.kind())) {
            answer = session.channel.ask(decision);
            by = session.channel.by();
            p = session.channel.confidence();
            if (answer == null) {
                via = by.equals("agent") ? null : by;
            }
        }
        if (answer == null) {
            answering++;
            try {
                answer = SeededRandom.thinking(ai);
            } finally {
                answering--;
            }
            by = "ai";
        }
        lastBy = by;
        session.log(new Session.Entry(decision, answer, by, p));
        session.recorder.decision(decision, answer, by, p, via);
        return answer;
    }

    private List<Integer> decide(Decision decision, Supplier<List<Integer>> ai) {
        return decide(decision, ai, null);
    }

    /**
     * Evaluate what can be paid for as if Forge's AI held no mana back: the agent's options don't depend on
     * what the AI was planning, and a fork, where the AI never planned, lists the same options.
     */
    private <T> T withoutHeldMana(Supplier<T> evaluation) {
        Map<AiCardMemory.MemorySet, List<Card>> held = new java.util.EnumMap<>(AiCardMemory.MemorySet.class);
        for (AiCardMemory.MemorySet set : HELD_MANA) {
            held.put(set, new ArrayList<>(AiCardMemory.getMemorySet(getPlayer(), set)));
            AiCardMemory.clearMemorySet(getPlayer(), set);
        }
        // The AI also caches costs it found unpayable while weighing plays; stale entries would hide options.
        getAi().getCardMemory().clearMemorySet(AiCardMemory.MemorySetMana.UNPAID_COSTS);
        // Forge's AI clears its global evaluation cache only when it chooses a play itself. A game whose plays
        // are chosen by others never does, and the cache keeps every card it has seen, in every game.
        AiCache.clear();
        try {
            return SeededRandom.thinking(evaluation);
        } finally {
            held.forEach((set, cards) -> cards.forEach(card -> AiCardMemory.rememberCard(getPlayer(), card, set)));
        }
    }

    /** The only legal answer, when there is just one; otherwise null. */
    private static List<Integer> forced(Decision decision) {
        if (decision.isNumber()) {
            return decision.min() >= decision.max() ? List.of(decision.min()) : null;
        }
        int count = decision.options().size();
        if (count == 1 && decision.min() >= 1 && !decision.repeat()) {
            return List.of(1);
        }
        if (!decision.kind().equals("order") && !decision.repeat() && decision.min() >= count) {
            List<Integer> all = new ArrayList<>();
            for (int i = 1; i <= count; i++) {
                all.add(i);
            }
            return all;
        }
        return null;
    }

    private List<Integer> ask(String kind, String prompt, List<String> options, List<String> details, int min, int max,
                              boolean repeat, Supplier<List<Integer>> ai) {
        Decision decision = new Decision(kind, session.turnLabel(), prompt, options, details, min,
                repeat ? max : Math.min(max, options.size()), repeat);
        return decide(decision, ai);
    }

    private int askNumber(String prompt, int min, int max, Supplier<Integer> ai) {
        Decision decision = new Decision("number", session.turnLabel(), prompt, List.of(), null, min, max, false);
        return decide(decision, () -> List.of(ai.get())).get(0);
    }

    private boolean askYesNo(String prompt, Supplier<Boolean> ai) {
        return ask("confirm", prompt, YES_NO, null, 1, 1, false, () -> List.of(ai.get() ? 1 : 2)).get(0) == 1;
    }

    /**
     * Some of the items, sorted by label so duplicates sit together; cards carry their text as detail. The
     * fallback is Forge's AI's choice of the same items; preset items were chosen already.
     */
    <T> List<T> choose(String kind, String prompt, Iterable<T> items, Function<T, String> label, int min, int max,
                       Supplier<? extends Iterable<T>> ai, Iterable<T> preset) {
        List<T> list = new ArrayList<>();
        items.forEach(list::add);
        if (list.isEmpty()) {
            return list; // nothing to choose from; with no options the decision would read as a number
        }
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
        Decision decision = new Decision(kind, session.turnLabel(), prompt, options, details,
                Math.min(min, list.size()), Math.min(max, list.size()), false);
        List<Integer> picks = decide(decision, () -> indices(list, ai.get()), preset == null ? null : indices(list, preset));
        List<T> chosen = new ArrayList<>();
        for (int pick : picks) {
            chosen.add(list.get(pick - 1));
        }
        return chosen;
    }

    <T> List<T> choose(String kind, String prompt, Iterable<T> items, Function<T, String> label, int min, int max,
                       Supplier<? extends Iterable<T>> ai) {
        return choose(kind, prompt, items, label, min, max, ai, null);
    }

    /** The 1-based positions of the chosen items in the list; items not in the list are dropped. */
    private static <T> List<Integer> indices(List<T> list, Iterable<T> chosen) {
        List<Integer> out = new ArrayList<>();
        if (chosen != null) {
            for (T item : chosen) {
                int at = list.indexOf(item);
                if (at >= 0) {
                    out.add(at + 1);
                }
            }
        }
        return out;
    }

    /** Record a choice Forge's AI made for the agent's seat that isn't logged for forks. */
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

    private void trace(String what) {
        if (TRACE) {
            System.err.println("[" + session.id + " " + session.turnLabel() + "] " + what);
        }
    }

    // ---- priority, casting, targets ----

    /** Abilities the agent could use now and can pay for, mana abilities excluded (payment is automatic). */
    List<SpellAbility> playable() {
        Player me = getPlayer();
        List<SpellAbility> result = new ArrayList<>();
        for (Card card : me.getCardsIn(ZoneType.Hand, ZoneType.Battlefield, ZoneType.Command, ZoneType.Graveyard, ZoneType.Exile)) {
            for (SpellAbility sa : card.getAllPossibleAbilities(me, true)) {
                if (sa.costHasManaX()) {
                    sa.setXManaCostPaid(null); // Forge's AI leaves the X it weighed on the ability; it isn't chosen yet
                }
                // Mana abilities are paid automatically, except ones whose cost taps another permanent (Springleaf
                // Drum): which creature to tap is a choice with consequences, so they are offered as plays, and the
                // mana they make waits in the pool for the next cost.
                if (sa.isManaAbility() && !tapsAnother(sa)) {
                    continue;
                }
                if (targetable(sa) && (sa.isLandAbility() || ComputerUtilCost.canPayCost(sa, me, false)) && payableX(sa)) {
                    result.add(sa);
                }
            }
        }
        return result;
    }

    /** A cost that taps a permanent other than the source ("Tap an untapped creature you control"). */
    private static boolean tapsAnother(SpellAbility sa) {
        return sa.getPayCosts() != null && sa.getPayCosts().getCostParts().stream()
                .anyMatch(part -> part instanceof forge.game.cost.CostTapType);
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

    /** The smallest X the cost allows ("X can't be 0"). */
    private static int minX(SpellAbility sa) {
        return sa.getPayCosts().getCostMana() == null ? 0 : sa.getPayCosts().getCostMana().getXMin();
    }

    /** False when the cost needs a larger X than can be paid now (an X that can't be 0, with no mana left). */
    private boolean payableX(SpellAbility sa) {
        if (!sa.costHasManaX() || minX(sa) == 0) {
            return true;
        }
        boolean payable = maxX(sa) >= minX(sa);
        sa.setXManaCostPaid(null);
        return payable;
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

    /** Where priority is a decision: the agent's main phases, anything on the stack, or everywhere with stops all. */
    private boolean isStop() {
        Game game = getGame();
        if (!game.getStack().isEmpty() || session.setup.stopsAll()) {
            return true;
        }
        return game.getPhaseHandler().isPlayerTurn(getPlayer()) && game.getPhaseHandler().getPhase().isMain();
    }

    /** The option number of Forge's AI's pick among the listed plays: 0 when it chose something not listed. */
    private static int listed(List<SpellAbility> playable, SpellAbility picked) {
        int at = playable.indexOf(picked);
        if (at < 0) {
            String label = Labels.ability(picked);
            for (int i = 0; i < playable.size(); i++) {
                if (playable.get(i).getHostCard() == picked.getHostCard() && Labels.ability(playable.get(i)).equals(label)) {
                    at = i;
                    break;
                }
            }
        }
        return at < 0 ? 0 : at + 2;
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        boolean reasking = false; // after an override or restore: keep the game parked even with nothing to play
        while (true) {
            if (!isStop()) {
                return null; // outside the agent's stops priority passes, and what is playable isn't even evaluated
            }
            List<SpellAbility> playable = withoutHeldMana(this::playable);
            if (TRACE) {
                List<String> labels = new ArrayList<>();
                playable.forEach(sa -> labels.add(Labels.ability(sa)));
                trace("priority stack=" + getGame().getStack().size() + " stop=" + isStop() + " mana="
                        + ComputerUtilMana.getAvailableManaEstimate(getPlayer(), true) + " playable=" + labels);
            }
            if (playable.isEmpty() && !reasking) {
                return null; // nothing to do: priority passes
            }
            List<String> options = new ArrayList<>();
            List<String> details = new ArrayList<>();
            options.add("pass");
            details.add("pass priority");
            playable.forEach(sa -> {
                options.add(Labels.ability(sa));
                details.add(Labels.detail(sa));
            });
            Decision decision = new Decision("play", session.turnLabel(), "", options, details, 1, 1, false);
            List<SpellAbility> aiPick = new ArrayList<>();
            List<Integer> answer;
            try {
                answer = decide(decision, () -> {
                    List<SpellAbility> picked = super.chooseSpellAbilityToPlay();
                    if (picked != null) {
                        aiPick.addAll(picked);
                    }
                    return List.of(aiPick.isEmpty() ? 1 : listed(playable, aiPick.get(0)));
                });
            } catch (Channel.Interrupt interrupt) {
                if (interrupt.restored) {
                    reasking = true;
                    continue; // state was restored under us: ask again from the restored state
                }
                throw interrupt;
            }
            playedBy = lastBy;
            int pick = answer.get(0);
            if (pick == 0) {
                // Forge's AI chose a play that isn't listed; a fork replaying this has to let it choose again.
                if (aiPick.isEmpty()) {
                    List<SpellAbility> again = SeededRandom.thinking(super::chooseSpellAbilityToPlay);
                    return again == null || again.isEmpty() ? null : again;
                }
                return aiPick;
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
        Card host = sa.getHostCard();
        ZoneType origin = host.getZone() == null ? null : host.getZone().getZoneType();
        Integer x = null;
        boolean played;
        casting = true;
        try {
            if (sa.costHasManaX()) {
                Integer preset = sa.getXManaCostPaid(); // set by Forge's AI while weighing this play, if it chose it
                int max = withoutHeldMana(() -> maxX(sa));
                int min = minX(sa);
                x = askNumber("X for " + label, min, max, () -> preset != null && preset >= min && preset <= max ? preset : max);
                sa.setXManaCostPaid(x);
            }
            played = cast(sa);
        } catch (Channel.Interrupt interrupt) {
            throw interrupt;
        } catch (RuntimeException forgeError) {
            // Forge's AI cost payment can throw on costs it misjudged as payable; treat it as a failed cast.
            forgeError.printStackTrace();
            played = false;
        } finally {
            casting = false;
        }
        if (!played && sa.isSpell() && origin != null) {
            // Forge's AI cast path leaves a failed spell's card in the stack zone; put it back where it was.
            Card stuck = getGame().getCardState(host);
            if (stuck != null && stuck.isInZone(ZoneType.Stack)) {
                getGame().getAction().moveTo(origin, stuck, null, null);
            }
            sa.setSkip(false);
        }
        session.recorder.played(sa, label, x, played, playedBy);
        return played;
    }

    /**
     * Forge's AI cast sequence (ComputerUtil.handlePlayingSpellAbility) with modes, targets, the permanents a
     * cost taps or sacrifices, and the sources that pay as decisions. Splicing onto arcane isn't supported.
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
        // Mana: each way a permanent could make mana now is an option (an ability, and a colour where it
        // chooses one); the answer is the abilities to activate, in order. Chosen ones are activated here and
        // the rest of the cost is paid from the pool with every source held back. When nobody chooses, Forge's
        // AI pays as it likes and the abilities it activated become the logged answer, so a fork pays the same.
        List<SpellAbility> manaAbilities = new ArrayList<>();
        List<Byte> manaColors = new ArrayList<>();
        List<String> options = new ArrayList<>();
        List<Card> sources = new ArrayList<>();
        if (sa.getPayCosts().hasManaCost()) {
            manaOptions(manaAbilities, manaColors, options, sources);
        }
        List<Card> held = new ArrayList<>();
        List<SpellAbility> activated = new ArrayList<>();
        List<String> activatedColors = new ArrayList<>();
        String by = "ai";
        Decision pay = null;
        Session.Entry open = null;
        if (options.size() > 1) {
            pay = new Decision("pay", session.turnLabel(), "mana to pay " + sa.getPayCosts().getTotalMana() + " for "
                    + source.getName() + ", in order; none = automatic", options, null, 0, options.size(), true);
            List<Integer> chosen = null;
            Session.Entry scripted = session.scripted(pay);
            if (scripted != null) {
                chosen = scripted.answer;
                by = scripted.by;
                session.recorder.decision(pay, chosen, by, scripted.p, null);
            } else if (askForMana(sources)) {
                chosen = session.channel.ask(pay);
                if (chosen != null && !chosen.isEmpty()) {
                    by = session.channel.by();
                    session.log(new Session.Entry(pay, chosen, by, session.channel.confidence()));
                    session.recorder.decision(pay, chosen, by, session.channel.confidence(), null);
                }
            }
            if (chosen == null || chosen.isEmpty()) {
                open = new Session.Entry(pay, List.of(), "ai", null);
                session.log(open);
            } else {
                // An ability that makes several colours at once is picked once per colour, in a row. The
                // activations happen when the cost's mana part is paid, after its other parts, as Forge's AI's do.
                for (int i = 0; i < chosen.size(); i++) {
                    SpellAbility ability = manaAbilities.get(chosen.get(i) - 1);
                    List<String> colors = new ArrayList<>();
                    // As many colours as one activation makes: Crystalline Crawler's "add one mana of any colour",
                    // picked twice in a row, is two activations.
                    int makes = Math.max(1, ability.amountOfManaGenerated(false));
                    boolean choosing = manaColors.get(chosen.get(i) - 1) != 0;
                    for (int picks = 0; i < chosen.size() && manaAbilities.get(chosen.get(i) - 1) == ability
                            && (choosing ? picks < makes : picks < 1); picks++) {
                        if (manaColors.get(chosen.get(i) - 1) != 0) {
                            colors.add(MagicColor.toShortString(manaColors.get(chosen.get(i) - 1)));
                        }
                        i++;
                    }
                    i--;
                    activated.add(ability);
                    activatedColors.add(String.join(" ", colors));
                }
                for (Card card : sources) {
                    // Forge's AI leaves sources it holds for the next spell alone while paying: only the pool is left.
                    AiCardMemory.rememberCard(getPlayer(), card, AiCardMemory.MemorySet.HELD_MANA_SOURCES_FOR_NEXT_SPELL);
                    held.add(card);
                }
            }
        }
        boolean paid;
        game.getStack().freezeStack(sa);
        SpellAbility paying = sa;
        // An ability activated before keeps what paid for it last time; Forge's human play path clears this too.
        paying.clearManaPaid();
        paying.getPayingManaAbilities().clear();
        // Every mana ability that makes mana while this is paid, in order, with the mana it made: Forge's AI's
        // payment as it happened, including sources that paid another mana ability's cost through the pool.
        List<Map.Entry<SpellAbility, List<Mana>>> made = new ArrayList<>();
        AbilityManaPart.PRODUCED.set((ability, mana) -> made.add(Map.entry(ability, mana)));
        try {
            paid = SeededRandom.thinking(() -> new CostPayment(paying.getPayCosts(), paying).payComputerCosts(new ManualCostDecision(this, paying, activated, activatedColors)));
        } finally {
            AbilityManaPart.PRODUCED.remove();
            held.forEach(card -> AiCardMemory.forgetCard(getPlayer(), card, AiCardMemory.MemorySet.HELD_MANA_SOURCES_FOR_NEXT_SPELL));
        }
        List<String> used = new ArrayList<>();
        if (open != null) {
            open.answer = activations(made, manaAbilities, manaColors);
            open.answer.forEach(option -> used.add(manaAbilities.get(option - 1).getHostCard().getName()));
            session.recorder.decision(pay, open.answer, "ai", null, null);
        } else {
            activated.forEach(ability -> used.add(ability.getHostCard().getName()));
        }
        session.recorder.paid(source.getName(), used, by);
        if (paid) {
            game.getStack().addAndUnfreeze(sa);
            return true;
        }
        game.getStack().clearFrozen();
        return false;
    }

    /**
     * Every way the agent's permanents could make mana now: one option per usable mana ability, and one per
     * colour where the ability chooses one. The sources are the permanents those abilities belong to.
     */
    private void manaOptions(List<SpellAbility> abilities, List<Byte> colors, List<String> options, List<Card> sources) {
        for (Card card : getPlayer().getCardsIn(ZoneType.Battlefield)) {
            boolean usable = false;
            for (SpellAbility ability : card.getManaAbilities()) {
                ability.setActivatingPlayer(getPlayer());
                AbilityManaPart mana = ability.getManaPart();
                if (mana == null || !ability.canPlay()) {
                    continue;
                }
                usable = true;
                String label = cardLabel(card);
                boolean reflected = ability.getApi() == ApiType.ManaReflected; // "any type a land you control could produce"
                if (mana.isAnyMana() || mana.isComboMana() || reflected) {
                    for (String name : (mana.isComboMana() ? mana.getComboColors(ability) : "W U B R G").split(" ")) {
                        byte color = MagicColor.fromName(name);
                        if (color != 0) {
                            abilities.add(ability);
                            colors.add(color);
                            options.add(label + " (" + MagicColor.toShortString(color) + ")");
                        }
                    }
                } else {
                    abilities.add(ability);
                    colors.add((byte) 0);
                    options.add(label + " (" + mana.getOrigProduced().replace(" ", "") + ")");
                }
            }
            if (usable) {
                sources.add(card);
            }
        }
    }

    /** Activate a mana ability, choosing its colours where it has a choice; its mana goes to the pool. */
    void activate(SpellAbility ability, String colors) {
        if (!colors.isEmpty()) {
            ability.getManaPart().setExpressChoice(colors);
        }
        boolean paid = new CostPayment(ability.getPayCosts(), ability).payComputerCosts(new AiCostDecision(getPlayer(), ability, false, true));
        if (paid) {
            getGame().getStack().addAndUnfreeze(ability);
        }
        trace("mana " + Labels.ability(ability) + " " + colors + (paid ? "" : " (couldn't pay)") + " pool " + getPlayer().getManaPool().totalMana());
    }

    /**
     * The options Forge's AI's payment amounts to: one per activation of a listed ability, in the order the
     * mana was made, and for an ability that chooses colours, one per mana it made. Mana from abilities that
     * aren't options (a trigger adding mana as a land is tapped) happens again by itself in a fork.
     */
    private static List<Integer> activations(List<Map.Entry<SpellAbility, List<Mana>>> made, List<SpellAbility> abilities, List<Byte> colors) {
        List<Integer> out = new ArrayList<>();
        for (Map.Entry<SpellAbility, List<Mana>> production : made) {
            SpellAbility used = production.getKey();
            if (used == null) {
                continue;
            }
            for (int i = 0; i < abilities.size(); i++) {
                SpellAbility listed = abilities.get(i);
                if (listed != used && !(listed.getHostCard() == used.getHostCard() && listed.toString().equals(used.toString()))) {
                    continue;
                }
                if (colors.get(i) == 0) {
                    out.add(i + 1);
                } else {
                    for (Mana mana : production.getValue()) {
                        for (int j = i; j < abilities.size() && abilities.get(j) == listed; j++) {
                            if (colors.get(j) == mana.getColor()) {
                                out.add(j + 1);
                                break;
                            }
                        }
                    }
                }
                break;
            }
        }
        return out;
    }

    /** Whether the agent picks the mana: always, or when a creature (which could attack or crew instead) can pay. */
    private boolean askForMana(List<Card> sources) {
        return mine("pay") && switch (session.setup.manaChoice()) {
            case AUTO -> false;
            case ALWAYS -> true;
            case CREATURES -> sources.stream().anyMatch(Card::isCreature);
        };
    }

    /**
     * Targets for every part of the ability that targets, asked part by part. Targets already on a part were
     * chosen by Forge's AI while weighing the play; they are logged as its answer. Its fallback chooses for
     * the whole ability at once, so later parts find theirs preset.
     */
    void chooseTargets(SpellAbility sa) {
        for (SpellAbility part = sa; part != null; part = part.getSubAbility()) {
            if (!part.usesTargeting()) {
                continue;
            }
            List<GameEntity> candidates = part.getTargetRestrictions().getAllCandidates(part);
            if (candidates.isEmpty()) {
                continue;
            }
            SpellAbility targeting = part;
            String prompt = "target for " + Labels.text(part.toString(), part.getHostCard().getName());
            Iterable<GameEntity> preset = part.isTargetNumberValid() && !part.getTargets().isEmpty()
                    ? part.getTargets().getTargetEntities() : null;
            List<GameEntity> chosen = choose("targets", prompt, candidates, e -> Labels.entity(e, getPlayer()),
                    part.getMinTargets(), part.getMaxTargets(), () -> {
                        super.chooseTargetsFor(sa);
                        return targeting.getTargets().getTargetEntities();
                    }, preset);
            if (targeting.getTargets().isEmpty()) {
                chosen.forEach(target -> targeting.getTargets().add(target));
            }
        }
    }

    // ---- choices Forge calls on the controller directly ----

    @Override
    public byte chooseColor(String message, SpellAbility sa, ColorSet colors) {
        List<String> names = new ArrayList<>();
        List<Byte> masks = new ArrayList<>();
        for (byte color : MagicColor.WUBRG) {
            if (colors.hasAnyColor(color)) {
                names.add(MagicColor.toLongString(color));
                masks.add(color);
            }
        }
        if (names.isEmpty()) {
            return super.chooseColor(message, sa, colors);
        }
        List<Integer> picks = ask("choose", clean(message) + source(sa), names, null, 1, 1, false, () -> {
            int at = masks.indexOf(super.chooseColor(message, sa, colors));
            return List.of(at < 0 ? 1 : at + 1);
        });
        return masks.get(picks.get(0) - 1);
    }

    @Override
    public ColorSet chooseColors(String message, SpellAbility sa, int min, int max, ColorSet options) {
        List<String> names = new ArrayList<>();
        List<Byte> masks = new ArrayList<>();
        for (byte color : MagicColor.WUBRG) {
            if (options.hasAnyColor(color)) {
                names.add(MagicColor.toLongString(color));
                masks.add(color);
            }
        }
        if (names.isEmpty()) {
            return super.chooseColors(message, sa, min, max, options);
        }
        List<Integer> picks = ask("choose", clean(message) + source(sa), names, null, min, max, false, () -> {
            ColorSet chosen = super.chooseColors(message, sa, min, max, options);
            List<Integer> out = new ArrayList<>();
            for (int i = 0; i < masks.size(); i++) {
                if (chosen.hasAnyColor(masks.get(i))) {
                    out.add(i + 1);
                }
            }
            return out;
        });
        int mask = 0;
        for (int pick : picks) {
            mask |= masks.get(pick - 1);
        }
        return ColorSet.fromMask(mask);
    }

    @Override
    public String chooseSomeType(String kindOfType, SpellAbility sa, Collection<String> validTypes, boolean isOptional) {
        List<String> types = new ArrayList<>(validTypes);
        if (types.isEmpty()) {
            return super.chooseSomeType(kindOfType, sa, validTypes, isOptional);
        }
        List<Integer> picks = ask("choose", kindOfType + source(sa), types, null, isOptional ? 0 : 1, 1, false, () -> {
            int at = types.indexOf(super.chooseSomeType(kindOfType, sa, validTypes, isOptional));
            return at < 0 ? List.of() : List.of(at + 1);
        });
        return picks.isEmpty() ? null : types.get(picks.get(0) - 1);
    }

    @Override
    public String chooseCardName(SpellAbility sa, Predicate<ICardFace> cpp, String valid, String message) {
        // Any card name matching a predicate: too many to list, so Forge's AI chooses, unlogged.
        String name = super.chooseCardName(sa, cpp, valid, message);
        session.recorder.ai("name", clean(message) + source(sa), List.of(String.valueOf(name)));
        return name;
    }

    @Override
    public String chooseCardName(SpellAbility sa, List<ICardFace> faces, String message) {
        if (faces.isEmpty()) {
            return super.chooseCardName(sa, faces, message);
        }
        List<ICardFace> chosen = choose("choose", clean(message) + source(sa), faces, ICardFace::getName, 1, 1, () -> {
            String name = super.chooseCardName(sa, faces, message);
            return faces.stream().filter(face -> face.getName().equals(name)).toList();
        });
        return chosen.isEmpty() ? null : chosen.get(0).getName();
    }

    @Override
    public boolean chooseBinary(SpellAbility sa, String question, BinaryChoiceType kindOfChoice, Boolean defaultVal) {
        String[] names = kindOfChoice.name().split("Or");
        List<String> options = names.length == 2
                ? List.of(names[0].toLowerCase(Locale.ROOT), names[1].toLowerCase(Locale.ROOT)) : YES_NO;
        List<Integer> picks = ask("choose", clean(question) + source(sa), options, null, 1, 1, false,
                () -> List.of(super.chooseBinary(sa, question, kindOfChoice, defaultVal) ? 1 : 2));
        return picks.get(0) == 1;
    }

    @Override
    public CardCollectionView orderMoveToZoneList(CardCollectionView cards, ZoneType destinationZone, SpellAbility source) {
        if (cards.size() <= 1) {
            return cards;
        }
        List<Card> list = new ArrayList<>();
        cards.forEach(list::add);
        List<String> options = new ArrayList<>();
        list.forEach(card -> options.add(cardLabel(card)));
        List<Integer> picks = ask("order", "cards to " + destinationZone.name().toLowerCase(Locale.ROOT) + source(source),
                options, null, options.size(), options.size(), false,
                () -> new ArrayList<>(new LinkedHashSet<>(indices(list, super.orderMoveToZoneList(new CardCollection(cards), destinationZone, source)))));
        if (picks.size() != list.size()) {
            return cards;
        }
        CardCollection ordered = new CardCollection();
        picks.forEach(pick -> ordered.add(list.get(pick - 1)));
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
            List<Integer> picks = ask("order", "triggers onto the stack, first in resolves last", options, null,
                    options.size(), options.size(), false,
                    // Forge's AI takes triggers out of the list it is given while sorting them; give it a copy.
                    () -> new ArrayList<>(new LinkedHashSet<>(indices(abilities, super.orderSimultaneousSa(new ArrayList<>(abilities))))));
            if (picks.size() == abilities.size()) {
                ordered = new ArrayList<>();
                for (int pick : picks) {
                    ordered.add(abilities.get(pick - 1));
                }
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
        if (wrapper.isMandatory()) {
            return true;
        }
        return askYesNo("use " + Labels.ability(wrapper), () -> super.confirmTrigger(wrapper));
    }

    // ---- choices inside effects ----

    @Override
    public List<AbilitySub> chooseModeForAbility(SpellAbility sa, List<AbilitySub> possible, int min, int num, boolean allowRepeat) {
        List<String> options = new ArrayList<>();
        List<String> details = new ArrayList<>();
        possible.forEach(mode -> {
            options.add(Labels.text(mode.getDescription(), sa.getHostCard().getName()));
            details.add(Labels.named(mode.getDescription(), sa.getHostCard().getName()));
        });
        String prompt = "modes for " + sa.getHostCard().getName() + (allowRepeat ? ", a mode may repeat" : "");
        List<Integer> picks = ask("mode", prompt, options, details, min, num, allowRepeat,
                () -> indices(possible, super.chooseModeForAbility(sa, new ArrayList<>(possible), min, num, allowRepeat)));
        List<AbilitySub> chosen = new ArrayList<>();
        for (int pick : picks) {
            chosen.add(possible.get(pick - 1));
        }
        return chosen;
    }

    @Override
    public List<OptionalCostValue> chooseOptionalCosts(SpellAbility chosen, List<OptionalCostValue> optionalCostValues) {
        return choose("choose", "optional costs for " + chosen.getHostCard().getName(), optionalCostValues,
                v -> clean(v.toString()), 0, optionalCostValues.size(), () -> super.chooseOptionalCosts(chosen, optionalCostValues));
    }

    @Override
    public Integer announceRequirements(SpellAbility ability, int min, int max, String announce) {
        return askNumber(announce + source(ability), min, max, () -> {
            Integer value = super.announceRequirements(ability, min, max, announce);
            return value == null ? min : value;
        });
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, int min, int max) {
        return askNumber(clean(title) + source(sa), min, max, () -> super.chooseNumber(sa, title, min, max));
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, int min, int max, Map<String, Object> params) {
        return askNumber(clean(title) + source(sa), min, max, () -> super.chooseNumber(sa, title, min, max, params));
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, List<Integer> values, Player relatedPlayer) {
        List<Integer> picked = choose("choose", clean(title) + source(sa), values, String::valueOf, 1, 1,
                () -> List.of(super.chooseNumber(sa, title, values, relatedPlayer)));
        return picked.isEmpty() ? values.get(0) : picked.get(0);
    }

    @Override
    public boolean confirmAction(SpellAbility sa, PlayerActionConfirmMode mode, String message, List<String> options,
                                 Card cardToShow, Map<String, Object> params) {
        return askYesNo(clean(message) + source(sa), () -> super.confirmAction(sa, mode, message, options, cardToShow, params));
    }

    @Override
    public CardCollectionView chooseCardsForEffect(CardCollectionView sourceList, SpellAbility sa, String title, int min,
                                                   int max, boolean isOptional, Map<String, Object> params) {
        return new CardCollection(choose("choose", clean(title) + source(sa), sourceList, this::cardLabel, isOptional ? 0 : min, max,
                () -> super.chooseCardsForEffect(new CardCollection(sourceList), sa, title, min, max, isOptional, params)));
    }

    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(FCollectionView<T> optionList, DelayedReveal delayedReveal,
                                                                SpellAbility sa, String title, boolean isOptional,
                                                                Player relatedPlayer, Map<String, Object> params) {
        if (delayedReveal != null) {
            session.recorder.look(delayedReveal.getCards(), "revealed" + source(sa));
        }
        List<T> chosen = choose("choose", clean(title) + source(sa), optionList, e -> Labels.entity(e, getPlayer()), isOptional ? 0 : 1, 1, () -> {
            T picked = super.chooseSingleEntityForEffect(new FCollection<>(optionList), delayedReveal, sa, title, isOptional, relatedPlayer, params);
            return picked == null ? List.<T>of() : List.of(picked);
        });
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public <T extends GameEntity> List<T> chooseEntitiesForEffect(FCollectionView<T> optionList, int min, int max,
                                                                  DelayedReveal delayedReveal, SpellAbility sa, String title,
                                                                  Player relatedPlayer, Map<String, Object> params) {
        if (delayedReveal != null) {
            session.recorder.look(delayedReveal.getCards(), "revealed" + source(sa));
        }
        return choose("choose", clean(title) + source(sa), optionList, e -> Labels.entity(e, getPlayer()), min, max,
                () -> super.chooseEntitiesForEffect(new FCollection<>(optionList), min, max, delayedReveal, sa, title, relatedPlayer, params));
    }

    @Override
    public Card chooseSingleCardForZoneChange(ZoneType destination, List<ZoneType> origin, SpellAbility sa, CardCollection fetchList,
                                              DelayedReveal delayedReveal, String selectPrompt, boolean isOptional, Player decider) {
        if (origin.contains(ZoneType.Library)) {
            session.recorder.look(fetchList, "searched" + source(sa));
        }
        List<Card> chosen = choose("choose", clean(selectPrompt) + source(sa), fetchList, this::cardLabel, isOptional ? 0 : 1, 1, () -> {
            Card card = super.chooseSingleCardForZoneChange(destination, origin, sa, new CardCollection(fetchList), delayedReveal, selectPrompt, isOptional, decider);
            return card == null ? List.<Card>of() : List.of(card);
        });
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public CardCollectionView choosePermanentsToSacrifice(SpellAbility sa, int min, int max, CardCollectionView validTargets, String message) {
        return new CardCollection(choose("choose", "sacrifice" + source(sa), validTargets, this::cardLabel, min, max,
                () -> super.choosePermanentsToSacrifice(sa, min, max, new CardCollection(validTargets), message)));
    }

    @Override
    public CardCollection chooseCardsToDiscardFrom(Player playerDiscard, SpellAbility sa, CardCollection validCards,
                                                   int min, int max, CardCollectionView visibleToChooser) {
        return new CardCollection(choose("choose", "discard" + source(sa), validCards, this::cardLabel, min, max,
                () -> super.chooseCardsToDiscardFrom(playerDiscard, sa, new CardCollection(validCards), min, max, visibleToChooser)));
    }

    @Override
    public CardCollectionView chooseCardsToDiscardToMaximumHandSize(int numDiscard) {
        return new CardCollection(choose("choose", "discard to hand size", getPlayer().getCardsIn(ZoneType.Hand),
                this::cardLabel, numDiscard, numDiscard, () -> super.chooseCardsToDiscardToMaximumHandSize(numDiscard)));
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(CardCollection topN) {
        session.recorder.look(topN, "scry");
        List<Card> bottom = choose("choose", "scry " + topN.size() + ": cards to put on the bottom", topN, this::cardLabel,
                0, topN.size(), () -> super.arrangeForScry(new CardCollection(topN)).getRight());
        CardCollection top = new CardCollection(topN);
        top.removeAll(bottom);
        return ImmutablePair.of(top, new CardCollection(bottom));
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(CardCollection topN) {
        session.recorder.look(topN, "surveil");
        List<Card> graveyard = choose("choose", "surveil " + topN.size() + ": cards to put in the graveyard", topN, this::cardLabel,
                0, topN.size(), () -> super.arrangeForSurveil(new CardCollection(topN)).getRight());
        CardCollection top = new CardCollection(topN);
        top.removeAll(graveyard);
        return ImmutablePair.of(top, new CardCollection(graveyard));
    }

    // ---- mulligan and combat ----

    @Override
    public boolean mulliganKeepHand(Player firstPlayer, int cardsToReturn) {
        String bottom = cardsToReturn > 0 ? " (then bottom " + cardsToReturn + ")" : "";
        List<Integer> answer = ask("mulligan", "keep this hand" + bottom, List.of("keep", "mulligan"), null, 1, 1, false,
                () -> List.of(super.mulliganKeepHand(firstPlayer, cardsToReturn) ? 1 : 2));
        return answer.get(0) == 1;
    }

    @Override
    public CardCollectionView tuckCardsViaMulligan(CardCollectionView hand, int cardsToReturn) {
        return new CardCollection(choose("choose", "put " + cardsToReturn + " on the bottom", hand, this::cardLabel,
                cardsToReturn, cardsToReturn, () -> super.tuckCardsViaMulligan(new CardCollection(hand), cardsToReturn)));
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
        boolean[] declared = {false};
        List<Integer> picks = ask("attack", "attackers, at most one defender each", options, null, 0, options.size(), false, () -> {
            super.declareAttackers(attacker, combat);
            declared[0] = true;
            List<Integer> out = new ArrayList<>();
            for (Card card : combat.getAttackers()) {
                GameEntity defender = combat.getDefenderByAttacker(card);
                for (int i = 0; i < creatures.size(); i++) {
                    if (creatures.get(i) == card && defenders.get(i).equals(defender)) {
                        out.add(i + 1);
                    }
                }
            }
            return out;
        });
        if (!declared[0]) {
            List<Card> chosen = new ArrayList<>();
            for (int pick : picks) {
                Card creature = creatures.get(pick - 1);
                if (!chosen.contains(creature)) {
                    chosen.add(creature);
                    combat.addAttacker(creature, defenders.get(pick - 1));
                }
            }
        }
        trace("attackers picks=" + picks + " ai=" + declared[0] + " declared=" + combat.getAttackers());
    }
}
