// The focus containers (§2.8): a pile and a seat's spread laid on a sheet brought nearer. One card size whatever the
// count, the largest step that fits, rows kept apart while there is room, pages past it, offered first when choosing.
import { describe, expect, it } from "vitest";
import { pinhole } from "../../../src/layout/projector";
import { tableTemplate } from "../../../src/layout/template";
import { bounds } from "../../../src/layout/shape";
import type { Quad } from "../../../src/layout/shape";
import { CH } from "../../../src/layout/geometry";
import { S_TABLE } from "../../../src/layout/arrange/scale";
import { SHEET_STEPS, arrangeSheet, referenceHeight } from "../../../src/layout/arrange/sheet";
import type { Sheet, SheetInput } from "../../../src/layout/arrange/sheet";
import { pileUnits, spreadUnits } from "../../../src/layout/arrange/policies/sheet";
import type { SheetUnit } from "../../../src/layout/arrange/policies/sheet";
import type { ArrCard } from "../../../src/layout/arrange/contract";
import type { CardId, Rect } from "../../../src/layout/types";
import { ac, many, resetIds } from "./cards";

const VP = { w: 1210, h: 834 };
const tpl = tableTemplate(4), proj = pinhole(tpl.camera, VP), u = Math.min(VP.w / 1180, VP.h / 820);
const ref = referenceHeight(proj, { x: 0, y: (CH * S_TABLE) / 2, z: tpl.leaf.front });
const AREA: Rect = { left: 20 * u, right: VP.w - 20 * u, top: 116 * u, bottom: VP.h - 14 * u };
const PROMPT: Rect = { left: VP.w - 342 * u, top: VP.h - 190 * u, right: VP.w, bottom: VP.h };
const NOTHING = { offered: new Set<CardId>(), choosing: false };

const sheet = (units: readonly SheetUnit[], o: Partial<SheetInput> = {}): Sheet =>
  arrangeSheet({ id: "pile:x", role: "pile", units, projector: proj, area: AREA, keepouts: [PROMPT], u, ref, page: 0, choosing: false, ...o });
const tall = (q: Quad): number => Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
const meets = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }): boolean => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;
const box = (r: Rect) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom });
const all = (s: Sheet, units: readonly SheetUnit[], o: Partial<SheetInput> = {}): CardId[] =>
  Array.from({ length: s.pages.count }, (_, p) => sheet(units, { ...o, page: p }).places.flatMap((x) => [...x.cards])).flat();

describe("a pile's sheet", () => {
  it("one card size whatever the count: the table's mesh, nearer; never under its smallest step", () => {
    resetIds();
    const heights = new Set<number>();
    for (const n of [1, 3, 7, 14, 27, 60, 150]) {
      const s = sheet(pileUnits(many(n, { name: "Illusion", token: true }), NOTHING));
      expect(s.scale).toBe(S_TABLE);
      expect(SHEET_STEPS).toContain(s.step);
      for (const p of s.places) {
        expect(tall(p.quad), `${n}`).toBeCloseTo(s.step * ref, 6);
        // its middle in the world is where its face is on screen
        const m = proj.project(p.mid), b = bounds(p.quad);
        expect(m.x).toBeCloseTo((b.l + b.r) / 2, 3);
        expect(m.y).toBeCloseTo((b.t + b.b) / 2, 3);
      }
      heights.add(Math.round(tall(s.places[0]!.quad)));
      expect(tall(s.places[0]!.quad)).toBeGreaterThanOrEqual(SHEET_STEPS.at(-1)! * ref - 1e-6);
    }
    // a small pile reads largest; a big one steps down, then pages at its smallest step rather than shrinking
    expect(sheet(pileUnits(many(3, { name: "Beast" }), NOTHING)).step).toBe(SHEET_STEPS[0]);
    expect(sheet(pileUnits(many(150, { name: "Beast" }), NOTHING)).step).toBe(SHEET_STEPS.at(-1));
  });
  it("pages a big pile: every card on exactly one page, each page inside the area, clear of the prompt, nothing overlapping", () => {
    resetIds();
    const units = pileUnits([...many(70, { name: "Beast" }), ...many(30, { name: "Forest", kind: "land", tapped: true })], NOTHING);
    const s = sheet(units);
    expect(s.pages.count).toBeGreaterThan(1);
    const seen = all(s, units);
    expect(seen).toHaveLength(100);
    expect(new Set(seen).size).toBe(100);
    for (let p = 0; p < s.pages.count; p++) {
      const page = sheet(units, { page: p });
      expect(page.pages.current).toBe(p);
      const boxes = page.places.map((x) => bounds(x.quad));
      for (const b of boxes) {
        expect(b.l).toBeGreaterThanOrEqual(AREA.left - 0.5);
        expect(b.r).toBeLessThanOrEqual(AREA.right + 0.5);
        expect(b.t).toBeGreaterThanOrEqual(AREA.top - 0.5);
        expect(b.b).toBeLessThanOrEqual(AREA.bottom + 0.5);
        expect(meets(b, box(PROMPT)), `page ${p}`).toBe(false);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(meets(boxes[i]!, boxes[j]!)).toBe(false);
    }
    // a page past the last is the last
    expect(sheet(units, { page: 99 }).pages.current).toBe(s.pages.count - 1);
  });
  it("a tapped card lies a notch turned, at the same size as the rest", () => {
    resetIds();
    const s = sheet(pileUnits([ac({ name: "A" }), ac({ name: "B", tapped: true })], NOTHING));
    expect(s.places.map((p) => p.turn)).toEqual(["none", "notch"]);
    expect(tall(s.places[1]!.quad)).toBeCloseTo(tall(s.places[0]!.quad), 6);
  });
  it("lands keep a row of their own while the sheet has one (the break stage), and share it when it has not", () => {
    resetIds();
    const cards: ArrCard[] = [ac({ name: "Bear" }), ac({ name: "Forest", kind: "land" }), ac({ name: "Wolf" }), ac({ name: "Island", kind: "land" })];
    const s = sheet(pileUnits(cards, NOTHING));
    expect(s.rows).toBe("apart");
    const rowOf = (name: string) => Math.round(bounds(s.places.find((p) => cards.find((c) => c.id === p.top)!.name === name)!.quad).t);
    expect(rowOf("Bear")).toBe(rowOf("Wolf"));
    expect(rowOf("Forest")).toBe(rowOf("Island"));
    expect(rowOf("Bear")).not.toBe(rowOf("Forest"));
  });
});

describe("offered first while choosing", () => {
  it("what the decision offers stands first, so page 1 holds it; its targets select, the rest inspect", () => {
    resetIds();
    const cards = many(120, { name: "Thopter", token: true });
    const offered = new Set([cards[100]!.id, cards[119]!.id]);
    const units = pileUnits(cards, { offered, choosing: true });
    expect(units.slice(0, 2).map((x) => x.cards[0])).toEqual([cards[100]!.id, cards[119]!.id]);
    const s = sheet(units, { choosing: true });
    expect(s.pages.count).toBeGreaterThan(1);
    expect(s.pages.offeredOn).toEqual([]);
    const target = (id: CardId) => s.targets.find((t) => t.members.includes(id))!;
    expect(target(cards[100]!.id).action).toEqual({ select: cards[100]!.id });
    expect(target(cards[0]!.id).action).toEqual({ inspect: cards[0]!.id });
    // not choosing (priority's plays are usable, not chosen): the pile's own order, and a tap reads the card
    const rest = sheet(pileUnits(cards, { offered, choosing: false }));
    expect(rest.places[0]!.top).toBe(cards[0]!.id);
    expect(rest.targets.every((t) => "inspect" in t.action)).toBe(true);
  });
  it("names the pages that hold offered cards past the one shown", () => {
    resetIds();
    // (unlike cards: a spread stacks copies)
    const cards = Array.from({ length: 120 }, (_, i) => ac({ name: `Creature ${i}` }));
    // a spread keeps its tiers: an offered land stands at the end, on a later page
    const land = ac({ name: "Forest", kind: "land" });
    const units = spreadUnits([...cards, land], () => 0, { offered: new Set([land.id]), choosing: true });
    const s = sheet(units, { role: "spread", choosing: true });
    expect(s.pages.count).toBeGreaterThan(1);
    expect(s.pages.offeredOn).toEqual([s.pages.count - 1]);
  });
});

describe("a seat's spread", () => {
  it("every permanent under its tier's caption: Ready, Tapped, Works, Lands; copies one stack with its count", () => {
    resetIds();
    const cards: ArrCard[] = [
      ...many(6, { name: "Beast", token: true }),
      ac({ name: "Marath", commander: true }),
      ac({ name: "Herd Baloth", tapped: true }),
      ac({ name: "Felidar Retreat", kind: "enchantment" }),
      ...many(4, { name: "Forest", kind: "land", basic: true }),
      ac({ name: "Sol Ring", kind: "rock" }),
    ];
    const s = sheet(spreadUnits(cards, () => 0, NOTHING), { role: "spread" });
    expect(s.captions.filter((c) => !c.more).map((c) => c.kind)).toEqual(["ready", "tapped", "works", "lands"]);
    const beasts = s.places.find((p) => p.cards.length === 6)!;
    expect(beasts.count?.n).toBe(6);
    expect(s.places.flatMap((p) => p.cards).sort((a, b) => a - b)).toEqual(cards.map((c) => c.id).sort((a, b) => a - b));
    // each caption stands over its tier's first card, on its own line above it
    for (const c of s.captions) {
      const under = s.places.filter((p) => p.tier === c.kind).map((p) => bounds(p.quad));
      expect(under.some((b) => Math.abs(b.t - c.at.y) < 40 && c.at.x >= b.l - 1 && c.at.x <= b.r)).toBe(true);
    }
  });
  it("each tier starts a row of its own as far as the room allows, and says its caption once (a tier wrapping does not repeat it)", () => {
    resetIds();
    // a turn-15 board's worth: too many for every tier apart at any step, enough room for some of them
    const cards: ArrCard[] = [
      ...Array.from({ length: 16 }, (_, i) => ac({ name: `Ready ${i}` })),
      ...Array.from({ length: 7 }, (_, i) => ac({ name: `Tapped ${i}`, tapped: true })),
      ...Array.from({ length: 6 }, (_, i) => ac({ name: `Work ${i}`, kind: "enchantment" })),
      ...Array.from({ length: 14 }, (_, i) => ac({ name: `Land ${i}`, kind: "land", tapped: i % 3 === 0 })),
    ];
    const s = sheet(spreadUnits(cards, () => 0, NOTHING), { role: "spread" });
    expect(s.pages.count).toBe(1);
    expect(s.captions.map((c) => c.kind)).toEqual(["ready", "tapped", "works", "lands"]);
    // tiers that start a row of their own have their captions at the sheet's left edge
    const lefts = s.captions.filter((c) => Math.abs(c.at.x - Math.min(...s.captions.map((k) => k.at.x))) < 30);
    expect(lefts.length, s.rows).toBeGreaterThanOrEqual(2);
  });

  it("an Aura stands right after what it is on, never stacked; while choosing an offered copy stands alone", () => {
    resetIds();
    const bears = many(3, { name: "Bear" });
    const aura = ac({ name: "Rancor", kind: "enchantment", attachedTo: bears[1]!.id });
    const units = spreadUnits([...bears, aura], () => 0, { offered: new Set([bears[2]!.id]), choosing: true });
    const ready = units.filter((x) => x.tier === "ready");
    expect(ready[0]!.cards).toEqual([bears[2]!.id]);
    const host = ready.findIndex((x) => x.cards.includes(bears[1]!.id));
    expect(ready[host]!.cards).toEqual([bears[1]!.id]);
    expect(ready[host + 1]!.cards).toEqual([aura.id]);
  });
  it("in the leaf's order: its front row first, then across", () => {
    resetIds();
    const [a, b, c] = [ac({ name: "A" }), ac({ name: "B" }), ac({ name: "C" })];
    const rank = new Map([[c.id, 0], [a.id, 1], [b.id, 2]]);
    expect(spreadUnits([a, b, c], (id) => rank.get(id)!, NOTHING).map((x) => x.cards[0])).toEqual([c.id, a.id, b.id]);
  });
});
