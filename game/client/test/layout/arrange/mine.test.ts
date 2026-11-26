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
const rawDesign = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as { stages: { turn: number; envelope: { view: Record<string, unknown> } }[]; catalog: unknown };
const design = designModels(rawDesign as never);

const side = (vp: Viewport = IPAD) => {
  const tpl = tableTemplate(4), projector = pinhole(tpl.camera, vp);
  return mineContainer({ seat: ME, slot: tpl.slots[0]!, tpl, projector, reserve: reservations(vp, "normal") });
};
const mineRun = (r: Omit<Run, "policy" | "container">): ArrangeResult => run({ ...r, policy: mine, container: side(r.vp), clock: { active: ME, ...r.clock } });
/** My side at rest, planned twice (its memory carried): the table as a moment finds it. */
const settled = (r: Omit<Run, "policy" | "container">): ArrangeResult => mineRun({ ...r, memory: mineRun(r).fit.memory });
const me = (o: Parameters<typeof ac>[0]): ArrCard => ac({ controller: ME, ...o });
const unitOf = (r: ArrangeResult, id: number) => r.fit.units.find((u) => u.members.includes(id as CardId) || u.dressing.includes(id as CardId))!;
const across = (r: ArrangeResult, id: number): number => unitOf(r, id).cards.find((c) => c.card === unitOf(r, id).top)!.foot.x;
/** How near me a unit lies (its top's foot, world z): my mana's tier lies in front of my field. */
const near = (r: ArrangeResult, id: number): number => unitOf(r, id).cards.find((c) => c.card === unitOf(r, id).top)!.foot.z;
const fieldRow = (r: ArrangeResult) => r.fit.rows.find((x) => x.posture === "stand")!;
const manaRow = (r: ArrangeResult) => r.fit.rows.find((x) => x.posture === "lie")!;

describe("my side's policy (`mine`)", () => {
  it("two tiers: my mana lies in front by kind; my field holds what stands with my works at its left; nothing over its limits", () => {
    resetIds();
    const cards = [me({ name: "Bear", power: 2 }), me({ name: "Wurm", power: 6 }), me({ kind: "artifact", name: "Signet Press" }), ...many(3, { kind: "land", name: "Forest", basic: true, controller: ME }), me({ kind: "rock", name: "Sol Ring" })];
    const r = mineRun({ cards });
    expect(r.overflow).toBeNull();
    expect(r.fit.report.violations).toEqual([]);
    expect(r.fit.rows.map((x) => x.posture)).toEqual(["lie", "stand"]);
    const [bear, wurm, press] = [1, 2, 3].map((id) => across(r, id));
    expect(press!).toBeLessThan(Math.min(bear!, wurm!));
    for (const id of [4, 7]) expect(near(r, id), String(id)).toBeGreaterThan(Math.max(near(r, 1), near(r, 2)) + 1);
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
    expect(r.fit.units.filter((u) => u.cards.at(-1)!.posture === "stand" || ["field", "muster", "works"].includes(u.tier)).length).toBeLessThanOrEqual(fieldRow(r).places);
    // nothing shrinks: every card at the table's one size
    expect(r.fit.scale).toBeCloseTo(1.85, 6);
    // my mana keeps its kinds (rocks, utility lands, basics apart) while folding what stands
    const fans = r.fit.units.filter((u) => u.kind === "fan").map((u) => u.tier).sort();
    expect(fans).toEqual(["lands", "muster", "rocks", "works"]);
    expect(unitOf(r, cards.find((c) => c.name === "Plains")!.id).kind).toBe("stack");
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

  it("while my field has room its units are one centred block: works at its left, what stands in the middle", () => {
    resetIds(100);
    const cards = [me({ id: 1, name: "Bear", power: 2 }), me({ id: 2, name: "Wurm", power: 6 }), me({ id: 3, kind: "artifact", name: "Coat of Arms" }), me({ id: 4, kind: "rock", name: "Sol Ring" }), ...many(3, { kind: "land", name: "Island", basic: true, controller: ME })];
    const r = mineRun({ cards });
    const xs = [1, 2, 3].map((id) => across(r, id)).sort((a, b) => a - b), pitch = 1.85;
    // contiguous, and centred on the row within a place
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeLessThan(pitch * 1.6);
    expect(Math.abs((xs[0]! + xs.at(-1)!) / 2)).toBeLessThan(pitch);
    expect(across(r, 3)).toBeLessThan(Math.min(across(r, 1), across(r, 2)));
    // the heaviest in the middle of what stands
    expect(Math.abs(across(r, 2) - (across(r, 1) + across(r, 2)) / 2)).toBeLessThan(pitch);
  });

  it("my mana keeps its kinds while its tier has room (basics by kind, rocks and utility lands apart), else one well that names them", () => {
    resetIds();
    // (a full field: nothing of my mana spills into it)
    const creatures = Array.from({ length: 11 }, (_, i) => me({ name: `Creature ${i}`, power: 2 + i }));
    const rocks = Array.from({ length: 4 }, (_, i) => me({ kind: "rock", name: `Rock ${i}` })), utility = Array.from({ length: 5 }, (_, i) => me({ kind: "land", name: `Utility land ${i}` }));
    const islands = many(5, { kind: "land", name: "Island", basic: true, controller: ME });
    const manaOf = (r: ArrangeResult) => r.fit.units.filter((u) => ["rocks", "lands", "basics", "pool"].includes(u.tier));
    const one = mineRun({ cards: [...creatures, ...islands, ...rocks, ...utility] });
    expect(one.fit.report.violations).toEqual([]);
    expect(manaOf(one).map((u) => u.tier).sort()).toEqual(["basics", "lands", "rocks"]);
    expect(manaOf(one).every((u) => u.facts.kind === "well")).toBe(true);
    // a second kind of basic: more than the tier's places at this viewport, so all of it is one well, which counts its
    // lands and rocks; my field is untouched
    const two = mineRun({ cards: [...creatures, ...islands, ...many(3, { kind: "land", name: "Swamp", basic: true, controller: ME }), ...rocks, ...utility] });
    expect(two.fit.report.violations).toEqual([]);
    expect(manaOf(two).map((u) => u.tier)).toEqual(["pool"]);
    expect(manaOf(two)[0]!.facts).toMatchObject({ kind: "well", lands: 13, rocks: 4 });
    for (const c of creatures) expect(unitOf(two, c.id).members).toEqual([c.id]);
    expect(manaRow(two).places).toBe(3);
  });

  it("what my mana tier cannot hold lies in my field's free places, right of what stands, before anything of it piles", () => {
    resetIds();
    const creatures = Array.from({ length: 3 }, (_, i) => me({ name: `Creature ${i}`, power: 2 + i }));
    const rocks = Array.from({ length: 3 }, (_, i) => me({ kind: "rock", name: `Rock ${i}` })), utility = Array.from({ length: 2 }, (_, i) => me({ kind: "land", name: `Utility land ${i}` }));
    const r = mineRun({ cards: [...creatures, ...rocks, ...utility, ...many(4, { kind: "land", name: "Island", basic: true, controller: ME })] });
    expect(r.fit.report.violations).toEqual([]);
    expect(r.fit.units.filter((u) => u.kind === "fan")).toEqual([]);
    const spilled = r.fit.units.filter((u) => u.tier === "spill");
    expect(spilled.length).toBe(3);
    for (const u of spilled) expect(u.cards.at(-1)!.foot.x).toBeGreaterThan(Math.max(...creatures.map((c) => across(r, c.id))));
  });

  it("what a decision offers steps out of my piles where the row holds it, else its pile opens with it lit", () => {
    resetIds();
    const lands = Array.from({ length: 16 }, (_, i) => me({ kind: "land", name: `Utility land ${i}` }));
    const creatures = Array.from({ length: 11 }, (_, i) => me({ name: `Creature ${i}`, power: 2 + i }));
    const cards = [...lands, ...creatures];
    const rest = settled({ cards });
    expect(unitOf(rest, lands[3]!.id).kind).toBe("fan");
    // a target among my lands: it lies on its own, where it can be tapped
    const two = mineRun({ cards, memory: rest.fit.memory, acting: { offered: new Set([lands[3]!.id, lands[9]!.id]), choosing: true } });
    for (const l of [lands[3]!, lands[9]!]) expect(unitOf(two, l.id).members, l.name).toEqual([l.id]);
    expect(two.fit.report.violations).toEqual([]);
    expect(two.overflow).toBeNull();
    // every land offered (a payment): more than the row holds, so as many as its free places hold step out, in the
    // acting rank (here the oldest first, all alike), and the rest fold as at rest in a pile that names them
    const all = mineRun({ cards, memory: rest.fit.memory, acting: { offered: new Set(lands.map((l) => l.id)), choosing: true } });
    expect(all.fit.report.violations).toEqual([]);
    const out = lands.filter((l) => unitOf(all, l.id).kind === "card");
    expect(out.length).toBeGreaterThan(0);
    expect(out.map((l) => l.id)).toEqual(lands.slice(0, out.length).map((l) => l.id));
    const pile = unitOf(all, lands[15]!.id);
    expect(pile.kind).toBe("fan");
    expect(all.fit.attention.some((a) => a.unit === pile.id && a.why === "offered")).toBe(true);
    // nothing else moved for them: every creature keeps its place
    for (const c of creatures) expect(unitOf(all, c.id).slot, c.name).toEqual(unitOf(rest, c.id).slot);
  });

  it("the acting rank: what rest hides among unlike cards takes a free place before copies already one tap in their block", () => {
    resetIds(150);
    // my field full; my mana tier's three places hold a pile of utility lands and the Island block: one is free
    const creatures = Array.from({ length: 11 }, (_, i) => me({ name: `Creature ${i}`, power: 2 + i }));
    const islands = many(6, { kind: "land", name: "Island", basic: true, controller: ME });
    const lands = Array.from({ length: 12 }, (_, i) => me({ kind: "land", name: `Utility land ${i}` }));
    const cards = [...creatures, ...islands, ...lands];
    const rest = settled({ cards });
    const offered = [...islands, ...lands];
    const r = mineRun({ cards, memory: rest.fit.memory, acting: { offered: new Set(offered.map((c) => c.id)), choosing: true } });
    expect(r.fit.report.violations).toEqual([]);
    // the oldest utility land (all weigh the same) takes the free place; the Islands stay one block
    expect(offered.filter((c) => unitOf(r, c.id).kind === "card").map((c) => c.name)).toEqual(["Utility land 0"]);
    expect(unitOf(r, islands[0]!.id).kind).toBe("stack");
    // every offered card is drawn whole (alone or on top), in its block of copies, or named on the pile that hides it
    const named = new Set(r.fit.attention.filter((a) => a.why === "offered").flatMap((a) => a.cards));
    for (const c of offered) {
      const u = unitOf(r, c.id);
      expect(u.kind === "card" || u.kind === "stack" || u.top === c.id || named.has(c.id), c.name).toBe(true);
    }
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
    expect(unitOf(b, 9).tier).toBe("rocks");
    expect(unitOf(b, 9).retyped).toBe(false);
    expect(near(b, 9)).toBeGreaterThan(Math.max(near(b, 1), near(b, 2)) + 1);
    // what was known stays where it was
    for (const id of [1, 2, 3]) expect(unitOf(b, id).slot, String(id)).toEqual(unitOf(a, id).slot);
  });

  it("a table loading (many cards' data arriving at once) deals my side afresh: works left of what stands, mana in front", () => {
    resetIds(200);
    const known = [me({ name: "Illusion", power: 1, token: true }), me({ name: "Illusion", power: 1, token: true })];
    const real = [me({ name: "Wurm", power: 6 }), me({ name: "Bear", power: 2 }), me({ kind: "artifact", name: "Coat of Arms" }), me({ kind: "rock", name: "Sol Ring" }), me({ kind: "land", name: "Temple" })];
    // first plan: only the snapshot's facts (the rock and the land read as works until their data lands)
    const guessed = real.map((c) => ({ ...c, provisional: true, ...(c.name === "Sol Ring" || c.name === "Temple" ? { manaSource: false, types: { ...c.types, land: false } } : {}) }));
    const a = mineRun({ cards: [...known, ...guessed], clock: { turn: 5, phase: "MAIN1" } });
    const b = mineRun({ cards: [...known, ...real], memory: a.fit.memory, clock: { turn: 5, phase: "MAIN1" } });
    const x = (n: string) => across(b, real.find((c) => c.name === n)!.id);
    expect(x("Coat of Arms")).toBeLessThan(Math.min(x("Wurm"), x("Bear")));
    const z = (n: string) => near(b, real.find((c) => c.name === n)!.id);
    expect(Math.min(z("Sol Ring"), z("Temple"))).toBeGreaterThan(Math.max(z("Wurm"), z("Bear")) + 1);
  });

  it("review: the same lands keep my field's spill places plan after plan (equal weights never swap)", () => {
    resetIds(300);
    const creatures = Array.from({ length: 8 }, (_, i) => me({ name: `Creature ${i}`, power: 2 + i }));
    const lands = Array.from({ length: 16 }, (_, i) => me({ kind: "land", name: `Utility land ${i}` }));
    const cards = [...creatures, ...lands];
    let r = mineRun({ cards });
    const spilled = (x: ArrangeResult) => x.fit.units.filter((u) => u.tier === "spill").map((u) => u.members[0]).sort();
    const first = spilled(r);
    expect(first.length).toBeGreaterThan(0);
    for (let k = 0; k < 3; k++) {
      r = mineRun({ cards, memory: r.fit.memory });
      expect(spilled(r), `plan ${k + 2}`).toEqual(first);
    }
  });

  it("offered sources step out into free places only: what rest shows stays where it is, the rest lit in their pile", () => {
    resetIds(300);
    const creatures = Array.from({ length: 8 }, (_, i) => me({ name: `Creature ${i}`, power: 2 + i }));
    const lands = Array.from({ length: 16 }, (_, i) => me({ kind: "land", name: `Utility land ${i}` }));
    const cards = [...creatures, ...lands];
    const rest = settled({ cards });
    const offered = new Set(lands.slice(0, 4).map((l) => l.id));
    const r = mineRun({ cards, memory: rest.fit.memory, acting: { offered, choosing: true } });
    expect(r.fit.report.violations).toEqual([]);
    // every card rest shows alone is still alone, in the same place (lands spilled into my field among them)
    for (const u of rest.fit.units.filter((x) => x.kind === "card")) expect(unitOf(r, u.members[0]!).slot, String(u.members[0])).toEqual(u.slot);
    // what rest hid steps out where a place is free; what does not fit is named on its pile
    const out = [...offered].filter((id) => unitOf(r, id).kind === "card");
    expect(out.length).toBeGreaterThan(rest.fit.units.filter((x) => x.kind === "card" && offered.has(x.members[0]!)).length);
    const named = new Set(r.fit.attention.filter((a) => a.why === "offered").flatMap((a) => a.cards));
    for (const id of offered) expect(unitOf(r, id).kind === "card" || named.has(id), String(id)).toBe(true);
  });

  it("review: cards no place holds do not re-deal my side every plan as if their data had just landed", () => {
    resetIds(400);
    // fifteen fighting creatures: four have no place (actors past every place), so no memory of where they were
    const fighters = Array.from({ length: 15 }, (_, i) => me({ name: `Fighter ${i}`, power: 1 + (i % 4) }));
    const acting = { involved: new Set(fighters.map((c) => c.id)) };
    const a = mineRun({ cards: fighters, acting, clock: { turn: 5, phase: "COMBAT_DECLARE_BLOCKERS" } });
    expect(a.overflow?.reason).toBe("actors");
    const b = mineRun({ cards: fighters, acting, memory: a.fit.memory, clock: { turn: 5, phase: "COMBAT_DECLARE_BLOCKERS" } });
    // no deal: the last deal is kept as it was
    expect(b.fit.memory.policies["mine"]!.tidy).toBe(a.fit.memory.policies["mine"]!.tidy);
  });

  it("review: a phase change re-sorts when a seated creature now outranks one dealt above it", () => {
    resetIds(500);
    const weak = me({ id: 501, name: "Elf", power: 1 }), strong = me({ id: 502, name: "Bear", power: 3 });
    const a = mineRun({ cards: [weak, strong], clock: { turn: 5, phase: "MAIN1" } });
    expect(unitOf(a, 502).slot.place).toBe(0);
    const pumped = { ...weak, power: 9 };
    const b = mineRun({ cards: [pumped, strong], memory: a.fit.memory, clock: { turn: 5, phase: "MAIN2" } });
    expect(unitOf(b, 501).slot.place).toBe(0);
  });

  it("review: creatures arriving after a work keep the work at the block's left", () => {
    resetIds(610);
    const work = me({ id: 600, kind: "artifact", name: "Coat of Arms" });
    const a = mineRun({ cards: [work], clock: { turn: 5, phase: "MAIN1" } });
    const creatures = Array.from({ length: 4 }, (_, i) => me({ name: `Creature ${i}`, power: 2 + i }));
    const b = mineRun({ cards: [work, ...creatures], memory: a.fit.memory, clock: { turn: 5, phase: "MAIN1" } });
    expect(across(b, 600)).toBeLessThan(Math.min(...creatures.map((c) => across(b, c.id))));
    // and the creatures sit together, a place apart
    const xs = creatures.map((c) => across(b, c.id)).sort((x, y) => x - y);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeLessThan(1.85 * 1.6);
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

  it("holds its places at every supported viewport: eleven in my field, each face over my floor, three for my mana", () => {
    for (const vp of VIEWPORTS) {
      const r = mineRun({ cards: [me({ name: "Bear", power: 2 }), ...many(2, { kind: "land", name: "Forest", basic: true, controller: ME })], vp });
      expect(fieldRow(r).places, `${vp.w}`).toBe(11);
      expect(manaRow(r).places, `${vp.w}`).toBeGreaterThanOrEqual(3);
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
        // my graveyard, exile and waiting commander are the nameplate's, not the table's
        expect(sp.fixtures.zones, label).toEqual([]);
        expect(sp.fixtures.commander, label).toBeUndefined();
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

  it("review: the plan's rev follows a well's tapped count", () => {
    const raw = structuredClone(rawDesign.stages.find((x) => x.turn === 15)!) as unknown as { turn: number; envelope: { view: { players: { name: string; battlefield: { name: string; tapped?: boolean }[] }[] } } };
    // every Island open, then the last of them (in the well's order) tapped: the order and the top stay, the count does not
    const plan = (tapLast: boolean) => {
      const st = structuredClone(raw);
      const islands = st.envelope.view.players.find((p) => p.name === "You")!.battlefield.filter((c) => c.name === "Island") as { id?: number; tapped?: boolean }[];
      for (const c of islands) c.tapped = false;
      if (tapLast) islands.reduce((a, b) => ((a.id ?? 0) > (b.id ?? 0) ? a : b)).tapped = true;
      return planTable(tableInputOf(designModels({ stages: [st], catalog: rawDesign.catalog } as never).get(15)!, { viewport: IPAD, engine: { draw: true } }));
    };
    const open = plan(false), one = plan(true);
    const well = (p: TablePlan) => p.hits.groups.find((g) => g.kind === "well" && g.members.length === 8)!;
    expect(well(one).members).toEqual(well(open).members);
    expect(one.rev).not.toBe(open.rev);
  });

  it("no middle held back at rest: my field stands no lower than mat's did; the parting slides it toward me", () => {
    for (const turn of [9, 15]) {
      const m = design.get(turn)!, u = designUnit(IPAD);
      const engine = planned(turn, IPAD), mat = planTable(tableInputOf(m, { viewport: IPAD, engine: { draw: true, mine: false } }));
      expect(engine.fieldTop, `turn ${turn}`).toBeLessThanOrEqual(mat.fieldTop + 2 * u);
      expect(engine.part).toBe(0);
      // the stack set aside parts the mats: my row slides toward me as the leaves slide away
      const raw = structuredClone(rawDesign.stages.find((x) => x.turn === turn)!);
      raw.envelope.view = { ...raw.envelope.view, stack: [{ id: 9001, source: { id: 9001, name: "Swords to Plowshares", owner: "Dack", controller: "Dack", type: "Instant", zone: "stack" }, controller: "Dack", spell: true, text: "Swords to Plowshares", targets: [] }] };
      const parted = planTable(tableInputOf(designModels({ stages: [raw], catalog: rawDesign.catalog }).get(turn)!, { viewport: IPAD, engine: { draw: true } }));
      expect(parted.part).toBeGreaterThan(0);
      expect(parted.fieldTop, `turn ${turn} parted`).toBeGreaterThan(engine.fieldTop + 4 * u);
      expect(parted.violations, `turn ${turn} parted`).toEqual([]);
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
