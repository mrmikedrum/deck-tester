// Behaviour to pin, items 6-8: `pay` (sources in order, take back, a colour sheet for a land with several abilities,
// Auto-pay sends []), targets and choices on the table or in a sheet (a mixed pile sends them to a sheet; one tap sends
// when exactly one is wanted; otherwise Done, disabled below min), and the sheet decisions (`order` numbers picks,
// `repeat` counts them, `number` steps between min and max). Piles are given to the hit groups as layout would make them.
import { describe, expect, it } from "vitest";
import type { CardId } from "../../src/protocol";
import { Table, askedAgain, raw, withDecision } from "./rig";

const PAY = "011-pay-my-planeswalker.json"; // {3}{B}: Plains 805 (1), Swamp 806 (2), Mountains 807 (3) and 808 (4), ...

describe("pay", () => {
  it("tap sources, then Pay sends them in the order tapped (corpus 011)", () => {
    const t = new Table();
    t.open(PAY);
    expect(t.buttons()).toEqual(["Auto-pay", "Let Forge decide"]);
    expect(t.p.controls.prompt?.headline).toBe("Pay {3}{B} for Thorn of the Black Rose: tap your mana, or let Forge pay");
    t.tapCard(806);
    t.tapCard(805);
    expect(t.buttons()).toEqual(["Undo", "Pay", "Let Forge decide"]);
    expect(t.p.controls.prompt?.headline).toBe("Pay {3}{B} for Thorn of the Black Rose · Swamp (B), Plains (W)");
    expect(t.p.board.marks.cards.get(806 as CardId)).toBe("selected");
    expect(t.p.board.marks.cards.get(809 as CardId)).toBe("option");
    expect(t.answers()).toEqual([]);
    t.press("Pay");
    expect(t.answers()).toEqual([[2, 1]]);
  });

  it("tapping a picked source takes it back; Undo takes back the last", () => {
    const t = new Table();
    t.open(PAY);
    t.tapCard(806);
    t.tapCard(805);
    t.tapCard(806);
    t.tapCard(809);
    t.press("Undo");
    t.press("Pay");
    expect(t.answers()).toEqual([[1]]);
  });

  it("Auto-pay sends []", () => {
    const t = new Table();
    t.open(PAY);
    t.press("Auto-pay");
    expect(t.answers()).toEqual([[]]);
  });

  it("a well of the same land gives its next free source per tap, and takes the last back once all are picked", () => {
    const t = new Table();
    t.open(PAY);
    t.pile([[807, 808]]);
    t.tapGroupOf(807);
    t.tapGroupOf(807);
    expect(t.p.controls.prompt?.headline).toMatch(/· Mountain \(R\), Mountain \(R\)$/);
    t.tapGroupOf(807); // both picked: never the same source twice
    t.press("Pay");
    expect(t.answers()).toEqual([[3]]);
  });

  it("sources of different cards in one pile ask \"Which source?\"; the sheet's pick toggles that source", () => {
    const t = new Table();
    t.open(PAY);
    t.pile([[805, 806]]);
    t.tapGroupOf(805);
    const sheet = t.p.controls.sheet!;
    expect(sheet.kind).toBe("source");
    expect(sheet.title).toBe("Which source?");
    expect(sheet.items.map((i) => [i.option, i.label, i.picked])).toEqual([
      [1, "Plains (W)", false],
      [2, "Swamp (B)", false],
    ]);
    t.pick(2);
    expect(t.p.controls.sheet).toBeNull();
    t.tapGroupOf(805);
    expect(t.p.controls.sheet!.items.map((i) => i.picked)).toEqual([false, true]);
    t.pick(2); // picked already: taken back
    t.press("Auto-pay");
    expect(t.answers()).toEqual([[]]);
  });

  // 011 with a Mountain that makes R or B (two options on one card), as a dual land's would be.
  const dual = () =>
    withDecision(PAY, {
      kind: "pay",
      prompt: "mana to pay {3}{B} for Thorn of the Black Rose, in order; none = automatic",
      options: ["Plains (W)", "Mountain (R)", "Mountain (B)"],
      refs: [{ card: 805 }, { card: 807 }, { card: 807 }],
      min: 0,
      max: 3,
      repeat: true,
    });

  it("a land with several mana options asks which; the sheet's choice is the one sent (011, options edited)", () => {
    const t = new Table();
    t.open(dual());
    t.tapCard(807);
    const sheet = t.p.controls.sheet!;
    expect(sheet.kind).toBe("mana");
    expect(sheet.title).toBe("Mountain: which mana?");
    expect(sheet.items.map((i) => i.label)).toEqual(["R", "B"]);
    t.pick(3);
    expect(t.p.controls.sheet).toBeNull();
    t.press("Pay");
    expect(t.answers()).toEqual([[3]]);
  });

  it("a source with several mana options asks again on every tap (the engine takes repeats); Take back gives back its picks", () => {
    const t = new Table();
    t.open(dual());
    t.tapCard(807);
    t.pick(3);
    t.tapCard(807);
    const sheet = t.p.controls.sheet!;
    expect(sheet.kind).toBe("mana");
    expect(sheet.items.map((i) => [i.label, i.picked, i.badge])).toEqual([
      ["R", false, null],
      ["B", true, 1],
    ]);
    expect(t.sheetButtons()).toEqual(["Take back"]);
    t.press("Take back");
    expect(t.p.controls.sheet).toBeNull();
    t.press("Auto-pay");
    expect(t.answers()).toEqual([[]]);
  });

  // 011 with Crystalline Crawler (809) and its two counters: "Remove a +1/+1 counter: Add one mana of any color", one
  // option per colour, every one the same ability (the engine activates it once per pick: ManualController's pay).
  const crawler = (max = 6) =>
    withDecision(PAY, {
      kind: "pay",
      prompt: "mana to pay {3}{B} for Thorn of the Black Rose, in order; none = automatic",
      options: ["Swamp (B)", "Crystalline Crawler (W)", "Crystalline Crawler (U)", "Crystalline Crawler (B)", "Crystalline Crawler (R)", "Crystalline Crawler (G)"],
      refs: [{ card: 806 }, { card: 809 }, { card: 809 }, { card: 809 }, { card: 809 }, { card: 809 }],
      min: 0,
      max,
      repeat: true,
    });

  it("the same ability paying twice: Crystalline Crawler's two counters pay two colours, in order", () => {
    const t = new Table();
    t.open(crawler());
    t.tapCard(809);
    t.pick(2);
    t.tapCard(809);
    t.pick(5);
    expect(t.p.controls.prompt?.headline).toMatch(/· Crystalline Crawler \(W\), Crystalline Crawler \(R\)$/);
    t.press("Pay");
    expect(t.answers()).toEqual([[2, 5]]);
  });

  it("the same colour twice from one ability is two picks; Undo takes back only the last", () => {
    const t = new Table();
    t.open(crawler());
    t.tapCard(806);
    t.tapCard(809);
    t.pick(4);
    t.tapCard(809);
    t.pick(4);
    expect(t.p.controls.sheet).toBeNull();
    t.press("Undo");
    t.press("Pay");
    expect(t.answers()).toEqual([[1, 4]]);
  });

  it("refuses only what the engine refuses: more picks than the decision's max (here 3)", () => {
    const t = new Table();
    t.open(crawler(3));
    for (let i = 0; i < 3; i++) {
      t.tapCard(809);
      t.pick(3);
    }
    t.forget();
    t.tapCard(809);
    expect(t.toasts()).toEqual(["Pick at most 3"]);
    expect(t.p.controls.sheet).toBeNull();
    t.press("Pay");
    expect(t.answers()).toEqual([[3, 3, 3]]);
  });

  it("a single-ability land tapped again is still taken back (it taps for its mana once)", () => {
    const t = new Table();
    t.open(crawler());
    t.tapCard(806);
    t.tapCard(806);
    t.press("Auto-pay");
    expect(t.answers()).toEqual([[]]);
  });

  it("the colour sheet only takes its own options; dismissing it picks nothing", () => {
    const t = new Table();
    t.open(dual());
    t.tapCard(807);
    t.pick(1);
    expect(t.p.controls.sheet?.kind).toBe("mana");
    t.dismiss();
    expect(t.p.controls.sheet).toBeNull();
    expect(t.buttons()[0]).toBe("Auto-pay");
  });
});

// corpus 021: one target among twelve creatures, all on the battlefield; 024: cards and players.
describe("targets and choices on the table", () => {
  it("every option on the table: chosen there, and exactly one wanted sends with one tap (corpus 021)", () => {
    const t = new Table();
    t.open("021-targets-monarch.json");
    expect(t.p.controls.sheet).toBeNull();
    expect(t.buttons()).toEqual(["List", "Let Forge decide"]);
    expect(t.p.board.marks.cards.get(856 as CardId)).toBe("option");
    t.tapCard(856);
    expect(t.answers()).toEqual([[2]]);
  });

  it("a player's plate sends the player (corpus 024)", () => {
    const t = new Table();
    t.open("024-targets-monarch.json");
    expect(t.p.board.marks.seats.get("Dack" as never)).toBe("option");
    t.tapSeat("Dack");
    expect(t.answers()).toEqual([[4]]);
  });

  /** Corpus 024 asked with other bounds. */
  const several = (min: number, max: number) => askedAgain(raw("024-targets-monarch.json"), { min, max });

  it("more than one wanted: taps pick, Done is disabled below min and sends the picks (024, bounds edited)", () => {
    const t = new Table();
    t.open(several(2, 3));
    expect(t.buttons()).toEqual(["List", "None", "Let Forge decide"]);
    expect(t.button("None").enabled).toBe(false);
    t.tapCard(856);
    expect(t.answers()).toEqual([]);
    expect(t.button("Done (1)").enabled).toBe(false);
    t.press("Done (1)");
    expect(t.answers()).toEqual([]);
    t.tapCard(834);
    expect(t.button("Done (2)").enabled).toBe(true);
    t.press("Done (2)");
    expect(t.answers()).toEqual([[3, 2]]);
  });

  it("optional (min 0, max 1): a tap picks without sending, a second tap on another swaps; None sends []", () => {
    const t = new Table();
    t.open(several(0, 1));
    t.tapCard(856);
    t.tapCard(834);
    expect(t.answers()).toEqual([]);
    t.press("Done (1)");
    expect(t.answers()).toEqual([[2]]);
    const u = new Table();
    u.open(several(0, 1));
    u.press("None");
    expect(u.answers()).toEqual([[]]);
  });

  it("cards and players together, counted in the headline (corpus 043: proliferate, up to 10)", () => {
    const t = new Table();
    t.open("043-choose-poison.json");
    expect(t.p.controls.prompt?.headline).toMatch(/\(0\/10\)$/);
    t.tapSeat("You");
    t.tapCard(856);
    expect(t.p.controls.prompt?.headline).toMatch(/\(2\/10\)$/);
    expect(t.p.board.marks.seats.get("You" as never)).toBe("selected");
    t.press("Done (2)");
    expect(t.answers()).toEqual([[10, 2]]);
  });

  it("\"List\" opens the same choice as a sheet; a pick there counts as on the table (corpus 021)", () => {
    const t = new Table();
    t.open("021-targets-monarch.json");
    t.press("List");
    const sheet = t.p.controls.sheet!;
    expect(sheet.kind).toBe("chooser");
    expect(sheet.items).toHaveLength(12);
    expect(sheet.items[1]).toMatchObject({ option: 2, card: 856, name: "Blighted Agent" });
    expect(t.answers()).toEqual([]);
    t.pick(2);
    expect(t.answers()).toEqual([[2]]);
  });

  it("an option inside a pile of unlike cards is chosen from a sheet (021, Princess's creatures piled)", () => {
    const t = new Table();
    t.open("021-targets-monarch.json", { piles: [[856, 855]] });
    expect(t.buttons()).toEqual(["Choose…", "Let Forge decide"]);
    expect(t.p.controls.sheet?.kind).toBe("chooser");
    expect(t.p.board.marks.cards.size).toBe(0);
    t.pick(3);
    expect(t.answers()).toEqual([[3]]);
  });

  const swamp = (id: number) =>
    withDecision("021-targets-monarch.json", { kind: "choose", prompt: "choose a land (Ghostly Flicker)", options: ["Swamp"], refs: [{ card: id }] });

  it("an option in a well of its name beside an untapped card that is not an option is chosen from a sheet (021, Swamps)", () => {
    // Princess's Swamps: 857 and 858 tapped, 859 untapped
    const t = new Table();
    t.open(swamp(857), { piles: [[857, 858, 859]] });
    expect(t.p.controls.sheet?.kind).toBe("chooser");
  });

  it("a well where every untapped card is an option is chosen on the table; a tap gives its option (021, Swamps)", () => {
    const t = new Table();
    t.open(swamp(859), { piles: [[857, 858, 859]] });
    t.pile([[857, 858, 859]]);
    expect(t.p.controls.sheet).toBeNull();
    expect(t.buttons()).toContain("List");
    t.tapGroupOf(859);
    expect(t.answers()).toEqual([[1]]);
  });

  it("options the table does not hold (my hand) are chosen from a sheet: discard to hand size (corpus 029)", () => {
    const t = new Table();
    t.open("029-choose-monarch.json");
    const sheet = t.p.controls.sheet!;
    expect(sheet.title).toBe("Discard to hand size");
    expect(sheet.wide).toBe(true);
    expect(t.sheetButtons()).toEqual(["Pick 5"]);
    for (const o of [1, 2, 3, 4]) t.pick(o);
    expect(t.button("Done (4)").enabled).toBe(false);
    t.pick(12);
    t.press("Done (5)");
    expect(t.answers()).toEqual([[1, 2, 3, 4, 12]]);
  });

  it("before the plan arrives the choice is a sheet; when it arrives it moves to the table (corpus 043)", () => {
    const t = new Table();
    t.open("043-choose-poison.json", { noHits: true });
    expect(t.p.controls.sheet?.kind).toBe("chooser");
    t.hits();
    expect(t.p.controls.sheet).toBeNull();
    expect(t.buttons()).toContain("List");
  });

  it("once the player has picked, the mode holds whatever the plan does next (corpus 043)", () => {
    const sheetFirst = new Table();
    sheetFirst.open("043-choose-poison.json", { noHits: true });
    sheetFirst.pick(2);
    sheetFirst.hits();
    expect(sheetFirst.p.controls.sheet?.kind).toBe("chooser");
    expect(sheetFirst.p.controls.sheet?.items[1]?.picked).toBe(true);

    const boardFirst = new Table();
    boardFirst.open("043-choose-poison.json");
    boardFirst.tapCard(856);
    boardFirst.pile([[856, 853]]); // now hidden in a mixed pile
    expect(boardFirst.p.controls.sheet).toBeNull();
    expect(boardFirst.buttons()).toContain("Done (1)");
  });

  it("dismissing the chooser sets it aside; \"Choose…\" brings it back with the picks kept (corpus 029)", () => {
    const t = new Table();
    t.open("029-choose-monarch.json");
    t.pick(1);
    t.dismiss();
    expect(t.p.controls.sheet).toBeNull();
    t.press("Choose…");
    expect(t.p.controls.sheet?.items[0]?.picked).toBe(true);
  });
});

describe("sheet decisions", () => {
  const badges = (t: Table) => t.p.controls.sheet!.items.map((i) => i.badge);

  it("one wanted: a pick sends it (corpus 039: mode)", () => {
    const t = new Table();
    t.open("039-mode-poison.json");
    expect(t.p.controls.sheet?.items.map((i) => i.label)).toEqual(["Create a 2/2 white Cat Beast creature token.", expect.stringMatching(/^Put a \+1\/\+1 counter/)]);
    t.pick(2);
    expect(t.answers()).toEqual([[2]]);
  });

  it("order: picks are numbered in the order picked, Done waits for all, and they are sent in that order (corpus 016)", () => {
    const t = new Table();
    t.open("016-order-mana-pool.json");
    t.pick(3);
    t.pick(1);
    expect(badges(t)).toEqual([2, null, 1]);
    expect(t.sheetButtons()).toEqual(["Clear", "Done (2)"]);
    expect(t.button("Done (2)").enabled).toBe(false);
    t.pick(2);
    expect(badges(t)).toEqual([2, 3, 1]);
    expect(t.answers()).toEqual([]);
    t.press("Done (3)");
    expect(t.answers()).toEqual([[3, 1, 2]]);
  });

  const words = (d: Record<string, unknown>) =>
    withDecision("016-order-mana-pool.json", { kind: "choose", prompt: "choose words (Test)", options: ["Alpha", "Beta"], refs: [{ name: "Alpha" }, { name: "Beta" }], ...d });

  it("repeat: an option can be picked again and its badge counts; a pick at max takes one back (016, a repeatable choice)", () => {
    const t = new Table();
    t.open(words({ repeat: true, min: 1, max: 3 }));
    t.pick(1);
    t.pick(1);
    t.pick(2);
    expect(badges(t)).toEqual([2, 1]);
    expect(t.sheetButtons()).toContain("Done (3)");
    t.pick(1);
    expect(t.sheetButtons()).toContain("Done (2)");
    t.press("Done (2)");
    expect(t.answers()).toEqual([[1, 2]]);
  });

  it("min 2, max 3: \"Pick 2–3\", Done disabled below min; Clear empties (016, a choice)", () => {
    const t = new Table();
    t.open(words({ options: ["Alpha", "Beta", "Gamma"], refs: [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }], min: 2, max: 3 }));
    expect(t.sheetButtons()).toEqual(["Pick 2–3"]);
    t.pick(1);
    expect(t.button("Done (1)").enabled).toBe(false);
    t.press("Clear");
    expect(t.sheetButtons()).toEqual(["Pick 2–3"]);
    t.pick(3);
    t.pick(1);
    t.press("Done (2)");
    expect(t.answers()).toEqual([[3, 1]]);
  });

  it("number: the stepper starts at min, stays between min and max and sends one value (corpus 036: X from 0 to 10)", () => {
    const t = new Table();
    t.open("036-number-poison.json");
    const value = () => t.p.controls.sheet?.stepper?.value;
    expect(t.p.controls.sheet?.stepper).toEqual({ min: 0, max: 10, value: 0 });
    for (let i = 0; i < 12; i++) t.stepBy(1);
    expect(value()).toBe(10);
    t.stepBy(-1);
    expect(value()).toBe(9);
    t.stepBy(-100);
    expect(value()).toBe(0);
    t.stepBy(Number.NaN);
    t.stepBy(0.6);
    expect(value()).toBe(0);
    t.stepBy(3);
    t.press("Choose");
    expect(t.answers()).toEqual([[3]]);
  });

  it("a step with no stepper shown does nothing (corpus 016: order)", () => {
    const t = new Table();
    t.open("016-order-mana-pool.json");
    expect(t.stepBy(1)).toEqual([]);
  });
});
