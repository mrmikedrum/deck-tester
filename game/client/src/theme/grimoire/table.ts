// The table: the open tome seen from above its lower edge. Two pages meet at a spine that folds down into shadow; each
// page curves up out of the fold and lies flat toward its outer edge, where the page block shows as a stack of fine
// edges over the leather cover. Canvas units map to the table plane (60 x 50, centred at z = -4). Ported from old h.js
// `tomeCanvas`; its foxing is seeded, so the table is the same every time. The lamp is the scene's (materials `lights`):
// the painting carries the book's own shading (the fold, the leaves' curve) but no lamplight, unless `lamp` asks for the
// old painted pool (a page drawn without lights).
import { begin, rr, seeded } from "./shapes";
import type { Canvas } from "./shapes";
import type { Surfaces } from "./surfaces";

export const TABLE_PX = 2048;
/** The table plane's world size and centre. */
export const TABLE_PLANE = { w: 60, d: 50, z: -4 } as const;

export function paintTable(canvas: Canvas, s: Surfaces, seed = 1, lamp = false): void {
  const S = TABLE_PX,
    x = begin(canvas, S, S);
  const rand = seeded(seed);
  const px = (wx: number): number => ((wx + 30) / 60) * S,
    pz = (wz: number): number => ((wz + 29) / 50) * S,
    u = S / 60;
  // The cover: dark leather, a blind-tooled rule round it.
  x.fillStyle = "#24160c";
  x.fillRect(0, 0, S, S);
  if (s.tome) {
    x.globalAlpha = 0.35;
    x.drawImage(s.tome, 0, 0, S, S);
    x.globalAlpha = 1;
  }
  x.fillStyle = "rgba(20,10,4,.55)";
  x.fillRect(0, 0, S, S);
  const L = px(-15.2),
    Rr = px(15.2),
    T0 = pz(-15.6),
    B = pz(7.2),
    G0 = px(0);
  x.strokeStyle = "rgba(150,110,60,.35)";
  x.lineWidth = 3;
  x.strokeRect(L - u * 1.4, T0 - u * 1.2, Rr - L + u * 2.8, B - T0 + u * 2.4);
  // The spread casts a soft shadow on the cover past its far edge, where the open book lifts off the table.
  const far = x.createLinearGradient(0, T0 - u * 1.6, 0, T0);
  far.addColorStop(0, "rgba(0,0,0,0)");
  far.addColorStop(0.7, "rgba(0,0,0,.35)");
  far.addColorStop(1, "rgba(0,0,0,.6)");
  x.fillStyle = far;
  x.fillRect(L - u * 0.9, T0 - u * 1.6, Rr - L + u * 1.8, u * 1.6);
  // The page block: under each page, the edges of the leaves stacked toward the cover in fine light and dark lines.
  for (const [i, [x0, x1]] of (
    [
      [L, G0],
      [G0, Rr],
    ] as const
  ).entries()) {
    const out = i === 0 ? -1 : 1,
      ox = i === 0 ? x0 : x1;
    for (let k = 12; k >= 1; k--) {
      const o = k * u * 0.045;
      x.fillStyle = k % 2 ? "#c4ae84" : "#6e5a3a";
      x.beginPath();
      x.moveTo(G0, T0 - o * 0.6);
      x.lineTo(ox + out * o, T0 - o * 0.6);
      x.lineTo(ox + out * o, B + o);
      x.lineTo(G0, B + o);
      x.closePath();
      x.fill();
    }
  }
  // The pages: pale paper, a little warmer than the fields written on them.
  for (const [x0, x1] of [
    [L, G0],
    [G0, Rr],
  ] as const) {
    x.save();
    x.beginPath();
    x.rect(x0, T0, x1 - x0, B - T0);
    x.clip();
    x.fillStyle = "#dcc8a0";
    x.fillRect(x0, T0, x1 - x0, B - T0);
    if (s.vellum) {
      x.globalAlpha = 0.45;
      for (let yy = T0; yy < B; yy += 1024)
        for (let xx = x0; xx < x1; xx += 1024) x.drawImage(s.vellum, xx, yy, 1024, 1024);
      x.globalAlpha = 1;
    }
    x.globalCompositeOperation = "multiply";
    x.fillStyle = "#e6d6ba";
    x.fillRect(x0, T0, x1 - x0, B - T0);
    x.globalCompositeOperation = "source-over";
    x.restore();
  }
  // Each leaf curves, in two broad bands either side of the gutter: it rises out of a deep shaded fold (0.4 dark at the
  // gutter, fading over a fifth of the leaf, a shadow, not a trench) into a wide crest of light, shades as it falls flat
  // toward its outer edge, and darkens again at the very edge where it turns down over the block. Its head and foot shade
  // a little too, where the leaf lifts away from the cover.
  for (const sd of [-1, 1] as const) {
    const wd = Math.abs((sd < 0 ? L : Rr) - G0),
      g = x.createLinearGradient(G0, 0, G0 + sd * wd, 0);
    g.addColorStop(0, "rgba(40,22,8,.4)");
    g.addColorStop(0.04, "rgba(50,28,10,.32)");
    g.addColorStop(0.1, "rgba(70,40,14,.18)");
    g.addColorStop(0.2, "rgba(80,48,18,0)");
    g.addColorStop(0.3, "rgba(255,244,220,.34)");
    g.addColorStop(0.46, "rgba(255,244,220,.14)");
    g.addColorStop(0.6, "rgba(60,35,12,0)");
    g.addColorStop(0.78, "rgba(60,35,12,.15)");
    g.addColorStop(0.93, "rgba(60,35,12,.28)");
    g.addColorStop(1, "rgba(40,22,8,.52)");
    x.fillStyle = g;
    x.fillRect(sd < 0 ? L : G0, T0, wd, B - T0);
    // The leaves under the top one show at its outer edge as fine lines, the thickness of the block seen from above.
    for (let k = 1; k <= 5; k++) {
      x.fillStyle = k % 2 ? "rgba(45,26,8,.55)" : "rgba(255,244,220,.22)";
      x.fillRect((sd < 0 ? L : Rr) - sd * u * 0.07 * k - 1, T0, 2, B - T0);
    }
  }
  const hf = x.createLinearGradient(0, T0, 0, B);
  hf.addColorStop(0, "rgba(50,28,10,.22)");
  hf.addColorStop(0.06, "rgba(50,28,10,0)");
  hf.addColorStop(0.94, "rgba(50,28,10,0)");
  hf.addColorStop(1, "rgba(50,28,10,.22)");
  x.fillStyle = hf;
  x.fillRect(L, T0, Rr - L, B - T0);
  x.fillStyle = "rgba(30,16,6,.55)";
  x.fillRect(G0 - 1.5, T0 - u * 0.7, 3, B - T0 + u * 1.4); // the fold itself: a hairline
  // The spine's ends show past the page block: leather, with a headband.
  for (const yy of [T0 - u * 0.7, B + u * 0.7]) {
    rr(x, G0 - u * 0.5, yy - u * 0.25, u, u * 0.5, u * 0.2);
    x.fillStyle = "#3a2414";
    x.fill();
    x.fillStyle = "#7a2e3a";
    x.fillRect(G0 - u * 0.35, yy - u * 0.08, u * 0.7, u * 0.16);
  }
  // Foxing.
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `rgba(120,80,30,${0.02 + rand() * 0.05})`;
    x.beginPath();
    x.arc(L + rand() * (Rr - L), T0 + rand() * (B - T0), 3 + rand() * 14, 0, Math.PI * 2);
    x.fill();
  }
  if (!lamp) return;
  // Lamplight: warm over the middle, falling off toward the far corners.
  const pool = x.createRadialGradient(S / 2, pz(-2.5), S * 0.06, S / 2, pz(-2.5), S * 0.5);
  pool.addColorStop(0, "rgba(255,200,130,.1)");
  pool.addColorStop(0.55, "rgba(0,0,0,.06)");
  pool.addColorStop(1, "rgba(10,5,2,.8)");
  x.fillStyle = pool;
  x.fillRect(0, 0, S, S);
}
