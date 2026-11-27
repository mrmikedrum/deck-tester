// The table's focus layers as the scene draws them: the stack as the focus stands large where layout put it (and a tap
// reaches it there), its arcs run to what it aims at, a lean-in carries one seat up over the middle, a sift fans a
// pile's cards out (a tap reaching each card), and my wells say what they hold.
import { describe as group, expect, it } from "vitest";
import { bounds, inQuad } from "../../src/layout/shape";
import { planTable, tableInputOf } from "../../src/layout";
import type { Point, Quad } from "../../src/layout";
import { diff, modelOf } from "../../src/model";
import { groupsOf } from "../../src/play/reach";
import { decodeSnapshot } from "../../src/protocol";
import { catalog, creature, rawCorpus, spell, tableOf, viewerOf } from "../model/fixtures";
import { NO_FOCUS, SCRIM, Stage, chipsOf, describe, pickDrawn, poseQuad, siftRoll } from "../../src/scene/stage";
import type { FocusTop, StageView } from "../../src/scene/stage";
import { NO_CUES, corpusSteps, frameOf } from "./corpus";
import type { CardId } from "../../src/protocol";
import type { Mark } from "../../src/play";
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
  it("stands on layout's stackUp quad, keeps where the plan set it aside as its base, and lays one scrim over the table", () => {
    const d = describe({ model: bolt.model, plan: bolt.plan, cues: NO_CUES, focus: at({ layer: "stack" }), hover: null });
    const key = bolt.plan.stack[0]!.key;
    const p = d.pieces.get(`stack:${key}`)!;
    expect(p.draw).toMatchObject({ t: "stack", up: true });
    const q = bounds(poseQuad(bolt.plan.projector, p.pose)),
      want = bounds(bolt.plan.stackUp[0]!.quad);
    for (const k of ["l", "r", "t", "b"] as const) expect(Math.abs(q[k] - want[k]), k).toBeLessThan(1);
    expect(p.base).toBeDefined();
    // One scrim, no second dim: the table keeps its tone, nothing fades, and the stack and what it aims at stand above.
    expect(d.scrim).toBe(SCRIM.alpha);
    expect(d.tableTone).toBe(1);
    const plain = describe({ model: bolt.model, plan: bolt.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null }).pieces;
    for (const piece of d.pieces.values()) if (piece.kind === "page") expect(piece.look.fade, piece.id).toBe(plain.get(piece.id)!.look.fade);
    else expect(piece.look.fade, piece.id).toBe(0);
    expect(d.above.has(`stack:${key}`)).toBe(true);
    // Set aside, it stands where the plan set it, small.
    const aside = describe({ model: bolt.model, plan: bolt.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null }).pieces.get(`stack:${key}`)!;
    expect(aside.base).toBeUndefined();
    expect(aside.draw).toMatchObject({ up: false, tagScale: 1 });
  });
  it("its scrim eases in over 250 ms as it comes up and out over 180 ms as it is set aside", () => {
    const stage = new Stage();
    const up = at({ layer: "stack" });
    stage.show(frameOf(bolt, [bolt.set], { mode: "cut", focus: NO_FOCUS }), 1000);
    expect(stage.show(frameOf(bolt, [], { focus: up }), 1016).view.scrim).toBe(0);
    const mid = stage.show(frameOf(bolt, [], { focus: up }), 1016 + SCRIM.inMs / 2).view.scrim;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(SCRIM.alpha);
    expect(stage.show(frameOf(bolt, [], { focus: up }), 1016 + SCRIM.inMs).view.scrim).toBe(SCRIM.alpha);
    expect(stage.show(frameOf(bolt, [], { focus: NO_FOCUS }), 2000).view.scrim).toBe(SCRIM.alpha);
    expect(stage.show(frameOf(bolt, [], { focus: NO_FOCUS }), 2000 + SCRIM.outMs).view.scrim).toBe(0);
  });
  it("a tap on the large card reaches the stack's group", () => {
    const view = rest(bolt, at({ layer: "stack" }));
    const g = pickDrawn(bolt.plan, view.drawn, centre(bolt.plan.stackUp[0]!.quad));
    expect(g?.id).toBe(`stack:${bolt.plan.stack[0]!.key}`);
  });
  it("every card the focus shows is reached, though the open middle had no room for it set aside", () => {
    // Eight spells on the opponent-spell table: set aside, the eighth lies under the seventh; held up, all eight show.
    const raw = rawCorpus.get("014-play-opponent-spell-targets-me-stack-targets-card.json")!;
    const view = raw.view as { stack: { id: number; source: { id: number } }[] };
    const thorn = view.stack[view.stack.length - 1]!;
    const stack = Array.from({ length: 8 }, (_, i) => ({ ...thorn, id: 900 + i, source: { ...thorn.source, id: 9000 + i } }));
    const snap = decodeSnapshot({ ...raw, decision: null, view: { ...view, stack } });
    if (!snap.ok) throw new Error(snap.error.summary);
    const model = modelOf(snap.value, catalog, viewerOf())!;
    const plan = planTable(tableInputOf(model, { viewport: { w: 1180, h: 820 } }));
    const spilled = plan.stack.findIndex((s) => !s.reachable);
    expect(spilled).toBeGreaterThan(0);
    expect(plan.stackUp[spilled]!.reachable).toBe(true);
    const shown = rest({ name: "eight", model, plan, set: diff(null, model, 1) }, at({ layer: "stack" }));
    // The strip of it no card nearer the eye covers.
    const q = plan.stackUp[spilled]!.quad, b = bounds(q);
    let strip: Point | null = null;
    for (let x = b.l + 2; x < b.r && !strip; x += 4)
      for (let y = b.t + 2; y < b.b && !strip; y += 4)
        if (inQuad(q, x, y) && !plan.stackUp.slice(0, spilled).some((s) => inQuad(s.quad, x, y))) strip = { x, y };
    expect(strip).not.toBeNull();
    expect(pickDrawn(plan, shown.drawn, strip!)?.id).toBe(`stack:${plan.stack[spilled]!.key}`);
    // Play takes a tap on it (its group is one a tap can reach), and every card the focus shows is reached.
    expect(groupsOf(plan.hits).map((g) => g.id)).toContain(`stack:${plan.stack[spilled]!.key}`);
    for (const s of plan.stackUp) expect(pickDrawn(plan, shown.drawn, centre(s.quad))?.id).toMatch(/^stack:/);
  });
  it("points an ability counter at the exact activation rather than the permanent", () => {
    const source = creature(301, "Marath, Will of the Wild", "You");
    const model = tableOf({
      seats: { You: { battlefield: [source] } },
      stack: [
        { id: 31, source, spell: false },
        { id: 32, source, spell: false },
        { id: 33, source: spell(302, "Stifle", "Atraxa", "Counter target activated or triggered ability."), targets: [301], abilityTargets: [31] },
      ],
    });
    const plan = planTable(tableInputOf(model, { viewport: { w: 1180, h: 820 } }));
    const scene = describe({ model, plan, focus: at({ layer: "stack" }), cues: NO_CUES, hover: null });
    expect(scene.aims).toHaveLength(1);
    expect(scene.aims[0]).toMatchObject({ from: "stack:33", to: "stack:31", onto: "spell" });
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

group("a seat's spread", () => {
  it("lays the seat's cards on the sheet, each its own tap; the table stays where it was, its plaque's taps the chrome's", () => {
    const seat = [...board.plan.seats.keys()][2]!;
    const view = rest(board, at({ layer: "lean", seat }));
    const plate = board.plan.hits.groups.find((g) => g.id === `plate:${seat}`)!;
    const still = rest(board, at({}));
    expect(view.drawn.get(plate.id)!.now.pos).toEqual(still.drawn.get(plate.id)!.now.pos);
    const sifted = [...view.drawn.entries()].filter(([id]) => id.startsWith("sift:") && id !== "sift:scrim");
    expect(sifted.length).toBeGreaterThan(0);
    for (const [id, dp] of sifted) expect(pickDrawn(board.plan, view.drawn, centre(poseQuad(board.plan.projector, dp.now, dp.sift?.roll ?? 0)))?.id).toBe(id);
    expect(pickDrawn(board.plan, view.drawn, { x: 4, y: 4 })).toBeNull();
  });
});

group("a sift", () => {
  const pile = board.plan.hits.groups.filter((g) => g.members.length > 1).sort((a, b) => b.members.length - a.members.length)[0]!;
  it("keeps what the decision says of each card: an option, one chosen, one not offered (review: all looked alike)", () => {
    const named = (g: { members: readonly CardId[] }) => new Set(g.members.map((id) => board.model.cards.get(id)?.name)).size;
    const mixed = board.plan.hits.groups.filter((g) => g.members.length >= 3).sort((a, b) => named(b) - named(a))[0]!;
    const [opt, sel, none] = mixed.members as [CardId, CardId, CardId];
    const cues = { ...NO_CUES, marks: { ...NO_CUES.marks, cards: new Map<CardId, Mark>([[opt, "option"], [sel, "selected"]]) } };
    const d = describe({ model: board.model, plan: board.plan, cues, focus: at({ layer: "sift", group: mixed.id }), hover: null });
    const sifted = (id: CardId) => d.pieces.get(`sift:${id}`)!;
    expect([sifted(opt).mark, sifted(sel).mark, sifted(none).mark]).toEqual(["option", "selected", null]);
    expect([sifted(opt).look.glow, sifted(sel).look.glow, sifted(none).look.glow]).toEqual([1, 1, 0]);
  });

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
