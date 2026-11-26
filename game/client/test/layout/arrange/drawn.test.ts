/// <reference types="node" />
import { underClash } from "../reach";
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

// Steps 6 and 8: every opponent's leaf drawn by the engine. Its seat plan is the engine's (memory and all); every card
// of the seat is in a unit; every unit is reachable: a tap in its place's middle reaches it, as play's hit testing sees
// the table.

const VP = { w: 1180, h: 820 };
const VIEWPORTS = [VP, { w: 1210, h: 834 }, { w: 1366, h: 1024 }, { w: 1024, h: 768 }];
const design = designModels(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")));

function check(model: TableModel, plan: TablePlan, label: string) {
  // every group on the table its own (a leaf's fans and well carry their seat)
  const ids = plan.hits.groups.map((g) => g.id);
  expect(new Set(ids).size, `${label}: unique group ids`).toBe(ids.length);
  const out = [];
  for (const st of model.seats.slice(1)) out.push(...checkSeat(model, plan, st.id, `${label} ${st.id}`));
  return [...out, ...plan.violations.filter((v) => v.seat === null)];
}

function checkSeat(model: TableModel, plan: TablePlan, seat: TableModel["seats"][number]["id"], label: string) {
  const sp = plan.seats.get(seat)!;
  expect(sp.memory.paradigm, label).toBe(ARRANGED);
  const theirs = boards(model).find((b) => b.seat === seat)!.board.cards.map((c) => c.id);
  expect(new Set(sp.home.keys()), label).toEqual(new Set(theirs));
  for (const u of sp.units) {
    if (u.fighting) continue;
    const g = plan.hits.groups.find((x) => x.id === u.id);
    expect(g, `${label} ${u.id} has a hit group`).toBeDefined();
    if (underClash(plan, g!)) continue;
    const b = bounds(g!.quad);
    const hit = hitTest(plan, { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 });
    expect(hit?.id, `${label} ${u.id} is reached in its place`).toBe(u.id);
  }
  return plan.violations.filter((v) => v.seat === seat);
}

describe("every opponent's leaf, drawn by the engine", () => {
  it("the design pass's tables: held, reachable, within the limits, at every supported viewport", () => {
    for (const vp of VIEWPORTS)
      for (const turn of [4, 9, 15]) {
        const m = design.get(turn)!;
        const plan = planTable(tableInputOf(m, { viewport: vp, engine: { draw: true } }));
        expect(check(m, plan, `${vp.w} turn ${turn}`), `${vp.w} turn ${turn}`).toEqual([]);
        expect(plan.part).toBe(0);
      }
  });

  it("the protocol corpus, memory carried from plan to plan", () => {
    let memory: TablePlan["memory"] | null = null;
    for (const n of corpusNames) {
      const snap = corpusSnapshot(n);
      const model = snap.view && modelOf(snap, catalog, viewerOf());
      if (!model || model.seats.length !== 4) continue;
      const plan: TablePlan = planTable(tableInputOf(model, { viewport: VP, memory, engine: { draw: true } }));
      expect(check(model, plan, n), n).toEqual([]);
      memory = plan.memory;
    }
  });
});
