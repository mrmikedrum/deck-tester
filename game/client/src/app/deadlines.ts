// Deadlines: every timer as data in app state. The loop fires those due by the frame's time, in time order; one set
// during a fold fires in a later frame even if already due; a cancellation takes effect at once (a fired deadline is
// checked against the serial it was set with).
import type { Ms } from "../platform";
import type { DeadlineId } from "./ids";

export interface Deadline {
  readonly due: Ms;
  readonly serial: number;
}

export interface Deadlines {
  readonly items: ReadonlyMap<DeadlineId, Deadline>;
  readonly serial: number;
}

export const NO_DEADLINES: Deadlines = { items: new Map(), serial: 0 };

/** Sets (or moves) a deadline. */
export function setDeadline(ds: Deadlines, id: DeadlineId, due: Ms): Deadlines {
  const serial = ds.serial + 1;
  return { items: new Map(ds.items).set(id, { due, serial }), serial };
}

export function cancelDeadline(ds: Deadlines, id: DeadlineId): Deadlines {
  if (!ds.items.has(id)) return ds;
  const items = new Map(ds.items);
  items.delete(id);
  return { items, serial: ds.serial };
}

/** Cancels every deadline of an owner ("play/"), or all of them; with `which`, only those it picks. */
export function cancelOwned(ds: Deadlines, prefix: string, which: (id: DeadlineId) => boolean = () => true): Deadlines {
  const items = new Map([...ds.items].filter(([id]) => !(id.startsWith(prefix) && which(id))));
  return items.size === ds.items.size ? ds : { items, serial: ds.serial };
}

/** Those due by `now`, earliest first (ties by id, so the order never depends on insertion). */
export function dueBy(ds: Deadlines, now: Ms): { id: DeadlineId; due: Ms; serial: number }[] {
  return [...ds.items]
    .filter(([, d]) => d.due <= now)
    .map(([id, d]) => ({ id, due: d.due, serial: d.serial }))
    .sort((a, b) => a.due - b.due || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function earliest(ds: Deadlines): Ms | null {
  let at: Ms | null = null;
  for (const d of ds.items.values()) if (at === null || d.due < at) at = d.due;
  return at;
}

/** Whether a fired deadline is still the one set (not cancelled or moved since). */
export const isLive = (ds: Deadlines, id: DeadlineId, serial: number): boolean => ds.items.get(id)?.serial === serial;
