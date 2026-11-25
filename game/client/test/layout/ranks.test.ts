import { describe, expect, it } from "vitest";
import type { BoardCard, SeatBoard } from "../../src/layout/board";
import { planTable } from "../../src/layout/plan";
import type { TablePlan } from "../../src/layout/plan";
import { ranks } from "../../src/layout/seat/ranks";
import { REST } from "../../src/layout/relevance";
import type { Question } from "../../src/layout/relevance";
import { SUPPORTED, card, randomBoard, resetIds, SEATS } from "./boards";
import type { SeatId } from "../../src/layout/types";

// `ranks`: an opponent's page dealt by relevance. Every permanent is held once at every size; the line holds the
// commander and the biggest; a question changes stance and words, never homes.
const VP = { w: 1180, h: 820 };
const fix = { graveyard: 1, exile: 0, commandZone: false };

const run = (cards: BoardCard[], o: { memory?: TablePlan["memory"] | null; question?: Question; turn?: number; active?: SeatId | null } = {}): TablePlan =>
  planTable({
    viewport: VP,
    mode: "normal",
    settling: false,
    memory: o.memory ?? null,
    stack: [],
    involved: new Set(),
    layout: ranks,
    question: o.question ?? REST,
    clock: { turn: o.turn ?? 5, active: o.active ?? null },
    seats: SEATS.map((s, i) => ({ seat: s, board: { seat: s, mine: i === 0, cards: i === 1 ? cards : [], fixtures: fix } as SeatBoard })),
  });

const ANA = SEATS[1]!;
function army(): BoardCard[] {
  resetIds(1);
  return [
    card({ id: 1, name: "Marath", creature: true, commander: true, legendary: true, power: 5, toughness: 5, typeWord: "Creature" }),
    ...Array.from({ length: 9 }, (_, i) => card({ id: 10 + i, name: "Beast", token: true, creature: true, power: 4, toughness: 4, typeWord: "Creature" })),
    ...Array.from({ length: 6 }, (_, i) => card({ id: 30 + i, name: "Cat", token: true, creature: true, power: 2, toughness: 2, tapped: i < 2, typeWord: "Creature" })),
    ...Array.from({ length: 5 }, (_, i) => card({ id: 50 + i, name: `Elf ${i}`, creature: true, power: 1, toughness: 1, typeWord: "Creature", sick: i === 0 })),
    card({ id: 70, name: "Rule of Law", enchantment: true, typeWord: "Enchantment", reach: "table" }),
    card({ id: 71, name: "Throne", artifact: true, typeWord: "Artifact" }),
    card({ id: 72, name: "Sword", artifact: true, typeWord: "Artifact" }),
    ...Array.from({ length: 6 }, (_, i) => card({ id: 80 + i, name: "Forest", land: true, basic: true, typeWord: "Land", tapped: i < 2 })),
  ];
}

describe("ranks: an opponent's page by relevance", () => {
  it("holds every permanent once, at every supported size, over seeded boards", () => {
    for (const vp of SUPPORTED)
      for (let seed = 1; seed <= 12; seed++) {
        resetIds(1);
        const seats = SEATS.map((s, i) => ({ seat: s, board: randomBoard(seed * 17 + i, 10 + seed * 3, s, i === 0) }));
        const plan = planTable({ viewport: vp, mode: "normal", seats, involved: new Set(), settling: false, memory: null, stack: [], layout: ranks, question: REST });
        for (const { seat, board } of seats) {
          const units = plan.seats.get(seat)!.units, held = units.flatMap((u) => [...u.members, ...u.dressing]);
          expect(new Set(held).size, `${seat} ${seed}`).toBe(held.length);
          expect(new Set(held), `${seat} ${seed}`).toEqual(new Set(board.cards.map((c) => c.id)));
        }
      }
  });

  it("stands the commander and the strongest regiment on the line, under a die", () => {
    const p = run(army()).seats.get(ANA)!;
    const line = p.units.filter((u) => u.role === "creature" && u.placement.pos.z === Math.max(...p.units.filter((x) => x.role === "creature").map((x) => x.placement.pos.z)));
    expect(p.units.some((u) => u.members.includes(1 as never) && u.members.length === 1)).toBe(true);
    const beasts = p.units.find((u) => u.members.includes(10 as never))!;
    expect(beasts.look).toBe("regiment");
    expect(beasts.members).toHaveLength(9);
    expect(line.length).toBeGreaterThan(0);
    expect(p.report.lastResort).toBe(false);
  });

  it("reads the page's sum where it holds a fold, and its column of what binds everyone", () => {
    const p = run(army()).seats.get(ANA)!;
    expect(p.fixtures.read?.facts).toMatchObject({ q: "rest", power: 5 + 36 + 12 + 5, creatures: 21 });
    const shelf = p.units.filter((u) => u.role === "support");
    expect(shelf.flatMap((u) => u.members)).toEqual(expect.arrayContaining([70, 71, 72]));
  });

  it("under a threat, the active seat's ready creatures stand forward and the rest lie down; homes stay", () => {
    const rest = run(army()).seats.get(ANA)!;
    const threat = run(army(), { memory: run(army()).memory, question: { q: "threat", seat: ANA } }).seats.get(ANA)!;
    expect(threat.units.map((u) => u.id).sort()).toEqual(rest.units.map((u) => u.id).sort());
    const beasts = threat.units.find((u) => u.members.includes(10 as never))!;
    expect(beasts.stance).toBe("forward");
    expect(threat.fixtures.read?.facts).toMatchObject({ q: "threat" });
    // the sick Elf does not count as ready
    expect((threat.fixtures.read?.facts as { creatures: number }).creatures).toBe(1 + 9 + 4 + 4);
  });

  it("keeps the line between tidies, and re-deals it at the owner's untap step", () => {
    const first = run(army(), { turn: 5 });
    const bigger = [...army(), card({ id: 99, name: "Wurm", creature: true, power: 3, toughness: 3, typeWord: "Creature" })];
    const later = run(bigger, { memory: first.memory, turn: 6 }).seats.get(ANA)!;
    // a 3/3 does not plainly belong on the line: it waits in the ranks or the tail
    const wurm = later.units.find((u) => u.members.includes(99 as never))!;
    expect(wurm.placement.pos.z).toBeLessThan(later.units.find((u) => u.members.includes(1 as never))!.placement.pos.z);
    const huge = [...army(), card({ id: 98, name: "Titan", creature: true, power: 12, toughness: 12, typeWord: "Creature" })];
    const arrived = run(huge, { memory: first.memory, turn: 6 }).seats.get(ANA)!;
    const titan = arrived.units.find((u) => u.members.includes(98 as never))!;
    const marath = arrived.units.find((u) => u.members.includes(1 as never))!;
    // a 12/12 plainly belongs: it lands on the line at once (the line's size), and something steps back
    expect(titan.look).toBe("card");
    expect(titan.placement.scale).toBeCloseTo(marath.placement.scale, 5);
  });
});
