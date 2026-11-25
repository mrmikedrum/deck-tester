// Under a die (the `die` layout's kit): a die's top face with its inked numeral, a tally card naming a mixed stack, and
// the brass lip along a tray's front. Pure painters: each sizes the canvas it is given.
import { colour, font } from "../tokens";
import { KEYWORD_ICONS } from "./glyphs";
import { begin, rr } from "./shapes";
import type { Canvas } from "./shapes";
import { pattern } from "./surfaces";
import type { Surfaces } from "./surfaces";

/** The dice: bone counts what lies ready, iron what lies tapped, red the unblocked power aimed at a seat. */
export type DieTone = "bone" | "iron" | "red";

/** The dice's and the tray's colours (three.js reads the hex integers). */
export const kit = {
  die: {
    bone: { body: 0xcfc2a0, ink: "#1e1308", face: "#ddd1b0" },
    iron: { body: 0x332c29, ink: "#f1e5c4", face: "#3d3532" },
    red: { body: 0x8e1d1d, ink: "#f6e8c8", face: "#a32424" },
  },
  tray: { rim: 0x6b4a26, floor: 0xb89868 },
  lip: { brass: "#b8924a", brassDark: "#6e5320", ink: "#22160a" },
} as const;

export interface DieSpec {
  readonly n: number;
  readonly tone: DieTone;
}

/** A die's top face: its tone, worn at the corners, one lining numeral (one or two digits) filling 70% of it. */
export function paintDie(canvas: Canvas, spec: DieSpec): void {
  const S = 128, x = begin(canvas, S, S), t = kit.die[spec.tone];
  x.fillStyle = t.face;
  rr(x, 0, 0, S, S, 12);
  x.fill();
  const g = x.createRadialGradient(S * 0.4, S * 0.35, 4, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, "rgba(255,255,255,.08)");
  g.addColorStop(1, "rgba(0,0,0,.25)");
  x.fillStyle = g;
  rr(x, 0, 0, S, S, 12);
  x.fill();
  const txt = String(spec.n);
  x.fillStyle = t.ink;
  x.textAlign = "center";
  x.textBaseline = "alphabetic";
  // (Lining figures in the cards' P/T face: "10" never reads "IO". Its cap height fills 70% of the face.)
  const px = 118;
  x.font = `700 ${px}px ${font.num}`;
  const m = x.measureText(txt), w = m.width, cap = m.actualBoundingBoxAscent || px * 0.7;
  const k = Math.min((S * 0.7) / cap, (S * 0.86) / Math.max(1, w));
  x.save();
  x.translate(S / 2, S / 2 + (cap * k) / 2);
  x.scale(k, k);
  x.fillText(txt, 0, 0);
  x.restore();
}

export interface TallySpec {
  /** Its strip word: "Ranks", "Others", "Mana", "Lands", "Rocks". */
  readonly word: string;
  /** The P/T box: "≤3/2" (nothing in here is bigger), or null. */
  readonly pt: string | null;
  /** Up to four inked lines, biggest first, then "+5". */
  readonly lines: readonly string[];
}

/**
 * A tally card (Ranks): vellum in a card's grammar. Its name strip (its right end clear for its die); up to four roster
 * lines in the card-name face, each with its P/T right-aligned ("2 Evolution Sage   3/2", "+5 more"); and the "≤3/2" box
 * large at its foot: nothing in it is bigger.
 */
export function paintTally(canvas: Canvas, spec: TallySpec, s: Surfaces): void {
  const W = 358, H = 500, x = begin(canvas, W, H);
  x.fillStyle = "#3a2716";
  rr(x, 0, 0, W, H, 18);
  x.fill();
  x.fillStyle = pattern(x, s.vellum, colour.bone);
  rr(x, 10, 10, W - 20, H - 20, 12);
  x.fill();
  x.fillStyle = "rgba(60,38,14,.16)";
  x.fillRect(20, 20, W - 40, 64);
  x.strokeStyle = "rgba(40,22,5,.7)";
  x.lineWidth = 3;
  x.strokeRect(20, 20, W - 40, 64);
  x.fillStyle = colour.ink;
  x.font = `700 56px ${font.num}`;
  x.textBaseline = "middle";
  x.textAlign = "left";
  x.fillText(spec.word, 32, 54, W - 150);
  // The roster: the card-name face, P/T at the right.
  x.font = `700 50px ${font.num}`;
  spec.lines.slice(0, 4).forEach((l, i) => {
    const [name, pt] = l.split("\t"), y = 128 + i * 64;
    x.textAlign = "left";
    x.fillText(name ?? "", 30, y, pt ? W - 150 : W - 60);
    if (pt) {
      x.textAlign = "right";
      x.fillText(pt, W - 28, y);
    }
    x.strokeStyle = "rgba(40,22,5,.25)";
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(28, y + 32);
    x.lineTo(W - 28, y + 32);
    x.stroke();
  });
  if (spec.pt) {
    x.fillStyle = "#f6efd8";
    rr(x, 60, H - 116, W - 120, 92, 10);
    x.fill();
    x.strokeStyle = colour.ink;
    x.lineWidth = 4;
    x.stroke();
    x.fillStyle = colour.ink;
    x.textAlign = "center";
    x.font = `700 84px ${font.num}`;
    x.fillText(spec.pt, W / 2, H - 68, W - 140);
  }
}

export interface LipSpec {
  readonly text: string;
  readonly icons: readonly { readonly keyword: string; readonly count: number | null }[];
}

/** The lip's canvas size, px: one line on a brass strip as wide as the tray. */
export const LIP_PX = { w: 512, h: 84, font: 64 } as const;

/** A tray's brass lip: total power, then keyword icons, each with a count unless every member has it. */
export function paintLip(canvas: Canvas, spec: LipSpec, s: Surfaces): void {
  const { w: W, h: H } = LIP_PX, x = begin(canvas, W, H);
  x.fillStyle = pattern(x, s.bronze, kit.lip.brass);
  rr(x, 0, 0, W, H, 10);
  x.fill();
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(255,236,180,.45)");
  g.addColorStop(0.5, "rgba(255,236,180,.05)");
  g.addColorStop(1, "rgba(40,24,4,.45)");
  x.fillStyle = g;
  rr(x, 0, 0, W, H, 10);
  x.fill();
  x.strokeStyle = kit.lip.brassDark;
  x.lineWidth = 4;
  rr(x, 2, 2, W - 4, H - 4, 9);
  x.stroke();
  x.font = `700 ${LIP_PX.font}px ${font.num}`;
  x.textBaseline = "middle";
  const icons = spec.icons.filter((i) => KEYWORD_ICONS[i.keyword]).slice(0, 3);
  // (An icon as tall as the text, then its count bare: "26 power ✈ 2", never "+2".)
  const IC = 64;
  const iw = (i: (typeof icons)[number]) => IC + 4 + (i.count !== null ? x.measureText(String(i.count)).width + 6 : 0);
  const tw = x.measureText(spec.text).width, total = tw + icons.reduce((t, i) => t + 14 + iw(i), 0);
  let at = Math.max(14, W / 2 - total / 2);
  x.fillStyle = kit.lip.ink;
  x.textAlign = "left";
  x.fillText(spec.text, at, H / 2 + 3, W - 28);
  at += tw + 14;
  for (const i of icons) {
    x.save();
    x.translate(at, H / 2 - IC / 2);
    x.scale(IC / 24, IC / 24);
    x.fill(new Path2D(KEYWORD_ICONS[i.keyword]!));
    x.restore();
    if (i.count !== null) x.fillText(String(i.count), at + IC + 6, H / 2 + 3);
    at += iw(i) + 14;
  }
}
