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

/** A soft mask fitted to the card's outline, for its drop shadow or highlight. */
export function paintDrop(canvas: Canvas, light = false): void {
  const x = begin(canvas, 160, 200);
  x.shadowColor = x.fillStyle = light ? "#fff" : "#000";
  x.shadowBlur = light ? 20 : 24;
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

export const DIE_PX = 128;

/**
 * One face of a die, bone with dark ink: `n` pips (a d6's face, 1 to 6) or a numeral (a d20's or a d10's). A numeral
 * that could be read upside down (6, 9) is underlined.
 */
export function paintDieFace(canvas: Canvas, face: { readonly pips: boolean; readonly n: number }): void {
  const x = begin(canvas, DIE_PX, DIE_PX);
  const g = x.createRadialGradient(DIE_PX * 0.4, DIE_PX * 0.35, 4, DIE_PX / 2, DIE_PX / 2, DIE_PX * 0.75);
  g.addColorStop(0, "#fbf3e0");
  g.addColorStop(1, "#dccca6");
  x.fillStyle = g;
  x.fillRect(0, 0, DIE_PX, DIE_PX);
  x.fillStyle = "#24160a";
  if (face.pips) {
    const at: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
      1: [[0.5, 0.5]],
      2: [[0.27, 0.27], [0.73, 0.73]],
      3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
      4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
      5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
      6: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]],
    };
    for (const [px, py] of at[Math.max(1, Math.min(6, face.n))] ?? []) {
      x.beginPath();
      x.arc(px * DIE_PX, py * DIE_PX, DIE_PX * 0.095, 0, Math.PI * 2);
      x.fill();
    }
    return;
  }
  const s = String(face.n);
  x.font = `700 ${s.length > 1 ? 70 : 86}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(s, DIE_PX / 2, DIE_PX / 2 + 4);
  if (s === "6" || s === "9") x.fillRect(DIE_PX * 0.36, DIE_PX * 0.84, DIE_PX * 0.28, 6);
}
