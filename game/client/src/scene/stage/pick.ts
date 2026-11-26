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
  /** Stepped out of the light (a highlight): drawn over everything else on the table, so reached first. */
  readonly above?: boolean;
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
  const sifted = siftedOf(drawn);
  if (sifted.length) {
    let hit: HitGroup | null = null;
    sifted.forEach((d, i) => {
      const g = siftGroup(plan, d, i);
      if (inQuad(g.quad, p.x, p.y)) hit = g;
    });
    return hit;
  }
  // What a highlight steps out of the light is drawn over the rest (the focus pass): reached before anything under it.
  let best: HitGroup | null = null,
    above: HitGroup | null = null;
  for (const g of candidates(plan, drawn)) {
    // A seat's nameplate is chrome (it takes its own taps): the table under it is what a tap on the canvas reaches.
    if (skip?.has(g.id) || g.kind === "plate") continue;
    const d = drawn.get(g.id);
    if (d && !d.pickable) continue;
    const top = d?.above ? above : best;
    if (top && g.order < top.order) continue;
    if (!inQuad(d ? movedQuad(plan.projector, g.quad, d) : g.quad, p.x, p.y)) continue;
    if (d?.above) above = g;
    else best = g;
  }
  return above ?? best;
}

/** The groups a tap may reach: the stack as the focus is reached where it stands up (layout's `hits.up`). */
function candidates(plan: TablePlan, drawn: ReadonlyMap<string, DrawnPiece>): readonly HitGroup[] {
  const up = plan.stack.some((s) => drawn.get(`stack:${s.key}`)?.up);
  return up ? [...plan.hits.groups.filter((g) => g.kind !== "stack"), ...(plan.hits.up ?? [])] : plan.hits.groups;
}

type Sifted = DrawnPiece & { readonly sift: NonNullable<DrawnPiece["sift"]> };

/** The sifted cards as drawn, in draw order (the later over the earlier). */
const siftedOf = (drawn: ReadonlyMap<string, DrawnPiece>): Sifted[] => [...drawn.values()].filter((d): d is Sifted => !!d.sift);

/** A sifted card's group: one card, measured where it was drawn, over everything on the table. */
function siftGroup(plan: TablePlan, d: Sifted, i: number): HitGroup {
  const quad = poseQuad(plan.projector, { ...d.now, pos: { ...d.now.pos, y: d.now.pos.y + d.now.lift } }, d.sift.roll);
  return { id: siftGroupId(d.sift.card), kind: "card", seat: d.sift.seat, members: [d.sift.card], quad, order: 1e6 + i };
}

/** Whether a sift is open: then only its cards are reached (`pickDrawn`, `pickHit`). */
export const sifting = (drawn: ReadonlyMap<string, DrawnPiece>): boolean => siftedOf(drawn).length > 0;

/**
 * What a tap reaches under a composed camera (a zoom), from what a ray through it met there: the piece it hit, when that
 * piece is a group a tap may reach, by its identity. Nothing else: a ray that met no piece (the table, a page, `hit`
 * null) reaches nothing, as does one that met a piece no tap reaches; it is never mapped back through the table's camera,
 * where a card standing between that camera and the point would take it. While a sift is open only a sifted card is
 * reached (the caller's ray looks only for them).
 */
export function pickHit(
  plan: TablePlan,
  drawn: ReadonlyMap<string, DrawnPiece>,
  hit: { readonly id: string | null } | null,
  skip?: ReadonlySet<string>,
): HitGroup | null {
  if (!hit || hit.id === null || skip?.has(hit.id)) return null;
  const d = drawn.get(hit.id);
  const sifted = siftedOf(drawn);
  if (sifted.length) {
    const i = d ? sifted.indexOf(d as Sifted) : -1;
    return i >= 0 ? siftGroup(plan, sifted[i]!, i) : null;
  }
  const g = candidates(plan, drawn).find((x) => x.id === hit.id && x.kind !== "plate");
  return g && (!d || d.pickable) ? g : null;
}

/** A seat's page as drawn (a lean-in raises and turns it), from the piece `page:<seat>`; else where the plan put it. */
export function drawnPage(plan: TablePlan, drawn: ReadonlyMap<string, DrawnPiece>, seat: SeatId): { pos: V3; yaw: number; w: number; d: number } | null {
  const pg = plan.seats.get(seat)?.fixtures.page;
  if (!pg) return null;
  const now = drawn.get(`page:${seat}`)?.now;
  return now ? { pos: now.pos, yaw: now.ry, w: pg.w * now.s, d: pg.d * now.s } : { pos: pg.pos, yaw: pg.yaw, w: pg.w, d: pg.d };
}

/**
 * The seat whose page, as drawn, lies under a ray: `onLevel(y)` is where the ray meets the level y (null: it does not).
 * The highest page first (a raised page is drawn over the rest).
 */
export function seatUnder(plan: TablePlan, drawn: ReadonlyMap<string, DrawnPiece>, onLevel: (y: number) => V3 | null): SeatId | null {
  const pages = [...plan.seats.keys()].map((seat) => ({ seat, pg: drawnPage(plan, drawn, seat)! })).sort((a, b) => b.pg.pos.y - a.pg.pos.y);
  for (const { seat, pg } of pages) {
    const at = onLevel(pg.pos.y);
    if (!at) continue;
    const dx = at.x - pg.pos.x,
      dz = at.z - pg.pos.z,
      c = Math.cos(pg.yaw),
      s = Math.sin(pg.yaw);
    const lx = dx * c - dz * s,
      lz = dx * s + dz * c;
    if (Math.abs(lx) <= pg.w / 2 && Math.abs(lz) <= pg.d / 2) return seat;
  }
  return null;
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
