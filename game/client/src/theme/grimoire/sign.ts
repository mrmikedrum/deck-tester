// Labels printed on bone: pile signs, title tabs, stack tags and counter chips. Ported from old h.js `signTex`,
// `tagTex` and `chipTex`. Each painter sizes the canvas it is given and returns the size it chose.
import { colour, font } from "../tokens";
import { begin, rr } from "./shapes";
import type { Canvas, Ctx } from "./shapes";
import { bronzeColour, pattern } from "./surfaces";
import type { Surfaces } from "./surfaces";

const NUM = font.num;

/** World units per canvas pixel of a sign. */
export const SIGN_U = 0.00375;
/** A title tab's greatest height above its card. */
export const TAB_H = 0.24;

/** A sign: a slip of vellum edged in ink, as wide as its words, with the seat's seal notch when it speaks for a seat. */
export interface SignSpec {
  readonly text: string;
  /** The seat's colour: draws the seal notch. */
  readonly colour: string | null;
  /** A second line. */
  readonly sub: string | null;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

export function paintSign(canvas: Canvas, spec: SignSpec, s: Surfaces): Size {
  const { text, colour: col, sub } = spec;
  const probe = canvas.getContext("2d");
  if (!probe) throw new Error("no 2d context");
  probe.font = `700 60px ${NUM}`;
  let tw = probe.measureText(text).width;
  if (sub) {
    probe.font = `600 46px ${NUM}`;
    tw = Math.max(tw, probe.measureText(sub).width);
  }
  const notch = col ? 34 : 0,
    w = Math.min(sub ? 900 : 560, tw + 36 + notch),
    h = sub ? 130 : 80;
  const x = begin(canvas, Math.ceil(w + 16), h + 16);
  x.shadowColor = "rgba(0,0,0,.6)";
  x.shadowBlur = 8;
  x.shadowOffsetY = 3;
  rr(x, 8, 6, w, h, 6);
  x.fillStyle = pattern(x, s.vellum, colour.bone);
  x.fill();
  x.shadowColor = "transparent";
  x.lineWidth = 2.5;
  x.strokeStyle = "rgba(40,22,5,.85)";
  rr(x, 8, 6, w, h, 6);
  x.stroke();
  if (col) seal(x, 8 + 24, 46, 15, col, 18);
  x.fillStyle = colour.ink;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `700 60px ${NUM}`;
  x.fillText(text, 8 + (w + notch) / 2, 49, w - 28 - notch);
  if (sub) {
    x.font = `600 46px ${NUM}`;
    x.fillStyle = "#3a2c1a";
    x.fillText(sub, 8 + (w + notch) / 2, 102, w - 28 - notch);
  }
  return { w: canvas.width, h: canvas.height };
}

/** The seat's seal: a scalloped disc in its colour. */
function seal(x: Ctx, cx: number, cy: number, r: number, col: string, points: number): void {
  x.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2,
      r2 = r + (i % 2 ? 2 : -1);
    x.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
  }
  x.closePath();
  x.fillStyle = col;
  x.fill();
  x.lineWidth = 1.5;
  x.strokeStyle = "rgba(0,0,0,.4)";
  x.stroke();
}

export const TAG_W = 248;
export const TAG_H = 80;

/** A stack item's tag: the seat's seal and the item's name on bone, squarer than a sign, with an ink edge. */
export function paintTag(canvas: Canvas, text: string, col: string, s: Surfaces): void {
  const x = begin(canvas, TAG_W, TAG_H);
  rr(x, 4, 4, 240, 72, 6);
  x.fillStyle = pattern(x, s.vellum, colour.bone);
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = "rgba(40,22,5,.85)";
  x.stroke();
  seal(x, 30, 40, 16, col, 18);
  x.font = `700 44px ${NUM}`;
  x.fillStyle = colour.ink;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, 140, 42, 180);
}

/** A counter chip: every chip is the same token (a bronze rim round a vellum face, the number in ink); only the ink changes. */
export interface ChipSpec {
  readonly text: string;
  readonly ink: string;
  /** The counter's kind, written under its number. */
  readonly sub: string | null;
}

export const CHIP_PX = 128;

export function paintChip(canvas: Canvas, spec: ChipSpec, s: Surfaces): void {
  const { text, ink, sub } = spec;
  const x = begin(canvas, CHIP_PX, CHIP_PX);
  x.beginPath();
  x.arc(64, 64, 62, 0, Math.PI * 2);
  x.fillStyle = pattern(x, s.bronzeClean, bronzeColour);
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = "rgba(20,10,0,.9)";
  x.stroke();
  x.beginPath();
  x.arc(64, 64, 50, 0, Math.PI * 2);
  x.fillStyle = pattern(x, s.vellum, colour.bone);
  x.fill();
  x.lineWidth = 2.5;
  x.strokeStyle = "rgba(20,10,0,.75)";
  x.stroke();
  const sh = x.createRadialGradient(50, 46, 4, 64, 64, 54);
  sh.addColorStop(0, "rgba(255,250,230,.25)");
  sh.addColorStop(1, "rgba(60,35,10,.25)");
  x.fillStyle = sh;
  x.fill();
  x.fillStyle = ink;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `700 ${sub ? 54 : 62}px ${NUM}`;
  x.fillText(text, 64, sub ? 54 : 68);
  if (sub) {
    x.font = `700 24px ${NUM}`;
    x.fillText(sub, 64, 96);
  }
}

/** What each counter kind's chip says: its ink and the word under the number. */
const COUNTER_INK: Readonly<Record<string, readonly [string, string | null]>> = {
  P1P1: ["#14602c", null],
  M1M1: ["#7a1f14", null],
  CHARGE: [colour.ink, "charge"],
  LORE: [colour.ink, "lore"],
  STORY: [colour.ink, "story"],
  LUCK: [colour.ink, "luck"],
  INDESTRUCTIBLE: [colour.ink, "indestr."],
};

/** The engine's counter names in the chips' terms (live.js `ctr`): "+1/+1" is P1P1, "Loyalty" LOYALTY, "Charge" CHARGE. */
const COUNTER_KIND: Readonly<Record<string, string>> = { "+1/+1": "P1P1", "-1/-1": "M1M1", Loyalty: "LOYALTY", LOYAL: "LOYALTY" };
export const counterKind = (name: string): string => COUNTER_KIND[name] ?? name.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The chip for `value` counters of `kind`, by the engine's name or the chips' own (loyalty is on the face, not a chip). */
export function counterChip(kind: string, value: number): ChipSpec {
  const k = counterKind(kind);
  const [ink, sub] = COUNTER_INK[k] ?? [colour.ink, k.toLowerCase()];
  return { text: k === "P1P1" ? "+" + value : k === "M1M1" ? "−" + value : String(value), ink, sub };
}
