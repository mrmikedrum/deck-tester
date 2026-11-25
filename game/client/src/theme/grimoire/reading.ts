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
  /** Cast brass, a plaque's (the clash's tally): one line, large, bone on bronze. */
  readonly brass?: boolean;
}

/** Canvas pixels per world unit. */
export const READING_PX = 150;

export function paintReading(canvas: Canvas, spec: ReadingSpec, s: Surfaces): void {
  const W = Math.round(spec.w * READING_PX), H = Math.round(spec.d * READING_PX);
  const x = begin(canvas, W, H);
  if (spec.brass) {
    rr(x, 3, 3, W - 6, H - 6, 12);
    const gr = x.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#b88f52");
    gr.addColorStop(0.5, colour.bronze);
    gr.addColorStop(1, "#5c4322");
    x.fillStyle = gr;
    x.fill();
    x.lineWidth = 5;
    x.strokeStyle = "rgba(30,18,6,.9)";
    x.stroke();
    x.fillStyle = spec.colour;
    x.beginPath();
    x.arc(H * 0.48, H / 2, H * 0.24, 0, Math.PI * 2);
    x.fill();
    x.font = `700 ${Math.round(H * 0.56)}px ${font.num}`;
    x.fillStyle = colour.bone;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.shadowColor = "rgba(0,0,0,.6)";
    x.shadowBlur = 4;
    x.fillText(spec.lines[0]?.text ?? "", W / 2 + H * 0.3, H / 2 + 2, W - H * 1.2);
    return;
  }
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
