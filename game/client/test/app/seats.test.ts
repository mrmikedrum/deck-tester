// The seats as the chrome tells them (app/seats.ts): the top row of nameplates bends round the table's cards, and a
// seat's summary counts what the data supports, once per model.
import { describe, expect, it } from "vitest";
import { placeTop, plateWidth, platesOf, seatFocusOf, summaryOf } from "../../src/app/seats";
import type { Box } from "../../src/app/seats";
import { NO_INSETS, planTable, tableInputOf } from "../../src/layout";
import type { TablePlan } from "../../src/layout";
import { modelOf, seatId } from "../../src/model";
import { card, catalog, corpusNames, corpusSnapshot, creature, land, snapshotOf, tableOf, viewerOf } from "../model/fixtures";
import { SUPPORTED } from "../layout/boards";

const TABLE = { w: 1180, h: 820, safe: NO_INSETS };

const intersects = (a: Box, b: Box): boolean => Math.min(a.r, b.r) > Math.max(a.l, b.l) && Math.min(a.b, b.b) > Math.max(a.t, b.t);

function boxOf(p: ReturnType<typeof platesOf>[number]): Box {
  const width = plateWidth(p.name, p.life, p.icons) * p.unit, height = Math.max(44, 44 * p.unit);
  const l = p.mine ? p.x - width / 2 : p.x, t = p.mine ? p.y - height : p.y;
  return { l, t, r: l + width, b: t + height };
}

describe("the top row of nameplates", () => {
  const row = { t: 6, b: 50, l: 112, r: 1168 };
  it("keeps clear of a card at the top of a leaf, as near its own leaf as it can", () => {
    // Across's command zone card stands at the top of the screen, just where its plate would hang.
    const commander: Box = { l: 460, t: 15, r: 500, b: 60 };
    const at = placeTop([{ seat: "Atraxa", place: "across", w: 240, pref: 470 }], [commander], row);
    const x = at.get("Atraxa")!;
    const plate: Box = { l: x, t: row.t, r: x + 240, b: row.b };
    expect(plate.r <= commander.l || plate.l >= commander.r).toBe(true);
    // The nearest clear place: just past the card's right edge (closer than its left).
    expect(x).toBeGreaterThanOrEqual(commander.r);
    expect(x - commander.r).toBeLessThan(8);
  });
  it("keeps the plates in their leaves' order, even where swapping two would clear a card", () => {
    // A wide plate on the left and a card at the top of the left leaf: swapping would clear it, but seats never swap.
    const at = placeTop(
      [
        { seat: "Marath", place: "left", w: 330, pref: 120 },
        { seat: "Atraxa", place: "across", w: 260, pref: 460 },
        { seat: "Dack", place: "right", w: 240, pref: 800 },
      ],
      [{ l: 130, t: 9, r: 190, b: 80 }],
      row,
    );
    expect(at.get("Marath")!).toBeLessThan(at.get("Atraxa")!);
    expect(at.get("Atraxa")!).toBeLessThan(at.get("Dack")!);
  });
  it("never lays one plate over another, and stays clear of the Game button", () => {
    const at = placeTop(
      [
        { seat: "Marath", place: "left", w: 260, pref: 60 },
        { seat: "Dack", place: "right", w: 260, pref: 760 },
        { seat: "Atraxa", place: "across", w: 260, pref: 460 },
      ],
      [],
      row,
    );
    const boxes = [...at.values()].map((l) => ({ l, r: l + 260 })).sort((a, b) => a.l - b.l);
    expect(boxes[0]!.l).toBeGreaterThanOrEqual(row.l);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.l).toBeGreaterThanOrEqual(boxes[i - 1]!.r);
    expect(boxes.at(-1)!.r).toBeLessThanOrEqual(row.r);
  });
});

describe("the nameplates over the protocol corpus at 1180x820", () => {
  it("never cover a card's hit group: what is at the top of a leaf stays visible and tappable", () => {
    const vp = TABLE;
    let planned = 0;
    for (const name of corpusNames) {
      const model = modelOf(corpusSnapshot(name), catalog, viewerOf());
      if (!model) continue;
      let plan: TablePlan;
      try {
        plan = planTable(tableInputOf(model, { viewport: vp }));
      } catch {
        continue;
      }
      planned++;
      const plates = platesOf(model, plan, new Map(), vp).filter((p) => !p.mine);
      for (const p of plates) {
        const box = boxOf(p);
        for (const g of plan.hits.groups.filter((x) => x.kind !== "plate")) {
          const xs = g.quad.map((q) => q.x), ys = g.quad.map((q) => q.y);
          const over = intersects(box, { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) });
          expect(over, `${name}: ${p.seat}'s plate over ${g.id}`).toBe(false);
        }
      }
    }
    expect(planned).toBeGreaterThan(40);
  });
});

it.each([...SUPPORTED, { w: 1600, h: 1112 }, { w: 700, h: 480 }])("fits every corpus plate including its icon strip at $w × $h", (size) => {
  const viewport = { ...size, safe: { top: 12, right: 18, bottom: 14, left: 18 } };
  let planned = 0;
  for (const name of corpusNames) {
    const model = modelOf(corpusSnapshot(name), catalog, viewerOf());
    if (!model) continue;
    let plan: TablePlan;
    try {
      plan = planTable(tableInputOf(model, { viewport, safe: viewport.safe }));
    } catch {
      continue;
    }
    planned++;
    const boxes = platesOf(model, plan, new Map(), viewport).map(boxOf);
    for (const [i, box] of boxes.entries()) {
      expect(box.l >= 0 && box.t >= 0 && box.r <= viewport.w && box.b <= viewport.h, `${name}: plate ${i} on screen`).toBe(true);
      for (const other of boxes.slice(i + 1)) expect(intersects(box, other), `${name}: plate ${i} overlaps another`).toBe(false);
    }
  }
  expect(planned).toBeGreaterThan(40);
});

describe("a seat's summary", () => {
  const model = tableOf({
    seats: {
      Atraxa: {
        battlefield: [
          card(1, "Sol Ring", "Atraxa", "Artifact"),
          creature(2, "Incubation Druid", "Atraxa", 0, 2),
          card(3, "Smothering Tithe", "Atraxa", "Enchantment"),
          { ...land(4, "Forest", "Atraxa"), tapped: true },
          // A land that has become a creature still makes mana.
          card(5, "Mishra's Workshop", "Atraxa", "Land Creature - Elemental", { power: 3, toughness: 3 }),
        ],
      },
    },
  });
  const atraxa = seatId("Atraxa");
  it("counts untapped mana sources: lands, rocks and creatures that make mana, not a card that hands it out", () => {
    const t = summaryOf(model, atraxa);
    expect(t.sources).toBe(4); // Sol Ring, Incubation Druid, Forest, the Workshop (not Smothering Tithe)
    expect(t.openSources).toBe(3); // the Forest is tapped
    expect(t.lands).toBe(2);
    const plate = platesOf(model, null, new Map(), TABLE).find((p) => p.seat === "Atraxa")!;
    expect(plate.icons.find((i) => i.kind === "mana")?.figure).toBe("3");
    const focus = seatFocusOf(model, atraxa)!;
    expect(focus.lines.find((l) => l.icon === "mana")?.head).toBe("3 of 4 mana sources untapped");
  });
  it("is counted once per model and seat", () => {
    expect(summaryOf(model, atraxa)).toBe(summaryOf(model, atraxa));
    expect(platesOf(model, null, new Map(), TABLE)).toBe(platesOf(model, null, new Map(), TABLE));
  });
});

describe("commander damage taken by a seat", () => {
  const me = seatId("You"), atraxa = seatId("Atraxa");
  const partners = [
    creature(1, "Tymna the Weaver", "Dack", 2, 2, { commander: true }),
    creature(2, "Thrasios, Triton Hero", "Dack", 1, 3, { commander: true }),
  ];
  const commander = creature(3, "Marath, Will of the Wild", "You", 3, 3, { commander: true, controller: "Princess" });

  it("ranks distinct commanders, including partners, and flags damage near or beyond lethal", () => {
    const model = tableOf({ seats: {
      You: { commanderDamage: { 1: 15, 2: 22, 3: 14, 99: 0 } },
      Dack: { command: partners, commanderDamage: { 3: 4 } },
      Princess: { battlefield: [commander] },
    } });
    const damage = seatFocusOf(model, me)!.commanderDamage;
    expect(damage).toEqual([
      { id: 2, source: "Thrasios, Triton Hero (Dack)", figure: "22 · Lethal", danger: true },
      { id: 1, source: "Tymna the Weaver (Dack)", figure: "15 · 6 to lethal", danger: true },
      { id: 3, source: "Marath, Will of the Wild (Princess)", figure: "14 · 7 to lethal", danger: false },
    ]);
    expect(seatFocusOf(model, me)!.commanderDamage).toBe(damage);
    expect(seatFocusOf(model, seatId("Dack"))!.commanderDamage).toMatchObject([{ id: 3, figure: "4 · 17 to lethal" }]);
    expect(seatFocusOf(model, atraxa)!.commanderDamage).toEqual([]);
  });

  it("updates on a new model and keeps damage from absent commanders readable", () => {
    const before = tableOf({ seats: { You: { commanderDamage: { 1: 20 } }, Dack: { command: partners } } });
    const snap = snapshotOf({ seats: { You: { commanderDamage: { 1: 21, 99: 2 } } } });
    const after = modelOf(snap, catalog, viewerOf(), before.commanders)!;
    expect(seatFocusOf(before, me)!.commanderDamage).toMatchObject([{ figure: "20 · 1 to lethal" }]);
    expect(seatFocusOf(after, me)!.commanderDamage).toEqual([
      { id: 1, source: "Tymna the Weaver (Dack)", figure: "21 · Lethal", danger: true },
      { id: 99, source: "Unknown commander #99", figure: "2 · 19 to lethal", danger: false },
    ]);
  });
});
