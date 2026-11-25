// A leaf's slip (focus-first): a strip of vellum lying on the table under an opponent's page, edged in ink with a rule in
// the seat's colour, holding at most two lines: the force in condensed ink, the one thing worth saying in italic serif
// (red when a sweep would take it).
import { colour, font, signal } from "../tokens";
import { begin, rr } from "./shapes";
import type { Canvas } from "./shapes";
import { pattern } from "./surfaces";
import type { Surfaces } from "./surfaces";

export interface ReadingSpec {
  readonly lines: readonly { readonly text: string; readonly tone: "ink" | "italic" | "red" }[];
  /** The seat's colour: the rule down its side. */
  readonly colour: string;
  /** Its size on the table, world units: the canvas keeps the same proportion. */
  readonly w: number;
  readonly d: number;
}

/** Canvas pixels per world unit. */
export const READING_PX = 150;

export function paintReading(canvas: Canvas, spec: ReadingSpec, s: Surfaces): void {
  const W = Math.round(spec.w * READING_PX), H = Math.round(spec.d * READING_PX);
  const x = begin(canvas, W, H);
  const n = Math.max(1, spec.lines.length), pad = H * 0.06, rule = H * 0.07;
  // The strip only as deep as its lines: one line, a narrower strip under the page's edge.
  const h = n === 1 ? H * 0.6 : H - 4;
  x.shadowColor = "rgba(0,0,0,.45)";
  x.shadowBlur = 10;
  x.shadowOffsetY = 4;
  rr(x, 4, 2, W - 8, h - 6, 6);
  x.fillStyle = pattern(x, s.vellum, colour.bone);
  x.fill();
  x.shadowColor = "transparent";
  x.lineWidth = 3;
  x.strokeStyle = "rgba(40,22,5,.8)";
  x.stroke();
  x.fillStyle = spec.colour;
  x.fillRect(10, 10, rule, h - 26);
  x.textAlign = "left";
  x.textBaseline = "middle";
  const left = 10 + rule + pad, room = W - left - pad;
  const lineH = (h - 2 * pad) / n;
  spec.lines.forEach((l, i) => {
    const px = Math.round(lineH * (l.tone === "ink" ? 0.92 : 0.88));
    // (Line 2 in the same face as line 1, lighter: the most useful line on the table must read as easily.)
    x.font = `${l.tone === "ink" ? 600 : 500} ${px}px ${font.num}`;
    x.fillStyle = l.tone === "red" ? signal.dangerInk : l.tone === "ink" ? colour.ink : colour.ink2;
    x.fillText(l.text, left, pad + lineH * (i + 0.52), room);
  });
}
