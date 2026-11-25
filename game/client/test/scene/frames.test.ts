// The stage's per-frame work: a frame where nothing changed (the same model, plan, cues, focus and hover) neither
// re-describes the table nor re-derives the faces of pieces that stand still.
import { describe as group, expect, it, vi } from "vitest";
import { Stage } from "../../src/scene/stage";
import { describe as describeTable } from "../../src/scene/stage/describe";
import { faceKey } from "../../src/theme";
import { corpusSteps, frameOf } from "./corpus";

vi.mock("../../src/scene/stage/describe", async (orig) => {
  const m = await orig<typeof import("../../src/scene/stage/describe")>();
  return { ...m, describe: vi.fn(m.describe) };
});
vi.mock("../../src/theme", async (orig) => {
  const m = await orig<typeof import("../../src/theme")>();
  return { ...m, faceKey: vi.fn(m.faceKey) };
});

const FRAME = 16;
const steps = corpusSteps().flat();
const dense = steps.reduce((a, b) => (b.model.cards.size > a.model.cards.size ? b : a));

group("a frame with nothing changed", () => {
  it("does not describe the table again, nor key the faces of pieces standing still", () => {
    const stage = new Stage();
    let t = 0;
    stage.show(frameOf(dense, [dense.set]), (t += FRAME));
    for (let i = 0; i < 2000 && stage.show(frameOf(dense, []), (t += FRAME)).report.active; i++);
    const described = vi.mocked(describeTable).mock.calls.length;
    const keyed = vi.mocked(faceKey).mock.calls.length;
    expect(described).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) stage.show(frameOf(dense, []), (t += FRAME));
    expect(vi.mocked(describeTable).mock.calls.length - described).toBe(0);
    expect(vi.mocked(faceKey).mock.calls.length - keyed).toBe(0);
    // Hover is an input: it describes again.
    stage.show(frameOf(dense, [], { hover: dense.plan.hits.groups[0]!.id }), t + FRAME);
    expect(vi.mocked(describeTable).mock.calls.length - described).toBe(1);
  });
});
