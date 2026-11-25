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
import { catalog, corpusSnapshot, viewerOf } from "../../model/fixtures";
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
});
