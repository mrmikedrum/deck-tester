/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hitTest, planTable, tableInputOf } from "../../../src/layout";
import type { CombatPairs, TablePlan, Unit } from "../../../src/layout";
import { bounds } from "../../../src/layout/shape";
import { modelOf } from "../../../src/model";
import type { TableModel } from "../../../src/model";
import type { CardId } from "../../../src/protocol";
import { benchInputs } from "../../../src/scene/workbench/bench-inputs";
import { catalog, corpusSnapshot, creature, land, tableOf, viewerOf } from "../../model/fixtures";
import type { Name } from "../../model/fixtures";
import { SUPPORTED } from "../boards";

// The gathering (§2.8): with the engine's table, every creature in a fight stands in one container as formations, each
// attacker with its blockers in front of it, in one placement (no candidates, no fold rounds); a focus over the table when
// I am in the combat. Every fighter is reached where it stands, over whatever it covers.

const VP = { w: 1180, h: 820 };
const id = (n: number) => n as CardId;
const unitOf = (plan: TablePlan, card: number): Unit => {
  for (const sp of plan.seats.values()) for (const u of sp.units) if (u.members.includes(id(card))) return u;
  throw new Error(`no unit for ${card}`);
};
const model = (name: string): TableModel => modelOf(corpusSnapshot(name), catalog, viewerOf())!;
const drawn = (m: TableModel, o: { combat?: CombatPairs | null; viewport?: { w: number; h: number } } = {}) =>
  planTable(tableInputOf(m, { viewport: o.viewport ?? VP, ...(o.combat ? { combat: o.combat } : {}), shadow: { draw: true } }));

/** Every fighter in the gathering is reached in its middle, and stands as its own unit. */
function reachable(plan: TablePlan, label: string) {
  for (const sp of plan.seats.values())
    for (const u of sp.units.filter((x) => x.fighting)) {
      expect(u.members, `${label} ${u.id}`).toHaveLength(1);
      const g = plan.hits.groups.find((x) => x.id === u.id)!, b = bounds(g.quad);
      expect(hitTest(plan, { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 })?.id, `${label} ${u.id}`).toBe(u.id);
    }
}

/** Every fighter, gathered or left on its page, is reached somewhere a tap means it alone; a raised (focus) group is
 *  one the gathering placed, never a fighter left on its page under it. */
function everyFighterReached(plan: TablePlan, fighters: readonly number[], label: string) {
  const raised = Math.max(...plan.hits.groups.filter((g) => g.kind !== "plate").map((g) => g.order)) > 1e5;
  for (const c of fighters) {
    const u = unitOf(plan, c), g = plan.hits.groups.find((x) => x.id === u.id)!;
    if (raised) expect(g.order > 1e5, `${label} ${c} raised only if gathered`).toBe(!!u.fighting);
    // a sample over its hit quad: somewhere a tap reaches this unit
    const b = bounds(g.quad);
    let hit = false;
    for (let i = 1; i < 12 && !hit; i++) for (let j = 1; j < 12 && !hit; j++) hit = hitTest(plan, { x: b.l + ((b.r - b.l) * i) / 12, y: b.t + ((b.b - b.t) * j) / 12 })?.id === u.id;
    expect(hit, `${label} ${c} reached`).toBe(true);
  }
}

const TEN = Array.from({ length: 10 }, (_, i) => 300 + i);
/** Ten distinct creatures (300..309) for `who`, with a few lands for every seat. */
const crowded = (who: Name, o: { active: Name; combat: { attackers: { id: number; defender: number | string }[]; blockers?: { id: number; blocking: number }[] } | null }) =>
  tableOf({
    active: o.active,
    phase: o.combat ? "COMBAT_DECLARE_BLOCKERS" : "MAIN1",
    seats: Object.fromEntries((["You", "Atraxa", "Dack", "Princess"] as const).map((n, k) => [n, { battlefield: [...(n === who ? TEN.map((c, i) => creature(c, `Fighter ${String.fromCharCode(65 + i)}`, n, 1 + i, 2)) : []), ...[0, 1, 2].map((j) => land(200 + k * 10 + j, "Plains", n)), ...(n === "You" ? [creature(290, "Guard", n)] : [])] }])),
    combat: o.combat,
  });

describe("the gathering", () => {
  const combat12 = benchInputs(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8"))).find((i) => i.name === "combat12")!.frames[0]!.model;

  it("a combat of twelve that I am in: all twelve gathered as a focus, each blocker in front of its attacker, within the limits", () => {
    const plan = drawn(combat12);
    const c = combat12.combat!;
    for (const a of c.attackers) expect(unitOf(plan, a.attacker).fighting, `attacker ${a.attacker}`).toBe(true);
    for (const b of c.blockers) {
      const pb = plan.projector.project(unitOf(plan, b.blocker).placement.pos), pa = plan.projector.project(unitOf(plan, b.attacker).placement.pos);
      expect(unitOf(plan, b.blocker).fighting).toBe(true);
      // between its attacker and me: in front of it on screen
      expect(pb.y).toBeGreaterThan(pa.y);
    }
    expect(plan.violations).toEqual([]);
    reachable(plan, "combat12");
    // a focus: reached over every seat's cards
    const top = Math.max(...plan.hits.groups.filter((g) => g.kind !== "plate" && !plan.seats.get(g.seat!)?.units.find((u) => u.id === g.id)?.fighting).map((g) => g.order));
    for (const sp of plan.seats.values()) for (const u of sp.units.filter((x) => x.fighting)) expect(plan.hits.groups.find((g) => g.id === u.id)!.order).toBeGreaterThan(top);
  });

  it("the attackers stand in the order they stood on their page", () => {
    const plan = drawn(combat12);
    // where each stood: its own unit on the engine's leaf (an acting card leaves its pile for a place of its own)
    const stood = new Map(plan.shadow!.result!.fit.units.flatMap((u) => u.members.map((c) => [c, u.cards.find((p) => p.card === c)!.quad] as const)));
    const x = (q: readonly { x: number }[]) => q.reduce((t, p) => t + p.x, 0) / q.length;
    const attackers = combat12.combat!.attackers.map((a) => a.attacker);
    const before = [...attackers].sort((a, b) => x(stood.get(a)!) - x(stood.get(b)!));
    const now = [...attackers].sort((a, b) => plan.projector.project(unitOf(plan, a).placement.pos).x - plan.projector.project(unitOf(plan, b).placement.pos).x);
    expect(now).toEqual(before);
  });

  it("the corpus's combats and drafts, at every supported viewport: every fighter its own unit, reached where it stands", () => {
    const cases: [string, CombatPairs | null][] = [
      ["033-block-attack-on-planeswalker-they-attack.json", null],
      ["033-block-attack-on-planeswalker-they-attack.json", { attacks: [], blocks: [{ blocker: id(818), attacker: id(872) }, { blocker: id(870), attacker: id(872) }] }],
      ["054-play-commander-damage.json", null],
      ["034-order-blocked-poison.json", null],
      ["044-mode-i-attack.json", null],
      ["037-attack-poison.json", { attacks: [{ attacker: id(871), defender: { card: id(872) } }], blocks: [] }],
    ];
    for (const vp of SUPPORTED)
      for (const [name, combat] of cases) {
        const plan = drawn(model(name), { combat, viewport: vp });
        reachable(plan, `${name} ${vp.w}x${vp.h}`);
        for (const sp of plan.seats.values()) for (const u of new Set(sp.home.values())) expect(plan.hits.groups.some((g) => g.id === u)).toBe(true);
      }
  });

  it("an attack draft takes the attacker into the gathering; its page place is kept for it to go back to", () => {
    const m = model("037-attack-poison.json");
    const before = drawn(m);
    const draft: CombatPairs = { attacks: [{ attacker: id(871), defender: { seat: m.seats[2]!.id } }], blocks: [] };
    const after = planTable(tableInputOf(m, { viewport: VP, combat: draft, memory: before.memory, shadow: { draw: true } }));
    expect(unitOf(after, 871).fighting).toBe(true);
    const back = planTable(tableInputOf(m, { viewport: VP, memory: after.memory, shadow: { draw: true } }));
    expect(unitOf(back, 871).placement).toEqual(unitOf(before, 871).placement);
  });

  it("more attackers of mine than a focus holds: the gathering covers no page, and those left are reached on it", () => {
    const many = Array.from({ length: 24 }, (_, i) => 300 + i);
    const m = tableOf({ active: "You", seats: { You: { battlefield: [...many.map((c, i) => creature(c, `Fighter ${i}`, "You", 1 + (i % 9), 2)), ...[0, 1, 2].map((j) => land(200 + j, "Plains", "You"))] }, Atraxa: { battlefield: [land(210, "Plains", "Atraxa")] } } });
    const draft: CombatPairs = { attacks: many.map((c) => ({ attacker: id(c), defender: { seat: m.seats[1]!.id } })), blocks: [] };
    for (const vp of SUPPORTED) everyFighterReached(drawn(m, { combat: draft, viewport: vp }), many, `${vp.w}x${vp.h}`);
  });

  it("ten distinct attackers across, at me: each reached on its own before the first block and after", () => {
    const attackers = TEN.map((c) => ({ id: c, defender: "You" }));
    for (const blockers of [[], [{ id: 290, blocking: 309 }]]) {
      const m = crowded("Dack", { active: "Dack", combat: { attackers, blockers } });
      for (const vp of SUPPORTED) {
        const plan = drawn(m, { viewport: vp });
        everyFighterReached(plan, TEN, `${blockers.length} blocks ${vp.w}x${vp.h}`);
        for (const c of TEN) expect(unitOf(plan, c).members, `${c} its own unit`).toEqual([id(c)]);
      }
    }
  });

  it("attacked, before any block: a focus (corpus 033, my planeswalker attacked, counts as me)", () => {
    const m = model("033-block-attack-on-planeswalker-they-attack.json");
    expect(m.combat?.blockers ?? []).toEqual([]);
    const plan = drawn(m);
    const top = Math.max(...plan.hits.groups.filter((g) => g.kind !== "plate" && !plan.seats.get(g.seat!)?.units.find((u) => u.id === g.id)?.fighting).map((g) => g.order));
    const fighting = [...plan.seats.values()].flatMap((sp) => sp.units.filter((u) => u.fighting));
    expect(fighting.length).toBeGreaterThan(0);
    for (const u of fighting) expect(plan.hits.groups.find((g) => g.id === u.id)!.order, u.id).toBeGreaterThan(top);
  });
});
