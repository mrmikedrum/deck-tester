// Pile labels sized on screen, never meeting (intent.md: cards belong to the table they lie on). A pile's title is one
// line, "<name> <count>" and its tapped count where the copies cannot show it, at 13 px on my page and 12 on the
// others', never under 11. Each is placed on its top card's top edge as drawn and checked, in a ledger, against the labels
// already placed and every other card's name strip and foot: where it meets one by more than 2 px it is shortened
// (smaller to 11 px, then its qualifiers dropped, then its name ellipsized to five letters; the count never), then slid
// along its card's top edge by up to a quarter of a card; failing all, it gives way to the count chip on the card's
// face, which cannot collide. Pure: positions are the plan's quads at rest.
import { TITLE_PX } from "../../layout";
import type { HitGroup, TablePlan } from "../../layout";
import type { SeatId } from "../../model";

/** Text sizes (CSS px): mine, theirs, the floor; and a sign's height over its text's (the painted sign's canvas). Layout's,
 * which keeps the room above a pile for its title. */
export const LABEL_PX = TITLE_PX;
/** A label may overlap its own card's top edge by this much, and meet anything else by no more than this (px). */
const OVERLAP = TITLE_PX.overlap, MEET = 2;
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
  readonly count: number;
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
/** What of a group is drawn: an engine unit's face, not the wider place it owns. */
const drawn = (g: HitGroup): HitGroup["quad"] => g.face ?? g.quad;
const boxOf = (q: HitGroup["quad"]): Box => [Math.min(...q.map((p) => p.x)), Math.min(...q.map((p) => p.y)), Math.max(...q.map((p) => p.x)), Math.max(...q.map((p) => p.y))];
/** The top edge of a card as drawn (its edge highest on screen, a turned card's long one): its middle, its height on
 *  screen, how wide it reads, and its lean: how far across a tab standing on it drifts per px it rises, as the card's sides
 *  do. A tab stands on that edge (pieces.ts `titleTab`), not on the middle of the card's bounds, which a card seen from
 *  the side of the view leans away from. */
const topEdge = (q: HitGroup["quad"]): { cx: number; y: number; w: number; lean: number } => {
  const n = q.length;
  let k = 0;
  for (let i = 1; i < n; i++) if (q[i]!.y + q[(i + 1) % n]!.y < q[k]!.y + q[(k + 1) % n]!.y) k = i;
  const a = q[k]!, b = q[(k + 1) % n]!, below = q[(k + n - 1) % n]!, belowB = q[(k + 2) % n]!;
  const side = (top: { x: number; y: number }, foot: { x: number; y: number }): number => (foot.y - top.y > 1 ? (top.x - foot.x) / (foot.y - top.y) : 0);
  return { cx: (a.x + b.x) / 2, y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), lean: (side(a, below) + side(b, belowB)) / 2 };
};
/** A card's name strip (its top sixth) and foot (its bottom sixth), as boxes on screen. */
const strips = (q: HitGroup["quad"]): Box[] => {
  const at = (u: number, v: number) => ({ x: q[0].x + (q[1].x - q[0].x) * u + (q[3].x - q[0].x) * v, y: q[0].y + (q[1].y - q[0].y) * u + (q[3].y - q[0].y) * v });
  const band = (v0: number, v1: number): Box => boxOf([at(0, v0), at(1, v0), at(1, v1), at(0, v1)]);
  return [band(5 / 6, 1), band(0, 1 / 6)];
};

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

export const labelText = (name: string, count: number, tap: string | null): string => [name, String(count), tap].filter(Boolean).join(" ");

/** Places every ask's label (in order: mine first, then by seat), or leaves it to the count chip (absent from the map). */
export function placeLabels(plan: TablePlan, asks: readonly LabelAsk[], measure: Measure = estimate): Map<string, PlacedLabel> {
  const groups = new Map(plan.hits.groups.map((g) => [g.id, g]));
  const units = plan.hits.groups.filter((g) => g.kind !== "plate" && g.kind !== "zone" && g.kind !== "stack");
  const obstacles: { id: string; box: Box }[] = units.flatMap((g) => strips(drawn(g)).map((box) => ({ id: g.id, box })));
  const placed = new Map<string, PlacedLabel>();
  const order = [...asks].sort((a, b) => Number(b.mine) - Number(a.mine));
  for (const a of order) {
    const g = groups.get(a.id);
    if (!g) continue;
    const card = boxOf(drawn(g)), { cx, y: top, w, lean } = topEdge(drawn(g));
    // The room in its row: half the way to the nearest unit beside it, each way.
    const beside = units.filter((u) => u.id !== a.id && u.seat === g.seat).map((u) => boxOf(drawn(u))).filter((b) => b[1] < card[3] && b[3] > card[1]);
    const pitch = beside.length ? Math.min(...beside.map((b) => Math.abs((b[0] + b[2]) / 2 - cx))) : 2 * w;
    const room = Math.max(w, pitch) - GAP;
    const want = a.mine ? LABEL_PX.mine : LABEL_PX.theirs;
    // (on my side a label beside a standing card would be hidden by it, drawn nearer: its neighbours' faces are in the way too)
    const faces = a.mine ? units.filter((u) => u.id !== a.id && u.seat === g.seat).map((u) => boxOf(drawn(u))) : [];
    let done: PlacedLabel | null = null;
    find: for (const slide of [0, 0.125, -0.125, 0.25, -0.25])
      for (const name of shorter(a.name))
        for (let px = want; px >= LABEL_PX.floor; px--) {
          const tw = measure(labelText(name, a.count, a.tap), px), bw = tw + LABEL_PX.pad * px, bh = LABEL_PX.tall * px;
          if (bw > room) continue;
          const mid = cx + slide * w, drift = lean * bh, box: Box = [mid - bw / 2 + Math.min(0, drift), top - bh + OVERLAP, mid + bw / 2 + Math.max(0, drift), top + OVERLAP];
          if (box[1] < 0 || obstacles.some((o) => o.id !== a.id && meets(o.box, box)) || faces.some((b) => meets(b, box))) continue;
          obstacles.push({ id: a.id, box });
          done = { name, px, slide };
          break find;
        }
    if (done) placed.set(a.id, done);
  }
  return placed;
}
