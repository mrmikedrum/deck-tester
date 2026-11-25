// A card face: the narrow description the painter needs (`FaceSpec`), its cache key, and the painter. Ported from
// old h.js `drawFace`; the model maps a Card to a FaceSpec (nothing here knows about the model).
import { colour, font, signal } from "../tokens";
import { drawBack } from "./back";
import { FACE_H, FACE_W } from "./face-size";
import { faceKeywords } from "./glyphs";
import { shortName, shortType } from "./names";
import { drawCover, gem, kwIcon, nameLines, pill, pip, tapBadge } from "./parts";
import { begin, canonical, rr } from "./shapes";
import type { Canvas, Ctx } from "./shapes";
import { FRAME_FALLBACK, pattern } from "./surfaces";
import type { FrameKey, Source, Surfaces } from "./surfaces";

const NUM = font.num;

/** What a card's foot shows, by kind: numbers for a creature, loyalty for a walker, mana for a land, else its type. */
export type FaceFoot =
  | {
      readonly kind: "creature";
      readonly power: number;
      readonly toughness: number;
      readonly basePower: number;
      readonly baseToughness: number;
    }
  | { readonly kind: "walker"; readonly loyalty: string }
  | { readonly kind: "land"; readonly mana: readonly string[] }
  | { readonly kind: "type"; readonly typeLine: string };

/** A tag in a seat's colour (the owner when it is not the controller, a tip). */
export interface FaceTag {
  readonly label: string;
  readonly colour: string;
}

/**
 * Everything a face paints, and nothing it does not: two specs that are equal paint the same pixels. `art` is the
 * url of art that is ready to draw (null until it has loaded, so a face repaints when it arrives).
 */
export interface FaceSpec {
  /** Face down: the tome's back, with a tap badge if tapped. */
  readonly down: boolean;
  /** The printed name; the painter shortens it. */
  readonly name: string;
  readonly frame: FrameKey;
  readonly token: boolean;
  readonly commander: boolean;
  readonly tapped: boolean;
  /** Not the viewer's: the name is larger and its strip taller, since the card is small on screen. */
  readonly far: boolean;
  readonly art: string | null;
  /** Rules text, shown where there is no art. */
  readonly text: string;
  readonly foot: FaceFoot;
  /** Keyword names (those with icons are drawn). */
  readonly keywords: readonly string[];
  /** The ability gem: none, dim (has abilities), lit (you can use one now). */
  readonly gem: "none" | "idle" | "lit";
  /** "Copy", "Transformed", "Goaded", "Land now". */
  readonly tags: readonly string[];
  /** The owner's seal, when it is not the controller. */
  readonly owner: FaceTag | null;
  readonly tip: FaceTag | null;
}

export const FACE_DEFAULTS: Omit<FaceSpec, "name"> = {
  down: false,
  frame: "C",
  token: false,
  commander: false,
  tapped: false,
  far: false,
  art: null,
  text: "",
  foot: { kind: "type", typeLine: "" },
  keywords: [],
  gem: "none",
  tags: [],
  owner: null,
  tip: null,
};

/** A spec from the fields that differ from the plain defaults. */
export function faceSpec(over: Partial<FaceSpec> & { readonly name: string }): FaceSpec {
  return { ...FACE_DEFAULTS, ...over };
}

/** The cache key of a face: equal for equal looks, whatever order the fields were built in. */
export function faceKey(spec: FaceSpec): string {
  return spec.down ? `back|${spec.tapped}` : canonical(spec);
}

export type ArtOf = (url: string) => (Source & { width: number; height: number }) | null;

export interface FaceEnv {
  readonly surfaces: Surfaces;
  /** Decoded art by url; null where not loaded. */
  readonly art: ArtOf;
}

/** Paint a face into a canvas (sized here: FACE_W x FACE_H). */
export function paintFace(canvas: Canvas, spec: FaceSpec, env: FaceEnv): void {
  drawFace(begin(canvas, FACE_W, FACE_H), spec, env);
}

/** Paint a card back into a canvas. */
export function paintBack(canvas: Canvas, env: Pick<FaceEnv, "surfaces">): void {
  drawBack(begin(canvas, FACE_W, FACE_H), env.surfaces);
}

export function drawFace(x: Ctx, c: FaceSpec, env: FaceEnv): void {
  const FW = FACE_W,
    FH = FACE_H,
    s = env.surfaces;
  if (c.down) {
    drawBack(x, s);
    if (c.tapped) tapBadge(x, FW - 62, 70);
    return;
  }
  const vellum = pattern(x, s.vellum, colour.bone);
  x.clearRect(0, 0, FW, FH);
  // One frame: matte card stock in the card's colour, a single dark edge, a soft shade toward the corners.
  rr(x, 4, 4, FW - 8, FH - 8, 16);
  x.fillStyle = pattern(x, s.frame[c.frame], FRAME_FALLBACK[c.frame]);
  x.fill();
  x.save();
  rr(x, 4, 4, FW - 8, FH - 8, 16);
  x.clip();
  const vig = x.createRadialGradient(FW / 2, FH / 2, FW * 0.3, FW / 2, FH / 2, FH * 0.75);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,.28)");
  x.fillStyle = vig;
  x.fillRect(0, 0, FW, FH);
  if (c.token) {
    x.setLineDash([8, 6]);
    rr(x, 14, 14, FW - 28, FH - 28, 10);
    x.lineWidth = 2;
    x.strokeStyle = "rgba(60,40,15,.5)";
    x.stroke();
    x.setLineDash([]);
  }
  x.restore();
  rr(x, 4, 4, FW - 8, FH - 8, 16);
  x.lineWidth = 3;
  x.strokeStyle = c.frame === "B" ? "rgba(0,0,0,.9)" : "rgba(26,16,6,.85)";
  x.stroke();
  if (c.commander) {
    rr(x, 10, 10, FW - 20, FH - 20, 12);
    x.lineWidth = 3;
    x.strokeStyle = colour.commander;
    x.stroke();
  }
  // Name: the card's identity, as large as the card allows. A card across the table (not mine) is small on screen, so its
  // name is larger still (72 px at the least) and its strip wider and taller, up to a third of the card, at the art's expense.
  const far = c.far,
    nx = far ? 26 : 32,
    nW = FW - 2 * nx + 4;
  const nl = nameLines(x, shortName(c.name), nW, far ? 72 : 52);
  const barH = Math.min(
    far ? Math.round(FH / 3) : FH,
    nl.lines.length > 1 ? Math.round(nl.size * 1.94 + (far ? 14 : 10)) : Math.round(nl.size * 1.18 + (far ? 14 : 8)),
  );
  // The name strip: parchment, ink. Legible first.
  rr(x, 22, 22, FW - 44, barH, 6);
  x.fillStyle = vellum;
  x.fill();
  x.lineWidth = 2;
  x.strokeStyle = "rgba(26,16,6,.8)";
  x.stroke();
  x.textBaseline = "middle";
  x.font = `700 ${nl.size}px ${NUM}`;
  x.fillStyle = colour.ink;
  nl.lines.forEach((l, i) =>
    x.fillText(l, nx, 22 + barH / 2 + (i - (nl.lines.length - 1) / 2) * nl.size * 0.94 + 2, nW),
  );
  // Art, with an ink line around it.
  const footH = 104,
    artY = 22 + barH + 6,
    artH = FH - 22 - footH - 6 - artY;
  rr(x, 22, artY, FW - 44, artH, 6);
  x.lineWidth = 2;
  x.strokeStyle = "rgba(26,16,6,.8)";
  x.stroke();
  x.save();
  rr(x, 23, artY + 1, FW - 46, artH - 2, 5);
  x.clip();
  const img = c.art ? env.art(c.art) : null;
  if (img) drawCover(x, img, 20, artY, FW - 40, artH);
  else paintTextArt(x, c.text, artY, artH);
  x.restore();
  let px = 28;
  for (const t of c.tags) px += pill(x, t, px, artY + 8, vellum, colour.ink) + 6;
  if (c.owner) pill(x, c.owner.label, 36, artY + artH - 44, c.owner.colour, "#f3e6c4");
  paintFoot(x, c, env, vellum, FH - 22 - footH, footH);
  if (c.tip) {
    x.font = `700 28px ${NUM}`;
    pill(x, c.tip.label, 36, FH - 22 - footH - 46, c.tip.colour, "#f3e6c4");
  }
  if (c.tapped) tapBadge(x, FW - 62, artY + 42);
}

/** No art (a card Scryfall lacks): its rules text instead. */
function paintTextArt(x: Ctx, text: string, artY: number, artH: number): void {
  const FW = FACE_W;
  x.fillStyle = "#2a2018";
  x.fillRect(20, artY, FW - 40, artH);
  const words = text
    .replace(/\([^)]*\)/g, "")
    .split(/\s+/)
    .filter(Boolean);
  x.font = `500 22px ${NUM}`;
  x.fillStyle = "#d9dee6";
  x.textBaseline = "top";
  let line = "",
    y = artY + 12;
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (x.measureText(t).width > FW - 64 && line) {
      x.fillText(line, 32, y);
      y += 25;
      line = w;
      if (y > artY + artH - 30) {
        line += " …";
        break;
      }
    } else line = t;
  }
  if (line && y <= artY + artH - 26) x.fillText(line, 32, y);
}

/**
 * The foot: what matters at a glance, on parchment. It is shared: numbers on the right, as wide as their text needs;
 * keyword coins and the ability gem take only what is left, at most two coins and then "+n", so nothing ever runs into
 * the numbers.
 */
function paintFoot(x: Ctx, c: FaceSpec, env: FaceEnv, vellum: CanvasPattern | string, fy: number, footH: number): void {
  const FW = FACE_W,
    mid = fy + footH / 2,
    right = FW - 30,
    foot = c.foot;
  rr(x, 22, fy, FW - 44, footH, 6);
  x.fillStyle = vellum;
  x.fill();
  x.lineWidth = 2;
  x.strokeStyle = "rgba(26,16,6,.8)";
  x.stroke();
  let ptW: number,
    txt = "";
  if (foot.kind === "creature") {
    x.font = `700 62px ${NUM}`;
    txt = `${foot.power}/${foot.toughness}`;
    ptW = Math.max(110, x.measureText(txt).width + 30);
  } else if (foot.kind === "walker") ptW = 100;
  else if (foot.kind === "land") ptW = Math.min(5, foot.mana.length) * 50;
  else {
    x.font = `600 36px ${NUM}`;
    ptW = x.measureText(shortType(foot.typeLine)).width;
  }
  const gemOn = c.gem !== "none",
    room = right - ptW - 14 - 30 - (gemOn ? 46 : 0);
  const kws = faceKeywords(c.keywords),
    more = (n: number): number => (kws.length > n ? 34 : 0);
  let nCoin = Math.min(2, kws.length);
  while (nCoin > 0 && nCoin * 52 + more(nCoin) > room) nCoin--;
  let lx = 54;
  kws.slice(0, nCoin).forEach((k) => {
    kwIcon(x, env.surfaces, k, lx, mid, 23);
    lx += 52;
  });
  if (kws.length > nCoin && room >= 34) {
    x.font = `700 30px ${NUM}`;
    x.fillStyle = colour.ink;
    x.fillText("+" + (kws.length - nCoin), lx - 22, mid + 2);
    lx += 36;
  }
  if (gemOn) {
    gem(x, lx, mid, c.gem === "lit");
    lx += 46;
  }
  if (foot.kind === "creature") {
    const w = ptW;
    x.font = `700 62px ${NUM}`;
    rr(x, right - w, fy + 12, w, footH - 24, 6);
    x.fillStyle = "rgba(26,16,6,.1)";
    x.fill();
    x.lineWidth = 2;
    x.strokeStyle = "rgba(26,16,6,.7)";
    x.stroke();
    const up = foot.power > foot.basePower || foot.toughness > foot.baseToughness,
      down = foot.power < foot.basePower || foot.toughness < foot.baseToughness;
    x.fillStyle = up ? "#1a6a30" : down ? signal.dangerInk : colour.ink;
    x.textAlign = "center";
    x.fillText(txt, right - w / 2, mid + 3);
    x.textAlign = "left";
  } else if (foot.kind === "walker") {
    x.beginPath();
    x.moveTo(right - 100, fy + 14);
    x.lineTo(right, fy + 14);
    x.lineTo(right, mid + 10);
    x.quadraticCurveTo(right - 50, fy + footH - 4, right - 100, mid + 10);
    x.closePath();
    x.fillStyle = "rgba(26,16,6,.1)";
    x.fill();
    x.lineWidth = 2;
    x.strokeStyle = "rgba(26,16,6,.7)";
    x.stroke();
    x.font = `700 54px ${NUM}`;
    x.fillStyle = colour.ink;
    x.textAlign = "center";
    x.fillText(foot.loyalty, right - 50, mid + 1);
    x.textAlign = "left";
  } else if (foot.kind === "land") {
    let pxx = right - 22;
    foot.mana
      .slice(0, 5)
      .reverse()
      .forEach((m) => {
        pip(x, m, pxx, mid, 22);
        pxx -= 50;
      });
  } else {
    x.font = `600 36px ${NUM}`;
    x.fillStyle = "#4a3a24";
    x.textAlign = "right";
    x.fillText(shortType(foot.typeLine), right, mid + 2);
    x.textAlign = "left";
  }
}
