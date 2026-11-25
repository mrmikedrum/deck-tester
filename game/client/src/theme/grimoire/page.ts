// A seat's page: a thin leaf of vellum written on the tome, with a ruled border in the seat's ink at full strength (so
// the four seats tell apart at a glance) and small bronze corner mounts. Three layers are painted for a w x d page:
// "mask" (its ragged edge as alpha), "ink" (the edge browning where hands have held it, the ruled border, the corner
// mounts) and "glow" (whose turn it is: the band between the strong rule and the fine one, printed on the page).
// Ported from old h.js `pageTex`; the vellum the page is written on is a surface laid by the scene.
import { begin } from "./shapes";
import type { Canvas } from "./shapes";
import { bronzeColour, pattern } from "./surfaces";
import type { Surfaces } from "./surfaces";

/** The band round a page that keeps its width when the page grows (world units). */
export const PAGE_B = 0.8;
/** The vellum tile's side in world units. */
export const VELLUM_TILE = 9;

export type PageLayer = "mask" | "ink" | "glow";

export interface PageSpec {
  readonly layer: PageLayer;
  /** World size of the page. */
  readonly w: number;
  readonly d: number;
  /** The seat's ink at full strength. */
  readonly ink: string;
  /** Seeds the ragged edge: the same page is torn the same way each time. */
  readonly seed: number;
}

/** Pixels per world unit for a page of width `w`. */
export const pagePpu = (w: number): number => Math.min(84, 1300 / w);

export function paintPage(canvas: Canvas, spec: PageSpec, s: Surfaces): void {
  const { w, d, ink, layer } = spec,
    ppu = pagePpu(w);
  const x = begin(canvas, Math.round(w * ppu), Math.round(d * ppu));
  const u = (n: number): number => n * ppu,
    m = u(0.16),
    R = u(0.12),
    W = canvas.width - 2 * m,
    Hh = canvas.height - 2 * m;
  // The page's edge is a little ragged, the same way each time it is drawn.
  const page = (): void => {
    let sd = spec.seed;
    const j = (): number => ((sd = (sd * 16807) % 2147483647) / 2147483647 - 0.5) * u(0.05);
    x.beginPath();
    x.moveTo(m, m + R);
    for (let px = m; px <= m + W; px += u(0.5)) x.lineTo(px, m + j());
    for (let py = m; py <= m + Hh; py += u(0.5)) x.lineTo(m + W + j(), py);
    for (let px = m + W; px >= m; px -= u(0.5)) x.lineTo(px, m + Hh + j());
    for (let py = m + Hh; py >= m; py -= u(0.5)) x.lineTo(m + j(), py);
    x.closePath();
  };
  const sI = u(0.3);
  if (layer === "mask") {
    x.fillStyle = "#000";
    x.fillRect(0, 0, canvas.width, canvas.height);
    page();
    x.fillStyle = "#fff";
    x.fill();
    return;
  }
  if (layer === "glow") {
    x.strokeStyle = ink;
    x.lineWidth = u(0.2);
    x.strokeRect(m + sI + u(0.04), m + sI + u(0.04), W - 2 * sI - u(0.08), Hh - 2 * sI - u(0.08));
    return;
  }
  // Age: the leaf darkens toward its edge, within the band that keeps its width, and browns softly right at it; no line is
  // drawn round it.
  x.save();
  page();
  x.clip();
  for (const [ax, ay] of [
    [0, 1],
    [1, 0],
  ] as const)
    for (const e of [0, 1]) {
      const g = ax
        ? x.createLinearGradient(e ? canvas.width : 0, 0, e ? canvas.width - u(PAGE_B) : u(PAGE_B), 0)
        : x.createLinearGradient(0, e ? canvas.height : 0, 0, e ? canvas.height - u(PAGE_B) : u(PAGE_B));
      void ay;
      g.addColorStop(0, "rgba(70,45,15,.2)");
      g.addColorStop(1, "rgba(70,45,15,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, canvas.width, canvas.height);
    }
  x.lineWidth = u(0.16);
  x.strokeStyle = "rgba(120,80,35,.16)";
  page();
  x.stroke();
  x.restore();
  // The ruled border in the seat's ink: a strong rule and a fine one inside it.
  x.strokeStyle = ink;
  x.lineWidth = u(0.08);
  x.strokeRect(m + sI, m + sI, W - 2 * sI, Hh - 2 * sI);
  x.lineWidth = u(0.025);
  x.strokeRect(m + sI + u(0.13), m + sI + u(0.13), W - 2 * sI - u(0.26), Hh - 2 * sI - u(0.26));
  // Bronze corner mounts, small.
  const metal = (): CanvasPattern | string => pattern(x, s.bronzeClean, bronzeColour);
  x.fillStyle = metal();
  x.strokeStyle = "#2a1a08";
  x.lineWidth = u(0.02);
  for (const [cx, cy, dx, dy] of [
    [m, m, 1, 1],
    [m + W, m, -1, 1],
    [m, m + Hh, 1, -1],
    [m + W, m + Hh, -1, -1],
  ] as const) {
    x.shadowColor = "rgba(0,0,0,.45)";
    x.shadowBlur = u(0.04);
    x.shadowOffsetY = u(0.012);
    x.beginPath();
    x.moveTo(cx, cy);
    x.lineTo(cx + dx * u(0.4), cy);
    x.lineTo(cx + dx * u(0.31), cy + dy * u(0.1));
    x.lineTo(cx + dx * u(0.1), cy + dy * u(0.1));
    x.lineTo(cx + dx * u(0.1), cy + dy * u(0.31));
    x.lineTo(cx, cy + dy * u(0.4));
    x.closePath();
    x.fill();
    x.shadowColor = "transparent";
    x.stroke();
    x.beginPath();
    x.arc(cx + dx * u(0.065), cy + dy * u(0.065), u(0.022), 0, Math.PI * 2);
    x.fillStyle = "#1a1008";
    x.fill();
    x.fillStyle = metal();
  }
}

/**
 * The vellum a page is written on, one tile laid in world units from the page's fixed edge: the baked vellum under a
 * warm (mine) or dim wash, with faint ruled marginalia (20 lines to a tile, so they meet across tiles).
 */
export function paintVellumTile(canvas: Canvas, mine: boolean, base: string, s: Surfaces): void {
  const S = 1024,
    x = begin(canvas, S, S),
    u = (n: number): number => (n * S) / VELLUM_TILE;
  x.fillStyle = base;
  x.fillRect(0, 0, S, S);
  if (s.vellum) x.drawImage(s.vellum, 0, 0, S, S);
  x.fillStyle = mine ? "rgba(255,245,215,.1)" : "rgba(40,25,10,.1)";
  x.fillRect(0, 0, S, S);
  x.strokeStyle = "rgba(60,40,15,.12)";
  x.lineWidth = u(0.012);
  for (let i = 0; i < 20; i++) {
    const py = ((i + 0.5) * S) / 20;
    x.beginPath();
    x.moveTo(0, py);
    x.lineTo(S, py);
    x.stroke();
  }
}
