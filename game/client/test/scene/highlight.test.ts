// A highlight steps cards out of the table's light: the stack as the focus brings its spells (gold) and what they aim at
// (in its meaning), the app may ask for cards (choosing targets); each eases out over the theme's time and back, rises
// toward me as it does (and a tap reaches it where it rose), and the scrim dims the rest by the look's alpha.
import { describe as group, expect, it } from "vitest";
import { inQuad } from "../../src/layout/shape";
import type { Point, Quad } from "../../src/layout";
import type { CardId } from "../../src/protocol";
import { materials } from "../../src/theme";
import { NO_FOCUS, Stage, describe, pickDrawn } from "../../src/scene/stage";
import type { FocusTop, HighlightRequest, HighlightTone, StageView } from "../../src/scene/stage";
import { NO_CUES, corpusSteps, frameOf } from "./corpus";

const steps = corpusSteps().flat();
const bolt = steps.find((s) => s.name.startsWith("025"))!;
const board = steps.find((s) => s.name.startsWith("023"))!;
const FRAME = 16;
const HL = materials.highlight;
const centre = (q: Quad): Point => ({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 });
const at = (focus: Partial<FocusTop>): FocusTop => ({ ...NO_FOCUS, ...focus });

/** A creature of mine on the 023 board, and the piece that draws it. */
function mineOnBoard(): { card: CardId; piece: string } {
  const d = describe({ model: board.model, plan: board.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
  for (const [card, piece] of d.home) if (d.pieces.get(piece)?.kind === "unit") return { card, piece };
  throw new Error("no unit on the board");
}

const ask = (card: CardId, tone: HighlightTone = "mine"): HighlightRequest => ({ cards: new Map([[card, tone]]) });

group("what a highlight holds", () => {
  it("the stack as the focus: its spells in gold and what they aim at, over the stack's dim", () => {
    const d = describe({ model: bolt.model, plan: bolt.plan, cues: NO_CUES, focus: at({ layer: "stack" }), hover: null });
    const stack = [...d.pieces.keys()].filter((id) => id.startsWith("stack:"));
    expect(stack.length).toBeGreaterThan(0);
    for (const id of stack) expect(d.highlight.get(id)).toBe("spell");
    for (const a of d.aims) expect(d.highlight.has(a.to)).toBe(true);
    expect(d.scrim).toBe(HL.stack.dim);
    expect([...d.above].sort()).toEqual([...d.highlight.keys()].sort());
  });

  it("the cards the app asks for, at the piece that draws each, over the targets' lighter dim", () => {
    const { card, piece } = mineOnBoard();
    const d = describe({ model: board.model, plan: board.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null, highlight: ask(card) });
    expect([...d.highlight]).toEqual([[piece, "mine"]]);
    expect(d.highlightLook).toEqual(HL.target);
    expect(d.scrim).toBe(HL.target.dim);
    expect(HL.target.dim).toBeLessThan(HL.stack.dim);
  });

  it("nothing asked, nothing stepped out and no dim", () => {
    const d = describe({ model: board.model, plan: board.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
    expect(d.highlight.size).toBe(0);
    expect(d.scrim).toBe(0);
  });
});

group("a highlight's transition", () => {
  const actor = (v: StageView, id: string) => v.actors.find((a) => a.id === id)!;

  it("steps out over the theme's time, rises toward me, and steps back", () => {
    const { card, piece } = mineOnBoard();
    const stage = new Stage();
    let t = 0;
    stage.show(frameOf(board, [board.set], { mode: "cut" }), (t += FRAME));
    const rest = actor(stage.show(frameOf(board, []), (t += FRAME)).view, piece);
    expect(rest.hl).toBeNull();
    const t0 = t + FRAME;
    const first = stage.show(frameOf(board, [], { highlight: ask(card) }), t0);
    expect(actor(first.view, piece).hl?.k).toBe(0);
    expect(first.report.active).toBe(true);
    const half = actor(stage.show(frameOf(board, [], { highlight: ask(card) }), t0 + HL.ms / 2).view, piece);
    expect(half.hl!.k).toBeGreaterThan(0.5); // eased out: most of the way by half time
    expect(half.hl!.k).toBeLessThan(1);
    const done = stage.show(frameOf(board, [], { highlight: ask(card) }), t0 + HL.ms);
    const full = actor(done.view, piece);
    expect(full.hl).toMatchObject({ tone: "mine", k: 1, flat: HL.target.flat, halo: HL.target.halo });
    expect(full.sample.pos.y).toBeGreaterThan(rest.sample.pos.y + HL.target.lift * 0.9);
    expect(done.view.above.has(piece)).toBe(true);
    // Let go: back over the same time, then out of the light altogether.
    stage.show(frameOf(board, []), t0 + HL.ms + FRAME);
    const back = stage.show(frameOf(board, []), t0 + 2 * HL.ms + FRAME);
    expect(actor(back.view, piece).hl).toBeNull();
    expect(actor(back.view, piece).sample.pos.y).toBeCloseTo(rest.sample.pos.y, 6);
  });

  it("under reduced motion it is there at once", () => {
    const { card, piece } = mineOnBoard();
    const stage = new Stage({ reducedMotion: true });
    stage.show(frameOf(board, [board.set], { mode: "cut" }), FRAME);
    const v = stage.show(frameOf(board, [], { highlight: ask(card) }), 2 * FRAME).view;
    expect(actor(v, piece).hl?.k).toBe(1);
  });

  it("a tap reaches a risen card where it is drawn", () => {
    const { card, piece } = mineOnBoard();
    const stage = new Stage();
    let t = 0;
    stage.show(frameOf(board, [board.set], { mode: "cut" }), (t += FRAME));
    let v = stage.show(frameOf(board, [], { highlight: ask(card) }), (t += FRAME)).view;
    for (let k = 0; k < 40; k++) v = stage.show(frameOf(board, [], { highlight: ask(card) }), (t += FRAME)).view;
    const g = board.plan.hits.groups.find((x) => x.id === piece)!;
    const d = v.drawn.get(piece)!;
    expect(d.now.pos.y).toBeGreaterThan(d.rest.pos.y);
    // The middle of the group as drawn is reached, whatever was under its resting place.
    const moved = pickDrawn(board.plan, new Map([[piece, d]]), centre(g.quad));
    const hit = pickDrawn(board.plan, v.drawn, centre(g.quad));
    expect(moved?.id ?? hit?.id).toBe(piece);
    expect(inQuad(g.quad, centre(g.quad).x, centre(g.quad).y)).toBe(true);
  });
});
