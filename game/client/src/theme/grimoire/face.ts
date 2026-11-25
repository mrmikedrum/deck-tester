// A card's table face: the narrow description the painter needs (`FaceSpec`), its cache key, and the painter. A face is
// composed from what the card is now, never chosen per type: its stock is its colour, its window's shape what it is
// made of, its foot what it can do now; a commander is its name in gold leaf. A basic land, a dual, an any-colour land,
// a utility land, a planeswalker and a battle are whole faces of their own; the small form (under 56 px on screen) is a
// second drawing from the same facts. The model maps a Card to a FaceSpec (nothing here knows about the model).
import { colour, font, signal } from "../tokens";
import { drawBack } from "./back";
import { FACE_H, FACE_W } from "./face-size";
import { faceKeywords } from "./glyphs";
import { shortName } from "./names";
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
      /** It has a body's figures but is not a creature now (a vehicle, a charging spacecraft): drawn hollow. */
      readonly hollow?: boolean;
    }
  | { readonly kind: "walker"; readonly loyalty: string }
  | { readonly kind: "battle"; readonly defense: string }
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
  /** What it is made of now, for its window: an artifact's eight sides, an enchantment's arch, a land's corners. */
  readonly made: readonly ("artifact" | "enchantment" | "land")[];
  /** A face of its own, where what it is is all there is to say (null: composed). */
  readonly whole: FaceWhole | null;
  /** The mana it makes (letters), shown at its foot; a land's symbols on a whole face. */
  readonly mana: readonly string[];
  /** The small form, for a card under 56 px on screen: one word, one figure or one glyph. */
  readonly small: boolean;
}

/** The whole-face cases: a basic land, a dual or tri land, a land of any colour, a utility land, a planeswalker, a battle. */
export type FaceWhole = "basic" | "dual" | "any" | "utility" | "walker" | "battle";

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
  made: [],
  whole: null,
  mana: [],
  small: false,
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

/** The printed card at this size (twice the painted face's, so it reads held up large). */
export const PRINTED = { w: FACE_W * 2, h: FACE_H * 2, radius: 0.0475 } as const;

/** Paint a printed card image into a canvas, with the card's rounded corners. */
export function paintPrinted(canvas: Canvas, img: NonNullable<ReturnType<ArtOf>>): void {
  const x = begin(canvas, PRINTED.w, PRINTED.h);
  x.save();
  rr(x, 0, 0, PRINTED.w, PRINTED.h, PRINTED.w * PRINTED.radius);
  x.clip();
  x.drawImage(img as CanvasImageSource, 0, 0, PRINTED.w, PRINTED.h);
  x.restore();
}

/** Paint a card back into a canvas. */
export function paintBack(canvas: Canvas, env: Pick<FaceEnv, "surfaces">): void {
  drawBack(begin(canvas, FACE_W, FACE_H), env.surfaces);
}

/** A face's left tenth is plain stock on every face, so a fan shows clean strips, never the first letters of names. */
const SPINE = Math.round(FACE_W * 0.1);
/** The right margin, and the top's. */
const EDGE = 20;
const INK = "rgba(26,16,6,.8)";
const FOOT_H = 100;
/** A commander's name: gold leaf, in the book's serif. */
const GOLD = { leaf: ["#f6dc8c", "#d9aa45", "#b7832a"], ink: "#2a1a06" } as const;

export function drawFace(x: Ctx, c: FaceSpec, env: FaceEnv): void {
  const FW = FACE_W,
    FH = FACE_H;
  if (c.down) {
    drawBack(x, env.surfaces);
    if (c.tapped) tapBadge(x, FW - 62, 70);
    return;
  }
  x.clearRect(0, 0, FW, FH);
  paintStock(x, c, env.surfaces);
  if (c.small) drawSmall(x, c, env);
  else if (c.whole === "basic") basicFace(x, c);
  else if (c.whole === "dual" || c.whole === "any") landSymbols(x, c, env);
  else if (c.whole === "walker") walkerFace(x, c, env);
  else if (c.whole === "battle") battleFace(x, c, env);
  else composed(x, c, env, c.whole === "utility");
  if (c.tapped) tapBadge(x, FW - 62, FH * 0.42);
}

/** The stock: the card's colour (a dual land split between its colours), a soft vignette, a token's dashed edge, ink. */
function paintStock(x: Ctx, c: FaceSpec, s: Surfaces): void {
  const FW = FACE_W,
    FH = FACE_H;
  const fill = (k: FrameKey) => pattern(x, s.frame[k], FRAME_FALLBACK[k]);
  rr(x, 4, 4, FW - 8, FH - 8, 16);
  x.fillStyle = fill(c.frame);
  x.fill();
  const split = c.whole === "dual" ? c.mana.filter((m): m is FrameKey => "WUBRG".includes(m)) : [];
  x.save();
  rr(x, 4, 4, FW - 8, FH - 8, 16);
  x.clip();
  if (split.length > 1) {
    // One band per colour, split along the diagonal (bottom left to top right), as the land is split between them.
    split.forEach((k, i) => {
      if (i === 0) return;
      const t = (FW * i) / split.length,
        lean = FH * 0.25;
      x.beginPath();
      x.moveTo(t + lean, -10);
      x.lineTo(FW + 20, -10);
      x.lineTo(FW + 20, FH + 10);
      x.lineTo(t - lean, FH + 10);
      x.closePath();
      x.fillStyle = fill(k);
      x.fill();
    });
  }
  const vig = x.createRadialGradient(FW / 2, FH / 2, FW * 0.3, FW / 2, FH / 2, FH * 0.75);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,.28)");
  x.fillStyle = vig;
  x.fillRect(0, 0, FW, FH);
  // The spine: the left tenth a shade deeper, so a fan's strips read as stock.
  x.fillStyle = "rgba(0,0,0,.07)";
  x.fillRect(0, 0, SPINE - 4, FH);
  if (c.token) {
    x.setLineDash([14, 9]);
    rr(x, 12, 12, FW - 24, FH - 24, 11);
    x.lineWidth = 4;
    x.strokeStyle = "rgba(250,240,215,.75)";
    x.stroke();
    x.setLineDash([]);
  }
  x.restore();
  rr(x, 4, 4, FW - 8, FH - 8, 16);
  x.lineWidth = 3;
  x.strokeStyle = c.frame === "B" ? "rgba(0,0,0,.9)" : "rgba(26,16,6,.85)";
  x.stroke();
}

/** The name strip: parchment and ink; a commander's in gold leaf and the book's serif. Returns its height. */
function nameStrip(x: Ctx, c: FaceSpec, env: FaceEnv, at: { y: number; min: number; tall?: boolean; text?: string }): number {
  const FW = FACE_W,
    X = SPINE,
    W = FW - SPINE - EDGE,
    family = c.commander ? font.serif : NUM;
  const text = at.text ?? shortName(c.name);
  const nl = nameLines(x, text, W - 20, at.min, family);
  const lines = at.tall && nl.lines.length === 1 ? 2 : nl.lines.length;
  const barH = lines > 1 ? Math.round(nl.size * 1.94 + 14) : Math.round(nl.size * 1.18 + 12);
  rr(x, X, at.y, W, barH, 6);
  if (c.commander) {
    const g = x.createLinearGradient(0, at.y, 0, at.y + barH);
    g.addColorStop(0, GOLD.leaf[0]);
    g.addColorStop(0.55, GOLD.leaf[1]);
    g.addColorStop(1, GOLD.leaf[2]);
    x.fillStyle = g;
  } else x.fillStyle = pattern(x, env.surfaces.vellum, colour.bone);
  x.fill();
  x.lineWidth = 2;
  x.strokeStyle = INK;
  x.stroke();
  x.textBaseline = "middle";
  x.font = `${c.commander ? 400 : 700} ${nl.size}px ${family}`;
  x.fillStyle = c.commander ? GOLD.ink : colour.ink;
  nl.lines.forEach((l, i) =>
    x.fillText(l, X + 10, at.y + barH / 2 + (i - (nl.lines.length - 1) / 2) * nl.size * 0.94 + 2, W - 20),
  );
  return barH;
}

/** The window's outline by what the card is made of: eight sides (artifact), an arch (enchantment), else square. */
function windowPath(x: Ctx, made: FaceSpec["made"], X: number, Y: number, W: number, H: number): void {
  const art = made.includes("artifact"),
    ench = made.includes("enchantment");
  x.beginPath();
  if (art) {
    const k = Math.min(W, H) * 0.17;
    x.moveTo(X + k, Y);
    x.lineTo(X + W - k, Y);
    x.lineTo(X + W, Y + k);
    x.lineTo(X + W, Y + H - k);
    x.lineTo(X + W - k, Y + H);
    x.lineTo(X + k, Y + H);
    x.lineTo(X, Y + H - k);
    x.lineTo(X, Y + k);
    x.closePath();
  } else if (ench) {
    const r = Math.min(W / 2, H * 0.45);
    x.moveTo(X, Y + H - 6);
    x.lineTo(X, Y + r);
    x.bezierCurveTo(X, Y + r * 0.2, X + W * 0.2, Y, X + W / 2, Y);
    x.bezierCurveTo(X + W * 0.8, Y, X + W, Y + r * 0.2, X + W, Y + r);
    x.lineTo(X + W, Y + H - 6);
    x.quadraticCurveTo(X + W, Y + H, X + W - 6, Y + H);
    x.lineTo(X + 6, Y + H);
    x.quadraticCurveTo(X, Y + H, X, Y + H - 6);
    x.closePath();
  } else rr(x, X, Y, W, H, 6);
}

/** The window: its shape, the art (or its rules text) inside, and its marks: rivets, a pale inner line, land corners. */
function paintWindow(x: Ctx, c: FaceSpec, env: FaceEnv, X: number, Y: number, W: number, H: number): void {
  x.save();
  windowPath(x, c.made, X, Y, W, H);
  x.clip();
  const img = c.art ? env.art(c.art) : null;
  if (img) drawCover(x, img, X - 2, Y, W + 4, H);
  else if (c.text) paintTextArt(x, c.text, X, Y, W, H);
  else {
    x.fillStyle = "rgba(20,12,4,.35)";
    x.fillRect(X, Y, W, H);
  }
  x.restore();
  windowPath(x, c.made, X, Y, W, H);
  x.lineWidth = 3;
  x.strokeStyle = INK;
  x.stroke();
  if (c.made.includes("enchantment")) {
    x.save();
    x.translate(X + W / 2, Y + H / 2);
    x.scale((W - 16) / W, (H - 16) / H);
    x.translate(-(X + W / 2), -(Y + H / 2));
    windowPath(x, c.made, X, Y, W, H);
    x.restore();
    x.lineWidth = 3;
    x.strokeStyle = "rgba(255,248,225,.8)";
    x.stroke();
  }
  if (c.made.includes("artifact")) {
    const k = Math.min(W, H) * 0.17;
    for (const [rx, ry] of [
      [X + k / 2 + 4, Y + k / 2 + 4],
      [X + W - k / 2 - 4, Y + k / 2 + 4],
      [X + k / 2 + 4, Y + H - k / 2 - 4],
      [X + W - k / 2 - 4, Y + H - k / 2 - 4],
    ] as const) {
      x.beginPath();
      x.arc(rx, ry, 6, 0, Math.PI * 2);
      x.fillStyle = "#c9c2b2";
      x.fill();
      x.lineWidth = 2;
      x.strokeStyle = INK;
      x.stroke();
    }
  }
  if (c.made.includes("land") && c.whole !== "utility") {
    // Land corners: earth wedges at the window's top left and bottom right.
    x.fillStyle = "#8a6a45";
    x.strokeStyle = INK;
    x.lineWidth = 2;
    for (const [ax, ay, dx, dy] of [
      [X, Y, 1, 1],
      [X + W, Y + H, -1, -1],
    ] as const) {
      x.beginPath();
      x.moveTo(ax, ay);
      x.lineTo(ax + dx * 34, ay);
      x.lineTo(ax, ay + dy * 34);
      x.closePath();
      x.fill();
      x.stroke();
    }
  }
}

/** A face composed from its parts: name, window, foot. `tall`: a utility land's two-line name over a short window. */
function composed(x: Ctx, c: FaceSpec, env: FaceEnv, tall: boolean): void {
  const FW = FACE_W,
    FH = FACE_H;
  const barH = nameStrip(x, c, env, { y: 20, min: c.far ? 70 : 52, tall });
  const fy = FH - 20 - FOOT_H,
    wy = 20 + barH + 8;
  paintWindow(x, c, env, SPINE, wy, FW - SPINE - EDGE, fy - 8 - wy);
  paintTags(x, c, env, wy);
  paintFoot(x, c, env, fy);
}

function paintTags(x: Ctx, c: FaceSpec, env: FaceEnv, wy: number): void {
  const vellum = pattern(x, env.surfaces.vellum, colour.bone);
  let px = SPINE + 6;
  for (const t of c.tags) px += pill(x, t, px, wy + 8, vellum, colour.ink) + 6;
  if (c.owner) pill(x, c.owner.label, SPINE + 6, FACE_H - 20 - FOOT_H - 52, c.owner.colour, "#f3e6c4");
  if (c.tip) pill(x, c.tip.label, SPINE + 6, FACE_H - 20 - FOOT_H - 96, c.tip.colour, "#f3e6c4");
}

/** A basic land: its mana symbol, two thirds of the face, on stock of its colour. */
function basicFace(x: Ctx, c: FaceSpec): void {
  pip(x, c.mana[0] ?? "C", (FACE_W + SPINE) / 2, FACE_H * 0.47, FACE_W * 0.31);
}

/** A dual or tri land, one symbol per colour; a land of any colour, the five in a ring. Its name small at the foot. */
function landSymbols(x: Ctx, c: FaceSpec, env: FaceEnv): void {
  const FW = FACE_W,
    FH = FACE_H,
    cx = (FW + SPINE) / 2,
    cy = FH * 0.42;
  if (c.whole === "any") {
    const five = ["W", "U", "B", "R", "G"];
    five.forEach((m, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      pip(x, m, cx + Math.cos(a) * FW * 0.25, cy + Math.sin(a) * FW * 0.25, FW * 0.12);
    });
  } else {
    const ms = c.mana.slice(0, 3);
    const spots =
      ms.length === 3
        ? [
            [cx - FW * 0.17, cy - FW * 0.17],
            [cx + FW * 0.17, cy - FW * 0.17],
            [cx, cy + FW * 0.15],
          ]
        : [
            [cx - FW * 0.15, cy - FW * 0.2],
            [cx + FW * 0.15, cy + FW * 0.2],
          ];
    ms.forEach((m, i) => pip(x, m, spots[i]![0]!, spots[i]![1]!, FW * (ms.length === 3 ? 0.15 : 0.19)));
  }
  smallName(x, c, env, FH - 20 - 62, 62);
}

/** A name set small in a strip at the foot (a land whose symbols are its face). */
function smallName(x: Ctx, c: FaceSpec, env: FaceEnv, y: number, h: number): void {
  const X = SPINE,
    W = FACE_W - SPINE - EDGE;
  rr(x, X, y, W, h, 6);
  x.fillStyle = pattern(x, env.surfaces.vellum, colour.bone);
  x.fill();
  x.lineWidth = 2;
  x.strokeStyle = INK;
  x.stroke();
  const nl = nameLines(x, shortName(c.name), W - 16, 34, c.commander ? font.serif : NUM);
  x.font = `700 ${nl.size}px ${c.commander ? font.serif : NUM}`;
  x.fillStyle = colour.ink;
  x.textBaseline = "middle";
  x.textAlign = "center";
  x.fillText(nl.lines.join(" "), X + W / 2, y + h / 2 + 2, W - 16);
  x.textAlign = "left";
}

/** A planeswalker: its art to the edge, the name over it, loyalty in a pointed shield at the foot. */
function walkerFace(x: Ctx, c: FaceSpec, env: FaceEnv): void {
  const FW = FACE_W,
    FH = FACE_H;
  x.save();
  rr(x, 12, 12, FW - 24, FH - 24, 12);
  x.clip();
  const img = c.art ? env.art(c.art) : null;
  if (img) drawCover(x, img, 12, 12, FW - 24, FH - 24);
  else if (c.text) paintTextArt(x, c.text, 12, 12, FW - 24, FH - 24);
  x.restore();
  rr(x, 12, 12, FW - 24, FH - 24, 12);
  x.lineWidth = 3;
  x.strokeStyle = INK;
  x.stroke();
  nameStrip(x, c, env, { y: 20, min: c.far ? 70 : 52 });
  paintTags(x, c, env, 140);
  paintFoot(x, c, env, FH - 20 - FOOT_H, true);
}

/** A battle: its name up the side, its art beside it, defence in a round seal. */
function battleFace(x: Ctx, c: FaceSpec, env: FaceEnv): void {
  const FW = FACE_W,
    FH = FACE_H,
    sw = 70,
    sx = SPINE;
  rr(x, sx, 20, sw, FH - 40, 6);
  x.fillStyle = pattern(x, env.surfaces.vellum, colour.bone);
  x.fill();
  x.lineWidth = 2;
  x.strokeStyle = INK;
  x.stroke();
  x.save();
  x.translate(sx + sw / 2, FH - 30);
  x.rotate(-Math.PI / 2);
  const nl = nameLines(x, shortName(c.name), FH - 80, 46, c.commander ? font.serif : NUM);
  x.font = `700 ${nl.size}px ${c.commander ? font.serif : NUM}`;
  x.fillStyle = colour.ink;
  x.textBaseline = "middle";
  x.fillText(nl.lines.join(" "), 0, 2, FH - 80);
  x.restore();
  const wx = sx + sw + 8;
  paintWindow(x, { ...c, made: [] }, env, wx, 20, FW - EDGE - wx, FH - 40);
  if (c.foot.kind === "battle") seal(x, FW - 74, FH - 74, 50, c.foot.defense);
}

/** A round seal with a figure (a battle's defence). */
function seal(x: Ctx, cx: number, cy: number, r: number, text: string): void {
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fillStyle = "#1e140a";
  x.fill();
  x.setLineDash([7, 5]);
  x.lineWidth = 4;
  x.strokeStyle = colour.bone;
  x.beginPath();
  x.arc(cx, cy, r - 7, 0, Math.PI * 2);
  x.stroke();
  x.setLineDash([]);
  x.font = `700 ${Math.round(r * 1.1)}px ${NUM}`;
  x.fillStyle = colour.bone;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, cx, cy + 3);
  x.textAlign = "left";
}

/** A pointed shield with a figure (a planeswalker's loyalty). */
function shield(x: Ctx, cx: number, top: number, w: number, h: number, text: string, size: number): void {
  x.beginPath();
  x.moveTo(cx - w / 2, top);
  x.lineTo(cx + w / 2, top);
  x.lineTo(cx + w / 2, top + h * 0.62);
  x.lineTo(cx, top + h);
  x.lineTo(cx - w / 2, top + h * 0.62);
  x.closePath();
  x.fillStyle = "#1e140a";
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = colour.bone;
  x.stroke();
  x.font = `700 ${size}px ${NUM}`;
  x.fillStyle = colour.bone;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, cx, top + h * 0.42);
  x.textAlign = "left";
}

/**
 * The foot: what it can do now. On the right a body's figures (hollow when it has them but is not a creature now),
 * loyalty in a shield or defence in a seal; on the left the mana it makes, at most two keyword coins, the ability gem.
 * Nothing on the left ever runs into the figures.
 */
function paintFoot(x: Ctx, c: FaceSpec, env: FaceEnv, fy: number, overArt = false): void {
  const FW = FACE_W,
    footH = FOOT_H,
    mid = fy + footH / 2,
    right = FW - EDGE - 8,
    foot = c.foot;
  rr(x, SPINE, fy, FW - SPINE - EDGE, footH, 6);
  x.fillStyle = pattern(x, env.surfaces.vellum, colour.bone);
  if (overArt) x.globalAlpha = 0.92;
  x.fill();
  x.globalAlpha = 1;
  x.lineWidth = 2;
  x.strokeStyle = INK;
  x.stroke();
  let ptW = 0,
    txt = "";
  if (foot.kind === "creature") {
    x.font = `700 62px ${NUM}`;
    txt = `${foot.power}/${foot.toughness}`;
    ptW = Math.max(110, x.measureText(txt).width + 30);
  } else if (foot.kind === "walker" || foot.kind === "battle") ptW = 96;
  const mana = c.mana.slice(0, 3),
    gemOn = c.gem !== "none";
  const room = right - ptW - 14 - (SPINE + 22) - (gemOn ? 46 : 0) - mana.length * 46;
  const kws = faceKeywords(c.keywords);
  let nCoin = Math.min(2, kws.length);
  while (nCoin > 0 && nCoin * 50 > room) nCoin--;
  let lx = SPINE + 30;
  for (const m of mana) {
    pip(x, m, lx, mid, 20);
    lx += 46;
  }
  for (const k of kws.slice(0, nCoin)) {
    kwIcon(x, env.surfaces, k, lx, mid, 22);
    lx += 50;
  }
  if (gemOn) gem(x, lx + 2, mid, c.gem === "lit");
  if (foot.kind === "creature") {
    const w = ptW;
    rr(x, right - w, fy + 12, w, footH - 24, 6);
    x.fillStyle = "rgba(26,16,6,.1)";
    if (!foot.hollow) x.fill();
    x.lineWidth = 2;
    x.strokeStyle = "rgba(26,16,6,.7)";
    x.stroke();
    const up = foot.power > foot.basePower || foot.toughness > foot.baseToughness,
      down = foot.power < foot.basePower || foot.toughness < foot.baseToughness;
    x.font = `700 62px ${NUM}`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    if (foot.hollow) {
      x.lineWidth = 2.5;
      x.strokeStyle = "rgba(26,16,6,.75)";
      x.strokeText(txt, right - w / 2, mid + 3);
    } else {
      x.fillStyle = up ? "#1a6a30" : down ? signal.dangerInk : colour.ink;
      x.fillText(txt, right - w / 2, mid + 3);
    }
    x.textAlign = "left";
  } else if (foot.kind === "walker") shield(x, right - 48, fy + 8, 84, footH - 12, foot.loyalty, 52);
  else if (foot.kind === "battle") seal(x, right - 46, mid, 40, foot.defense);
}

/**
 * The small form, under 56 px on screen: a second drawing from the same facts. One word of the name as large as fits;
 * a body's figures at a quarter of the card; otherwise one glyph in the window; a land its symbols and nothing else.
 */
function drawSmall(x: Ctx, c: FaceSpec, env: FaceEnv): void {
  const FW = FACE_W,
    FH = FACE_H;
  if (c.whole === "basic") return basicFace(x, c);
  if (c.whole === "dual" || c.whole === "any") {
    const ms = c.whole === "any" ? ["W", "U", "B", "R", "G"] : c.mana.slice(0, 3);
    ms.forEach((m, i) => pip(x, m, (FW + SPINE) / 2 + (i - (ms.length - 1) / 2) * FW * (ms.length > 3 ? 0.13 : 0.27), FH * 0.5, FW * (ms.length > 3 ? 0.1 : 0.16)));
    return;
  }
  const W = FW - SPINE - EDGE;
  const short = shortName(c.name);
  const family = c.commander ? font.serif : NUM;
  x.font = `700 84px ${family}`;
  const word = x.measureText(short).width <= W - 16 ? short : short.split(" ").sort((a, b) => b.length - a.length)[0] ?? short;
  const barH = nameStrip(x, c, env, { y: 20, min: 84, text: word });
  const cy = (20 + barH + FH - 20) / 2 + 10;
  const foot = c.foot;
  if (foot.kind === "creature") {
    const txt = `${foot.power}/${foot.toughness}`;
    rr(x, SPINE + 8, cy - 70, W - 16, 140, 8);
    x.fillStyle = pattern(x, env.surfaces.vellum, colour.bone);
    x.fill();
    x.lineWidth = 3;
    x.strokeStyle = INK;
    x.stroke();
    x.font = `700 116px ${NUM}`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    if (foot.hollow) {
      x.lineWidth = 3;
      x.strokeText(txt, SPINE + W / 2, cy + 4, W - 24);
    } else {
      x.fillStyle = colour.ink;
      x.fillText(txt, SPINE + W / 2, cy + 4, W - 24);
    }
    x.textAlign = "left";
    return;
  }
  const gx = SPINE + W / 2;
  if (foot.kind === "walker") return shield(x, gx, cy - 80, 150, 170, foot.loyalty, 96);
  if (foot.kind === "battle") return seal(x, gx, cy, 80, foot.defense);
  windowPath(x, c.made, SPINE + 8, cy - 90, W - 16, 180);
  x.fillStyle = "rgba(20,12,4,.3)";
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = INK;
  x.stroke();
  if (c.mana.length && !c.made.includes("enchantment")) {
    const ms = c.mana.slice(0, 2);
    ms.forEach((m, i) => pip(x, m, gx + (i - (ms.length - 1) / 2) * 92, cy, 42));
  } else if (c.made.includes("artifact") && !c.made.includes("enchantment")) nut(x, gx, cy, 54);
  else star(x, gx, cy, 62);
}

/** An artifact's glyph: a nut. */
function nut(x: Ctx, cx: number, cy: number, r: number): void {
  x.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    if (i === 0) x.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    else x.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  x.closePath();
  x.moveTo(cx + r * 0.45, cy);
  x.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
  x.fillStyle = colour.bone;
  x.fill("evenodd");
  x.lineWidth = 3;
  x.strokeStyle = INK;
  x.stroke();
}

/** An enchantment's glyph: a four-pointed star. */
function star(x: Ctx, cx: number, cy: number, r: number): void {
  x.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4,
      d = i % 2 ? r * 0.28 : r;
    if (i === 0) x.moveTo(cx + d * Math.cos(a), cy + d * Math.sin(a));
    else x.lineTo(cx + d * Math.cos(a), cy + d * Math.sin(a));
  }
  x.closePath();
  x.fillStyle = colour.bone;
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = INK;
  x.stroke();
}

/** No art (a card Scryfall lacks): its rules text in the window instead. */
function paintTextArt(x: Ctx, text: string, X: number, Y: number, W: number, H: number): void {
  x.fillStyle = "#2a2018";
  x.fillRect(X, Y, W, H);
  const words = text
    .replace(/\([^)]*\)/g, "")
    .split(/\s+/)
    .filter(Boolean);
  x.font = `500 22px ${NUM}`;
  x.fillStyle = "#d9dee6";
  x.textBaseline = "top";
  let line = "",
    y = Y + 12;
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (x.measureText(t).width > W - 24 && line) {
      x.fillText(line, X + 12, y);
      y += 25;
      line = w;
      if (y > Y + H - 30) {
        line += " …";
        break;
      }
    } else line = t;
  }
  if (line && y <= Y + H - 26) x.fillText(line, X + 12, y);
}
