// Soft shapes laid under and around cards: the halos of the signals, a stack card's drop shadow, a standee's shade and
// a held page's shadow. Ported from old h.js `buildGeometry` and `haloCanvas`; white where the material tints them.
import { begin, rr } from "./shapes";
import type { Canvas } from "./shapes";

export type HaloKind = "option" | "selected" | "danger";

export const HALO_PX = { w: 240, h: 300 } as const;

/** A halo, drawn white and tinted by its material, laid out like a plane around a card (1.62 x 1.46 of it). */
export function paintHalo(canvas: Canvas, kind: HaloKind): void {
  const g = begin(canvas, HALO_PX.w, HALO_PX.h),
    X = 39,
    Y = 39,
    W = 162,
    Hh = 222;
  g.strokeStyle = g.shadowColor = g.fillStyle = "#fff";
  if (kind === "selected") {
    // a thick, steady band
    g.shadowBlur = 26;
    g.lineWidth = 24;
    rr(g, X - 2, Y - 2, W + 4, Hh + 4, 20);
    g.stroke();
    g.stroke();
  } else if (kind === "danger") {
    // a ring inside target brackets
    g.shadowBlur = 22;
    g.lineWidth = 15;
    rr(g, X, Y, W, Hh, 16);
    g.stroke();
    g.stroke();
    g.shadowBlur = 10;
    g.lineWidth = 12;
    g.lineCap = "round";
    const o = 22,
      L = 40;
    for (const [x, y, dx, dy] of [
      [X - o, Y - o, 1, 1],
      [X + W + o, Y - o, -1, 1],
      [X - o, Y + Hh + o, 1, -1],
      [X + W + o, Y + Hh + o, -1, -1],
    ] as const) {
      g.beginPath();
      g.moveTo(x, y + dy * L);
      g.lineTo(x, y);
      g.lineTo(x + dx * L, y);
      g.stroke();
    }
  } else {
    // a soft ring that breathes
    g.shadowBlur = 28;
    g.lineWidth = 16;
    rr(g, X, Y, W, Hh, 18);
    g.stroke();
    g.stroke();
  }
}

/** A stack card's drop shadow. */
export function paintDrop(canvas: Canvas): void {
  const x = begin(canvas, 160, 200);
  x.shadowColor = "rgba(0,0,0,1)";
  x.shadowBlur = 24;
  x.fillStyle = "#000";
  rr(x, 30, 30, 100, 140, 10);
  x.fill();
}

export const SHADE_PX = { w: 128, h: 192 } as const;

/**
 * A standee's shadow: a soft card-shaped shade, darkest along the foot where the card meets the page, fading toward where
 * its top hangs over. The card covers its middle, so the shade is full right out to the card's outline (24..104, 24..168
 * here) and softens only beyond it: what shows past the card is its darkest edge, never a hard one.
 */
export function paintShade(canvas: Canvas): void {
  const x = begin(canvas, SHADE_PX.w, SHADE_PX.h);
  x.shadowColor = "#000";
  x.shadowBlur = 12;
  x.fillStyle = "#000";
  rr(x, 20, 20, 88, 152, 12);
  x.fill();
  const fall = x.createLinearGradient(0, 192, 0, 0);
  fall.addColorStop(0, "rgba(0,0,0,1)");
  fall.addColorStop(0.3, "rgba(0,0,0,.85)");
  fall.addColorStop(1, "rgba(0,0,0,.45)");
  x.shadowColor = "transparent";
  x.globalCompositeOperation = "destination-in";
  x.fillStyle = fall;
  x.fillRect(0, 0, 128, 192);
}

/** A page's shadow on the table while it is held up: its shape, soft all round. */
export function paintPageShade(canvas: Canvas): void {
  const x = begin(canvas, 256, 256);
  x.shadowColor = "#000";
  x.shadowBlur = 28;
  x.fillStyle = "#000";
  x.fillRect(40, 40, 176, 176);
}

export const STRATA_PX = { w: 8, h: 32 } as const;

/**
 * One card's height of a block's wall: cream stock with a dark line where it meets the card under it, repeated once per
 * card (or per few, on a tall block) by the material. White-balanced: the lamp and the material colour it.
 */
export function paintStrata(canvas: Canvas): void {
  const x = begin(canvas, STRATA_PX.w, STRATA_PX.h);
  const g = x.createLinearGradient(0, 0, 0, STRATA_PX.h);
  g.addColorStop(0, "#f4ead2");
  g.addColorStop(0.7, "#e3d5b2");
  g.addColorStop(0.78, "#8a7552");
  g.addColorStop(0.9, "#6b5838");
  g.addColorStop(1, "#d9caa4");
  x.fillStyle = g;
  x.fillRect(0, 0, STRATA_PX.w, STRATA_PX.h);
}
