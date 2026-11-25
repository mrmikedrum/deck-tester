// Displayed membership (docs "Piles show what has arrived"): what each actor shows this frame, and which actor shows each
// card. The one writer of `ActorState.shown`: a piece shows its described members less what is still on its way to it
// (a flight, a piece folding into it) or held by the chrome (a card a moment carries that the stage has not taken over),
// plus the cards that have left it but wait their turn in it. Pure.
import type { CardId } from "../../protocol";
import type { ActorState } from "./actors";
import { shownMembers } from "./piles";

export class Membership {
  private shownBy = new Map<CardId, string>();

  /** The actor that showed a card at the last reconcile, or null. */
  homeOf(card: CardId): string | null {
    return this.shownBy.get(card) ?? null;
  }

  shows(card: CardId): boolean {
    return this.shownBy.has(card);
  }

  /**
   * Sets what every actor shows. `inbound`: cards on their way to each piece (taken over: folds are added here);
   * `held`: cards that left each piece and wait their turn in it; `away`: cards no piece shows yet (the chrome draws
   * them). An actor folding into another keeps what it showed.
   */
  reconcile(
    actors: Iterable<ActorState>,
    inbound: Map<string, Set<CardId>>,
    held: ReadonlyMap<string, readonly CardId[]>,
    away: ReadonlySet<CardId> = NONE,
  ): void {
    const list = [...actors];
    for (const st of list) {
      if (!st.into) continue;
      const s = inbound.get(st.into);
      if (s) for (const id of st.shown) s.add(id);
      else inbound.set(st.into, new Set(st.shown));
    }
    const shownBy = new Map<CardId, string>();
    for (const st of list) {
      if (st.into === null) {
        const members = st.remnant ? [] : st.piece.members;
        st.shown = shownMembers(away.size ? members.filter((id) => !away.has(id)) : members, inbound.get(st.id) ?? NONE, held.get(st.id) ?? []);
      }
      for (const id of st.shown) if (!shownBy.has(id)) shownBy.set(id, st.id);
    }
    this.shownBy = shownBy;
  }
}

const NONE: ReadonlySet<CardId> = new Set();
