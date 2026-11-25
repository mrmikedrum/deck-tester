// Plain data shared across layout. Pure core: no DOM, no three.js, no clocks, no random.
// Ids are the model's branded types: a seat is never a bare string, a card never a bare number.

export type { SeatId } from "../model";
export type { CardId } from "../protocol";

/** A point on the table plane or in space: x right, y up, z toward the viewer (near is +z). A card is 1 tall. */
export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
/** CSS pixels, y down. */
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
export interface Viewport {
  readonly w: number;
  readonly h: number;
}
/** The safe-area insets, CSS px (the platform's reading): the screen's edges a tap may not reach, under a notch or the
 *  home indicator. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The 1180x820 design unit in CSS pixels (the old CSS `--u`). Floors and chrome sizes are stated in design px. */
export function designUnit(vp: Viewport): number {
  return Math.min(vp.w / 1180, vp.h / 820);
}

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
