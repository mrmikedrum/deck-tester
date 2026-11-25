// Ordering inside one snapshot. The engine's log entries order what they name; what they do not name is placed by an
// inferred order (the stack before the battlefield) and the change set says so.
import type { LogEntry } from "../../protocol";
import { departureIn, logCards } from "../readings";
import type { TableModel } from "../table";
import type { Change } from "./changes";

/** The inferred order of change types, lowest first: a turn begins, the stack acts, then the battlefield, then the rest. */
export function rank(c: Change): number {
  switch (c.t) {
    case "reset":
      return 0;
    case "turn":
      return 1;
    case "phase":
      return 2;
    case "popped":
      return 3;
    case "pushed":
      return 4;
    case "moved":
      return c.from === "stack" || c.to === "stack" ? 5 : 6;
    case "attacks":
    case "blocked":
    case "combat-over":
      return 7;
    case "tapped":
    case "counters":
    case "stats":
    case "attached":
    case "control":
    case "flipped":
      return 8;
    case "life":
    case "poison":
    case "monarch":
    case "count":
      return 9;
    case "eliminated":
      return 10;
    case "priority":
      return 11;
  }
}

/** Whether a change moves something the order of which the player can see (the order flag judges these). */
export const ordersMotion = (c: Change): boolean =>
  c.t === "moved" || c.t === "pushed" || c.t === "popped" || c.t === "attacks" || c.t === "blocked";

/**
 * The position in `fresh` of the entry that says this change happened, or null when none names it. A card's change
 * prefers the entry of its own kind (a cast's STACK_ADD, a departure's STACK_RESOLVE or "was countered", a move's
 * ZONE_CHANGE, LAND or DISCARD) that is about the card (its `card`), then one of that kind naming it in its text (a
 * counterspell's line names the spell it counters), else the first entry naming it at all.
 */
export function logPosition(c: Change, fresh: readonly LogEntry[], prev: TableModel | null): number | null {
  const at = (pred: (e: LogEntry) => boolean): number | null => {
    const i = fresh.findIndex(pred);
    return i < 0 ? null : i;
  };
  const naming = (id: number) => (e: LogEntry) => logCards(e).includes(id as never);
  const typed = (id: number, type: RegExp) => (e: LogEntry) => type.test(e.type) && naming(id)(e);
  const own = (id: number, type: RegExp) => (e: LogEntry) => type.test(e.type) && e.card === id;
  switch (c.t) {
    case "popped": {
      const src = c.item.source;
      if (src === null) return null;
      const name = prev?.cards.get(src)?.name ?? "";
      return at((e) => departureIn(e, c.item, name) !== null) ?? at(naming(src));
    }
    case "pushed":
      return c.item.source === null
        ? null
        : (at(own(c.item.source, /^STACK_ADD$/i)) ?? at(typed(c.item.source, /^STACK_ADD$/i)) ?? at(naming(c.item.source)));
    case "moved": {
      const pref = c.to === "stack" ? /^STACK_ADD$/i : c.from === "stack" ? /^STACK_RESOLVE$/i : /^(ZONE_CHANGE|LAND|DISCARD)$/i;
      return at(own(c.card, pref)) ?? at(typed(c.card, pref)) ?? at(naming(c.card));
    }
    case "tapped":
    case "counters":
    case "stats":
    case "attached":
    case "control":
    case "flipped":
    case "attacks":
    case "blocked":
      return at(naming(c.card));
    case "life": {
      const seat = c.seat as string;
      return at((e) => /^LIFE$/i.test(e.type) && e.text.startsWith(`Life: ${seat} `));
    }
    case "turn":
      return at((e) => /^TURN$/i.test(e.type));
    default:
      return null;
  }
}

export interface Placed {
  /** Earliest log position among its changes, or null. */
  readonly pos: number | null;
  /** Lowest inferred rank among its changes. */
  readonly rank: number;
}

/**
 * Moments in order: those the log names by their first entry; each of the rest placed before the first named one that
 * ranks after it (so a stack moment the log does not name still comes before a battlefield one it does). Stable.
 */
export function placeInOrder<T extends Placed>(moments: readonly T[]): T[] {
  const named = moments
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.pos !== null)
    .sort((a, b) => a.m.pos! - b.m.pos! || a.m.rank - b.m.rank || a.i - b.i)
    .map(({ m }) => m);
  const unnamed = moments
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.pos === null)
    .sort((a, b) => a.m.rank - b.m.rank || a.i - b.i)
    .map(({ m }) => m);
  const out = [...named];
  for (const u of unnamed) {
    const at = out.findIndex((m) => m.rank > u.rank);
    out.splice(at < 0 ? out.length : at, 0, u);
  }
  return out;
}
