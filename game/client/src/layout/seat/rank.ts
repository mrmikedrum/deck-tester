import type { BoardCard } from "../board";

// Who stands in a leaf's front (focus-first): each creature or planeswalker unit gets a weight, the heaviest stand, and a
// front card keeps its place until a newcomer outweighs it by HYSTERESIS or more. Tapping never changes a weight, so
// nothing changes place when it taps. Pure, over card facts.

/** intent.md's keywords that change combat: a card with one weighs double. */
export const COMBAT_KEYWORDS: ReadonlySet<string> = new Set([
  "flying",
  "trample",
  "deathtouch",
  "menace",
  "lifelink",
  "first strike",
  "double strike",
  "indestructible",
  "hexproof",
]);
/** How much heavier a newcomer must be to take a front card's place. */
export const HYSTERESIS = 2;

export const changesCombat = (c: BoardCard): boolean => c.keywords.some((k) => COMBAT_KEYWORDS.has(k.toLowerCase()));

/** A unit's weight: its power (a regiment's sum; a planeswalker's loyalty), doubled if it changes combat. */
export function weightOf(cards: readonly BoardCard[]): number {
  const base = cards.reduce((t, c) => t + Math.max(0, (c.creature ? c.power : c.planeswalker ? (c.loyalty ?? 0) : c.power) ?? 0), 0);
  return cards.some(changesCombat) ? base * 2 : base;
}

export interface Candidate {
  readonly key: string;
  readonly weight: number;
  readonly legendary: boolean;
  /** Its oldest card's id: the older card wins a tie. */
  readonly oldest: number;
}

const heavier = (a: Candidate, b: Candidate): number =>
  b.weight - a.weight || Number(b.legendary) - Number(a.legendary) || a.oldest - b.oldest;

/**
 * The front's places, left to right (a key, or null for an empty place): `pinned` (the commander) always stands; the
 * heaviest fill the rest; one that stood before keeps its place until a newcomer outweighs it by HYSTERESIS or more.
 * `prev` is the last front's places, or null for a first plan.
 */
export function chooseFront(cands: readonly Candidate[], prev: readonly (string | null)[] | null, places: number, pinned: string | null): (string | null)[] {
  const by = new Map(cands.map((c) => [c.key, c]));
  const order = cands.slice().sort(heavier);
  const slots: (string | null)[] = Array.from({ length: places }, (_, i) => {
    const k = prev?.[i] ?? null;
    return k !== null && by.has(k) ? k : null;
  });
  const has = (k: string) => slots.includes(k);
  const free = () => slots.indexOf(null);
  // The commander stands wherever it stood, else in the first place.
  if (pinned !== null && by.has(pinned) && !has(pinned) && places > 0) {
    const f = free();
    if (slots[0] !== null && f >= 0) slots[f] = slots[0]!;
    else if (slots[0] !== null) {
      // Full: the lightest steps back for it.
      const light = slots.map((k, i) => ({ k: k!, i })).sort((a, b) => heavier(by.get(b.k)!, by.get(a.k)!))[0]!.i;
      slots[light] = slots[0]!;
    }
    slots[0] = pinned;
  }
  for (const c of order) {
    if (has(c.key)) continue;
    const at = free();
    if (at >= 0) {
      slots[at] = c.key;
      continue;
    }
    // Full: the lightest that may go (never the commander) gives way only to one heavier by the hysteresis.
    let light = -1;
    slots.forEach((k, i) => {
      if (k === null || k === pinned) return;
      if (light < 0 || heavier(by.get(slots[light]!)!, by.get(k)!) < 0) light = i;
    });
    if (light < 0) break;
    const m = by.get(slots[light]!)!;
    // A first plan has no history to keep: the heaviest simply stand.
    if (c.weight >= m.weight + (prev ? HYSTERESIS : 0) && heavier(c, m) < 0) slots[light] = c.key;
  }
  return slots;
}
