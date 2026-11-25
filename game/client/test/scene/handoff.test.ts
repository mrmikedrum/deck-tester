// The scene's half of the cast hand-off (docs "Moments across both renderers"): while the chrome holds a card a moment
// carries, the stage draws it nowhere (not at its destination, not in a pile's count, not pickable); when the stage
// takes the set that brings it, by playing it, collapsing the backlog or a cut, it flies the card from the carried pose,
// and the moment lands exactly once.
import { describe as group, expect, it } from "vitest";
import type { ChangeSet } from "../../src/model";
import { hitTest } from "../../src/layout";
import { Stage, pickDrawn } from "../../src/scene/stage";
import type { MomentView, SceneSnapshot } from "../../src/scene/stage";
import { corpusSteps, frameOf } from "./corpus";
import type { Step } from "./corpus";

const FRAME = 16;
const runs = corpusSteps();
const run = runs.find((r) => r.some((s) => s.set.changes.some((c) => c.t === "moved" && c.from === "hand" && c.to === "stack")))!;
const i = run.findIndex((s) => s.set.changes.some((c) => c.t === "moved" && c.from === "hand" && c.to === "stack"));
const cast = run[i]!;
const card = cast.set.changes.find((c): c is Extract<ChangeSet["changes"][number], { t: "moved" }> => c.t === "moved" && c.from === "hand" && c.to === "stack")!.card;
const pose = { rect: { left: 300, top: 560, right: 380, bottom: 672 }, rotation: 0.05, scale: 1.06 };
const held: MomentView[] = [{ id: "m1", card, pose, owner: "chrome" }];
const taken: MomentView[] = [{ id: "m1", card, pose, owner: "scene" }];

/** Sets that move nothing, numbered before the cast's (renumbered after them). */
const fillers = (n: number): ChangeSet[] =>
  Array.from({ length: n }, (_, k) => ({ seq: cast.set.seq + k, rev: `filler${k}`, changes: [], moments: [], order: "log", involved: new Set() }));
const castAfter = (n: number): ChangeSet => ({ ...cast.set, seq: cast.set.seq + n });

function atRest(stage: Stage, step: Step, t: number): number {
  stage.show(frameOf(step, [step.set]), (t += FRAME));
  for (let k = 0; k < 1250; k++) if (!stage.show(frameOf(step, []), (t += FRAME)).report.active) return t;
  throw new Error("still moving");
}

const showing = (snap: SceneSnapshot) => snap.pieces.filter((p) => p.shown.includes(card)).map((p) => p.id);
const flightOf = (snap: SceneSnapshot) => snap.flights.filter((f) => f.card === card);

/** Frames until nothing moves, counting the moment's landings. */
function landings(stage: Stage, t: number, moments: MomentView[]): number {
  let n = 0;
  for (let k = 0; k < 400; k++) {
    const { report } = stage.show(frameOf(cast, [], { moments }), (t += FRAME));
    n += report.landed.filter((m) => m === "m1").length;
    if (!report.active) break;
  }
  return n;
}

group("the cast hand-off", () => {
  it("ordinary playback: drawn nowhere while its set waits, then flown from the carried pose", () => {
    const stage = new Stage();
    let t = atRest(stage, run[i - 1]!, 0);
    // The set that brings it waits behind another: the model already has it on the stack.
    const r1 = stage.show(frameOf(cast, [...fillers(1), castAfter(1)], { moments: held }), (t += FRAME));
    let snap = stage.inspect();
    expect(snap.backlog.waiting.map((w) => w.seq)).toEqual([castAfter(1).seq]);
    expect(showing(snap)).toEqual([]);
    expect(flightOf(snap)).toEqual([]);
    const home = snap.pieces.find((p) => p.members.includes(card))!;
    expect(home.visible).toBe(false);
    expect(r1.view.actors.find((a) => a.id === home.id)?.visible).toBe(false);
    // Nor is it there to be tapped (layout, at rest, has its group there).
    const g = cast.plan.hits.groups.find((x) => x.id === home.id)!;
    const mid = { x: (g.quad[0].x + g.quad[2].x) / 2, y: (g.quad[0].y + g.quad[2].y) / 2 };
    expect(hitTest(cast.plan, mid)?.id).toBe(home.id);
    expect(pickDrawn(cast.plan, r1.view.drawn, mid)?.id).not.toBe(home.id);
    // Taken: it sets off from the carried pose, in that commit.
    const r2 = stage.show(frameOf(cast, [], { moments: held }), (t += FRAME));
    snap = stage.inspect();
    expect(r2.report.consumedSeq).toBe(castAfter(1).seq);
    expect(flightOf(snap)).toEqual([expect.objectContaining({ origin: { from: "hand", moment: "m1", pose }, dest: { to: "piece", piece: home.id } })]);
    expect(showing(snap)).toEqual([]);
    expect(landings(stage, t, taken)).toBe(1);
    expect(showing(stage.inspect())).toEqual([home.id]);
  });

  it("a backlog collapse flies it from the carried pose rather than cutting it into place", () => {
    const stage = new Stage();
    const t = atRest(stage, run[i - 1]!, 0);
    const n = 9;
    const { report } = stage.show(frameOf(cast, [...fillers(n), castAfter(n)], { moments: held }), t + FRAME);
    const snap = stage.inspect();
    expect(snap.backlog.taken.at(-1)).toMatchObject({ seq: castAfter(n).seq, how: "collapsed" });
    expect(report.consumedSeq).toBe(castAfter(n).seq);
    expect(flightOf(snap)).toEqual([expect.objectContaining({ origin: { from: "hand", moment: "m1", pose } })]);
    expect(showing(snap)).toEqual([]);
    expect(landings(stage, t + FRAME, taken)).toBe(1);
  });

  it("a cut flies it from the carried pose too, and nothing else is left in flight", () => {
    const stage = new Stage();
    const t = atRest(stage, run[i - 1]!, 0);
    stage.show(frameOf(cast, [cast.set], { moments: held, mode: "cut" }), t + FRAME);
    const snap = stage.inspect();
    expect(snap.flights.map((f) => f.card)).toEqual([card]);
    expect(flightOf(snap)[0]!.origin).toEqual({ from: "hand", moment: "m1", pose });
    expect(showing(snap)).toEqual([]);
    expect(landings(stage, t + FRAME, taken)).toBe(1);
  });

  it("a card the scene owns is drawn where its flight takes it, not held back", () => {
    const stage = new Stage();
    const t = atRest(stage, run[i - 1]!, 0);
    stage.show(frameOf(cast, [...fillers(1), castAfter(1)], { moments: taken }), t + FRAME);
    expect(showing(stage.inspect())).not.toEqual([]);
  });
});
