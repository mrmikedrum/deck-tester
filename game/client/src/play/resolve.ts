// What a gesture on a group means: the one rule for every kind. Layout groups cards it has no room to show apart (a pile
// of copies, a well, a summary of distinct cards), so a tap or drag on a group lands on several cards at once. It may
// stand for any of them only when every member it could mean is interchangeable: the same card (name), in the same
// state (tapped, counters and loyalty, power and toughness, keywords, attachments), offered the same options (what each
// would send, its own id aside), and the members it cannot mean share their name (a well of Islands, some tapped).
// Then the kind's own reading of the group applies (the next free source of a well, the first of the copies).
// Otherwise nothing is committed: the group opens for the player to choose a member, and the gesture, both ends kept,
// completes with the card chosen. A member "could mean" what its gesture alone would do: send, change the picks, open a
// sheet or the inspector; one the gesture cannot use (nothing, a toast) is inert.
import type { CardId, Decision } from "../protocol";
import type { Facts } from "./facts";
import type { Reaction } from "./kinds/kind";
import type { Reached } from "./reach";
import type { Draft, Gesture, Pending } from "./state";
import type { Target } from "./types";

/** What a gesture does on these targets (null: a target is stale, the act is dropped). */
export type Run = (g: Gesture) => { readonly r: Reaction | null } | null;
/** A target as cards, or null when it is stale. */
export type Reach = (t: Target) => Reached | null;

const ENDS = { tap: ["at"], drag: ["from", "onto"] } as const;

const targetOf = (g: Gesture, end: Pending["end"]): Target => (g.a === "tap" ? g.at : end === "from" ? g.from : g.onto);
export const withEnd = (g: Gesture, end: Pending["end"], t: Target): Gesture =>
  g.a === "tap" ? { a: "tap", at: t } : end === "from" ? { ...g, from: t } : { ...g, onto: t };

/** It does something the player would see as meant: sends, changes the picks, opens a sheet, the inspector or a choice. */
export function meaningful(r: Reaction | null, draft: Draft): boolean {
  if (!r) return false;
  return r.answer !== undefined || (r.draft !== undefined && JSON.stringify(r.draft) !== JSON.stringify(draft)) || !!r.sheet || r.inspect !== undefined || r.choose !== undefined;
}

/** A card as the decision sees it: its state, and every option that names it, with its own id left out. */
export function standing(d: Decision, f: Facts, id: CardId): string {
  const c = f.cards[id];
  const refs = "refs" in d && Array.isArray(d.refs) ? (d.refs as readonly Record<string, unknown>[]) : [];
  const own = new RegExp(`\\b${id}\\b`, "g");
  const opts = refs.flatMap((ref, i) => {
    if (!ref || !Object.values(ref).includes(id)) return [];
    const shape = Object.entries(ref).map(([k, v]) => [k, v === id ? "*" : v]);
    return [JSON.stringify([shape, (d.options[i] ?? "").replace(own, "*"), (d.details?.[i] ?? "").replace(own, "*")])];
  });
  return JSON.stringify([c?.name ?? id, c?.state ?? "", opts.sort()]);
}

/**
 * The gesture's reaction, or a choice: the first end that is a group whose members it could mean are not
 * interchangeable opens that group, and the gesture waits for the card chosen (`pending`).
 */
export function resolve(g: Gesture, d: Decision, f: Facts, draft: Draft, reach: Reach, run: Run): { readonly r: Reaction | null } | null {
  for (const end of ENDS[g.a]) {
    const t = targetOf(g, end);
    if (!("group" in t)) continue;
    const at = reach(t);
    if (!at) return null;
    if (at.group === undefined || at.ids.length < 2) continue;
    const meant = at.ids.filter((m) => meaningful(run(withEnd(g, end, { card: m }))?.r ?? null, draft));
    if (!meant.length) continue;
    const one = standing(d, f, meant[0]!), name = f.cards[meant[0]!]?.name;
    const any = meant.every((m) => standing(d, f, m) === one) && at.ids.every((m) => meant.includes(m) || f.cards[m]?.name === name);
    if (!any) return { r: { choose: at.group, pending: { gesture: g, end, group: at.group } } };
  }
  return run(g);
}

/** The pending gesture completed with the card chosen, when it is still a member of its group as drawn now. */
export function completed(p: Pending, card: CardId, members: readonly CardId[] | undefined): Gesture | null {
  return members?.includes(card) ? withEnd(p.gesture, p.end, { card }) : null;
}
