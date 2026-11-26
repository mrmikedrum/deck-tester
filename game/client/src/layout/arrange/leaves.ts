// The opponents' leaves on the engine (§6.1 step 5, §6.2 step 8): `planTable` arranges every opponent's leaf with the
// arrangement engine. Drawn (`draw`), each leaf is its seat's plan (adapter.ts); otherwise it is only recorded beside
// `mat`'s plan of the same seat, for goldens and the bench.
import type { TableModel } from "../../model";
import { boardOf } from "../board";
import type { SeatBoard } from "../board";
import type { Projector } from "../projector";
import type { LeafGeometry, Parting, SeatSlot } from "../template";
import type { CardId, Rect, SeatId } from "../types";
import { arrCard } from "./card";
import type { ArrCard, ArrangeInput, ArrangeResult, Clock, ContainerMemory } from "./contract";
import { NO_RELATIONS } from "./contract";
import { leafContainer, partedPose } from "./leaf";
import { momentOf } from "./moment";
import type { DecisionFacts, Moment } from "./moment";
import { POLICIES, policyFor } from "./policies/select";
import { arrange } from "./solver";

/** One opponent's leaf, as the engine is given it. */
export interface LeafInput {
  readonly seat: SeatId;
  readonly viewer: SeatId;
  readonly cards: readonly ArrCard[];
  readonly involved: ReadonlySet<CardId>;
  readonly offered: ReadonlySet<CardId>;
  readonly choosing: boolean;
  readonly moment: Moment;
  readonly clock: Clock;
  readonly memory: ContainerMemory | null;
  /** Force a policy (a debug switch); else the seat's choice from its battlefield. */
  readonly policy?: string;
  /** Report the leaf's audit under the parting at its most too (goldens, the bench): it only reports. */
  readonly auditPoses?: boolean;
}

/** The opponents' leaves for `planTable`: every one arranged, and drawn as its seat's plan when `draw`. */
export interface EngineInput {
  readonly leaves: readonly LeafInput[];
  readonly draw: boolean;
}

export interface LeafPlan {
  readonly seat: SeatId;
  readonly policy: string;
  /** At rest (the parting, when the table parts, is drawn from it: `posed`). */
  readonly result: ArrangeResult | null;
  /** What `arrange` was given, so a pose can draw the same arrangement again. */
  readonly input: ArrangeInput | null;
  /** The engine threw: recorded, never raised (a leaf must not break the plan the player sees). */
  readonly error: string | null;
}

export interface EngineOptions {
  readonly decision?: DecisionFacts;
  /** Each leaf's memory (absent: what the layout memory carries for its seat). */
  readonly memory?: ReadonlyMap<SeatId, ContainerMemory | null>;
  readonly policy?: string;
  readonly auditPoses?: boolean;
  /** Draw the leaves (each the seat's plan), not only record them. */
  readonly draw?: boolean;
}

/** A seat's leaf input from the model: its battlefield as `boardOf` draws it, read from current types. */
export function leafInputOf(model: TableModel, seat: SeatId, involved: ReadonlySet<CardId>, settling: boolean, o: Omit<EngineOptions, "memory"> & { readonly memory?: ContainerMemory | null }, board: SeatBoard = boardOf(model, seat)): LeafInput {
  const cards = board.cards.map((c) => arrCard(model, c.id)).filter((c): c is ArrCard => c !== null);
  const decision = o.decision ?? { kind: null, options: [], draft: [] };
  return {
    seat,
    viewer: model.viewer.perspective,
    cards,
    involved,
    offered: new Set(decision.options),
    choosing: decision.kind !== null,
    moment: momentOf(model, decision),
    clock: { turn: model.turn, phase: model.phase, active: model.active, settling },
    memory: o.memory ?? null,
    ...(o.policy !== undefined ? { policy: o.policy } : {}),
    ...(o.auditPoses ? { auditPoses: true } : {}),
  };
}

/** A leaf arranged at rest in its slot, its rows laid to hold under the template's parting at its most. */
export function planLeaf(s: LeafInput, slot: SeatSlot, leaf: LeafGeometry, part: Parting, projector: Projector, safe: Rect): LeafPlan {
  const forced = s.policy !== undefined ? POLICIES.get(s.policy) : undefined;
  const chosen = forced ? { policy: forced, selection: undefined } : policyFor(s.cards, s.memory, s.clock);
  try {
    const container = leafContainer({ id: `rest:${s.seat}`, seat: s.seat, viewer: s.viewer, slot, leaf, projector, safe, poses: [partedPose(part)] });
    const here = new Set(s.cards.map((c) => c.id));
    const input: ArrangeInput = {
      container,
      cards: s.cards,
      relations: NO_RELATIONS,
      acting: { involved: new Set([...s.involved].filter((id) => here.has(id))), offered: s.offered, usable: new Set(), choosing: s.choosing },
      moment: s.moment,
      policy: chosen.policy,
      ...(chosen.selection ? { selection: chosen.selection } : {}),
      memory: s.memory,
      clock: s.clock,
      ...(s.auditPoses ? { auditPoses: true } : {}),
    };
    const result = arrange(input);
    return { seat: s.seat, policy: result.fit.policy, result, input, error: null };
  } catch (e) {
    return { seat: s.seat, policy: chosen.policy.id, result: null, input: null, error: e instanceof Error ? e.message : String(e) };
  }
}
