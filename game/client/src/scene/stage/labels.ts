// Pile labels sized on screen, never meeting (intent.md: cards belong to the table they lie on). A pile's title is one
// line, "<name> <count>" and its tapped count where the copies cannot show it, at 13 px on my page and 12 on the
// others', never under 11. Each is placed on its top card's top edge and checked, in a ledger, against the labels
// already placed and every other card's name strip and foot: where it meets one by more than 2 px it is shortened
// (smaller to 11 px, then its qualifiers dropped, then its name ellipsized to five letters; the count never), then slid
// along its card's top edge by up to a quarter of a card; failing all, it gives way to the count chip on the card's
// face, which cannot collide. Pure: positions are the plan's quads at rest.
import type { HitGroup, TablePlan } from "../../layout";
import type { SeatId } from "../../model";

/** Text sizes (CSS px): mine, theirs, the floor; and a sign's height over its text's (the painted sign's canvas). */
export const LABEL_PX = { mine: 13, theirs: 12, floor: 11, tall: 96 / 60, pad: 52 / 60 } as const;
/** A label may overlap its own card's top edge by this much, and meet anything else by no more than this (px). */
const OVERLAP = 3, MEET = 2;
/** Between a label and the next unit in its row (px). */
const GAP = 6;

/** A word's width at a text size (CSS px): the sign's font measured where there is a canvas, else an estimate. */
export type Measure = (text: string, px: number) => number;
export const estimate: Measure = (text, px) => text.length * 0.42 * px;

export interface LabelAsk {
  readonly id: string;
  readonly seat: SeatId | null;
  readonly mine: boolean;
  /** "Elemental", "Creatures": the name, its count apart. */
  readonly name: string;
  /** Null: a tag with no count (a regiment's count is on its die). */
  readonly count: number | null;
  /** "↷4", or null. */
  readonly tap: string | null;
}

/** A label as placed: its text's parts, its size, and its slide along the card's top edge as a share of the card's width. */
export interface PlacedLabel {
  readonly name: string;
  readonly px: number;
  readonly slide: number;
}

type Box = readonly [number, number, number, number];
const meets = (a: Box, b: Box): boolean => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > MEET && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > MEET;
const boxOf = (q: HitGroup["quad"]): Box => [Math.min(...q.map((p) => p.x)), Math.min(...q.map((p) => p.y)), Math.max(...q.map((p) => p.x)), Math.max(...q.map((p) => p.y))];
/** A card's name strip (its top sixth) and foot (its bottom sixth), as boxes on screen. */
const strips = (q: HitGroup["quad"]): Box[] => {
  const at = (u: number, v: number) => ({ x: q[0].x + (q[1].x - q[0].x) * u + (q[3].x - q[0].x) * v, y: q[0].y + (q[1].y - q[0].y) * u + (q[3].y - q[0].y) * v });
  const band = (v0: number, v1: number): Box => boxOf([at(0, v0), at(1, v0), at(1, v1), at(0, v1)]);
  return [band(5 / 6, 1), band(0, 1 / 6)];
};

/** A tag said shorter: its clauses dropped from the end ("8 more · 11 power · biggest 3/2", "8 more · 11 power"). */
function clauses(tag: string): string[] {
  const parts = tag.split(" · ");
  return parts.map((_, i) => parts.slice(0, parts.length - i).join(" · "));
}

/** The ways to say a name shorter: whole; without its leading words; its last word ellipsized, to five letters. */
export function shorter(name: string): string[] {
  const clean = name.replace(/\s*\([^)]*\)/g, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const out = [clean];
  for (let i = 1; i < words.length; i++) out.push(words.slice(i).join(" "));
  const last = words[words.length - 1] ?? "";
  for (let n = last.length - 1; n >= 5; n--) out.push(`${last.slice(0, n)}…`);
  return [...new Set(out)];
}

export const labelText = (name: string, count: number | null, tap: string | null): string => [name, count === null ? "" : String(count), tap].filter(Boolean).join(" ");

/** Places every ask's label (in order: mine first, then by seat), or leaves it to the count chip (absent from the map). */
export function placeLabels(plan: TablePlan, asks: readonly LabelAsk[], measure: Measure = estimate): Map<string, PlacedLabel> {
  const groups = new Map(plan.hits.groups.map((g) => [g.id, g]));
  const units = plan.hits.groups.filter((g) => g.kind !== "plate" && g.kind !== "zone" && g.kind !== "stack");
  const obstacles: { id: string; box: Box }[] = units.flatMap((g) => strips(g.quad).map((box) => ({ id: g.id, box })));
  const placed = new Map<string, PlacedLabel>();
  const order = [...asks].sort((a, b) => Number(b.mine) - Number(a.mine));
  for (const a of order) {
    const g = groups.get(a.id);
    if (!g) continue;
    const card = boxOf(g.quad), w = card[2] - card[0], cx = (card[0] + card[2]) / 2;
    // The room in its row: half the way to the nearest unit beside it, each way.
    const beside = units.filter((u) => u.id !== a.id && u.seat === g.seat).map((u) => boxOf(u.quad)).filter((b) => b[1] < card[3] && b[3] > card[1]);
    const pitch = beside.length ? Math.min(...beside.map((b) => Math.abs((b[0] + b[2]) / 2 - cx))) : 2 * w;
    const room = Math.max(w, pitch) - GAP;
    const want = a.mine ? LABEL_PX.mine : LABEL_PX.theirs;
    let done: PlacedLabel | null = null;
    find: for (const slide of [0, 0.125, -0.125, 0.25, -0.25])
      for (const name of a.count === null ? clauses(a.name) : shorter(a.name))
        for (let px = want; px >= LABEL_PX.floor; px--) {
          const tw = measure(labelText(name, a.count, a.tap), px), bw = tw + LABEL_PX.pad * px, bh = LABEL_PX.tall * px;
          if (bw > room) continue;
          const mid = cx + slide * w, box: Box = [mid - bw / 2, card[1] - bh + OVERLAP, mid + bw / 2, card[1] + OVERLAP];
          if (box[1] < 0 || obstacles.some((o) => o.id !== a.id && meets(o.box, box))) continue;
          obstacles.push({ id: a.id, box });
          done = { name, px, slide };
          break find;
        }
    if (done) placed.set(a.id, done);
  }
  return placed;
}
