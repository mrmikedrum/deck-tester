/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../../src/layout";
import type { TablePlan } from "../../../src/layout";
import type { Unit } from "../../../src/layout/seat";
import type { SeatId } from "../../../src/layout/types";
import { designModels } from "../../../src/scene/workbench/bench-inputs";

// Step 10: a moment changes light only. What answers it stands in a brighter pool, what it leaves out has its light put
// out, and a pile hiding what answers it says so; no unit moves for it.

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as {
  stages: { turn: number; envelope: { v?: number; view: Record<string, unknown> } }[];
  catalog: unknown;
};
type Wire = { id: number; type: string; tapped?: boolean; text?: string };
type Player = { name: string; battlefield: Wire[] };
const IPAD = { w: 1210, h: 834 };

/** The turn-15 table with `edit` applied to its view, planned after `after` (its memory carried). */
function table(edit: (view: Record<string, unknown>, players: Player[]) => void, after?: TablePlan): TablePlan {
  const st = structuredClone(raw.stages.find((s) => s.turn === 15)!);
  edit(st.envelope.view, st.envelope.view["players"] as Player[]);
  const model = designModels({ stages: [st], catalog: raw.catalog } as never).get(15)!;
  return planTable(tableInputOf(model, { viewport: IPAD, engine: {}, ...(after ? { memory: after.memory } : {}) }));
}
const unitsOf = (p: TablePlan, seat: string): readonly Unit[] => p.seats.get(seat as SeatId)!.units;
const unitWith = (p: TablePlan, seat: string, id: number): Unit => unitsOf(p, seat).find((u) => u.members.includes(id as never))!;
const creatures = (ps: Player[], name: string) => ps.find((p) => p.name === name)!.battlefield.filter((c) => /Creature/.test(c.type));

describe("moments: light, in place", () => {
  it("a fight between opponents lights its attackers and puts out the light of the attacking seat's creatures left home", () => {
    const attackers = [1015, 1064, 1105, 1157];
    let home: number[] = [];
    const p = table((view, ps) => {
      for (const c of ps.find((x) => x.name === "Marath")!.battlefield) if (attackers.includes(c.id)) c.tapped = true;
      home = creatures(ps, "Marath").map((c) => c.id).filter((id) => !attackers.includes(id));
      Object.assign(view, { active: "Marath", priority: "Marath", phase: "COMBAT_DECLARE_ATTACKERS", combat: { ordinal: 1, attackers: attackers.map((id) => ({ id, defender: "Dack", blocked: false })), blockers: [], damage: [] } });
    });
    for (const id of attackers) expect(unitWith(p, "Marath", id).light, String(id)).toBe("forward");
    // a unit of Marath's that holds no attacker and only creatures is left out
    const out = unitsOf(p, "Marath").filter((u) => u.members.every((id) => home.includes(id)));
    expect(out.length).toBeGreaterThan(0);
    for (const u of out) expect(u.light, u.id).toBe("down");
    // the other seats are as at rest
    for (const seat of ["Atraxa", "Dack", "You"]) for (const u of unitsOf(p, seat)) expect(u.light, `${seat} ${u.id}`).toBeUndefined();
  });

  it("a spell on the stack aimed at my creature lights it where it stands, and nothing else of mine", () => {
    const before = table((view) => Object.assign(view, { active: "Dack", priority: "You", phase: "MAIN1" }));
    const swords = (target: number) =>
      table((view) => {
        Object.assign(view, { active: "Dack", priority: "You", phase: "MAIN1", stack: [{ id: 9001, source: { id: 9001, name: "Swords to Plowshares", owner: "Dack", controller: "Dack", type: "Instant", zone: "stack" }, controller: "Dack", spell: true, text: "Swords to Plowshares", targets: [target] }] });
      }, before);
    const p = swords(1089);
    expect(unitWith(p, "You", 1089).light).toBe("forward");
    expect(unitsOf(p, "You").filter((u) => u.light).map((u) => u.id)).toEqual([unitWith(p, "You", 1089).id]);
    // aimed at a Beast under the top of Marath's stack of Beasts, where no place is free: it stays in its stack, which
    // is lit and cued; nothing that stands sits down for it
    const beasts = unitWith(before, "Marath", 1066), id = beasts.members.at(-1)!;
    const q = swords(id);
    const lit = unitWith(q, "Marath", id);
    expect(lit.id).toBe(beasts.id);
    expect([lit.light, lit.cue]).toEqual(["forward", "act"]);
    for (const u of unitsOf(before, "Marath")) expect(unitsOf(q, "Marath").find((v) => v.id === u.id)?.members, u.id).toEqual(u.members);
  });

  it("no moment moves anything: every unit keeps its members and place", () => {
    const rest = table(() => undefined);
    const aimed = table((view) => {
      Object.assign(view, { stack: [{ id: 9001, source: { id: 9001, name: "Swords to Plowshares", owner: "Dack", controller: "Dack", type: "Instant", zone: "stack" }, controller: "Dack", spell: true, text: "Swords to Plowshares", targets: [1089] }] });
    }, rest);
    for (const [seat, sp] of rest.seats)
      for (const u of sp.units) {
        const v = aimed.seats.get(seat)!.units.find((x) => x.id === u.id)!;
        expect(v?.members, u.id).toEqual(u.members);
      }
  });

  it("review: a change of light alone is a new plan rev; the same plan again keeps it", () => {
    const rest = table((view) => Object.assign(view, { active: "Dack", priority: "Dack", phase: "COMBAT_DECLARE_BLOCKERS" }));
    const quiet = table((view) => Object.assign(view, { active: "Dack", priority: "Dack", phase: "COMBAT_DECLARE_BLOCKERS" }), rest);
    expect(quiet.rev).toBe(rest.rev);
    // Dack's turn before attacks: what can come at me is lit; nothing moves
    const lit = table((view) => Object.assign(view, { active: "Dack", priority: "Dack", phase: "MAIN1" }), rest);
    const again = table((view) => Object.assign(view, { active: "Dack", priority: "Dack", phase: "MAIN1" }), lit);
    expect(unitsOf(lit, "Dack").some((u) => u.light === "forward")).toBe(true);
    for (const u of unitsOf(rest, "Dack")) expect(unitsOf(lit, "Dack").find((v) => v.id === u.id)?.placement.pos, u.id).toEqual(u.placement.pos);
    expect(lit.rev).not.toBe(rest.rev);
    expect(again.rev).toBe(lit.rev);
  });
});
