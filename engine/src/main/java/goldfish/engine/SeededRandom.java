package goldfish.engine;

import java.util.Random;

/**
 * Forge draws all randomness from one shared Random (forge.util.MyRandom). Installed there, this gives
 * each game thread its own seeded sequence, so parallel games stay reproducible from their seeds.
 */
final class SeededRandom extends Random {
    private static final ThreadLocal<Random> LOCAL = ThreadLocal.withInitial(Random::new);

    static void seed(long seed) {
        LOCAL.set(new Random(seed));
    }

    @Override
    protected int next(int bits) {
        return LOCAL.get().nextInt() >>> (32 - bits);
    }
}
