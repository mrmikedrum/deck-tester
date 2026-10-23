package goldfish.engine;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.UncheckedIOException;
import java.util.Random;

/**
 * Forge draws all randomness from one shared Random (forge.util.MyRandom). Installed there, this gives
 * each game thread its own seeded sequence, so parallel games stay reproducible from their seeds. A
 * session holds its game's Source, so a snapshot can save the sequence and a restore can rewind it.
 */
final class SeededRandom extends Random {
    /** One game's random sequence. */
    static final class Source {
        private volatile Random random;

        Source(long seed) {
            random = new Random(seed);
        }

        Random copy() {
            return SeededRandom.copy(random);
        }

        void rewind(Random saved) {
            random = SeededRandom.copy(saved);
        }
    }

    private static final ThreadLocal<Source> LOCAL = ThreadLocal.withInitial(() -> new Source(System.nanoTime()));

    /** Seed the calling thread's game; the session keeps the returned source. */
    static Source seed(long seed) {
        Source source = new Source(seed);
        LOCAL.set(source);
        return source;
    }

    @Override
    protected int next(int bits) {
        return LOCAL.get().random.nextInt() >>> (32 - bits);
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
