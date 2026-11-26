// One card size (§4): every card on the table, mine and every opponent's, is one mesh size, `S_table`. Its size on
// screen follows only its distance and its posture; nothing shrinks to fit. `S_table` depends on the template and the
// viewport class, never on counts: it is the smallest 0.05 step at which every rest container's first row meets its
// floor, measured exactly (no fitting margin).
import type { Projector } from "../projector";
import type { SurfaceFrame } from "./contract";
import { CARD, LEAN, NOTCH, faceWidth, liePose, standPose } from "./frame";

/** Today's camera at 1180x820 (§4.2): the designer's number, held by `tableScale` in the tests. */
export const S_TABLE = 1.85;

/** A slot's width along its row, in card scale units (§4.4). */
export const SLOT = {
  /** A standing tier's place: a card's height, so a quarter-turned tapped card fits it; slots abut. */
  stand: CARD.h,
  /** A lying tier's place: a card turned a notch (its corners may cross the gap, where nothing is written). */
  lie: CARD.w * Math.cos(NOTCH) + CARD.h * Math.sin(NOTCH),
  /** The count strip in front of a stack row, for its marker (designer §7.2). */
  strip: 0.3,
  /** Side margins inside a frame. */
  margin: 0.2,
} as const;

/** A fan's members turn this much more each, about the top's foot-left corner (designer §2). */
export const FAN_TURN = (2 * Math.PI) / 180;

/** How wide a fan of `shown` cards reaches across, in card scale units: its deepest card turned about the corner. */
export const fanExtent = (shown: number): number => {
  const t = FAN_TURN * Math.max(0, shown - 1);
  return CARD.w * Math.cos(t) + CARD.h * Math.sin(t);
};

/** A row whose first card must meet a floor: where it lies and how. */
export interface FloorRow {
  readonly frame: SurfaceFrame;
  readonly v: number;
  /** The u's to measure at (a row's ends and middle). */
  readonly us: readonly number[];
  readonly posture: "stand" | "lie";
  /** Design px. */
  readonly floor: number;
}

/** The narrowest face of a row at scale `s`, in design px (a lying card's face is measured across, unturned). */
export function rowWidth(proj: Projector, r: FloorRow, s: number, u: number): number {
  let least = Infinity;
  for (const x of r.us) {
    const p = r.posture === "stand" ? standPose(r.frame, x, r.v, LEAN) : liePose(r.frame, x, r.v + (CARD.h * s) / 2, s);
    least = Math.min(least, faceWidth(proj, p, s) / u);
  }
  return least;
}

/** The smallest 0.05 step from `from` up at which every row meets its floor, or null past `to`. */
export function tableScale(proj: Projector, rows: readonly FloorRow[], designUnit: number, from = 1.0, to = 3.0): number | null {
  for (let k = Math.round(from * 20); k <= Math.round(to * 20); k++) {
    const s = k / 20;
    if (rows.every((r) => rowWidth(proj, r, s, designUnit) >= r.floor - 1e-9)) return s;
  }
  return null;
}
