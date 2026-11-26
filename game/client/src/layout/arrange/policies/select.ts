// A policy per seat, chosen from the battlefield only (§2.5): `works` when creatures hold under a quarter of the seat's
// non-mana weight, back to `ready-tapped` above 45%. The choice is made at a re-sort (a new turn, or no choice yet) and
// held between its thresholds; it lives in `ContainerMemory.selection`, apart from either policy's own memory.
import type { ArrCard, Clock, ContainerMemory, Policy } from "../contract";
import { creatureWeight } from "./common";
import { kindOf } from "./kinds";
import { readyTapped } from "./ready-tapped";
import { noncreatureWeight, works } from "./works";

export const POLICIES: ReadonlyMap<string, Policy> = new Map([readyTapped, works].map((p) => [p.id, p]));

export const SELECT = { toWorks: 0.25, toReady: 0.45 } as const;

/** The creatures' share of a seat's non-mana weight; null on a board with nothing but mana. */
export function creatureShare(cards: readonly ArrCard[]): number | null {
  const cr = cards.filter((c) => kindOf(c) === "creature");
  const other = cards.filter((c) => {
    const k = kindOf(c);
    return k !== "creature" && k !== "mana" && !c.commander;
  });
  const a = creatureWeight(cr), b = other.reduce((t, c) => t + noncreatureWeight(c), 0);
  return a + b > 0 ? a / (a + b) : null;
}

export interface Selection {
  readonly policy: Policy;
  readonly selection: ContainerMemory["selection"];
}

export function policyFor(cards: readonly ArrCard[], memory: ContainerMemory | null, clock: Clock): Selection {
  const held = memory?.selection ?? null;
  const current = (held && POLICIES.get(held.policy)) || readyTapped;
  // Only at a re-sort: never mid-turn, never while cards are in flight.
  if (held && (clock.turn === held.since || clock.settling)) return { policy: current, selection: held };
  const share = creatureShare(cards);
  let next = current;
  if (share !== null) {
    if (current.id === readyTapped.id && share < SELECT.toWorks) next = works;
    else if (current.id === works.id && share > SELECT.toReady) next = readyTapped;
  }
  return { policy: next, selection: { policy: next.id, since: clock.turn } };
}
