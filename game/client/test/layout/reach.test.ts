// Every option-bearing group is reachable through the production picker (`hitTest`, what the scene's `pick` calls), or
// is routed to a fallback: a pile or summary opens a sift of its cards; a stack entry that is not `reachable` has no hit
// group, so play offers it in a sheet. Over the protocol corpus and stress boards (30 stack entries, 40 permanents a
// seat, cards acting), at the supported viewports, planned as the app plans them.
import { describe, expect, it } from "vitest";
import { TAP_PX } from "../../src/layout/board";
import { planTable, tableInputOf } from "../../src/layout";
import type { TablePlan } from "../../src/layout";
import { modelOf } from "../../src/model";
import { catalog, corpusNames, corpusSnapshot, viewerOf } from "../model/fixtures";
import { stress, SUPPORTED } from "./boards";
import { reach, underClash } from "./reach";

/** What the picker cannot reach, or reaches with less than a 44 px patch (a plate needs only a point). */
function shortfalls(plan: TablePlan): string[] {
  const r = reach(plan), out: string[] = [];
  for (const g of plan.hits.groups) {
    if (underClash(plan, g)) continue;
    const side = r.get(g.id)!.side, need = g.kind === "plate" ? 1 : TAP_PX;
    if (side < need) out.push(`${g.id} ${side}px`);
  }
  return out;
}

function routed(plan: TablePlan): void {
  const ids = new Set(plan.hits.groups.map((g) => g.id));
  // every permanent is in a group a tap can reach (a pile or summary opens a sift of it)
  for (const sp of plan.seats.values()) for (const unit of new Set(sp.home.values())) expect(ids.has(unit), `${sp.seat} ${unit}`).toBe(true);
  // a stack entry is reachable on the table or routed to a sheet: no hit group, and said so
  for (const s of plan.stack) {
    expect(ids.has(`stack:${s.key}`)).toBe(s.reachable);
    if (!s.reachable) expect(plan.violations.some((v) => v.group === `stack:${s.key}`), `stack:${s.key} is said to be out of reach`).toBe(true);
  }
}

describe("stress boards: 40 permanents a seat, 30 on the stack, cards acting", () => {
  for (const vp of SUPPORTED)
    it(`${vp.w}x${vp.h}`, () => {
      for (const seed of [1, 2, 3]) {
        const plan = planTable(stress(seed, 40, 30, vp));
        routed(plan);
        expect(shortfalls(plan), `seed ${seed}`).toEqual([]);
        expect(plan.stack[0]!.reachable, "the top of the stack").toBe(true);
      }
    });

  it("what the picker cannot give 44 px is never missing from the plan's violations", () => {
    // The audit and the picker agree: a group short of its patch under `hitTest` is a reported violation.
    for (const vp of SUPPORTED)
      for (const [n, depth] of [
        [40, 30],
        [60, 12],
        [24, 6],
      ] as const) {
        const plan = planTable(stress(7, n, depth, vp));
        const said = new Set(plan.violations.map((v) => v.group));
        for (const s of shortfalls(plan)) expect(said.has(s.split(" ")[0]!), `${vp.w}x${vp.h} ${s}`).toBe(true);
      }
  });
});

describe("the protocol corpus, planned as the app plans it", () => {
  const models = corpusNames.map((name) => ({ name, model: modelOf(corpusSnapshot(name), catalog, viewerOf()) })).filter((m) => m.model !== null);
  for (const vp of SUPPORTED)
    it(`${vp.w}x${vp.h}`, () => {
      let planned = 0;
      for (const { name, model } of models) {
        let plan: TablePlan;
        try {
          plan = planTable(tableInputOf(model!, { viewport: vp }));
        } catch {
          continue; // not a tuned table (layout says so; play then offers every choice in a sheet)
        }
        planned++;
        routed(plan);
        expect(shortfalls(plan), name).toEqual([]);
      }
      expect(planned).toBeGreaterThan(40);
    });
});
