// The protocol corpus as scene frames: consecutive envelopes of each run → modelOf → change sets (diff) → table plans,
// with empty cues and no focus, as the app would hand them to the scene.
import { planTable, tableInputOf } from "../../src/layout";
import type { TablePlan } from "../../src/layout";
import { diff, modelOf } from "../../src/model";
import type { ChangeSet, TableModel } from "../../src/model";
import type { BoardCues } from "../../src/play";
import { NO_FOCUS } from "../../src/scene/stage";
import type { SceneFrame } from "../../src/scene/stage";
import { catalog, corpusRuns, corpusSnapshot, viewerOf } from "../model/fixtures";

const VIEWPORT = { w: 1180, h: 820 } as const;

export const NO_CUES: BoardCues = {
  stop: null,
  marks: { cards: new Map(), seats: new Map(), hand: new Set() },
  combat: null,
  handAway: false,
};

export interface Step {
  readonly name: string;
  readonly model: TableModel;
  readonly plan: TablePlan;
  readonly set: ChangeSet;
}

/** A model's plan, keeping the places the last plan kept (as the app feeds its layout memory back). */
function planOf(model: TableModel, last: TablePlan | null): TablePlan {
  return planTable(tableInputOf(model, { viewport: VIEWPORT, memory: last?.memory ?? null }));
}

/** Envelopes layout cannot plan yet (planTable throws), with why: skipped by the scene's tests, reported. */
export const unplanned: { name: string; error: string }[] = [];

/**
 * Every run of the corpus as steps: each envelope with a view, its plan, and the change set from the one before. An
 * envelope layout cannot plan is skipped (the next one's change set is from the last that could be).
 */
export function corpusSteps(): Step[][] {
  let seq = 0;
  return corpusRuns()
    .map((run) => {
      const out: Step[] = [];
      let prev: TableModel | null = null;
      let last: TablePlan | null = null;
      for (const name of run) {
        const model = modelOf(corpusSnapshot(name), catalog, viewerOf());
        if (!model) continue;
        let plan: TablePlan;
        try {
          plan = planOf(model, last);
        } catch (e) {
          unplanned.push({ name, error: String(e) });
          continue;
        }
        out.push({ name, model, plan, set: diff(prev, model, ++seq) });
        prev = model;
        last = plan;
      }
      return out;
    })
    .filter((r) => r.length);
}

export function frameOf(step: Step, changes: readonly ChangeSet[], over: Partial<SceneFrame> = {}): SceneFrame {
  return {
    model: step.model,
    plan: step.plan,
    changes,
    mode: "animate",
    cues: NO_CUES,
    focus: NO_FOCUS,
    moments: [],
    hover: null,
    commit: step.set.seq,
    ...over,
  };
}
