// 9. mulligan / confirm / "Let Forge decide"; 10. refusals; f. new games and reconnects while an answer is pending;
// g. empty and startup states.
const { test, expect, NEW, snapshot, withDecision, find, inHand, opponentSpell, keyOf, locate } = require("./harness.js");
const { label } = require("./labels.js");

const PASS = { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 };
const mulligan = s => withDecision(s, { kind: "mulligan", prompt: "Keep this hand?", options: ["Keep", "Mulligan"], min: 1, max: 1 });
const confirm = s => withDecision(s, { kind: "confirm", prompt: "Use Sol Ring?", options: ["Yes", "No"], min: 1, max: 1 });

test("the sift caption keeps the close stud inside its button", async ({ table }) => {
  test.skip(!NEW, "The sift caption belongs to the TypeScript client");
  await table.open("main");
  await table.tap(await locate(table.page, { pile: "ana" }));
  const close = table.page.locator(".l-sift").getByRole("button", { name: "Put back" });
  await expect(close).toHaveCSS("position", "relative");
  expect(await close.evaluate(button => button.offsetWidth)).toBe(44);
  await table.press("Put back");
  await expect(table.page.locator(".l-sift")).toBeHidden();
});

test.describe("mulligan and confirm", () => {
  test("Keep sends [1], Mulligan sends [2]; the hand is over the table", async ({ table }) => {
    const s = snapshot("main");
    await table.open(mulligan(s));
    expect(await table.page.locator(".l-mull .cards button").count()).toBe(7);
    expect(await table.page.locator(".l-mull .l-buttons button").allInnerTexts()).toEqual(["Mulligan", "Keep 7"]);
    await table.press("Keep 7");
    expect(await table.answered(1)).toEqual([{ key: expect.any(String), answer: [1] }]);
    table.forget();
    await table.open(mulligan(s));
    await table.press("Mulligan");
    expect((await table.answered(1))[0].answer).toEqual([2]);
  });
  test("a mulligan is never offered \"Let Forge decide\"", async ({ table }) => {
    await table.open(mulligan(snapshot("main")));
    expect(await table.page.getByRole("button", { name: label("Let Forge decide") }).count()).toBe(0);
  });
  test("confirm: Yes sends [1], No sends [2]", async ({ table }) => {
    const s = snapshot("main");
    await table.open(confirm(s));
    expect(await table.buttons()).toEqual(["Yes", "No", label("Let Forge decide")]);
    await table.press("Yes");
    expect((await table.answered(1))[0].answer).toEqual([1]);
    table.forget();
    await table.open(confirm(s));
    await table.press("No");
    expect((await table.answered(1))[0].answer).toEqual([2]);
  });
  test("\"Let Forge decide\" sends {key, defer: true}", async ({ table }) => {
    const s = confirm(snapshot("main"));
    await table.open(s);
    await table.press(label("Let Forge decide"));
    expect(await table.answered(1)).toEqual([{ key: keyOf(s.decision), defer: true }]);
  });
  test("Let Forge decide is offered on play with plays, hidden when a spell is up and nothing can answer", async ({ table }) => {
    await table.open("main");
    expect(await table.buttons()).toContain(label("Let Forge decide"));
    const s = snapshot("main");
    await table.open(withDecision(s, PASS, v => { v.active = "Dack"; opponentSpell(v, "Swords to Plowshares", [find(s, "Marath", "Herd Baloth").id]); }), { animate: false });
    expect(await table.buttons()).not.toContain(label("Let Forge decide"));
  });
  test("Let Forge decide on a play sends defer, not [1]", async ({ table }) => {
    await table.open("main");
    await table.press(label("Let Forge decide"));
    const a = (await table.answered(1))[0];
    expect(a.defer).toBe(true);
    expect(a.answer).toBeUndefined();
  });
});

test.describe("refusals", () => {
  test("ok:false toasts the error and frees the prompt: a second answer can be sent", async ({ table }) => {
    table.reply.answer = { ok: false, error: "x" };
    await table.open("main");
    await table.press("To combat");
    await table.answered(1);
    await table.step(100);
    expect(await table.toastText()).toBe("x");
    expect(await table.buttons()).toContain("To combat");
    table.reply.answer = { ok: true };
    await table.press("To combat");
    expect(await table.answered(2)).toHaveLength(2);
  });
  test("a stale key is refused by the server and toasted the same way", async ({ table }) => {
    table.reply.answer = { ok: false, error: "that decision has passed" };
    await table.open("main");
    await table.press("To combat");
    await table.answered(1);
    await table.step(100);
    expect(await table.toastText()).toBe("that decision has passed");
  });
  test("a refusal without a message toasts \"Forge refused that\"", async ({ table }) => {
    table.reply.answer = { ok: false };
    await table.open("main");
    await table.press("To combat");
    await table.answered(1); await table.step(100);
    expect(await table.toastText()).toBe("Forge refused that");
  });
  // The current client gives up on a dropped answer at once. The new entry follows the answer ledger (docs/game-client-
  // architecture.md, "The answer ledger"): a dropped reply proves nothing, so the prompt stays busy until a snapshot
  // asked for after the failure shows the bridge never had the answer; only then is it lost and toasted.
  test("a lost connection toasts \"Lost the bridge\" and frees the prompt", async ({ table }) => {
    table.reply.answer = null;
    await table.open("main");
    await table.press("To combat");
    await table.answered(1); await table.step(100);
    if (NEW) {
      expect(await table.buttons()).toEqual([]);                      // indeterminate: busy, nothing said yet
      expect(await table.toastText()).toBe("");
      await table.push(table.snapshot);                               // the re-sync: no answer status, the same decision
      await table.step(100);
    }
    expect(await table.toastText()).toBe("Lost the bridge");
    table.reply.answer = { ok: true };
    await table.press("To combat");
    expect(await table.answered(2)).toHaveLength(2);
  });
  test("the toast goes away after 2,600 ms", async ({ table }) => {
    table.reply.answer = { ok: false, error: "x" };
    await table.open("main");
    await table.press("To combat");
    await table.answered(1); await table.step(100);
    await table.step(2700);
    expect(await table.toastText()).toBe("");
  });
  // Characterization of a known fault (migration doc): an ACCEPTED answer that leaves the view and the decision
  // unchanged leaves the prompt busy for ever. The test pins today's behaviour; fix deliberately and update it then.
  test("an accepted answer with nothing changing leaves the prompt busy (known fault)", async ({ table }) => {
    await table.open("main");
    await table.press("To combat");
    await table.answered(1);
    await table.step(5000);
    expect(await table.buttons()).toEqual([]);
    expect(await table.page.locator(".l-what").innerText()).toBe("…");
    await table.push(table.snapshot, { animate: true });              // the engine repeating the same snapshot changes nothing
    expect(await table.buttons()).toEqual([]);
  });
  test("an accepted answer is followed by the next decision: the prompt works again", async ({ table }) => {
    const s = snapshot("main");
    await table.open(s);
    await table.press("To combat");
    await table.answered(1);
    await table.push(withDecision(s, PASS, v => { v.phase = "COMBAT_DECLARE_ATTACKERS"; v.combat = null; }));
    expect(await table.buttons()).toContain("Pass");
    await table.pass();
    expect(await table.answered(2)).toHaveLength(2);
  });
});

test.describe("new games and reconnects", () => {
  test("a new gen while an answer is pending: the old reply is ignored and the new decision answers normally", async ({ table }) => {
    const s = snapshot("main");
    table.hold = true;
    await table.open(s);
    await table.press("To combat");
    await table.answered(1);
    const next = withDecision(snapshot("theirs"), PASS);
    await table.open(next);                                            // a new gen
    expect(await table.buttons()).toContain("Pass");
    table.reply.answer = { ok: false, error: "late" };
    await table.release({ ok: false, error: "late" });                 // the old request fails late: no toast for a decision that is gone
    expect(await table.toastText()).toBe("");
    table.hold = false;
    await table.pass();
    const all = await table.answered(2);
    expect(all).toHaveLength(2);
    expect(all[1].key).toBe(keyOf(next.decision));                     // the new decision's key, not the old one's
  });
  test("a new gen clears the attack picks; the same gen with the same decision keeps them", async ({ table }) => {
    const s = snapshot("attack"), c = find(s, "You", "Faerie Mastermind").id;
    await table.open(s);
    await table.tapCard(c);
    expect(await table.buttons()).toContain("Attack (1)");
    await table.push(table.snapshot);                                  // the same game, nothing new (a poll timing out)
    expect(await table.buttons()).toContain("Attack (1)");
    await table.open(s);                                               // a new game
    expect(await table.buttons()).toContain("No attack");
    expect(table.answers()).toEqual([]);
  });
  test("a new gen closes an open sheet", async ({ table }) => {
    const s = snapshot("main");
    await table.open(s);
    await table.press(label("Choose a play (6)"));
    expect(await table.sheet().count()).toBe(1);
    await table.open(snapshot("theirs"));
    expect(await table.sheet().count()).toBe(0);
  });
  test("the server's v going backwards is taken as it comes: the snapshot replaces the decision, nothing is sent", async ({ table }) => {
    const s = snapshot("main");
    await table.open(s);
    await table.push(withDecision(s, { ...PASS, prompt: "after a restart" }, v => { v.phase = "MAIN2"; }), { v: 1 });
    expect(await table.buttons()).toContain("End turn");
    expect(await table.page.locator(".l-where").innerText()).toMatch(/second main/i);
    expect(table.answers()).toEqual([]);
    await table.pass();
    expect((await table.answered(1))[0].key).toBe(["play", "T9 main", "after a restart", "1", "Pass"].join("|"));
  });
  test("v going backwards while an answer is pending, with a changed view: the new decision takes over", async ({ table }) => {
    const s = snapshot("main");
    table.hold = true;
    await table.open(s);
    await table.press("To combat");
    await table.answered(1);
    await table.push(withDecision(s, PASS, v => { v.phase = "MAIN2"; }), { v: 1 });
    expect(await table.buttons()).toContain("End turn");
    expect(table.answers()).toHaveLength(1);                            // nothing new was sent by the switch itself
  });
});

test.describe("empty and startup states", () => {
  const states = [
    ["no game", { state: "no game" }, /No game yet/, true],
    ["starting", { state: "starting" }, /Shuffling up/, false],
    ["a playing snapshot with an empty view", { state: "playing", view: {}, decision: null, pilots: {} }, /No game yet/, true],
    ["an error", { state: "error", error: "no such deck" }, /Couldn't start: no such deck/, true],
  ];
  for (const [name, snap, text, newGame] of states) {
    test(`${name}: waiting UI, nothing sent`, async ({ table }) => {
      await table.open("main");
      await table.open(snap);
      expect(await table.page.locator(".l-what").innerText()).toMatch(text);
      expect(await table.buttons()).toEqual(newGame ? ["New game"] : []);
      await table.quiet(5000);
      expect(table.log).toEqual([]);
    });
  }
  test("a game after the empty states plays normally", async ({ table }) => {
    await table.open({ state: "no game" });
    await table.open("main");
    await table.pass();
    expect((await table.answered(1))[0].answer).toEqual([1]);
  });
  test("New game opens the deck form; Start posts the choice to /api/new", async ({ table }) => {
    await table.open({ state: "no game" });
    await table.press("New game");
    expect(await table.sheetTitle()).toBe("New game");
    expect(await table.sheet().locator("select").count()).toBe(5);
    await table.sheet().getByRole("button", { name: "Start", exact: true }).click();
    await table.step(100);
    const posted = table.log.filter(e => e.endpoint === "new");
    expect(posted).toHaveLength(1);
    expect(Object.keys(posted[0].body).sort()).toEqual(["deck", "mana", "opponents"]);
    expect(posted[0].body.opponents).toHaveLength(3);
    expect(posted[0].body.mana).toBe("creatures");
    expect(["blue-moon.txt", "dack-cedh.txt"]).toContain(posted[0].body.deck);
    expect(table.answers()).toEqual([]);
  });
});
