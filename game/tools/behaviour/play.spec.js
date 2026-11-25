// 2. `play` decisions: Pass, dragging a hand card up, tapping glowing permanents, direct mana, rapid input, cancelled drags.
//    (also d. duplicate input, e. pointer cancellation, b. mana activation)
const { test, expect, snapshot, withDecision, find, inHand, opponentSpell, sleep, locate, pending } = require("./harness.js");

const PASS = { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 };
const passLabel = async t => (await t.page.locator(".l-buttons .l-pass").first().innerText()).trim();

test.describe("the pass button", () => {
  // The label by phase. Option 1 is always pass, and every pass button sends [1].
  const cases = [
    ["my main phase", s => withDecision(s, { ...PASS }), "To combat"],
    ["my second main", s => withDecision(s, { ...PASS }, v => { v.phase = "MAIN2"; }), "End turn"],
    ["my end step", s => withDecision(s, { ...PASS }, v => { v.phase = "END_OF_TURN"; }), "Pass"],
    ["their turn", s => withDecision(s, { ...PASS }, v => { v.active = "Atraxa"; v.priority = "Atraxa"; }), "Pass"],
    ["attackers aimed at me", s => withDecision(s, { ...PASS }, v => {
      v.active = "Marath"; v.phase = "COMBAT_DECLARE_ATTACKERS";
      v.combat = { attackers: [{ id: find(s, "Marath", "Herd Baloth").id, defender: "You" }], blockers: [] };
    }), "Pass toward blocks"],
    ["an opponent's spell on the stack", s => withDecision(s, { ...PASS }, v => { v.active = "Dack"; opponentSpell(v, "Swords to Plowshares", [find(s, "Marath", "Herd Baloth").id]); }), "Pass priority"],
  ];
  for (const [name, make, label] of cases) {
    test(`${name}: "${label}" sends [1]`, { tag: "@cast" }, async ({ table }) => {
      await table.open(make(snapshot("main")));
      expect(await passLabel(table)).toBe(label);
      await table.pass();
      expect(await table.answered(1)).toEqual([{ key: expect.any(String), answer: [1] }]);
    });
  }
  test("with plays on offer the pass button keeps its label and the plays get their own button", { tag: "@cast" }, async ({ table }) => {
    await table.open("main");
    expect(await table.buttons()).toEqual(["Choose a play (6)", "Let Forge decide", "To combat"]);
    await table.press("To combat");
    expect((await table.answered(1))[0].answer).toEqual([1]);
  });
  // Discrepancy with the doc's wording: with a spell on the stack AND a "Let Forge decide" button (an option exists, or the
  // spell is mine) the pass button is labelled plain "Pass", not "Pass priority".
  test("an opponent's spell and a response on offer: the pass button reads \"Pass\"", { tag: "@cast" }, async ({ table }) => {
    const s = snapshot("threat");
    await table.open(s);
    expect(await passLabel(table)).toBe("Pass");
    await table.pass();
    expect((await table.answered(1))[0].answer).toEqual([1]);
  });
});

test.describe("dragging a hand card up", () => {
  const one = (s, name) => withDecision(s, { kind: "play", prompt: "", options: ["Pass", name], refs: [{}, { card: inHand(s, name).id }], min: 1, max: 1 });
  test("90 px or more with exactly one play sends it; less sends nothing", { tag: "@cast" }, async ({ table }) => {
    const s = snapshot("main"), fs = inHand(s, "Frantic Search").id;
    await table.open(one(s, "Frantic Search"));
    await table.dragHandCard(fs, 60);
    await table.quiet(200);
    expect(table.answers()).toEqual([]);
    await table.dragHandCard(fs, 89);
    await table.quiet(200);
    expect(table.answers()).toEqual([]);
    await table.dragHandCard(fs, 100);
    expect(await table.answered(1)).toEqual([{ key: expect.any(String), answer: [2] }]);
  });
  test("a card with several plays opens a sheet named for it; choosing sends that play", async ({ table }) => {
    const s = snapshot("main"), fs = inHand(s, "Frantic Search").id;
    await table.open(withDecision(s, { kind: "play", prompt: "", options: ["Pass", "Frantic Search", "Frantic Search (Flashback)"], refs: [{}, { card: fs }, { card: fs }], min: 1, max: 1 }));
    await table.dragHandCard(fs, 120);
    expect(await table.sheetTitle()).toBe("Frantic Search");
    expect(table.answers()).toEqual([]);
    const labels = await table.sheet().locator("button.l-opt b").allInnerTexts();   // each button also carries the cost
    expect(labels.map(l => l.split("\n")[0])).toEqual(["Cast Frantic Search", "Cast Frantic Search (Flashback)"]);
    await table.sheet().locator("button.l-opt").nth(1).click();
    expect((await table.answered(1))[0].answer).toEqual([3]);
  });
  test("a card with no play toasts and sends nothing", { tag: "@cast" }, async ({ table }) => {
    const s = snapshot("main");
    await table.open(one(s, "Frantic Search"));
    await table.dragHandCard(inHand(s, "Snap").id, 120);
    expect(await table.toastText()).toBe("You can't play that now");
    await table.quiet(100);
    expect(table.answers()).toEqual([]);
  });
  test("a drag the browser cancels sends nothing", { tag: "@cast" }, async ({ table }) => {
    const s = snapshot("main"), fs = inHand(s, "Frantic Search").id;
    await table.open(one(s, "Frantic Search"));
    await table.cancelledTouchDrag(await table.locateHand(fs), 0, -140);
    await table.quiet(300);
    expect(table.answers()).toEqual([]);
    expect(await table.toastText()).toBe("");
    // and the hand still works afterwards
    await table.dragHandCard(fs, 120);
    expect((await table.answered(1))[0].answer).toEqual([2]);
  });
});

test.describe("tapping what glows", () => {
  test("a permanent with an ability opens it with the ability as a button; the button sends that option", async ({ table }) => {
    const s = snapshot("main");
    await table.open(s);
    await table.tapCard(find(s, "You", "Meloku the Clouded Mirror").id);
    const act = table.page.locator(".l-actions button");
    expect(await act.count()).toBe(1);
    expect(table.answers()).toEqual([]);
    await act.first().click();
    expect((await table.answered(1))[0].answer).toEqual([5]);
  });
  test("a permanent with no play opens nothing of ours and sends nothing", async ({ table }) => {
    const s = snapshot("main");
    await table.open(s);
    await table.tapCard(find(s, "You", "Master of Waves").id);
    expect(await table.page.locator(".l-actions button").count()).toBe(0);
    expect(table.answers()).toEqual([]);
  });
  test("the commander plays from my plate", async ({ table }) => {
    const s = snapshot("main");
    await table.open(s);
    await table.click(await locate(table.page, { plate: "you" }));
    await table.page.locator(".l-actions button").first().click();
    expect((await table.answered(1))[0].answer).toEqual([7]);
  });
  test("\"Choose a play\" lists everything; the list never sends by itself", async ({ table }) => {
    await table.open("main");
    await table.press("Choose a play (6)");
    expect(await table.sheetTitle()).toBe("Everything you can play");
    expect(await table.sheet().locator("button.l-opt").count()).toBe(6);
    expect(table.answers()).toEqual([]);
    await table.sheet().locator("button.l-opt").nth(2).click();
    expect((await table.answered(1))[0].answer).toEqual([4]);
  });
});

test.describe("mana abilities", () => {
  const mana = s => withDecision(s, { kind: "play", prompt: "", options: ["Pass", "Mystic Sanctuary: {T}: Add {U}."], refs: [{}, { card: find(s, "You", "Mystic Sanctuary").id, spell: false, mana: true }], min: 1, max: 1 });
  test("tapping a source whose only option is mana opens it with the ability; choosing sends it", async ({ table }) => {
    const s = snapshot("main");
    await table.open(mana(s));
    await table.click(await locate(table.page, { card: find(s, "You", "Mystic Sanctuary").id }));
    expect(await table.page.locator(".l-actions button").count()).toBe(1);
    await table.page.locator(".l-actions button").first().click();
    expect((await table.answered(1))[0].answer).toEqual([2]);
  });
  test("the colour question that follows is a sheet; one tap sends the colour", async ({ table }) => {
    const s = snapshot("main");
    await table.open(mana(s));
    await table.click(await locate(table.page, { card: find(s, "You", "Mystic Sanctuary").id }));
    await table.page.locator(".l-actions button").first().click();
    await table.answered(1);
    await table.push(withDecision(s, { kind: "choose", prompt: "Choose a color (Sol Ring)", options: ["white", "blue", "black", "red", "green"], refs: [{ name: "white" }, { name: "blue" }, { name: "black" }, { name: "red" }, { name: "green" }], min: 1, max: 1 }));
    expect(await table.sheetTitle()).toMatch(/Choose a color/);
    await table.sheet().locator("button").filter({ hasText: "black" }).first().click();
    expect((await table.answered(2))[1].answer).toEqual([3]);
  });
  test("mana is not a play: it is not in the plays list", async ({ table }) => {
    const s = snapshot("main");
    await table.open(mana(s));
    expect(await table.buttons()).not.toContain("Choose a play (1)");
  });
});

test.describe("rapid input while the answer is in flight", () => {
  test("double-tapping Pass sends one answer", { tag: "@cast" }, async ({ table }) => {
    await table.open("main");
    const r = await table.button("To combat").boundingBox(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    await table.page.touchscreen.tap(x, y); await table.page.touchscreen.tap(x, y);
    await table.page.mouse.click(x, y);
    await sleep(300);
    expect(table.answers()).toHaveLength(1);
    await table.quiet(500);
    expect(table.answers()).toHaveLength(1);
  });
  test("a second option while the first is pending is ignored", async ({ table }) => {
    const s = snapshot("main");
    table.hold = true;                                   // the answer request stays pending
    await table.open(s);
    await table.tapCard(find(s, "You", "Meloku the Clouded Mirror").id);
    await table.page.locator(".l-actions button").first().click();
    await table.answered(1);
    await table.tapPlate("you");                          // while busy: nothing opens, nothing sends
    await table.quiet(300);
    expect(table.answers()).toHaveLength(1);
  });
});
