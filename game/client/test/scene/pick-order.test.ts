// What a tap reaches where cards overlap: the card drawn on top. A highlighted card is drawn over the rest (the focus
// pass), so where it rises over a neighbour that layout orders above it, it is the one reached; under a zoom, the card
// the ray meets is reached by its identity, whatever the table's camera sees behind that point; a ray that meets no card
// reaches nothing, and with a sift open only the sifted card it meets.
import { describe, expect, it } from "vitest";
import { inQuad } from "../../src/layout/shape";
import type { Point, Quad } from "../../src/layout";
import { NO_FOCUS, Stage, movedQuad, pickDrawn, pickHit } from "../../src/scene/stage";
import type { DrawnPiece } from "../../src/scene/stage";
import type { CardId } from "../../src/protocol";
import { corpusSteps, frameOf } from "./corpus";

const board = corpusSteps().flat().find((s) => s.name.startsWith("023"))!;
const centre = (q: Quad): Point => ({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 });

/** The board at rest, and two of its cards: `under` lower in layout's order, carried to stand where `over` is drawn. */
function overlapping(highlighted: boolean) {
  const stage = new Stage();
  stage.show(frameOf(board, [board.set], { mode: "cut" }), 16);
  let drawn = stage.show(frameOf(board, [], { focus: NO_FOCUS }), 32).view.drawn;
  const units = board.plan.hits.groups.filter((g) => g.members.length > 0 && g.kind !== "stack" && !g.id.startsWith("command:") && drawn.get(g.id)?.pickable).sort((a, b) => a.order - b.order);
  const under = units[0]!, over = units.at(-1)!;
  // A card stepped out of the light rises over its neighbour: here, all the way onto it.
  const d = drawn.get(under.id)!, o = drawn.get(over.id)!;
  const carried: DrawnPiece = { ...d, now: { ...o.now }, ...(highlighted ? { above: true } : {}) };
  drawn = new Map([...drawn, [under.id, carried]]);
  const at = centre(movedQuad(board.plan.projector, over.quad, o));
  return { drawn, under, over, at };
}

describe("picking where cards overlap", () => {
  it("both cover the point; layout's order reaches the upper one", () => {
    const { drawn, under, over, at } = overlapping(false);
    expect(inQuad(movedQuad(board.plan.projector, under.quad, drawn.get(under.id)!), at.x, at.y)).toBe(true);
    expect(pickDrawn(board.plan, drawn, at)?.id).toBe(over.id);
  });

  it("a highlighted card is drawn over the rest, so the whole board's pick reaches it", () => {
    const { drawn, under, at } = overlapping(true);
    expect(pickDrawn(board.plan, drawn, at)?.id).toBe(under.id);
    // Looked through (the audit's skip), the one under it again.
    expect(pickDrawn(board.plan, drawn, at, new Set([under.id]))?.id).not.toBe(under.id);
  });

  it("the stage marks what a highlight steps out of the light", () => {
    const stage = new Stage({ reducedMotion: true });
    stage.show(frameOf(board, [board.set], { mode: "cut" }), 16);
    const g = board.plan.hits.groups.find((x) => x.members.length > 0 && x.kind !== "stack" && !x.id.startsWith("command:"))!;
    const v = stage.show(frameOf(board, [], { highlight: { cards: new Map([[g.members[0]!, "mine"]]) } }), 32).view;
    expect(v.drawn.get(g.id)?.above).toBe(true);
  });

  it("under a zoom, the card the ray met is reached by its identity", () => {
    const { drawn, under, over, at } = overlapping(false);
    // The ray met the lower card at a point the table's camera sees the upper one on.
    const point = board.plan.projector.onTable(at.x, at.y, 0);
    expect(pickDrawn(board.plan, drawn, board.plan.projector.project(point))?.id).toBe(over.id);
    const met = { id: under.id, point };
    expect(pickHit(board.plan, drawn, met)?.id).toBe(under.id);
  });

  it("under a zoom, a ray that met no card reaches nothing: never what the table's camera sees there", () => {
    const { drawn, under, at } = overlapping(false);
    const point = board.plan.projector.onTable(at.x, at.y, 0);
    // The table's plane, or the only card met looked through.
    const plane = { id: null, point },
      skipped = { id: under.id, point };
    expect(pickHit(board.plan, drawn, plane)).toBeNull();
    expect(pickHit(board.plan, drawn, skipped, new Set([under.id]))).toBeNull();
  });

  it("under a zoom with a sift open, the sifted card the ray met is reached, never one over it or the table", () => {
    const { drawn: table, over } = overlapping(false);
    // Two sifted cards drawn in the same place, the second over the first.
    const o = table.get(over.id)!;
    const sifted = (card: number): DrawnPiece => ({ now: o.now, rest: o.now, pickable: true, sift: { card: card as CardId, seat: null, roll: 0, members: [card as CardId], region: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } });
    const drawn = new Map([...table, ["sift:1", sifted(1)], ["sift:2", sifted(2)]]);
    const point = { x: o.now.pos.x, y: o.now.pos.y, z: o.now.pos.z };
    const one = { id: "sift:1", point },
      card = { id: over.id, point };
    expect(pickHit(board.plan, drawn, one)?.id).toBe("sift:1");
    expect(pickHit(board.plan, drawn, card)).toBeNull();
  });
});
