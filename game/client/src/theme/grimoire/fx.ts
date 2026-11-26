// The sprites the table's magic is drawn with (old world.js `emberSprite`, `streakSprite`, `wellGlowSprite`, `ashSprite`
// and fx.js `glyphCanvas` and the pool): white where the material tints them, painted per pixel from a fixed noise, so
// every painting is the same. The scene's effects (scene/three/fx.ts) lease them by kind.
import { fx } from "../tokens";
import { begin } from "./shapes";
import type { Canvas } from "./shapes";

export type FxSprite = "ember" | "streak" | "smoke" | "wellGlow" | "ash" | "brand" | "brandHeat" | "pool";

// ---- value noise (old world.js): a fixed permutation, so the sprites never change --------------------------------------
const PERM = (() => {
  const out = new Uint8Array(512);
  let s = 1337;
  const r = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i++) out[i] = p[i & 255]!;
  return out;
})();
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h: number, x: number, y: number): number => {
  switch (h & 3) {
    case 0:
      return x + y;
    case 1:
      return -x + y;
    case 2:
      return x - y;
    default:
      return -x - y;
  }
};
function noise(x: number, y: number): number {
  const X = Math.floor(x) & 255,
    Y = Math.floor(y) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  const u = fade(x),
    v = fade(y),
    A = PERM[X]! + Y,
    B = PERM[X + 1]! + Y;
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(l(grad(PERM[A]!, x, y), grad(PERM[B]!, x - 1, y), u), l(grad(PERM[A + 1]!, x, y - 1), grad(PERM[B + 1]!, x - 1, y - 1), u), v);
}
/** Fractal noise (old `SeatWorld.fbm`). */
function fbm(x: number, y: number, oct = 5, lac = 2.1, gain = 0.5): number {
  let a = 0.5,
    f = 1,
    s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x * f, y * f);
    f *= lac;
    a *= gain;
  }
  return s;
}
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A canvas painted per pixel from (u, v) to [r, g, b, a]. */
function paint(canvas: Canvas, size: number, fn: (u: number, v: number) => readonly [number, number, number, number]): void {
  const x = begin(canvas, size, size),
    img = x.createImageData(size, size),
    d = img.data;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const o = (j * size + i) * 4,
        c = fn(i / size, j / size);
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = c[3];
    }
  x.putImageData(img, 0, 0);
}

/** Additive particles have a soft halo around the old core, painted into the same sprite. */
function particle(canvas: Canvas, kind: "ember" | "streak" | "smoke"): void {
  paint(canvas, 64, (u, v) => {
    const streak = kind === "streak", glow = kind !== "smoke";
    const x = (u - 0.5) * (glow ? 4 : 2), y = (v - 0.5) * (glow ? 4 : 2);
    const d = Math.hypot(x, y * (streak ? 4 : 1));
    const noise = streak ? 0 : fbm((x + 1) * 3, (y + 1) * 3, 2) * 0.25;
    const a = clamp(1 - d - noise) ** (streak ? 1.4 : 1.6);
    const core = clamp(1 - d * (streak ? 2.5 : 2.4)) ** 2;
    const c = 255 * mix(streak ? 0.55 : 0.5, 1, core);
    const halo = glow ? 0.36 * clamp(1 - Math.hypot(x, y * (streak ? 1.6 : 1)) / 2) ** 2 : 0;
    // The additive shader and blend each multiply by alpha, so their light sums in alpha squared.
    return [c, c, c, Math.hypot(a, halo * (1 - a)) * 255];
  });
}
/**
 * A well's light: a pool the card lies in. Full under the card (the middle 1/1.5 x 1/1.4 of the square, the card's own
 * footprint on a 1.5 x 1.4 plane) and soft past its edge, the edge wandering a little.
 */
function wellGlow(canvas: Canvas): void {
  paint(canvas, 128, (u, v) => {
    const ax = 1 / 1.5,
      ay = 1 / 1.4,
      qx = Math.max(0, Math.abs(u - 0.5) * 2 - ax) / (1 - ax),
      qy = Math.max(0, Math.abs(v - 0.5) * 2 - ay) / (1 - ay);
    const d = Math.hypot(qx, qy) * 1.1 + fbm(u * 4 + 4, v * 4 + 1, 3) * 0.25;
    return [255, 255, 255, clamp(1 - d) ** 0.9 * 255];
  });
}
/** Ash: the vellum singed round a creature's foot, deepening outward to umber at a wandering radius, then a soft haze. */
function ash(canvas: Canvas): void {
  paint(canvas, 256, (u, v) => {
    const a0 = Math.atan2(v - 0.5, u - 0.5),
      ca = Math.cos(a0),
      sa = Math.sin(a0);
    const d = Math.hypot(u - 0.5, v - 0.5) * 2 + fbm(u * 3 + 5, v * 3 + 1, 3) * 0.14;
    const r0 = 0.56 + fbm(ca * 1.2 + 7, sa * 1.2, 2) * 0.16,
      out = 0.2 + 0.1 * clamp(fbm(ca * 1.6 + 3, sa * 1.6 + 5, 2) + 0.5);
    const heat = d < r0 ? clamp(d / r0) ** 2.4 : Math.exp(-(((d - r0) / out) ** 2));
    const k = clamp(heat * (0.82 + fbm(u * 7, v * 7, 2) * 0.36));
    return [mix(150, 52, k), mix(98, 26, k), mix(50, 10, k), k * 0.62 * 255];
  });
}
/**
 * The danger sigil, as a brand leaves it: a ring round a four-pointed star with rays between. `heat` false is the burn
 * (near-black lines with a narrow singed edge); true is the heat left in the same lines, white so its material tints it.
 */
function brand(canvas: Canvas, heat: boolean): void {
  const g = begin(canvas, 256, 256),
    c = 128;
  const draw = (k: number, col: string): void => {
    g.strokeStyle = g.fillStyle = col;
    g.lineCap = g.lineJoin = "round";
    g.lineWidth = 9 * k;
    g.beginPath();
    g.arc(c, c, 106, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3.5 * k;
    g.beginPath();
    g.arc(c, c, 86, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 6 * k;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 90, c + Math.sin(a) * 90);
      g.lineTo(c + Math.cos(a) * 102, c + Math.sin(a) * 102);
      g.stroke();
    }
    g.lineWidth = 7 * k;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2,
        r = i % 2 ? 20 : 70;
      g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.closePath();
    g.stroke();
  };
  if (heat) {
    g.shadowColor = "#fff";
    g.shadowBlur = 4;
    draw(0.45, "#fff");
    return;
  }
  g.shadowColor = fx.sigil.singeShadow;
  g.shadowBlur = 7;
  draw(1.25, fx.sigil.singe);
  g.shadowBlur = 0;
  draw(1, fx.sigil.burn);
}
/** A soft round pool of light, white at its heart. */
function pool(canvas: Canvas): void {
  const g = begin(canvas, 128, 128),
    rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.5, "rgba(255,255,255,.35)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
}

/** Paint one of the effects' sprites. */
export function paintFxSprite(canvas: Canvas, kind: FxSprite): void {
  switch (kind) {
    case "ember":
    case "streak":
    case "smoke":
      return particle(canvas, kind);
    case "wellGlow":
      return wellGlow(canvas);
    case "ash":
      return ash(canvas);
    case "brand":
      return brand(canvas, false);
    case "brandHeat":
      return brand(canvas, true);
    case "pool":
      return pool(canvas);
  }
}
