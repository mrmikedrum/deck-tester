// Game moments for motion review, each a few live views in a row from the turn-9 or turn-15 board.
const { BOARDS } = require("./boards.js");
const { fixtureKeywords } = require("./fixture-keywords.js");
const CARDS = window.CARDS;

let nextId = 5000;
const clone = v => JSON.parse(JSON.stringify(v));
const card = (owner, name, o = {}) => {
  const f = CARDS[name].faces[0], c = { id: nextId++, name, type: f.type.replace(/—/g, "-"), text: f.text || "", cost: (f.cost || "").replace(/[{}]/g, " ").trim(), owner, controller: owner, ...fixtureKeywords(f) };
  if (/Creature/.test(f.type)) { c.power = +f.power || 0; c.toughness = +f.toughness || 0; }
  if (/^Token/.test(f.type)) c.token = true;
  return Object.assign(c, o);
};
const pl = (v, n) => v.players.find(p => p.name === n);
const find = (v, n, name) => pl(v, n).battlefield.find(c => c.name === name);
const pass = { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 };
const log = (v, text) => v.log.push({ i: v.log.length, text, type: "Info" });
// A run of views: each step edits a copy of the last one.
function run(start, steps, firstDecision = pass) {
  const out = []; let v = clone(start);
  for (const s of steps) {
    v = clone(v);
    const d = s(v);
    out.push({ view: v, decision: d === undefined ? pass : d });
  }
  return { first: { view: clone(start), decision: firstDecision }, steps: out };
}
const base = clone(BOARDS[3].view);   // turn 9

const creature = (() => {
  const s = clone(base), md = card("You", "Mulldrifter"); pl(s, "You").hand.push(md);
  return run(s, [
    v => { const me = pl(v, "You"); me.hand = me.hand.filter(c => c.id !== md.id); v.stack = [{ id: 1, source: md, controller: "You", spell: true, text: "Mulldrifter", targets: [] }]; log(v, "You cast Mulldrifter"); },
    v => { v.stack = []; const me = pl(v, "You"); me.battlefield.push(md); me.hand.push(card("You", "Harmonize"), card("You", "Unwind")); log(v, "You drew 2 cards"); },
  ]);
})();

const counter = (() => {
  const s = clone(base); s.active = "Dack"; s.priority = "You";
  const meloku = find(s, "You", "Meloku the Clouded Mirror"), stp = card("Dack", "Swords to Plowshares"), denial = pl(s, "You").hand.find(c => c.name === "Arcane Denial");
  return run(s, [
    v => { v.stack = [{ id: 1, source: stp, controller: "Dack", spell: true, text: "Swords to Plowshares", targets: [meloku.id] }]; log(v, "Dack cast Swords to Plowshares targeting Meloku the Clouded Mirror"); },
    v => { const me = pl(v, "You"); me.hand = me.hand.filter(c => c.id !== denial.id); v.stack.unshift({ id: 2, source: denial, controller: "You", spell: true, text: "Arcane Denial", targets: [stp.id] }); log(v, "You cast Arcane Denial targeting Swords to Plowshares"); },
    v => { v.stack = []; pl(v, "You").graveyard.push(denial); pl(v, "Dack").graveyard.push(stp); log(v, "Swords to Plowshares was countered"); },
  ]);
})();

const tokens = (() => {
  const s = clone(base); s.active = "Marath"; s.priority = "You";
  const marath = find(s, "Marath", "Marath, Will of the Wild");
  return run(s, [
    v => { const mr = find(v, "Marath", marath.name), x = 2;   // X = 2: the cost is paid as he activates, two of his counters
      mr.counters = { "+1/+1": mr.counters["+1/+1"] - x }; mr.power -= x; mr.toughness -= x;
      v.stack = [{ id: 1, source: mr, controller: "Marath", spell: false, text: "Marath, Will of the Wild - create an X/X Elemental (X = 2)", targets: [] }]; log(v, "Marath removed two +1/+1 counters from Marath to activate Marath, Will of the Wild"); },
    v => { v.stack = []; const m = pl(v, "Marath"), x = 2;
      m.battlefield.push(card("Marath", "Elemental (Marath)", { power: x, toughness: x })); for (let i = 0; i < 4; i++) m.battlefield.push(card("Marath", "Beast")); log(v, "Marath created a 2/2 Elemental and four Beasts"); },
  ]);
})();

const combat = (() => {
  const s = clone(base); s.active = "Marath"; s.priority = "You"; s.phase = "COMBAT_DECLARE_ATTACKERS";
  const atk = ["Marath, Will of the Wild", "Herd Baloth", "Beast"].map(n => find(s, "Marath", n));
  const mow = find(s, "You", "Master of Waves"), mel = find(s, "You", "Meloku the Clouded Mirror");
  return run(s, [
    v => { atk.forEach(a => (find(v, "Marath", a.name).tapped = true)); v.combat = { attackers: atk.map(a => ({ id: a.id, defender: "You" })), blockers: [] }; log(v, "Marath attacks you with Marath, Herd Baloth and Beast"); },
    v => { v.phase = "COMBAT_DECLARE_BLOCKERS"; v.combat.blockers = [{ id: mow.id, blocking: atk[1].id }, { id: mel.id, blocking: atk[2].id }]; log(v, "You block Herd Baloth with Master of Waves and Beast with Meloku"); },
    v => { v.phase = "COMBAT_DAMAGE"; const me = pl(v, "You"), m = pl(v, "Marath");
      me.battlefield = me.battlefield.filter(c => c.id !== mow.id); me.graveyard.push(mow); m.battlefield = m.battlefield.filter(c => c.id !== atk[2].id);
      me.life -= atk[0].power; log(v, "Master of Waves and Beast died; Marath dealt " + atk[0].power + " damage to you"); },
    v => { v.phase = "MAIN2"; v.combat = null; },
  ]);
})();

function sunfallPlay(start) {
  const s = clone(start); s.active = "Dack"; s.priority = "You";
  const sunfall = card("Dack", "Sunfall");
  return run(s, [
    v => { v.stack = [{ id: 1, source: sunfall, controller: "Dack", spell: true, text: "Sunfall", targets: [] }]; log(v, "Dack cast Sunfall"); },
    v => { v.stack = []; let x = 0;   // Incubate X: X is the number of creatures exiled, tokens too
      v.players.forEach(p => { const dead = p.battlefield.filter(c => /Creature/.test(c.type)); x += dead.length; p.battlefield = p.battlefield.filter(c => !/Creature/.test(c.type)); p.exile.push(...dead.filter(c => !c.token)); });
      pl(v, "Dack").graveyard.push(sunfall); pl(v, "Dack").battlefield.push(card("Dack", "Incubator", { counters: { "+1/+1": x } })); log(v, `Sunfall exiled ${x} creatures; Dack created an Incubator with ${x} +1/+1 counters`); },
  ]);
}
const wipe = sunfallPlay(base);

const base15 = clone(BOARDS.find(b => b.turn === 15).view);
for (const c of pl(base15, "You").battlefield.filter(c => c.name === "Elemental (Waves)")) {
  // Master of Waves buffs the printed 1/0 tokens.
  c.power = 2;
  c.toughness = 1;
}
const cardLabel = c => {
  const stats = c.power == null ? "" : ` ${c.power}/${c.toughness}`;
  const counters = Object.entries(c.counters || {}).map(([name, count]) => `${name} ${count}`).join(", ");
  const flags = [c.commander && "commander", c.tapped && "tapped", c.token && "token", c.controller !== "You" && c.controller].filter(Boolean);
  return c.name + stats + (counters ? ` [${counters}]` : "") + (flags.length ? ` (${flags.join(", ")})` : "");
};
const combatDecision = (v, kind, prompt, options, refs) =>
  ({ kind, turn: v.label, prompt, options, refs, min: 0, max: options.length, repeat: false, mine: v.active === "You" });
const phase = (v, code, label) => {
  v.phase = code;
  v.label = `T${v.turn} ${v.active === "You" ? "" : v.active + " "}${label}`;
};
const readyCreatures = (v, n) => pl(v, n).battlefield.filter(c => c.toughness > 0 && !c.tapped);
const declareAttack = (v, cards, defender) => {
  phase(v, "COMBAT_DECLARE_ATTACKERS", "attackers");
  for (const c of pl(v, v.active).battlefield) {
    if (cards.some(a => a.id === c.id) && !c.keywords?.includes("Vigilance")) c.tapped = true;
  }
  v.combat = { attackers: cards.map(c => ({ id: c.id, defender })), blockers: [] };
  log(v, v.active === "You"
    ? `You attack ${defender} with ${cards.length} creatures`
    : `${v.active} attacks you with ${cards.length} creatures`);
  return null;
};

const attack15 = (() => {
  const attackers = readyCreatures(base15, "You");
  const defenders = base15.players.slice(1).flatMap(p => [
    { to: p.name, label: p.name },
    ...p.battlefield.filter(c => /Planeswalker/.test(c.type)).map(c => ({
      to: c.id, label: cardLabel({ ...c, counters: { Loyalty: Number(CARDS[c.name].faces[0].loyalty) } }),
    })),
  ]);
  const options = attackers.flatMap(c => defenders.map(d => `${cardLabel(c)} -> ${d.label}`));
  const refs = attackers.flatMap(c => defenders.map(d => ({ card: c.id, to: d.to })));
  const declared = ["Faerie Mastermind", "Meloku the Clouded Mirror", "Mulldrifter", "Whirler Rogue", "Illusion", "Thopter"]
    .map(name => attackers.find(c => c.name === name));
  return run(base15, [
    v => {
      phase(v, "COMBAT_DECLARE_ATTACKERS", "attackers");
      return combatDecision(v, "attack", "attackers, at most one defender each", options, refs);
    },
    v => declareAttack(v, declared, "Marath"),
  ]);
})();

function marathMain(v) {
  v.active = v.priority = "Marath";
  phase(v, "MAIN1", "main1");
  v.log.push({ i: v.log.length, type: "Turn", text: "Turn 15 (Marath)" });
  return null;
}

const threat15 = run(base15, [marathMain]);
const marath15 = threat15.steps[0].view;
const marathAttackers = readyCreatures(marath15, "Marath");
const [beast1, beast2, beast3, beast4] = marathAttackers.filter(c => c.name === "Beast");
const [cat1, cat2, cat3, cat4] = marathAttackers.filter(c => c.name === "Cat Beast");
const [elemental1, elemental2] = marathAttackers.filter(c => c.name === "Elemental (Marath)");
const charge = [beast1, beast2, beast3, beast4, cat1, cat2, cat3, cat4, elemental1, elemental2,
  marathAttackers.find(c => c.name === "Marath, Will of the Wild")];
const marathAttacks = v => declareAttack(v, charge, "You");
const block15 = run(marath15, [
  marathAttacks,
  v => {
    phase(v, "COMBAT_DECLARE_BLOCKERS", "blockers");
    // All eleven attackers are on the ground. Master of Waves has protection from red,
    // which doesn't restrict what it may block.
    const attackers = charge.map(a => pl(v, "Marath").battlefield.find(c => c.id === a.id));
    const pairs = readyCreatures(v, "You").flatMap(c => attackers.map(a => [c, a]));
    return combatDecision(v, "block", "blockers, each blocking one attacker",
      pairs.map(([c, a]) => `${cardLabel(c)} blocks ${cardLabel(a)}`),
      pairs.map(([c, a]) => ({ card: c.id, blocks: a.id })));
  },
], null);

const alpha15 = (() => {
  const blocks = [
    ["Princess Yue", beast1], ["Whirler Rogue", beast1], ["Faerie Mastermind", beast2], ["Illusion", beast3],
    ["Thopter", beast4], ["Meloku the Clouded Mirror", cat1], ["Mulldrifter", cat2], ["Tiller Engine", elemental1],
  ].map(([name, a]) => ({ id: readyCreatures(marath15, "You").find(c => c.name === name).id, blocking: a.id }));
  return run(marath15, [
    marathAttacks,
    v => {
      phase(v, "COMBAT_DECLARE_BLOCKERS", "blockers");
      v.combat.blockers = blocks;
      log(v, "You block four Beasts, two Cat Beasts and an Elemental");
      return null;
    },
    v => {
      phase(v, "COMBAT_DAMAGE", "damage");
      const deadAttackers = [beast1.id, cat1.id, cat2.id];
      // Beast 1 assigns its four damage to the 3/2 and 2/2 double block.
      const deadBlockers = blocks.filter(b => b.blocking !== cat1.id).map(b => b.id);
      const me = pl(v, "You"), marath = pl(v, "Marath");
      me.graveyard.push(...me.battlefield.filter(c => deadBlockers.includes(c.id) && !c.token));
      me.battlefield = me.battlefield.filter(c => !deadBlockers.includes(c.id));
      marath.battlefield = marath.battlefield.filter(c => !deadAttackers.includes(c.id));
      me.life -= charge.filter(a => !blocks.some(b => b.blocking === a.id)).reduce((sum, a) => sum + a.power, 0);
      v.combat.attackers = v.combat.attackers.filter(a => !deadAttackers.includes(a.id));
      v.combat.blockers = v.combat.blockers.filter(b => !deadBlockers.includes(b.id) && !deadAttackers.includes(b.blocking));
      log(v, "One Beast and two Cat Beasts die in combat");
      return null;
    },
  ], null);
})();

const wipe15 = sunfallPlay(base15);

function snapPlay(target) {
  const s = clone(base15);
  const me = pl(s, "You"), snap = me.hand.find(c => c.name === "Snap");
  const lands = me.battlefield.filter(c => c.name === "Island" && !c.tapped).slice(0, 2).map(c => c.id);
  return run(s, [
    v => {
      const me = pl(v, "You");
      me.hand = me.hand.filter(c => c.id !== snap.id);
      me.battlefield.filter(c => lands.includes(c.id)).forEach(c => (c.tapped = true));
      v.stack = [{ id: 9, source: snap, controller: "You", spell: true, text: `Snap - Return ${target.name} to its owner's hand. Untap up to two lands.`, targets: [target.id] }];
      log(v, `You cast Snap targeting ${target.name}`);
    },
    v => {
      const me = pl(v, "You"), marath = pl(v, "Marath");
      v.stack = [];
      me.graveyard.push(snap);
      me.battlefield.filter(c => lands.includes(c.id)).forEach(c => delete c.tapped);
      marath.battlefield = marath.battlefield.filter(c => c.id !== target.id);
      if (!target.token) marath.handCount += 1;
      log(v, target.token ? `A ${target.name} token returns to Marath's hand and ceases to exist` : `${target.name} returns to Marath's hand`);
    },
  ], { ...pass, options: ["pass", "Snap"], refs: [{}, { card: snap.id, spell: true }] });
}
const snipe15 = snapPlay(find(base15, "Marath", "Kami of Whispered Hopes"));
const snipeToken15 = snapPlay(pl(base15, "Marath").battlefield.filter(c => c.name === "Beast").at(-1));

module.exports = { creature, counter, tokens, combat, wipe, attack15, block15, threat15, alpha15, wipe15, snipe15, snipeToken15 };
