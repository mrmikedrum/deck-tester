// A plate: the brass plaque at the back of each seat. Name and life are engraved in the book's serif, the commander's
// face is pressed into a wax seal in the seat's colour, the turn player's plaque has a lit ember set into it, and a plate
// you can choose is rimmed in the signal's light. Ported from old h.js `bannerTex`.
import { font, signal } from "../tokens";
import { drawCover } from "./parts";
import { begin, rr } from "./shapes";
import type { Canvas } from "./shapes";
import { bronzeColour, pattern } from "./surfaces";
import type { Source, Surfaces } from "./surfaces";

const SERIF = font.serif;

export const PLATE_PX = { w: 720, h: 180 } as const;

export interface PlateSpec {
  readonly name: string;
  readonly life: number;
  /** The seat's colour: the wax of the seal. */
  readonly seat: string;
  readonly monarch: boolean;
  /** Whose turn it is: a lit ember set into the plaque. */
  readonly turn: boolean;
  /** A signal ring when the plate can be chosen. */
  readonly ring: "none" | "option" | "selected";
  /** Url of the commander's art, when ready. */
  readonly art: string | null;
}

export function paintPlate(
  canvas: Canvas,
  p: PlateSpec,
  s: Surfaces,
  art: (url: string) => (Source & { width: number; height: number }) | null,
): void {
  const x = begin(canvas, PLATE_PX.w, PLATE_PX.h),
    col = p.seat,
    ring = p.ring === "selected" ? signal.selected : p.ring === "option" ? signal.option : null;
  const X = 30,
    Y = 36,
    W = 672,
    Hh = 126,
    R = 8;
  if (ring) {
    x.shadowColor = ring;
    x.shadowBlur = 34;
    rr(x, X - 5, Y - 5, W + 10, Hh + 10, R + 4);
    x.lineWidth = p.ring === "selected" ? 14 : 8;
    x.strokeStyle = ring;
    x.stroke();
    x.stroke();
    x.shadowBlur = 0;
  } else {
    x.shadowColor = "rgba(0,0,0,.75)";
    x.shadowBlur = 16;
    x.shadowOffsetY = 5;
  }
  // The rim: clean bronze, bevelled.
  rr(x, X, Y, W, Hh, R);
  x.fillStyle = pattern(x, s.bronzeClean, bronzeColour);
  x.fill();
  x.shadowColor = "transparent";
  x.shadowOffsetY = 0;
  const bev = x.createLinearGradient(0, Y, 0, Y + Hh);
  bev.addColorStop(0, "rgba(255,236,190,.45)");
  bev.addColorStop(0.5, "rgba(255,255,255,0)");
  bev.addColorStop(1, "rgba(0,0,0,.5)");
  rr(x, X, Y, W, Hh, R);
  x.fillStyle = bev;
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = "#1e1206";
  x.stroke();
  // The field: patinated brass, sunk a step inside the rim.
  const I = 11;
  x.save();
  rr(x, X + I, Y + I, W - 2 * I, Hh - 2 * I, 4);
  x.clip();
  x.fillStyle = pattern(x, s.bronze, bronzeColour);
  x.fillRect(X, Y, W, Hh);
  const sheen = x.createLinearGradient(0, Y, 0, Y + Hh);
  sheen.addColorStop(0, "rgba(0,0,0,.3)");
  sheen.addColorStop(0.18, "rgba(255,240,200,.12)");
  sheen.addColorStop(1, "rgba(0,0,0,.22)");
  x.fillStyle = sheen;
  x.fillRect(X, Y, W, Hh);
  x.restore();
  rr(x, X + I, Y + I, W - 2 * I, Hh - 2 * I, 4);
  x.lineWidth = 2;
  x.strokeStyle = "rgba(20,10,2,.85)";
  x.stroke();
  rr(x, X + I + 1.5, Y + I + 2, W - 2 * I - 3, Hh - 2 * I - 3, 4);
  x.lineWidth = 1;
  x.strokeStyle = "rgba(255,230,180,.25)";
  x.stroke();
  for (const [cx, cy] of [
    [X + W - 6, Y + 6],
    [X + W - 6, Y + Hh - 6],
  ] as const) {
    x.beginPath();
    x.arc(cx, cy, 4.5, 0, Math.PI * 2);
    x.fillStyle = "#1a1008";
    x.fill();
    x.beginPath();
    x.arc(cx - 1, cy - 1, 2, 0, Math.PI * 2);
    x.fillStyle = "rgba(255,220,160,.6)";
    x.fill();
  }
  // Engraving: a deep cut in near-black ink, a 1-px light bevel on its lower lip, a shadow inside its upper edge.
  const engrave = (t: string, tx: number, ty: number): void => {
    x.fillStyle = "rgba(255,238,195,.85)";
    x.fillText(t, tx, ty + 1.5);
    x.fillStyle = "#0b0602";
    x.fillText(t, tx, ty);
    x.save();
    x.globalAlpha = 0.6;
    x.fillStyle = "#000";
    x.fillText(t, tx, ty - 1);
    x.restore();
  };
  x.textBaseline = "middle";
  const cy = Y + Hh / 2;
  // Life: a sunk panel at the right end, the numerals engraved in it.
  const life = String(p.life);
  x.font = `400 96px ${SERIF}`;
  const lw = Math.max(126, x.measureText(life).width + 40),
    lx = X + W - I - 8 - lw;
  rr(x, lx, Y + I + 7, lw, Hh - 2 * I - 14, 5);
  x.fillStyle = "rgba(30,16,4,.42)";
  x.fill();
  x.save();
  rr(x, lx, Y + I + 7, lw, Hh - 2 * I - 14, 5);
  x.clip();
  x.shadowColor = "rgba(0,0,0,.8)";
  x.shadowBlur = 10;
  x.shadowOffsetY = 4;
  x.lineWidth = 6;
  x.strokeStyle = "rgba(0,0,0,.6)";
  x.stroke();
  x.restore();
  rr(x, lx, Y + I + 7, lw, Hh - 2 * I - 14, 5);
  x.lineWidth = 1.5;
  x.strokeStyle = "rgba(255,230,180,.35)";
  x.stroke();
  x.textAlign = "center";
  x.font = `400 96px ${SERIF}`;
  x.fillStyle = "rgba(0,0,0,.6)";
  x.fillText(life, lx + lw / 2, cy + 3);
  x.fillStyle = "#f0dcae";
  x.fillText(life, lx + lw / 2, cy + 1);
  x.textAlign = "left";
  // The name, on a band of quieter brass: the patina is burnished off where the lettering is cut, so no blotch crosses it.
  const band = x.createLinearGradient(0, Y + I, 0, Y + Hh - I);
  band.addColorStop(0, "rgba(196,156,92,0)");
  band.addColorStop(0.18, "rgba(196,156,92,.72)");
  band.addColorStop(0.82, "rgba(176,138,78,.72)");
  band.addColorStop(1, "rgba(176,138,78,0)");
  x.fillStyle = band;
  x.fillRect(160, Y + I, lx - 172, Hh - 2 * I);
  const name = p.name + (p.monarch ? " ♛" : "");
  let fs = 66;
  x.font = `400 ${fs}px ${SERIF}`;
  while (fs > 40 && x.measureText(name).width > lx - 196) {
    fs -= 2;
    x.font = `400 ${fs}px ${SERIF}`;
  }
  engrave(name, 178, cy + 4);
  if (p.turn) {
    // whose turn: a lit ember set into the plaque
    const ex = lx - 30;
    x.beginPath();
    x.arc(ex, cy, 16, 0, Math.PI * 2);
    x.fillStyle = "#1a0c02";
    x.fill();
    const g = x.createRadialGradient(ex, cy, 0, ex, cy, 14);
    g.addColorStop(0, "#fff1c0");
    g.addColorStop(0.5, signal.option);
    g.addColorStop(1, "rgba(255,120,30,0)");
    x.shadowColor = signal.option;
    x.shadowBlur = 24;
    x.beginPath();
    x.arc(ex, cy, 13, 0, Math.PI * 2);
    x.fillStyle = g;
    x.fill();
    x.shadowBlur = 0;
  }
  // The seal: a pool of wax in the seat's colour over the plaque's left end, rim pressed up, the commander's face in it,
  // a gloss where the lamp catches it.
  const img = p.art ? art(p.art) : null,
    sx = 92,
    sy = cy;
  x.save();
  x.shadowColor = "rgba(0,0,0,.7)";
  x.shadowBlur = 12;
  x.shadowOffsetY = 4;
  x.beginPath();
  for (let i = 0; i <= 30; i++) {
    const a = (i / 30) * Math.PI * 2,
      r2 = 74 + Math.sin(i * 2.3) * 3.5 + Math.sin(i * 5.1) * 2.5;
    x.lineTo(sx + Math.cos(a) * r2, sy + Math.sin(a) * r2);
  }
  x.closePath();
  x.fillStyle = col;
  x.fill();
  x.restore();
  const wax = x.createRadialGradient(sx - 22, sy - 26, 4, sx, sy, 78);
  wax.addColorStop(0, "rgba(255,255,255,.35)");
  wax.addColorStop(0.35, "rgba(255,255,255,0)");
  wax.addColorStop(0.8, "rgba(0,0,0,.15)");
  wax.addColorStop(1, "rgba(0,0,0,.45)");
  x.beginPath();
  x.arc(sx, sy, 76, 0, Math.PI * 2);
  x.fillStyle = wax;
  x.fill();
  x.beginPath();
  x.arc(sx, sy, 56, 0, Math.PI * 2);
  x.lineWidth = 7;
  x.strokeStyle = "rgba(0,0,0,.35)";
  x.stroke();
  x.beginPath();
  x.arc(sx, sy, 60, Math.PI * 0.95, Math.PI * 1.75);
  x.lineWidth = 3;
  x.strokeStyle = "rgba(255,255,255,.3)";
  x.stroke();
  x.save();
  x.beginPath();
  x.arc(sx, sy, 52, 0, Math.PI * 2);
  x.clip();
  if (img) drawCover(x, img, sx - 52, sy - 52, 104, 104);
  x.fillStyle = col;
  x.globalAlpha = 0.45;
  x.fillRect(sx - 56, sy - 56, 112, 112);
  x.globalAlpha = 1;
  const pr = x.createRadialGradient(sx, sy, 30, sx, sy, 54);
  pr.addColorStop(0, "rgba(0,0,0,0)");
  pr.addColorStop(1, "rgba(0,0,0,.55)");
  x.fillStyle = pr;
  x.fillRect(sx - 56, sy - 56, 112, 112);
  x.restore();
}
