// The audit of one arrangement as drawn (§5.1 step 3, §7.2): floors on every face shown, a finger's patch on every
// target region (the slot, less what has precedence over it, the keepouts and the screen's unsafe edges), each region
// holding the face it reaches, and nothing of another unit over a shown name strip or foot.
import { inQuad } from "../shape";
import type { Quad } from "../shape";
import type { CardId, Point } from "../types";
import type { ArrViolation, Container, UnitId } from "./contract";
import { faceWidth, strip } from "./frame";
import type { Pose } from "./frame";

export interface AuditUnit {
  readonly id: UnitId;
  readonly face: { readonly card: CardId; readonly quad: Quad; readonly pose: Pose; readonly upright: Pose; readonly standing: boolean } | null;
  /** The card mesh's scale. */
  readonly scale: number;
  /** Creature floor applies to the face shown (a standing creature). */
  readonly creature: boolean;
  readonly region: Quad;
  /** Target precedence: higher wins. */
  readonly order: number;
  /** Every face this unit draws, with its paint index (later is over earlier). */
  readonly faces: readonly { readonly quad: Quad; readonly paint: number }[];
  /** The paint index of the face shown. */
  readonly paint: number;
}

const CELL = 4;
const COVER = 0.2;

interface Box {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}
const boxOf = (q: Quad): Box => ({
  l: Math.min(q[0].x, q[1].x, q[2].x, q[3].x),
  r: Math.max(q[0].x, q[1].x, q[2].x, q[3].x),
  t: Math.min(q[0].y, q[1].y, q[2].y, q[3].y),
  b: Math.max(q[0].y, q[1].y, q[2].y, q[3].y),
});
const meets = (a: Box, b: Box): boolean => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/** How much of a face its place's region must hold (a card lying turned in a place skewed by perspective reaches a
 *  sliver past the place's edges, under its neighbour's). */
const PLACE_HOLDS = 0.85;

/** The area of a convex polygon. */
const area = (ps: readonly Point[]): number => Math.abs(ps.reduce((t, p, i) => t + p.x * ps[(i + 1) % ps.length]!.y - ps[(i + 1) % ps.length]!.x * p.y, 0)) / 2;

/** A convex polygon clipped to a convex quad (Sutherland–Hodgman), either winding. */
function clip(subject: readonly Point[], by: Quad): Point[] {
  const sign = Math.sign((by[1].x - by[0].x) * (by[2].y - by[0].y) - (by[1].y - by[0].y) * (by[2].x - by[0].x)) || 1;
  let out = [...subject];
  for (let i = 0; i < 4 && out.length; i++) {
    const a = by[i]!, b = by[(i + 1) % 4]!;
    const side = (p: Point) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const inp = out;
    out = [];
    inp.forEach((p, k) => {
      const q = inp[(k + 1) % inp.length]!, sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    });
  }
  return out;
}

export function auditUnits(c: Container, units: readonly AuditUnit[], designUnit: number): ArrViolation[] {
  const out: ArrViolation[] = [];
  const screen = c.keepouts.flatMap((k) => (k.on === "screen" ? [k.rect] : []));
  const boxes = new Map(units.map((u) => [u.id, boxOf(u.region)]));
  for (const un of units) {
    // floors: a face shown, at its width across its middle
    if (un.face) {
      const floor = un.creature && un.face.standing ? c.floors.creature : c.floors.any;
      const w = faceWidth(c.projector, un.face.upright, un.scale);
      if (w / designUnit < floor - 1e-6) out.push({ rule: "floor", unit: un.id, measured: w / designUnit, limit: floor });
      // place: the region holds the face it reaches, its middle and nearly all its area (a place's region runs up its
      // slot's edges, and a card lying turned in a place skewed by perspective reaches a sliver past them)
      const q = un.face.quad, mid = { x: (q[0].x + q[2].x) / 2, y: (q[0].y + q[2].y) / 2 };
      const held = area(clip(q, un.region)) / Math.max(1e-9, area(q));
      if (!inQuad(un.region, mid.x, mid.y) || held < PLACE_HOLDS) out.push({ rule: "place", unit: un.id, measured: held, limit: PLACE_HOLDS });
      // nothing of another unit over its name strip or foot (only what is painted later and reaches its face)
      const fb = boxOf(q);
      const over = units.flatMap((o) => (o.id === un.id || !meets(boxes.get(o.id)!, fb) ? [] : o.faces.filter((x) => x.paint > un.paint && meets(boxOf(x.quad), fb)).map((x) => x.quad)));
      if (over.length)
        for (const [rule, s] of [["covers-name", strip(q, 5 / 6, 1)], ["covers-foot", strip(q, 0, 1 / 6)]] as const) {
          const f = covered(s, over);
          if (f > COVER) out.push({ rule, unit: un.id, measured: f, limit: COVER });
        }
    }
    // a finger's patch on its region, less what has precedence, the keepouts and the unsafe edges
    const bb = boxes.get(un.id)!;
    const above = units.filter((o) => o.id !== un.id && o.order > un.order && meets(boxes.get(o.id)!, bb)).map((o) => o.region);
    if (!hasSquare(un.region, bb, above, screen, c.safe, c.floors.tapPx)) {
      const patch = largestSquare(un.region, bb, above, screen, c.safe);
      out.push({ rule: "tap-patch", unit: un.id, measured: patch, limit: c.floors.tapPx });
    }
  }
  return out;
}

function covered(q: Quad, over: readonly Quad[]): number {
  if (!over.length) return 0;
  const n = 7, m = 2;
  let hit = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      const [a, e] = strip(q, (j + 0.5) / m, (j + 0.5) / m);
      const p = { x: a.x + (e.x - a.x) * ((i + 0.5) / n), y: a.y + (e.y - a.y) * ((i + 0.5) / n) };
      if (over.some((o) => inQuad(o, p.x, p.y))) hit++;
    }
  return hit / (n * m);
}

/** Whether two convex quads overlap (they share more than a boundary): no separating axis among their edges' normals. */
function overlap(a: Quad, b: Quad): boolean {
  for (const q of [a, b])
    for (let i = 0; i < 4; i++) {
      const p = q[i]!, n = q[(i + 1) % 4]!, ax = n.y - p.y, ay = p.x - n.x;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const v of a) {
        const d = v.x * ax + v.y * ay;
        amin = Math.min(amin, d);
        amax = Math.max(amax, d);
      }
      for (const v of b) {
        const d = v.x * ax + v.y * ay;
        bmin = Math.min(bmin, d);
        bmax = Math.max(bmax, d);
      }
      if (amax <= bmin + 1e-9 || bmax <= amin + 1e-9) return false;
    }
  return true;
}

/**
 * Whether a `side` px square lies wholly inside `q`, inside `safe`, off the keepouts and off everything `above`: tried at
 * the region's middle first, then across it on a 2 px grid. Exact for the square it finds (its corners inside a convex
 * quad; no overlap by separating axes), so it never certifies a patch that is not there.
 */
export function hasSquare(q: Quad, bb: Box, above: readonly Quad[], keep: readonly { left: number; top: number; right: number; bottom: number }[], safe: { left: number; top: number; right: number; bottom: number }, side: number): boolean {
  const x0 = Math.max(bb.l, safe.left), x1 = Math.min(bb.r, safe.right) - side, y0 = Math.max(bb.t, safe.top), y1 = Math.min(bb.b, safe.bottom) - side;
  if (x1 < x0 || y1 < y0) return false;
  const near = (a: Box) => above.filter((o) => meets(boxOf(o), a));
  const zone = near({ l: x0, r: x1 + side, t: y0, b: y1 + side });
  const keepNear = keep.filter((k) => k.left < x1 + side && k.right > x0 && k.top < y1 + side && k.bottom > y0);
  const fits = (x: number, y: number): boolean => {
    const sq: Quad = [{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }];
    if (!sq.every((p) => inQuad(q, p.x, p.y))) return false;
    for (const k of keepNear) if (x < k.right && x + side > k.left && y < k.bottom && y + side > k.top) return false;
    for (const o of zone) if (overlap(o, sq)) return false;
    return true;
  };
  const cx = Math.min(x1, Math.max(x0, (bb.l + bb.r) / 2 - side / 2)), cy = Math.min(y1, Math.max(y0, (bb.t + bb.b) / 2 - side / 2));
  if (fits(cx, cy)) return true;
  for (let y = y0; y <= y1 + 1e-9; y += 2) for (let x = x0; x <= x1 + 1e-9; x += 2) if (fits(x, y)) return true;
  return false;
}

/**
 * The side of the largest square (px, on a 4 px grid) wholly inside `q`, inside `safe`, off the keepouts and `above`.
 * A cell counts only when it lies wholly inside the quad and touches nothing excluded, so the answer is never more than
 * the space: a patch it certifies is really there.
 */
export function largestSquare(q: Quad, bb: Box, above: readonly Quad[], keep: readonly { left: number; top: number; right: number; bottom: number }[], safe: { left: number; top: number; right: number; bottom: number }): number {
  const l = Math.max(Math.ceil(safe.left / CELL), Math.floor(bb.l / CELL)), r = Math.min(Math.floor(safe.right / CELL), Math.ceil(bb.r / CELL));
  const t = Math.max(Math.ceil(safe.top / CELL), Math.floor(bb.t / CELL)), b = Math.min(Math.floor(safe.bottom / CELL), Math.ceil(bb.b / CELL));
  const w = r - l, h = b - t;
  if (w <= 0 || h <= 0) return 0;
  // (Too small on screen for a patch at all: its narrow side, in whole cells, is the most it could hold.)
  if (Math.min(w, h) * CELL < 44) return Math.max(0, Math.min(w, h) - 1) * CELL;
  const kk = keep.filter((k) => k.left < bb.r && k.right > bb.l && k.top < bb.b && k.bottom > bb.t);
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x0 = (l + i) * CELL, y0 = (t + j) * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      const cell: Quad = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      const own =
        cell.every((p) => inQuad(q, p.x, p.y)) && !kk.some((k) => x0 < k.right && x1 > k.left && y0 < k.bottom && y1 > k.top) && !above.some((o) => overlap(o, cell)) ? 1 : 0;
      sum[(j + 1) * (w + 1) + i + 1] = own + sum[j * (w + 1) + i + 1]! + sum[(j + 1) * (w + 1) + i]! - sum[j * (w + 1) + i]!;
    }
  const full = (n: number, i: number, j: number): boolean =>
    sum[(j + n) * (w + 1) + i + n]! - sum[j * (w + 1) + i + n]! - sum[(j + n) * (w + 1) + i]! + sum[j * (w + 1) + i]! === n * n;
  let lo = 0, hi = Math.min(w, h);
  while (lo < hi) {
    const n = Math.ceil((lo + hi) / 2);
    let ok = false;
    for (let j = 0; j + n <= h && !ok; j++) for (let i = 0; i + n <= w && !ok; i++) ok = full(n, i, j);
    if (ok) lo = n;
    else hi = n - 1;
  }
  return lo * CELL;
}
