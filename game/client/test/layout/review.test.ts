// Faults a review found in layout, each pinned by the case that showed it: a permanent of any mix of types is held
// exactly once; the stack is audited against the screen (what is off it, or has no room, is not reachable on the table); a
// tap reaches what is drawn where it lands.
import { describe, expect, it } from "vitest";
import type { SeatBoard } from "../../src/layout/board";
import { hitTest, planTable } from "../../src/layout/plan";
import type { TableInput } from "../../src/layout/plan";
import { bounds, inQuad } from "../../src/layout/shape";
import type { CardId } from "../../src/layout/types";
import { SEATS, card, cid, engineOf, randomBoard, resetIds, sid } from "./boards";
import type { TestCard } from "./boards";

const VP = { w: 1180, h: 820 };
const table = (seats: TableInput["seats"], more: Partial<TableInput> = {}) =>
  planTable({ viewport: VP, mode: "normal", settling: false, memory: null, involved: new Set(), seats, stack: [], engine: engineOf(seats), ...more });

const FLAGS = ["land", "creature", "planeswalker", "artifact", "enchantment", "manaRock", "specialLand", "treasure", "basic"] as const;

/** One card for every combination of the type flags (512), each a different card. */
function everyCombination(first: number): TestCard[] {
  return Array.from({ length: 1 << FLAGS.length }, (_, bits) => {
    const flags = Object.fromEntries(FLAGS.map((f, i) => [f, (bits & (1 << i)) !== 0]));
    return card({ id: first + bits, name: `Combo ${bits}`, power: 2, toughness: 2, token: !!flags["treasure"], typeWord: "Thing", ...flags });
  });
}

function heldOnce(board: SeatBoard, units: readonly { members: readonly CardId[]; dressing: readonly CardId[] }[]): void {
  const held = units.flatMap((u) => [...u.members, ...u.dressing]);
  expect(new Set(held).size).toBe(held.length);
  expect(new Set(held)).toEqual(new Set(board.cards.map((c) => c.id)));
}

describe("every permanent is held exactly once, whatever its types", () => {
  it("an animated Treasure (an artifact that is a creature now) stands with the creatures, not also in the well", () => {
    for (const mine of [true, false]) {
      const treasure = card({ id: 42, name: "Treasure", artifact: true, treasure: true, token: true, creature: true, power: 1, toughness: 1 });
      const board: SeatBoard = { seat: sid("you"), mine, cards: [treasure] };
      const seats = SEATS.map((s, i) => ({ seat: s, board: i === (mine ? 0 : 1) ? { ...board, seat: s } : { seat: s, mine: i === 0, cards: [] } }));
      const p = table(seats);
      const sp = p.seats.get(SEATS[mine ? 0 : 1]!)!;
      expect(sp.units.filter((u) => u.members.includes(cid(42))).map((u) => u.role)).toEqual(["creature"]);
    }
  });

  it.each([
    ["mine", true],
    ["theirs", false],
  ])("%s: one card of every combination of type flags, alone on its seat", (_, mine) => {
    const seat = mine ? SEATS[0]! : SEATS[1]!;
    for (const c of everyCombination(1)) {
      const board: SeatBoard = { seat, mine, cards: [c] };
      const seats = SEATS.map((s) => ({ seat: s, board: s === seat ? board : { seat: s, mine: s === SEATS[0], cards: [] } }));
      heldOnce(board, table(seats).seats.get(seat)!.units);
    }
  });

  it.each([
    ["mine", true],
    ["theirs", false],
  ])("%s: all 512 combinations on one seat", (_, mine) => {
    const seat = mine ? SEATS[0]! : SEATS[1]!;
    const board: SeatBoard = { seat, mine, cards: everyCombination(1000) };
    const seats = SEATS.map((s) => ({ seat: s, board: s === seat ? board : { seat: s, mine: s === SEATS[0], cards: [] } }));
    heldOnce(board, table(seats).seats.get(seat)!.units);
  });
});

describe("the stack against the screen", () => {
  const spells = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `s${i}`, card: cid(9000 + i), ability: false, answers: false }));
  const seats = () => {
    resetIds(1);
    return SEATS.map((s, i) => ({ seat: s, board: { ...randomBoard(i + 40, 10, s, i === 0), seat: s } as SeatBoard }));
  };
  const onScreen = (q: Parameters<typeof bounds>[0]) => {
    const b = bounds(q);
    return b.l >= 0 && b.t >= 0 && b.r <= VP.w && b.b <= VP.h;
  };

  it("with 30 spells at 1180x820, no stack card a tap can reach on the table is off the screen", () => {
    const p = table(seats(), { stack: spells(30) });
    expect(p.stack).toHaveLength(30);
    const reach = p.hits.groups.filter((g) => g.kind === "stack");
    for (const g of reach) expect(onScreen(g.quad), g.id).toBe(true);
    // What the open middle has no room for lies under the last card that fitted, and is said so: not reachable, and a
    // broken limit (a sheet offers it). Nothing runs off the screen or over a page.
    const left = p.stack.filter((s) => !s.reachable);
    expect(left.length).toBeGreaterThan(0);
    const last = p.stack[p.stack.length - left.length - 1]!;
    for (const s of left) {
      expect(s.quad).toEqual(last.quad);
      expect(reach.map((g) => g.id)).not.toContain(`stack:${s.key}`);
    }
    expect(p.stack.filter((s) => !onScreen(s.quad))).toEqual([]);
    expect(p.violations.filter((v) => v.rule === "no-room").map((v) => v.group).sort()).toEqual(left.map((s) => `stack:${s.key}`).sort());
    expect(p.violations.filter((v) => v.rule !== "no-room")).toEqual([]);
    // the top is always reachable, and wins where it meets the next
    expect(p.stack[0]!.reachable).toBe(true);
    expect(reach.sort((a, b) => b.order - a.order)[0]!.id).toBe("stack:s29");
  });

  it("a stack card off the safe area is not reachable, and is said so; the rest stay inside it", () => {
    // An inset at the right that takes the edge of the top card itself.
    const free = table(seats(), { stack: spells(30) }), b = bounds(free.stack[0]!.quad);
    const p = table(seats(), { stack: spells(30), safe: { top: 0, right: VP.w - (b.r - 10), bottom: 0, left: 0 } });
    expect(p.stack[0]!.reachable).toBe(false);
    expect(p.violations.some((v) => v.group === `stack:${p.stack[0]!.key}` && v.rule === "off-screen")).toBe(true);
    for (const s of p.stack.slice(1)) {
      expect(s.reachable).toBe(false);
      expect(p.violations.some((v) => v.group === `stack:${s.key}`)).toBe(true);
    }
    expect(p.hits.groups.filter((g) => g.kind === "stack")).toEqual([]);
  });

  it("a stack that fits is reachable whole and breaks nothing", () => {
    const p = table(seats(), { stack: spells(3) });
    expect(p.stack.every((s) => s.reachable)).toBe(true);
    expect(p.hits.groups.filter((g) => g.kind === "stack")).toHaveLength(3);
    expect(p.violations).toEqual([]);
  });
});

describe("a tap reaches what is drawn where it lands", () => {
  it("hitTest follows draw order: the face drawn on top at a point is the one reached, else the place that holds it", () => {
    resetIds(1);
    const p = table(SEATS.map((s, i) => ({ seat: s, board: { ...randomBoard(i + 7, 24, s, i === 0), seat: s } as SeatBoard })));
    const groups = p.hits.groups.filter((g) => g.kind !== "plate" && g.kind !== "stack");
    for (let x = 0; x < VP.w; x += 16)
      for (let y = 0; y < VP.h; y += 16) {
        const faces = groups.filter((g) => inQuad(g.face ?? g.quad, x, y)), under = faces.length ? faces : groups.filter((g) => inQuad(g.quad, x, y));
        const hit = hitTest(p, { x, y });
        if (!under.length || hit?.kind === "plate") continue;
        const top = under.reduce((a, b) => (b.order >= a.order ? b : a));
        expect(hit?.id, `${x},${y}`).toBe(top.id);
      }
  });
});
