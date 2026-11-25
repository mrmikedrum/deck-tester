// The table's focus layers as the scene draws them: the stack as the focus stands large where layout put it (and a tap
// reaches it there), its arcs run to what it aims at, a lean-in carries one seat up over the middle, a sift fans a
// pile's cards out (a tap reaching each card), and my wells say what they hold.
import { describe as group, expect, it } from "vitest";
import { bounds } from "../../src/layout/shape";
import type { Point, Quad } from "../../src/layout";
import { NO_FOCUS, Stage, chipsOf, describe, pickDrawn, poseQuad, siftRoll } from "../../src/scene/stage";
import type { FocusTop, StageView } from "../../src/scene/stage";
import { NO_CUES, corpusSteps, frameOf } from "./corpus";
import type { Step } from "./corpus";

const steps = corpusSteps().flat();
const bolt = steps.find((s) => s.name.startsWith("025"))!;
const board = steps.find((s) => s.name.startsWith("023"))!;
const FRAME = 16;
const centre = (q: Quad): Point => ({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 });
const at = (focus: Partial<FocusTop>): FocusTop => ({ ...NO_FOCUS, ...focus });

/** Shows `step` cut, then under `focus` until nothing moves. */
function rest(step: Step, focus: FocusTop): StageView {
  const stage = new Stage();
  let t = 0;
  stage.show(frameOf(step, [step.set], { mode: "cut" }), (t += FRAME));
  let { view, report } = stage.show(frameOf(step, [], { focus }), (t += FRAME));
  for (let k = 0; k < 400 && report.active; k++) ({ view, report } = stage.show(frameOf(step, [], { focus }), (t += FRAME)));
  return view;
}

group("the stack as the table's focus", () => {
  it("stands on layout's stackUp quad, keeps where the plan set it aside as its base, and dims the table", () => {
    const d = describe({ model: bolt.model, plan: bolt.plan, cues: NO_CUES, focus: at({ layer: "stack" }), hover: null });
    const key = bolt.plan.stack[0]!.key;
    const p = d.pieces.get(`stack:${key}`)!;
    expect(p.draw).toMatchObject({ t: "stack", up: true });
    const q = bounds(poseQuad(bolt.plan.projector, p.pose)),
      want = bounds(bolt.plan.stackUp[0]!.quad);
    for (const k of ["l", "r", "t", "b"] as const) expect(Math.abs(q[k] - want[k]), k).toBeLessThan(1);
    expect(p.base).toBeDefined();
    expect(d.tableTone).toBeLessThan(1);
    // Set aside, it stands where the plan set it, small.
    const aside = describe({ model: bolt.model, plan: bolt.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null }).pieces.get(`stack:${key}`)!;
    expect(aside.base).toBeUndefined();
    expect(aside.draw).toMatchObject({ up: false, tagScale: 1 });
  });
  it("a tap on the large card reaches the stack's group", () => {
    const view = rest(bolt, at({ layer: "stack" }));
    const g = pickDrawn(bolt.plan, view.drawn, centre(bolt.plan.stackUp[0]!.quad));
    expect(g?.id).toBe(`stack:${bolt.plan.stack[0]!.key}`);
  });
  it("its arc runs from the spell to Princess's plate, ending at the plate's top", () => {
    const view = rest(bolt, at({ layer: "stack" }));
    expect(view.aims).toHaveLength(1);
    const a = view.aims[0]!;
    const plate = bolt.plan.hits.groups.find((g) => g.kind === "plate" && g.seat === bolt.model.stack[0]!.targets.map((t) => ("seat" in t ? t.seat : null))[0])!;
    const end = bolt.plan.projector.project(a.points[a.points.length - 1]!);
    const b = bounds(plate.quad);
    expect(end.x).toBeGreaterThan(b.l);
    expect(end.x).toBeLessThan(b.r);
    expect(Math.abs(end.y - b.t)).toBeLessThan(20);
  });
});

group("leaning in", () => {
  it("carries every piece of the seat up and squared to me; its plaque's tap is carried with it", () => {
    const seat = [...board.plan.seats.keys()][2]!;
    const view = rest(board, at({ layer: "lean", seat }));
    const plate = board.plan.hits.groups.find((g) => g.id === `plate:${seat}`)!;
    const d = view.drawn.get(plate.id)!;
    expect(d.now.pos.y).toBeGreaterThan(3);
    const moved = view.drawn.get(plate.id)!;
    const c = board.plan.projector.project({ ...moved.now.pos, y: moved.now.pos.y + 0.3 * moved.now.s });
    expect(pickDrawn(board.plan, view.drawn, c)?.id).toBe(plate.id);
  });
});

group("a sift", () => {
  const pile = board.plan.hits.groups.filter((g) => g.members.length > 1).sort((a, b) => b.members.length - a.members.length)[0]!;
  it("fans the group's cards out over a shade, each its own tap; a tap off them reaches nothing", () => {
    const d = describe({ model: board.model, plan: board.plan, cues: NO_CUES, focus: at({ layer: "sift", group: pile.id }), hover: null });
    const cards = [...d.pieces.values()].filter((p) => p.draw.t === "sift");
    expect(cards.map((p) => p.face).sort()).toEqual([...pile.members].sort());
    expect(d.pieces.get("sift:scrim")).toBeDefined();
    // every card is still counted once, by its pile
    expect([...d.home.values()].filter((h) => h.startsWith("sift:"))).toEqual([]);
    const view = rest(board, at({ layer: "sift", group: pile.id }));
    for (const id of pile.members) {
      const dp = view.drawn.get(`sift:${id}`)!;
      const g = pickDrawn(board.plan, view.drawn, centre(poseQuad(board.plan.projector, dp.now)));
      expect(g).toMatchObject({ id: `sift:${id}`, kind: "card", members: [id] });
    }
    expect(pickDrawn(board.plan, view.drawn, { x: 4, y: 4 })).toBeNull();
  });
  it("a tapped card is reached as it is drawn, turned 15°, not upright", () => {
    const view = rest(board, at({ layer: "sift", group: pile.id }));
    const id = pile.members[0]!;
    const dp = view.drawn.get(`sift:${id}`)!;
    const turned = { ...dp, sift: { ...dp.sift!, roll: siftRoll(true, 1) } };
    const only = new Map([[`sift:${id}`, turned]]);
    const proj = board.plan.projector;
    const tq = poseQuad(proj, turned.now, turned.sift.roll), uq = poseQuad(proj, turned.now);
    const c = centre(tq);
    const toward = (p: Point, k: number): Point => ({ x: p.x + (c.x - p.x) * k, y: p.y + (c.y - p.y) * k });
    // Clockwise as I see it: its foot-right corner goes down and left of the upright one's.
    for (let i = 0; i < 4; i++) {
      expect(pickDrawn(board.plan, only, toward(tq[i]!, 0.04))?.id, `turned corner ${i}`).toBe(`sift:${id}`);
      expect(pickDrawn(board.plan, only, toward(uq[i]!, 0.02)), `upright corner ${i}`).toBeNull();
    }
  });
  it("closing it puts the cards back into the pile", () => {
    const stage = new Stage();
    let t = 0;
    stage.show(frameOf(board, [board.set], { mode: "cut" }), (t += FRAME));
    for (let k = 0; k < 60; k++) stage.show(frameOf(board, [], { focus: at({ layer: "sift", group: pile.id }) }), (t += FRAME));
    let r = stage.show(frameOf(board, [], {}), (t += FRAME));
    const back = stage.inspect().pieces.filter((p) => p.id.startsWith("sift:") && p.id !== "sift:scrim");
    expect(back.length).toBe(pile.members.length);
    for (let k = 0; k < 100 && r.report.active; k++) r = stage.show(frameOf(board, [], {}), (t += FRAME));
    expect(stage.inspect().pieces.filter((p) => p.id.startsWith("sift:"))).toEqual([]);
  });
});

group("wells", () => {
  it("mine say what they hold and how many are tapped; theirs say their lands", () => {
    const d = describe({ model: bolt.model, plan: bolt.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
    const wells = [...d.pieces.values()].flatMap((p) => (p.draw.t === "unit" && p.draw.well ? [{ seat: p.seat, ...p.draw.well }] : []));
    const mine = wells.filter((w) => w.seat === bolt.model.viewer.perspective);
    expect(mine.length).toBeGreaterThanOrEqual(5);
    expect(mine.map((w) => w.sign)).toContain("Mountain ×4");
    expect(mine.some((w) => w.sub && /tapped$/.test(w.sub))).toBe(true);
    // neighbours' signs alternate
    expect(mine.some((w) => w.alt) && mine.some((w) => !w.alt)).toBe(true);
    const theirs = wells.filter((w) => w.seat !== bolt.model.viewer.perspective);
    expect(theirs.every((w) => w.theirs && /^Lands \d+$/.test(w.sign))).toBe(true);
    expect(wells.every((w) => w.colours.length >= 1)).toBe(true);
  });
});

group("a card's counter chips", () => {
  it("from the engine's names: +1/+1 reads \"+n\", loyalty stays on the face", () => {
    const c = { counters: { "+1/+1": 2, Loyalty: 3, Charge: 4 } } as unknown as Parameters<typeof chipsOf>[0];
    expect(chipsOf(c).map((x) => [x.text, x.sub])).toEqual([
      ["+2", null],
      ["4", "charge"],
    ]);
  });
});
