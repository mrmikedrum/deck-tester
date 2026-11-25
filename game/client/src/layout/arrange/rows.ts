// A container's rows (§5.2), from its space and its cards: nothing here knows how many rows or columns a container has.
// A policy's tiers sit in bands (standing or lying, in the policy's order from the anchor edge); each band takes as many
// rows as its units need and the space allows, keeping room for every later band that holds something. A row exists
// only where its cards meet their floor and its far edge is on the screen; its intervals are found by sweeping its
// worst-case envelope against every keepout. Rows depend on the cards only through how many each band needs, so the
// geometry of a row is computed once per plan and reused (`RowPlanner` memoizes by what lies in front).
import { inQuad } from "../shape";
import type { Container, TierSpec } from "./contract";
import { CARD, LEAN, clearBehind, faceWidth, liePose, onFrame, standPose, standQuad, surfaceQuad } from "./frame";
import { SLOT } from "./scale";

/** A band: tiers that share rows, standing or lying, in the policy's order. */
export interface Band {
  readonly id: string;
  readonly index: number;
  readonly tiers: readonly TierSpec[];
  readonly posture: "stand" | "lie";
  readonly markers: boolean;
  readonly proud: boolean;
}

export interface RowGeo {
  /** Its index among the rows laid this plan, from the anchor edge. */
  readonly index: number;
  readonly band: Band;
  readonly posture: "stand" | "lie";
  /** Standing rows are a grid of equal places counted centre-out; lying rows pack their units in tier order. */
  readonly grid: boolean;
  /**
   * Inside the turn horizon a tapped card makes a quarter turn and a place is a card's height wide; past it, a notch,
   * and a place is a notched card wide (designer §7.3). Measured, not assigned: see `HORIZON_PX`.
   */
  readonly quarter: boolean;
  /** A place's width (world units). */
  readonly base: number;
  /** Where its feet are, from the anchor edge. */
  readonly v: number;
  /** How deep what lies in it reaches from the feet; fans add the proud strip. */
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
/**
 * The turn horizon: a standing row is inside it while a card lying a quarter turn there is at least this deep on
 * screen (design px). A leaf's front row reads 43 at every supported viewport, the standing row behind it 36.
 */
export const HORIZON_PX = 40;
const SWEEP = 0.05;
const EPS = 1e-9;

/** Place j of `n` in an interval, centre-out: the middle (or just left of it), then right, left, right... */
export const centreOut = (j: number, n: number): number => (j % 2 ? (j + 1) / 2 : -j / 2) - (n % 2 ? 0 : 0.5);

/** The bands of a policy's tiers: consecutive tiers of one posture share a band. */
export function bandsOf(tiers: readonly TierSpec[]): Band[] {
  const out: { id: string; tiers: TierSpec[]; posture: "stand" | "lie" }[] = [];
  for (const t of tiers) {
    const last = out.at(-1);
    if (last && last.posture === t.posture) last.tiers.push(t);
    else out.push({ id: t.id, tiers: [t], posture: t.posture });
  }
  return out.map((b, index) => ({ ...b, index, markers: b.tiers.some((t) => t.markers), proud: b.tiers.some((t) => t.proud) }));
}

/** Rows laid one after another from the anchor edge, each from the one in front of it; memoized for the plan. */
export class RowPlanner {
  private readonly memo = new Map<string, RowGeo | null>();
  constructor(
    private readonly c: Container,
    private readonly s: number,
    private readonly designUnit: number,
  ) {}

  /** The row after `prev` (or the first) for `band`, or null where the space has none: past the frame's depth, its
   *  floor or the screen's top. */
  next(prev: RowGeo | null, band: Band): RowGeo | null {
    const key = `${prev ? this.keyOf(prev) : ""}>${band.index}`;
    if (this.memo.has(key)) return this.memo.get(key)!;
    const row = this.lay(prev, band);
    this.memo.set(key, row);
    if (row) this.keys.set(row, key);
    return row;
  }

  private readonly keys = new Map<RowGeo, string>();
  private keyOf(r: RowGeo): string {
    return this.keys.get(r)!;
  }

  private lay(prev: RowGeo | null, band: Band): RowGeo | null {
    const { c, s } = this;
    const stand = band.posture === "stand";
    const strip = band.markers ? SLOT.strip * s : 0;
    const proud = band.proud ? 0.3 * CARD.h * s : 0;
    let v: number;
    if (!prev) v = SLOT.margin + strip;
    else {
      // What lies or stands in front must not cover this row's feet, from the eye: behind a standing row's tops, behind a
      // lying row's far edge and its proud strip.
      const behind = prev.posture === "stand" ? Math.max(clearBehind(c.projector, c.frame, prev.v, s, 2, LEAN), prev.v + prev.depth) : prev.v + prev.depth + prev.proud;
      v = behind + strip + 0.05 * s;
    }
    // The turn horizon, for a standing row: how deep a quarter-turned card reads here.
    const quarterPx = (c.projector.project(onFrame(c.frame, 0, v)).y - c.projector.project(onFrame(c.frame, 0, v + CARD.w * s)).y) / this.designUnit;
    const quarter = stand && quarterPx >= HORIZON_PX;
    const depth = (quarter ? CARD.h : LIE_DEPTH) * s;
    const far = v + Math.max(depth, stand ? CARD.h * s * Math.sin(LEAN) : 0) + proud;
    if (far > c.frame.d + EPS) return null;
    // Where its cards would break their floor, or its far edge leave the screen, the space has no row.
    const face = stand ? standPose(c.frame, 0, v, LEAN) : liePose(c.frame, 0, v + (CARD.h * s) / 2, s);
    if (faceWidth(c.projector, face, s) / this.designUnit < (stand ? c.floors.creature : c.floors.any) - EPS) return null;
    const top = stand ? c.projector.project(onFrame(c.frame, 0, v + CARD.h * s * Math.sin(LEAN), CARD.h * s * Math.cos(LEAN))).y : c.projector.project(onFrame(c.frame, 0, far)).y;
    if (top < c.safe.top) return null;
    const base = (quarter ? SLOT.stand : SLOT.lie) * s;
    const floor = stand ? c.floors.creature : c.floors.any;
    const intervals = sweep(c, v, stand, depth + proud, s, base, (u) => faceWidth(c.projector, stand ? standPose(c.frame, u, v, LEAN) : liePose(c.frame, u, v + (CARD.h * s) / 2, s), s) / this.designUnit >= floor - EPS);
    if (!intervals.length) return null;
    const places = stand ? intervals.map((iv) => gridPlaces(iv, base)) : [];
    return { index: prev ? prev.index + 1 : 0, band, posture: band.posture, grid: stand, quarter, base, v, depth, proud, strip, intervals, places };
  }
}

function gridPlaces(iv: { lo: number; hi: number }, base: number): number[] {
  const n = Math.floor((iv.hi - iv.lo) / base + EPS), mid = (iv.lo + iv.hi) / 2;
  return Array.from({ length: n }, (_, j) => mid + centreOut(j, n) * base);
}

/** How many places a grid row holds. */
export const placesOf = (r: RowGeo): number => r.places.reduce((t, p) => t + p.length, 0);
/** How much room a packed row holds across. */
export const roomOf = (r: RowGeo): number => r.intervals.reduce((t, iv) => t + iv.hi - iv.lo, 0);

/**
 * The row's usable spans: a column of its worst-case envelope (a standing card's height, or a lying card's depth, and the
 * count strip) is swept across the row, and a sample is free when a card there meets its floor and the column is clear of
 * every keepout, on the screen and on the frame. Runs of free samples at least one place wide are the intervals.
 */
function sweep(c: Container, v: number, stand: boolean, depth: number, s: number, base: number, floored: (u: number) => boolean): { lo: number; hi: number }[] {
  const lo = -c.frame.w / 2 + SLOT.margin, hi = c.frame.w / 2 - SLOT.margin;
  const screen = c.keepouts.filter((k) => k.on === "screen");
  const frame = c.keepouts.filter((k) => k.on === "frame");
  const strip = SLOT.strip * s;
  const free = (u0: number, u1: number): boolean => {
    if (!floored((u0 + u1) / 2)) return false;
    for (const k of frame) if (k.u0 < u1 && k.u1 > u0 && k.v0 < v + depth && k.v1 > v - strip) return false;
    if (!screen.length) return true;
    const qs = [surfaceQuad(c.projector, c.frame, u0, u1, v - strip, v + depth), ...(stand ? [standQuad(c.projector, c.frame, u0, u1, v, s)] : [])];
    for (const k of screen) {
      const r = k.rect;
      for (const q of qs) {
        const l = Math.min(q[0].x, q[1].x, q[2].x, q[3].x), rr = Math.max(q[0].x, q[1].x, q[2].x, q[3].x);
        const t = Math.min(q[0].y, q[1].y, q[2].y, q[3].y), b = Math.max(q[0].y, q[1].y, q[2].y, q[3].y);
        if (l < r.right && rr > r.left && t < r.bottom && b > r.top) {
          const corners = [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }];
          if (corners.some((p) => inQuad(q, p.x, p.y)) || q.some((p) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom)) return false;
          // a thin column crossing a wide rect
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
