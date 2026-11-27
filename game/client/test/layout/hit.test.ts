import { describe, expect, it } from "vitest";
import type { SeatBoard } from "../../src/layout/board";
import { hitTest, planTable } from "../../src/layout/plan";
import { reservations } from "../../src/layout/reservations";
import { Ledger } from "../../src/layout/ledger";
import { audit, seatShapes } from "../../src/layout/shape";
import { NotTunedError, tableTemplate } from "../../src/layout/template";
import { SEATS, card, cid, cids, engineOf, randomBoard, resetIds, sid } from "./boards";
import type { CardId } from "../../src/layout/types";

const VP = { w: 1180, h: 820 };
const centre = (q: readonly { x: number; y: number }[]) => ({ x: q.reduce((t, p) => t + p.x, 0) / 4, y: q.reduce((t, p) => t + p.y, 0) / 4 });

function plan(stack = false) {
  resetIds(1);
  const seats = SEATS.map((s, i) => ({ seat: s, board: { ...randomBoard(i + 40, 10, s, i === 0), seat: s } as SeatBoard }));
  return planTable({ viewport: VP, mode: "normal", settling: false, memory: null, involved: new Set(), seats, stack: stack ? [{ key: "s1", card: cid(9999), ability: false, answers: false }] : [], engine: engineOf(seats) });
}

describe("hitTest at rest", () => {
  it("a point on a group's face reaches it, plates first", () => {
    const p = plan();
    const plate = p.hits.groups.find((g) => g.kind === "plate" && g.seat === sid("ana"))!;
    expect(hitTest(p, centre(plate.quad))?.id).toBe(plate.id);
    for (const g of p.hits.groups.filter((x) => x.kind === "card" || x.kind === "pile")) {
      const hit = hitTest(p, centre(g.quad));
      // what is on top of it at its centre may be another card, but never nothing
      expect(hit).not.toBeNull();
    }
    expect(hitTest(p, { x: 2, y: 2 })).toBeNull();
  });
  it("the stack stands over cards, under plates", () => {
    const p = plan(true);
    const s = p.hits.groups.find((g) => g.kind === "stack")!;
    expect(s.members).toEqual([9999]);
    expect(hitTest(p, centre(s.quad))?.id).toMatch(/^(stack:s1|plate:)/);
  });
});

describe("the stack's order", () => {
  // TableInput.stack is bottom first (the model's order): "t" is the top. The plan sets it aside top first, the top the
  // largest and leftmost, and a tap where it and another stack card meet reaches the top.
  const stack = [
    { key: "b", card: cid(9001), ability: false, answers: false },
    { key: "m", card: cid(9002), ability: false, answers: false },
    { key: "t", card: cid(9003), ability: false, answers: false },
  ];
  const area = (q: readonly { x: number; y: number }[]) => Math.abs(q.reduce((t, p, i) => t + p.x * q[(i + 1) % 4]!.y - q[(i + 1) % 4]!.x * p.y, 0)) / 2;
  const bare = SEATS.map((s, i) => ({ seat: s, board: { seat: s, mine: i === 0, cards: [] } }));
  const p = planTable({ viewport: VP, mode: "normal", settling: false, memory: null, involved: new Set(), seats: bare, stack, engine: engineOf(bare) });

  it("the plan is top first, the top drawn largest and at the left", () => {
    expect(p.stack.map((s) => s.key)).toEqual(["t", "m", "b"]);
    expect(p.stack.map((s) => s.card)).toEqual(cids(9003, 9002, 9001));
    const [top, ...under] = p.stack;
    for (const s of under) {
      expect(area(top!.quad)).toBeGreaterThan(area(s.quad));
      expect(centre(top!.quad).x).toBeLessThan(centre(s.quad).x);
    }
    expect(p.hits.groups.filter((g) => g.kind === "stack").map((g) => g.id)).toEqual(["stack:t", "stack:m", "stack:b"]);
  });
  it("a tap reaches each one, and the top where they meet", () => {
    for (const s of p.stack) expect(hitTest(p, centre(s.quad))?.id).toBe(`stack:${s.key}`);
    // Lay the bottom card over the top's place: the top still answers there.
    const tq = p.stack[0]!.quad;
    const groups = p.hits.groups.map((g) => (g.id === "stack:b" ? { ...g, quad: tq } : g));
    expect(hitTest({ ...p, hits: { ...p.hits, groups } }, centre(tq))?.id).toBe("stack:t");
  });
});

describe("sealing", () => {
  it("refuses a card held twice and homes a missing card in a counted pile", () => {
    const unit = (id: string, members: CardId[]) => ({ id, role: "support" as const, kind: "pile" as const, members, dressing: [], top: members[0]!, title: null, mixed: false, acting: false, tapped: false, placement: { pos: { x: 0, y: 0, z: 0 }, scale: 1, posture: "prop" as const } });
    const base = { seat: sid("x"), fixtures: plan().seats.get(sid("ana"))!.fixtures, memory: { v: 1 as const, paradigm: "t", fit: null }, report: { overflow: false } };
    expect(() => new Ledger(cids(1, 2)).seal({ ...base, units: [unit("a", cids(1)), unit("b", cids(1, 2))] })).toThrow(/held by both/);
    const sealed = new Ledger(cids(1, 2, 3)).seal({ ...base, units: [unit("a", cids(1))] });
    expect(sealed.home.size).toBe(3);
    expect(sealed.units.at(-1)!.title).toBe("Rest 2");
  });
});

describe("a board too big for the leaf", () => {
  it("stays reachable whole: every card held, no limit broken", () => {
    resetIds(1);
    const huge = { seat: sid("ana"), mine: false, cards: Array.from({ length: 400 }, (_, i) => card({ name: `Odd ${i}`, creature: true, power: i % 9, toughness: 1, typeWord: "Creature", legendary: true })) };
    const seats = SEATS.map((s, i) => ({ seat: s, board: s === "ana" ? huge : { seat: s, mine: i === 0, cards: [] } }));
    const p = planTable({ viewport: VP, mode: "normal", settling: false, memory: null, involved: new Set(), seats, stack: [], engine: engineOf(seats) });
    expect(p.violations).toEqual([]);
    expect(p.seats.get(sid("ana"))!.home.size).toBe(400);
  });
});

describe("template and reservations", () => {
  it("one to four seats in landscape are tuned (fewer opponents share the same width); others say so", () => {
    expect(tableTemplate(4).slots.map((s) => s.position)).toEqual(["near", "left", "across", "right"]);
    expect(tableTemplate(3).slots.map((s) => s.position)).toEqual(["near", "left", "right"]);
    expect(tableTemplate(2).slots.map((s) => s.position)).toEqual(["near", "across"]);
    const span = (n: number) => tableTemplate(n).slots.slice(1).map((s) => [s.x - s.w / 2, s.x + s.w / 2] as const);
    for (const n of [2, 3]) {
      expect(span(n)[0]![0]).toBeCloseTo(span(4)[0]![0], 9);
      expect(span(n).at(-1)![1]).toBeCloseTo(span(4).at(-1)![1], 9);
    }
    expect(tableTemplate(1).slots.map((s) => s.position)).toEqual(["near"]);
    expect(() => tableTemplate(0)).toThrow(NotTunedError);
    expect(() => tableTemplate(5)).toThrow(NotTunedError);
    expect(() => tableTemplate(4, "portrait")).toThrow(/not tuned|No table template/);
  });
  it("reproduces the old HAND and PROMPT at 1180x820 and scales with the design unit", () => {
    const r = reservations(VP, "normal"), hand = r.items[0]!.rect, prompt = r.items[1]!.rect;
    expect([hand.right, hand.top]).toEqual([470, 605]);
    expect([prompt.left, prompt.top]).toEqual([838, 630]);
    const big = reservations({ w: 2360, h: 1640 }, "normal");
    expect([big.items[0]!.rect.right, big.items[0]!.rect.top]).toEqual([940, 1210]);
    expect(reservations(VP, "mulligan").items.every((i) => !i.visible)).toBe(true);
    expect(reservations(VP, "sifting").items[0]!.rect).toEqual(hand);
  });
});

describe("the audit itself", () => {
  it("flags a card below its floor and a card covered by another", () => {
    const p = plan(), sp = [...p.seats.values()][1]!, u = sp.units[0]!;
    const small = { ...sp, units: [{ ...u, placement: { ...u.placement, scale: 0.2 } }] };
    expect(audit(seatShapes(p.projector, small, false), VP).map((v) => v.rule)).toContain("floor");
    const twin = { ...u, id: "twin", members: cids(999), dressing: [], placement: { ...u.placement, pos: { ...u.placement.pos, z: u.placement.pos.z + 0.05 } } };
    const stacked = { ...sp, units: [u, twin] };
    expect(audit(seatShapes(p.projector, stacked, false), VP).map((v) => v.rule)).toEqual(expect.arrayContaining(["covers-face", "tap-patch"]));
  });
});
