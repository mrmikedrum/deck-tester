// The table as play needs it, as plain data: what a TableModel says that a prompt, a mark or a tap reads, with the
// model's readings (threat, the sweep) computed once per snapshot. Kept in play's state, so the state stays
// JSON-serialisable while the model (maps, functions) does not.
import type { CardId, StackId } from "../protocol";
import type { Card, SeatId, TableModel, Target, Zone } from "../model";
import { isCreatureSweep, sig, threatens, topOf } from "../model";

export interface CardFact {
  /** The card's identity (same-named cards are the same card): "Face-down" face down. */
  readonly name: string;
  /** What it is called on screen. */
  readonly display: string;
  readonly zone: Zone;
  readonly owner: SeatId;
  readonly controller: SeatId;
  readonly tapped: boolean;
  /** What it is to the eye and the rules beyond its name: tapped, face down (and the face its controller sees), sick,
   *  counters (loyalty among them), power and toughness, keywords, owner and controller, a token or not, and what is
   *  attached to it, each as itself. Two cards with the same `state` are interchangeable. */
  readonly state: string;
  readonly commander: boolean;
  /** Braced. */
  readonly cost: string;
  readonly text: string;
  readonly catalogued: boolean;
}

export interface ItemFact {
  readonly id: StackId;
  readonly source: CardId | null;
  readonly controller: SeatId | null;
  readonly spell: boolean;
  readonly text: string;
  readonly targets: readonly Target[];
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
  readonly commander: CardId | null;
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

/** What tells two same-named cards apart to the eye and the rules (`CardFact.state`): whose, a token or not, the face
 *  its controller sees (a face-down card's), and what is attached, each as itself. */
function stateOf(m: TableModel, c: Card): string {
  const one = (x: Card): string => [sig(x), x.owner, x.controller, x.token, x.face.name, [...x.keywords].sort().join(",")].join("|");
  return JSON.stringify([one(c), m.attachments(c.id).map((a) => m.cards.get(a)).filter((x): x is Card => !!x).map(one).sort()]);
}

export function factsOf(m: TableModel): Facts {
  const me = m.viewer.perspective;
  const cards: Record<number, CardFact> = {};
  let commander: CardId | null = null;
  for (const c of m.cards.values()) {
    cards[c.id] = {
      name: c.name,
      display: c.face.name,
      zone: c.zone,
      owner: c.owner,
      controller: c.controller,
      tapped: c.tapped,
      state: stateOf(m, c),
      commander: c.commander,
      cost: c.face.cost,
      text: c.face.text,
      catalogued: c.face.catalogued,
    };
    if (commander === null && c.commander && c.owner === me) commander = c.id;
  }
  // Out of sight, as last seen (live.js `known`): my plate still means my commander.
  commander ??= m.commanders.get(me)?.[0]?.id ?? null;
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
    commander,
    stack: m.stack.map((s) => ({
      id: s.id,
      source: s.source,
      controller: s.controller,
      spell: s.spell,
      text: s.text,
      targets: s.targets,
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
export const cardOf = (f: Facts, id: CardId | null | undefined): CardFact | undefined => (id == null ? undefined : f.cards[id]);
export const seatName = (f: Facts, id: SeatId | null): string => (id === null ? "" : (f.seats.find((s) => s.id === id)?.name ?? id));
export const hasSeat = (f: Facts, name: string): boolean => f.seats.some((s) => s.id === name);
