// The combat row (old h.js `targets`, its combat part): every creature in a fight leaves its page for the open middle,
// the attackers in one row in the order they stood, each blocker in front of (or beside) the attacker it blocks; it is
// audited with the composed table (floors, 44 px patches, nothing covered), keeps clear of the stack at rest, and a
// fighter never folds into a pile, not even into a seat's last resort. And the lanes: attacker to the defender's page
// edge, to the planeswalker it attacks, or to the blocker that stopped it.
import { describe, expect, it } from "vitest";
import { FLOOR, TAP_PX } from "../../src/layout/board";
import { combatRow } from "../../src/layout/combat";
import { combatLanes, hitTest, planTable, tableInputOf } from "../../src/layout";
import type { CombatPairs, TablePlan, Unit } from "../../src/layout";
import { makeGeo } from "../../src/layout/seat/geometry";
import { bounds, stackShape, unitShape } from "../../src/layout/shape";
import { modelOf, seatId } from "../../src/model";
import type { TableModel } from "../../src/model";
import type { CardId } from "../../src/protocol";
import { catalog, corpusSnapshot, viewerOf } from "../model/fixtures";
import { SUPPORTED } from "./boards";
import { reach } from "./reach";

const VP = { w: 1180, h: 820 };
const model = (name: string): TableModel => modelOf(corpusSnapshot(name), catalog, viewerOf())!;
const id = (n: number) => n as CardId;
const you = seatId("You"), atraxa = seatId("Atraxa"), dack = seatId("Dack");
const unitOf = (plan: TablePlan, card: number): Unit => {
  for (const sp of plan.seats.values()) for (const u of sp.units) if (u.members.includes(id(card))) return u;
  throw new Error(`no unit for ${card}`);
};
const screen = (plan: TablePlan, u: Unit) => plan.projector.project(u.placement.pos);
const ATTACK = "037-attack-poison.json", BLOCK = "033-block-attack-on-planeswalker-they-attack.json", BUSY = "054-play-commander-damage.json";

/** Every group a tap can reach, reached with a 44 px patch (a plate needs only a point). */
function shortfalls(plan: TablePlan): string[] {
  const r = reach(plan);
  return plan.hits.groups.filter((g) => r.get(g.id)!.side < (g.kind === "plate" ? 1 : TAP_PX)).map((g) => `${g.id} ${r.get(g.id)!.side}px`);
}

describe("the combat row", () => {
  it("an attack draft takes the attacker off its page into the open middle; its page place stays in memory", () => {
    const m = model(ATTACK);
    const before = planTable(tableInputOf(m, { viewport: VP }));
    const draft: CombatPairs = { attacks: [{ attacker: id(871), defender: { seat: atraxa } }], blocks: [] };
    const after = planTable(tableInputOf(m, { viewport: VP, combat: draft }));
    const was = unitOf(before, 871), now = unitOf(after, 871);
    expect(was.fighting).toBeFalsy();
    expect(now.fighting).toBe(true);
    expect(now.id).toBe(was.id);
    expect(now.placement.pos.z).toBeLessThan(was.placement.pos.z); // out of my page, toward the middle
    // and goes back to the place it left when the fight is over
    const back = planTable(tableInputOf(m, { viewport: VP, memory: after.memory }));
    expect(unitOf(back, 871).placement).toEqual(was.placement);
    expect(after.combat).toEqual(draft);
    // It stands below the page across and above my page's creatures: on the open table.
    const y = screen(after, now).y, across = after.seats.get(dack)!.fixtures.page;
    expect(y).toBeGreaterThan(after.projector.project({ ...across.pos, z: across.pos.z + across.d / 2 }).y);
    expect(after.violations).toEqual([]);
  });

  it("the engine's attackers stand in one row in the order they stood; what the open table can't hold fights from its page (054)", () => {
    // Five tapped attackers lie turned, wider than the gap between the stack at rest and Princess's creatures at the
    // open middle's foot: the widest fight where they stand on their pages, each on its own, and the rest in the row.
    const m = model(BUSY);
    const plan = planTable(tableInputOf(m, { viewport: VP }));
    const all = m.combat!.attackers.map((a) => unitOf(plan, a.attacker));
    const atk = all.filter((u) => u.fighting);
    expect(atk.length).toBeGreaterThanOrEqual(3);
    const zs = new Set(atk.map((u) => u.placement.pos.z.toFixed(4)));
    expect(zs.size).toBe(1);
    // the rest fight from their pages, where they stood
    const snap = corpusSnapshot(BUSY);
    const calm = modelOf({ ...snap, view: snap.view && { ...snap.view, combat: null } }, catalog, viewerOf())!;
    const was = planTable(tableInputOf(calm, { viewport: VP }));
    for (const u of all.filter((x) => !x.fighting)) expect(screen(plan, u).y).toBeGreaterThan(screen(was, unitOf(was, u.members[0]!)).y - 40);
    // never folded: each attacker its own unit
    for (const u of atk) expect(u.members).toHaveLength(1);
    // keeps clear of the stack at rest, and the stack keeps its own hit group
    const stack = plan.stack[0]!;
    expect(stack.reachable).toBe(true);
    const sb = bounds(stack.quad);
    for (const u of atk) {
      const g = plan.hits.groups.find((x) => x.id === u.id)!, b = bounds(g.quad);
      expect(b.r <= sb.l || b.l >= sb.r || b.b <= sb.t || b.t >= sb.b, `${u.id} clear of the stack`).toBe(true);
    }
    expect(hitTest(plan, { x: (sb.l + sb.r) / 2, y: (sb.t + sb.b) / 2 })?.kind).toBe("stack");
  });

  it.each([[80, VP.w, 2], [0, VP.w - 80, 2], [80, VP.w, 24]])("keeps the fallback row on screen beside an obstacle from x=%i to x=%i with %i attackers", (l, r, count) => {
    const plan = planTable(tableInputOf(model(BLOCK), { viewport: VP }));
    const { projector, reserve } = plan;
    const attack = plan.combat!.attacks[0]!;
    const unit = unitOf(plan, attack.attacker);
    const seat = [...plan.seats.values()].find((s) => s.units.includes(unit))!;
    const attacks = Array.from({ length: count }, (_, i) => ({ ...attack, attacker: id(10000 + i) }));
    const plans = [{ ...seat, units: attacks.map(({ attacker }) => ({ ...unit, id: `test:${attacker}`, members: [attacker], fighting: false, tapped: true })) }];
    const combat = { attacks, blocks: [] };
    const geo = makeGeo(projector, reserve, FLOOR.mine);
    const obstacle = stackShape("obstacle", [{ x: l, y: 550 }, { x: r, y: 550 }, { x: r, y: 300 }, { x: l, y: 300 }], 0, []);
    const candidates = combatRow({
      combat, plans, perspective: you, projector, geo,
      middle: { l: 0, r: VP.w / geo.u, t: 300 / geo.u, b: 530 / geo.u },
      obstacles: [obstacle],
    });

    const fallback = candidates.at(-1)!;
    const moved = fallback.flatMap((seat) => seat.units.filter((unit) => unit.fighting).map((unit) => unitShape(projector, seat.seat, unit, seat.seat === you)));
    expect(moved.length).toBeGreaterThan(0);
    if (count === 2) expect(moved).toHaveLength(2);
    else expect(moved.length).toBeLessThan(count);
    for (const shape of moved) {
      const face = bounds(shape.face);
      expect(face.l).toBeGreaterThanOrEqual(0);
      expect(face.r).toBeLessThanOrEqual(VP.w);
    }
  });

  it("a blocker stands with the attacker it blocks: in front of it, between it and me, or just beside it (033)", () => {
    const m = model(BLOCK);
    const draft: CombatPairs = { attacks: [], blocks: [{ blocker: id(818), attacker: id(872) }] };
    const plan = planTable(tableInputOf(m, { viewport: VP, combat: draft }));
    expect(plan.combat?.attacks).toHaveLength(2); // a block draft keeps the engine's attackers
    const a = unitOf(plan, 872), b = unitOf(plan, 818);
    expect(a.fighting && b.fighting).toBe(true);
    const pa = screen(plan, a), pb = screen(plan, b);
    const step = Math.abs(pa.x - pb.x), front = pb.y > pa.y + 1;
    // in front of it (two rows), or beside it, nearer it than any other fighter
    expect(front || step < 200).toBe(true);
    const others = [...plan.seats.values()].flatMap((sp) => sp.units.filter((u) => u.fighting && u !== a && u !== b));
    for (const o of others) expect(Math.abs(screen(plan, o).x - pb.x)).toBeGreaterThan(Math.min(step, 1) - 1);
    expect(plan.violations).toEqual([]);
  });

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
