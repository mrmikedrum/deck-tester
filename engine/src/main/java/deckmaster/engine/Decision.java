package deckmaster.engine;

import java.util.List;
import java.util.Map;

/**
 * One question to the agent. For choices, the answer is option numbers (1-based, in the order the agent
 * gives them, between min and max of them; the same number more than once only when repeat is set); for
 * kind "number", options is empty and the answer is one value between min and max. Details, when present,
 * hold each option's full text for agents that ask for it. Mine is whether it comes in the agent's own turn.
 * Refs, when present, name what each option points at (a card id, a player, an attacker's defender) for a client
 * that shows the game: agents read the labels and never need them.
 */
public record Decision(String kind, String turn, String prompt, List<String> options, List<String> details,
                       int min, int max, boolean repeat, boolean mine, List<Map<String, Object>> refs) {

    public Decision(String kind, String turn, String prompt, List<String> options, List<String> details,
                    int min, int max, boolean repeat, boolean mine) {
        this(kind, turn, prompt, options, details, min, max, repeat, mine, null);
    }

    public Decision withRefs(List<Map<String, Object>> refs) {
        return new Decision(kind, turn, prompt, options, details, min, max, repeat, mine, refs);
    }

    public boolean isNumber() {
        return options.isEmpty();
    }

    /** The same question in the same place: what a fork's replay checks at each recorded decision. */
    boolean same(Decision other) {
        return kind.equals(other.kind) && turn.equals(other.turn) && prompt.equals(other.prompt)
                && options.equals(other.options) && min == other.min && max == other.max && repeat == other.repeat;
    }

    /** Null when the answer fits this decision, otherwise why it doesn't. */
    public String check(List<Integer> answer) {
        if (isNumber()) {
            if (answer.size() != 1 || answer.get(0) < min || answer.get(0) > max) {
                return "answer one number from " + min + " to " + max;
            }
            return null;
        }
        if (answer.size() < min || answer.size() > max) {
            return min == max ? "pick exactly " + min : "pick " + min + " to " + max;
        }
        for (int choice : answer) {
            if (choice < 1 || choice > options.size()) {
                return "options are 1 to " + options.size();
            }
        }
        if (!repeat && answer.stream().distinct().count() != answer.size()) {
            return "each option at most once";
        }
        return null;
    }
}
