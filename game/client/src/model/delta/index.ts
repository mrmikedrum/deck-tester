// diff(prev, next, seq): the change set from one accepted model to the next, in order, grouped into moments.
// See docs/game-client-architecture.md ("The delta").
import type { SeatId } from "../ids";
import type { TableModel } from "../table";
import { changesBetween, freshLog, jumped, seatsOfChange, wentBack } from "./changes";
import type { Change } from "./changes";
import { claimAll } from "./moments";
import type { Cause, MomentDetail, MomentKind, ReadingId } from "./moments";
import { logPosition, ordersMotion, placeInOrder, rank } from "./order";
import { resolutionsOf } from "./resolutions";

export interface Moment {
  readonly kind: MomentKind;
  readonly reading: ReadingId;
  /** Indexes into the change set's `changes`, in order: consecutive, and every change is in exactly one moment. */
  readonly changes: readonly number[];
  readonly cause: Cause | null;
  readonly detail: MomentDetail | null;
  readonly seats: readonly SeatId[];
}

export interface ChangeSet {
  /** Monotonic per epoch, assigned by the app (diff takes it); the scene reports the last it took. */
  readonly seq: number;
  /** The model it leads to (a hash can repeat; seq cannot). */
  readonly rev: string;
  /** Atomic, in order: the moments' changes, one moment after another. */
  readonly changes: readonly Change[];
  readonly moments: readonly Moment[];
  /** "log" when the engine's log placed every moment that moves something; "inferred" when any was placed by rank. */
  readonly order: "log" | "inferred";
  readonly involved: ReadonlySet<SeatId>;
}

function resetSet(
  seq: number,
  next: TableModel,
  why: "first" | "game" | "jump",
  prev: TableModel | null = null,
): ChangeSet {
  const back = prev && why === "jump" ? wentBack(prev, next) : null;
  const reset: Change = back ? { t: "reset", why, back } : { t: "reset", why };
  return {
    seq,
    rev: next.rev,
    changes: [reset],
    moments: [{ kind: "other", reading: "reset", changes: [0], cause: null, detail: null, seats: [] }],
    order: "log",
    involved: new Set(next.seats.map((s) => s.id)),
  };
}

/**
 * The change set from `prev` to `next`. A first model, a new game (`gen`) or a view that does not carry on from the
 * last (live.js `jump`) is a single `reset`: the scene cuts.
 */
export function diff(prev: TableModel | null, next: TableModel, seq: number): ChangeSet {
  if (!prev) return resetSet(seq, next, "first");
  if (prev.gen !== next.gen) return resetSet(seq, next, "game");
  if (jumped(prev, next)) return resetSet(seq, next, "jump", prev);

  const fresh = freshLog(prev, next);
  const raw = changesBetween(prev, next, fresh);
  const pos = raw.map((c) => logPosition(c, fresh, prev));
  const claims = claimAll({ prev, next, changes: raw, fresh, resolutions: resolutionsOf(prev, next, raw, fresh) });

  const placed = placeInOrder(
    claims.map((c) => {
      const known = c.changes.map((i) => pos[i]).filter((p): p is number => p != null);
      return { claim: c, pos: known.length ? Math.min(...known) : null, rank: Math.min(...c.changes.map((i) => rank(raw[i]!))) };
    }),
  );

  const changes: Change[] = [];
  const moments: Moment[] = placed.map(({ claim, pos: at }) => {
    const inner = [...claim.changes].sort((a, b) => (pos[a] ?? at ?? Infinity) - (pos[b] ?? at ?? Infinity) || rank(raw[a]!) - rank(raw[b]!) || a - b);
    const first = changes.length;
    inner.forEach((i) => changes.push(raw[i]!));
    const seats = [...new Set(inner.flatMap((i) => seatsOfChange(raw[i]!, prev, next)))];
    return { kind: claim.kind, reading: claim.reading, changes: inner.map((_, k) => first + k), cause: claim.cause, detail: claim.detail, seats };
  });

  const unplaced = placed.some(({ claim, pos: at }) => at === null && claim.changes.some((i) => ordersMotion(raw[i]!)));
  return {
    seq,
    rev: next.rev,
    changes,
    moments,
    order: placed.length > 1 && unplaced ? "inferred" : "log",
    involved: new Set(moments.flatMap((m) => m.seats)),
  };
}
