import type { Decision } from "./decode";
import type { DecisionId, DecisionKey } from "./schema";

/**
 * An answer: 1-based option numbers in the order meant (for `number`, the one value), or handing the decision to
 * Forge's AI. Options are positions, not refs; the decision's id is what keeps them pointing at the decision they
 * were for (the engine refuses them once it has moved on).
 */
export type Answer = { readonly answer: readonly number[] } | { readonly defer: true };

/**
 * The POST /api/answer body: the id is the guard, `gen` names the game (ids restart with each engine session, so the
 * next game's first decision can share the last one's id and key); the key is checked too, as for the old client,
 * which sends neither id nor gen. `gen` is left out only for a decision from an envelope without one.
 */
export type AnswerRequest = { readonly id: DecisionId; readonly gen?: number; readonly key: DecisionKey } & Answer;

export function answerRequest(decision: Decision, answer: Answer): AnswerRequest {
  const { id, gen, key } = decision;
  return gen === null ? { id, key, ...answer } : { id, gen, key, ...answer };
}

/** Null when the picks fit the decision, otherwise why not: the engine's own check (Decision.check), word for word. */
export function answerProblem(d: Decision, picks: readonly number[]): string | null {
  if (d.options.length === 0) {
    const [value] = picks;
    return picks.length !== 1 || value === undefined || !Number.isInteger(value) || value < d.min || value > d.max
      ? `answer one number from ${d.min} to ${d.max}`
      : null;
  }
  if (picks.length < d.min || picks.length > d.max)
    return d.min === d.max ? `pick exactly ${d.min}` : `pick ${d.min} to ${d.max}`;
  if (picks.some((p) => !Number.isInteger(p) || p < 1 || p > d.options.length))
    return `options are 1 to ${d.options.length}`;
  if (!d.repeat && new Set(picks).size !== picks.length) return "each option at most once";
  return null;
}
