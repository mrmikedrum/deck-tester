package goldfish.engine;

import java.util.List;
import java.util.concurrent.SynchronousQueue;

/**
 * Hands a decision from the parked game thread to the server, and the answer back. The server only
 * touches game state while the game thread is parked here or finished, so state is never read or
 * changed concurrently.
 */
final class Channel {
    /**
     * What the game thread receives instead of an answer: the session ended, or the state changed under
     * the decision (a restore or an override) and the decision should be asked again.
     */
    static class Interrupt extends RuntimeException {
        final boolean restored;

        Interrupt(boolean restored) {
            this(restored, restored ? "state changed" : "session ended");
        }

        Interrupt(boolean restored, String message) {
            super(message, null, false, false);
            this.restored = restored;
        }
    }

    /** A fork's replay reached a decision other than the one recorded next: it isn't the same game. */
    static final class Drift extends Interrupt {
        Drift(String message) {
            super(false, message);
        }
    }

    /** The answer that hands a decision to Forge's AI. */
    static final Object DEFER = new Object();

    private final SynchronousQueue<Object> answers = new SynchronousQueue<>();
    private Decision pending;
    private boolean finished;
    private String by = "agent";
    private Double confidence;

    /** Game thread: publish the decision and park until it is answered; null when handed to the AI. */
    @SuppressWarnings("unchecked")
    List<Integer> ask(Decision decision) {
        synchronized (this) {
            pending = decision;
            notifyAll();
        }
        Object answer;
        try {
            answer = answers.take();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Interrupt(false);
        }
        if (answer instanceof Interrupt interrupt) {
            throw interrupt;
        }
        if (answer == DEFER) {
            return null;
        }
        return (List<Integer>) answer;
    }

    synchronized void finish() {
        finished = true;
        pending = null;
        notifyAll();
    }

    /** Server: wait until a decision is parked or the game is over. */
    synchronized Decision await(long timeoutMillis) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (pending == null && !finished) {
            long left = deadline - System.currentTimeMillis();
            if (left <= 0) {
                break;
            }
            wait(left);
        }
        return pending;
    }

    synchronized Decision pending() {
        return pending;
    }

    synchronized boolean isFinished() {
        return finished;
    }

    /** Who gave the last answer ("agent" unless the client named itself, such as "model"), and how sure it was. */
    synchronized String by() {
        return by;
    }

    synchronized Double confidence() {
        return confidence;
    }

    /** Server: hand the parked decision to Forge's AI, noting who chose to (the agent, or a model that agreed). */
    void defer(String by, Double confidence) throws InterruptedException {
        synchronized (this) {
            this.by = by;
            this.confidence = confidence;
        }
        resume(DEFER);
    }

    /** Server: release the parked game thread with an answer from the named answerer. */
    void answer(List<Integer> answer, String by, Double confidence) throws InterruptedException {
        synchronized (this) {
            this.by = by;
            this.confidence = confidence;
        }
        resume(answer);
    }

    /** Server: release the parked game thread with an answer, or with an Interrupt. */
    void resume(Object answer) throws InterruptedException {
        synchronized (this) {
            pending = null;
        }
        answers.put(answer);
    }
}
