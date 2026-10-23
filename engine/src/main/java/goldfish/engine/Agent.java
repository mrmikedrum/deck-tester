package goldfish.engine;

import java.util.List;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.TimeUnit;

/** Hands decisions from a parked game thread to whoever is acting as the agent, and answers back. */
public final class Agent {
    public record Decision(String kind, String prompt, List<String> options) { }

    private final SynchronousQueue<Decision> pending = new SynchronousQueue<>();
    private final SynchronousQueue<String> answers = new SynchronousQueue<>();
    private volatile boolean released;

    /** After release, decisions go back to the AI instead of parking. */
    public void release() {
        released = true;
    }

    boolean isReleased() {
        return released;
    }

    /** Game thread: publish the decision and park until it is answered. */
    String ask(Decision decision) {
        try {
            pending.put(decision);
            return answers.take();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while waiting for the agent", e);
        }
    }

    /** Agent side: the next parked decision, or null if none arrives in time. */
    public Decision next(long timeoutMillis) throws InterruptedException {
        return pending.poll(timeoutMillis, TimeUnit.MILLISECONDS);
    }

    public void answer(String option) throws InterruptedException {
        answers.put(option);
    }
}
