// A card sheet's deal: one card size per sheet, at most two rows, pages past what fits; copies a search found as a pile
// (never a scry's); every option a tile; what sets alike tiles apart; what a tap on a pile picks.
import { describe, expect, it } from "vitest";
import { CARD_ASPECT, CARD_MAX, CARD_MIN, CARD_ROWS, deal, tagOf, tapOf, tilesOf } from "../../src/chrome/deal";
import type { Tile } from "../../src/chrome/deal";
import type { SheetItem, SheetView } from "../../src/play";
import type { CardId } from "../../src/protocol";

/** The grid area a card sheet has on the iPad in landscape (1210 x 834), as the sheet works it out. */
const IPAD = { w: 1120, h: 520 };

const item = (option: number, name: string, o: Partial<SheetItem> = {}): SheetItem => ({ option, label: name, cost: null, detail: null, card: null, name, picked: false, badge: null, ...o });
const sheet = (items: SheetItem[], copies = false, max = 1): SheetView => ({
  kind: "chooser",
  title: "Choose a land card (Farseek)",
  wide: items.length > 6,
  items,
  stepper: null,
  buttons: [],
  carried: null,
  pick: { min: 0, max, copies },
});
const looks = (i: SheetItem) => ({ name: i.name ?? i.label, image: `${i.name}.jpg` });

describe("dealing a card sheet", () => {
  it("draws every card the same size, never past the most nor below the least that reads", () => {
    for (let n = 1; n <= 70; n++) {
      const d = deal(n, IPAD.w, IPAD.h);
      expect(d.w, `${n} cards`).toBeLessThanOrEqual(CARD_MAX);
      expect(d.w, `${n} cards`).toBeGreaterThanOrEqual(CARD_MIN);
      expect(d.rows * d.w * CARD_ASPECT, `${n} cards fit the height`).toBeLessThanOrEqual(IPAD.h);
      expect(d.cols * d.w, `${n} cards fit the width`).toBeLessThanOrEqual(IPAD.w);
      expect(d.pages * d.perPage, `${n} cards all dealt`).toBeGreaterThanOrEqual(n);
    }
  });
  it("a few cards lie in one row at their largest; more share two rows; past that, pages", () => {
    expect(deal(1, IPAD.w, IPAD.h)).toMatchObject({ w: CARD_MAX, rows: 1, pages: 1 });
    expect(deal(5, IPAD.w, IPAD.h)).toMatchObject({ rows: 1, cols: 5, pages: 1 });
    expect(deal(8, IPAD.w, IPAD.h)).toMatchObject({ rows: 2, cols: 4, pages: 1 });
    const many = deal(62, IPAD.w, IPAD.h);
    expect(many.rows).toBe(2);
    expect(many.pages).toBe(Math.ceil(62 / many.perPage));
    expect(many.pages).toBeGreaterThan(1);
  });
  it("never more than two rows, even where the screen is tall enough for a third", () => {
    const tall = { w: 1120, h: 1400 }; // room for three rows of the largest cards, or four of the least
    for (const n of [3, 9, 12, 30, 62]) {
      const d = deal(n, tall.w, tall.h);
      expect(d.rows, `${n} cards`).toBeLessThanOrEqual(CARD_ROWS);
      expect(d.perPage, `${n} cards`).toBeLessThanOrEqual(CARD_ROWS * d.cols);
    }
    expect(deal(30, tall.w, tall.h).pages).toBeGreaterThan(1);
  });
});

describe("a card sheet's tiles", () => {
  it("copies a library search found lie as one pile, in the order offered", () => {
    const items = [item(1, "Hallowed Fountain"), item(2, "Island"), item(3, "Island"), item(4, "Island"), item(5, "Mountain")];
    expect(tilesOf(sheet(items, true), looks).map((t) => [t.name, t.items.map((i) => i.option)])).toEqual([
      ["Hallowed Fountain", [1]],
      ["Island", [2, 3, 4]],
      ["Mountain", [5]],
    ]);
  });
  it("a scry's copies stay apart: with Island, Forest, Island on top, the second Island can go to the bottom alone", () => {
    // Forge sorts the scry's options by name and keeps library order among equals: Forest, Island (top), Island (third).
    const scry = { ...sheet([item(1, "Forest"), item(2, "Island"), item(3, "Island")], false, 3), title: "Scry 3: cards to put on the bottom" };
    const tiles = tilesOf(scry, looks);
    expect(tiles.map((t) => t.items.map((i) => i.option))).toEqual([[1], [2], [3]]);
    expect(tapOf(tiles[2]!, 0, 3)).toBe(3); // the third card, the Island under the Forest, alone
  });
  it("cards on the table and choosers that do not say their copies are interchangeable keep each option its own", () => {
    const onTable = [item(1, "Beast", { card: 10 as CardId }), item(2, "Beast", { card: 11 as CardId })];
    expect(tilesOf(sheet(onTable, true), looks)).toHaveLength(2);
    const hidden = [item(1, "Island"), item(2, "Island")];
    const unbounded: SheetView = { ...sheet(hidden) };
    delete (unbounded as { pick?: unknown }).pick;
    expect(tilesOf(unbounded, looks)).toHaveLength(2);
  });
  it("copies whose rules differ are not one pile", () => {
    const items = [item(1, "Island", { detail: "({T}: Add {U}.)" }), item(2, "Island", { detail: "Island — snow" })];
    expect(tilesOf(sheet(items, true), looks)).toHaveLength(2);
  });
  it("what an option says beyond its card goes on a tag: a payment's mana as its symbol", () => {
    expect(tagOf("Arcane Signet (W)", "Arcane Signet")).toBe("{W}");
    expect(tagOf("Island", "Island")).toBeNull();
    expect(tagOf("Gemstone Caverns (exiled card)", "Gemstone Caverns")).toBe("exiled card");
    const two = [item(1, "Arcane Signet", { label: "Arcane Signet (U)" }), item(2, "Arcane Signet", { label: "Arcane Signet (W)" })];
    expect(tilesOf(sheet(two), looks).map((t) => t.tag)).toEqual(["{U}", "{W}"]);
  });
  it("sources that would look alike say what sets them apart: two Islands for {U}, one with Wild Growth", () => {
    const pay = [
      item(1, "Island", { label: "Island (U)", card: 20 as CardId }),
      item(2, "Island", { label: "Island (U)", card: 21 as CardId, detail: "with Wild Growth" }),
      item(3, "Sol Ring", { label: "Sol Ring (C)", card: 22 as CardId, detail: "tapped" }),
    ];
    const paying: SheetView = { ...sheet(pay) };
    delete (paying as { pick?: unknown }).pick; // the payment list says no bounds
    const tiles = tilesOf(paying, looks);
    expect(tiles.map((t) => [t.tag, t.aside])).toEqual([
      ["{U}", null],
      ["{U}", "with Wild Growth"],
      ["{C}", null], // nothing else looks like it: its own words are enough
    ]);
    expect(tapOf(tiles[1]!, 0, 3)).toBe(2);
  });
  it("every option is a tile: one with no picture yet is a placeholder with its name, paged with the rest", () => {
    const items = [item(1, "Island"), ...Array.from({ length: 20 }, (_, i) => item(i + 2, `Unknown ${i + 1}`))];
    const tiles = tilesOf(sheet(items, true), (i) => (i.name === "Island" ? looks(i) : null));
    expect(tiles).toHaveLength(21);
    expect(tiles[0]).toMatchObject({ name: "Island", image: "Island.jpg" });
    expect(tiles[5]).toMatchObject({ name: "Unknown 5", image: null });
  });
});

describe("a tap on a pile", () => {
  const pile = (picked: number[]): Tile => ({ key: "2", name: "Island", label: "Island", tag: null, aside: null, image: null, items: [2, 3, 4].map((o) => item(o, "Island", { picked: picked.includes(o) })) });
  it("takes the next copy while there is room", () => {
    expect(tapOf(pile([]), 0, 2)).toBe(2);
    expect(tapOf(pile([2]), 1, 2)).toBe(3);
  });
  it("puts a copy back when the choice is full", () => {
    expect(tapOf(pile([2, 3]), 2, 2)).toBe(3);
    expect(tapOf(pile([2]), 1, 1)).toBe(2);
  });
  it("with one wanted, takes the first copy in place of the card picked elsewhere", () => {
    expect(tapOf(pile([]), 1, 1)).toBe(2);
  });
  it("takes nothing when the choice is full and none of its copies is picked", () => {
    expect(tapOf(pile([]), 2, 2)).toBeNull();
  });
  it("a single card is always its own option (play decides what a pick does)", () => {
    expect(tapOf({ key: "1", name: "Mountain", label: "Mountain", tag: null, aside: null, image: null, items: [item(1, "Mountain")] }, 2, 2)).toBe(1);
  });
});
