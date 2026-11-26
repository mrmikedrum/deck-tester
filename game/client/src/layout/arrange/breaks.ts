// Where rows break: a stage after ordering. Whatever orders a band's units (the heuristic policies now, a trained model
// later) hands its sequence here, and these rules say which units start a row of their own, by what their cards are on
// current types. Within a row the order is the orderer's; the rules only split the sequence into runs, each class in the
// order it first appears. A break is taken only where the space has a row for it: the solver packs the runs a row each
// when they fit so, and the unbroken sequence otherwise.
import type { ArrCard } from "./contract";
import { kindOf } from "./policies/kinds";

/** What a unit is, for the break rules. */
export type RowClass = "land" | "other";

/** A non-creature land: an animated land is a creature, and stands with them. */
export const isLand = (c: ArrCard): boolean => c.types.land && !c.types.creature;

/**
 * A unit's class: land when it holds a non-creature land and nothing but mana (an opponent's well of lands may hold a
 * rock or two: it is still their lands).
 */
export const rowClassOf = (cards: readonly ArrCard[]): RowClass => (cards.some(isLand) && cards.every((c) => isLand(c) || kindOf(c) === "mana") ? "land" : "other");

/** A rule: whether two classes may share a row while the space has a row for each. */
export interface BreakRule {
  readonly id: string;
  readonly apart: (a: RowClass, b: RowClass) => boolean;
}

/** The rules in force. Non-creature lands lie on a row of their own wherever the space has one for them. */
export const BREAK_RULES: readonly BreakRule[] = [{ id: "lands-alone", apart: (a, b) => (a === "land") !== (b === "land") }];

/** Whether a unit of class `a` may share a row with one of class `b` under `rules`. */
export const mayShare = (a: RowClass, b: RowClass, rules: readonly BreakRule[] = BREAK_RULES): boolean => !rules.some((r) => r.apart(a, b));

/**
 * The runs an ordered sequence breaks into: units that may share a row together, each run in the order its first unit
 * appears, each unit's place within its run the orderer's. One run when nothing breaks.
 */
export function runsOf<T>(units: readonly T[], classOf: (x: T) => RowClass, rules: readonly BreakRule[] = BREAK_RULES): T[][] {
  const runs: { cls: RowClass; units: T[] }[] = [];
  for (const x of units) {
    const cls = classOf(x);
    const run = runs.find((r) => mayShare(r.cls, cls, rules) && r.units.every((y) => mayShare(classOf(y), cls, rules)));
    if (run) run.units.push(x);
    else runs.push({ cls, units: [x] });
  }
  return runs.map((r) => r.units);
}
