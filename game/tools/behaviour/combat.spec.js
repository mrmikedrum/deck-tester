// 4. attack and 5. block. Option numbers are 1-based positions in decision.options/refs.
//    attack refs: one per (creature, defender), creature-major: option = 3 * creatureIndex + defenderIndex + 1, with the
//    defenders Marath (plate "ana"), Atraxa ("bo"), Dack ("cy").
const { test, expect, snapshot, withDecision, find } = require("./harness.js");

const ATTACKERS = ["Meloku the Clouded Mirror", "Master of Waves", "Faerie Mastermind", "Whirler Rogue"];
const idOf = (s, n) => find(s, "You", n).id;

test.describe("attack", () => {
  test("tap creatures to toggle them; Attack (n) sends the picked options in order", async ({ table }) => {
    const s = snapshot("attack");
    await table.open(s);
    expect(await table.buttons()).toEqual(["Everyone attacks", "No attack", "Let Forge decide"]);
    await table.tapCard(idOf(s, ATTACKERS[0]));
    await table.tapCard(idOf(s, ATTACKERS[1]));
    expect(await table.buttons()).toEqual(["Everyone attacks", "Clear", "Attack (2)", "Let Forge decide"]);
    expect(table.answers()).toEqual([]);
    await table.press("Attack (2)");
    expect((await table.answered(1))[0].answer).toEqual([1, 4]);       // both at Marath, the first opponent
  });
  test("tapping a picked creature takes it back", async ({ table }) => {
    const s = snapshot("attack");
    await table.open(s);
    await table.tapCard(idOf(s, ATTACKERS[0])); await table.tapCard(idOf(s, ATTACKERS[2])); await table.tapCard(idOf(s, ATTACKERS[0]));
    await table.press("Attack (1)");
    expect((await table.answered(1))[0].answer).toEqual([7]);
  });
  test("tapping another player's plate re-aims the picks, and later picks go to that player", async ({ table }) => {
    const s = snapshot("attack");
    await table.open(s);
    await table.tapCard(idOf(s, ATTACKERS[0])); await table.tapCard(idOf(s, ATTACKERS[1]));
    await table.tapPlate("bo");                                        // Atraxa
    await table.tapCard(idOf(s, ATTACKERS[2]));
    expect(table.answers()).toEqual([]);
    await table.press("Attack (3)");
    expect((await table.answered(1))[0].answer).toEqual([2, 5, 8]);
  });
  test("\"Everyone attacks\" picks every creature at the current target; it is gone once all are picked", async ({ table }) => {
    const s = snapshot("attack");
    await table.open(s);
    await table.tapPlate("cy");                                        // Dack
    await table.press("Everyone attacks");
    expect(await table.buttons()).toEqual(["Clear", "Attack (4)", "Let Forge decide"]);
    await table.press("Attack (4)");
    expect((await table.answered(1))[0].answer).toEqual([3, 6, 9, 12]);
  });
  test("Clear empties the picks; \"No attack\" sends []", async ({ table }) => {
    const s = snapshot("attack");
    await table.open(s);
    await table.tapCard(idOf(s, ATTACKERS[0]));
    await table.press("Clear");
    expect(await table.buttons()).toContain("No attack");
    await table.press("No attack");
    expect((await table.answered(1))[0].answer).toEqual([]);
  });
  test("dragging a creature onto a player's plate attacks that player", async ({ table }) => {
    const s = snapshot("attack"), { locate } = require("./harness.js");
    await table.open(s);
    const from = await locate(table.page, { card: idOf(s, ATTACKERS[1]) }), to = await locate(table.page, { plate: "cy" });
    await table.drag(from, to);
    expect(await table.buttons()).toContain("Attack (1)");
    await table.press("Attack (1)");
    expect((await table.answered(1))[0].answer).toEqual([6]);          // Master of Waves -> Dack
  });
  test("a drag the browser cancels picks nothing", async ({ table }) => {
    const s = snapshot("attack"), { locate } = require("./harness.js");
    await table.open(s);
    const from = await locate(table.page, { card: idOf(s, ATTACKERS[1]) }), to = await locate(table.page, { plate: "cy" });
    await table.cancelledTouchDrag(from, to.x - from.x, to.y - from.y);
    await table.quiet(300);
    expect(await table.buttons()).toContain("No attack");
    expect(table.answers()).toEqual([]);
  });
});

test.describe("block", () => {
  // Attackers: Marath (option column 1), Herd Baloth (2), a Beast (3). My blockers: Meloku, Master of Waves, Faerie Mastermind.
  const attackers = s => [find(s, "Marath", "Marath, Will of the Wild"), find(s, "Marath", "Herd Baloth"), find(s, "Marath", "Beast", 0)];
  // Meloku can only block the Beast (a single pairing); Master of Waves can block Marath or Baloth; Faerie only Baloth or the Beast.
  const pairs = s => {
    const [m, h, b] = attackers(s), mk = n => idOf(s, n);
    return [[mk("Meloku the Clouded Mirror"), b], [mk("Master of Waves"), m], [mk("Master of Waves"), h], [mk("Faerie Mastermind"), h], [mk("Faerie Mastermind"), b]];
  };
  const decide = s => withDecision(s, { kind: "block", prompt: "Declare blockers", options: pairs(s).map(() => "block"), refs: pairs(s).map(([c, a]) => ({ card: c, blocks: a.id })), min: 0, max: 99 });
  const mine = (s, n) => idOf(s, n);

  test("a blocker with a single legal pairing picks it with one tap", async ({ table }) => {
    const s = snapshot("block");
    await table.open(decide(s));
    await table.tapCard(mine(s, "Meloku the Clouded Mirror"));
    expect(await table.buttons()).toEqual(["Clear", "Block (1)", "Let Forge decide"]);
    await table.press("Block (1)");
    expect((await table.answered(1))[0].answer).toEqual([1]);
  });
  test("otherwise hold the blocker and tap the attacker it blocks", async ({ table }) => {
    const s = snapshot("block"), [m, h] = attackers(s);
    await table.open(decide(s));
    await table.tapCard(mine(s, "Master of Waves"));
    expect(await table.buttons()).toEqual(["Clear", "No blocks", "Let Forge decide"]);   // held, nothing picked yet
    expect(await table.page.locator(".l-what").innerText()).toMatch(/Now tap the attacker for Master of Waves/);
    await table.tapCard(h.id);
    await table.tapCard(mine(s, "Meloku the Clouded Mirror"));
    expect(await table.buttons()).toContain("Block (2)");
    await table.press("Block (2)");
    expect((await table.answered(1))[0].answer).toEqual([3, 1]);
  });
  test("an illegal pair toasts and picks nothing", async ({ table }) => {
    const s = snapshot("block"), [m] = attackers(s);
    await table.open(decide(s));
    await table.tapCard(mine(s, "Faerie Mastermind"));                 // held: can block Baloth or the Beast
    await table.tapCard(m.id);                                         // not Marath
    expect(await table.toastText()).toBe("That creature can't block that attacker");
    expect(await table.buttons()).toContain("Clear");
    expect(await table.buttons()).not.toContain("Block (1)");
    expect(table.answers()).toEqual([]);
  });
  test("dragging a blocker onto the attacker it can block picks the pair; onto another toasts", async ({ table }) => {
    const { locate } = require("./harness.js");
    const s = snapshot("block"), [m, h] = attackers(s);
    await table.open(decide(s));
    const from = await locate(table.page, { card: mine(s, "Master of Waves") });
    await table.drag(from, await locate(table.page, { card: attackers(s)[2].id }));
    expect(await table.toastText()).toBe("It can't block that");
    await table.drag(await locate(table.page, { card: mine(s, "Master of Waves") }), await locate(table.page, { card: m.id }));
    await table.press("Block (1)");
    expect((await table.answered(1))[0].answer).toEqual([2]);
  });
  test("tapping a picked blocker takes it back; Clear and \"No blocks\"", async ({ table }) => {
    const s = snapshot("block");
    await table.open(decide(s));
    await table.tapCard(mine(s, "Meloku the Clouded Mirror")); await table.tapCard(mine(s, "Meloku the Clouded Mirror"));
    expect(await table.buttons()).toContain("No blocks");
    await table.press("No blocks");
    expect((await table.answered(1))[0].answer).toEqual([]);
  });
});
