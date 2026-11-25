// The table plan's input from a model, on layout's boundary: shared by the app and the scene's workbench, built from
// the model and plain facts (the ids a combat draft involves, as a set), never from play's types.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tableInputOf } from "../../src/layout";
import type { CardId } from "../../src/layout/types";
import { creature, land, spell, tableOf } from "../model/fixtures";

const VP = { w: 1180, h: 820 };
const ids = (...n: number[]) => new Set(n as CardId[]);

const model = tableOf({
  seats: {
    You: { battlefield: [creature(1, "Grizzly Bears", "You"), creature(2, "Llanowar Elves", "You"), land(3, "Forest", "You")] },
    Atraxa: { battlefield: [creature(11, "Serra Angel", "Atraxa"), creature(12, "Savannah Lions", "Atraxa")] },
  },
  combat: { attackers: [{ id: 11, defender: "You" }], blockers: [{ id: 1, blocking: 11 }] },
  stack: [{ id: 50, source: spell(21, "Shock", "Atraxa", "Shock deals 2 damage to any target."), targets: [2] }],
});

describe("tableInputOf", () => {
  it("involves the engine's combat, the stack's card targets, and the ids it is handed", () => {
    expect(tableInputOf(model, { viewport: VP }).involved).toEqual(ids(11, 1, 2));
    expect(tableInputOf(model, { viewport: VP, involved: ids(12) }).involved).toEqual(ids(11, 1, 2, 12));
  });
  it("defaults: normal chrome, no insets, no memory, not settling; and passes settling and insets through", () => {
    const d = tableInputOf(model, { viewport: VP });
    expect([d.mode, d.memory, d.settling, d.safe]).toEqual(["normal", null, false, undefined]);
    const safe = { top: 0, right: 0, bottom: 20, left: 0 };
    const o = tableInputOf(model, { viewport: VP, settling: true, safe });
    expect([o.settling, o.safe]).toEqual([true, safe]);
  });
  it("the stack, bottom first, with its source cards", () => {
    expect(tableInputOf(model, { viewport: VP }).stack).toEqual([
      { key: "50", card: 21, ability: false, answers: false, targets: [2], seats: [], controller: "Atraxa" },
    ]);
  });
  it("lives in layout and imports nothing of play", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../../src/layout/table-input.ts"), "utf8");
    expect(src).not.toMatch(/from "\.\.\/(play|scene|app)/);
  });
});
