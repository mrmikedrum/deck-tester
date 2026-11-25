import { describe, expect, it } from "vitest";
import { fromSeed, mulberry32 } from "../../src/platform/rng";

const take = (next: () => number, n: number): number[] => Array.from({ length: n }, next);

describe("rng", () => {
  it("the same seed gives the same sequence", () => {
    expect(take(mulberry32(42), 8)).toEqual(take(mulberry32(42), 8));
    expect(take(fromSeed("card-17"), 8)).toEqual(take(fromSeed("card-17"), 8));
  });

  it("different seeds differ", () => {
    expect(take(mulberry32(1), 4)).not.toEqual(take(mulberry32(2), 4));
    expect(take(fromSeed("a"), 4)).not.toEqual(take(fromSeed("b"), 4));
  });

  it("stays in [0, 1)", () => {
    for (const x of take(mulberry32(7), 1000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("matches the known mulberry32 first value for seed 1", () => {
    expect(mulberry32(1)()).toBeCloseTo(0.6270739405881613, 12);
  });
});
