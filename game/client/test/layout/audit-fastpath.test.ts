/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planTable } from "../../src/layout/plan";
import { GRID_ONLY } from "../../src/layout/shape";
import type { TableInput } from "../../src/layout/plan";
import { benchInputs, planFrame } from "../../src/scene/workbench/bench-inputs";
import { SUPPORTED, stress } from "./boards";

// The layout audit tries a geometric square before its cell grid (shape.ts): a square it finds is one the grid finds
// too, so no plan changes. Held here over stressed tables, the bench's tables (a combat of twelve among them) and every
// viewport, plan for plan.

const same = (input: TableInput) => {
  GRID_ONLY.on = true;
  const grid = planTable(input);
  GRID_ONLY.on = false;
  const fast = planTable(input);
  expect(fast.rev).toBe(grid.rev);
  expect(fast.violations).toEqual(grid.violations);
};

describe("the audit's geometric first pass changes no plan", () => {
  it("stressed tables at every viewport", () => {
    for (const vp of SUPPORTED) for (const seed of [1, 2, 3]) for (const n of [10, 30, 60]) same(stress(seed, n, seed % 5, vp));
  });
  it("the bench's tables, the combat of twelve among them", () => {
    const design = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../tests/fixtures/boards/design-pass.json"), "utf8"));
    for (const input of benchInputs(design))
      for (const f of input.frames.slice(0, 5)) {
        GRID_ONLY.on = true;
        const grid = planFrame(f, null);
        GRID_ONLY.on = false;
        const fast = planFrame(f, null);
        expect(fast.rev, input.name).toBe(grid.rev);
        expect(fast.violations, input.name).toEqual(grid.violations);
      }
  });
});
