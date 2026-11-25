// The shadow plan (§6.1 step 5): `planTable` arranges the across leaf with the engine beside `mat` and records both.
// Nothing the player sees reads it: it is for goldens, the bench and the debug bridge until the across leaf switches.
import type { TableModel } from "../../model";
import { boardOf } from "../board";
import type { Projector } from "../projector";
import type { SeatSlot } from "../template";
import type { CardId, Rect, SeatId } from "../types";
import { arrCard } from "./card";
import type { ArrCard, ArrangeResult, Clock, ContainerMemory } from "./contract";
import { NO_RELATIONS } from "./contract";
import { PARTED, leafContainer } from "./leaf";
import { momentOf } from "./moment";
import type { DecisionFacts, Moment } from "./moment";
import { POLICIES, policyFor } from "./policies/select";
import { arrange } from "./solver";

export interface ShadowInput {
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
}

export interface ShadowPlan {
  readonly seat: SeatId;
  readonly policy: string;
  readonly result: ArrangeResult | null;
  /** The engine threw: recorded, never raised (the shadow must not break the plan the player sees). */
  readonly error: string | null;
}

export interface ShadowOptions {
  readonly decision?: DecisionFacts;
  readonly memory?: ContainerMemory | null;
  readonly policy?: string;
}

/** The across seat's input from the model: its battlefield as `boardOf` draws it, read from current types. */
export function shadowInputOf(model: TableModel, seat: SeatId, involved: ReadonlySet<CardId>, settling: boolean, o: ShadowOptions): ShadowInput {
  const cards = boardOf(model, seat).cards.map((c) => arrCard(model, c.id)).filter((c): c is ArrCard => c !== null);
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
  };
}

export function shadowPlan(s: ShadowInput, slot: SeatSlot, projector: Projector, safe: Rect): ShadowPlan {
  const forced = s.policy !== undefined ? POLICIES.get(s.policy) : undefined;
  const chosen = forced ? { policy: forced, selection: undefined } : policyFor(s.cards, s.memory, s.clock);
  try {
    const container = leafContainer({ id: `rest:${s.seat}`, seat: s.seat, viewer: s.viewer, slot, projector, safe, poses: [PARTED] });
    const here = new Set(s.cards.map((c) => c.id));
    const result = arrange({
      container,
      cards: s.cards,
      relations: NO_RELATIONS,
      acting: { involved: new Set([...s.involved].filter((id) => here.has(id))), offered: s.offered, usable: new Set(), choosing: s.choosing },
      moment: s.moment,
      policy: chosen.policy,
      ...(chosen.selection ? { selection: chosen.selection } : {}),
      memory: s.memory,
      clock: s.clock,
    });
    return { seat: s.seat, policy: result.fit.policy, result, error: null };
  } catch (e) {
    return { seat: s.seat, policy: chosen.policy.id, result: null, error: e instanceof Error ? e.message : String(e) };
  }
}
