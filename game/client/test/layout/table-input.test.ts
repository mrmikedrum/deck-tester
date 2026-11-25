// The table plan's input from a model, on layout's boundary: shared by the app and the scene's workbench, built from
// the model and plain facts (the ids a combat draft involves, as a set), never from play's types.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import type { TablePlan } from "../../src/layout";
import type { CardId } from "../../src/layout/types";
import { decodeCatalog, isCreature } from "../../src/model";
import { card, creature, land, spell, tableOf } from "../model/fixtures";

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

describe("a Spacecraft changing type on the battlefield", () => {
  const id = 4 as CardId;
  const name = "Wurmwall Sweeper";
  const printed = "Artifact - Spacecraft";
  const catalog = decodeCatalog({ [name]: { faces: [{ type: "Artifact — Spacecraft" }] } });

  function planShip(animated: boolean, memory: TablePlan["memory"] | null = null, settling = false) {
    const ship = animated
      ? card(id, name, "You", "Artifact Creature - Spacecraft", { power: 2, toughness: 2, counters: { Charge: 5 } })
      : card(id, name, "You", printed);
    const battlefield = [creature(1, "Grizzly Bears", "You"), ship];
    if (!settling) battlefield.push(creature(2, "Siege Wurm", "You", 5, 5));
    const model = tableOf({ seats: { You: { battlefield } } }, catalog);
    const input = tableInputOf(model, { viewport: VP, memory, settling });
    const board = input.seats[0]!.board;
    const plan = planTable(input);
    const seat = plan.seats.get(board.seat)!;
    const units = seat.units.filter((u) => u.members.includes(id));
    expect(isCreature(model.cards.get(id)!)).toBe(animated);
    expect(board.cards.find((c) => c.id === id)?.creature).toBe(animated);
    expect(units.map((u) => u.role)).toEqual([animated ? "creature" : "support"]);
    expect(seat.home.get(id)).toBe(units[0]!.id);
    return { plan, placement: units[0]!.placement };
  }

  it("joins the creature row when the engine adds Creature", () => {
    const before = planShip(false);
    const after = planShip(true, before.plan.memory);
    expect(after.placement.posture).toBe("stand");
    expect(after.placement.pos).not.toEqual(before.placement.pos);
  });

  it("returns to support when the engine removes Creature", () => {
    const before = planShip(true);
    const after = planShip(false, before.plan.memory);
    expect(after.placement.posture).toBe("lean");
    expect(after.placement.pos).not.toEqual(before.placement.pos);
  });

  it.each([true, false])("uses the new creature status (%s) while another permanent is leaving", (animated) => {
    const before = planShip(!animated);
    const after = planShip(animated, before.plan.memory, true);
    expect(after.placement.pos).not.toEqual(before.placement.pos);
  });
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
