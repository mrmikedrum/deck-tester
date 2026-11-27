// What the scene takes of the focus, the pointer and the motion setting: the table's own layers open under a chrome
// layer still decide how the table looks; hover lifts the hit group under a mouse pointer; reduced motion shortens even
// a look's change.
import { describe as group, expect, it } from "vitest";
import { sheetOf } from "../../src/layout";
import { bounds } from "../../src/layout/shape";
import { DURATION, NO_FOCUS, SCRIM, Stage, describe, paced, poseQuad } from "../../src/scene/stage";
import type { FocusTop } from "../../src/scene/stage";
import type { BoardCues } from "../../src/play";
import { NO_CUES, corpusSteps, frameOf } from "./corpus";

const steps = corpusSteps().flat();
const stacked = steps.find((s) => s.model.stack.length > 0 && s.plan.stack.length > 0)!;
const carded = steps.find((s) => s.plan.hits.groups.some((g) => g.kind === "card"))!;
const FRAME = 16;

const top = (layer: FocusTop["layer"], table?: FocusTop["table"]): FocusTop => ({ ...NO_FOCUS, layer, ...(table ? { table } : {}) });
const scrim = (focus: FocusTop) => describe({ model: stacked.model, plan: stacked.plan, cues: NO_CUES, focus, hover: null }).scrim;

group("focus below the top", () => {
  it("the stack's scrim holds while a chrome layer sits over it", () => {
    expect(scrim(top("stack"))).toBe(SCRIM.alpha);
    expect(scrim(top("sheet", [{ layer: "stack", seat: null, group: null }]))).toBe(SCRIM.alpha);
    expect(scrim(top("inspector", [{ layer: "stack", seat: null, group: null }]))).toBe(SCRIM.alpha);
    // Only the top is known (an app that sends no table layers): a chrome layer over it is all there is.
    expect(scrim(top("sheet"))).toBe(0);
    expect(scrim(NO_FOCUS)).toBe(0);
  });
  it("the topmost table layer decides (a seat's spread over the stack)", () => {
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
    // (The scrim and the printed card come up over their first 250 ms.)
    stage.show(frameOf(stacked, [], { focus: under }), 30 * FRAME);
    const { report } = stage.show(frameOf(stacked, [], { focus: top("sheet", [{ layer: "stack", seat: null, group: null }]) }), 31 * FRAME);
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

group("a sheet, as drawn", () => {
  // The engine's sheet (layout focus.test.ts, arrange/sheet.test.ts) as the stage hands it to the view: each card at the
  // table's mesh size where the sheet put its face, and the table under it where the plan put it.
  const step = steps.reduce((a, b) => (b.plan.seats.size > a.plan.seats.size || (b.plan.seats.size === a.plan.seats.size && b.plan.hits.groups.length > a.plan.hits.groups.length) ? b : a));
  const seats = [...step.plan.seats.keys()];
  const rest = describe({ model: step.model, plan: step.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
  for (const i of [1, 2, 3])
    it(`seat ${i}'s spread: each card's corners are the sheet's, and nothing on the table moves`, () => {
      const seat = seats[i]!, proj = step.plan.projector;
      const d = describe({ model: step.model, plan: step.plan, cues: NO_CUES, focus: { ...NO_FOCUS, layer: "lean", seat }, hover: null });
      const sh = sheetOf(step.model, step.plan, { kind: "spread", seat })!;
      expect(sh.places.length).toBeGreaterThan(0);
      for (const pl of sh.places) {
        const p = d.pieces.get(`sift:${pl.top}`)!;
        expect(p.pose.s).toBe(sh.scale);
        const drawn = bounds(poseQuad(proj, p.pose, pl.turn === "notch" ? -Math.PI / 12 : 0)), solved = bounds(pl.quad);
        for (const k of ["l", "r", "t", "b"] as const) expect(drawn[k], `${pl.top} ${k}`).toBeCloseTo(solved[k], 0);
      }
      for (const [id, p] of rest.pieces) expect(d.pieces.get(id)?.pose, id).toEqual(p.pose);
    });
});
