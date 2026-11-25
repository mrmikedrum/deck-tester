// 6. pay, 7. on-table targets/choose (a. mixed vs same-name piles), 8. sheet decisions (order, repeat, number).
const { test, expect, snapshot, withDecision, find, locate, pending } = require("./harness.js");
const { label } = require("./labels.js");

const you = (s, n, k = 0) => find(s, "You", n, k);
const grid = t => t.sheet().locator(".l-grid button");

test.describe("pay", () => {
  // Otawara and Mystic Sanctuary are single cards on my table; the untapped Islands (4th-6th) share a well.
  const payment = (s, options, refs) => withDecision(s, { kind: "pay", prompt: "Choose mana to pay {2}{U} for Snap, in order", options, refs, min: 0, max: options.length, repeat: true });
  const simple = s => payment(s, ["Otawara, Soaring City (U)", "Mystic Sanctuary (U)", "Island (U)", "Island (U)"],
    [{ card: you(s, "Otawara, Soaring City").id }, { card: you(s, "Mystic Sanctuary").id }, { card: you(s, "Island", 3).id }, { card: you(s, "Island", 4).id }]);

  test("tap sources, then Pay sends them in the order tapped", async ({ table }) => {
    const s = snapshot("main");
    await table.open(simple(s));
    expect(await table.buttons()).toEqual(["Auto-pay", label("Let Forge decide")]);
    await table.tapCard(you(s, "Mystic Sanctuary").id);
    await table.tapCard(you(s, "Otawara, Soaring City").id);
    await table.tapCard(you(s, "Island", 3).id);
    expect(await table.buttons()).toEqual(["Undo", "Pay", label("Let Forge decide")]);
    expect(table.answers()).toEqual([]);
    await table.press("Pay");
    expect((await table.answered(1))[0].answer).toEqual([2, 1, 3]);
  });
  test("a second tap on a well of the same card takes the next one", async ({ table }) => {
    const s = snapshot("main");
    await table.open(simple(s));
    await table.tapCard(you(s, "Island", 3).id);
    await table.tapCard(you(s, "Island", 3).id);
    await table.press("Pay");
    expect((await table.answered(1))[0].answer).toEqual([3, 4]);
  });
  test("tapping a picked source takes it back; Undo takes back the last", async ({ table }) => {
    const s = snapshot("main");
    await table.open(simple(s));
    await table.tapCard(you(s, "Mystic Sanctuary").id);
    await table.tapCard(you(s, "Otawara, Soaring City").id);
    await table.tapCard(you(s, "Mystic Sanctuary").id);             // taken back
    await table.press("Pay");
    expect((await table.answered(1))[0].answer).toEqual([1]);
    table.forget();
    await table.open(simple(s));
    await table.tapCard(you(s, "Mystic Sanctuary").id);
    await table.tapCard(you(s, "Otawara, Soaring City").id);
    await table.press("Undo");
    await table.press("Pay");
    expect((await table.answered(1))[0].answer).toEqual([2]);
  });
  test("Auto-pay sends []", async ({ table }) => {
    await table.open(simple(snapshot("main")));
    await table.press("Auto-pay");
    expect((await table.answered(1))[0].answer).toEqual([]);
  });
  test("a land with several mana options asks which; the sheet's choice is the one sent", async ({ table }) => {
    const s = snapshot("main"), o = you(s, "Otawara, Soaring City").id;
    await table.open(payment(s, ["Otawara, Soaring City (U)", "Otawara, Soaring City (W)"], [{ card: o }, { card: o }]));
    await table.tapCard(o);
    expect(await table.sheetTitle()).toBe("Otawara, Soaring City: which mana?");
    expect(await table.sheet().locator("button.l-mana").allInnerTexts()).toEqual(["U", "W"]);
    await table.sheet().locator("button.l-mana").nth(1).click();
    expect(await table.sheet().count()).toBe(0);
    await table.press("Pay");
    expect((await table.answered(1))[0].answer).toEqual([2]);
  });
  test("sources of different cards fanned in one pile ask \"Which source?\"", async ({ table }) => {
    const s = snapshot("main"), ring = you(s, "Sol Ring").id, signet = you(s, "Arcane Signet").id;
    await table.open(payment(s, ["Sol Ring (C)", "Arcane Signet (U)"], [{ card: ring }, { card: signet }]));
    await table.tapCard(signet);
    expect(await table.sheetTitle()).toBe("Which source?");
    await table.sheet().locator("button.l-opt").filter({ hasText: "Arcane Signet (U)" }).click();
    await table.press("Pay");
    expect((await table.answered(1))[0].answer).toEqual([2]);
  });
});

test.describe("targets and choices on the table", () => {
  const OPTS = s => [find(s, "Marath", "Herd Baloth"), find(s, "Atraxa", "Glissa, Herald of Predation"), find(s, "Dack", "Restoration Angel")];
  const choice = (s, d) => withDecision(s, {
    kind: "targets", prompt: "target for Reality Shift (Reality Shift)", options: [...OPTS(s).map(c => c.name), "Dack"],
    refs: [...OPTS(s).map(c => ({ card: c.id })), { player: "Dack" }], min: 1, max: 1, ...d,
  });
  test("exactly one wanted: one tap on a card sends at once", { tag: "@cast" }, async ({ table }) => {
    const s = snapshot("main");
    await table.open(choice(s));
    await table.tapCard(OPTS(s)[1].id);
    expect(await table.answered(1)).toEqual([{ key: expect.any(String), answer: [2] }]);
  });
  test("a tapped card on the leaf across is chosen by a tap in its place, off its face", async ({ table }) => {
    // Glissa is Atraxa's, across: tapped, it lies a quarter turn in a place a standing card's height wide (the new entry
    // draws that leaf with the arrangement engine; the current client has no places and taps the card).
    const s = snapshot("main");
    find(s, "Atraxa", "Glissa, Herald of Predation").tapped = true;
    await table.open(choice(s));
    await table.tap(await table.locate({ place: OPTS(s)[1].id }));
    expect(await table.answered(1)).toEqual([{ key: expect.any(String), answer: [2] }]);
  });
  test("exactly one wanted: a tap on a player's plate sends the player", { tag: "@cast" }, async ({ table }) => {
    const s = snapshot("main");
    await table.open(choice(s));
    await table.tapPlate("cy");
    expect((await table.answered(1))[0].answer).toEqual([4]);
  });
  test("more than one wanted: taps pick, Done is disabled below min and sends the picks", async ({ table }) => {
    const s = snapshot("main");
    await table.open(choice(s, { min: 2, max: 3 }));
    expect(await table.buttons()).toEqual(["List", "None", label("Let Forge decide")]);
    expect(await table.button("None").isDisabled()).toBe(true);
    await table.tapCard(OPTS(s)[2].id);
    expect(table.answers()).toEqual([]);
    expect(await table.button("Done (1)").isDisabled()).toBe(true);
    await table.press("Done (1)").catch(() => {});                   // a disabled button sends nothing
    await table.quiet(100);
    expect(table.answers()).toEqual([]);
    await table.tapCard(OPTS(s)[0].id);
    expect(await table.button("Done (2)").isEnabled()).toBe(true);
    await table.press("Done (2)");
    expect((await table.answered(1))[0].answer).toEqual([3, 1]);
  });
  test("optional (min 0, max 1): a tap picks without sending; None sends []", async ({ table }) => {
    const s = snapshot("main");
    await table.open(choice(s, { min: 0 }));
    await table.tapCard(OPTS(s)[0].id);
    expect(table.answers()).toEqual([]);
    await table.press("Done (1)");
    expect((await table.answered(1))[0].answer).toEqual([1]);
    table.forget();
    await table.open(choice(s, { min: 0 }));
    await table.press("None");
    expect((await table.answered(1))[0].answer).toEqual([]);
  });
  test("\"List\" opens the same choice as a sheet", async ({ table }) => {
    const s = snapshot("main");
    await table.open(choice(s));
    await table.press("List");
    expect(await table.sheet().count()).toBe(1);
    expect(table.answers()).toEqual([]);
  });

  // a. Where an option is hidden in a pile of unlike cards the choice goes to a sheet; a pile of one card by name
  //    (a land well) stays on the table.
  test("an option inside a pile of unlike cards is chosen from a sheet", async ({ table }) => {
    const s = snapshot("main"), ring = you(s, "Sol Ring");
    await table.open(withDecision(s, { kind: "choose", prompt: "Choose an artifact (Ghostly Flicker)", options: ["Sol Ring"], refs: [{ card: ring.id }], min: 1, max: 1 }));
    expect(await table.sheet().count()).toBe(1);
    expect(await table.buttons()).toContain("Choose…");
    await grid(table).first().click();
    expect((await table.answered(1))[0].answer).toEqual([1]);
  });
  test("an option in a well of same-named cards, with other untapped ones that are not options, is chosen from a sheet", async ({ table }) => {
    const s = snapshot("main"), isl = you(s, "Island", 4);
    await table.open(withDecision(s, { kind: "choose", prompt: "Choose a land (Ghostly Flicker)", options: ["Island"], refs: [{ card: isl.id }], min: 1, max: 1 }));
    expect(await table.sheet().count()).toBe(1);
  });
  test("a well where every untapped card is an option is chosen on the table", async ({ table }) => {
    const s = snapshot("main"), islands = [3, 4, 5].map(k => you(s, "Island", k));   // the other three are tapped
    await table.open(withDecision(s, { kind: "choose", prompt: "Choose a land (Ghostly Flicker)", options: islands.map(() => "Island"), refs: islands.map(c => ({ card: c.id })), min: 1, max: 1 }));
    expect(await table.sheet().count()).toBe(0);
    expect(await table.buttons()).toContain("List");
    await table.tapCard(islands[1].id);
    expect((await table.answered(1))[0].answer).toEqual([1]);               // the well gives its first option, whichever card was meant
  });
});

test.describe("sheet decisions", () => {
  const words = ["Alpha", "Beta", "Gamma"];
  const sheetDecision = (s, d) => withDecision(s, { kind: "choose", prompt: "Choose words (Test)", options: words, refs: words.map(name => ({ name })), min: 1, max: 1, ...d });
  const n = async (t, i) => (await grid(t).nth(i).getAttribute("data-n"));

  test("one wanted: a tap on an option sends it", async ({ table }) => {
    await table.open(sheetDecision(snapshot("main"), {}));
    await grid(table).nth(1).click();
    expect((await table.answered(1))[0].answer).toEqual([2]);
  });
  test("min 2, max 3: Done is disabled below min", async ({ table }) => {
    await table.open(sheetDecision(snapshot("main"), { min: 2, max: 3 }));
    expect(await table.sheet().locator(".l-done").innerText()).toBe("Pick 2–3");
    await grid(table).nth(0).click();
    expect(await table.sheet().locator(".l-done").isDisabled()).toBe(true);
    await grid(table).nth(2).click();
    expect(await table.sheet().locator(".l-done").innerText()).toBe("Done (2)");
    await table.sheet().locator(".l-done").click();
    expect((await table.answered(1))[0].answer).toEqual([1, 3]);
  });
  test("order: picks are numbered in the order tapped and sent in that order", async ({ table }) => {
    await table.open(sheetDecision(snapshot("main"), { kind: "order", prompt: "Order blockers", min: 3, max: 3 }));
    await grid(table).nth(2).click(); await grid(table).nth(0).click();
    expect([await n(table, 0), await n(table, 1), await n(table, 2)]).toEqual(["2", null, "1"]);
    expect(await table.sheet().locator(".l-done").isDisabled()).toBe(true);
    await grid(table).nth(1).click();
    expect([await n(table, 0), await n(table, 1), await n(table, 2)]).toEqual(["2", "3", "1"]);
    await table.sheet().locator(".l-done").click();
    expect((await table.answered(1))[0].answer).toEqual([3, 1, 2]);
  });
  test("repeat: the same option can be picked again and its badge counts; a pick at max drops the first of that option", async ({ table }) => {
    await table.open(sheetDecision(snapshot("main"), { options: ["Alpha", "Beta"], refs: [{ name: "Alpha" }, { name: "Beta" }], repeat: true, min: 1, max: 3 }));
    await grid(table).nth(0).click(); await grid(table).nth(0).click(); await grid(table).nth(1).click();
    expect([await n(table, 0), await n(table, 1)]).toEqual(["2", "1"]);
    expect(await table.sheet().locator(".l-done").innerText()).toBe("Done (3)");
    await grid(table).nth(0).click();                                // already at max: takes one Alpha back
    expect(await table.sheet().locator(".l-done").innerText()).toBe("Done (2)");
    await table.sheet().locator(".l-done").click();
    expect((await table.answered(1))[0].answer).toEqual([1, 2]);
  });
  test("Clear empties the picks", async ({ table }) => {
    await table.open(sheetDecision(snapshot("main"), { min: 0, max: 3 }));
    expect(await table.sheet().locator(".l-done").innerText()).toBe("None");
    await grid(table).nth(0).click();
    await table.sheet().locator(".l-ghost").click();
    expect(await table.sheet().locator(".l-done").innerText()).toBe("None");
    await table.sheet().locator(".l-done").click();
    expect((await table.answered(1))[0].answer).toEqual([]);
  });
  test("number: the stepper stays between min and max and sends one value", async ({ table }) => {
    await table.open(sheetDecision(snapshot("main"), { kind: "number", prompt: "Choose a value for X (Fireball)", options: [], refs: undefined, min: 1, max: 4 }));
    const out = table.sheet().locator("output"), plus = table.sheet().locator(".l-number button").nth(1), minus = table.sheet().locator(".l-number button").nth(0);
    expect(await out.innerText()).toBe("1");
    for (let i = 0; i < 6; i++) await plus.click();
    expect(await out.innerText()).toBe("4");
    await minus.click();
    expect(await out.innerText()).toBe("3");
    for (let i = 0; i < 6; i++) await minus.click();
    expect(await out.innerText()).toBe("1");
    await plus.click(); await plus.click();
    await table.sheet().locator(".l-done").click();
    expect(await table.answered(1)).toEqual([{ key: expect.any(String), answer: [3] }]);
  });
});
