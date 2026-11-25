import { describe, expect, it } from "vitest";
import type { ArrCard, ArrangeResult, Arrangement, FoldStep, Group, Policy, TierSpec } from "../../../src/layout/arrange/contract";
import { PARTED } from "../../../src/layout/arrange/leaf";
import { readyTapped } from "../../../src/layout/arrange/policies/ready-tapped";
import { works } from "../../../src/layout/arrange/policies/works";
import { collect, emphasisOf, factsOf, mattersOf, promoteRule, seatOf, tidyRule, topOf } from "../../../src/layout/arrange/policies/common";
import { S_TABLE } from "../../../src/layout/arrange/scale";
import { clearArrangeCaches } from "../../../src/layout/arrange/memo";
import { BATCHING } from "../../../src/layout/arrange/solver";
import type { CardId } from "../../../src/layout/types";
import { prng } from "../boards";
import { SUPPORTED, THEM, ac, board, many, resetIds, run } from "./cards";
import type { Run } from "./cards";

// The guarantees (§1.4) as properties over seeded boards (§7.1), every registered policy and seeded legal chaos policies.

const SEEDS = [1, 2, 3, 5, 8, 13];
const SIZES = [0, 1, 6, 15, 30, 60, 100, 150];

/** Units, places and postures: what a moment or a pose must never change. */
const shape = (a: Arrangement) =>
  a.units.map((u) => ({ id: u.id, kind: u.kind, tier: u.tier, slot: u.slot, members: u.members, cards: u.cards.map((c) => [c.card, c.posture, c.turn, c.layer, c.foot]) }));

const everyCard = (r: ArrangeResult) => r.fit.units.flatMap((u) => [...u.members, ...u.dressing]);

/** Members not drawn as their own face: under a stack's or fan's top, in a summary. */
const hidden = (a: Arrangement): CardId[] => a.units.flatMap((u) => (u.kind === "summary" ? u.members : u.kind === "card" ? [] : u.members.slice(1)));
const shown = (a: Arrangement): CardId[] => a.units.flatMap((u) => (u.kind === "summary" || u.top === null ? [] : [u.top]));

describe("partition, reach and fit within bounds", () => {
  for (const policy of [readyTapped, works])
    for (const vp of SUPPORTED)
      it(`${policy.id} at ${vp.w}x${vp.h}: every card in exactly one unit, reachable, no limit broken`, () => {
        for (const seed of SEEDS)
          for (const n of SIZES) {
            const cards = board(seed * 97 + n, n);
            const r = run({ cards, policy, vp });
            const held = everyCard(r);
            expect(new Set(held).size, `seed ${seed} n ${n}`).toBe(held.length);
            expect(new Set(held), `seed ${seed} n ${n}`).toEqual(new Set(cards.map((c) => c.id)));
            expect([...r.fit.home.keys()].sort((a, b) => a - b)).toEqual(cards.map((c) => c.id).sort((a, b) => a - b));
            // every unit has exactly one target, stamped with its cards
            for (const u of r.fit.units) {
              const ts = r.fit.targets.filter((t) => t.piece === u.id);
              expect(ts.length).toBe(1);
              expect(new Set(ts[0]!.members)).toEqual(new Set([...u.members, ...u.dressing]));
            }
            expect(r.overflow, `seed ${seed} n ${n}: ${JSON.stringify(r.fit.report.violations)}`).toBeNull();
            expect(r.fit.report.policyInvalid).toBeNull();
          }
      });
});

describe("one size", () => {
  it("every card on the table is S_table, for 1 card and for 150", () => {
    for (const n of [1, 150]) expect(run({ cards: board(4, n) }).fit.scale).toBe(S_TABLE);
  });
});

describe("determinism, order independence, memory as JSON, the fixed point", () => {
  it("the same input gives the same output whatever the card order", () => {
    for (const seed of SEEDS) {
      const cards = board(seed, 40), rnd = prng(seed);
      const shuffled = [...cards].sort(() => rnd() - 0.5);
      expect(JSON.stringify(run({ cards: shuffled }).fit, mapJson)).toBe(JSON.stringify(run({ cards }).fit, mapJson));
    }
  });

  it("what is kept between plans changes nothing: a kept arrangement is the one computing it gives, and any change misses", () => {
    for (const seed of SEEDS) {
      const cards = board(seed, 50);
      const a = run({ cards });
      clearArrangeCaches();
      const b = run({ cards });
      expect(JSON.stringify(b.fit, mapJson)).toBe(JSON.stringify(a.fit, mapJson));
      expect(run({ cards })).toBe(b); // the same input: kept
      const tapped = cards.map((c, i) => (i === 3 ? { ...c, tapped: !c.tapped } : c));
      const t = run({ cards: tapped });
      expect(t).not.toBe(b);
      clearArrangeCaches();
      expect(JSON.stringify(run({ cards: tapped }).fit, mapJson)).toBe(JSON.stringify(t.fit, mapJson));
    }
  });

  it("batching moves out of an overflowing band changes nothing: the same arrangement, with fewer estimates", () => {
    for (const seed of [...SEEDS, 21, 34, 55])
      for (const n of [30, 60, 100, 150]) {
        const cards = board(seed * 13 + n, n);
        clearArrangeCaches();
        BATCHING.on = false;
        const plain = run({ cards });
        clearArrangeCaches();
        BATCHING.on = true;
        const batched = run({ cards });
        const { report: r1, ...a } = plain.fit, { report: r2, ...b } = batched.fit;
        expect(JSON.stringify(b, mapJson), `seed ${seed} n ${n}`).toBe(JSON.stringify(a, mapJson));
        expect(r2.edits.filter((e) => e.ran)).toEqual(r1.edits.filter((e) => e.ran));
        expect(r2.candidates).toBeLessThanOrEqual(r1.candidates);
      }
  });

  it("memory survives JSON, and a plan fed its own memory is a fixed point", () => {
    for (const seed of SEEDS) {
      const cards = board(seed, 50);
      const a = run({ cards });
      const json = JSON.parse(JSON.stringify(a.fit.memory));
      const b = run({ cards, memory: json });
      const c = run({ cards, memory: a.fit.memory });
      expect(JSON.stringify(b.fit, mapJson)).toBe(JSON.stringify(c.fit, mapJson));
      expect(shape(b.fit)).toEqual(shape(a.fit));
      const d = run({ cards, memory: b.fit.memory });
      expect(d.fit.memory).toEqual(b.fit.memory);
    }
  });
});

const unitOf = (r: ArrangeResult, c: number) => r.fit.units.find((u) => u.members.includes(c as CardId) || u.dressing.includes(c as CardId));
const mapJson = (_k: string, v: unknown) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v);

describe("stability (§3)", () => {
  it("a moment moves, turns and re-postures nothing: light and attention only", () => {
    for (const seed of SEEDS) {
      const cards = board(seed, 40), ids = cards.map((c) => c.id);
      const rest = run({ cards });
      const moments = [
        { q: "threat", seat: THEM },
        { q: "strike", draft: [], airborne: true, options: [] },
        { q: "aim", legal: ids.slice(0, 5) },
        { q: "sweep", reaches: ids.filter((_, i) => i % 2 === 0), caster: null },
        { q: "fight", attacker: THEM, attackers: ids.slice(0, 2), blocked: [], blockers: [] },
      ] as const;
      for (const moment of moments) expect(shape(run({ cards, moment, memory: rest.fit.memory }).fit), moment.q).toEqual(shape(run({ cards, memory: rest.fit.memory }).fit));
    }
  });

  it("a single card tapping turns in its place and moves nothing else", () => {
    resetIds(1);
    const cards = [ac({ commander: true, power: 4 }), ac({ name: "Wurm", power: 6 }), ac({ name: "Angel", power: 4, keywords: ["flying"] }), ac({ name: "Knight", power: 2 }), ...many(3, { kind: "land", basic: true, name: "Forest" })];
    const a = run({ cards });
    const tapped = cards.map((c) => (c.name === "Angel" ? { ...c, tapped: true } : c));
    const b = run({ cards: tapped, memory: a.fit.memory, clock: { phase: "MAIN1" } });
    const angel = cards.find((c) => c.name === "Angel")!.id;
    const ua = a.fit.units.find((u) => u.members.includes(angel))!, ub = b.fit.units.find((u) => u.members.includes(angel))!;
    expect(ub.slot).toEqual(ua.slot);
    expect(ub.cards[0]!.turn).toBe("quarter");
    expect(ub.cards[0]!.posture).toBe("lie");
    const others = (r: ArrangeResult) => shape(r.fit).filter((u) => !u.members.includes(angel));
    expect(others(b)).toEqual(others(a));
  });

  it("an arrival that needs no fold takes a free place; everything else stays", () => {
    resetIds(1);
    const cards = [ac({ commander: true, power: 4 }), ac({ name: "Wurm", power: 6 }), ...many(2, { kind: "land", basic: true, name: "Forest" })];
    const a = run({ cards });
    const b = run({ cards: [...cards, ac({ name: "Elf", power: 1 })], memory: a.fit.memory, clock: { phase: "MAIN2" } });
    for (const u of a.fit.units) expect(b.fit.units.find((x) => x.id === u.id)?.slot).toEqual(u.slot);
    expect(b.fit.units.length).toBe(a.fit.units.length + 1);
  });

  it("a fold holds until the open form needs a whole place less than the room, and then releases", () => {
    resetIds(1);
    // nine standing units in a band of eight places: the weakest is demoted to the rest
    const cmd = ac({ id: 1, name: "Marath", commander: true, power: 9 });
    const bodies = Array.from({ length: 8 }, (_, i) => ac({ id: 10 + i, name: `Body ${i}`, power: 2 + i }));
    const a = run({ cards: [cmd, ...bodies] });
    const demoted = a.fit.report.edits.filter((e) => e.ran && e.op === "demote");
    expect(demoted.map((e) => e.groups)).toEqual([[`cr:${bodies[0]!.lookKey}:r`]]);
    expect(unitOf(a, 10)!.tier).toBe("rest");
    // one leaves, then a second: the open form would need 8 then 7 of 8 places; the fold holds while it needs 8 + 1
    const without = (n: number) => [cmd, ...bodies.filter((_, i) => i === 0 || i > n)];
    const b = run({ cards: without(1), memory: a.fit.memory });
    expect(unitOf(b, 10)!.tier).toBe("rest");
    const c = run({ cards: without(2), memory: b.fit.memory });
    expect(unitOf(c, 10)!.tier).toBe("ready");
  });
});

describe("attention: nothing that matters is hidden silently", () => {
  it("every hidden card that matters, and every hidden offered card, is named; nothing shown is", () => {
    for (const seed of SEEDS)
      for (const n of [30, 80, 150]) {
        const cards = board(seed + n, n);
        const offered = new Set(cards.filter((_, i) => i % 7 === 0).map((c) => c.id));
        const r = run({ cards, acting: { offered, choosing: true } });
        const named = new Set(r.fit.attention.flatMap((a) => a.cards));
        const byId = new Map(cards.map((c) => [c.id, c]));
        const stackOf = new Set(r.fit.units.filter((u) => u.kind === "stack").flatMap((u) => u.members.slice(1)));
        for (const id of hidden(r.fit)) {
          const c = byId.get(id)!;
          const matters = offered.has(id) || (!stackOf.has(id) && readyTapped.matters(c, { q: "rest" }, { viewer: "you" as never, owner: THEM, mine: false, cards: byId, acting: { involved: new Set(), offered, usable: new Set(), choosing: true }, clock: { turn: 5, phase: "MAIN1", active: THEM, settling: false } }) !== null);
          if (matters) expect(named.has(id), `card ${id} (${c.name}) hidden in a pile`).toBe(true);
        }
        for (const id of shown(r.fit)) expect(named.has(id), `card ${id} is shown whole`).toBe(false);
      }
  });

  it("a deathtouch creature at the bottom of a rest fan is notable, cued as a threat", () => {
    resetIds(1);
    const cards = [ac({ commander: true, power: 6 }), ...Array.from({ length: 14 }, (_, i) => ac({ name: `Bear ${i}`, power: 2 + (i % 2) })), ac({ name: "Snake", power: 1, keywords: ["deathtouch"] }), ...many(4, { name: "Rat", power: 1, tapped: true })];
    const r = run({ cards });
    const snake = cards.find((c) => c.name === "Snake")!.id;
    const fan = r.fit.units.find((u) => u.members.includes(snake))!;
    expect(fan.kind).toBe("fan");
    expect(fan.notable.map((x) => x.card)).toContain(snake);
    expect(fan.notable.find((x) => x.card === snake)!.cue).toBe("threat");
    expect(fan.notable.length).toBeLessThanOrEqual(2);
  });
});

describe("posture constraints (§2.2) and acting cards (§2.7)", () => {
  it("no tapped card and no mana source stands; acting cards stand out of their piles with their own targets", () => {
    for (const seed of SEEDS) {
      const cards = board(seed, 60);
      const acting = new Set(cards.filter((c) => c.types.creature && !c.tapped).slice(0, 3).map((c) => c.id));
      const r = run({ cards, acting: { involved: acting } });
      const byId = new Map(cards.map((c) => [c.id, c]));
      for (const u of r.fit.units)
        for (const p of u.cards)
          if (p.posture === "stand") {
            expect(byId.get(p.card)!.tapped).toBe(false);
            expect(byId.get(p.card)!.types.creature || !byId.get(p.card)!.manaSource).toBe(true);
          }
      for (const id of acting) {
        const u = r.fit.units.find((x) => x.members.includes(id))!;
        expect(u.members).toEqual([id]);
        expect(u.acting).toBe(true);
        expect(u.cards.find((p) => p.card === id)!.posture).toBe("stand");
      }
    }
  });

  it("acting cards past every standing place are reached through the entry, said as an overflow", () => {
    resetIds(1);
    const cards = Array.from({ length: 12 }, (_, i) => ac({ name: `Soldier ${i}`, power: 2 }));
    const r = run({ cards, acting: { involved: new Set(cards.map((c) => c.id)) } });
    expect(r.overflow?.reason).toBe("actors");
    expect(r.overflow?.ask).toEqual({ kind: "focus", role: "spread" });
    const placed = new Set(r.fit.units.flatMap((u) => u.members));
    expect(r.overflow!.cards.every((id) => !placed.has(id))).toBe(true);
    expect(r.fit.attention.some((a) => a.unit === "plate:ana" && a.why === "aimed")).toBe(true);
  });
});

describe("current types (§1.2, designer §5)", () => {
  it("a work that becomes a creature stands in its place at once, as its own unit, and moves at the next re-sort", () => {
    resetIds(1);
    const base = [ac({ commander: true, power: 4 }), ac({ name: "Wurm", power: 6 }), ...many(3, { kind: "land", basic: true, name: "Forest" })];
    const ship = ac({ id: 99, kind: "artifact", name: "Hearthhull", subtypes: ["Spacecraft"] });
    const a = run({ cards: [...base, ship] });
    const before = a.fit.units.find((u) => u.members.includes(ship.id))!;
    expect(before.tier).toBe("works");
    const crewed = { ...ship, types: { ...ship.types, creature: true }, power: 6, toughness: 7, lookKey: ship.lookKey + "|c" };
    const b = run({ cards: [...base, crewed], memory: a.fit.memory, clock: { phase: "MAIN1" } });
    const now = b.fit.units.find((u) => u.members.includes(ship.id))!;
    expect(now.retyped).toBe(true);
    expect(now.members).toEqual([ship.id]);
    expect(now.tier).toBe("works");
    expect(now.cards.find((p) => p.card === ship.id)!.posture).toBe("stand");
    // the next phase change re-sorts (something changed): it walks to the creature rows
    const c = run({ cards: [...base, crewed], memory: b.fit.memory, clock: { phase: "COMBAT_BEGIN" } });
    const moved = c.fit.units.find((u) => u.members.includes(ship.id))!;
    expect(moved.retyped).toBe(false);
    expect(moved.tier).toBe("ready");
    // a Vehicle crewed and back before the re-sort never travels
    const d = run({ cards: [...base, ship], memory: b.fit.memory, clock: { phase: "MAIN1" } });
    const back = d.fit.units.find((u) => u.members.includes(ship.id))!;
    expect(back.retyped).toBe(false);
    expect(back.tier).toBe("works");
  });
});

describe("poses (§5.3)", () => {
  it("a pose changes nothing in the arrangement; its audit is reported", () => {
    for (const seed of SEEDS) {
      const cards = board(seed, 40);
      const a = run({ cards }), b = run({ cards, poses: [PARTED] });
      expect(shape(b.fit)).toEqual(shape(a.fit));
      expect(b.fit.report.poses.map((p) => p.id)).toEqual(["parted"]);
    }
  });
});

describe("bounded search (§5.1)", () => {
  it("estimates at most one per edit and row, audits at most six", () => {
    for (const seed of SEEDS)
      for (const n of SIZES) {
        const r = run({ cards: board(seed, n) });
        expect(r.fit.report.audits).toBeLessThanOrEqual(6);
        expect(r.fit.report.candidates).toBeLessThanOrEqual(r.fit.report.audits * (r.fit.report.edits.length + 1) * 3);
      }
  });
});

// ---- policies that are not ours: chaos, and invalid ------------------------------------------------------------------

/** A legal random policy: random grouping, tiers in random rows, random importance, a random ladder. */
function chaos(seed: number): Policy {
  const rnd = prng(seed);
  // any number of tiers, standing and lying in any order: the space decides how many rows each band gets
  const tiers: TierSpec[] = Array.from({ length: 2 + Math.floor(rnd() * 4) }, (_, i) => ({ id: `t${i}`, posture: rnd() < 0.5 ? "stand" : "lie", markers: rnd() < 0.7, proud: rnd() < 0.5 }));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const salt = Math.floor(rnd() * 1000);
  const tierFor = (g: Group) => tiers[(g.members[0]! * 31 + salt) % tiers.length]!.id;
  const later = (t: string) => tiers.slice(tiers.findIndex((x) => x.id === t) + 1);
  const ladder: FoldStep[] = [];
  for (let i = 0; i < 6; i++) {
    const t = pick(tiers).id, op = pick(["stack", "fan", "demote", "split-spent"] as const);
    if (op === "stack") ladder.push({ op, where: { tier: t, stacks: true } });
    else if (op === "fan") ladder.push({ op, where: { tier: t }, show: 1 + Math.floor(rnd() * 6) });
    else if (later(t).length) ladder.push({ op, where: { tier: t, ...(op === "split-spent" ? { spent: true } : {}) }, to: pick(later(t)).id });
  }
  ladder.push({ op: "summary", where: { all: true } });
  return {
    id: `chaos-${seed}`,
    tiers,
    group: (cards) => collect(cards, (c) => (rnd() < 2 ? `${(c.id * 7 + salt) % 5}:${c.lookKey}:${c.tapped}` : "")),
    importance: (g) => ((g.members[0]! * 13 + salt) % 17) + (g.members.length > 1 ? 1 : 0),
    tier: tierFor,
    presented: (g, ctx) => g.members.every((id) => !ctx.cards.get(id)!.tapped && !ctx.cards.get(id)!.manaSource && ctx.cards.get(id)!.types.creature),
    top: topOf,
    ladder,
    matters: mattersOf,
    facts: (u, ctx) => factsOf(u, ctx, tiers.at(-1)!.id),
    seat: seatOf,
    emphasis: emphasisOf,
    acting: "in-place",
    tidy: tidyRule,
    promote: promoteRule,
  };
}

describe("chaos policies: the guarantees hold for any legal policy", () => {
  it("partition, determinism and a target per unit, whatever the rules", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const policy = chaos(seed), cards = board(seed * 7, 10 + ((seed * 13) % 90));
      const r = run({ cards, policy });
      expect(r.fit.report.policyInvalid, `chaos ${seed}`).toBeNull();
      const held = r.fit.units.flatMap((u) => [...u.members, ...u.dressing]);
      const off = r.overflow?.reason === "actors" ? r.overflow.cards : [];
      expect(new Set([...held, ...off]).size).toBe(held.length + off.length);
      expect(new Set([...held, ...off])).toEqual(new Set(cards.map((c) => c.id)));
      for (const u of r.fit.units) expect(r.fit.targets.filter((t) => t.piece === u.id).length).toBe(1);
      expect(JSON.stringify(run({ cards: [...cards].reverse(), policy }).fit, mapJson)).toBe(JSON.stringify(r.fit, mapJson));
    }
  });
});

describe("invalid policies (§2.2): rejected, and ready-tapped stands in", () => {
  const cards = (): ArrCard[] => {
    resetIds(1);
    return [ac({ name: "Bear", power: 2 }), ac({ name: "Bear", power: 2, tapped: true }), ac({ kind: "land", name: "Forest" }), ac({ kind: "rock", name: "Sol Ring" })];
  };
  const bad: [string, Partial<Policy>][] = [
    ["a card in no group", { group: (cs) => collect(cs.slice(1), (c) => c.lookKey) }],
    ["a card in two groups", { group: (cs) => [...collect(cs, (c) => c.lookKey), { key: "dup", members: [cs[0]!.id], dressing: [], stacks: false }] }],
    ["an unknown tier", { tier: () => "nowhere" }],
    ["a top that is not a member", { top: () => 12345 as CardId }],
    ["a tapped card presented", { presented: () => true }],
    ["a demote to an earlier tier", { ladder: [{ op: "demote", where: { tier: "rest" }, to: "ready" }] }],
  ];
  for (const [what, patch] of bad)
    it(what, () => {
      const r = run({ cards: cards(), policy: { ...readyTapped, id: "broken", ...patch } as Policy });
      expect(r.fit.report.policyInvalid).not.toBeNull();
      expect(r.fit.policy).toBe("ready-tapped");
      expect(new Set(everyCard(r)).size).toBe(4);
    });
});

export type { Run };
