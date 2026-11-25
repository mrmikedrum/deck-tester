// Causality: the one table that orders what a change set moves (docs "Ordering is one table"). Phase 0 the stack acts
// (a spell cast flies onto it, a spell resolves or is countered, an ability is done), phase 1 battlefield departures
// (and cards leaving piles), phase 2 the reflow and what joins the table. Within a phase, cohorts (cards bound for the
// same place) set off one after another so each can be followed into it. Pure: plans in, times out.
import { DURATION, PATH, PHASE, STAGGER, paced, staggered } from "./motion";
import type { Pace } from "./motion";
import type { FlightPlan, Phase, Scheduled } from "./types";

type Unordered = Omit<FlightPlan, "phase" | "cohort" | "rank">;

interface Row {
  readonly when: (f: Unordered) => boolean;
  readonly phase: Phase;
  readonly cohort: (f: Unordered) => string;
  /** Why it is ordered so (the reason is the rule). */
  readonly why: string;
}

const destKey = (f: Unordered): string =>
  f.dest.to === "pile" || f.dest.to === "piece" ? f.dest.piece : f.dest.to === "hand" ? "hand" : `nowhere:${f.dest.seat ?? ""}`;
const fromStack = (f: Unordered): boolean => f.origin.from === "piece" && f.origin.piece.startsWith("stack:");

/** First row that reads a flight orders it. */
export const ORDER: readonly Row[] = [
  {
    when: (f) => f.motion === "cast",
    phase: 0,
    cohort: () => "stack",
    why: "A spell cast is the cause of all that follows: it flies onto the stack first.",
  },
  {
    when: (f) => f.motion === "fizzle" || f.motion === "withdraw" || fromStack(f),
    phase: 0,
    cohort: (f) => `to:${destKey(f)}`,
    why: "The stack acts before the table answers: a spell resolves or is countered, an ability is done.",
  },
  {
    when: (f) => f.departure,
    phase: 1,
    cohort: (f) => `to:${destKey(f)}`,
    why: "What leaves the battlefield (or a pile) follows what the stack did; each trip to one pile is its own cohort.",
  },
  {
    when: (f) => f.dest.to === "pile",
    phase: 1,
    cohort: (f) => `to:${destKey(f)}`,
    why: "A card put into a pile from out of sight (milled, discarded) arrives with the departures.",
  },
  {
    when: () => true,
    phase: 2,
    cohort: () => "joins",
    why: "What joins the table (a token, a land played, a permanent from out of sight) comes in with the reflow, one queue.",
  },
];

/** A flight's phase and cohort, from the table. */
export function order(f: Unordered): { phase: Phase; cohort: string } {
  const row = ORDER.find((r) => r.when(f))!;
  return { phase: row.phase, cohort: row.cohort(f) };
}

export interface Timeline {
  /** Offsets from the set's start, ms. */
  readonly flights: readonly Scheduled[];
  /** When phase 1 and phase 2 begin. */
  readonly p1: number;
  readonly p2: number;
  /** When the pieces at rest retarget: phase 2, or at once when a spell resolves onto the table (it needs its room). */
  readonly reflow: number;
  /** When everything this set moves has landed. */
  readonly end: number;
}

/** How long a flight takes, and how long it lifts off first, under a pace. */
function durationOf(f: FlightPlan, pace: Pace, pileLift: boolean, big: boolean): { dur: number; lift: number } {
  const p = (ms: number) => paced(ms, pace);
  switch (f.motion) {
    case "cast":
      return { dur: p(DURATION.move), lift: 0 };
    case "spell":
      return { dur: p(big ? DURATION.bigSpell : DURATION.spell), lift: 0 };
    case "burn":
      return { dur: p(DURATION.burnWait + DURATION.burn), lift: 0 };
    case "fizzle":
      return { dur: p(Math.max(DURATION.minFlight, DURATION.move)), lift: 0 };
    case "withdraw":
      return { dur: p(DURATION.withdraw), lift: 0 };
    case "join":
      return { dur: p(DURATION.join), lift: 0 };
    case "depart":
    case "return": {
      const lift = p(pileLift ? DURATION.pileLift : DURATION.lift);
      return { dur: lift + p(Math.max(DURATION.minFlight, DURATION.move)), lift };
    }
  }
}

export interface ScheduleInput {
  readonly flight: FlightPlan;
  /** It leaves a pile of more than one card (it rises clear of it first). */
  readonly pileLift: boolean;
  /** A spell far larger than where it goes (it sheds its size over a longer way). */
  readonly big: boolean;
  /** It comes out of an ability (joins wait for the ability to draw in). */
  readonly afterAbility: boolean;
}

/**
 * Times for a change set's flights. Phase 0 starts at once; phase 1 when phase 0 has landed (never later than
 * `PHASE.afterStackMax`); phase 2 (the reflow and the joins) once the last departure has cleared its page. In a cohort
 * the nearest to where they go leaves first, `min(140, 700/n)` apart; the card a whole pile shows goes last of its pile
 * (`rank`), so the pile never shows a face that has already left. Joins are one queue, `min(240, 900/total)` apart, the
 * pile gaining fewest first.
 */
export function schedule(inputs: readonly ScheduleInput[], pace: Pace): Timeline {
  const out: Scheduled[] = [];
  const timed = inputs.map((i) => ({ i, ...durationOf(i.flight, pace, i.pileLift, i.big) }));
  const phase = (p: Phase) => timed.filter((t) => t.i.flight.phase === p);

  // Phase 0: together.
  const p0 = phase(0);
  for (const t of p0) out.push({ ...t.i.flight, start: 0, dur: t.dur, lift: t.lift });
  const end0 = Math.max(0, ...p0.map((t) => t.dur));
  const p1 = p0.length ? Math.min(end0, paced(PHASE.afterStackMax, pace)) : 0;

  // Phase 1: cohorts, nearest first, a pile's shown face last.
  let lastLeave = p1;
  const cohorts = new Map<string, typeof timed>();
  for (const t of phase(1)) {
    const list = cohorts.get(t.i.flight.cohort);
    if (list) list.push(t);
    else cohorts.set(t.i.flight.cohort, [t]);
  }
  for (const list of cohorts.values()) {
    const step = staggered(Math.min(STAGGER.tripStep, STAGGER.tripSpan / list.length), pace);
    list
      .slice()
      .sort((a, b) => a.i.flight.rank - b.i.flight.rank || a.i.flight.distance - b.i.flight.distance || (a.i.flight.key < b.i.flight.key ? -1 : 1))
      .forEach((t, n) => {
        const start = p1 + n * step;
        out.push({ ...t.i.flight, start, dur: t.dur, lift: t.lift });
        lastLeave = Math.max(lastLeave, start + t.lift);
      });
  }
  const p2 = cohorts.size ? lastLeave : p1;

  // Phase 2: one queue of joins.
  const joins = phase(2)
    .slice()
    .sort((a, b) => a.i.flight.rank - b.i.flight.rank || (a.i.flight.key < b.i.flight.key ? -1 : 1));
  const each = joins.length ? staggered(Math.min(STAGGER.joinStep, STAGGER.joinSpan / joins.length), pace) : 0;
  joins.forEach((t, n) => {
    const wait = t.i.afterAbility ? paced(DURATION.joinAfterAbility, pace) : 0;
    out.push({ ...t.i.flight, start: p2 + wait + n * each, dur: t.dur, lift: t.lift });
  });

  // A spell resolving into a permanent lands where the board makes room for it: the board moves with it, not after.
  const room = p0.some((t) => t.i.flight.dest.to === "piece" && !/^(stack|plate):/.test(t.i.flight.dest.piece));
  const reflow = room ? 0 : p2;
  const end = Math.max(reflow + paced(DURATION.move, pace), ...out.map((f) => f.start + f.dur));
  return { flights: out, p1, p2, reflow, end };
}

/** A spell is "big" when it stood far larger than where it is going. */
export const isBig = (fromScale: number, toScale: number): boolean => fromScale > PATH.bigRatio * toScale;
