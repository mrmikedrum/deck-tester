/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hitTest, planTable, tableInputOf } from "../../../src/layout";
import type { CombatPairs, TablePlan, Unit } from "../../../src/layout";
import { CLASH_STEPS } from "../../../src/layout/arrange/gathering";
import { bounds } from "../../../src/layout/shape";
import { modelOf } from "../../../src/model";
import type { TableModel } from "../../../src/model";
import type { CardId } from "../../../src/protocol";
import { designModels } from "../../../src/scene/workbench/bench-inputs";
import { catalog, corpusSnapshot, creature, land, tableOf, viewerOf } from "../../model/fixtures";
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
  planTable(tableInputOf(m, { viewport: o.viewport ?? VP, ...(o.combat ? { combat: o.combat } : {}), shadow: { draw: true } }));
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
    const rest = planTable(tableInputOf(m, { viewport: VP, combatForm: "table", shadow: { draw: true } }));
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
    expect(plan.violations.filter((v) => v.rule === "clash-covers")).toEqual([]);
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
    const plan = planTable(tableInputOf(m, { viewport: VP, combat: draft, memory: rest.memory, shadow: { draw: true } }));
    expect(plan.gathering!.form).toBe("table");
    expect(unitOf(plan, 1089).fighting).toBeFalsy();
    expect(unitOf(plan, 1089).placement).toEqual(unitOf(rest, 1089).placement);
    expect(plan.gathering!.wings[0]!.unblocked).toBe(4);
  });

  it("between opponents before blocks: the table form; with a block, the clash", () => {
    expect(drawn(turn15([[1015, "Dack"], [1064, "Dack"]], [], "Marath")).gathering!.form).toBe("table");
    expect(drawn(turn15([[1015, "Dack"], [1064, "Dack"]], [[1024, 1015]], "Marath")).gathering!.form).toBe("clash");
  });

  it("set aside (the app's combatForm), a fight at me stays home", () => {
    const m = turn15(ATRAXA6.map((a) => [a, "You"] as const), BLOCKS4);
    const plan = planTable(tableInputOf(m, { viewport: VP, combatForm: "table", shadow: { draw: true } }));
    expect(plan.gathering!.form).toBe("table");
    for (const a of ATRAXA6) expect(unitOf(plan, a).fighting).toBeFalsy();
  });
});
