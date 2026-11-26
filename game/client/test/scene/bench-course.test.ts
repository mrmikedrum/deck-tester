import { describe, expect, it } from "vitest";
import { course } from "../../src/scene/workbench/bench-inputs";
import type { Frame, Named } from "../../src/scene/workbench/bench-inputs";
import type { TablePlan } from "../../src/layout";

// The Node bench and the iPad bench page plan every input in one shared course, so the device gate times what Node
// times. (The page used to reset memory before every plan of a one-frame input; Node carried it.)

const frame = (n: number) => ({ model: { n }, settling: false }) as unknown as Frame;
const plan = (n: number) => ({ n }) as unknown as TablePlan;

describe("the bench course", () => {
  it("a single frame is planned again and again from its own last plan", () => {
    const c = course({ name: "one", what: "", frames: [frame(0)] } as Named);
    expect(c.next()[1]).toBeNull();
    c.keep(plan(1));
    for (let i = 2; i < 6; i++) {
      const [f, prev] = c.next();
      expect(f).toEqual(frame(0));
      expect(prev).toEqual(plan(i - 1));
      c.keep(plan(i));
    }
  });

  it("a sequence carries memory frame to frame and starts each pass fresh", () => {
    const c = course({ name: "seq", what: "", frames: [frame(0), frame(1), frame(2)] } as Named);
    const seen: [unknown, unknown][] = [];
    for (let i = 0; i < 6; i++) {
      const [f, prev] = c.next();
      seen.push([f, prev]);
      c.keep(plan(i));
    }
    expect(seen.map(([, p]) => p)).toEqual([null, plan(0), plan(1), null, plan(3), plan(4)]);
    expect(seen.map(([f]) => f)).toEqual([0, 1, 2, 0, 1, 2].map(frame));
  });
});
