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
    static final class Interrupt extends RuntimeException {
        final boolean restored;

        Interrupt(boolean restored) {
            super(restored ? "state changed" : "session ended", null, false, false);
            this.restored = restored;
        }
    }

    /** The answer that hands a decision to Forge's AI. */
    static final Object DEFER = new Object();

    private final SynchronousQueue<Object> answers = new SynchronousQueue<>();
    private Decision pending;
    private boolean finished;

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

    /** Server: release the parked game thread with an answer, or with an Interrupt. */
    void resume(Object answer) throws InterruptedException {
        synchronized (this) {
            pending = null;
        }
        answers.put(answer);
    }
}
