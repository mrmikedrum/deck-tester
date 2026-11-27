/// <reference types="node" />
// Cards the arrangement engine lays on its leaf rest on the page as the physical table draws them: a lying card's stock
// on the page's top (the engine's layer height is its block's, which the view draws itself), a standing one never into
// the page. Checked on each card's slab as drawn: its lowest corner.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Vector3 } from "three";
import { planTable, tableInputOf } from "../../src/layout";
import { CH, CW, TH } from "../../src/layout/geometry";
import { designModels } from "../../src/scene/workbench/bench-inputs";
import { PAGE_TOP, unitPose } from "../../src/scene/stage/poses";
import type { Pose } from "../../src/scene/stage/types";

const VP = { w: 1180, h: 820 };
const design = designModels(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../tests/fixtures/boards/design-pass.json"), "utf8")));

/** The lowest point of a card's slab drawn at `p` (turned by ry, then rx). */
function lowest(p: Pose): number {
  const m = new Matrix4().makeRotationFromEuler(new Euler(p.rx, p.ry, 0, "YXZ"));
  let low = Infinity;
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const v = new Vector3((x * CW * p.s) / 2, (y * CH * p.s) / 2, (z * TH * p.s) / 2).applyMatrix4(m);
    low = Math.min(low, p.pos.y + v.y);
  }
  return low;
}

describe("cards on the engine's leaf", () => {
  for (const turn of [4, 9, 15])
    it(`turn ${turn}: lying ones rest on the page's top, standing ones stand out of it`, () => {
      const m = design.get(turn)!;
      const plan = planTable(tableInputOf(m, { viewport: VP, engine: {} }));
      const units = [...plan.seats.values()].flatMap((sp) => sp.units).filter((u) => u.placement.frame && !u.fighting);
      expect(units.length).toBeGreaterThan(0);
      for (const u of units) {
        const low = lowest(unitPose(plan.projector, u.placement, false));
        if (u.placement.posture === "stand") expect(low, u.id).toBeGreaterThanOrEqual(PAGE_TOP);
        else expect(low, u.id).toBeCloseTo(PAGE_TOP, 6);
      }
    });
});
