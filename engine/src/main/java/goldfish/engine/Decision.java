package goldfish.engine;

import java.util.List;

/**
 * One question to the agent. For choices, the answer is option numbers (1-based, in the order the agent
 * gives them, between min and max of them); for kind "number", options is empty and the answer is one
 * value between min and max.
 */
public record Decision(String kind, String turn, String prompt, List<String> options, int min, int max) {

    public boolean isNumber() {
        return options.isEmpty();
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
        if (answer.stream().distinct().count() != answer.size()) {
            return "each option at most once";
        }
        return null;
    }
}
