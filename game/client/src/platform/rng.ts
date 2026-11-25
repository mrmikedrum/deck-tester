// All randomness comes from a seeded generator, so the same inputs give the same frames.

/** A generator returning floats in [0, 1). */
export type Rng = () => number;

/** mulberry32: small, fast, and well distributed for visual effects (not for security). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator for a string or number seed (a card id, a game gen); equal seeds give equal sequences. */
export function fromSeed(seed: string | number): Rng {
  if (typeof seed === "number") return mulberry32(seed);
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return mulberry32(h);
}
