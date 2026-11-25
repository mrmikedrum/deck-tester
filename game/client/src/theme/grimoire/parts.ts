// The small pieces a card face is built from: name fitting, art cover, pills, keyword coins, the ability gem, mana
// pips and the tap badge. Ported from old h.js "Card faces"; every number is the tuned one.
import { colour, font, signal } from "../tokens";
import type { ManaKey } from "../tokens";
import { GLYPH, KEYWORD_ICONS, PIP } from "./glyphs";
import { rr } from "./shapes";
import type { Ctx } from "./shapes";
import { bronzeColour, pattern } from "./surfaces";
import type { Source, Surfaces } from "./surfaces";

const NUM = font.num;

export interface NameFit {
  readonly size: number;
  readonly lines: readonly string[];
}

/**
 * A name is never smaller than `min` px on the face (52; 72 on the far pages, where a card is small on screen): one line
 * if it fits, else two; a word too long even then is drawn narrower (fillText's maxWidth), never smaller.
 */
export function nameLines(x: Ctx, text: string, maxW: number, min = 52): NameFit {
  for (let s = min + 10; s >= min; s -= 2) {
    x.font = `700 ${s}px ${NUM}`;
    if (x.measureText(text).width <= maxW) return { size: s, lines: [text] };
  }
  const words = text.split(" ");
  const wrap = (): string[] => {
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (x.measureText(t).width <= maxW || !cur) cur = t;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    lines.push(cur);
    return lines;
  };
  for (let s = min + 4; s >= min; s -= 2) {
    x.font = `700 ${s}px ${NUM}`;
    const lines = wrap();
    if (lines.length <= 2 && lines.every((l) => x.measureText(l).width <= maxW)) return { size: s, lines };
  }
  x.font = `700 ${min}px ${NUM}`;
  const lines = wrap();
  return { size: min, lines: lines.length <= 2 ? lines : [lines[0] ?? "", lines.slice(1).join(" ")] };
}

/** Art covering a box, anchored a little above centre (faces sit in the upper part of the art). */
export function drawCover(
  x: Ctx,
  img: Source & { width: number; height: number },
  X: number,
  Y: number,
  W: number,
  H: number,
): void {
  const r = Math.max(W / img.width, H / img.height),
    w = img.width * r,
    h = img.height * r;
  x.drawImage(img, X + (W - w) / 2, Y + (H - h) / 2.6, w, h);
}

/** A tag on the art ("Copy", "Goaded"): a rounded slip with ink text; returns its width. */
export function pill(x: Ctx, text: string, X: number, Y: number, bg: string | CanvasPattern, fg: string): number {
  x.font = `700 26px ${NUM}`;
  const w = x.measureText(text).width + 22;
  rr(x, X, Y, w, 36, 6);
  x.fillStyle = bg;
  x.fill();
  x.lineWidth = 2;
  x.strokeStyle = "rgba(20,10,0,.7)";
  x.stroke();
  x.fillStyle = fg;
  x.textBaseline = "middle";
  x.fillText(text, X + 11, Y + 19);
  return w;
}

/** A keyword coin: a bronze rim round an ink field with the keyword's icon. */
export function kwIcon(x: Ctx, s: Surfaces, keyword: string, cx: number, cy: number, r: number): void {
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fillStyle = pattern(x, s.bronzeClean, bronzeColour);
  x.fill();
  x.lineWidth = 2.5;
  x.strokeStyle = "rgba(20,10,0,.8)";
  x.stroke();
  x.beginPath();
  x.arc(cx, cy, r - 4, 0, Math.PI * 2);
  x.fillStyle = "#2a1f14";
  x.fill();
  x.save();
  x.translate(cx - r * 0.62, cy - r * 0.62);
  x.scale((r * 1.24) / 24, (r * 1.24) / 24);
  x.fillStyle = "#fff";
  x.fill(new Path2D(KEYWORD_ICONS[keyword] ?? ""));
  x.restore();
}

/** The ability gem: a diamond, lit ember where you can use an ability now. */
export function gem(x: Ctx, cx: number, cy: number, on: boolean): void {
  x.save();
  x.translate(cx, cy);
  x.rotate(Math.PI / 4);
  if (on) {
    x.shadowColor = signal.option;
    x.shadowBlur = 18;
  }
  rr(x, -15, -15, 30, 30, 5);
  x.fillStyle = on ? signal.option : "#5c5850";
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = on ? "#eafcff" : "#a39a8a";
  x.stroke();
  x.restore();
}

/** A mana pip: the colour's disc with its symbol. */
export function pip(x: Ctx, m: string, cx: number, cy: number, r: number): void {
  const key: ManaKey = m in GLYPH ? (m as ManaKey) : "C";
  const [bg, fg] = PIP[key];
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fillStyle = bg;
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = "rgba(20,10,0,.7)";
  x.stroke();
  x.save();
  x.translate(cx - r * 0.78, cy - r * 0.78);
  x.scale((r * 1.56) / 24, (r * 1.56) / 24);
  x.fillStyle = fg;
  x.fill(new Path2D(GLYPH[key]), "evenodd");
  x.restore();
}

/** Tapped: the tap symbol on the art, so a tapped card reads as tapped even lying flat in a pile. */
export function tapBadge(x: Ctx, cx: number, cy: number): void {
  x.save();
  x.beginPath();
  x.arc(cx, cy, 32, 0, Math.PI * 2);
  x.fillStyle = colour.bone;
  x.shadowColor = "rgba(0,0,0,.6)";
  x.shadowBlur = 8;
  x.fill();
  x.shadowBlur = 0;
  x.lineWidth = 4;
  x.strokeStyle = colour.ink;
  x.stroke();
  x.beginPath();
  x.arc(cx, cy, 17, -Math.PI * 0.95, Math.PI * 0.35);
  x.lineWidth = 7;
  x.stroke();
  const ex = cx + 17 * Math.cos(Math.PI * 0.35),
    ey = cy + 17 * Math.sin(Math.PI * 0.35);
  x.beginPath();
  x.moveTo(ex + 11, ey - 3);
  x.lineTo(ex - 2, ey + 11);
  x.lineTo(ex - 6, ey - 8);
  x.closePath();
  x.fillStyle = colour.ink;
  x.fill();
  x.restore();
}
