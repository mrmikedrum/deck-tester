// Game moments for motion review, each a few live views in a row, starting from the turn-9 board of boards.js: a
// creature cast and resolving, a counter war, tokens arriving into piles, a combat with deaths, a board wipe.
const { BOARDS } = require("./boards.js");
const CARDS = window.CARDS;

let nextId = 5000;
const clone = v => JSON.parse(JSON.stringify(v));
const card = (owner, name, o = {}) => {
  const f = CARDS[name].faces[0], c = { id: nextId++, name, type: f.type.replace(/—/g, "-"), text: f.text || "", cost: (f.cost || "").replace(/[{}]/g, " ").trim(), owner, controller: owner };
  if (/Creature/.test(f.type)) { c.power = +f.power || 0; c.toughness = +f.toughness || 0; }
  if (/^Token/.test(f.type)) c.token = true;
  return Object.assign(c, o);
};
const pl = (v, n) => v.players.find(p => p.name === n);
const find = (v, n, name) => pl(v, n).battlefield.find(c => c.name === name);
const pass = { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 };
const log = (v, text) => v.log.push({ i: v.log.length, text, type: "Info" });
// A run of views: each step edits a copy of the last one.
function run(start, steps) {
  const out = []; let v = clone(start);
  for (const s of steps) { v = clone(v); const d = s(v) || pass; out.push({ view: v, decision: d }); }
  return { first: { view: clone(start), decision: pass }, steps: out };
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

const wipe = (() => {
  const s = clone(base); s.active = "Dack"; s.priority = "You";
  const sunfall = card("Dack", "Sunfall");
  return run(s, [
    v => { v.stack = [{ id: 1, source: sunfall, controller: "Dack", spell: true, text: "Sunfall", targets: [] }]; log(v, "Dack cast Sunfall"); },
    v => { v.stack = []; let x = 0;   // Incubate X: X is the number of creatures exiled, tokens too
      v.players.forEach(p => { const dead = p.battlefield.filter(c => /Creature/.test(c.type)); x += dead.length; p.battlefield = p.battlefield.filter(c => !/Creature/.test(c.type)); p.exile.push(...dead.filter(c => !c.token)); });
      pl(v, "Dack").graveyard.push(sunfall); pl(v, "Dack").battlefield.push(card("Dack", "Incubator", { counters: { "+1/+1": x } })); log(v, `Sunfall exiled ${x} creatures; Dack created an Incubator with ${x} +1/+1 counters`); },
  ]);
})();

module.exports = { creature, counter, tokens, combat, wipe };
