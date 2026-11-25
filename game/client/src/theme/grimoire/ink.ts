// Ink written in a page's vellum: an account (a page's creatures and works, written down instead of standing). Sepia is
// what is; red is what matters now. The ink lies in the page's plane, foreshortened with it, so its letters are painted
// taller than wide by the block's `stretch` (as road lettering is) and read square from my chair. Rows come from layout
// (told/ink.ts): the painter only letters them.
import { font } from "../tokens";
import { begin } from "./shapes";
import type { Canvas, Ctx } from "./shapes";

/** Canvas px per em of a line: sharp at 2x and leaned in. */
export const INK_EM_PX = 56;
/** The largest side an ink canvas may take. */
const MAX_SIDE = 2048;

export const INK = {
  /** What is: sepia, the works lighter. */
  sepia: "#3b2410",
  faint: "#6b4a2a",
  /** What matters now. */
  red: "#9a1c10",
} as const;

export type InkLineSpec =
  | { readonly t: "tally"; readonly power: number; readonly rest: string }
  | { readonly t: "trait"; readonly text: string }
  | { readonly t: "entry"; readonly text: string; readonly marks: readonly boolean[]; readonly out?: number; readonly trait: string | null }
  | { readonly t: "works"; readonly text: string };

export interface InkSpec {
  readonly lines: readonly InkLineSpec[];
  /** Each line's row, ems back from the block's far edge. */
  readonly at: readonly number[];
  /** The block in world units, an em in world depth, and how much taller than wide a letter is painted. */
  readonly w: number;
  readonly d: number;
  readonly em: number;
  readonly stretch: number;
  /** The tally numeral's size in ems; a line's row in ems (layout's `ROW.line`). */
  readonly tallyEm: number;
  readonly row: number;
}

/** A mark: an upright stroke for a ready card, a turned one for a tapped card (ems). */
const MARK = { w: 3.4 / 13, h: 9 / 13, gap: 3 / 13 } as const;

/** Canvas px per world unit for a block. */
export function inkPpu(spec: InkSpec): number {
  return Math.min(INK_EM_PX / spec.em, MAX_SIDE / Math.max(spec.w, spec.d));
}

/** `wet`: these lines are painted in red (the changed ink, until it dries). */
export function paintAccount(canvas: Canvas, spec: InkSpec, wet?: readonly number[]): void {
  const ppu = inkPpu(spec), E = spec.em * ppu, k = 1 / spec.stretch;
  const W = Math.max(4, Math.round(spec.w * ppu)), H = Math.max(4, Math.round(spec.d * ppu));
  const x = begin(canvas, W, H);
  x.clearRect(0, 0, W, H);
  // Letters narrower by 1/stretch: everything across is drawn in a frame scaled by k, its own x widened to match.
  const room = W / k;
  x.setTransform(k, 0, 0, 1, 0, 0);
  x.textBaseline = "alphabetic";
  x.textAlign = "left";
  let red = false;
  const ink = (c0: string, a = 0.92): void => {
    const c = red ? INK.red : c0;
    x.fillStyle = c;
    x.globalAlpha = a;
    // A little bleed into the vellum.
    x.shadowColor = c;
    x.shadowBlur = E * 0.05;
  };
  spec.lines.forEach((l, i) => {
    red = !!wet?.includes(i);
    const top = (spec.at[i] ?? 0) * E;
    if (l.t === "tally") {
      ink(INK.sepia, 0.95);
      const big = spec.tallyEm * E;
      x.font = `400 ${big}px ${font.serif}`;
      const base = top + big * 0.86;
      x.fillText(String(l.power), 0, base);
      const nw = x.measureText(String(l.power)).width;
      x.font = `400 ${E}px ${font.serif}`;
      x.fillText(l.rest, nw + E * 0.3, base, room - nw - E * 0.3);
      return;
    }
    const base = top + E * 0.95;
    if (l.t === "works") {
      ink(INK.faint, 0.85);
      x.font = `italic 400 ${E}px ${font.serif}`;
      x.fillText(l.text, 0, base, room);
      return;
    }
    ink(INK.sepia);
    x.font = `400 ${E}px ${font.serif}`;
    x.fillText(l.text, 0, base, room);
    if (l.t !== "entry") return;
    let at = Math.min(room, x.measureText(l.text).width) + E * 0.55;
    marks(x, l.marks, l.out ?? 0, at, base, E, room, red ? INK.red : INK.sepia);
    if (l.trait) {
      const n = l.marks.length, tapped = l.marks.filter(Boolean).length, gone = l.out ?? 0;
      at += (n - tapped + gone) * (MARK.w + MARK.gap) * E + tapped * (MARK.h + MARK.gap) * E + (tapped && tapped < n ? E * 0.3 : 0) + (gone ? E * 0.3 : 0) + E * 0.35;
      ink(INK.faint, 0.85);
      x.font = `italic 400 ${E}px ${font.serif}`;
      if (at < room) x.fillText(l.trait, at, base, room - at);
    }
  });
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.shadowBlur = 0;
}

/** The marks of an entry: ready ones upright, then a little space, then tapped ones turned, on the line's baseline; then
 *  a hollow one for each card out in a fight, where it will come back. */
function marks(x: Ctx, ms: readonly boolean[], out: number, at: number, base: number, E: number, room: number, colour: string = INK.sepia): void {
  x.fillStyle = colour;
  x.globalAlpha = 0.85;
  let p = at;
  const ready = ms.filter((t) => !t).length;
  ms.forEach((tapped, i) => {
    if (i === ready && i > 0) p += E * 0.3;
    const w = (tapped ? MARK.h : MARK.w) * E, h = (tapped ? MARK.w : MARK.h) * E;
    if (p + w > room) return;
    x.fillRect(p, base - h, w, h);
    p += w + MARK.gap * E;
  });
  if (out) p += E * 0.3;
  x.lineWidth = Math.max(1, E * 0.07);
  x.strokeStyle = colour;
  for (let i = 0; i < out; i++) {
    const w = MARK.w * E, h = MARK.h * E;
    if (p + w > room) break;
    x.strokeRect(p + x.lineWidth / 2, base - h + x.lineWidth / 2, w - x.lineWidth, h - x.lineWidth);
    p += w + MARK.gap * E;
  }
}

/** An answer in red, in the vellum: a page's heading under its plaque, or a note at an attacker's foot. */
export interface AnswerSpec {
  readonly kind: "heading" | "note";
  readonly align: "left" | "centre";
  readonly lines: readonly string[];
  readonly w: number;
  readonly d: number;
  readonly em: number;
  readonly stretch: number;
  /** A line's row in ems. */
  readonly row: number;
}

export function paintAnswer(canvas: Canvas, spec: AnswerSpec): void {
  const ppu = Math.min(INK_EM_PX / spec.em, MAX_SIDE / Math.max(spec.w, spec.d)), E = spec.em * ppu, k = 1 / spec.stretch;
  const W = Math.max(4, Math.round(spec.w * ppu)), H = Math.max(4, Math.round(spec.d * ppu));
  const x = begin(canvas, W, H);
  x.clearRect(0, 0, W, H);
  const lines = spec.lines, n = lines.length;
  const size = E;
  x.setTransform(k, 0, 0, 1, 0, 0);
  const left = spec.align === "left";
  x.textAlign = left ? "left" : "center";
  x.textBaseline = "alphabetic";
  x.fillStyle = INK.red;
  x.globalAlpha = 0.95;
  x.shadowColor = INK.red;
  x.shadowBlur = E * 0.04;
  x.font = `400 ${size}px ${font.serif}`;
  const band = n * spec.row * E, top = (H - band) / 2;
  lines.forEach((l, i) => x.fillText(l, left ? 0 : W / k / 2, top + (i + 0.5) * spec.row * E + size * 0.33, W / k - (left ? 0 : E * 0.6)));
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.shadowBlur = 0;
}
