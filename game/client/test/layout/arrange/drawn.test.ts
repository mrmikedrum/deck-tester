/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boards, hitTest, planTable, tableInputOf } from "../../../src/layout";
import type { TablePlan } from "../../../src/layout";
import { bounds } from "../../../src/layout/shape";
import { ARRANGED } from "../../../src/layout/arrange/adapter";
import type { TableModel } from "../../../src/model";
import { modelOf } from "../../../src/model";
import { designModels } from "../../../src/scene/workbench/bench-inputs";
import { catalog, corpusNames, corpusSnapshot, viewerOf } from "../../model/fixtures";

// Step 6: the across leaf drawn by the engine. Its seat plan is the engine's (memory and all); every card of the seat is
// in a unit; every unit is reachable: a tap in its place's middle reaches it, as play's hit testing sees the table.

const VP = { w: 1180, h: 820 };
const design = designModels(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")));

function check(model: TableModel, plan: TablePlan, label: string) {
  const seat = model.seats[2]!.id, sp = plan.seats.get(seat)!;
  expect(sp.memory.paradigm, label).toBe(ARRANGED);
  const theirs = boards(model).find((b) => b.seat === seat)!.board.cards.map((c) => c.id);
  expect(new Set(sp.home.keys()), label).toEqual(new Set(theirs));
  for (const u of sp.units) {
    if (u.fighting) continue;
    const g = plan.hits.groups.find((x) => x.id === u.id);
    expect(g, `${label} ${u.id} has a hit group`).toBeDefined();
    const b = bounds(g!.quad);
    const hit = hitTest(plan, { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 });
    expect(hit?.id, `${label} ${u.id} is reached in its place`).toBe(u.id);
  }
  return plan.violations.filter((v) => v.seat === seat);
}

describe("the across leaf, drawn by the engine", () => {
  it("the design pass's tables: held, reachable, within the limits", () => {
    for (const turn of [4, 9, 15]) {
      const m = design.get(turn)!;
      const plan = planTable(tableInputOf(m, { viewport: VP, shadow: { draw: true } }));
      expect(check(m, plan, `turn ${turn}`), `turn ${turn}`).toEqual([]);
    }
  });

  it("the protocol corpus, memory carried from plan to plan", () => {
    let memory: TablePlan["memory"] | null = null;
    for (const n of corpusNames) {
      const snap = corpusSnapshot(n);
      const model = snap.view && modelOf(snap, catalog, viewerOf());
      if (!model || model.seats.length !== 4) continue;
      const plan: TablePlan = planTable(tableInputOf(model, { viewport: VP, memory, shadow: { draw: true } }));
      expect(check(model, plan, n), n).toEqual([]);
      memory = plan.memory;
    }
  });
});
