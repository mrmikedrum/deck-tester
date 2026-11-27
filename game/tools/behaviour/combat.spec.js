// 4. attack and 5. block. Option numbers are 1-based positions in decision.options/refs.
//    attack refs: one per (creature, defender), creature-major: option = 3 * creatureIndex + defenderIndex + 1, with the
//    defenders Marath (plate "ana"), Atraxa ("bo"), Dack ("cy").
const { test, expect, snapshot, withDecision, find, STATES } = require("./harness.js");

const ATTACKERS = ["Meloku the Clouded Mirror", "Master of Waves", "Faerie Mastermind", "Whirler Rogue"];
const idOf = (s, n) => find(s, "You", n).id;

test.describe("attack", () => {
  test("tap creatures to toggle them; Attack (n) sends the picked options in order", async ({ table }) => {
    const s = snapshot("attack");
    await table.open(s);
    await expect.poll(() => table.buttons()).toEqual(["All attack", "No attack", "Auto"]);
    await table.tapCard(idOf(s, ATTACKERS[0]));
    await table.tapCard(idOf(s, ATTACKERS[1]));
    expect(await table.buttons()).toEqual(["All attack", "Clear", "Attack (2)", "Auto"]);
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
    await table.press("All attack");
    await table.step(2000);                                              // the ten go to the fight
    expect(await table.buttons()).toEqual(["Clear", "Attack (4)", "Auto"]);
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
    expect(await table.buttons()).toEqual(["Clear", "Block (1)", "Auto"]);
    await table.press("Block (1)");
    expect((await table.answered(1))[0].answer).toEqual([1]);
  });
  test("otherwise hold the blocker and tap the attacker it blocks", async ({ table }) => {
    const s = snapshot("block"), [m, h] = attackers(s);
    await table.open(decide(s));
    await table.tapCard(mine(s, "Master of Waves"));
    expect(await table.buttons()).toEqual(["Clear", "No blocks", "Auto"]);   // held, nothing picked yet
    expect(await table.page.locator(".l-ctx").innerText()).toContain("Master of Waves: tap an attacker");
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

// A crowded fight: ten distinct creatures in one fight, gathered into the fight, where a summary of several may stand
// for some of them. A gesture must mean the card the player meant: a fighter keeps its own target, or the group it is
// drawn in opens (a sift) and the card is tapped there; nothing is committed before that.
test.describe("a crowded fight", () => {
  const NAMES = ["Incubation Druid", "Evolution Sage", "Hangarback Walker", "Ouroboroid", "Pollenbright Druid", "Kami of Whispered Hopes", "Evolution Witness", "Haywire Mite", "Rishkar, Peema Renegade", "Generous Patron"];
  const IDS = NAMES.map((_, i) => 300 + i);
  /** Ten distinct creatures (300..309) for `who`, cloned from Meloku, untapped. */
  const ten = (view, who) => {
    const proto = find({ view: STATES.block.view }, "You", "Meloku the Clouded Mirror");
    const p = view.players.find(x => x.name === who);
    p.battlefield.push(...NAMES.map((name, i) => Object.assign(JSON.parse(JSON.stringify(proto)), { id: IDS[i], name, owner: who, controller: who, tapped: false })));
  };
  /** Mean this card: on a sheet, its entry; on the table, its own target, or the group it is in, then the sifted card. */
  const choose = async (table, id, name) => {
    const sift = table.page.locator(".l-sift");
    if (await table.sheet().count()) return table.sheet().locator(".l-grid button").filter({ hasText: name }).first().click();
    await table.tapCard(id);
    if (await sift.isVisible()) {
      expect(table.answers()).toEqual([]);                               // nothing committed while the choice is open
      await table.tap(await table.locate({ sifted: id }));
      expect(await sift.isVisible()).toBe(false);                       // chosen: the sift goes
      await table.step(1500);                                            // and its cards go back
    }
  };

  test("blocking a specific one of ten distinct attackers across sends that pair", async ({ table }) => {
    const s = snapshot("block");
    const s2 = withDecision(s, null, v => {
      ten(v, "Atraxa");
      v.active = "Atraxa";
      v.phase = "COMBAT_DECLARE_BLOCKERS";
      v.combat = { attackers: IDS.map(id => ({ id, defender: "You" })), blockers: [] };
    });
    const melo = idOf(s2, "Meloku the Clouded Mirror");
    const d = withDecision(s2, { kind: "block", prompt: "Declare blockers", options: IDS.map(() => "block"), refs: IDS.map(a => ({ card: melo, blocks: a })), min: 0, max: 10 });
    await table.open(d);
    await table.tapCard(melo);                                           // held: it can block any of the ten
    await choose(table, IDS[9], NAMES[9]);
    expect(await table.buttons()).toContain("Block (1)");
    await table.press("Block (1)");
    expect((await table.answered(1))[0].answer).toEqual([10]);
  });

  test("attacking a specific one of ten distinct planeswalkers across sends that attack", async ({ table }) => {
    const s = withDecision(snapshot("attack"), null, v => {
      const p = v.players.find(x => x.name === "Atraxa"), proto = find({ view: STATES.block.view }, "You", "Meloku the Clouded Mirror");
      p.battlefield.push(...IDS.map((id, i) => {
        const c = Object.assign(JSON.parse(JSON.stringify(proto)), { id, name: `Walker ${String.fromCharCode(65 + i)}`, type: "Legendary Planeswalker - Test", owner: "Atraxa", controller: "Atraxa", tapped: false, loyalty: 3 + i });
        delete c.power; delete c.toughness;
        return c;
      }));
    });
    const melo = idOf(s, "Meloku the Clouded Mirror");
    const to = ["Marath", "Atraxa", "Dack", ...IDS];
    await table.open(withDecision(s, { kind: "attack", prompt: "Declare attackers", options: to.map(t => `${melo} -> ${t}`), refs: to.map(t => ({ card: melo, to: t })), min: 0, max: 1 }));
    await choose(table, IDS[4], "Walker E");                             // the defender first
    await table.tapCard(melo);
    await table.press("Attack (1)");
    expect((await table.answered(1))[0].answer).toEqual([8]);
  });

  test("taking back a specific one of ten distinct attackers sends the other nine", async ({ table }) => {
    const s = withDecision(snapshot("attack"), null, v => { v.players[0].battlefield = v.players[0].battlefield.filter(c => !ATTACKERS.includes(c.name)); ten(v, "You"); });
    const defenders = ["Marath", "Atraxa", "Dack"];
    const refs = IDS.flatMap(card => defenders.map(to => ({ card, to })));
    await table.open(withDecision(s, { kind: "attack", prompt: "Declare attackers", options: refs.map(r => `${r.card} -> ${r.to}`), refs, min: 0, max: refs.length }));
    await table.press("All attack");
    await table.step(2000);                                              // the ten go to the fight
    await choose(table, IDS[8], NAMES[8]);                               // Rishkar stays home
    await table.press("Attack (9)");
    expect((await table.answered(1))[0].answer).toEqual(IDS.flatMap((_, i) => (i === 8 ? [] : [3 * i + 1])));
  });

  test("a spell's target among ten distinct attackers is the one chosen", { tag: "@cast" }, async ({ table }) => {
    const s = withDecision(snapshot("block"), null, v => {
      ten(v, "Atraxa");
      v.active = "Atraxa";
      v.phase = "COMBAT_DECLARE_BLOCKERS";
      v.combat = { attackers: IDS.map(id => ({ id, defender: "You" })), blockers: [] };
    });
    await table.open(withDecision(s, { kind: "targets", prompt: "target for Reality Shift (Reality Shift)", options: NAMES, refs: IDS.map(card => ({ card })), min: 1, max: 1 }));
    await choose(table, IDS[9], NAMES[9]);
    expect((await table.answered(1))[0].answer).toEqual([10]);
  });
});
