// What the table can reach: a gesture's target as the cards and seat it means, and whether a choice is made on the
// table or in a sheet. The rule is live.js `boardChoice`, read from layout's hit groups instead of the scene's pieces:
// every option must be a card on the table (or the stack) that a tap can reach, or a player with a plate; a card
// hidden in a pile of unlike cards (or in a well beside untapped cards that are not options) sends the choice to a
// sheet, where each can be seen.
import type { CardId, ChooseDecision, TargetsDecision } from "../protocol";
import type { SeatId } from "../model";
import type { HitGroups } from "../layout";
import type { Facts } from "./facts";
import type { Group } from "./state";
import type { Target } from "./types";

export const groupsOf = (hits: HitGroups): Group[] =>
  hits.groups.map((g) => ({ id: g.id, kind: g.kind, seat: g.seat, members: [...g.members] }));

/** A target as cards and a seat: a plate is its seat, a pile its members, a zone pile nothing a decision reads. */
export interface Reached {
  readonly ids: readonly CardId[];
  readonly seat: SeatId | null;
  /** On the table (not a hand card): a touch that holds auto-pass. */
  readonly table: boolean;
}

/** Null when the target is a group whose members changed since it was drawn (or is gone): the act is dropped. */
export function reached(t: Target, groups: readonly Group[], f: Facts): Reached | null {
  if ("nothing" in t) return { ids: [], seat: null, table: true };
  if ("seat" in t) return { ids: [], seat: t.seat, table: true };
  if ("card" in t) return { ids: [t.card], seat: null, table: f.cards[t.card]?.zone !== "hand" };
  const g = groups.find((x) => x.id === t.group);
  if (!g || g.members.length !== t.members.length || g.members.some((m, i) => m !== t.members[i])) return null;
  if (g.kind === "plate") return { ids: [], seat: g.seat, table: true };
  if (g.kind === "zone" || g.kind === "read") return { ids: [], seat: null, table: true };
  return { ids: g.members, seat: null, table: true };
}

/** live.js `boardChoice`: whether a targets or choose decision is answered by tapping the table. */
export function onTable(d: TargetsDecision | ChooseDecision, f: Facts, groups: readonly Group[]): boolean {
  if (!d.refs.length) return false;
  const opt = new Set(d.refs.map((r) => r.card).filter((c): c is CardId => c !== null));
  const hidden = (id: CardId, g: Group) => {
    const name = f.cards[id]?.name;
    return (
      g.members.length > 1 &&
      !g.members.every((x) => {
        const c = f.cards[x];
        return !!c && (opt.has(x) || c.tapped) && c.name === name;
      })
    );
  };
  return d.refs.every((r) => {
    if (r.card !== null) {
      const zone = f.cards[r.card]?.zone;
      if (zone !== "battlefield" && zone !== "stack") return false;
      const g = groups.find((x) => x.kind !== "plate" && x.kind !== "zone" && x.members.includes(r.card!));
      return !!g && !hidden(r.card, g);
    }
    return r.player !== null && groups.some((g) => g.kind === "plate" && g.seat === r.player);
  });
}
