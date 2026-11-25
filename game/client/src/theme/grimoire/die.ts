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
    bone: { body: 0xe8dcbc, ink: "#24160a", face: "#efe5c8" },
    iron: { body: 0x2c2624, ink: "#efe2c2", face: "#3a3230" },
    red: { body: 0x8e1d1d, ink: "#f6e8c8", face: "#a32424" },
  },
  tray: { rim: 0x6b4a26, floor: 0xb89868 },
  lip: { brass: "#b8924a", brassDark: "#6e5320", ink: "#22160a" },
} as const;

export interface DieSpec {
  readonly n: number;
  readonly tone: DieTone;
}

/** A die's top face: its tone, rounded, one inked numeral (one or two digits) as large as the face allows. */
export function paintDie(canvas: Canvas, spec: DieSpec): void {
  const S = 128, x = begin(canvas, S, S), t = kit.die[spec.tone];
  x.fillStyle = t.face;
  rr(x, 0, 0, S, S, 22);
  x.fill();
  const g = x.createRadialGradient(S * 0.4, S * 0.35, 4, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, "rgba(255,255,255,.18)");
  g.addColorStop(1, "rgba(0,0,0,.22)");
  x.fillStyle = g;
  rr(x, 0, 0, S, S, 22);
  x.fill();
  const txt = String(spec.n);
  x.fillStyle = t.ink;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `700 ${txt.length > 1 ? 84 : 104}px ${font.serif}`;
  x.fillText(txt, S / 2, S / 2 + 6, S - 14);
}

export interface TallySpec {
  /** Its strip word: "Ranks", "Others", "Mana", "Lands", "Rocks". */
  readonly word: string;
  /** The P/T box: "≤3/2" (nothing in here is bigger), or null. */
  readonly pt: string | null;
  /** Up to four inked lines, biggest first, then "+5". */
  readonly lines: readonly string[];
}

/** A tally card: vellum in a card's grammar, a name strip, an inked roster in the art window, a P/T box. */
export function paintTally(canvas: Canvas, spec: TallySpec, s: Surfaces): void {
  const W = 358, H = 500, x = begin(canvas, W, H);
  x.fillStyle = "#3a2716";
  rr(x, 0, 0, W, H, 18);
  x.fill();
  x.fillStyle = pattern(x, s.vellum, colour.bone);
  rr(x, 10, 10, W - 20, H - 20, 12);
  x.fill();
  // The name strip.
  x.fillStyle = "rgba(60,38,14,.16)";
  x.fillRect(22, 22, W - 44, 64);
  x.strokeStyle = "rgba(40,22,5,.7)";
  x.lineWidth = 3;
  x.strokeRect(22, 22, W - 44, 64);
  x.fillStyle = colour.ink;
  x.font = `700 54px ${font.num}`;
  x.textBaseline = "middle";
  x.textAlign = "left";
  x.fillText(spec.word, 36, 56, W - 80);
  // The roster, inked.
  x.strokeStyle = "rgba(40,22,5,.35)";
  x.lineWidth = 2;
  x.strokeRect(30, 100, W - 60, 300);
  x.font = `italic 400 40px ${font.serif}`;
  spec.lines.slice(0, 5).forEach((l, i) => x.fillText(l, 44, 136 + i * 56, W - 88));
  // The P/T box.
  if (spec.pt) {
    x.fillStyle = "#f6efd8";
    rr(x, W - 150, H - 84, 126, 62, 8);
    x.fill();
    x.strokeStyle = colour.ink;
    x.lineWidth = 3;
    x.stroke();
    x.fillStyle = colour.ink;
    x.textAlign = "center";
    x.font = `700 50px ${font.num}`;
    x.fillText(spec.pt, W - 87, H - 52, 116);
  }
}

export interface LipSpec {
  readonly text: string;
  readonly icons: readonly { readonly keyword: string; readonly count: number | null }[];
}

/** The lip's canvas size, px: one line on a brass strip as wide as the tray. */
export const LIP_PX = { w: 512, h: 72 } as const;

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
  x.font = `700 54px ${font.num}`;
  x.textBaseline = "middle";
  const icons = spec.icons.filter((i) => KEYWORD_ICONS[i.keyword]).slice(0, 3);
  const iw = (i: (typeof icons)[number]) => 50 + (i.count !== null ? x.measureText(String(i.count)).width + 4 : 0);
  const tw = x.measureText(spec.text).width, total = tw + icons.reduce((t, i) => t + 14 + iw(i), 0);
  let at = Math.max(14, W / 2 - total / 2);
  x.fillStyle = kit.lip.ink;
  x.textAlign = "left";
  x.fillText(spec.text, at, H / 2 + 3, W - 28);
  at += tw + 14;
  for (const i of icons) {
    x.save();
    x.translate(at, H / 2 - 22);
    x.scale(44 / 24, 44 / 24);
    x.fill(new Path2D(KEYWORD_ICONS[i.keyword]!));
    x.restore();
    if (i.count !== null) x.fillText(String(i.count), at + 48, H / 2 + 3);
    at += iw(i) + 14;
  }
}
