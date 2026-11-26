// Reachability through the production picker: the screen rastered through `hitTest` (the function the scene's `pick`
// calls), on a 4 px grid, inside the safe area and outside the chrome that is up. For each group, the side of the largest
// square of cells it owns, and a point inside it. Independent of the audit: it never looks at shapes or draw order.
import { hitTest } from "../../src/layout/plan";
import type { HitGroup, TablePlan } from "../../src/layout/plan";
import { bounds } from "../../src/layout/shape";
import type { Point, Rect } from "../../src/layout/types";

const CELL = 4;
const TILE = 64;

export interface Reach {
  /** Side, CSS px, of the largest square the picker gives the group (0: no point at all). */
  readonly side: number;
  readonly at: Point | null;
}

const inside = (r: Rect, x: number, y: number) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;

export function reach(plan: TablePlan): Map<string, Reach> {
  const { w, h } = plan.viewport;
  const safe = plan.reserve.safe;
  const chrome = plan.reserve.items.filter((i) => i.visible).map((i) => i.rect);
  // Tiles: only the groups whose bounds meet a tile can win in it, so each tile asks hitTest of a plan holding just those
  // (the same precedence, a shorter list).
  const boxes = plan.hits.groups.map((g) => [g, bounds(g.quad)] as const);
  const tiles = new Map<string, TablePlan>();
  const tileOf = (x: number, y: number): TablePlan => {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), key = `${tx},${ty}`;
    let t = tiles.get(key);
    if (!t) {
      const l = tx * TILE, top = ty * TILE;
      const groups: HitGroup[] = boxes.filter(([, b]) => b.l <= l + TILE && b.r >= l && b.t <= top + TILE && b.b >= top).map(([g]) => g);
      t = { ...plan, hits: { rev: plan.hits.rev, groups } };
      tiles.set(key, t);
    }
    return t;
  };
  const cols = Math.floor(w / CELL), rows = Math.floor(h / CELL);
  const owner: (string | null)[] = new Array(cols * rows).fill(null);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * CELL, y = (j + 0.5) * CELL;
      if (!inside(safe, x, y) || chrome.some((r) => inside(r, x, y))) continue;
      owner[j * cols + i] = hitTest(tileOf(x, y), { x, y })?.id ?? null;
    }
  // The largest square of one owner ending at each cell (the classic DP, per label at once).
  const sq = new Int32Array(cols * rows);
  const out = new Map<string, Reach>(plan.hits.groups.map((g) => [g.id, { side: 0, at: null }]));
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i, o = owner[k];
      if (o === null || o === undefined) continue;
      const same = i > 0 && j > 0 && owner[k - 1] === o && owner[k - cols] === o && owner[k - cols - 1] === o;
      const n = same ? 1 + Math.min(sq[k - 1]!, sq[k - cols]!, sq[k - cols - 1]!) : 1;
      sq[k] = n;
      const r = out.get(o)!;
      if (n * CELL > r.side) out.set(o, { side: n * CELL, at: { x: (i + 1 - n / 2) * CELL, y: (j + 1 - n / 2) * CELL } });
    }
  return out;
}

/**
 * A group the clash covers while it is up (its middle under the clash's picture, and not one of its fighters): it is
 * reached again once the clash is set aside (one tap), not through it.
 */
export function underClash(plan: TablePlan, g: HitGroup): boolean {
  const e = plan.gathering?.focus ? plan.gathering.extent : null;
  if (!e || g.order > 1e5 || g.kind === "plate") return false;
  const b = bounds(g.quad), x = (b.l + b.r) / 2, y = (b.t + b.b) / 2;
  return x > e.l - 14 && x < e.r + 14 && y > e.t - 14 && y < e.b + 14;
}
