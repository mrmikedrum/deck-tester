// The fight as the table plans it with every seat on `mat` (the clash's own cases are in arrange/gathering.test.ts): it
// is audited and reachable (what the clash covers is reached once it is set aside), and a fighter never folds into a
// pile, not even into a seat's last resort. And the lanes: attacker to the defender's page edge, to the planeswalker it
// attacks, or to the blocker that stopped it.
import { describe, expect, it } from "vitest";
import { TAP_PX } from "../../src/layout/board";
import { combatLanes, planTable, tableInputOf } from "../../src/layout";
import type { CombatPairs, TablePlan, Unit } from "../../src/layout";
import { modelOf, seatId } from "../../src/model";
import type { TableModel } from "../../src/model";
import type { CardId } from "../../src/protocol";
import { catalog, corpusSnapshot, viewerOf } from "../model/fixtures";
import { SUPPORTED } from "./boards";
import { reach, underClash } from "./reach";

const VP = { w: 1180, h: 820 };
const model = (name: string): TableModel => modelOf(corpusSnapshot(name), catalog, viewerOf())!;
const id = (n: number) => n as CardId;
const you = seatId("You"), atraxa = seatId("Atraxa");
const unitOf = (plan: TablePlan, card: number): Unit => {
  for (const sp of plan.seats.values()) for (const u of sp.units) if (u.members.includes(id(card))) return u;
  throw new Error(`no unit for ${card}`);
};
const ATTACK = "037-attack-poison.json", BLOCK = "033-block-attack-on-planeswalker-they-attack.json", BUSY = "054-play-commander-damage.json";

/** Every group a tap can reach, reached with a 44 px patch (a plate needs only a point). */
function shortfalls(plan: TablePlan): string[] {
  const r = reach(plan);
  return plan.hits.groups.filter((g) => !underClash(plan, g) && r.get(g.id)!.side < (g.kind === "plate" ? 1 : TAP_PX)).map((g) => `${g.id} ${r.get(g.id)!.side}px`);
}

describe("the fight, as the table plans it (mat's pages too)", () => {
  it("is audited and reachable at every supported viewport over the corpus's combats and drafts", () => {
    const cases: [string, CombatPairs | null][] = [
      [BLOCK, null],
      [BLOCK, { attacks: [], blocks: [{ blocker: id(818), attacker: id(872) }, { blocker: id(870), attacker: id(872) }] }],
      [BUSY, null],
      ["034-order-blocked-poison.json", null],
      ["044-mode-i-attack.json", null],
      [ATTACK, { attacks: [{ attacker: id(871), defender: { card: id(872) } }], blocks: [] }],
    ];
    for (const vp of SUPPORTED)
      for (const [name, draft] of cases) {
        const plan = planTable(tableInputOf(model(name), { viewport: vp, combat: draft }));
        expect(shortfalls(plan), `${name} ${vp.w}x${vp.h}`).toEqual([]);
        // every permanent still has exactly one unit, a fighter included
        for (const sp of plan.seats.values()) for (const u of new Set(sp.home.values())) expect(plan.hits.groups.some((g) => g.id === u)).toBe(true);
      }
  });

  it("a fighter never folds, not even into a seat's last resort", () => {
    // 034: seven of my creatures block one attacker; whatever the table folds, each fighter keeps a unit of its own.
    const m = model("034-order-blocked-poison.json");
    const plan = planTable(tableInputOf(m, { viewport: { w: 1024, h: 768 } }));
    for (const b of m.combat!.blockers) expect(unitOf(plan, b.blocker).members).toEqual([b.blocker]);
    for (const a of m.combat!.attackers) expect(unitOf(plan, a.attacker).members).toEqual([a.attacker]);
  });
});

describe("lanes", () => {
  it("an unblocked attack lands on the front edge of the defender's page, nearest its attacker", () => {
    const m = model(ATTACK);
    const draft: CombatPairs = { attacks: [{ attacker: id(871), defender: { seat: atraxa } }], blocks: [] };
    const plan = planTable(tableInputOf(m, { viewport: VP, combat: draft }));
    const [l] = combatLanes(plan.seats, you, draft);
    expect(l).toMatchObject({ id: "attack:871", attacker: 871, seat: you, blocked: false, defending: atraxa });
    expect(l!.from).toMatchObject({ unit: unitOf(plan, 871).id });
    const page = plan.seats.get(atraxa)!.fixtures.page;
    if (!("at" in l!.to)) throw new Error("an edge point");
    // just past the page's fixed (front) edge, toward the middle, within its width
    const c = Math.cos(page.yaw), s = Math.sin(page.yaw), d = l!.to.at;
    const u = (d.x - page.pos.x) * c - (d.z - page.pos.z) * s, v = (d.x - page.pos.x) * s + (d.z - page.pos.z) * c;
    expect(v).toBeCloseTo(page.d / 2 + 0.15, 5);
    expect(Math.abs(u)).toBeLessThanOrEqual(page.w / 2);
  });

  it("a blocked attack lands at its blocker's foot; one at a planeswalker on the planeswalker; lanes at one page spread 0.9 apart", () => {
    const m = model(BLOCK);
    const draft: CombatPairs = { attacks: [], blocks: [{ blocker: id(818), attacker: id(834) }] };
    const plan = planTable(tableInputOf(m, { viewport: VP, combat: draft }));
    const lanes = combatLanes(plan.seats, you, plan.combat);
    const walker = lanes.find((l) => l.attacker === 872)!, blocked = lanes.find((l) => l.attacker === 834)!;
    expect(walker.to).toMatchObject({ unit: unitOf(plan, 819).id });
    expect(blocked.to).toMatchObject({ unit: unitOf(plan, 818).id });
    expect(blocked.blocked).toBe(true);
    expect(blocked.apex).toBeGreaterThan(walker.apex - 1);
    // a double block draws a lane to each blocker
    const two = planTable(tableInputOf(m, { viewport: VP, combat: { attacks: [], blocks: [{ blocker: id(818), attacker: id(872) }, { blocker: id(870), attacker: id(872) }] } }));
    const at872 = combatLanes(two.seats, you, two.combat).filter((l) => l.attacker === 872);
    expect(at872.map((l) => ("unit" in l.to ? l.to.unit : null)).sort()).toEqual([unitOf(two, 818).id, unitOf(two, 870).id].sort());
    expect(new Set(at872.map((l) => l.id)).size).toBe(2);
    // a blocked attack whose blocker is gone aims at no one
    expect(combatLanes(plan.seats, you, { attacks: [{ attacker: id(834), defender: { seat: you } }], blocks: [{ blocker: id(99999), attacker: id(834) }] })).toEqual([]);
    // five attacks at one page: their ends stand at least 0.9 apart along its edge (054 has three at Princess)
    const busy = planTable(tableInputOf(model(BUSY), { viewport: VP }));
    const at = combatLanes(busy.seats, you, busy.combat).filter((l) => l.defending === seatId("Princess") && "at" in l.to).map((l) => ("at" in l.to ? l.to.at : l.to));
    expect(at.length).toBe(3);
    const page = busy.seats.get(seatId("Princess"))!.fixtures.page, c = Math.cos(page.yaw), s = Math.sin(page.yaw);
    const us = at.map((p) => ("x" in p ? (p.x - page.pos.x) * c - (p.z - page.pos.z) * s : 0)).sort((a, b) => a - b);
    for (let i = 1; i < us.length; i++) expect(us[i]! - us[i - 1]!).toBeGreaterThanOrEqual(0.9 - 1e-9);
  });
});
