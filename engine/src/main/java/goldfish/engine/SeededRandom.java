package goldfish.engine;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.UncheckedIOException;
import java.util.Random;
import java.util.function.Supplier;

/**
 * Forge draws all randomness from one shared Random (forge.util.MyRandom). Installed there, this gives
 * each game thread its own seeded sequences, so parallel games stay reproducible from their seeds.
 *
 * Each game has two sequences. The game's own (shuffles, coin flips, dice) is what the seed fixes. Forge's
 * AI also draws randomness while it weighs a choice ("hold the land drop some of the time"); that comes
 * from a second sequence, used while the controller is {@link #thinking}, so a game replayed from recorded
 * answers, in which the AI never weighs anything, shuffles exactly as the original did.
 */
final class SeededRandom extends Random {
    /** One game's random sequences. */
    static final class Source {
        private volatile Random game;
        private final Random weighing;
        private int thinking;

        Source(long seed) {
            game = new Random(seed);
            weighing = new Random(~seed);
        }

        Random copy() {
            return SeededRandom.copy(game);
        }

        void rewind(Random saved) {
            game = SeededRandom.copy(saved);
        }
    }

    private static final ThreadLocal<Source> LOCAL = ThreadLocal.withInitial(() -> new Source(System.nanoTime()));

    /** Seed the calling thread's game; the session keeps the returned source. */
    static Source seed(long seed) {
        Source source = new Source(seed);
        LOCAL.set(source);
        return source;
    }

    /** Run Forge's AI weighing a choice: its random draws leave the game's own sequence alone. */
    static <T> T thinking(Supplier<T> ai) {
        Source source = LOCAL.get();
        source.thinking++;
        try {
            return ai.get();
        } finally {
            source.thinking--;
        }
    }

    @Override
    protected int next(int bits) {
        Source source = LOCAL.get();
        Random random = source.thinking > 0 ? source.weighing : source.game;
        return random.nextInt() >>> (32 - bits);
    }

    /** Random is serializable, and its serialized form carries its whole state. */
    private static Random copy(Random random) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (ObjectOutputStream out = new ObjectOutputStream(bytes)) {
                out.writeObject(random);
            }
            try (ObjectInputStream in = new ObjectInputStream(new ByteArrayInputStream(bytes.toByteArray()))) {
                return (Random) in.readObject();
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException(e);
        }
    }
}
