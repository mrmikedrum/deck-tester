// The atomic changes between two models: what moved, flipped, tapped, entered combat or left the stack, each carrying
// the card's look before and after so a card that appeared and vanished inside the app's queue can still be drawn from
// the change itself. Pure facts; grouping them into moments (and their meaning) is moments.ts.
import type { CardId, LogEntry } from "../../protocol";
import type { Card } from "../card";
import type { SeatId, Zone } from "../ids";
import { departureIn, logCards, logKey } from "../readings";
import type { Attack, Block, Combat, StackItem, TableModel } from "../table";

/** How a card moved, read from the zones (and the log where the zones cannot say). */
export type MoveKind =
  | "cast" // to the stack
  | "play" // a land from the hand
  | "resolve" // from the stack to the battlefield
  | "spent" // from the stack to the graveyard (resolved or countered: the popped change says which)
  | "draw" // into the hand from out of sight
  | "discard"
  | "die" // to the graveyard from the battlefield
  | "exile"
  | "bounce" // back to the hand
  | "return" // out of the graveyard or exile
  | "command" // to the command zone
  | "enter" // onto the battlefield from out of sight or the command zone
  | "token" // a token appeared on the battlefield
  | "token-gone" // a token left the battlefield and ceased to exist
  | "appear" // into a public zone from out of sight (milled, an unseen discard)
  | "vanish" // out of sight (to a library, an opponent's hand)
  | "move"; // anything else

/** How a stack item left: from the engine's log; `unknown` when the log does not say. */
export type PopKind = "resolved" | "countered" | "fizzled" | "unknown";

interface CardChange {
  readonly card: CardId;
  /** The card as it was, or null when it was out of sight. */
  readonly before: Card | null;
  /** The card as it is, or null when it went out of sight. */
  readonly after: Card | null;
}

export type Change =
  | ({ readonly t: "moved"; readonly kind: MoveKind; readonly from: Zone | null; readonly to: Zone | null } & CardChange)
  | ({ readonly t: "tapped" } & CardChange)
  | ({ readonly t: "counters" } & CardChange)
  | ({ readonly t: "stats" } & CardChange)
  | ({ readonly t: "attached"; readonly from: CardId | null; readonly to: CardId | null } & CardChange)
  | ({ readonly t: "control"; readonly from: SeatId; readonly to: SeatId } & CardChange)
  | ({ readonly t: "flipped" } & CardChange)
  | { readonly t: "pushed"; readonly item: StackItem }
  | { readonly t: "popped"; readonly item: StackItem; readonly how: PopKind }
  | { readonly t: "attacks"; readonly card: CardId; readonly attack: Attack; readonly controller: SeatId | null }
  | { readonly t: "blocked"; readonly card: CardId; readonly block: Block; readonly controller: SeatId | null }
  | { readonly t: "combat-over"; readonly combat: Combat }
  | { readonly t: "life"; readonly seat: SeatId; readonly from: number; readonly to: number }
  | { readonly t: "poison"; readonly seat: SeatId; readonly from: number; readonly to: number }
  | { readonly t: "monarch"; readonly from: SeatId | null; readonly to: SeatId | null }
  | { readonly t: "eliminated"; readonly seat: SeatId }
  /** A count the viewer sees without the cards: someone else's hand, any library. */
  | { readonly t: "count"; readonly seat: SeatId; readonly zone: "hand" | "library"; readonly from: number; readonly to: number }
  | { readonly t: "turn"; readonly from: number; readonly to: number; readonly active: SeatId | null }
  | { readonly t: "phase"; readonly from: string; readonly to: string }
  | { readonly t: "priority"; readonly from: SeatId | null; readonly to: SeatId | null }
  /**
   * A cut: the first model, a new game, or a view that does not carry on from the last (live.js `jump`). `back`: the
   * jump went back to an earlier position (a restore), with what it set aside.
   */
  | { readonly t: "reset"; readonly why: "first" | "game" | "jump"; readonly back?: Back };

/** A stack item a jump set aside: on the stack before it, not after (live.js `setAside`), as it was. */
export interface SetAside {
  readonly item: StackItem;
  /** Its card as it was, or null when the table did not show it. */
  readonly source: Card | null;
  /** Its targets as they were: a card (one the table did not show is left out) or a seat. */
  readonly targets: readonly (Card | SeatId)[];
}

/** A jump back to an earlier position (live.js `rewound`): what was on the stack that the earlier position has not. */
export interface Back {
  readonly aside: readonly SetAside[];
}

export type ChangeType = Change["t"];

/** The log entries in `next` that `prev` did not have (live.js `fresh`). */
export function freshLog(prev: TableModel, next: TableModel): LogEntry[] {
  const seen = new Set(prev.log.map(logKey));
  return next.log.filter((e) => !seen.has(logKey(e)));
}

/**
 * live.js `take`'s `jump`: the view does not carry on from the last one (the turn went back, or the last entry it had
 * is gone from a log that starts at or before it). The table cuts instead of animating moves that never happened.
 */
export function jumped(prev: TableModel, next: TableModel): boolean {
  const tail = prev.log[prev.log.length - 1];
  if (next.turn < prev.turn) return true;
  if (!tail) return false;
  const key = logKey(tail);
  const first = next.log[0];
  return !next.log.some((e) => logKey(e) === key) && (!first || first.i <= tail.i);
}

/**
 * live.js `take`'s `rewound`: a jump that went back (an earlier turn, or the same turn with a log that ends before the
 * last one did), with the stack items it set aside. Null for a jump that did not go back. Call it for a jump only.
 */
export function wentBack(prev: TableModel, next: TableModel): Back | null {
  const last = (m: TableModel): number => m.log[m.log.length - 1]?.i ?? -1;
  if (next.turn > prev.turn || (next.turn === prev.turn && last(next) >= last(prev))) return null;
  const aside = [...prev.stack]
    .reverse()
    .filter((st) => !next.stack.some((n) => n.id === st.id && n.source === st.source))
    .map((item): SetAside => ({
      item,
      source: item.source === null ? null : (prev.cards.get(item.source) ?? null),
      targets: item.targets.flatMap((t): (Card | SeatId)[] => {
        if ("seat" in t) return [t.seat];
        const c = prev.cards.get(t.card);
        return c ? [c] : [];
      }),
    }));
  return { aside };
}

const byFresh = (fresh: readonly LogEntry[], card: CardId, type: RegExp) =>
  fresh.find((e) => type.test(e.type) && logCards(e).includes(card));

/** The move's kind from its zones; the log settles what the zones cannot (an unseen discard, a bounce out of sight). */
function moveKind(from: Zone | null, to: Zone | null, before: Card | null, after: Card | null, fresh: readonly LogEntry[], id: CardId): MoveKind {
  if (to === "stack") return "cast";
  if (from === null) {
    if (to === "hand") return "draw";
    if (to === "battlefield") return after?.token ? "token" : "enter";
    if (to === "graveyard" && byFresh(fresh, id, /^DISCARD$/i)) return "discard";
    return "appear";
  }
  if (to === null) {
    if (from === "battlefield" && before?.token) return "token-gone";
    const zc = byFresh(fresh, id, /^ZONE_CHANGE$/i);
    if (zc && /\bput into Hand\b/i.test(zc.text)) return "bounce";
    return "vanish";
  }
  if (to === "exile") return "exile";
  if (to === "command") return "command";
  if (to === "hand") return from === "battlefield" || from === "stack" ? "bounce" : "return";
  if (from === "stack") return to === "battlefield" ? "resolve" : to === "graveyard" ? "spent" : "move";
  if (from === "hand") return to === "battlefield" ? "play" : to === "graveyard" ? "discard" : "move";
  if (from === "battlefield") return to === "graveyard" ? "die" : "move";
  if (from === "graveyard" || from === "exile") return "return";
  if (from === "command") return to === "battlefield" ? "enter" : "move";
  return "move";
}

const sameCounters = (a: Card, b: Card) => JSON.stringify(a.counters) === JSON.stringify(b.counters);

function cardChanges(prev: TableModel, next: TableModel, fresh: readonly LogEntry[]): Change[] {
  const out: Change[] = [];
  const ids = [...new Set([...prev.cards.keys(), ...next.cards.keys()])].sort((a, b) => a - b);
  for (const id of ids) {
    const before = prev.cards.get(id) ?? null, after = next.cards.get(id) ?? null;
    const base = { card: id, before, after };
    if (!before || !after || before.zone !== after.zone) {
      const from = before?.zone ?? null, to = after?.zone ?? null;
      out.push({ t: "moved", kind: moveKind(from, to, before, after, fresh, id), from, to, ...base });
      continue;
    }
    if (before.controller !== after.controller) out.push({ t: "control", from: before.controller, to: after.controller, ...base });
    if (before.faceDown !== after.faceDown || before.face.name !== after.face.name) out.push({ t: "flipped", ...base });
    if (before.tapped !== after.tapped) out.push({ t: "tapped", ...base });
    if (!sameCounters(before, after)) out.push({ t: "counters", ...base });
    if (before.power !== after.power || before.toughness !== after.toughness || before.loyalty !== after.loyalty)
      out.push({ t: "stats", ...base });
    if (before.attachedTo !== after.attachedTo) out.push({ t: "attached", from: before.attachedTo, to: after.attachedTo, ...base });
  }
  return out;
}

function stackChanges(prev: TableModel, next: TableModel, fresh: readonly LogEntry[]): Change[] {
  const now = new Set(next.stack.map((s) => s.id)), was = new Set(prev.stack.map((s) => s.id));
  const out: Change[] = [];
  for (const item of [...prev.stack].reverse()) {
    if (now.has(item.id)) continue;
    const name = item.source === null ? "" : (prev.cards.get(item.source)?.name ?? "");
    const said = fresh.map((e) => departureIn(e, item, name)).find((h) => h !== null);
    out.push({ t: "popped", item, how: said ?? "unknown" });
  }
  for (const item of next.stack) if (!was.has(item.id)) out.push({ t: "pushed", item });
  return out;
}

const targetKey = (a: Attack) => `${a.attacker}>${a.defender === null ? "" : "card" in a.defender ? a.defender.card : "@" + a.defender.seat}`;

function combatChanges(prev: TableModel, next: TableModel): Change[] {
  const out: Change[] = [];
  const attacks = new Set((prev.combat?.attackers ?? []).map(targetKey));
  const blocks = new Set((prev.combat?.blockers ?? []).map((b) => `${b.blocker}>${b.attacker}`));
  const ctl = (id: CardId) => next.cards.get(id)?.controller ?? prev.cards.get(id)?.controller ?? null;
  for (const a of next.combat?.attackers ?? [])
    if (!attacks.has(targetKey(a))) out.push({ t: "attacks", card: a.attacker, attack: a, controller: ctl(a.attacker) });
  for (const b of next.combat?.blockers ?? [])
    if (!blocks.has(`${b.blocker}>${b.attacker}`)) out.push({ t: "blocked", card: b.blocker, block: b, controller: ctl(b.blocker) });
  if (prev.combat && prev.combat.attackers.length > 0 && !next.combat?.attackers.length) out.push({ t: "combat-over", combat: prev.combat });
  return out;
}

function seatChanges(prev: TableModel, next: TableModel): Change[] {
  const out: Change[] = [];
  for (const s of next.seats) {
    const was = prev.seat(s.id);
    if (!was || was.out) continue;
    if (s.out) {
      out.push({ t: "eliminated", seat: s.id });
      continue;
    }
    if (was.life !== s.life) out.push({ t: "life", seat: s.id, from: was.life, to: s.life });
    if (was.poison !== s.poison) out.push({ t: "poison", seat: s.id, from: was.poison, to: s.poison });
    if (!was.handVisible && !s.handVisible && was.hand !== s.hand) out.push({ t: "count", seat: s.id, zone: "hand", from: was.hand, to: s.hand });
    if (was.library !== s.library) out.push({ t: "count", seat: s.id, zone: "library", from: was.library, to: s.library });
  }
  const monarch = (m: TableModel) => m.seats.find((s) => s.monarch)?.id ?? null;
  if (monarch(prev) !== monarch(next)) out.push({ t: "monarch", from: monarch(prev), to: monarch(next) });
  return out;
}

function turnChanges(prev: TableModel, next: TableModel): Change[] {
  const out: Change[] = [];
  if (prev.turn !== next.turn) out.push({ t: "turn", from: prev.turn, to: next.turn, active: next.active });
  if (prev.phase !== next.phase) out.push({ t: "phase", from: prev.phase, to: next.phase });
  if (prev.priority !== next.priority) out.push({ t: "priority", from: prev.priority, to: next.priority });
  return out;
}

/** Every change from `prev` to `next` of the same game, unordered (ordering is order.ts). */
export function changesBetween(prev: TableModel, next: TableModel, fresh: readonly LogEntry[]): Change[] {
  return [
    ...turnChanges(prev, next),
    ...stackChanges(prev, next, fresh),
    ...cardChanges(prev, next, fresh),
    ...combatChanges(prev, next),
    ...seatChanges(prev, next),
  ];
}

/** The card a change is about, if any. */
export function cardOfChange(c: Change): CardId | null {
  switch (c.t) {
    case "moved":
    case "tapped":
    case "counters":
    case "stats":
    case "attached":
    case "control":
    case "flipped":
    case "attacks":
    case "blocked":
      return c.card;
    case "pushed":
    case "popped":
      return c.item.source;
    default:
      return null;
  }
}

/** The seats a change touches (ChangeSet.involved). */
export function seatsOfChange(c: Change, prev: TableModel | null, next: TableModel): SeatId[] {
  const ctl = (id: CardId) => next.cards.get(id)?.controller ?? prev?.cards.get(id)?.controller ?? null;
  const out: (SeatId | null)[] = [];
  switch (c.t) {
    case "moved":
    case "tapped":
    case "counters":
    case "stats":
    case "attached":
    case "flipped":
      out.push(c.before?.controller ?? null, c.after?.controller ?? null);
      break;
    case "control":
      out.push(c.from, c.to);
      break;
    case "pushed":
    case "popped":
      out.push(c.item.controller);
      break;
    case "attacks":
      out.push(c.controller, c.attack.defending);
      break;
    case "blocked":
      out.push(c.controller, ctl(c.block.attacker));
      break;
    case "combat-over":
      c.combat.attackers.forEach((a) => out.push(ctl(a.attacker), a.defending));
      break;
    case "life":
    case "poison":
    case "eliminated":
    case "count":
      out.push(c.seat);
      break;
    case "monarch":
    case "priority":
      out.push(c.from, c.to);
      break;
    case "turn":
      out.push(c.active);
      break;
    case "phase":
    case "reset":
      break;
  }
  return out.filter((s): s is SeatId => s !== null);
}
