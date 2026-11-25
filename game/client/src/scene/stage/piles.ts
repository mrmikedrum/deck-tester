// Piles show what has arrived (docs "Piles show what has arrived"): a pile's displayed members, its count and what its
// sift shows, lose a card when it leaves and gain one when it lands. h.js `zonePile`'s `arrive`/`landed`, `retitle`
// and the remnant of a pile going whole, as one rule for every piece. Pure.
import type { CardId } from "../../protocol";

/**
 * What a piece shows: its members, minus the cards still on their way to it, plus the cards that have left it in the
 * model but have not yet set off (they wait their turn in it). Held cards keep their place; arrivals land on top.
 */
export function shownMembers(members: readonly CardId[], inbound: ReadonlySet<CardId>, held: readonly CardId[]): CardId[] {
  const out = members.filter((id) => !inbound.has(id));
  for (const id of held) if (!out.includes(id)) out.unshift(id);
  return out;
}

/** A title's count follows what has arrived ("Beast 9" while the ninth is still on its way reads "Beast 8"). */
export function retitle(title: string | null, shown: number): string | null {
  if (title === null) return null;
  return /\d+$/.test(title) ? title.replace(/\d+$/, String(shown)) : title;
}
