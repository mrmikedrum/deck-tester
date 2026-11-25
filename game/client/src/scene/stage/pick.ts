// Picking what was drawn (docs "layout": the scene's `pick`): layout's hit groups, each moved with its piece from where
// it rests to where it was last drawn, so a tap on a card moving through a reflow reaches that card, not the group whose
// destination is there. At rest every piece is where layout put it, and this is layout's `hitTest` exactly (but for the
// seats' plates, which the chrome draws and takes the taps of): the same groups, the same draw order, the same stable ids. A piece that shows none of its cards (they are in flight to it, or
// the chrome still holds them) is not pickable; a card in flight has no group. Pure.
import { inQuad } from "../../layout";
import type { HitGroup, Point, Projector, Quad, SeatId, TablePlan, V3 } from "../../layout";
import type { CardId } from "../../protocol";
import { poseQuad } from "./poses";
import type { Sample } from "./types";

/**
 * A piece as it was drawn: where it is, where it rests as the plan put it (its hit group's quad was measured there; a
 * focus may draw it elsewhere), and whether a tap may reach it. A sifted card carries its card.
 */
export interface DrawnPiece {
  readonly now: Sample;
  readonly rest: Sample;
  readonly pickable: boolean;
  /** A stack card drawn as the table's focus: reached by the plan's `hits.up` group, measured where it stands up. */
  readonly up?: boolean;
  /** A sifted card: its card, whose it is, and its turn as drawn (poses `siftRoll`). */
  readonly sift?: { readonly card: CardId; readonly seat: SeatId | null; readonly roll: number };
}

/** The id a sifted card's hit group has: "sift:<card>". A tap on it acts on that card, as on the table. */
export const siftGroupId = (card: CardId): string => `sift:${card}`;

/**
 * The highest group in draw order under `p`, its quad moved to where its piece was drawn (`hitTest` at rest). While the
 * stack is the focus its cards are its focus groups (`hits.up`), in the order they are drawn. While a sift is open only
 * its cards are reached (each as a group of one card, kind "card"); a tap anywhere else reaches nothing, which takes the
 * sift down. Groups in `skip` are looked through (the layout audit sets a focus aside).
 */
export function pickDrawn(plan: TablePlan, drawn: ReadonlyMap<string, DrawnPiece>, p: Point, skip?: ReadonlySet<string>): HitGroup | null {
  const sifted = [...drawn.entries()].filter(([, d]) => d.sift);
  if (sifted.length) {
    let hit: HitGroup | null = null;
    sifted.forEach(([, d], i) => {
      const quad = poseQuad(plan.projector, { ...d.now, pos: { ...d.now.pos, y: d.now.pos.y + d.now.lift } }, d.sift?.roll ?? 0);
      if (d.sift && inQuad(quad, p.x, p.y)) hit = { id: siftGroupId(d.sift.card), kind: "card", seat: d.sift.seat, members: [d.sift.card], quad, order: 1e6 + i };
    });
    return hit;
  }
  // The stack as the focus: its cards are reached where they stand up, in the order they are drawn, over everything.
  const up = plan.stack.some((s) => drawn.get(`stack:${s.key}`)?.up);
  const groups = up ? [...plan.hits.groups.filter((g) => g.kind !== "stack"), ...(plan.hits.up ?? [])] : plan.hits.groups;
  let best: HitGroup | null = null;
  for (const g of groups) {
    // A seat's nameplate is chrome (it takes its own taps): the table under it is what a tap on the canvas reaches.
    if ((best && g.order < best.order) || skip?.has(g.id) || g.kind === "plate") continue;
    const d = drawn.get(g.id);
    if (d && !d.pickable) continue;
    if (inQuad(d ? movedQuad(plan.projector, g.quad, d) : g.quad, p.x, p.y)) best = g;
  }
  return best;
}

const lifted = (s: Sample): V3 => ({ x: s.pos.x, y: s.pos.y + s.lift, z: s.pos.z });

/** How tall a piece of scale 1 at `s` is on screen, px. */
function tall(proj: Projector, s: Sample): number {
  const c = lifted(s), h = 0.5 * s.s, u = proj.up;
  const a = proj.project({ x: c.x + u.x * h, y: c.y + u.y * h, z: c.z + u.z * h });
  const b = proj.project({ x: c.x - u.x * h, y: c.y - u.y * h, z: c.z - u.z * h });
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A group's quad carried from where its piece rests to where it is drawn: moved with its middle, scaled with its size. */
export function movedQuad(proj: Projector, q: Quad, d: DrawnPiece): Quad {
  const a = d.rest, b = d.now;
  if (a.pos.x === b.pos.x && a.pos.y === b.pos.y && a.pos.z === b.pos.z && a.s === b.s && a.lift === b.lift) return q;
  const from = proj.project(lifted(a)), to = proj.project(lifted(b));
  const ta = tall(proj, a);
  const k = ta > 0 ? tall(proj, b) / ta : 1;
  const at = (p: Point): Point => ({ x: to.x + (p.x - from.x) * k, y: to.y + (p.y - from.y) * k });
  return [at(q[0]), at(q[1]), at(q[2]), at(q[3])];
}
