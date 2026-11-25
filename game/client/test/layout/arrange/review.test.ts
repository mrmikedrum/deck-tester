import { describe, expect, it } from "vitest";
import { largestSquare } from "../../../src/layout/arrange/audit";
import type { ArrCard, ArrangeResult, Policy } from "../../../src/layout/arrange/contract";
import { collect } from "../../../src/layout/arrange/policies/common";
import { readyTapped } from "../../../src/layout/arrange/policies/ready-tapped";
import { policyFor } from "../../../src/layout/arrange/policies/select";
import { works } from "../../../src/layout/arrange/policies/works";
import type { Quad } from "../../../src/layout/shape";
import type { CardId } from "../../../src/layout/types";
import { CLOCK, ac, many, resetIds, run } from "./cards";

// Cases from the review of the first slice (PR #9): each failed before its fix.

const id = (n: number) => n as CardId;
const unitOf = (r: ArrangeResult, c: number) => r.fit.units.find((u) => u.members.includes(id(c)) || u.dressing.includes(id(c)));

/** Every offered card is reachable by following some target's action: it selects that card (or an identical copy of it
 *  in the same stack: copies are interchangeable), or it opens a focus from a unit that holds it. A select only ever
 *  selects an offered card. */
function reachEachChoice(r: ArrangeResult, offered: ReadonlySet<CardId>, cards: readonly ArrCard[]) {
  const look = new Map(cards.map((c) => [c.id, `${c.lookKey}|${c.tapped}`]));
  for (const t of r.fit.targets) if ("select" in t.action) expect(offered.has(t.action.select), `${t.id} selects a card not offered`).toBe(true);
  for (const c of offered) {
    const ok = r.fit.targets.some((t) => {
      if ("select" in t.action) return t.action.select === c || (t.members.includes(c) && look.get(t.action.select) === look.get(c));
      if ("open" in t.action) {
        const from = t.action.open.from;
        const u = r.fit.units.find((x) => x.id === from);
        return !!u && (u.members.includes(c) || u.dressing.includes(c));
      }
      return false;
    });
    expect(ok, `offered card ${c} has no way to it`).toBe(true);
  }
}

describe("1: nested attachments", () => {
  for (const policy of [readyTapped, works])
    it(`an Aura on Equipment on a creature rides with the creature (${policy.id})`, () => {
      resetIds(1);
      const host = ac({ id: 1, name: "Knight", power: 3 });
      const gear = ac({ id: 2, kind: "artifact", name: "Sword", subtypes: ["Equipment"], attachedTo: 1 });
      const aura = ac({ id: 3, kind: "enchantment", name: "Animate", subtypes: ["Aura"], attachedTo: 2 });
      const r = run({ cards: [aura, gear, host], policy });
      expect(r.fit.report.policyInvalid).toBeNull();
      const u = unitOf(r, 1)!;
      expect(new Set([...u.members, ...u.dressing])).toEqual(new Set([id(1), id(2), id(3)]));
      // the immediate host is kept on the card itself
      expect(gear.attachedTo).toBe(1);
      expect(aura.attachedTo).toBe(2);
    });
});

describe("2: a tap patch is measured on whole cells", () => {
  const box = (l: number, t: number, r: number, b: number): Quad => [{ x: l, y: b }, { x: r, y: b }, { x: r, y: t }, { x: l, y: t }];
  const bb = (q: Quad) => ({ l: Math.min(...q.map((p) => p.x)), r: Math.max(...q.map((p) => p.x)), t: Math.min(...q.map((p) => p.y)), b: Math.max(...q.map((p) => p.y)) });
  const safe = { left: 0, top: 0, right: 1000, bottom: 1000 };
  it("a 42 px square never certifies a 44 px patch", () => {
    const q = box(1, 1, 43, 43);
    expect(largestSquare(q, bb(q), [], [], safe)).toBeLessThan(44);
  });
  it("a keepout narrower than a cell, between cell centres, still cuts the patch", () => {
    const q = box(0, 0, 100, 48);
    expect(largestSquare(q, bb(q), [], [], safe)).toBeGreaterThanOrEqual(44);
    const cut = largestSquare(q, bb(q), [], [{ left: 22.5, right: 23.5, top: 0, bottom: 48 }, { left: 66.5, right: 67.5, top: 0, bottom: 48 }], safe);
    expect(cut).toBeLessThan(44);
  });
  it("an overlapping quad narrower than a cell, between centres, cuts it too", () => {
    const q = box(0, 0, 100, 48);
    const sliver = (x: number) => box(x, -10, x + 1, 60);
    expect(largestSquare(q, bb(q), [sliver(22.5), sliver(66.5)], [], safe)).toBeLessThan(44);
  });
});

describe("3: a mixed well with several lands offered", () => {
  it("opens the focus with them offered, so each can be chosen", () => {
    resetIds(1);
    const cards = [ac({ id: 4, kind: "land", name: "Forest", basic: true }), ac({ id: 5, kind: "land", name: "Island", basic: true }), ...many(3, { kind: "land", name: "Forest", basic: true })];
    const offered = new Set([id(4), id(5)]);
    const r = run({ cards, acting: { offered, choosing: true } });
    reachEachChoice(r, offered, cards);
    const well = unitOf(r, 4)!;
    expect(r.fit.targets.find((t) => t.piece === well.id)!.action).toEqual({ open: { role: "spread", from: well.id, page: 0 } });
  });
  it("identical copies offered stay one target that selects", () => {
    resetIds(1);
    const cards = [ac({ name: "Marath", commander: true, power: 5 }), ...many(9, { name: "Beast", token: true, power: 3 }), ...Array.from({ length: 7 }, (_, i) => ac({ name: `Body ${i}`, power: 2 }))];
    const offered = new Set([cards[2]!.id, cards[3]!.id]);
    const r = run({ cards, acting: { offered, choosing: true } });
    reachEachChoice(r, offered, cards);
    const stack = unitOf(r, cards[2]!.id)!;
    expect("select" in r.fit.targets.find((t) => t.piece === stack.id)!.action).toBe(true);
  });
});

describe("4: acting and offered attachments", () => {
  it("an Equipment that acts leaves its host as its own unit and stands", () => {
    resetIds(1);
    const cards = [ac({ id: 1, name: "Knight", power: 3 }), ac({ id: 2, kind: "artifact", name: "Sword", subtypes: ["Equipment"], attachedTo: 1 })];
    const r = run({ cards, acting: { involved: new Set([id(2)]), offered: new Set([id(2)]), choosing: true } });
    const own = unitOf(r, 2)!;
    expect(own.members).toEqual([id(2)]);
    expect(own.acting).toBe(true);
    expect(unitOf(r, 1)!.dressing).toEqual([]);
  });
  it("an offered attachment that does not act: its host's target opens the focus, and it is cued", () => {
    resetIds(1);
    const cards = [ac({ id: 1, name: "Knight", power: 3 }), ac({ id: 2, kind: "artifact", name: "Sword", subtypes: ["Equipment"], attachedTo: 1 })];
    const offered = new Set([id(2)]);
    const r = run({ cards, acting: { offered, choosing: true } });
    reachEachChoice(r, offered, cards);
    const host = unitOf(r, 1)!;
    expect(host.dressing).toEqual([id(2)]);
    expect(r.fit.attention).toContainEqual({ unit: host.id, cards: [id(2)], why: "offered" });
  });
});

describe("5: a type change mid-phase waits for the next phase", () => {
  it("planned in upkeep, then main with nothing changed, then crewed in the same main: it stays in place", () => {
    resetIds(1);
    const base = [ac({ name: "Marath", commander: true, power: 5 }), ac({ name: "Wurm", power: 6 }), ...many(3, { kind: "land", name: "Forest", basic: true })];
    const ship = ac({ id: 50, kind: "artifact", name: "Copter", subtypes: ["Vehicle"] });
    const a = run({ cards: [...base, ship], clock: { phase: "UPKEEP" } });
    const b = run({ cards: [...base, ship], memory: a.fit.memory, clock: { phase: "MAIN1" } });
    const crewed = { ...ship, types: { ...ship.types, creature: true }, power: 3, toughness: 3, lookKey: ship.lookKey + "|c" };
    const c = run({ cards: [...base, crewed], memory: b.fit.memory, clock: { phase: "MAIN1" } });
    const u = unitOf(c, 50)!;
    expect(u.retyped).toBe(true);
    expect(u.tier).toBe("works");
    const d = run({ cards: [...base, crewed], memory: c.fit.memory, clock: { phase: "COMBAT_BEGIN" } });
    expect(unitOf(d, 50)!.tier).toBe("ready");
  });
});

describe("6: the policy choice holds for the whole turn", () => {
  it("selection, then arrange, then selection again in the same turn keeps the choice", () => {
    resetIds(1);
    const heavy = Array.from({ length: 6 }, (_, i) => ac({ name: `Bear ${i}`, power: 3 }));
    const light = [ac({ name: "Spirit", power: 1 }), ...Array.from({ length: 6 }, (_, i) => ac({ kind: "enchantment", name: `Rule ${i}`, binds: true }))];
    const t5 = run({ cards: heavy, clock: { turn: 5 } });
    const sel = policyFor(heavy, t5.fit.memory, { ...CLOCK, turn: 6 });
    expect(sel.selection).toEqual({ policy: "ready-tapped", since: 6 });
    const t6 = run({ cards: heavy, memory: t5.fit.memory, policy: sel.policy, selection: sel.selection, clock: { turn: 6 } });
    expect(t6.fit.memory.selection).toEqual({ policy: "ready-tapped", since: 6 });
    // later the same turn the board turns creature-light: the choice holds until the next turn
    expect(policyFor(light, t6.fit.memory, { ...CLOCK, turn: 6 }).policy.id).toBe("ready-tapped");
  });
});

describe("7: a split gives the old id to the old top", () => {
  it("a stack that unfolds keeps its id on the card that was on top, not the one whose key sorts first", () => {
    resetIds(1);
    const elves = [2, 10, 11].map((n) => ac({ id: n, name: "Elf", power: 1 }));
    const others = Array.from({ length: 8 }, (_, i) => ac({ id: 20 + i, name: `Big ${i}`, power: 5 + i }));
    const a = run({ cards: [ac({ id: 1, name: "Marath", commander: true, power: 5 }), ...elves, ...others] });
    const stack = unitOf(a, 2)!;
    expect(stack.kind).toBe("stack");
    expect(stack.top).toBe(2);
    // the others leave: the elves unfold, and the old stack's id stays with card 2
    const b = run({ cards: [ac({ id: 1, name: "Marath", commander: true, power: 5 }), ...elves], memory: a.fit.memory, clock: { turn: 6 } });
    expect(unitOf(b, 2)!.kind).toBe("card");
    expect(unitOf(b, 2)!.id).toBe(stack.id);
  });
});

describe("8: malformed policy output falls back instead of throwing", () => {
  const cards = (): ArrCard[] => {
    resetIds(1);
    return [ac({ name: "Bear", power: 2 }), ac({ kind: "land", name: "Forest" })];
  };
  const bad: [string, Partial<Policy>][] = [
    ["an unknown card in a group", { group: (cs) => [...collect(cs, (c) => c.lookKey), { key: "ghost", members: [99 as CardId], dressing: [], stacks: false }] }],
    ["an empty group", { group: (cs) => [...collect(cs, (c) => c.lookKey), { key: "empty", members: [], dressing: [], stacks: false }] }],
    ["a duplicated group key", { group: (cs) => { const g = collect(cs, (c) => c.lookKey); return [...g, { ...g[0]!, members: [] }]; } }],
    ["a policy that throws", { importance: () => { throw new Error("boom"); } }],
  ];
  for (const [what, patch] of bad)
    it(what, () => {
      const r = run({ cards: cards(), policy: { ...readyTapped, id: "broken", ...patch } as Policy });
      expect(r.fit.report.policyInvalid).not.toBeNull();
      expect(r.fit.policy).toBe("ready-tapped");
    });
});

describe("9: a fan shows the edges its step asked for", () => {
  it("a policy fanning with two edges reserves and draws two", () => {
    resetIds(1);
    const policy: Policy = { ...readyTapped, id: "narrow", ladder: readyTapped.ladder.map((s) => (s.op === "fan" ? { ...s, show: 2 } : s)) };
    const cards = [ac({ name: "Marath", commander: true, power: 5 }), ...Array.from({ length: 16 }, (_, i) => ac({ name: `Body ${i}`, power: 1 + (i % 4) }))];
    const r = run({ cards, policy });
    const fan = r.fit.units.find((u) => u.kind === "fan")!;
    expect(fan).toBeDefined();
    // two distinct poses: the top and the one turned under it; every hidden member lies with the last shown
    const turns = new Set(fan.cards.map((p) => `${p.up.x.toFixed(6)},${p.up.z.toFixed(6)}`));
    expect(turns.size).toBe(2);
  });
});
