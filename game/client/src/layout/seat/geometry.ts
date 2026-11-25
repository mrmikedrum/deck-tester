import { FLOOR, TAP_PX } from "../board";
import type { Projector } from "../projector";
import { reserved } from "../reservations";
import type { Reservations } from "../reservations";
import { designUnit } from "../types";
import type { V3 } from "../types";

// The tuned geometry of a mat page (old h.js, "Geometry" and "Fitting a page"). Units: a card is 1 tall.

export const CW = 0.716; // card width
export const CH = 1; // card height
export const TH = 0.014; // card thickness

// Standees in rows step back further than cards lying (STEP, in scale units), so a rear row's name clears the row in front.
export const STEP = 1.2;
// How much further back than upright a tapped standee leans, so tapped reads at a glance.
export const TAP_LEAN = 0.3;
// A title tab's greatest height above its card.
export const TAB_H = 0.24;
// Between bands; the margin at the page's open edge; the plaque's band; inside the border at the sides; how far a row is
// set off from the one in front, so its cards show between theirs.
export const GAP = 0.25;
export const EDGE = 0.35;
export const BACK = { me: 1.2, them: 2.0 } as const;
export const SIDE = 0.6;
export const STAGGER = 0.2;
// Their plaque (and the commander beside it): its scale, and how far in from the page's back edge it stands, for its top,
// leaning back, to stay inside the border.
export const PLATE_S = 1.0;
export const PLATE_IN = 1.75;
// Zone piles: scale floor, and the lean of an opponent's pile (propped up from its near edge so it reads from afar).
export const ZONE_S = 0.8;
export const PILE_LEAN = 0.8;
// The plaque's own size on my page.
export const PLATE_S_ME = 0.95;

/** Each band: its preferred scale, floor, how deep its first row and each row behind it run, spacing, rows allowed. */
export interface BandSpec {
  pref: number;
  px: number;
  flat?: boolean;
  lead: number;
  first: number;
  step: number;
  per: number;
  rows: number;
  /** Its things lie flat on the page (the `die` layout's support): a row is as deep as it lies, with nothing to see over. */
  lying?: boolean;
  /** What lies in it never lies turned (spent shows by a shade and a slight turn): its floor is measured upright only. */
  upright?: boolean;
  /** Theirs: its back row lies flat (the `die` layout's trays behind its standouts), reaching this far behind its foot. */
  backLying?: number;
  /** How tall what stands in it is, for what must show behind it (the mat's: a card and its title tab). */
  tall?: number;
  /** As tall, behind its last row only: what lies in the band behind keeps clear of its tops with room for a tap. */
  tallLast?: number;
}
export type BandKey = "C" | "S" | "L";

export interface Region {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly yaw: number;
}

export interface Geo {
  readonly proj: Projector;
  readonly pitch: number;
  /** How far a standee leans back from upright, where a layout stands its cards at a lean of its own; else `pitch`. */
  readonly lean?: number;
  /** The 1180x820 design unit in CSS px. */
  readonly u: number;
  readonly hand: { readonly right: number; readonly top: number } | null;
  readonly prompt: { readonly left: number; readonly top: number } | null;
  /** The creature floor in design px: 72 mine, 56 theirs. */
  readonly creaturePx: number;
  readonly tableAt: (px: number, py: number, y?: number) => V3;
  readonly toWorld: (r: Region, u: number, v: number) => V3;
  readonly band: (k: BandKey, me: boolean, creaturePx: number) => BandSpec;
}

// Each band: its preferred scale (few cards never render small), its floor, how deep its first row and each row behind it
// run (in scale units: a standing card covers CH / sin(PITCH) of page behind its foot from my chair), its spacing, and
// how many rows it may take. Bands keep their order from the page's fixed edge (theirs: creatures, support, then the
// plaque; mine: plaque, wells, support, creatures, so my creatures face theirs).
export function bandSpec(k: BandKey, me: boolean, pitch: number, creaturePx: number): BandSpec {
  const sinP = Math.sin(pitch);
  switch (k) {
    case "C":
      // Each creature's place is as wide as a tapped card turned in it, so tapping never slides a card under its neighbour.
      return { pref: me ? 1.45 : 1.3, px: creaturePx, lead: me ? CH / sinP : 0.2, first: me ? CH / sinP + 0.15 : 0.2 + CH / sinP, step: STEP, per: CH + 0.06, rows: 2 };
    case "S":
      // Theirs stand nearly upright, their feet just behind the creatures' tops; mine lie propped up, far edge clear of my
      // creatures' feet and foot clear of the wells' names.
      return { pref: me ? 1.2 : 1.1, px: FLOOR.any, lead: me ? 0.7 : 0.1, first: me ? 1.3 : 1.1, step: 1.0, per: 0.82, rows: 2 };
    case "L":
      // theirs: one well lying at the outer end of their support row. (A well's card never lies turned, so its places
      // need only a card's width: mat.ts.)
      return { pref: me ? 1.05 : 1.1, px: FLOOR.any, flat: true, lead: me ? 0.5 : 0.05, first: me ? 1.05 : 1.15, step: 1.0, per: 0.9, rows: me ? 2 : 1 };
  }
}

export function makeGeo(proj: Projector, reserve: Reservations, creaturePx: number): Geo {
  const vp = proj.viewport, u = designUnit(vp), pitch = proj.pitch;
  const hand = reserved(reserve, "hand"), prompt = reserved(reserve, "prompt");
  return {
    proj,
    pitch,
    u,
    hand: hand && { right: hand.right, top: hand.top },
    prompt: prompt && { left: prompt.left, top: prompt.top },
    creaturePx,
    tableAt: (px, py, y = 0) => proj.onTable(px, py, y),
    toWorld: (R, a, v) => ({
      x: R.x + a * Math.cos(R.yaw) + v * Math.sin(R.yaw),
      y: 0,
      z: R.z - a * Math.sin(R.yaw) + v * Math.cos(R.yaw),
    }),
    band: (k, me, px) => bandSpec(k, me, pitch, px),
  };
}

// The scale a card needs at `pos` to be `px` wide on screen, measured across its face's middle (standing) or the card
// lying there (flat); lying, it must also be 44 tall to be tapped, and a card lying far off is foreshortened. Below
// 1180x820 a floor in design px is under the 44 CSS px a finger needs, so the tap patch is the floor there.
export function floorScale(g: Geo, pos: V3, floorPx: number, flat = false, s = 1.5, turned = true): number {
  const tap = TAP_PX / g.u, px = Math.max(floorPx, tap);
  // A standing card's face leans back square to me: its middle stands half its height up and back from its foot. A card
  // lying flat reaches away from its near edge (its foot).
  const mid: V3 = flat
    ? { x: pos.x, y: pos.y, z: pos.z - 0.5 * CH * s }
    : { x: pos.x, y: pos.y + 0.5 * CH * s * Math.cos(g.lean ?? g.pitch), z: pos.z - 0.5 * CH * s * Math.sin(g.lean ?? g.pitch) };
  const at = (y: number) => g.proj.project({ x: pos.x, y, z: pos.z });
  const a = g.proj.project({ ...mid, x: mid.x - 0.5 }), b = g.proj.project({ ...mid, x: mid.x + 0.5 });
  const k = (b.x - a.x) / g.u;
  let w = px * 1.09;
  // (Tapped, it lies turned: then its narrow side runs away from me, foreshortened, and that must be 44 too.)
  if (flat) {
    const tall = ((at(0).y - g.proj.project({ x: pos.x, y: 0, z: pos.z - 0.5 }).y) * 2) / g.u;
    // (Never turned, it must still give a finger a square on a side page, where a card lying is a skewed trapezoid.)
    w = Math.max(w, ((Math.max(FLOOR.any, tap) * (turned ? 1.12 : 1.25) * k) / tall) * (CW / CH), turned ? (px * 1.09 * k) / tall : 0);
  }
  return w / (CW * k);
}

// How deep into seat `r`'s page (from its fixed edge) the table first shows above the top of a card of scale `s` standing
// at depth `foot`, as I see it. Far off I look across the table more than down on it, so a standee there hides more of
// the page behind it than near me: a row or band behind starts here, or the card in front covers its foot.
export function clearBehind(g: Geo, r: Region, foot: number, s: number, tall = CH * 1.04): number {
  const up = { y: Math.cos(g.lean ?? g.pitch), z: -Math.sin(g.lean ?? g.pitch) };
  const f = g.toWorld(r, 0, r.d / 2 - foot);
  const top = g.proj.project({ x: f.x, y: f.y + up.y * tall * s, z: f.z + up.z * tall * s }).y / g.u - 2;
  let lo = foot, hi = r.d + 4;
  for (let it = 0; it < 18; it++) {
    const m = (lo + hi) / 2;
    if (g.proj.project(g.toWorld(r, 0, r.d / 2 - m)).y / g.u > top) lo = m;
    else hi = m;
  }
  return hi;
}

// Where a band at depth `a` from the page's fixed edge lies across: the whole slot, or for mine, clear of the hand (bottom
// left) and the prompt (bottom right) where its nearest row comes down beside them. Region units, centred on `uc`.
export interface Span {
  lo: number;
  hi: number;
  w: number;
  uc: number;
}
export function bandSpan(g: Geo, r: Region, me: boolean, aNear: number): Span {
  let lo = -r.w / 2 + SIDE, hi = r.w / 2 - SIDE;
  if (me) {
    const y = g.proj.project(g.toWorld(r, 0, r.d / 2 - aNear)).y;
    if (g.hand && y > g.hand.top - 8 * g.u) lo = Math.max(lo, g.tableAt(g.hand.right + 10 * g.u, y).x - r.x);
    if (g.prompt && y > g.prompt.top - 8 * g.u) hi = Math.min(hi, g.tableAt(g.prompt.left - 10 * g.u, y).x - r.x);
  }
  return { lo, hi, w: Math.max(0, hi - lo), uc: (lo + hi) / 2 };
}

// How far from my page's fixed edge a row's foot must stand to be above the hand's top on screen.
export function clearOfHand(g: Geo, r: Region): number {
  if (!g.hand) return 0;
  let lo = 0, hi = r.d;
  for (let it = 0; it < 16; it++) {
    const a = (lo + hi) / 2;
    if (g.proj.project(g.toWorld(r, 0, r.d / 2 - a)).y > g.hand.top - 12 * g.u) lo = a;
    else hi = a;
  }
  return hi;
}

// Places in a row, centre out: place 0 in the middle, then right, left, right... In place widths from the row's centre (a
// row of an even number of places is centred when full).
export const rowPlace = (j: number, per: number): number => (j % 2 ? (j + 1) / 2 : -j / 2) - (per % 2 ? 0 : 0.5);

/** Which side of the plaque a seat's piles and commander go: toward the table's middle for the side seats (so they never
 *  leave the screen), the left for across, the right for me. */
export const zoneSide = (me: boolean, x: number): number => (me ? 1 : x > 0 ? -1 : x < 0 ? 1 : -1);
