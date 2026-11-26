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
  // every opponent still in the game is laid out; one out of it gives its room back (no seat plan)
  for (const st of model.seats.slice(1))
    if (plan.seats.has(st.id)) out.push(...checkSeat(model, plan, st.id, `${label} ${st.id}`));
    else expect(st.out, `${label} ${st.id} is out`).toBe(true);
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
        const plan = planTable(tableInputOf(m, { viewport: vp, engine: { draw: true, auditPoses: true } }));
        expect(check(m, plan, `${vp.w} turn ${turn}`), `${vp.w} turn ${turn}`).toEqual([]);
        expect(plan.part).toBe(0);
        // each leaf's own audit, at rest and parted at the most
        for (const [seat, l] of plan.leaves!) {
          expect(l.result!.fit.report.violations, `${vp.w} turn ${turn} ${seat}`).toEqual([]);
          // (parted at the most, the design viewport and the iPad's; at 1024x768 the across well's patch reads 40 on turn 9)
          if (vp.w === 1180 || vp.w === 1210) expect(l.result!.fit.report.poses.flatMap((p) => p.violations), `${vp.w} turn ${turn} ${seat} parted`).toEqual([]);
        }
      }
  });

  it("a seat that leaves gives its room back: three, two and one opponents share the table's width", () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as { stages: { turn: number; envelope: { view: { players: { name: string }[] } } }[]; catalog: unknown };
    const without = (turn: number, gone: readonly string[]): TableModel => {
      const st = structuredClone(raw.stages.find((x) => x.turn === turn)!);
      st.envelope.view.players = st.envelope.view.players.filter((p) => !gone.includes(p.name));
      return designModels({ stages: [st], catalog: raw.catalog }).get(turn)!;
    };
    for (const vp of [VP, { w: 1210, h: 834 }])
      for (const gone of [[], ["Dack"], ["Dack", "Marath"]] as const)
        for (const turn of [4, 9, 15]) {
          const m = without(turn, gone), label = `${vp.w} turn ${turn} without ${gone.join("+") || "anyone"}`;
          const plan = planTable(tableInputOf(m, { viewport: vp, engine: { draw: true } }));
          expect(plan.seats.size, label).toBe(4 - gone.length);
          expect(check(m, plan, label), label).toEqual([]);
          // the leaves span what three did: their outer edges where the four-seat table's are
          const frames = [...plan.leaves!.values()].map((l) => l.result!.fit.frame);
          const left = Math.min(...frames.map((f) => f.anchor.x - f.w / 2)), right = Math.max(...frames.map((f) => f.anchor.x + f.w / 2));
          expect(left, label).toBeCloseTo(-12.58, 1);
          expect(right, label).toBeCloseTo(12.58, 1);
          for (const [seat, l] of plan.leaves!) expect(l.result!.fit.report.violations, `${label} ${seat}`).toEqual([]);
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
