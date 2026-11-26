// The table as the client sees it: modelOf(snapshot, catalog, viewer, commanders). One immutable value per snapshot, with
// its zones and attachments indexed once, and the one thing it remembers: each seat's commanders as last seen. Ported from live.js `apply` (the view -> GAME transform), without its positional seat
// ids: a seat is its name, and seats come from the bridge's `pilots` so a player who has lost keeps their place.
import type { CardId, LogEntry, PlayerName, Snapshot, StackId, View } from "../protocol";
import type { CardCatalog } from "./catalog";
import { cardOf } from "./card";
import type { Card } from "./card";
import { seatId } from "./ids";
import type { Phase, SeatId, Target, Zone } from "./ids";
import { hash } from "./rev";

/** Who is looking: three separate facts. */
export interface Viewer {
  /** The seat drawn nearest: the person's own seat, or the one a spectator watches from. */
  readonly perspective: SeatId;
  /** The seat this viewer plays, or null for a spectator. */
  readonly seat: SeatId | null;
  /** Whether this viewer may answer the engine's decisions. */
  readonly mayAnswer: boolean;
}

export interface Seat {
  readonly id: SeatId;
  readonly name: PlayerName;
  /** Who pilots it ("human", "jev + advisor", "forge ai"), from the bridge; null when it does not say. */
  readonly pilot: string | null;
  /** Eliminated: the engine no longer lists the player. The seat keeps its place; its other facts read 0. */
  readonly out: boolean;
  readonly life: number;
  readonly poison: number;
  readonly monarch: boolean;
  /** Cards in hand: the hand itself when the viewer sees it, else the engine's count. */
  readonly hand: number;
  readonly handVisible: boolean;
  readonly library: number;
  /** Floating mana: colour letter to amount. */
  readonly manaPool: Readonly<Record<string, number>>;
  /** Commander damage taken, by the commander that dealt it. */
  readonly commanderDamage: ReadonlyMap<CardId, number>;
}

export interface StackItem {
  readonly id: StackId;
  /** The card it came from (a spell's own card, an ability's source); null when the engine names none. */
  readonly source: CardId | null;
  readonly controller: SeatId | null;
  readonly spell: boolean;
  readonly text: string;
  readonly targets: readonly Target[];
  readonly x: number | null;
  readonly modes: readonly string[];
  readonly abilityTargets: readonly StackId[];
}

export interface Attack {
  readonly attacker: CardId;
  /** A seat, or a planeswalker's or battle's card; null when the engine names none. */
  readonly defender: Target | null;
  /** The seat under attack: the defender itself, or the controller of the defending card. */
  readonly defending: SeatId | null;
  /** Forge's verdict on whether it is blocked; null when the engine does not say. */
  readonly blocked: boolean | null;
}
export interface Block {
  readonly blocker: CardId;
  readonly attacker: CardId;
}
export interface Combat {
  /** Forge's ordinal of this combat in its turn; null when the engine does not say. */
  readonly ordinal: number | null;
  readonly attackers: readonly Attack[];
  readonly blockers: readonly Block[];
  /** The combat damage dealt in this combat so far (Forge's facts, after prevention), by source and target. */
  readonly damage: readonly CombatDamage[];
}
/** Combat damage one source dealt one target in this combat, and what that source was attacking when it hit. */
export interface CombatDamage {
  readonly source: CardId;
  readonly target: Target;
  readonly defender: Target | null;
  readonly amount: number;
}

export interface TableModel {
  /** A content hash: equal iff the content is equal. */
  readonly rev: string;
  /** The game's generation: a new game, a new gen. */
  readonly gen: number;
  readonly viewer: Viewer;
  /** The perspective first, then in turn order (clockwise round the table). Eliminated seats stay, marked `out`. */
  readonly seats: readonly Seat[];
  /** Forge's global turn number. */
  readonly turn: number;
  /** The engine's label ("T3 main1", "T3 Dack main1"). */
  readonly label: string;
  readonly phase: Phase;
  readonly active: SeatId | null;
  readonly priority: SeatId | null;
  readonly over: boolean;
  /** Every visible card, any zone. */
  readonly cards: ReadonlyMap<CardId, Card>;
  /** Bottom first (the wire sends the top first). */
  readonly stack: readonly StackItem[];
  readonly combat: Combat | null;
  /** The engine's latest log entries, oldest first. */
  readonly log: readonly LogEntry[];
  seat(id: SeatId): Seat | undefined;
  /** A seat's cards in a zone, in the engine's order: battlefield and stack by controller, the rest by owner. */
  zone(seat: SeatId, zone: Zone): readonly CardId[];
  /** The cards attached to a card (Auras, Equipment), in the engine's order. */
  attachments(card: CardId): readonly CardId[];
  /**
   * Each seat's commanders this game (live.js `known`): as the view shows them, or as they were last seen once it no
   * longer does (shuffled away, in a hand the viewer does not see, a player who has lost), so the plate keeps its
   * commander. Hand it to the next snapshot's `modelOf` of the same game.
   */
  readonly commanders: CommanderMemory;
}

/** Commanders by owner, as last seen. */
export type CommanderMemory = ReadonlyMap<SeatId, readonly Card[]>;
const NO_COMMANDERS: CommanderMemory = new Map();

/** The viewer the bridge implies today: one person at their own seat (`view.me`), who may answer. */
export function playerViewer(snap: Snapshot): Viewer | null {
  const me = snap.view?.me;
  return me ? { perspective: seatId(me), seat: seatId(me), mayAnswer: true } : null;
}

/** Seat names in turn order (the bridge's `pilots` order, which is its seating), then rotated to the perspective. */
function seatOrder(snap: Snapshot, view: View, perspective: SeatId): SeatId[] {
  const names: string[] = [];
  const add = (n: string) => {
    if (!names.includes(n)) names.push(n);
  };
  Object.keys(snap.pilots).forEach(add);
  view.players.forEach((p) => add(p.name));
  add(view.me);
  const at = names.indexOf(perspective);
  const order = at > 0 ? [...names.slice(at), ...names.slice(0, at)] : names;
  return order.map(seatId);
}

const OWN_ZONES = ["battlefield", "command", "graveyard", "exile", "hand"] as const;
const zoneKey = (seat: SeatId, zone: Zone) => `${zone}\u0000${seat}`;
const NONE: readonly CardId[] = [];

const targetOf = (t: CardId | PlayerName): Target => (typeof t === "number" ? { card: t } : { seat: seatId(t) });

/**
 * The table for a snapshot, or null before a game has a view. Never throws on a decoded snapshot. `known`: the last
 * model's `commanders`, when it is of the same game (live.js `apply` kept them until a new game).
 */
export function modelOf(
  snap: Snapshot,
  catalog: CardCatalog,
  viewer: Viewer,
  known: CommanderMemory = NO_COMMANDERS,
): TableModel | null {
  const view = snap.view;
  if (!view) return null;
  const perspective = viewer.perspective;
  const cards = new Map<CardId, Card>();
  const zones = new Map<string, CardId[]>();
  const put = (seat: SeatId, zone: Zone, c: Parameters<typeof cardOf>[0]) => {
    if (cards.has(c.id)) return; // a card the engine lists twice is drawn once, where it was first listed
    cards.set(c.id, cardOf(c, zone, catalog, perspective));
    const k = zoneKey(seat, zone);
    const list = zones.get(k);
    if (list) list.push(c.id);
    else zones.set(k, [c.id]);
  };
  for (const p of view.players) {
    const seat = seatId(p.name);
    for (const z of OWN_ZONES) for (const c of (z === "hand" ? p.hand : p[z]) ?? []) put(seat, z, c);
  }
  const wireStack = [...view.stack].reverse();
  for (const s of wireStack) if (s.source) put(seatId(s.source.controller), "stack", s.source);

  const attached = new Map<CardId, CardId[]>();
  for (const c of cards.values()) {
    if (c.attachedTo === null) continue;
    const list = attached.get(c.attachedTo);
    if (list) list.push(c.id);
    else attached.set(c.attachedTo, [c.id]);
  }

  const players = new Map(view.players.map((p) => [seatId(p.name), p]));
  const seats: Seat[] = seatOrder(snap, view, perspective).map((id): Seat => {
    const p = players.get(id);
    return {
      id,
      name: id as string as PlayerName,
      pilot: snap.pilots[id] ?? null,
      out: !p,
      life: p?.life ?? 0,
      poison: p?.poison ?? 0,
      monarch: p?.monarch ?? false,
      hand: p ? (p.hand ? p.hand.length : (p.handCount ?? 0)) : 0,
      handVisible: !!p?.hand,
      library: p?.library ?? 0,
      manaPool: p?.manaPool ?? {},
      commanderDamage: new Map(Object.entries(p?.commanderDamage ?? {}).map(([k, n]) => [Number(k) as CardId, n])),
    };
  });
  const bySeat = new Map(seats.map((s) => [s.id, s]));
  // A seat whose commanders the view shows remembers them as they are; one whose commanders it does not keeps the last.
  const commanders = new Map<SeatId, readonly Card[]>(known);
  const seen = new Map<SeatId, Card[]>();
  for (const c of cards.values()) if (c.commander) seen.set(c.owner, [...(seen.get(c.owner) ?? []), c]);
  for (const [seat, list] of seen) commanders.set(seat, list);

  const stack: StackItem[] = wireStack.map((s) => {
    const targets = [...s.targets];
    // The bridge still sends source card ids for legacy clients. Replace one such id per exact ability target.
    for (const id of s.abilityTargets) {
      const source = wireStack.find((item) => item.id === id)?.source?.id;
      const at = source === undefined ? -1 : targets.lastIndexOf(source);
      if (at >= 0) targets.splice(at, 1);
    }
    return {
      id: s.id, source: s.source?.id ?? null,
      controller: s.controller === null ? null : seatId(s.controller),
      spell: s.spell, text: s.text, targets: targets.map(targetOf),
      x: s.x, modes: s.modes, abilityTargets: s.abilityTargets,
    };
  });

  const defending = (d: Target | null): SeatId | null =>
    d === null ? null : "seat" in d ? d.seat : (cards.get(d.card)?.controller ?? null);
  const combat: Combat | null = view.combat
    ? {
        ordinal: view.combat.ordinal,
        attackers: view.combat.attackers.map((a) => {
          // A defender gone from the game (a planeswalker that died of the hit: Forge says -1) is the one its hits
          // recorded when they landed.
          const hit = view.combat!.damage.find((d) => d.source === a.id && d.defender !== null)?.defender ?? null;
          const gone = typeof a.defender === "number" && !cards.has(a.defender);
          const wire = gone && hit !== null ? hit : a.defender;
          const defender = wire === null ? null : targetOf(wire);
          return { attacker: a.id, defender, defending: a.defending !== null ? seatId(a.defending) : defending(defender), blocked: a.blocked };
        }),
        blockers: view.combat.blockers.map((b) => ({ blocker: b.id, attacker: b.blocking })),
        damage: view.combat.damage.map((d) => ({ source: d.source, target: targetOf(d.target), defender: d.defender === null ? null : targetOf(d.defender), amount: d.amount })),
      }
    : null;

  const content = {
    gen: snap.gen ?? 0,
    viewer,
    seats: seats.map((s) => ({ ...s, commanderDamage: [...s.commanderDamage] })),
    turn: view.turn,
    label: view.label,
    phase: view.phase,
    active: view.active === null ? null : seatId(view.active),
    priority: view.priority === null ? null : seatId(view.priority),
    over: view.over,
    cards: [...cards.values()],
    stack,
    combat,
    log: view.log,
    commanders: [...commanders].map(([seat, list]) => [seat, list.map((c) => c.id)]),
  };
  return {
    ...content,
    rev: hash(JSON.stringify(content)),
    seats,
    cards,
    seat: (id) => bySeat.get(id),
    zone: (seat, zone) => zones.get(zoneKey(seat, zone)) ?? NONE,
    attachments: (card) => attached.get(card) ?? NONE,
    commanders,
  };
}
