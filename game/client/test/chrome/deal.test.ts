// A card sheet's deal: one card size per sheet, at most two rows, pages past what fits; copies off the table as a pile;
// what a tap on a pile picks.
import { describe, expect, it } from "vitest";
import { CARD_ASPECT, CARD_MAX, CARD_MIN, deal, tagOf, tapOf, tilesOf } from "../../src/chrome/deal";
import type { Tile } from "../../src/chrome/deal";
import type { SheetItem, SheetView } from "../../src/play";
import type { CardId } from "../../src/protocol";

/** The grid area a card sheet has on the iPad in landscape (1210 x 834), as the sheet works it out. */
const IPAD = { w: 1120, h: 520 };

const item = (option: number, name: string, o: Partial<SheetItem> = {}): SheetItem => ({ option, label: name, cost: null, detail: null, card: null, name, picked: false, badge: null, ...o });
const sheet = (items: SheetItem[], pick: SheetView["pick"] = { min: 0, max: 1, ordered: false, repeat: false }): SheetView => ({
  kind: "chooser",
  title: "Choose a land card (Farseek)",
  wide: items.length > 6,
  items,
  stepper: null,
  buttons: [],
  carried: null,
  pick,
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
  it("cards are never shrunk to fit a page: a page holds fewer at a size that reads", () => {
    const one = deal(12, IPAD.w, IPAD.h), paged = deal(40, IPAD.w, IPAD.h);
    expect(paged.w).toBeGreaterThanOrEqual(CARD_MIN);
    expect(paged.perPage).toBeLessThanOrEqual(one.cols * 2 + 2);
  });
});

describe("a card sheet's tiles", () => {
  it("copies of one card off the table lie as one pile, in the order offered", () => {
    const items = [item(1, "Hallowed Fountain"), item(2, "Island"), item(3, "Island"), item(4, "Island"), item(5, "Mountain")];
    const { tiles, rows } = tilesOf(sheet(items), looks);
    expect(tiles.map((t) => [t.name, t.items.map((i) => i.option)])).toEqual([
      ["Hallowed Fountain", [1]],
      ["Island", [2, 3, 4]],
      ["Mountain", [5]],
    ]);
    expect(rows).toEqual([]);
  });
  it("cards on the table, ordered picks and repeatable options are each their own", () => {
    const onTable = [item(1, "Beast", { card: 10 as CardId }), item(2, "Beast", { card: 11 as CardId })];
    expect(tilesOf(sheet(onTable), looks).tiles).toHaveLength(2);
    const hidden = [item(1, "Island"), item(2, "Island")];
    expect(tilesOf(sheet(hidden, { min: 2, max: 2, ordered: true, repeat: false }), looks).tiles).toHaveLength(2);
    expect(tilesOf(sheet(hidden, { min: 1, max: 3, ordered: false, repeat: true }), looks).tiles).toHaveLength(2);
    const unbounded: SheetView = { ...sheet(hidden) };
    delete (unbounded as { pick?: unknown }).pick; // a chooser that does not say its bounds
    expect(tilesOf(unbounded, looks).tiles).toHaveLength(2);
  });
  it("copies whose rules differ are not one pile", () => {
    const items = [item(1, "Island", { detail: "({T}: Add {U}.)" }), item(2, "Island", { detail: "Island — snow" })];
    expect(tilesOf(sheet(items), looks).tiles).toHaveLength(2);
  });
  it("what an option says beyond its card goes on a tag: a payment's mana as its symbol", () => {
    expect(tagOf("Arcane Signet (W)", "Arcane Signet")).toBe("{W}");
    expect(tagOf("Island", "Island")).toBeNull();
    expect(tagOf("Gemstone Caverns (exiled card)", "Gemstone Caverns")).toBe("exiled card");
    const two = [item(1, "Arcane Signet", { label: "Arcane Signet (U)" }), item(2, "Arcane Signet", { label: "Arcane Signet (W)" })];
    expect(tilesOf(sheet(two), looks).tiles.map((t) => t.tag)).toEqual(["{U}", "{W}"]); // never one pile
  });
  it("an option with no card to picture is a row", () => {
    const { tiles, rows } = tilesOf(sheet([item(1, "Island"), item(2, "None")]), (i) => (i.name === "Island" ? looks(i) : null));
    expect(tiles).toHaveLength(1);
    expect(rows.map((r) => r.option)).toEqual([2]);
  });
});

describe("a tap on a pile", () => {
  const pile = (picked: number[]): Tile => ({ key: "2", name: "Island", label: "Island", tag: null, image: null, items: [2, 3, 4].map((o) => item(o, "Island", { picked: picked.includes(o) })) });
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
    expect(tapOf({ key: "1", name: "Mountain", label: "Mountain", tag: null, image: null, items: [item(1, "Mountain")] }, 2, 2)).toBe(1);
  });
});
