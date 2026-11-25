// What the scene takes of the focus, the pointer and the motion setting: the table's own layers open under a chrome
// layer still decide how the table looks; hover lifts the hit group under a mouse pointer; reduced motion shortens even
// a look's change.
import { describe as group, expect, it } from "vitest";
import { leanOf } from "../../src/layout";
import { leanedUnitAt } from "../../src/layout/focus";
import { bounds, unitShape } from "../../src/layout/shape";
import { DIM, DURATION, NO_FOCUS, Stage, describe, paced, poseQuad } from "../../src/scene/stage";
import type { FocusTop } from "../../src/scene/stage";
import type { BoardCues } from "../../src/play";
import { NO_CUES, corpusSteps, frameOf } from "./corpus";

const steps = corpusSteps().flat();
const stacked = steps.find((s) => s.model.stack.length > 0 && s.plan.stack.length > 0)!;
const carded = steps.find((s) => s.plan.hits.groups.some((g) => g.kind === "card"))!;
const FRAME = 16;

const top = (layer: FocusTop["layer"], table?: FocusTop["table"]): FocusTop => ({ ...NO_FOCUS, layer, ...(table ? { table } : {}) });
const tone = (focus: FocusTop) => describe({ model: stacked.model, plan: stacked.plan, cues: NO_CUES, focus, hover: null }).tableTone;

group("focus below the top", () => {
  it("the stack's dimming holds while a chrome layer sits over it", () => {
    expect(tone(top("stack"))).toBe(DIM.table);
    expect(tone(top("sheet", [{ layer: "stack", seat: null, group: null }]))).toBe(DIM.table);
    expect(tone(top("inspector", [{ layer: "stack", seat: null, group: null }]))).toBe(DIM.table);
    // Only the top is known (an app that sends no table layers): a chrome layer over it is all there is.
    expect(tone(top("sheet"))).toBe(1);
    expect(tone(NO_FOCUS)).toBe(1);
  });
  it("the topmost table layer decides (a lean-in over the stack)", () => {
    const seat = [...stacked.plan.seats.keys()].find((s) => s !== stacked.model.viewer.perspective)!;
    const lean = { layer: "lean" as const, seat, group: null };
    const a = describe({ model: stacked.model, plan: stacked.plan, cues: NO_CUES, focus: { ...NO_FOCUS, layer: "lean", seat }, hover: null });
    const b = describe({ model: stacked.model, plan: stacked.plan, cues: NO_CUES, focus: top("sheet", [{ layer: "stack", seat: null, group: null }, lean]), hover: null });
    expect(b.tableTone).toBe(a.tableTone);
    expect([...b.pieces.values()].map((p) => p.look)).toEqual([...a.pieces.values()].map((p) => p.look));
  });
  it("a chrome layer opening over the stack moves nothing on the table", () => {
    const stage = new Stage();
    const under = top("stack", [{ layer: "stack", seat: null, group: null }]);
    stage.show(frameOf(stacked, [stacked.set], { focus: under, mode: "cut" }), FRAME);
    const { report } = stage.show(frameOf(stacked, [], { focus: top("sheet", [{ layer: "stack", seat: null, group: null }]) }), 2 * FRAME);
    expect(report.active).toBe(false);
  });
});

group("hover", () => {
  it("lifts the hit group under the pointer, and nothing else", () => {
    const g = carded.plan.hits.groups.find((x) => x.kind === "card")!;
    const d = describe({ model: carded.model, plan: carded.plan, cues: NO_CUES, focus: NO_FOCUS, hover: g.id });
    const plain = describe({ model: carded.model, plan: carded.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
    expect(d.pieces.get(g.id)!.look.lift).toBeGreaterThan(plain.pieces.get(g.id)!.look.lift);
    for (const [id, p] of d.pieces) if (id !== g.id) expect(p.look, id).toEqual(plain.pieces.get(id)!.look);
  });
  it("the stage draws it lifted, and lets it down when the pointer leaves", () => {
    const g = carded.plan.hits.groups.find((x) => x.kind === "card")!;
    const stage = new Stage();
    let t = 0;
    stage.show(frameOf(carded, [carded.set], { mode: "cut" }), (t += FRAME));
    const lift = () => stage.inspect().pieces.find((p) => p.id === g.id)!.now.lift;
    for (let k = 0; k < 30; k++) stage.show(frameOf(carded, [], { hover: g.id }), (t += FRAME));
    expect(lift()).toBeGreaterThan(0.05);
    for (let k = 0; k < 30; k++) stage.show(frameOf(carded, [], { hover: null }), (t += FRAME));
    expect(lift()).toBe(0);
  });
});

group("reduced motion", () => {
  it("a look's change (a mark's glow) is shortened too", () => {
    const g = carded.plan.hits.groups.find((x) => x.kind === "card")!;
    const marked: BoardCues = { ...NO_CUES, marks: { ...NO_CUES.marks, cards: new Map([[g.members[0]!, "option"]]) } };
    const glowTime = (reducedMotion: boolean): number => {
      const stage = new Stage();
      let t = 0;
      stage.show(frameOf(carded, [carded.set], { mode: "cut", reducedMotion }), (t += FRAME));
      const from = t;
      for (let k = 0; k < 100; k++) {
        stage.show(frameOf(carded, [], { cues: marked, reducedMotion }), (t += FRAME));
        if (stage.inspect().pieces.find((p) => p.id === g.id)!.now.glow >= 1) return t - from;
      }
      return Infinity;
    };
    expect(glowTime(false)).toBeGreaterThanOrEqual(DURATION.tap);
    expect(glowTime(true)).toBeLessThanOrEqual(paced(DURATION.tap, { compressed: false, reduced: true }) + FRAME);
  });
});

group("leaning in, as drawn", () => {
  // The lean-in's solver measures its grown cards on quads it rebuilds (layout focus.test.ts); this measures the poses the
  // stage hands the view: every unit on a leaned side seat is drawn where the solver put it, grown and carried.
  const step = steps.reduce((a, b) => (sideUnits(b) > sideUnits(a) ? b : a));
  function sideUnits(s: (typeof steps)[number]): number {
    const seats = [...s.plan.seats.keys()];
    return [1, 3].reduce((n, i) => n + (s.plan.seats.get(seats[i]!)?.units.length ?? 0), 0);
  }
  const seats = [...step.plan.seats.keys()];
  for (const i of [1, 3])
    it(`seat ${i}: each card's corners are where the solver grew and carried it`, () => {
      const seat = seats[i]!, l = leanOf(step.plan, seat)!, proj = step.plan.projector;
      const d = describe({ model: step.model, plan: step.plan, cues: NO_CUES, focus: { ...NO_FOCUS, layer: "lean", seat }, hover: null });
      const units = step.plan.seats.get(seat)!.units;
      expect(units.length).toBeGreaterThan(1);
      for (const u of units) {
        const p = d.pieces.get(u.id)!;
        const drawn = bounds(poseQuad(proj, p.pose, -p.look.tap * (Math.PI / 2)));
        const solved = bounds(unitShape(proj, seat, u, false, leanedUnitAt(proj, l, u, l.grow)).face);
        for (const k of ["l", "r", "t", "b"] as const) expect(drawn[k], `${u.id} ${k}`).toBeCloseTo(solved[k], 0);
      }
    });
});
