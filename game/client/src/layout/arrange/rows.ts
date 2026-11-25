// A container's rows (§5.2): laid from the anchor edge at finite depths, each a set of disjoint usable intervals found
// by sweeping the row's worst-case envelope across it against every keepout. Rows depend on the container and the
// policy's tiers, never on the cards, so they are computed once per plan.
import { inQuad } from "../shape";
import type { Container, TierSpec } from "./contract";
import { CARD, LEAN, clearBehind, onFrame, standQuad, surfaceQuad } from "./frame";
import { SLOT } from "./scale";

export interface RowGeo {
  readonly index: number;
  readonly tiers: readonly TierSpec[];
  readonly posture: "stand" | "lie";
  /** Standing rows are a grid of equal places counted centre-out; lying rows pack their units in a fixed order. */
  readonly grid: boolean;
  /** A place's width (world units): a card's height inside the turn horizon, a notched card's width past it. */
  readonly base: number;
  /** Where its feet are, from the anchor edge. */
  readonly v: number;
  /** How deep a lying card reaches from the feet; fans add the proud strip. */
  readonly depth: number;
  readonly proud: number;
  /** The count strip in front of it (0 when its tiers hold no stacks). */
  readonly strip: number;
  readonly intervals: readonly { readonly lo: number; readonly hi: number }[];
  /** Per interval, its places' centres in place order (centre-out); grid rows only. */
  readonly places: readonly (readonly number[])[];
}

/** A lying card's depth turned a notch. */
export const LIE_DEPTH = CARD.h * Math.cos(Math.PI / 12) + CARD.w * Math.sin(Math.PI / 12);
const SWEEP = 0.05;
const EPS = 1e-9;

/** Place j of `n` in an interval, centre-out: the middle (or just left of it), then right, left, right... */
export const centreOut = (j: number, n: number): number => (j % 2 ? (j + 1) / 2 : -j / 2) - (n % 2 ? 0 : 0.5);

export function rowsOf(c: Container, tiers: readonly TierSpec[], s: number): RowGeo[] {
  const byRow = new Map<number, TierSpec[]>();
  for (const t of tiers) byRow.set(t.row, [...(byRow.get(t.row) ?? []), t]);
  const out: RowGeo[] = [];
  let prev: RowGeo | null = null;
  for (const index of [...byRow.keys()].sort((a, b) => a - b)) {
    const ts = byRow.get(index)!;
    const stand = ts.some((t) => t.posture === "stand");
    const quarter = ts.some((t) => t.tapped === "quarter");
    const strip = ts.some((t) => t.markers) ? SLOT.strip * s : 0;
    const proud = ts.some((t) => t.proud) ? 0.3 * CARD.h * s : 0;
    const depth = (quarter ? CARD.h : LIE_DEPTH) * s;
    let v: number;
    if (!prev) v = SLOT.margin + strip;
    else {
      // What lies or stands in front must not cover this row's feet, from the eye: behind a standing row's tops; behind a
      // lying row's far edge (and its proud strip).
      const behind = prev.posture === "stand" ? Math.max(clearBehind(c.projector, c.frame, prev.v, s, 2, LEAN), prev.v + prev.depth) : prev.v + prev.depth + prev.proud;
      v = behind + strip + 0.05 * s;
    }
    const base = (quarter ? SLOT.stand : SLOT.lie) * s;
    const far = v + Math.max(depth, stand ? CARD.h * s * Math.sin(LEAN) : 0) + proud;
    const intervals = far > c.frame.d + EPS ? [] : sweep(c, v, stand, depth + proud, s, base);
    const places = stand ? intervals.map((iv) => gridPlaces(iv, base)) : [];
    const row: RowGeo = { index, tiers: ts, posture: stand ? "stand" : "lie", grid: stand, base, v, depth, proud, strip, intervals, places };
    out.push(row);
    prev = row;
  }
  return out;
}

function gridPlaces(iv: { lo: number; hi: number }, base: number): number[] {
  const n = Math.floor((iv.hi - iv.lo) / base + EPS), mid = (iv.lo + iv.hi) / 2;
  return Array.from({ length: n }, (_, j) => mid + centreOut(j, n) * base);
}

/**
 * The row's usable spans: a column of its worst-case envelope (a standing card's height, or a lying card's depth, and the
 * count strip) is swept across the row, and a sample is free when the column is clear of every keepout, on the screen
 * and on the frame. Runs of free samples at least one place wide are the intervals.
 */
function sweep(c: Container, v: number, stand: boolean, depth: number, s: number, base: number): { lo: number; hi: number }[] {
  const lo = -c.frame.w / 2 + SLOT.margin, hi = c.frame.w / 2 - SLOT.margin;
  const screen = c.keepouts.filter((k) => k.on === "screen");
  const frame = c.keepouts.filter((k) => k.on === "frame");
  const strip = SLOT.strip * s;
  const free = (u0: number, u1: number): boolean => {
    for (const k of frame) if (k.u0 < u1 && k.u1 > u0 && k.v0 < v + depth && k.v1 > v - strip) return false;
    if (!screen.length) return true;
    const qs = [surfaceQuad(c.projector, c.frame, u0, u1, v - strip, v + depth), ...(stand ? [standQuad(c.projector, c.frame, u0, u1, v, s)] : [])];
    for (const k of screen) {
      const r = k.rect;
      for (const q of qs) {
        const l = Math.min(q[0].x, q[1].x, q[2].x, q[3].x), rr = Math.max(q[0].x, q[1].x, q[2].x, q[3].x);
        const t = Math.min(q[0].y, q[1].y, q[2].y, q[3].y), b = Math.max(q[0].y, q[1].y, q[2].y, q[3].y);
        if (l < r.right && rr > r.left && t < r.bottom && b > r.top) {
          // a finer test: any of the rect's corners inside the quad, or the quad's corners inside the rect
          const corners = [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }];
          if (corners.some((p) => inQuad(q, p.x, p.y)) || q.some((p) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom)) return false;
          // or the quad's edges crossing the rect (a thin column through a wide rect)
          if ((l + rr) / 2 > r.left && (l + rr) / 2 < r.right) return false;
        }
      }
    }
    return true;
  };
  const out: { lo: number; hi: number }[] = [];
  let start: number | null = null;
  for (let u = lo; u < hi - EPS; u += SWEEP) {
    const u1 = Math.min(hi, u + SWEEP);
    if (free(u, u1)) start ??= u;
    else if (start !== null) {
      if (u - start >= base - EPS) out.push({ lo: start, hi: u });
      start = null;
    }
  }
  if (start !== null && hi - start >= base - EPS) out.push({ lo: start, hi });
  return out;
}

/** Where a row's place sits on the surface. */
export const rowPoint = (c: Container, row: RowGeo, u: number) => onFrame(c.frame, u, row.v);
