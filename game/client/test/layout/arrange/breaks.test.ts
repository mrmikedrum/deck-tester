// Where rows break (breaks.ts): a stage after ordering, by what the cards are on current types. Non-creature lands lie on
// a row of their own wherever the space has one; the order within a row stays the orderer's.
import { describe, expect, it } from "vitest";
import { BREAK_RULES, mayShare, rowClassOf, runsOf } from "../../../src/layout/arrange/breaks";
import type { ArrangeResult, ArrUnit } from "../../../src/layout/arrange/contract";
import { ac, many, resetIds, run } from "./cards";

/** Each lying unit's row, as its feet stand from the leaf's front (its first card's foot along the table). */
const lyingRows = (r: ArrangeResult): ArrUnit[][] => {
  const lying = r.fit.units.filter((u) => u.cards[0]!.posture !== "stand");
  const depth = (u: ArrUnit) => Math.round(u.cards[0]!.foot.z * 100);
  return [...new Set(lying.map(depth))].sort((a, b) => b - a).map((d) => lying.filter((u) => depth(u) === d));
};
const isLandUnit = (ids: ReadonlySet<number>) => (u: ArrUnit) => u.members.every((id) => ids.has(id));

describe("row breaks (breaks.ts)", () => {
  it("classes: a non-creature land is land, an animated land stands with creatures, a well of lands and a rock is land", () => {
    resetIds(1);
    const land = ac({ kind: "land", name: "Forest", basic: true }), rock = ac({ kind: "rock", name: "Sol Ring" });
    const animated = ac({ kind: "creature", also: ["land"], name: "Dryad Arbor" }), work = ac({ kind: "enchantment", name: "Rule of Law" });
    expect(rowClassOf([land])).toBe("land");
    expect(rowClassOf([land, land, rock])).toBe("land");
    expect(rowClassOf([rock])).toBe("other");
    expect(rowClassOf([animated])).toBe("other");
    expect(rowClassOf([land, work])).toBe("other");
    expect(mayShare("land", "other")).toBe(false);
    expect(mayShare("other", "other")).toBe(true);
    expect(BREAK_RULES.map((r) => r.id)).toEqual(["lands-alone"]);
  });

  it("runs: each class in the order it first appears, the orderer's order kept within each", () => {
    const seq = ["w1", "L1", "w2", "L2", "w3"];
    expect(runsOf(seq, (x) => (x.startsWith("L") ? "land" : "other"))).toEqual([["w1", "w2", "w3"], ["L1", "L2"]]);
    expect(runsOf(["a", "b"], () => "other")).toEqual([["a", "b"]]);
  });

  it("a leaf with room lays its lands on a row of their own, behind its works", () => {
    resetIds(10);
    const lands = [...many(5, { kind: "land", name: "Forest", basic: true }), ac({ kind: "rock", name: "Sol Ring" })];
    const cards = [...many(2, { kind: "creature", name: "Elf" }).map((c, i) => ({ ...c, name: `Elf ${i}`, cardKey: `Elf ${i}`, lookKey: `Elf ${i}` })), ac({ kind: "enchantment", name: "Rule of Law", binds: false }), ac({ kind: "artifact", name: "Throne" }), ...lands];
    const r = run({ cards });
    const ids = new Set(lands.map((c) => c.id)), land = isLandUnit(ids);
    const rows = lyingRows(r);
    expect(rows.length).toBe(2);
    expect(rows[0]!.some(land)).toBe(false);
    expect(rows[1]!.every(land)).toBe(true);
    expect(r.fit.report.violations).toEqual([]);
  });

  it("where the space has no row for them, lands share the back row and nothing folds for the rule", () => {
    resetIds(100);
    const lands = many(9, { kind: "land", name: "Plains", basic: true });
    const creatures = Array.from({ length: 8 }, (_, i) => ac({ kind: "creature", name: `Knight ${i}`, power: 2 + i }));
    const works = [ac({ kind: "artifact", name: "Throne" }), ac({ kind: "enchantment", name: "Totem" })];
    const r = run({ cards: [...creatures, ...works, ...lands] });
    const rows = lyingRows(r);
    expect(rows.length).toBe(1);
    // the works are not folded to make room for the lands (each still alone)
    for (const w of works) expect(r.fit.units.find((u) => u.members.includes(w.id))!.members.length).toBe(1);
    expect(r.fit.report.violations).toEqual([]);
  });

  it("what lies keeps its place when a newcomer joins its row (playtest: rows re-dealt as cards arrived)", () => {
    resetIds(200);
    const base = [ac({ kind: "creature", name: "Elf" }), ac({ kind: "artifact", name: "Throne" }), ...many(4, { kind: "land", name: "Forest", basic: true })];
    const a = run({ cards: base });
    const b = run({ cards: [...base, ac({ kind: "enchantment", name: "Totem" })], memory: a.fit.memory });
    const at = (r: ArrangeResult, id: number) => r.fit.units.find((u) => u.members.includes(id as never))!.cards[0]!.foot;
    for (const c of base) expect(at(b, c.id), c.name).toEqual(at(a, c.id));
  });
});
