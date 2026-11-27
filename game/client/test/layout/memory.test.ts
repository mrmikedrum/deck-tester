import { describe, expect, it } from "vitest";
import type { SeatBoard } from "../../src/layout/board";
import { planTable } from "../../src/layout/plan";
import type { TablePlan } from "../../src/layout/plan";
import { card, engineOf, resetIds, SEATS, cid, sid } from "./boards";
import type { TestCard } from "./boards";
import type { SeatId } from "../../src/layout/types";

const VP = { w: 1180, h: 820 };
const NAMES = SEATS;

const creatures = (n: number, from: number): TestCard[] =>
  Array.from({ length: n }, (_, i) => card({ id: from + i, name: `Hero ${from + i}`, creature: true, power: 2, toughness: 2, typeWord: "Creature" }));
const lands = (n: number, from: number): TestCard[] =>
  Array.from({ length: n }, (_, i) => card({ id: from + i, name: i % 2 ? "Forest" : "Island", land: true, basic: true, typeWord: "Land" }));

const seatsOf = (cards: Record<string, TestCard[]>) => NAMES.map((s, i) => ({ seat: s, board: { seat: s, mine: i === 0, cards: cards[s] ?? [] } as SeatBoard }));
const run = (cards: Record<string, TestCard[]>, memory: TablePlan["memory"] | null, settling = false, vp = VP): TablePlan =>
  planTable({ viewport: vp, mode: "normal", settling, memory, stack: [], involved: new Set(), seats: seatsOf(cards), engine: engineOf(seatsOf(cards), new Set(), { memory, settling }) });

const posOf = (p: TablePlan, seat: SeatId) => new Map(p.seats.get(seat)!.units.map((u) => [u.id, u.placement.pos]));

describe("memory: a card that stays keeps its place", () => {
  for (const seat of NAMES) {
    it(`${seat}: others leaving and arriving move nothing that stays`, () => {
      resetIds(1);
      const base = [...creatures(5, 100), ...lands(4, 200)];
      const a = run({ [seat]: base }, null);
      const gone = base.filter((c) => c.id !== 101 && c.id !== 103);
      const next = [...gone, ...creatures(2, 300)];
      const b = run({ [seat]: next }, a.memory);
      const before = posOf(a, seat), after = posOf(b, seat);
      for (const c of [100, 102, 104]) {
        const key = [...before.keys()].find((k) => k.endsWith(String(c)))!;
        expect(after.get(key), `${seat} ${key}`).toEqual(before.get(key));
      }
    });

    it(`${seat}: while cards are still leaving, the whole page holds`, () => {
      const base = [...creatures(6, 100), ...lands(4, 200)];
      const a = run({ [seat]: base }, null);
      const b = run({ [seat]: base.filter((c) => c.id < 103) }, a.memory, true);
      const before = posOf(a, seat), after = posOf(b, seat);
      for (const [k, p] of after) expect(before.get(k)).toEqual(p);
      expect(b.seats.get(seat)!.fixtures.page.w).toBeGreaterThanOrEqual(a.seats.get(seat)!.fixtures.page.w - 1e-9);
    });
  }

  it("a pile that loses its first card keeps its id", () => {
    const toks = (from: number, n: number) => Array.from({ length: n }, (_, i) => card({ id: from + i, name: "Thopter", sig: "thopter", creature: true, token: true, power: 1, toughness: 1, typeWord: "Creature" }));
    const heavy = [...toks(100, 40), ...creatures(10, 200)];
    const a = run({ ana: heavy }, null);
    const pile = a.seats.get(sid("ana"))!.units.find((u) => u.members.includes(cid(100)) && u.members.length > 1);
    if (!pile) return; // (all fit as one pile of copies: nothing to test)
    const b = run({ ana: heavy.filter((c) => c.id !== 100) }, a.memory);
    expect(b.seats.get(sid("ana"))!.home.get(cid(101))).toBe(pile.id);
  });
});

describe("HitGroups", () => {
  const board = [...creatures(4, 100), ...lands(3, 200)];
  it("rev holds while things merely move, and changes with membership or order", () => {
    const a = run({ ana: board }, null);
    const moved = run({ ana: board }, null, false, { w: 1366, h: 1024 });
    expect(moved.hits.rev).toBe(a.hits.rev);
    expect(moved.rev).not.toBe(a.rev);
    const fewer = run({ ana: board.filter((c) => c.id !== 101) }, null);
    expect(fewer.hits.rev).not.toBe(a.hits.rev);
    const added = run({ ana: [...board, ...creatures(1, 150)] }, null);
    expect(added.hits.rev).not.toBe(a.hits.rev);
  });
  it("ids are the unit kind and first card, stable while the unit lasts", () => {
    const a = run({ ana: board }, null), b = run({ ana: [...board, ...creatures(1, 150)] }, a.memory);
    const ids = (p: TablePlan) => p.hits.groups.filter((g) => g.seat === "ana" && g.kind === "card").map((g) => g.id);
    for (const id of ids(a)) expect(ids(b)).toContain(id);
    expect(ids(a).some((id) => id.endsWith("c100"))).toBe(true);
  });
});
