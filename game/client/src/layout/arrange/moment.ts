// The moment: what the table should answer now (carried over from the by-relevance exploration's `Question`). It
// changes light and attention only, never places, postures or units (§2.3): `arrange` reads it for `emphasis`, `lit`
// and `answers` attention, after everything is placed.
//
// A sliver of rules sits here: "ready" and the flier narrowing read tapped, summoning sick, Defender, Haste, Flying and
// Reach. They light cards; they never decide what may be chosen (the engine's options do that).
import { entryText, sweepHarms, sweeps } from "../../model";
import type { TableModel } from "../../model";
import type { CardId, SeatId } from "../types";
import type { ArrCard, Emphasis } from "./contract";
import { blocksFliers, ready } from "./policies/kinds";

/**
 * `rest`: nothing in particular. `threat`: what can seat X hit me with (its turn, before attackers). `strike`: what can
 * block my attack (`airborne` once every attacker I picked flies). `fight`: who is hitting whom. `aim`: what can this
 * point at (the engine's legal targets). `stack`: a spell aimed at something (the cards it aims at). `sweep`: what a spell on the stack takes.
 */
export type Moment =
  | { readonly q: "rest" }
  | { readonly q: "threat"; readonly seat: SeatId }
  | { readonly q: "strike"; readonly draft: readonly CardId[]; readonly airborne: boolean; readonly options: readonly CardId[] }
  | {
      readonly q: "fight";
      readonly attacker: SeatId;
      readonly attackers: readonly CardId[];
      readonly blocked: readonly CardId[];
      readonly blockers: readonly CardId[];
    }
  | { readonly q: "aim"; readonly legal: readonly CardId[] }
  | { readonly q: "stack"; readonly aimed: readonly CardId[] }
  | { readonly q: "sweep"; readonly reaches: readonly CardId[]; readonly caster: SeatId | null };

export const REST: Moment = { q: "rest" };

/** The decision in hand, as plain facts (play's types never reach layout). */
export interface DecisionFacts {
  readonly kind: string | null;
  readonly options: readonly CardId[];
  /** My attack draft's attackers. */
  readonly draft: readonly CardId[];
}

export const NO_DECISION: DecisionFacts = { kind: null, options: [], draft: [] };

/** Forge's phases from a turn's start until attackers are declared. */
const PRE_ATTACK = /^(UNTAP|UPKEEP|DRAW|MAIN1|COMBAT_BEGIN|COMBAT_DECLARE_ATTACKERS)$/;

/** The moment, from the model and the decision in hand: one at a time, the most pressing first. */
export function momentOf(model: TableModel, d: DecisionFacts = NO_DECISION): Moment {
  const me = model.viewer.perspective;
  const top = model.stack[model.stack.length - 1];
  if (top && sweepHarms(entryText(top, model), top.controller) !== null) {
    const reaches = [...model.cards.values()].filter((c) => c.zone === "battlefield" && sweeps(top, model, c)).map((c) => c.id);
    if (reaches.length) return { q: "sweep", reaches, caster: top.controller };
  }
  if (d.kind === "targets" && d.options.length) return { q: "aim", legal: d.options };
  if (top && top.targets.length) return { q: "stack", aimed: top.targets.flatMap((t) => ("card" in t ? [t.card] : [])) };
  if (d.kind === "attack") {
    const airborne = d.draft.length > 0 && d.draft.every((id) => model.cards.get(id)?.keywords.some((k) => k.toLowerCase() === "flying"));
    return { q: "strike", draft: d.draft, airborne, options: d.options };
  }
  const c = model.combat;
  if (c && c.attackers.length) {
    const attacker = model.cards.get(c.attackers[0]!.attacker)?.controller ?? model.active;
    if (attacker)
      return {
        q: "fight",
        attacker,
        attackers: c.attackers.map((a) => a.attacker),
        blocked: c.blockers.map((b) => b.attacker),
        blockers: d.kind === "block" ? d.options : [],
      };
  }
  if (model.active && model.active !== me && PRE_ATTACK.test(String(model.phase).toUpperCase())) return { q: "threat", seat: model.active };
  return REST;
}

/** Equal moments, equal keys. */
export function momentKey(m: Moment): string {
  switch (m.q) {
    case "rest":
      return m.q;
    case "stack":
      return `stack:${m.aimed.join(",")}`;
    case "threat":
      return `threat:${m.seat}`;
    case "strike":
      return `strike:${m.airborne ? "air" : ""}:${m.draft.join(",")}:${m.options.join(",")}`;
    case "fight":
      return `fight:${m.attacker}:${m.attackers.join(",")}:${m.blocked.join(",")}:${m.blockers.join(",")}`;
    case "aim":
      return `aim:${m.legal.join(",")}`;
    case "sweep":
      return `sweep:${m.reaches.join(",")}`;
  }
}

/**
 * How one card on `seat` answers the moment: null where it takes no part. Light only: forward pools light under it,
 * down puts its light out, ease is neither.
 */
export function stanceOf(c: ArrCard, seat: SeatId, mine: boolean, m: Moment): Emphasis | null {
  switch (m.q) {
    case "rest":
      return null;
    case "stack":
      return m.aimed.includes(c.id) ? "forward" : null;
    case "threat":
      if (seat !== m.seat || !c.types.creature) return null;
      return ready(c) ? "forward" : "down";
    case "strike":
      if (!c.types.creature) return null;
      if (mine) return m.options.includes(c.id) || m.draft.includes(c.id) ? "forward" : "down";
      return !c.tapped && (!m.airborne || blocksFliers(c)) ? "forward" : "down";
    case "fight":
      if (!c.types.creature) return null;
      if (seat === m.attacker) return m.attackers.includes(c.id) ? "forward" : "down";
      return m.blockers.includes(c.id) ? "forward" : m.blockers.length ? "down" : null;
    case "aim":
      return m.legal.includes(c.id) ? "forward" : null;
    case "sweep":
      return m.reaches.includes(c.id) ? "forward" : null;
  }
}
