// Classifies how a snapshot follows the last one the app took: first, advance, same, newGame, rewind or restart.
import type { LogEntry, Snapshot, View } from "../protocol";
import type { Continuity } from "./types";

const same = (a: LogEntry, b: LogEntry): boolean => a.i === b.i && a.text === b.text;

/** The view cut backwards: an earlier turn, or a log that does not carry on from the last one (live.js `jump`). */
export function rewound(prev: View, next: View): boolean {
  if (next.turn < prev.turn) return true;
  const tail = prev.log[prev.log.length - 1];
  if (!tail || next.log.some((e) => same(e, tail))) return false;
  const first = next.log[0];
  return !first || first.i <= tail.i;
}

export function classify(prev: Snapshot | null, next: Snapshot): Continuity {
  if (!prev) return "first";
  if (next.v < prev.v) return "restart";
  if (next.gen !== prev.gen) return "newGame";
  if (next.v === prev.v) return "same";
  if (prev.view && next.view && rewound(prev.view, next.view)) return "rewind";
  return "advance";
}
