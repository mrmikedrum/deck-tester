/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hitTest, planTable, tableInputOf } from "../../../src/layout";
import type { CombatPairs, TablePlan, Unit } from "../../../src/layout";
import { CLASH, CLASH_STEPS } from "../../../src/layout/arrange/gathering";
import { bounds } from "../../../src/layout/shape";
import { modelOf } from "../../../src/model";
import type { TableModel } from "../../../src/model";
import type { CardId } from "../../../src/protocol";
import { designModels } from "../../../src/scene/workbench/bench-inputs";
import { card, catalog, corpusSnapshot, creature, land, tableOf, viewerOf } from "../../model/fixtures";
import type { Name } from "../../model/fixtures";
import { SUPPORTED } from "../boards";

// The clash (docs/game-client-architecture.md, "Combat"): when I am attacked or anyone is blocked, every fighter stands
// upright on a plane over the table, in one rank of columns between the plaques and my field row; a blocker on its
// controller's side of its attacker, toe to toe; an unblocked attacker's slot empty for its brand. Otherwise (my attack
// before blocks, opponents before blocks) the table form: nothing moves.

const VP = { w: 1180, h: 820 };
const id = (n: number) => n as CardId;
const unitOf = (plan: TablePlan, card: number): Unit => {
  for (const sp of plan.seats.values()) for (const u of sp.units) if (u.members.includes(id(card))) return u;
  throw new Error(`no unit for ${card}`);
};
const drawn = (m: TableModel, o: { combat?: CombatPairs | null; viewport?: { w: number; h: number } } = {}) =>
  planTable(tableInputOf(m, { viewport: o.viewport ?? VP, ...(o.combat ? { combat: o.combat } : {}), engine: { draw: true } }));
const box = (plan: TablePlan, card: number) => bounds(plan.hits.groups.find((g) => g.id === unitOf(plan, card).id)!.quad);
const midX = (plan: TablePlan, card: number) => (box(plan, card).l + box(plan, card).r) / 2;

const design = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as { stages: { turn: number; envelope: { view: Record<string, unknown> } }[]; catalog: unknown };
/** The design pass's turn 15 in a fight: `attackers` [id, defender], `blockers` [blocker, attacker]. */
function turn15(attackers: readonly (readonly [number, string | number])[], blockers: readonly (readonly [number, number])[] = [], active = "Atraxa"): TableModel {
  const e = structuredClone(design.stages.find((s) => s.turn === 15)!.envelope);
  e.view = { ...e.view, active, priority: active, phase: "COMBAT_DECLARE_BLOCKERS", combat: { attackers: attackers.map(([i, defender]) => ({ id: i, defender })), blockers: blockers.map(([i, blocking]) => ({ id: i, blocking })) } };
  return designModels({ stages: [{ turn: 15, envelope: e }], catalog: design.catalog }).get(15)!;
}
const ATRAXA6 = [1019, 1041, 1117, 1169, 1221, 1072] as const;
const BLOCKS4 = [[1057, 1041], [1141, 1117], [1089, 1019], [1027, 1221]] as const;

/** Distinct creatures `ids` for `who` (power 1 + i), a few lands each, and a guard of mine per `guards`. */
const crowded = (who: Name, ids: readonly number[], o: { guards?: readonly number[]; twins?: readonly number[]; combat: { attackers: { id: number; defender: number | string }[]; blockers?: { id: number; blocking: number }[] } }) =>
  tableOf({
    active: who,
    phase: "COMBAT_DECLARE_BLOCKERS",
    seats: Object.fromEntries(
      (["You", "Atraxa", "Dack", "Princess"] as const).map((n, k) => [
        n,
        {
          battlefield: [
            ...(n === who ? ids.map((c, i) => creature(c, o.twins?.includes(c) ? "Spirit" : `Fighter ${i}`, n, o.twins?.includes(c) ? 1 : 1 + (i % 7), 2, o.twins?.includes(c) ? { token: true } : {})) : []),
            ...[0, 1, 2].map((j) => land(200 + k * 10 + j, "Plains", n)),
            ...(n === "You" ? (o.guards ?? []).map((g, i) => creature(g, `Guard ${i}`, n, 1, 3)) : []),
          ],
        },
      ]),
    ),
    combat: o.combat,
  });

describe("the clash", () => {
  it("six at me, four blocked (the owner's still): one tier at step 1.8, upright, blockers toe to toe under their attackers", () => {
    const m = turn15(ATRAXA6.map((a) => [a, "You"] as const), BLOCKS4);
    const plan = drawn(m), g = plan.gathering!;
    expect(g.form).toBe("clash");
    expect(g.step).toBe(1.8);
    expect(g.more).toEqual([]);
    expect(g.left).toEqual([]);
    for (const a of ATRAXA6) expect(unitOf(plan, a)).toMatchObject({ fighting: true, tapped: false });
    // every attacker's foot on one line, every blocker's top 10 px below it, at its attacker's x
    const feet = ATRAXA6.map((a) => box(plan, a).b);
    for (const f of feet) expect(f).toBeCloseTo(feet[0]!, 0);
    for (const [b, a] of BLOCKS4) {
      expect(Math.abs(midX(plan, b) - midX(plan, a)), `${b} under ${a}`).toBeLessThan(1);
      expect(box(plan, b).t - box(plan, a).b).toBeCloseTo(10, 0);
    }
    // the clash stops above my field row, and leaves it and the chrome uncovered
    expect(Math.max(...BLOCKS4.map(([b]) => box(plan, b).b))).toBeLessThanOrEqual(plan.fieldTop - 7);
    expect(plan.violations.filter((v) => v.rule === "clash-covers")).toEqual([]);
    // the wing: Tekuthal (3) and Phyrexian Metamorph (0) unblocked
    expect(g.wings).toHaveLength(1);
    expect(g.wings[0]!.unblocked).toBe(3);
    expect(g.wings[0]!.columns.filter((c) => c.slot).map((c) => c.attackers)).toEqual([[id(1169)], [id(1072)]]);
  });

  it("a tap on an unblocked attacker's brand (its empty slot) reaches that attacker", () => {
    const plan = drawn(turn15(ATRAXA6.map((a) => [a, "You"] as const), BLOCKS4));
    for (const col of plan.gathering!.wings[0]!.columns.filter((c) => c.slot)) {
      const b = bounds(col.slot!);
      const hit = hitTest(plan, { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 })!;
      expect(hit.id).toBe(`slot:${col.unit}`);
      expect(hit.members).toEqual(col.attackers);
    }
  });

  it("attackers keep the order they stood in; blockers come to them", () => {
    const m = turn15(ATRAXA6.map((a) => [a, "You"] as const));
    // where they stood on their page in this combat (the table form: each its own unit, at home)
    const rest = planTable(tableInputOf(m, { viewport: VP, combatForm: "table", engine: { draw: true } }));
    const stood = [...ATRAXA6].sort((a, b) => midX(rest, a) - midX(rest, b));
    const plan = drawn(m);
    expect([...ATRAXA6].sort((a, b) => midX(plan, a) - midX(plan, b))).toEqual(stood);
    const blocked = drawn(turn15(ATRAXA6.map((a) => [a, "You"] as const), BLOCKS4));
    expect([...ATRAXA6].sort((a, b) => midX(blocked, a) - midX(blocked, b))).toEqual(stood);
  });

  it("one attacker: the same picture, one column in the middle at step 1.8", () => {
    const plan = drawn(turn15([[1019, "You"]]));
    expect(plan.gathering!.step).toBe(1.8);
    expect(Math.abs(midX(plan, 1019) - 590)).toBeLessThan(1);
    expect(plan.gathering!.wings[0]!.columns[0]!.slot).not.toBeNull();
  });

  it("a double block: two blockers side by side, the attacker centred over them, one clasp", () => {
    const plan = drawn(turn15(ATRAXA6.map((a) => [a, "You"] as const), [[1057, 1019], [1141, 1019]]));
    const col = plan.gathering!.wings[0]!.columns.find((c) => c.attackers.includes(id(1019)))!;
    expect(col.blockers).toEqual([id(1057), id(1141)]);
    expect(Math.abs((midX(plan, 1057) + midX(plan, 1141)) / 2 - midX(plan, 1019))).toBeLessThan(1);
    expect(box(plan, 1057).r).toBeLessThan(box(plan, 1141).l);
    expect(col.clasp).not.toBeNull();
  });

  it("an attack on me and on an opponent: three rows, a wing each, mine first; each blocker on its own side", () => {
    const plan = drawn(turn15([[1019, "You"], [1041, "You"], [1169, "You"], [1117, "Dack"], [1221, "Dack"]], [[1089, 1041], [1129, 1117]]));
    const g = plan.gathering!;
    expect(g.wings.map((w) => String("seat" in w.defender ? w.defender.seat : w.defender.card))).toEqual(["You", "Dack"]);
    // mine below its attacker, Dack's above
    expect(box(plan, 1089).t).toBeGreaterThan(box(plan, 1041).b);
    expect(box(plan, 1129).b).toBeLessThan(box(plan, 1117).t);
    // wings contiguous: every column of the first left of every column of the second
    const xs = g.wings.map((w) => w.columns.map((c) => c.x));
    expect(Math.max(...xs[0]!)).toBeLessThan(Math.min(...xs[1]!));
    expect(g.wings.map((w) => w.unblocked)).toEqual([8 + 3, 3]);
    // wings stand apart, each at least a plaque wide, so each plaque sits over its own wing (1180 x 820: a design px is 1)
    for (const w of g.wings) expect(w.w).toBeGreaterThanOrEqual(CLASH.wingMin - 1e-6);
    const [left, right] = g.wings;
    expect(right!.plaque.x - right!.w / 2 - (left!.plaque.x + left!.w / 2)).toBeCloseTo(CLASH.wingGap, 3);
    expect([CLASH.wingMin, CLASH.wingGap]).toEqual([320, 64]);
    expect(plan.violations.filter((v) => v.rule === "clash-covers")).toEqual([]);
  });

  it("an attacked planeswalker stands at the end of its wing, on its controller's side (033: mine)", () => {
    const m = modelOf(corpusSnapshot("033-block-attack-on-planeswalker-they-attack.json"), catalog, viewerOf())!;
    const plan = drawn(m), g = plan.gathering!;
    const wing = g.wings.find((w) => "card" in w.defender)!;
    expect(wing.walker?.card).toBe(id(819));
    expect(unitOf(plan, 819).fighting).toBe(true);
    expect(wing.walker!.x).toBeGreaterThan(Math.max(...wing.columns.map((c) => c.x)));
    // on my side: below the attackers
    expect(box(plan, 819).t).toBeGreaterThan(box(plan, 872).b);
  });

  it("a battle's defender is the player Forge says defends it (its protector), not its controller", () => {
    const m = tableOf({
      active: "Dack",
      phase: "COMBAT_DECLARE_BLOCKERS",
      seats: {
        You: { battlefield: [land(19, "Plains", "You")] },
        Atraxa: { battlefield: [card(60, "Invasion of Ergamon", "Atraxa", "Battle - Siege", { counters: { DEFENSE: 5 } }), land(29, "Plains", "Atraxa")] },
        Dack: { battlefield: [creature(70, "Raider", "Dack", 3)] },
      },
      combat: { attackers: [{ id: 70, defender: 60, defending: "You" }] },
    });
    const plan = drawn(m), w = plan.gathering!.wings[0]!;
    expect(String(w.defenderSeat)).toBe("You");
    expect(plan.gathering!.form).toBe("clash"); // attacked through a battle I protect: I am in it
  });

  it("my attack blocked: my attackers below their blockers, my brands in the far row", () => {
    const plan = drawn(turn15([[1089, "Marath"], [1057, "Marath"], [1027, "Marath"]], [[1064, 1089]], "You"));
    expect(plan.gathering!.form).toBe("clash");
    expect(box(plan, 1064).b).toBeLessThan(box(plan, 1089).t);
    const slot = plan.gathering!.wings[0]!.columns.find((c) => c.attackers.includes(id(1057)))!.slot!;
    expect(bounds(slot).b).toBeLessThan(box(plan, 1057).t);
  });

  it("eleven attackers, seven blocks: eleven columns at a smaller step; four of them twins: one column, a block of four", () => {
    const ids = Array.from({ length: 11 }, (_, i) => 300 + i), guards = Array.from({ length: 7 }, (_, i) => 400 + i);
    const combat = { attackers: ids.map((a) => ({ id: a, defender: "You" })), blockers: guards.map((g, i) => ({ id: g, blocking: ids[i]! })) };
    const plan = drawn(crowded("Dack", ids, { guards, combat }));
    expect(plan.gathering!.wings[0]!.columns).toHaveLength(11);
    expect(plan.gathering!.step).toBeLessThan(1.8);
    expect(plan.gathering!.step).toBeGreaterThanOrEqual(1.1);
    const twins = drawn(crowded("Dack", ids, { guards, combat, twins: ids.slice(7) }));
    const cols = twins.gathering!.wings[0]!.columns;
    expect(cols).toHaveLength(8);
    const block = cols.find((c) => c.attackers.length > 1)!;
    expect(block.attackers).toHaveLength(4);
    expect(block.power).toBe(4);
    expect(twins.gathering!.step).toBeGreaterThanOrEqual(plan.gathering!.step);
  });

  it("twenty distinct attackers: as many columns as fit (at most twelve) and the rest in one \"more\"; floors held", () => {
    const ids = Array.from({ length: 20 }, (_, i) => 300 + i);
    const plan = drawn(crowded("Dack", ids, { combat: { attackers: ids.map((a) => ({ id: a, defender: "You" })) } }));
    const g = plan.gathering!;
    const n = g.wings.flatMap((w) => w.columns).length;
    expect(n).toBeGreaterThanOrEqual(11);
    expect(n).toBeLessThanOrEqual(12);
    expect(g.more).toHaveLength(20 - n);
    expect(g.moreAt).not.toBeNull();
    expect(plan.violations.filter((v) => v.rule === "floor" && unitOf(plan, Number(v.group.replace(/\D/g, ""))).fighting)).toEqual([]);
  });

  it("a defender whose attackers all wait in \"more\" keeps its wing, its plaque and its total", () => {
    const ids = Array.from({ length: 17 }, (_, i) => 300 + i);
    const combat = { attackers: ids.map((a, i) => ({ id: a, defender: i < 14 ? "You" : "Atraxa" })) };
    const plan = drawn(crowded("Dack", ids, { combat }));
    const g = plan.gathering!;
    const atraxa = g.wings.find((w) => "seat" in w.defender && String(w.defender.seat) === "Atraxa")!;
    expect(atraxa).toBeDefined();
    expect(atraxa.columns).toEqual([]);
    // Fighters 14, 15, 16: powers 1 + (i % 7)
    expect(atraxa.unblocked).toBe([14, 15, 16].reduce((t, i) => t + 1 + (i % 7), 0));
    // mine counts every attacker at me, those in "more" too
    const mine = g.wings.find((w) => "seat" in w.defender && String(w.defender.seat) === "You")!;
    expect(mine.unblocked).toBe(Array.from({ length: 14 }, (_, i) => 1 + (i % 7)).reduce((t, n) => t + n, 0));
  });

  it("the step never rises while columns only grow", () => {
    const ids = Array.from({ length: 13 }, (_, i) => 300 + i);
    let last = Infinity;
    for (let n = 1; n <= ids.length; n++) {
      const plan = drawn(crowded("Dack", ids, { combat: { attackers: ids.slice(0, n).map((a) => ({ id: a, defender: "You" })) } }));
      expect(plan.gathering!.step).toBeLessThanOrEqual(last);
      expect(CLASH_STEPS as readonly number[]).toContain(plan.gathering!.step);
      last = plan.gathering!.step;
    }
  });

  it("the same input, the same picture", () => {
    const m = turn15(ATRAXA6.map((a) => [a, "You"] as const), BLOCKS4);
    expect(drawn(m).rev).toBe(drawn(m).rev);
  });

  it("every fighter is reached in its middle over the table, at every supported viewport, over the corpus's combats", () => {
    const cases: [string, CombatPairs | null][] = [
      ["033-block-attack-on-planeswalker-they-attack.json", null],
      ["033-block-attack-on-planeswalker-they-attack.json", { attacks: [], blocks: [{ blocker: id(818), attacker: id(872) }, { blocker: id(870), attacker: id(872) }] }],
      ["054-play-commander-damage.json", null],
      ["034-order-blocked-poison.json", null],
    ];
    for (const vp of SUPPORTED)
      for (const [name, combat] of cases) {
        const plan = drawn(modelOf(corpusSnapshot(name), catalog, viewerOf())!, { combat, viewport: vp });
        for (const sp of plan.seats.values())
          for (const u of sp.units.filter((x) => x.fighting)) {
            const b = bounds(plan.hits.groups.find((x) => x.id === u.id)!.quad);
            expect(hitTest(plan, { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 })?.id, `${name} ${vp.w}x${vp.h} ${u.id}`).toBe(u.id);
          }
        expect(plan.violations.filter((v) => v.rule === "clash-covers"), `${name} ${vp.w}x${vp.h}`).toEqual([]);
      }
  });
});

describe("the table form", () => {
  it("my attack before blocks: nothing moves; the wing counts what is coming at its defender", () => {
    const m = turn15([]);
    const rest = drawn(m);
    const draft: CombatPairs = { attacks: [1089, 1057].map((a) => ({ attacker: id(a), defender: { seat: m.seats[1]!.id } })), blocks: [] };
    const plan = planTable(tableInputOf(m, { viewport: VP, combat: draft, memory: rest.memory, engine: { draw: true } }));
    expect(plan.gathering!.form).toBe("table");
    expect(unitOf(plan, 1089).fighting).toBeFalsy();
    expect(unitOf(plan, 1089).placement).toEqual(unitOf(rest, 1089).placement);
    expect(plan.gathering!.wings[0]!.unblocked).toBe(4);
  });

  it("between opponents before blocks: the table form, nothing moves, the mats stay", () => {
    const plan = drawn(turn15([[1015, "Dack"], [1064, "Dack"]], [], "Marath"));
    expect(plan.gathering!.form).toBe("table");
    expect(plan.part).toBe(0);
    expect(unitOf(plan, 1015).fighting).toBeFalsy();
  });
});

describe("duels in the parted middle (a fight between opponents)", () => {
  const MARATH = [[1015, "Dack"], [1064, "Dack"], [1153, "Dack"], [1204, "Dack"]] as const;
  /** Everything on an opponent's leaf (fighters gone to the duels aside) within x l..r: its lowest point on screen. */
  const lowest = (plan: TablePlan, l: number, r: number): number => {
    let low = -Infinity;
    for (const g of plan.hits.groups) {
      if (g.seat === null || g.seat === "You" || g.kind === "plate" || unitFighting(plan, g.id)) continue;
      const b = bounds(g.quad);
      if (b.r > l && b.l < r) low = Math.max(low, b.b);
    }
    return low;
  };
  const unitFighting = (plan: TablePlan, gid: string) => [...plan.seats.values()].some((sp) => sp.units.some((u) => u.id === gid && u.fighting));

  it("one block: the table form, a duel standing in the middle at table size, the attacker on the left", () => {
    const plan = drawn(turn15(MARATH, [[1024, 1015]], "Marath"));
    const g = plan.gathering!;
    expect(g.form).toBe("table");
    expect(g.focus).toBe(false);
    expect(plan.crowded).toBe(false);
    for (const c of [1015, 1024]) expect(unitOf(plan, c).fighting, String(c)).toBe(true);
    for (const c of [1064, 1153, 1204]) expect(unitOf(plan, c).fighting, String(c)).toBeFalsy();
    expect(box(plan, 1015).r).toBeLessThan(box(plan, 1024).l);
    // its feet just over my field row's tops, its top clear under every opponent's feet: the mats parted for it
    expect(g.duels!.b).toBeLessThanOrEqual(plan.fieldTop);
    expect(lowest(plan, g.duels!.l, g.duels!.r)).toBeLessThanOrEqual(g.duels!.t);
    expect(plan.part).toBeGreaterThan(0);
    expect(plan.part).toBeLessThanOrEqual(0.35);
    // the clasp between them
    const col = g.wings[0]!.columns.find((c) => c.attackers.includes(id(1015)))!;
    expect(col.clasp!.x).toBeGreaterThan(box(plan, 1015).r - 1);
    expect(col.clasp!.x).toBeLessThan(box(plan, 1024).l + 1);
    // every leaf holds its floors and patches parted; no fighter is covered
    expect(plan.violations).toEqual([]);
  });

  it("a parting moves no unit: every leaf keeps its units, members and places", () => {
    const rest = drawn(turn15(MARATH, [], "Marath")), parted = drawn(turn15(MARATH, [[1024, 1015]], "Marath"));
    for (const seat of ["Atraxa"]) {
      const a = rest.seats.get(seat as never)!.units, b = parted.seats.get(seat as never)!.units;
      expect(b.map((u) => [u.id, u.members])).toEqual(a.map((u) => [u.id, u.members]));
      // slid along its away: the same shift for every unit
      const d = b.map((u, i) => u.placement.pos.z - a[i]!.placement.pos.z);
      for (const x of d) expect(x).toBeCloseTo(d[0]!, 6);
      expect(d[0]!).toBeLessThan(0);
    }
  });

  it("after the fight the rest plan comes back, equal by rev", () => {
    const rest = drawn(turn15(MARATH, [], "Marath"));
    drawn(turn15(MARATH, [[1024, 1015]], "Marath"));
    const m = turn15([], [], "Marath");
    const before = planTable(tableInputOf(m, { viewport: VP, engine: { draw: true } }));
    const after = planTable(tableInputOf(m, { viewport: VP, engine: { draw: true } }));
    expect(after.rev).toBe(before.rev);
    expect(after.part).toBe(0);
    expect(rest.part).toBe(0);
  });

  it("all or nothing: duels that do not fit the middle raise the clash; set aside, everyone stays home", () => {
    const many = turn15(MARATH, [[1024, 1015], [1129, 1064], [1048, 1153], [1080, 1204]], "Marath");
    const plan = drawn(many);
    expect(plan.crowded).toBe(true);
    expect(plan.gathering!.form).toBe("clash");
    const aside = planTable(tableInputOf(many, { viewport: VP, combatForm: "table", engine: { draw: true } }));
    expect(aside.crowded).toBe(true);
    expect(aside.gathering!.form).toBe("table");
    for (const c of [1015, 1024]) expect(unitOf(aside, c).fighting, String(c)).toBeFalsy();
  });

  it("set aside (the app's combatForm), a fight at me stays home", () => {
    const m = turn15(ATRAXA6.map((a) => [a, "You"] as const), BLOCKS4);
    const plan = planTable(tableInputOf(m, { viewport: VP, combatForm: "table", engine: { draw: true } }));
    expect(plan.gathering!.form).toBe("table");
    for (const a of ATRAXA6) expect(unitOf(plan, a).fighting).toBeFalsy();
  });
});
