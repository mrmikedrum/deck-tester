// Focus-first's leaves (layout/seat/front.ts): who stands in the front and keeps standing, regiments of like creatures,
// at most four standing things and a back row whatever the board's size, and the composed table at its limits.
import { describe, expect, it } from "vitest";
import { planTable } from "../../src/layout/plan";
import type { TableInput } from "../../src/layout/plan";
import { chooseFront, weightOf } from "../../src/layout/seat/rank";
import type { SeatId } from "../../src/layout/types";
import { SEATS, card, resetIds, stress } from "./boards";

const VP = { w: 1180, h: 820 };
const EMPTY = { graveyard: 3, exile: 0, commandZone: false } as const;

describe("who stands in the front", () => {
  const c = (key: string, weight: number, oldest = 1, legendary = false) => ({ key, weight, oldest, legendary });

  it("a weight is power, a regiment's sum, doubled by a keyword that changes combat", () => {
    resetIds(1);
    const beast = card({ name: "Beast", creature: true, power: 4, toughness: 4 });
    const flier = card({ name: "Thopter", creature: true, power: 1, toughness: 1, keywords: ["Flying"] });
    const walker = card({ name: "Wrenn", planeswalker: true, loyalty: 5 });
    expect(weightOf([beast, beast, beast])).toBe(12);
    expect(weightOf([flier, flier])).toBe(4);
    expect(weightOf([walker])).toBe(5);
  });

  it("the commander and the heaviest stand; ties go to the legendary, then the older", () => {
    const f = chooseFront([c("a", 3, 5), c("b", 9), c("cmd", 1), c("d", 3, 4, true), c("e", 3, 2)], null, 4, "cmd");
    expect(f).toEqual(["cmd", "b", "d", "e"]);
  });

  it("a front card keeps its place until a newcomer outweighs it by two; tapping changes nothing", () => {
    const before = chooseFront([c("cmd", 5), c("b", 12), c("e", 6), c("g", 4)], null, 4, "cmd");
    expect(chooseFront([c("cmd", 5), c("b", 12), c("e", 6), c("g", 4), c("new", 5)], before, 4, "cmd")).toEqual(before);
    const after = chooseFront([c("cmd", 5), c("b", 12), c("e", 6), c("g", 4), c("big", 6)], before, 4, "cmd");
    expect(after[before.indexOf("g")]).toBe("big");
    expect(after.filter((k, i) => k !== before[i])).toEqual(["big"]);
  });
});

const front = (seats: TableInput["seats"], more: Partial<TableInput> = {}) =>
  planTable({ viewport: VP, mode: "normal", settling: false, memory: null, involved: new Set(), seats, stack: [], paradigm: "front", ...more });

describe("a leaf", () => {
  it("a small board stands every creature alone, nothing piled", () => {
    resetIds(1);
    const theirs = [card({ name: "Marath", creature: true, commander: true, power: 3, toughness: 3 }), card({ name: "Beast", creature: true, token: true, power: 4, toughness: 4 }), card({ name: "Beast", creature: true, token: true, power: 4, toughness: 4 }), card({ name: "Retreat", enchantment: true })];
    const seats = SEATS.map((s, i) => ({ seat: s, board: { seat: s, mine: i === 0, cards: i === 1 ? theirs : [], fixtures: EMPTY } }));
    const sp = front(seats).seats.get(SEATS[1]!)!;
    expect(sp.units.filter((u) => u.placement.posture === "stand").map((u) => u.members.length)).toEqual([1, 1, 1]);
    expect(sp.units.some((u) => u.kind === "pile")).toBe(false);
  });

  it("a big board: at most four standing, like creatures as one regiment, the rest in one muster, nothing lost", () => {
    resetIds(1);
    const cards = [
      card({ name: "Marath", creature: true, commander: true, power: 5, toughness: 5 }),
      ...Array.from({ length: 9 }, (_, i) => card({ name: "Beast", creature: true, token: true, power: 4, toughness: 4, tapped: i < 2 })),
      ...Array.from({ length: 8 }, () => card({ name: "Elemental", creature: true, token: true, power: 3, toughness: 3 })),
      ...Array.from({ length: 12 }, (_, i) => card({ name: `Druid ${i}`, creature: true, power: 1, toughness: 1 })),
      ...Array.from({ length: 6 }, (_, i) => card({ name: `Work ${i}`, enchantment: true })),
      ...Array.from({ length: 14 }, () => card({ name: "Forest", land: true, basic: true })),
    ];
    const seats = SEATS.map((s, i) => ({ seat: s, board: { seat: s, mine: i === 0, cards: i === 1 ? cards : [], fixtures: EMPTY } }));
    const plan = front(seats);
    const sp = plan.seats.get(SEATS[1]!)!;
    const standing = sp.units.filter((u) => u.placement.posture === "stand");
    expect(standing.length).toBe(4);
    expect(standing.map((u) => u.members.length)).toEqual([1, 9, 8, 1]);
    const beasts = standing[1]!;
    expect(beasts.members.slice(-2).every((id) => cards.find((c) => c.id === id)!.tapped)).toBe(true);
    const lying = sp.units.filter((u) => u.placement.posture !== "stand");
    expect(lying.map((u) => u.kind).sort()).toEqual(["pile", "pile", "well"]);
    expect(sp.home.size).toBe(cards.length);
    expect(sp.report.lastResort).toBe(false);
    expect(plan.violations).toEqual([]);
  });

  it("random boards of every size keep the limits, with no seat at its last resort", () => {
    for (const n of [6, 16, 30, 48]) {
      const plan = planTable({ ...stress(3, n, 0, VP), paradigm: "front" });
      for (const seat of SEATS.slice(1)) expect(plan.seats.get(seat as SeatId)!.report.lastResort, `${n} ${seat}`).toBe(false);
      expect(plan.violations, `${n}`).toEqual([]);
    }
  });
});
