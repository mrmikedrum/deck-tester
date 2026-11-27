// 3. Auto-pass: an opponent's spell on top, nothing real to answer with, no threat: the client passes after 3,200 ms.
//    c. a replacement decision arriving during the countdown.
const { test, expect, snapshot, withDecision, find, inHand, opponentSpell } = require("./harness.js");

const PASS = { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 };
// Dack's spell on the stack, the decision as given (pass only by default). `aim`: targets for the spell.
const theirSpell = (d = PASS, aim) => {
  const s = snapshot("main");
  return withDecision(s, d, v => { v.active = "Dack"; v.priority = "You"; opponentSpell(v, "Swords to Plowshares", typeof aim === "function" ? aim(s) : aim); });
};
// Open without letting the clock run, so time is measured from the moment the decision arrived.
const open = (t, s) => t.open(s, { animate: false });

test.describe("it passes", () => {
  test("with only pass on offer: nothing at 3,100 ms, one [1] by 3,350 ms", async ({ table }) => {
    const s = theirSpell();
    await open(table, s);
    await table.quiet(3100);
    await table.step(250);
    expect(await table.answered(1)).toEqual([{ key: expect.any(String), answer: [1] }]);
    await table.quiet(1000);
    expect(table.answers()).toHaveLength(1);
  });
  test("with only mana abilities on offer (they are not responses)", async ({ table }) => {
    const base = snapshot("main"), ring = find(base, "You", "Sol Ring").id;
    await open(table, theirSpell({ kind: "play", prompt: "", options: ["Pass", "Sol Ring: {T}: Add {C}{C}."], refs: [{}, { card: ring, spell: false, mana: true }], min: 1, max: 1 }));
    await table.quiet(3100);
    await table.step(250);
    expect((await table.answered(1))[0].answer).toEqual([1]);
  });
  test("a spell aimed at another player's permanent is not a threat", async ({ table }) => {
    await open(table, theirSpell(PASS, s => [find(s, "Marath", "Herd Baloth").id]));
    await table.quiet(3100);
    await table.step(250);
    expect((await table.answered(1))[0].answer).toEqual([1]);
  });
});

test.describe("it does not pass", () => {
  test("a threat to me: a spell aimed at \"You\"", async ({ table }) => {
    await open(table, theirSpell(PASS, ["You"]));
    await table.quiet(10000);
  });
  test("a threat to my permanent", async ({ table }) => {
    await open(table, theirSpell(PASS, s => [find(s, "You", "Meloku the Clouded Mirror").id]));
    await table.quiet(10000);
  });
  test("a counter aimed at one of two activations holds priority", async ({ table }) => {
    const s = snapshot("main");
    const source = find(s, "You", "Meloku the Clouded Mirror");
    await open(table, withDecision(s, PASS, v => {
      v.active = "Dack";
      const counter = opponentSpell(v, "Swords to Plowshares", [source.id]);
      counter.source.name = "Stifle";
      counter.text = "Stifle";
      counter.abilityTargets = [2];
      v.stack.push(
        { id: 3, source, controller: "You", spell: false, text: "Second activation" },
        { id: 2, source, controller: "You", spell: false, text: "First activation" },
      );
    }));
    await table.quiet(10000);
    const headline = await table.page.locator(".l-what").innerText();
    expect(headline).toContain("ability (stack 3)");
    expect(headline).not.toContain("your Meloku");
  });
  test("a real play on offer (a response)", async ({ table }) => {
    const base = snapshot("main"), snap = inHand(base, "Snap").id;
    await open(table, theirSpell({ kind: "play", prompt: "", options: ["Pass", "Snap"], refs: [{}, { card: snap }], min: 1, max: 1 }));
    await table.quiet(10000);
  });
  test("my own spell on top", async ({ table }) => {
    const s = snapshot("main");
    await open(table, withDecision(s, PASS, v => { opponentSpell(v, "Swords to Plowshares", undefined, "You"); v.stack[0].source.owner = "You"; }));
    await table.quiet(10000);
  });
  test("an empty stack", async ({ table }) => {
    await open(table, withDecision(snapshot("main"), PASS));
    await table.quiet(10000);
  });
  test("when Hold is pressed", async ({ table }) => {
    await open(table, theirSpell());
    await table.step(1000);
    expect(await table.buttons()).toContain("Hold");
    await table.press("Hold");
    expect(await table.buttons()).not.toContain("Hold");
    await table.quiet(10000);
  });
  test("when the table is touched during the countdown (touching holds)", async ({ table }) => {
    const s = theirSpell();
    await open(table, s);
    await table.step(1000);
    await table.tap({ x: 590, y: 330 });                  // anywhere on the table: the stack layer covers the cards
    await table.quiet(10000);
  });
  test("Hold is only offered while the countdown runs", async ({ table }) => {
    await open(table, withDecision(snapshot("main"), PASS));
    expect(await table.buttons()).not.toContain("Hold");
  });
});

test.describe("a decision arriving during the countdown", () => {
  test("the same decision again does not restart it", async ({ table }) => {
    const s = theirSpell();
    await open(table, s);
    await table.step(2000);
    await table.push(table.snapshot, { animate: false });   // as the server's idle poll does: same game, same decision
    await table.quiet(1000);                              // 3,000 ms since it began
    await table.step(350);
    expect(await table.answered(1)).toHaveLength(1);
  });
  test("a different decision replaces it: the old timer never answers, the new one counts from its arrival", async ({ table }) => {
    const s = theirSpell();
    await open(table, s);
    await table.step(2000);
    const next = theirSpell({ ...PASS, prompt: "again" });
    await table.push(next, { animate: false });
    await table.quiet(1100);                              // the old timer's 3,200 ms has passed
    await table.quiet(1900);                              // 3,000 ms since the new one
    await table.step(350);
    const sent = await table.answered(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].key).toBe(["play", next.decision.turn, "again", "1", "Pass"].join("|"));
  });
  test("a replacement with a real play never auto-passes, and the old timer is cancelled", async ({ table }) => {
    const base = snapshot("main"), snap = inHand(base, "Snap").id;
    await open(table, theirSpell());
    await table.step(2000);
    await table.push(theirSpell({ kind: "play", prompt: "", options: ["Pass", "Snap"], refs: [{}, { card: snap }], min: 1, max: 1 }), { animate: false });
    await table.quiet(10000);
  });
  test("a replacement that is a threat never auto-passes", async ({ table }) => {
    await open(table, theirSpell());
    await table.step(2000);
    await table.push(theirSpell({ ...PASS, prompt: "again" }, ["You"]), { animate: false });
    await table.quiet(10000);
  });
  test("a replacement that is not a play (a confirm) is never auto-passed", async ({ table }) => {
    await open(table, theirSpell());
    await table.step(2000);
    await table.push(withDecision(snapshot("main"), { kind: "confirm", prompt: "Use it?", options: ["Yes", "No"], min: 1, max: 1 }), { animate: false });
    await table.quiet(10000);
  });
});
