import { describe, expect, it } from "vitest";
import type { ArrangeResult, ContainerMemory } from "../../../src/layout/arrange/contract";
import { readyTapped } from "../../../src/layout/arrange/policies/ready-tapped";
import { SELECT, creatureShare, policyFor } from "../../../src/layout/arrange/policies/select";
import { works } from "../../../src/layout/arrange/policies/works";
import { CLOCK, ac, many, resetIds, run } from "./cards";

// The starting policies (§2.4, §2.5) on the designer's leaf, and the per-seat choice from the battlefield.

const unitOf = (r: ArrangeResult, name: string, cards: readonly { id: number; name: string }[]) => {
  const id = cards.find((c) => c.name === name)!.id;
  return r.fit.units.find((u) => u.members.includes(id as never) || u.dressing.includes(id as never))!;
};

describe("ready-tapped", () => {
  it("the commander takes the first place; the front holds the most total power, the second row the next four", () => {
    resetIds(1);
    const cards = [
      ac({ name: "Marath", commander: true, power: 5 }),
      ac({ name: "Baloth", power: 4 }),
      ac({ name: "Wurm", power: 7, keywords: ["trample"] }),
      ac({ name: "Druid", power: 1 }),
      ac({ name: "Sage", power: 1 }),
      ac({ name: "Rishkar", power: 2, legendary: true }),
      ac({ name: "Patron", power: 2 }),
      ac({ name: "Witness", power: 2 }),
      ac({ name: "Kami", power: 0 }),
      ac({ name: "Angel", power: 3, keywords: ["flying"] }),
    ];
    const r = run({ cards });
    const front = r.fit.units.filter((u) => u.tier === "ready");
    expect(front.length).toBe(4);
    // place 0 is the middle (left of it, with an even count): the commander
    expect(unitOf(r, "Marath", cards).slot).toEqual({ row: 0, interval: 0, place: 0 });
    const names = (us: typeof front) => us.flatMap((u) => u.members.map((id) => cards.find((c) => c.id === id)!.name)).sort();
    expect(names(front)).toEqual(["Angel", "Baloth", "Marath", "Wurm"]);
    // the next four by weight (Druid and Sage tie at 1: the earlier key folds first, deterministically)
    expect(names(r.fit.units.filter((u) => u.tier === "second"))).toEqual(["Patron", "Rishkar", "Sage", "Witness"]);
    expect(r.overflow).toBeNull();
  });

  it("identical tokens stack (one target, its count marker) before anything is demoted", () => {
    resetIds(1);
    const cards = [ac({ name: "Marath", commander: true, power: 5 }), ...many(9, { name: "Beast", token: true, power: 3 }), ...many(8, { name: "Elemental", token: true, power: 3 })];
    const r = run({ cards });
    const beasts = unitOf(r, "Beast", cards);
    expect(beasts.kind).toBe("stack");
    expect(beasts.members.length).toBe(9);
    expect(beasts.marker?.count).toBe(9);
    expect(r.fit.targets.filter((t) => t.piece === beasts.id).length).toBe(1);
    expect(r.fit.report.edits.filter((e) => e.ran).every((e) => e.op === "stack")).toBe(true);
  });

  it("spent copies split from their front stack into the rest, as a sibling stack", () => {
    resetIds(1);
    const cards = [
      ac({ name: "Marath", commander: true, power: 5 }),
      ...many(6, { name: "Beast", token: true, power: 3 }),
      ...many(3, { name: "Beast", token: true, power: 3, tapped: true }),
      ...Array.from({ length: 6 }, (_, i) => ac({ name: `Body ${i}`, power: 3 })),
    ];
    const r = run({ cards });
    const ready = r.fit.units.find((u) => u.members.length === 6 && u.kind === "stack")!;
    expect(ready.tier).toBe("ready");
    const spent = r.fit.units.find((u) => u.members.length === 3)!;
    expect(spent.tier).toBe("rest");
    expect(r.fit.report.edits.some((e) => e.ran && e.op === "split-spent")).toBe(true);
  });

  it("their lands are one block, a well whose facts say how many are open", () => {
    resetIds(1);
    const cards = [...many(5, { kind: "land", name: "Forest", basic: true }), ...many(3, { kind: "land", name: "Forest", basic: true, tapped: true }), ac({ kind: "land", name: "Temple Garden" }), ac({ kind: "rock", name: "Sol Ring" })];
    const r = run({ cards });
    expect(r.fit.units.length).toBe(1);
    const well = r.fit.units[0]!;
    expect(well.kind).toBe("stack");
    expect(well.facts).toEqual({ kind: "well", lands: 9, open: 7, produces: ["G"], rocks: 1 });
    // a well with one open land lies square: only a spent block turns
    expect(well.cards.every((p) => p.turn === "none" || p.card !== well.top)).toBe(true);
  });

  it("works fan in the lying row with a card that binds me first; the plate reads the seat", () => {
    resetIds(1);
    const cards = [
      ac({ name: "Dack", commander: true, power: 3 }),
      ...Array.from({ length: 9 }, (_, i) => ac({ name: `Body ${i}`, power: 3 })),
      ...Array.from({ length: 6 }, (_, i) => ac({ kind: "enchantment", name: `Work ${i}` })),
      ac({ kind: "enchantment", name: "Smothering Tithe", binds: true }),
      ...many(4, { kind: "land", name: "Plains", basic: true }),
    ];
    const r = run({ cards });
    expect(r.overflow).toBeNull();
    const tithe = unitOf(r, "Smothering Tithe", cards);
    // it binds the table: it earns a standing place by its weight, or leads its fan
    expect(tithe.tier === "works" ? tithe.top === cards.find((c) => c.name === "Smothering Tithe")!.id : true).toBe(true);
    expect(r.fit.seat).toMatchObject({ creatures: 10, lands: 4, open: 4 });
  });

  it("acting cards stand in front, out of their stack, its marker one less", () => {
    resetIds(1);
    const cards = [ac({ name: "Marath", commander: true, power: 5 }), ...many(9, { name: "Beast", token: true, power: 3 }), ...Array.from({ length: 6 }, (_, i) => ac({ name: `Body ${i}`, power: 2 }))];
    const attacker = cards[3]!.id;
    const r = run({ cards, acting: { involved: new Set([attacker]) } });
    const own = r.fit.units.find((u) => u.members.includes(attacker))!;
    expect(own.members).toEqual([attacker]);
    expect(["ready", "second"]).toContain(own.tier);
    const beasts = r.fit.units.find((u) => u.kind === "stack" && u.members.length === 8)!;
    expect(beasts.marker?.count).toBe(8);
  });

  it("a stack's target selects while a decision offers its cards; a pile at rest opens the spread", () => {
    resetIds(1);
    const cards = [ac({ name: "Marath", commander: true, power: 5 }), ...many(9, { name: "Beast", token: true, power: 3 }), ...Array.from({ length: 6 }, (_, i) => ac({ name: `Body ${i}`, power: 2 }))];
    const beast = cards[2]!.id;
    const choosing = run({ cards, acting: { offered: new Set([beast]), choosing: true } });
    const stack = choosing.fit.units.find((u) => u.kind === "stack")!;
    expect(choosing.fit.targets.find((t) => t.piece === stack.id)!.action).toEqual({ select: beast });
    const atRest = run({ cards });
    const s2 = atRest.fit.units.find((u) => u.kind === "stack")!;
    expect(atRest.fit.targets.find((t) => t.piece === s2.id)!.action).toEqual({ open: { role: "spread", from: s2.id, page: 0 } });
    const single = atRest.fit.units.find((u) => u.kind === "card")!;
    expect(atRest.fit.targets.find((t) => t.piece === single.id)!.action).toEqual({ inspect: single.top });
  });
});

describe("works (a creature-light seat)", () => {
  it("engines stand: a card that binds the table and a planeswalker take standing places over small creatures", () => {
    resetIds(1);
    const cards = [
      ac({ name: "Dack", commander: true, kind: "planeswalker", loyalty: 4 }),
      ac({ kind: "enchantment", name: "Rule of Law", binds: true }),
      ac({ kind: "artifact", name: "Trinisphere", binds: true }),
      ac({ kind: "planeswalker", name: "Wrenn", loyalty: 5 }),
      ac({ kind: "artifact", name: "Ornament" }),
      ...Array.from({ length: 6 }, (_, i) => ac({ name: `Spirit ${i}`, power: 1 })),
    ];
    const r = run({ cards, policy: works });
    const standing = r.fit.units.filter((u) => u.tier === "ready" || u.tier === "second").map((u) => cards.find((c) => c.id === u.top)!.name);
    for (const n of ["Rule of Law", "Trinisphere", "Wrenn"]) expect(standing).toContain(n);
    expect(unitOf(r, "Ornament", cards).tier).toBe("works");
    const tr = run({ cards, policy: readyTapped });
    // under ready-tapped the walker and the rules still stand, but the plain work never does
    expect(unitOf(tr, "Ornament", cards).tier).toBe("works");
  });

  it("the same board under both policies: same rows, different units, the same guarantees", () => {
    resetIds(1);
    const cards = [ac({ name: "Dack", commander: true, power: 3 }), ...Array.from({ length: 8 }, (_, i) => ac({ kind: "artifact", name: `Engine ${i}`, counters: i % 2 ? 2 : 0, binds: i % 3 === 0 })), ...Array.from({ length: 5 }, (_, i) => ac({ name: `Spirit ${i}`, power: 1 }))];
    const a = run({ cards, policy: readyTapped }), b = run({ cards, policy: works });
    expect(a.fit.rows.map((r) => r.tiers)).toEqual(b.fit.rows.map((r) => r.tiers));
    expect(a.fit.units.map((u) => u.top)).not.toEqual(b.fit.units.map((u) => u.top));
    expect(a.overflow).toBeNull();
    expect(b.overflow).toBeNull();
  });
});

describe("policyFor: from the battlefield only, held between its thresholds", () => {
  resetIds(1);
  const creatureHeavy = [...Array.from({ length: 6 }, (_, i) => ac({ name: `Bear ${i}`, power: 3 })), ac({ kind: "artifact", name: "Thing" })];
  const creatureLight = [ac({ name: "Spirit", power: 1 }), ...Array.from({ length: 6 }, (_, i) => ac({ kind: "enchantment", name: `Rule ${i}`, binds: true }))];
  const between = [ac({ name: "Bear", power: 3 }), ac({ name: "Cub", power: 2 }), ...Array.from({ length: 2 }, (_, i) => ac({ kind: "enchantment", name: `Rule ${i}`, binds: true }))];

  it("chooses by the creatures' share of the non-mana weight", () => {
    expect(creatureShare(creatureHeavy)!).toBeGreaterThan(SELECT.toReady);
    expect(creatureShare(creatureLight)!).toBeLessThan(SELECT.toWorks);
    expect(policyFor(creatureHeavy, null, CLOCK).policy.id).toBe("ready-tapped");
    expect(policyFor(creatureLight, null, CLOCK).policy.id).toBe("works");
    expect(creatureShare([ac({ kind: "land", name: "Forest" })])).toBeNull();
  });

  it("holds within a turn and between the thresholds", () => {
    const s = creatureShare(between)!;
    expect(s).toBeGreaterThan(SELECT.toWorks);
    expect(s).toBeLessThan(SELECT.toReady);
    const mem = (policy: string, since: number): ContainerMemory => ({ v: 2, container: "rest:ana", selection: { policy, since }, arrivals: { next: 0, seq: {} }, policies: {} });
    // the same turn: whatever the board says now, the choice holds
    expect(policyFor(creatureHeavy, mem("works", CLOCK.turn), CLOCK).policy.id).toBe("works");
    // a later turn, between the thresholds: it holds either way
    expect(policyFor(between, mem("works", 1), CLOCK).policy.id).toBe("works");
    expect(policyFor(between, mem("ready-tapped", 1), CLOCK).policy.id).toBe("ready-tapped");
    // past a threshold at a new turn: it switches
    expect(policyFor(creatureHeavy, mem("works", 1), CLOCK).policy.id).toBe("ready-tapped");
  });

  it("switching back restores the places each policy kept (memory per policy)", () => {
    resetIds(1);
    const cards = [ac({ name: "Dack", commander: true, power: 3 }), ...Array.from({ length: 6 }, (_, i) => ac({ kind: "enchantment", name: `Rule ${i}`, binds: true })), ...Array.from({ length: 5 }, (_, i) => ac({ name: `Spirit ${i}`, power: 1 }))];
    const a = run({ cards, policy: readyTapped });
    const b = run({ cards, policy: works, memory: a.fit.memory, clock: { turn: 6 } });
    const c = run({ cards, policy: readyTapped, memory: b.fit.memory, clock: { turn: 6, phase: "MAIN1" } });
    expect(Object.keys(b.fit.memory.policies).sort()).toEqual(["ready-tapped", "works"]);
    expect(c.fit.units.map((u) => [u.id, u.slot])).toEqual(a.fit.units.map((u) => [u.id, u.slot]));
  });
});
