/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boards, hitTest, planTable, tableInputOf } from "../../../src/layout";
import type { TablePlan } from "../../../src/layout";
import { ARRANGED } from "../../../src/layout/arrange/adapter";
import type { ArrCard, ArrangeResult, ContainerMemory } from "../../../src/layout/arrange/contract";
import { mineContainer } from "../../../src/layout/arrange/mine";
import { mine } from "../../../src/layout/arrange/policies/mine";
import { pinhole } from "../../../src/layout/projector";
import { reservations } from "../../../src/layout/reservations";
import { bounds, inQuad } from "../../../src/layout/shape";
import { tableTemplate } from "../../../src/layout/template";
import type { CardId, Viewport } from "../../../src/layout/types";
import { designUnit } from "../../../src/layout/types";
import { pickDrawn } from "../../../src/scene/stage/pick";
import { designModels } from "../../../src/scene/workbench/bench-inputs";
import type { Run } from "./cards";
import { ME, ac, many, resetIds, run } from "./cards";
import { digest } from "./digest";

// Step 9: my side on the engine. One row on the template's field line: what stands in the middle, my works lying from
// the left end, my mana from the right; folds by the `mine` ladder; drawn as my seat's plan, reached as any leaf.

const VIEWPORTS: readonly Viewport[] = [
  { w: 1210, h: 834 },
  { w: 1180, h: 820 },
  { w: 1024, h: 768 },
  { w: 1366, h: 1024 },
];
const IPAD = VIEWPORTS[0]!;
const design = designModels(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")));

const side = (vp: Viewport = IPAD) => {
  const tpl = tableTemplate(4), projector = pinhole(tpl.camera, vp);
  return mineContainer({ seat: ME, slot: tpl.slots[0]!, tpl, projector, reserve: reservations(vp, "normal") });
};
const mineRun = (r: Omit<Run, "policy" | "container">): ArrangeResult => run({ ...r, policy: mine, container: side(r.vp), clock: { active: ME, ...r.clock } });
const me = (o: Parameters<typeof ac>[0]): ArrCard => ac({ controller: ME, ...o });
const unitOf = (r: ArrangeResult, id: number) => r.fit.units.find((u) => u.members.includes(id as CardId) || u.dressing.includes(id as CardId))!;
const across = (r: ArrangeResult, id: number): number => unitOf(r, id).cards.find((c) => c.card === unitOf(r, id).top)!.foot.x;

describe("my side's policy (`mine`)", () => {
  it("one row: what stands in the middle, works from the left end, mana from the right; nothing over its limits", () => {
    resetIds();
    const cards = [me({ name: "Bear", power: 2 }), me({ name: "Wurm", power: 6 }), me({ kind: "artifact", name: "Signet Press" }), ...many(3, { kind: "land", name: "Forest", basic: true, controller: ME }), me({ kind: "rock", name: "Sol Ring" })];
    const r = mineRun({ cards });
    expect(r.overflow).toBeNull();
    expect(r.fit.report.violations).toEqual([]);
    expect(r.fit.rows).toHaveLength(1);
    const [bear, wurm, press, forest, ring] = [1, 2, 3, 4, 7].map((id) => across(r, id));
    expect(Math.abs(wurm!)).toBeLessThan(2);
    expect(press!).toBeLessThan(Math.min(bear!, wurm!));
    expect(Math.min(forest!, ring!)).toBeGreaterThan(Math.max(bear!, wurm!));
    // creatures stand; the rest lie in their places; basics are one block
    for (const id of [1, 2]) expect(unitOf(r, id).cards.at(-1)!.posture).toBe("stand");
    for (const id of [3, 4, 7]) expect(unitOf(r, id).cards.at(-1)!.posture).toBe("lie");
    expect(unitOf(r, 4).kind).toBe("stack");
    expect(unitOf(r, 4).members).toHaveLength(3);
  });

  it("a creature-light board: engines stand with the creatures, plain works lie at the left", () => {
    resetIds();
    const cards = [
      me({ kind: "enchantment", name: "Rhystic Study", binds: true }),
      me({ kind: "artifact", name: "Bolas's Citadel", legendary: true }),
      me({ kind: "artifact", name: "Coat of Arms" }),
      me({ kind: "planeswalker", name: "Teferi", loyalty: 5 }),
      me({ name: "Thopter", power: 1, token: true, also: ["artifact"] }),
      ...many(6, { kind: "land", name: "Island", basic: true, controller: ME }),
    ];
    const r = mineRun({ cards });
    expect(r.fit.report.violations).toEqual([]);
    for (const id of [1, 2, 4, 5]) expect(unitOf(r, id).cards.at(-1)!.posture, String(id)).toBe("stand");
    expect(unitOf(r, 3).cards.at(-1)!.posture).toBe("lie");
    expect(unitOf(r, 3).tier).toBe("works");
    expect(across(r, 3)).toBeLessThan(Math.min(...[1, 2, 4, 5].map((id) => across(r, id))));
  });

  it("crowded: thirty tokens, forty lands, ten rocks and a dozen creatures fold into piles in one row, every card held", () => {
    resetIds();
    const cards = [
      ...many(24, { name: "Soldier", power: 1, token: true, controller: ME }),
      ...many(6, { name: "Soldier", power: 1, token: true, tapped: true, controller: ME }),
      ...Array.from({ length: 12 }, (_, i) => me({ name: `Creature ${i}`, power: 1 + (i % 5) })),
      ...many(20, { kind: "land", name: "Plains", basic: true, controller: ME }),
      ...Array.from({ length: 20 }, (_, i) => me({ kind: "land", name: `Utility land ${i}` })),
      ...Array.from({ length: 10 }, (_, i) => me({ kind: "rock", name: `Rock ${i}` })),
      ...Array.from({ length: 5 }, (_, i) => me({ kind: "enchantment", name: `Aura engine ${i}` })),
    ];
    const r = mineRun({ cards });
    expect(r.overflow).toBeNull();
    expect(r.fit.report.violations).toEqual([]);
    expect(new Set(r.fit.home.keys())).toEqual(new Set(cards.map((c) => c.id)));
    expect(r.fit.units.length).toBeLessThanOrEqual(r.fit.rows[0]!.places);
    // nothing shrinks: every card at the table's one size
    expect(r.fit.scale).toBeCloseTo(1.85, 6);
    const fans = r.fit.units.filter((u) => u.kind === "fan").map((u) => u.tier).sort();
    expect(fans).toEqual(["mana", "muster", "works"]);
  });

  it("a pile holding a card I can use says so: the card is named on the pile's unit", () => {
    resetIds();
    const lands = Array.from({ length: 16 }, (_, i) => me({ kind: "land", name: `Utility land ${i}` }));
    const creatures = Array.from({ length: 9 }, (_, i) => me({ name: `Creature ${i}`, power: 2 + i }));
    const cards = [...lands, ...creatures];
    // while I hold priority what I can play is usable: light, never moved
    const r = mineRun({ cards, acting: { usable: new Set([lands[9]!.id]), choosing: true } });
    const pile = unitOf(r, lands[9]!.id);
    expect(pile.kind).toBe("fan");
    expect(r.fit.attention).toContainEqual({ unit: pile.id, cards: [lands[9]!.id], why: "offered" });
    expect(pile.notable).toContainEqual({ card: lands[9]!.id, cue: "act" });
  });

  it("what a decision offers steps out of my piles where the row holds it, else its pile opens with it lit", () => {
    resetIds();
    const lands = Array.from({ length: 16 }, (_, i) => me({ kind: "land", name: `Utility land ${i}` }));
    const creatures = Array.from({ length: 6 }, (_, i) => me({ name: `Creature ${i}`, power: 2 + i }));
    const cards = [...lands, ...creatures];
    const rest = mineRun({ cards });
    expect(unitOf(rest, lands[3]!.id).kind).toBe("fan");
    // a target among my lands: it lies on its own, where it can be tapped
    const two = mineRun({ cards, memory: rest.fit.memory, acting: { offered: new Set([lands[3]!.id, lands[9]!.id]), choosing: true } });
    for (const l of [lands[3]!, lands[9]!]) expect(unitOf(two, l.id).members, l.name).toEqual([l.id]);
    expect(two.fit.report.violations).toEqual([]);
    expect(two.overflow).toBeNull();
    // every land offered (a payment): more than the row holds, so they fold as at rest and the pile names them
    const all = mineRun({ cards, memory: rest.fit.memory, acting: { offered: new Set(lands.map((l) => l.id)), choosing: true } });
    const pile = unitOf(all, lands[3]!.id);
    expect(pile.kind).toBe("fan");
    expect(all.fit.attention.some((a) => a.unit === pile.id && a.why === "offered")).toBe(true);
  });

  it("classification follows current types: a stationed spacecraft that becomes a creature stands with the creatures", () => {
    resetIds();
    const others = [me({ name: "Bear", power: 2 }), ...many(3, { kind: "land", name: "Island", basic: true, controller: ME })];
    const craft = (creature: boolean) => me({ id: 50, kind: "artifact", name: "Spacecraft", subtypes: ["Spacecraft"], ...(creature ? { also: ["creature"], power: 5 } : {}) });
    const before = mineRun({ cards: [...others, craft(false)] });
    expect(unitOf(before, 50).tier).toBe("works");
    const after = mineRun({ cards: [...others, craft(true)], memory: before.fit.memory, clock: { turn: 6 } });
    expect(unitOf(after, 50).tier).toBe("field");
    expect(unitOf(after, 50).cards.at(-1)!.posture).toBe("stand");
  });

  it("a card whose data had not arrived is placed by what it is once it has, not held where its guess put it", () => {
    resetIds();
    const others = [me({ id: 1, name: "Bear", power: 2 }), me({ id: 2, name: "Wurm", power: 6 }), me({ id: 3, kind: "artifact", name: "Coat of Arms" })];
    const guessed = { ...me({ id: 9, kind: "artifact", name: "Mind Stone" }), provisional: true };
    const a = mineRun({ cards: [...others, guessed] });
    expect(unitOf(a, 9).tier).toBe("works");
    const b = mineRun({ cards: [...others, me({ id: 9, kind: "rock", name: "Mind Stone" })], memory: a.fit.memory });
    expect(unitOf(b, 9).tier).toBe("mana");
    expect(unitOf(b, 9).retyped).toBe(false);
    expect(across(b, 9)).toBeGreaterThan(Math.max(across(b, 1), across(b, 2)));
    // what was known stays where it was
    for (const id of [1, 2, 3]) expect(unitOf(b, id).slot, String(id)).toEqual(unitOf(a, id).slot);
  });

  it("a card that taps turns in place: only its turn changes", () => {
    resetIds();
    const cards = [me({ id: 1, name: "Bear", power: 2 }), me({ id: 2, name: "Wurm", power: 6 }), me({ id: 3, kind: "land", name: "Temple" })];
    const a = mineRun({ cards });
    const b = mineRun({ cards: cards.map((c) => (c.id === 1 ? { ...c, tapped: true } : c)), memory: a.fit.memory });
    expect(unitOf(b, 1).slot).toEqual(unitOf(a, 1).slot);
    expect(unitOf(b, 1).cards.at(-1)!.turn).toBe("quarter");
    for (const id of [2, 3]) expect(unitOf(b, id).slot, String(id)).toEqual(unitOf(a, id).slot);
  });

  it("re-sorts at the start of a turn: a newcomer waits in a free place, then the row deals by rank", () => {
    resetIds();
    const cards = [me({ id: 1, name: "Bear", power: 2 }), me({ id: 2, name: "Elf", power: 1 })];
    const a = mineRun({ cards, clock: { turn: 5, phase: "MAIN1" } });
    const big = me({ id: 3, name: "Dragon", power: 7 });
    const b = mineRun({ cards: [...cards, big], memory: a.fit.memory, clock: { turn: 5, phase: "MAIN1" } });
    for (const id of [1, 2]) expect(unitOf(b, id).slot, String(id)).toEqual(unitOf(a, id).slot);
    const c = mineRun({ cards: [...cards, big], memory: b.fit.memory, clock: { turn: 6, phase: "UPKEEP" } });
    expect(unitOf(c, 3).slot.place).toBe(0);
  });

  it("deterministic and order-independent; its memory survives JSON", () => {
    resetIds();
    const cards = [...many(5, { name: "Goblin", power: 1, token: true, controller: ME }), me({ name: "Krenko", power: 3, legendary: true }), ...many(8, { kind: "land", name: "Mountain", basic: true, controller: ME })];
    const a = mineRun({ cards }), b = mineRun({ cards: [...cards].reverse() });
    expect(digest(b.fit, cards, b.overflow)).toBe(digest(a.fit, cards, a.overflow));
    const m = JSON.parse(JSON.stringify(a.fit.memory)) as ContainerMemory;
    expect(digest(mineRun({ cards, memory: m }).fit, cards, null)).toBe(digest(mineRun({ cards, memory: a.fit.memory }).fit, cards, null));
  });

  it("holds its places at every supported viewport: eleven, each face over my floor", () => {
    for (const vp of VIEWPORTS) {
      const r = mineRun({ cards: [me({ name: "Bear", power: 2 })], vp });
      expect(r.fit.rows[0]!.places, `${vp.w}`).toBe(11);
      expect(r.fit.report.violations, `${vp.w}`).toEqual([]);
    }
  });
});

describe("my side drawn on the table", () => {
  const planned = (turn: number, vp: Viewport): TablePlan => planTable(tableInputOf(design.get(turn)!, { viewport: vp, engine: { draw: true } }));

  it("the design pass's tables: my seat plan is the engine's, every card held, every unit reached in its place and by its face", () => {
    for (const vp of VIEWPORTS)
      for (const turn of [4, 9, 15]) {
        const m = design.get(turn)!, plan = planned(turn, vp), label = `${vp.w} turn ${turn}`;
        const seat = m.viewer.perspective, sp = plan.seats.get(seat)!;
        expect(sp.memory.paradigm, label).toBe(ARRANGED);
        expect(plan.mine!.result!.fit.report.violations, label).toEqual([]);
        expect(plan.violations, label).toEqual([]);
        const mineIds = boards(m).find((b) => b.seat === seat)!.board.cards.map((c) => c.id);
        expect(new Set(sp.home.keys()), label).toEqual(new Set(mineIds));
        for (const u of sp.units) {
          const g = plan.hits.groups.find((x) => x.id === u.id)!;
          expect(g, `${label} ${u.id}`).toBeDefined();
          const b = bounds(g.quad);
          expect(hitTest(plan, { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 })?.id, `${label} ${u.id} in its place`).toBe(u.id);
          // faces first: a tap on its face's middle, where nothing is drawn over it, reaches it
          if (!g.face) continue;
          const f = bounds(g.face), mid = { x: (f.l + f.r) / 2, y: (f.t + f.b) / 2 };
          if (plan.hits.groups.some((o) => o !== g && o.order >= g.order && inQuad(o.face ?? o.quad, mid.x, mid.y))) continue;
          expect(pickDrawn(plan, new Map(), mid)?.id, `${label} ${u.id} by its face`).toBe(u.id);
        }
      }
  });

  it("my field's tops leave the middle more room than mat's: duels and the stack rest there", () => {
    for (const turn of [9, 15]) {
      const m = design.get(turn)!, u = designUnit(IPAD);
      const engine = planned(turn, IPAD), mat = planTable(tableInputOf(m, { viewport: IPAD, engine: { draw: true, mine: false } }));
      expect(engine.fieldTop, `turn ${turn}`).toBeGreaterThan(mat.fieldTop + 20 * u);
      // nothing of mine reaches under the hand or the prompt
      const reserve = engine.reserve.items.map((i) => i.rect);
      for (const g of engine.hits.groups.filter((x) => x.seat === m.viewer.perspective && x.kind !== "plate" && x.kind !== "zone")) {
        const b = bounds(g.quad);
        for (const r of reserve) expect(b.r <= r.left || b.l >= r.right || b.b <= r.top || b.t >= r.bottom, `${turn} ${g.id}`).toBe(true);
      }
    }
  });
});

describe("goldens: my side", () => {
  it("the design pass's turns 4, 9 and 15, a crowded side and a creature-light one", async () => {
    const parts: string[] = [];
    for (const turn of [4, 9, 15]) {
      const plan = planTable(tableInputOf(design.get(turn)!, { viewport: IPAD, engine: { draw: true } }));
      const l = plan.mine!;
      parts.push(`== mine, turn ${turn} (${l.input!.cards.length} permanents)\n${digest(l.result!.fit, l.input!.cards, l.result!.overflow)}`);
    }
    resetIds(500);
    const crowded = [
      ...many(20, { name: "Saproling", power: 1, token: true, controller: ME }),
      ...many(8, { name: "Saproling", power: 1, token: true, tapped: true, controller: ME }),
      ...Array.from({ length: 10 }, (_, i) => me({ name: `Creature ${i}`, power: 1 + i })),
      ...many(14, { kind: "land", name: "Forest", basic: true, controller: ME }),
      ...Array.from({ length: 12 }, (_, i) => me({ kind: "land", name: `Land ${i}`, tapped: i < 4 })),
      ...Array.from({ length: 6 }, (_, i) => me({ kind: "rock", name: `Rock ${i}` })),
    ];
    const c = mineRun({ cards: crowded });
    parts.push(`== mine, crowded (${crowded.length} permanents)\n${digest(c.fit, crowded, c.overflow)}`);
    resetIds(700);
    const light = [
      me({ kind: "enchantment", name: "Rhystic Study", binds: true }),
      me({ kind: "artifact", name: "The One Ring", legendary: true, counters: 2 }),
      me({ kind: "artifact", name: "Coat of Arms" }),
      me({ kind: "enchantment", name: "Propaganda", binds: true }),
      me({ kind: "artifact", name: "Mind Stone", also: ["rock"] }),
      me({ name: "Thopter", power: 1, token: true, also: ["artifact"] }),
      ...many(7, { kind: "land", name: "Island", basic: true, controller: ME }),
      me({ kind: "land", name: "Command Tower" }),
    ];
    const l = mineRun({ cards: light });
    parts.push(`== mine, creature-light (${light.length} permanents)\n${digest(l.fit, light, l.overflow)}`);
    await expect(parts.join("\n\n") + "\n").toMatchFileSnapshot("__goldens__/mine.txt");
  });
});
