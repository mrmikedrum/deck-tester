import type { DecisionKey } from "./schema";

interface Keyed {
  readonly kind: string;
  readonly turn: string;
  readonly prompt: string;
  readonly options: readonly string[];
}

/**
 * A decision's identity, exactly as deckmaster/game.py's `key()` computes it (the bridge refuses an answer whose
 * key is not the pending decision's): kind, turn label, prompt, the option count, and the first six labels,
 * joined by "|". Two decisions with the same key are the same to the bridge, so it is a guard, not a unique id.
 * `kind` is the wire kind (an unknown decision's `wireKind`).
 */
export function decisionKey(d: Keyed): DecisionKey {
  return [d.kind, d.turn, d.prompt, String(d.options.length), ...d.options.slice(0, 6)].join("|") as DecisionKey;
}
