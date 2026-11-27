// The table as play needs it, as plain data: what a TableModel says that a prompt, a mark or a tap reads, with the
// model's readings (threat, the sweep) computed once per snapshot. Kept in play's state, so the state stays
// JSON-serialisable while the model (maps, functions) does not.
import type { CardId } from "../protocol";
import type { Card, SeatId, StackItem, TableModel, Zone } from "../model";
import { asides, isCreatureSweep, threatens, topOf } from "../model";

export interface CardFact {
  /** The card's identity (same-named cards are the same card): "Face-down" face down. */
  readonly name: string;
  /** What it is called on screen. */
  readonly display: string;
  readonly zone: Zone;
  readonly owner: SeatId;
  readonly controller: SeatId;
  readonly tapped: boolean;
  /** All the client knows of it but its identity, what is attached to it included, deeply (`stateOf`): two cards with
   *  the same `state` are interchangeable. */
  readonly state: string;
  /** What sets it apart from others of its name, in words (model `asides`): "tapped", "owned by Atraxa", "with Rancor". */
  readonly asides: readonly string[];
  readonly commander: boolean;
  /** The permanent it is attached to (an Aura, an Equipment), or null. */
  readonly attachedTo: CardId | null;
  /** Braced. */
  readonly cost: string;
  readonly text: string;
  readonly catalogued: boolean;
}

export interface ItemFact extends StackItem {
  /** Someone else's, aimed at me or mine (readings `threatens`). */
  readonly threat: boolean;
  /** The creature sweep the old prompt turned red for (readings `isCreatureSweep`). */
  readonly sweep: boolean;
}

export interface Facts {
  readonly rev: string;
  readonly gen: number;
  /** The perspective seat: whose plays, marks and threats. */
  readonly me: SeatId;
  readonly mayAnswer: boolean;
  readonly turn: number;
  readonly phase: string;
  readonly active: SeatId | null;
  readonly over: boolean;
  readonly seats: readonly { readonly id: SeatId; readonly name: string; readonly out: boolean }[];
  readonly cards: Readonly<Record<number, CardFact>>;
  /** My hand, in the engine's order. */
  readonly hand: readonly CardId[];
  /** My commander, wherever it is. */
  /** Bottom first. */
  readonly stack: readonly ItemFact[];
  /** Attackers aimed at me while attackers are declared. */
  readonly attackersAtMe: readonly CardId[];
  /** Who declared blockers, while blockers are declared. */
  readonly blockerSeats: readonly SeatId[];
  /** The top of the stack is someone else's and aims at me or mine (readings `threatens`). */
  readonly threat: boolean;
  /** The top of the stack is the creature sweep the old prompt turned red for (readings `isCreatureSweep`). */
  readonly sweep: boolean;
  /** My cards someone else's stack item aims at. */
  readonly danger: readonly CardId[];
  /** "2 {G} 1 {U}", or "" when nothing floats. */
  readonly floating: string;
}

/**
 * A card as all the client knows of it, its identity aside (`CardFact.state`): every field of the model's card but its
 * id and what it is attached to, its face as shown, and what is attached to it, each by the same rule (a cycle cut
 * where it closes). Two cards with the same `state` are the same card to the eye and the rules.
 */
function stateOf(m: TableModel, c: Card, seen: ReadonlySet<CardId> = new Set()): string {
  const rest = Object.fromEntries(Object.entries(c).filter(([k]) => k !== "id" && k !== "attachedTo"));
  const inner = new Set([...seen, c.id]);
  const dressed = m.attachments(c.id).flatMap((a) => {
    const x = m.cards.get(a);
    return x && !inner.has(a) ? [stateOf(m, x, inner)] : [];
  });
  return JSON.stringify([canon(rest), dressed.sort()]);
}
/** Plain data with its keys in order, so equal data reads equal. */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v;

export function factsOf(m: TableModel): Facts {
  const me = m.viewer.perspective;
  const cards: Record<number, CardFact> = {};
  for (const c of m.cards.values()) {
    cards[c.id] = {
      name: c.name,
      display: c.face.name,
      zone: c.zone,
      owner: c.owner,
      controller: c.controller,
      tapped: c.tapped,
      state: stateOf(m, c),
      asides: asides(m, c),
      commander: c.commander,
      attachedTo: c.attachedTo ?? null,
      cost: c.face.cost,
      text: c.face.text,
      catalogued: c.face.catalogued,
    };
  }
  const top = topOf(m);
  const danger = new Set<CardId>();
  for (const st of m.stack) {
    if (st.controller === null || st.controller === me) continue;
    for (const t of st.targets) if ("card" in t && m.cards.get(t.card)?.controller === me) danger.add(t.card);
  }
  const attackersAtMe =
    m.phase === "COMBAT_DECLARE_ATTACKERS"
      ? (m.combat?.attackers ?? []).filter((a) => a.defender !== null && "seat" in a.defender && a.defender.seat === me).map((a) => a.attacker)
      : [];
  const blockerSeats =
    m.phase === "COMBAT_DECLARE_BLOCKERS"
      ? [...new Set((m.combat?.blockers ?? []).map((b) => m.cards.get(b.blocker)?.controller).filter((s): s is SeatId => !!s))]
      : [];
  const pool = m.seat(me)?.manaPool ?? {};
  return {
    rev: m.rev,
    gen: m.gen,
    me,
    mayAnswer: m.viewer.mayAnswer,
    turn: m.turn,
    phase: m.phase,
    active: m.active,
    over: m.over,
    seats: m.seats.map((s) => ({ id: s.id, name: s.name as string, out: s.out })),
    cards,
    hand: m.zone(me, "hand"),
    stack: m.stack.map((s) => ({
      ...s,
      threat: threatens(s, m),
      sweep: isCreatureSweep(s, m),
    })),
    attackersAtMe,
    blockerSeats,
    threat: !!top && threatens(top, m),
    sweep: !!top && isCreatureSweep(top, m),
    danger: [...danger],
    floating: Object.entries(pool)
      .filter(([, n]) => n > 0)
      .map(([color, n]) => `${n} {${color}}`)
      .join(" "),
  };
}

export const topItem = (f: Facts): ItemFact | undefined => f.stack[f.stack.length - 1];
/** On the battlefield now: what attacks, blocks and is attacked (a card that has left is no candidate, whatever a late
 *  gesture says). */
export const inPlay = (f: Facts, id: CardId): boolean => f.cards[id]?.zone === "battlefield";
export const cardOf = (f: Facts, id: CardId | null | undefined): CardFact | undefined => (id == null ? undefined : f.cards[id]);
export const seatName = (f: Facts, id: SeatId | null): string => (id === null ? "" : (f.seats.find((s) => s.id === id)?.name ?? id));
export const hasSeat = (f: Facts, name: string): boolean => f.seats.some((s) => s.id === name);
