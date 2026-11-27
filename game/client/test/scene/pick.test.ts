// Picking what was drawn: layout's hit groups carried to where the stage last drew their pieces. At rest it is layout's
// `hitTest` exactly (over the whole corpus, on a grid of taps); through a reflow a tap reaches the card where it is seen.
import { describe, expect, it } from "vitest";
import { hitTest } from "../../src/layout";
import type { TablePlan } from "../../src/layout";

/** Layout's hitTest on the table under the chrome: the seats' plates are the chrome's own (chrome/plates.tsx). */
const tableHit = (plan: TablePlan, p: Point) => hitTest({ ...plan, hits: { ...plan.hits, groups: plan.hits.groups.filter((g) => g.kind !== "plate") } }, p);
import type { Point, Quad } from "../../src/layout";
import { LOOK, Stage, movedQuad, pickDrawn } from "../../src/scene/stage";
import type { DrawnPiece, StageView } from "../../src/scene/stage";
import { corpusSteps, frameOf } from "./corpus";
import type { Step } from "./corpus";

const runs = corpusSteps();
const FRAME = 16;

const centre = (q: Quad): Point => ({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 });

function grid(step: Step): Point[] {
  const { w, h } = step.plan.viewport;
  const out: Point[] = [];
  for (let y = 4; y < h; y += 12) for (let x = 4; x < w; x += 12) out.push({ x, y });
  return out;
}

/** Shows `step` (its set first) and frames until nothing moves; returns the last view and the time. */
function rest(stage: Stage, step: Step, t: number): { view: StageView; t: number } {
  let { view, report } = stage.show(frameOf(step, [step.set]), (t += FRAME));
  for (let k = 0; k < 1250 && report.active; k++) ({ view, report } = stage.show(frameOf(step, []), (t += FRAME)));
  return { view, t };
}

describe("picking what was drawn", () => {
  it.each(runs.map((r, i) => [`run ${i + 1}`, r] as const))("%s: at rest it is layout's hitTest, tap for tap", (_, run) => {
    const stage = new Stage();
    let t = 0;
    for (const step of run) {
      const r = rest(stage, step, t);
      t = r.t;
      for (const p of grid(step)) expect(pickDrawn(step.plan, r.view.drawn, p)?.id ?? null, `${step.name} at ${p.x},${p.y}`).toBe(tableHit(step.plan, p)?.id ?? null);
    }
  });

  it("through a reflow a tap reaches the card where it is drawn, not the group whose destination is there", () => {
    let reached = 0;
    for (const run of runs) {
      const stage = new Stage();
      let t = 0;
      for (const step of run) {
        let { view, report } = stage.show(frameOf(step, [step.set]), (t += FRAME));
        for (let k = 0; k < 300 && report.active; k++) {
          for (const g of step.plan.hits.groups) {
            const d = view.drawn.get(g.id);
            if (!d?.pickable || g.kind === "plate") continue;
            // (a tap on its face as drawn: a face is reached before any wider place around another)
            const q = movedQuad(step.plan.projector, g.face ?? g.quad, d);
            const c = centre(q), home = centre(g.face ?? g.quad);
            if (Math.hypot(c.x - home.x, c.y - home.y) < 40) continue;
            const got = pickDrawn(step.plan, view.drawn, c);
            // Where it is seen, it (or a group drawn over it) is reached; at rest, layout would have reached something else.
            expect(got, `${step.name}: ${g.id}`).not.toBeNull();
            if (got!.id === g.id && tableHit(step.plan, c)?.id !== g.id) reached++;
            else expect(got!.order, `${step.name}: ${g.id} under ${got!.id}`).toBeGreaterThanOrEqual(g.order);
          }
          ({ view, report } = stage.show(frameOf(step, []), (t += FRAME)));
        }
        t = rest(stage, step, t).t;
      }
    }
    expect(reached).toBeGreaterThan(0);
  });

  it("a piece showing none of its cards is not reached; an unmoved one is its quad exactly", () => {
    const step = runs.flat().find((s) => s.plan.hits.groups.some((g) => g.kind === "card"))!;
    const g = step.plan.hits.groups.find((x) => x.kind === "card")!;
    const at = { ...LOOK, pos: { x: 1, y: 0.5, z: 2 }, rx: 0, ry: 0, s: 0.8 };
    const still: DrawnPiece = { now: at, rest: at, pickable: true };
    expect(movedQuad(step.plan.projector, g.quad, still)).toBe(g.quad);
    expect(pickDrawn(step.plan, new Map([[g.id, still]]), centre(g.quad))?.id).toBe(tableHit(step.plan, centre(g.quad))?.id);
    const away: DrawnPiece = { ...still, pickable: false };
    expect(pickDrawn(step.plan, new Map([[g.id, away]]), centre(g.quad))?.id ?? null).not.toBe(g.id);
  });
});
