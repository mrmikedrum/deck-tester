// What a gesture on a group means: the one rule for every kind. Layout groups cards it has no room to show apart (a pile
// of copies, a well, a summary of distinct cards), so a tap or drag on a group lands on several cards at once. The group
// stands for its cards only when that cannot change what is done:
//  - every member's gesture alone does exactly the same (the action ignores this end: a rock dragged onto a mixed pile
//    activates the same ability whichever card it lands on); or
//  - every member it could mean is a twin (the same card, in the same state, owned and controlled by the same players,
//    offered the same options, its own id aside), the members it cannot mean share their name (a well of Islands, some
//    tapped), and the kind's own reading of the group (the next free source of a well, the first of the copies) does the
//    same whichever twin the group lists first. (Not "each twin alone does the same": a second tap on a well of
//    Mountains pays with the next one, where the picked one alone would be taken back.)
// Otherwise nothing is committed: the group opens for the player to choose a member, and the gesture, both ends kept,
// completes with the card chosen. A member "could mean" what its gesture alone would do: send, change the picks, open a
// sheet or the inspector; one the gesture cannot use (nothing, a toast) is inert.
import type { CardId, Decision } from "../protocol";
import type { Facts } from "./facts";
import type { Reaction } from "./kinds/kind";
import type { Reached } from "./reach";
import type { Draft, Gesture, Pending } from "./state";
import type { Target } from "./types";

/** A target as cards, or null when it is stale. */
export type Reach = (t: Target) => Reached | null;
/** The kind's reaction to a tap or a drag on targets as cards. */
export interface Act {
  tap(at: Reached): Reaction | null;
  drag(from: Reached, onto: Reached): Reaction | null;
}

const ENDS = { tap: ["at"], drag: ["from", "onto"] } as const;
type Ends = Partial<Record<Pending["end"], Reached>>;

const targetOf = (g: Gesture, end: Pending["end"]): Target => (g.a === "tap" ? g.at : end === "from" ? g.from : g.onto);
export const withEnd = (g: Gesture, end: Pending["end"], t: Target): Gesture =>
  g.a === "tap" ? { a: "tap", at: t } : end === "from" ? { ...g, from: t } : { ...g, onto: t };

/** It does something the player would see as meant: sends, changes the picks, opens a sheet, the inspector or a choice. */
export function meaningful(r: Reaction | null, draft: Draft): boolean {
  if (!r) return false;
  return r.answer !== undefined || (r.draft !== undefined && JSON.stringify(r.draft) !== JSON.stringify(draft)) || !!r.sheet || r.inspect !== undefined || r.choose !== undefined;
}

const refsOf = (d: Decision): readonly Record<string, unknown>[] => ("refs" in d && Array.isArray(d.refs) ? (d.refs as readonly Record<string, unknown>[]) : []);

/** A card as the decision sees it: its state, and every option that names it, with its own id left out. */
export function standing(d: Decision, f: Facts, id: CardId): string {
  const c = f.cards[id];
  const own = new RegExp(`\\b${id}\\b`, "g");
  const opts = refsOf(d).flatMap((ref, i) => {
    if (!ref || !Object.values(ref).includes(id)) return [];
    const shape = Object.entries(ref).map(([k, v]) => [k, v === id ? "*" : v]);
    return [JSON.stringify([shape, (d.options[i] ?? "").replace(own, "*"), (d.details?.[i] ?? "").replace(own, "*")])];
  });
  return JSON.stringify([c?.name ?? id, c?.state ?? "", opts.sort()]);
}

/** A reaction with each of `ids` as the card it is (`standing`) and each option as what it does: twins read the same. */
function canonical(r: Reaction | null, d: Decision, f: Facts, ids: readonly CardId[]): string {
  if (!r) return "null";
  const card = (v: unknown): unknown => (typeof v === "number" && ids.includes(v as CardId) ? standing(d, f, v as CardId) : v);
  const opt = (o: number): string => {
    const ref = refsOf(d)[o - 1];
    const label = (d.options[o - 1] ?? "").replace(/\b\d+\b/g, (n) => String(card(+n)));
    return JSON.stringify([ref ? Object.entries(ref).map(([k, v]) => [k, card(v)]) : null, label]);
  };
  const sheet = r.sheet && { ...r.sheet, ...("options" in r.sheet ? { options: r.sheet.options.map(opt) } : {}), ...("card" in r.sheet ? { card: card(r.sheet.card) } : {}) };
  return JSON.stringify({
    ...r,
    answer: r.answer && "answer" in r.answer ? r.answer.answer.map(opt) : r.answer,
    draft: r.draft && { ...r.draft, sel: r.draft.sel.map(opt), holding: card(r.draft.holding), attackTo: card(r.draft.attackTo) },
    sheet,
    inspect: card(r.inspect),
  });
}

/**
 * The gesture's reaction, or a choice: the first end that is a group whose meaning hangs on which member was meant
 * opens that group, and the gesture waits for the card chosen (`pending`). Null: a target is stale.
 */
export function resolve(g: Gesture, d: Decision, f: Facts, draft: Draft, reach: Reach, act: Act): { readonly r: Reaction | null } | null {
  const ends: Ends = {};
  for (const end of ENDS[g.a]) {
    const at = reach(targetOf(g, end));
    if (!at) return null;
    ends[end] = at;
  }
  const run = (e: Ends): Reaction | null => (g.a === "tap" ? act.tap(e.at!) : act.drag(e.from!, e.onto!));
  for (const end of ENDS[g.a]) {
    const at = ends[end]!;
    if (at.group === undefined || at.ids.length < 2) continue;
    const alone = at.ids.map((m) => run({ ...ends, [end]: { ids: [m], seat: null, table: at.table } }));
    if (alone.every((r) => JSON.stringify(r) === JSON.stringify(alone[0]))) continue;
    const meant = at.ids.filter((_, i) => meaningful(alone[i]!, draft));
    if (!meant.length) continue;
    const one = standing(d, f, meant[0]!), name = f.cards[meant[0]!]?.name;
    const twins = meant.every((m) => standing(d, f, m) === one) && at.ids.every((m) => meant.includes(m) || f.cards[m]?.name === name);
    const same = (k: number): boolean => canonical(run({ ...ends, [end]: { ...at, ids: [...at.ids.slice(k), ...at.ids.slice(0, k)] } }), d, f, at.ids) === canonical(run(ends), d, f, at.ids);
    if (!twins || !at.ids.every((_, k) => k === 0 || same(k))) {
      const cards = Object.values(ends).flatMap((e) => e.ids);
      return { r: { choose: at.group, pending: { gesture: g, end, group: at.group, members: at.ids, where: Object.fromEntries(cards.map((c) => [c, whereOf(f, c)])) } } };
    }
  }
  return { r: run(ends) };
}

/** Where a card is, as a pending gesture remembers it: its zone and controller ("" when it is gone). */
export const whereOf = (f: Facts, id: CardId): string => {
  const c = f.cards[id];
  return c ? `${c.zone}|${c.controller}` : "";
};

/** Every card of a pending gesture is where it was. */
export const still = (p: Pending, f: Facts): boolean => Object.entries(p.where).every(([id, w]) => whereOf(f, +id as CardId) === w);

/**
 * A tap on a card while a gesture waits: the gesture completed with it ("done"), a card of the group that has left it
 * since ("stale": refused), or another card altogether ("other": an ordinary tap).
 */
export function completed(p: Pending, card: CardId, members: readonly CardId[] | undefined): { done: Gesture } | "stale" | "other" {
  if (members?.includes(card)) return { done: withEnd(p.gesture, p.end, { card }) };
  return p.members.includes(card) ? "stale" : "other";
}
