// A card lifted off the table takes the lamp as it would on the table there: on the table (lying, or standing to its
// middle) it is lit as is; lifted toward the lamp it is toned down; lifted out of the lamp's cone it is brought up, within
// bounds.
import { describe, expect, it } from "vitest";
import { liftExposure } from "../../src/scene/three/cards";

describe("a lifted card's exposure", () => {
  it("on the table, lying or standing, the lamp is as it is", () => {
    expect(liftExposure(0, 0.001, 0, 1)).toBe(1);
    expect(liftExposure(-3, 0.45, 3, 1)).toBe(1);
  });
  it("lifted toward the lamp (the gathering, left of the middle), it takes less of it", () => {
    const k = liftExposure(-3.5, 7.14, 3.55, 1.85);
    expect(k).toBeLessThan(0.7);
    expect(k).toBeGreaterThanOrEqual(0.5);
  });
  it("a little lift, a little less; never outside its bounds", () => {
    expect(liftExposure(-3.5, 1.5, 3.55, 1)).toBeGreaterThan(liftExposure(-3.5, 6, 3.55, 1));
    for (const [x, z] of [[-20, -20], [20, 20], [0, 0]]) for (const y of [1, 5, 10]) {
      const k = liftExposure(x!, y, z!, 1);
      expect(k).toBeGreaterThanOrEqual(0.5);
      expect(k).toBeLessThanOrEqual(2);
    }
  });
});
