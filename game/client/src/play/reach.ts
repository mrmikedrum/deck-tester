// What the table can reach: a gesture's target as the cards and seat it means, and whether a choice is made on the
// table or in a sheet. The rule follows live.js `boardChoice`, read from layout's hit groups instead of the scene's
// pieces: every option must be a card on the table (or the stack) that a tap can reach, or a player with a plate. A card
// hidden in a pile of unlike cards (or in a well beside untapped cards that are not options) is reached through its
// pile: the pile says it holds an option, and a tap opens it with the options lit (the grouped-gesture rule, resolve.ts).
// The prompt's List still offers every option as a sheet.
import type { CardId, ChooseDecision, TargetsDecision } from "../protocol";
import type { SeatId } from "../model";
import type { HitGroups } from "../layout";
import type { Facts } from "./facts";
import type { Group } from "./state";
import type { Target } from "./types";

/** Every group a tap can reach: the table at rest, and the stack's cards only its focus reaches. */
export const groupsOf = (hits: HitGroups): Group[] =>
  [...hits.groups, ...(hits.up ?? []).filter((u) => !hits.groups.some((g) => g.id === u.id))].map((g) => ({ id: g.id, kind: g.kind, seat: g.seat, members: [...g.members] }));

/** A target as cards and a seat: a plate is its seat, a pile its members, a zone pile nothing a decision reads. */
export interface Reached {
  readonly ids: readonly CardId[];
  readonly seat: SeatId | null;
  /** On the table (not a hand card): a touch that holds auto-pass. */
  readonly table: boolean;
  /** The group it was (a pile's id), for a choice among its members; null for a card, a seat or nothing. */
  readonly group?: string;
}

/** Null when the target is a group whose members changed since it was drawn (or is gone): the act is dropped. */
export function reached(t: Target, groups: readonly Group[], f: Facts): Reached | null {
  if ("nothing" in t) return { ids: [], seat: null, table: true };
  if ("seat" in t) return { ids: [], seat: t.seat, table: true };
  // (a card the table no longer holds anywhere: dropped)
  if ("card" in t) return f.cards[t.card] ? { ids: [t.card], seat: null, table: f.cards[t.card]?.zone !== "hand" } : null;
  const g = groups.find((x) => x.id === t.group);
  if (!g || g.members.length !== t.members.length || g.members.some((m, i) => m !== t.members[i])) return null;
  if (g.kind === "plate") return { ids: [], seat: g.seat, table: true };
  return { ids: g.members, seat: null, table: true, group: g.id };
}

/** live.js `boardChoice`: whether a targets or choose decision is answered by tapping the table. */
export function onTable(d: TargetsDecision | ChooseDecision, f: Facts, groups: readonly Group[]): boolean {
  if (!d.refs.length) return false;
  return d.refs.every((r) => {
    if (r.card !== null) {
      const zone = f.cards[r.card]?.zone;
      if (zone !== "battlefield" && zone !== "stack") return false;
      // (an attachment offered on its host is reached through the host's group, whose chooser holds both)
      const host = f.cards[r.card]?.attachedTo;
      return groups.some((x) => x.kind !== "plate" && (x.members.includes(r.card!) || (host != null && x.members.includes(host))));
    }
    return r.player !== null && groups.some((g) => g.kind === "plate" && g.seat === r.player);
  });
}
