// Stills of table moments on the design pass's tables (tests/fixtures/boards/design-pass.json), for judging by eye: the
// table at rest (turns 4, 9 and 15), the stack at rest, combat (the clash, duels in the parted middle), a seat leaving.
// Each moment is its envelopes on the scripted transport, then the taps and keys it names, then a screenshot once the
// table is settled.
//   npm run build && node tools/combat-stills.js <outdir> [only,names]
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const { serve } = require("./serve.js");

const design = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/boards/design-pass.json"), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
const stage = (turn) => clone(design.stages.find((s) => s.turn === turn).envelope);
const base = () => stage(15);

// Atraxa's six (Atraxa, Steel Overseer, Chrome Host Seedshark, Tekuthal, Brimaz, Phyrexian Metamorph), and my blockers.
const ATRAXA6 = [1019, 1041, 1117, 1169, 1221, 1072];
const BLOCKS4 = [[1057, 1041], [1141, 1117], [1089, 1019], [1027, 1221]];
const MINE = [1010, 1027, 1057, 1089, 1090, 1141, 1142];

/** The turn-15 table in a combat: `active` attacks with `attackers` ([id, defender]), `blockers` ([blocker, attacker]). */
function fight({ active, attackers, blockers = [], phase = "COMBAT_DECLARE_BLOCKERS", priority = "You", tap = true, decision = null, edit }) {
  const e = base();
  e.v = 20;
  const seat = (n) => e.view.players.find((p) => p.name === n);
  const card = (id) => e.view.players.flatMap((p) => p.battlefield).find((c) => c.id === id);
  if (tap) for (const [id] of attackers) if (!/Vigilance/.test(card(id).text || "")) card(id).tapped = true;
  e.view = { ...e.view, active, priority, phase, combat: {
    ordinal: 1,
    // Forge's verdict per attacker, as the engine sends it
    attackers: attackers.map(([id, defender]) => ({ id, defender, blocked: blockers.some(([, a]) => a === id) })),
    blockers: blockers.map(([id, blocking]) => ({ id, blocking })),
    damage: [],
  } };
  if (decision) e.decision = { gen: 1, turn: `T15 ${phase.toLowerCase()}`, repeat: false, mine: active === "You", ...decision };
  if (edit) edit(e, seat, card);
  return e;
}

/** My block decision against `attackers`: every untapped creature of mine may block each. */
function blockDecision(attackers) {
  const refs = [];
  for (const m of MINE) for (const [a] of attackers) refs.push({ card: m, blocks: a });
  return { id: 7, kind: "block", prompt: "Declare blockers", options: refs.map(() => "block"), refs, min: 0, max: refs.length };
}
/** My attack decision: each untapped creature of mine at each opponent. */
function attackDecision() {
  const refs = [];
  for (const m of MINE) for (const to of ["Marath", "Atraxa", "Dack"]) refs.push({ card: m, to });
  return { id: 8, kind: "attack", prompt: "Declare attackers", options: refs.map(() => "attack"), refs, min: 0, max: refs.length };
}

const atraxa6 = ATRAXA6.map((id) => [id, "You"]);

/** Combat damage on the owner's fight: Tekuthal's 3 dealt to me, Master of Waves dead under Steel Overseer. */
const dealt = (v, phase, combat = true) => {
  const e = fight({ active: "Atraxa", attackers: atraxa6, blockers: BLOCKS4, priority: "Atraxa", phase });
  const me = e.view.players.find((p) => p.name === "You");
  me.life = 23;
  const i = me.battlefield.findIndex((c) => c.id === 1057);
  me.graveyard = [...(me.graveyard || []), me.battlefield[i]];
  me.battlefield.splice(i, 1);
  e.view.combat = combat ? { ...e.view.combat, blockers: e.view.combat.blockers.filter((b) => b.id !== 1057) } : null;
  // the engine's combat damage facts (Steel Overseer stays blocked by Forge's verdict though its blocker died)
  if (combat) e.view.combat.damage = [{ source: 1169, target: "You", defender: "You", amount: 3 }, { source: 1041, target: 1057, defender: "You", amount: 6 }];
  e.v = v;
  return e;
};
const rest = (v) => Object.assign(base(), { v });
const at = (turn, v) => Object.assign(stage(turn), { v });

/** The turn-15 table with spells on the stack (top first): Dack's Swords on Herd Baloth, Marath's Chaos Warp on
 *  Wispweaver Angel, my Arcane Denial on the Chaos Warp. */
function withStack(v) {
  const e = rest(v);
  const spell = (id, name, who, type, targets) => ({ id, source: { id, name, owner: who, controller: who, type, zone: "stack" }, controller: who, spell: true, text: name, targets });
  e.view = { ...e.view, active: "Dack", priority: "You", phase: "MAIN1", stack: [spell(9003, "Arcane Denial", "You", "Instant", [9002]), spell(9002, "Chaos Warp", "Marath", "Instant", [1129]), spell(9001, "Swords to Plowshares", "Dack", "Instant", [1064])] };
  return e;
}

/** The turn-15 table after players have lost: Forge lists only players still in the game; their room goes to the rest. */
function gone(v, names) {
  const e = rest(v);
  e.view = { ...e.view, players: e.view.players.filter((p) => !names.includes(p.name)) };
  return e;
}

/** The turn-15 table with my side changed by `edit(me, all)`: my battlefield, and every card on the table to copy from. */
function mySide(v, edit) {
  const e = rest(v);
  const me = e.view.players.find((p) => p.name === "You");
  edit(me, e.view.players.flatMap((p) => p.battlefield));
  return e;
}
let nextId = 5000;
/** `n` copies of a card, mine, with fresh ids. */
const copies = (c, n, o = {}) => Array.from({ length: n }, () => ({ ...c, id: nextId++, owner: "You", controller: "You", ...o }));

/** My crowded side: twenty more Illusions (six spent), a dozen more Elementals, twelve more Islands, Thopters. */
const crowdedSide = (v) =>
  mySide(v, (me) => {
    const find = (n) => me.battlefield.find((c) => c.name === n);
    me.battlefield.push(...copies(find("Illusion"), 14), ...copies(find("Illusion"), 6, { tapped: true }), ...copies(find("Elemental (Waves)"), 12), ...copies(find("Island"), 12), ...copies(find("Thopter"), 6));
  });

/** A creature-light side: my lands, two Thopters, and the artifacts and enchantments that run the deck (borrowed from
 *  the table: taxes, locks, an engine, a planeswalker). */
const lightSide = (v) =>
  mySide(v, (me, all) => {
    const take = (n) => copies(all.find((c) => c.name === n), 1);
    const lands = me.battlefield.filter((c) => /Land/.test(c.type));
    const rocks = me.battlefield.filter((c) => ["Sol Ring", "Arcane Signet"].includes(c.name));
    me.battlefield = [...lands, ...rocks, ...me.battlefield.filter((c) => c.name === "Thopter"), ...["Smothering Tithe", "Rule of Law", "Thorn of Amethyst", "Cursed Totem", "Paladin Class", "Tezzeret, Cruel Captain", "Throne of Geth", "Felidar Retreat"].flatMap(take)];
  });

/** My main phase: plays light up, among them lands and rocks inside my mana pile and a work inside my works pile. */
const usable = (v) => {
  const e = rest(v);
  const me = e.view.players.find((p) => p.name === "You");
  const id = (n) => [...me.battlefield, ...me.hand, ...me.command].find((c) => c.name === n).id;
  const plays = [["Island (land)", "Island"], ["Snap", "Snap"], ["Otawara, Soaring City: channel", "Otawara, Soaring City"], ["Thespian's Stage: copy a land", "Thespian's Stage"], ["Springleaf Drum: tap a creature", "Springleaf Drum"], ["Insight Engine: put a charge counter", "Insight Engine"], ["Meloku the Clouded Mirror: make an Illusion", "Meloku the Clouded Mirror"]];
  e.decision = { gen: 1, id: 9, turn: "T15 main1", repeat: false, mine: true, kind: "play", prompt: "", options: ["Pass", ...plays.map(([o]) => o)], refs: [{}, ...plays.map(([, n]) => ({ card: id(n) }))], min: 1, max: 1 };
  return e;
};


/** A decision of mine on the turn-15 table (or `turn`'s): `kind`, its options as [label, card]. */
const decide = (v, kind, prompt, opts, o = {}) => {
  const e = o.turn ? at(o.turn, v) : rest(v);
  if (o.edit) o.edit(e);
  e.decision = { gen: 1, id: 11, turn: `T${o.turn ?? 15} main1`, repeat: !!o.repeat, mine: true, kind, prompt, options: opts.map(([l]) => l), refs: opts.map(([, card]) => (card === null ? {} : { card })), min: o.min ?? 1, max: o.max ?? 1 };
  return e;
};
/** My plays at turn 9: the land in hand, Snap, and abilities of permanents, some inside piles (an Illusion, a Thopter). */
const usable9 = (v) => {
  const plays = [["Island (land)", 1003], ["Snap", 1004], ["Otawara, Soaring City: channel", 1054], ["Springleaf Drum: tap a creature", 1029], ["Insight Engine: put a charge counter", 1091], ["Meloku the Clouded Mirror: make an Illusion", 1089], ["Thopter: sacrifice", 1094], ["Illusion: sacrifice", 1092]];
  return decide(v, "play", "", [["Pass", null], ...plays], { turn: 9 });
};
/** Paying {1}{U} for Snap: my untapped lands and rocks, the Islands in their block among them. */
const PAY = [[1001, "Island (U)"], [1055, "Island (U)"], [1086, "Island (U)"], [1191, "Island (U)"], [1193, "Island (U)"], [1025, "Mystic Sanctuary (U)"], [1054, "Otawara, Soaring City (U)"], [1087, "Minamo, School at Water's Edge (U)"], [1139, "Vesuva (C)"], [1056, "Arcane Signet (U)"], [1088, "Fellwar Stone (U)"], [1140, "Everflowing Chalice (C)"]];
/** The turn-15 table after a sweep of my tokens: my field has free places again, my mana still piles. */
const swept = (e) => {
  const me = e.view.players.find((p) => p.name === "You");
  me.battlefield = me.battlefield.filter((c) => !c.token);
  return e;
};
const payment = (v, edit = swept) => decide(v, "pay", "Choose mana to pay {1}{U} for Snap", PAY.map(([id, l]) => [l, id]), { min: 0, max: 2, repeat: true, edit });
/** Snap's target: any of Marath's creatures, the Beasts, Elementals and Cat Beasts in their stacks among them. */
const target = (v) => {
  const m = base().view.players.find((p) => p.name === "Marath").battlefield.filter((c) => /Creature/.test(c.type));
  return decide(v, "targets", "target for Return target creature to its owner's hand. Untap up to two lands.", m.map((c) => [c.name, c.id]));
};
/** Dack's Swords to Plowshares on the stack, aimed at my Meloku; I may respond. */
/** The turn-15 table at rest in `who`'s first main phase, priority theirs. */
const mainOf = (v, who) => {
  const e = rest(v);
  e.view = { ...e.view, active: who, priority: who, phase: "MAIN1" };
  return e;
};
const swords = (v) => {
  const e = decide(v, "play", "", [["Pass", null], ["Snap", 1004], ["Arcane Denial", 1005]]);
  e.view = { ...e.view, active: "Dack", priority: "You", phase: "MAIN1", stack: [{ id: 9001, source: { id: 9001, name: "Swords to Plowshares", owner: "Dack", controller: "Dack", type: "Instant", zone: "stack" }, controller: "Dack", spell: true, text: "Swords to Plowshares", targets: [1089] }] };
  return e;
};
/** A creature enters: Dack's second Wispweaver Angel lands on Dack's side. */
const enters = (v) => {
  const e = rest(v);
  const dack = e.view.players.find((p) => p.name === "Dack");
  dack.battlefield.push({ ...dack.battlefield.find((c) => c.id === 1129), id: 9100 });
  return e;
};

/**
 * The turn-4 table as cards are played one after another, each seat in turn (playtest item 8: the table holds still): a
 * spell on the stack (held up as the focus), then on the battlefield; a land straight onto it. Cards come from each
 * seat's turn-9 battlefield, a nonland then a land. `n`: how many plays.
 */
function plays(n, v = 30) {
  const e4 = stage(4), e9 = stage(9), out = [], seats = e4.view.players.map((p) => p.name), used = new Set();
  for (let k = 0; out.length < n && k < 12; k++)
    for (const name of seats) {
      if (out.length >= n) break;
      const have = new Set(e4.view.players.find((p) => p.name === name).battlefield.map((c) => c.id));
      const add = e9.view.players.find((p) => p.name === name).battlefield.filter((c) => !have.has(c.id) && !used.has(c.id) && !c.token);
      const c = add.filter((x) => (k % 2 ? /Land/.test(x.type) : !/Land/.test(x.type)))[0] ?? add[0];
      if (c) {
        used.add(c.id);
        out.push({ name, c });
      }
    }
  const steps = [];
  const cur = clone(e4);
  cur.view = { ...cur.view, active: "You", priority: "You", phase: "MAIN1" };
  for (const { name, c } of out) {
    if (!/Land/.test(c.type)) {
      cur.view.stack = [{ id: 90000 + c.id, source: { ...c, zone: "stack" }, controller: name, spell: true, text: c.name, targets: [] }];
      steps.push({ what: `${name} casts ${c.name}`, env: Object.assign(clone(cur), { v: v++ }) });
    }
    cur.view.stack = [];
    cur.view.players.find((p) => p.name === name).battlefield.push(c);
    steps.push({ what: `${c.name} enters (${name})`, env: Object.assign(clone(cur), { v: v++ }) });
  }
  return steps;
}

/** A land-heavy table: turn 15 with Atraxa down to her commander, her works and her lands (one standing row: room for
 *  a row of lands of their own), and fifteen more distinct lands of mine. */
function landHeavy(v) {
  const e = rest(v);
  const atraxa = e.view.players.find((p) => p.name === "Atraxa");
  atraxa.battlefield = atraxa.battlefield.filter((c) => !/Creature/.test(c.type) || c.commander);
  const me = e.view.players.find((p) => p.name === "You");
  const names = ["Watery Grave", "Breeding Pool", "Overgrown Tomb", "Temple Garden", "Command Tower", "Cavern of Souls", "Ancient Tomb", "Polluted Delta", "Seat of the Synod", "Hallowed Fountain", "Godless Shrine", "Sacred Foundry", "Stomping Ground", "Great Hall of the Citadel", "Thespian's Stage"];
  const all = e.view.players.flatMap((p) => p.battlefield);
  for (const n of names) {
    const c = all.find((x) => x.name === n);
    if (c) me.battlefield.push({ ...c, id: nextId++, owner: "You", controller: "You" });
  }
  return e;
}

/** My first main phase on turn 4, my commander castable from the command zone (Princess Yue). */
const myCommanderCastable = (v) => {
  const e = at(4, v);
  const yue = e.view.players.find((p) => p.name === "You").command[0];
  e.decision = { gen: 1, id: 12, turn: "T4 main1", repeat: false, mine: true, kind: "play", prompt: "", options: ["Pass", `${yue.name} (commander)`], refs: [{}, { card: yue.id, spell: true }], min: 1, max: 1 };
  return e;
};

const MARATH4 = [[1015, "Dack"], [1064, "Dack"], [1105, "Dack"], [1157, "Dack"]];
const MOMENTS = {
  "moment-priority-9": { what: "Turn 9, my main phase: plays lit, an Illusion and a Thopter among them", envs: [at(9, 18), usable9(19)] },
  "moment-priority-15": { what: "Turn 15, my main phase: plays lit, lands and rocks inside my mana piles", envs: [rest(18), usable(19)] },
  "moment-payment": { what: "Paying {1}{U} for Snap after a sweep of my tokens: Arcane Signet already lies alone; no place is free, so the other sources stay lit in their piles", envs: [swept(rest(18)), payment(19)] },
  "moment-payment-rest": { what: "The same table at rest, before the payment", env: swept(rest(18)) },
  "moment-target": { what: "Snap's target: any of Marath's creatures, Beasts and Elementals inside their stacks", envs: [rest(18), target(19)] },
  "moment-target-pile": { what: "Snap's target, Marath's back pile tapped: it opens with the options in it", envs: [rest(18), target(19)], taps: [1102] },
  "moment-swords": { what: "Dack's Swords to Plowshares on the stack, aimed at my Meloku", envs: [mainOf(18, "Dack"), swords(19)] },
  "moment-swords-aside": { what: "The same, the stack set aside: Meloku lit where it stands", envs: [mainOf(18, "Dack"), swords(19)], keys: ["Escape"] },
  "moment-threat": { what: "Dack's first main phase, before attacks: what can come at me", envs: [rest(18), mainOf(19, "Dack")] },
  "moment-opponents-attack": { what: "Marath attacks Dack with four, no blocks yet: the rest of the table", envs: [mainOf(18, "Marath"), fight({ active: "Marath", attackers: [[1015, "Dack"], [1064, "Dack"], [1105, "Dack"], [1157, "Dack"]], phase: "COMBAT_DECLARE_ATTACKERS", priority: "Marath" })] },
  "moment-enters": { what: "A second Wispweaver Angel enters on Dack's side", envs: [rest(19), enters(20)] },
  "turn-4": { what: "Turn 4 at rest: an early board", env: at(4, 19) },
  "plays": { what: "The turn-4 table as cards are played one after another: a still after each", steps: plays(12) },
  "commander-castable": { what: "Turn 4, my main phase: my commander castable from its portrait on my plate", env: myCommanderCastable(19) },
  "commander-inspect": { what: "Turn 4: a tap on Marath's waiting commander reads it", env: at(4, 19), cmd: ["Marath"] },
  "land-heavy": { what: "A land-heavy table: Atraxa has no creatures but her commander, I have fifteen more lands", env: landHeavy(19) },
  "turn-9": { what: "Turn 9 at rest: a mid board", env: at(9, 19) },
  "turn-15": { what: "Turn 15 at rest: the dense board", env: rest(19) },
  "my-crowded": { what: "My side crowded: twenty more Illusions, a dozen more Elementals, twelve more Islands, six Thopters", env: crowdedSide(19) },
  "creature-light": { what: "A creature-light side of mine: taxes, locks, an engine and a planeswalker; two Thopters", env: lightSide(19) },
  "usable-in-pile": { what: "My main phase: lands and rocks I can use inside my mana pile, Insight Engine inside my works pile", env: usable(19) },
  "hand-focus": { what: "A tap on a card in my hand: the hand's focus holds it up", env: rest(19), hand: [1004] },
  "stack-at-rest": { what: "Three spells on the stack, the focus set aside: the mats part and the stack rests in the middle", env: withStack(19), keys: ["Escape"] },
  "opponents-duel": {
    what: "Marath attacks Dack with four; Dack Fayden blocks Marath: one duel in the parted middle, the rest laned",
    env: fight({ active: "Marath", attackers: MARATH4, blockers: [[1024, 1015]], priority: "Marath" }),
  },
  "duel-stack-aside": {
    what: "Marath attacks Dack with four, Dack Fayden blocks Marath, three spells set aside: the stack rests beside the duel",
    env: Object.assign(fight({ active: "Marath", attackers: MARATH4, blockers: [[1024, 1015]], priority: "Marath" }), { view: { ...withStack(19).view, active: "Marath", priority: "Marath", phase: "COMBAT_DECLARE_BLOCKERS", combat: fight({ active: "Marath", attackers: MARATH4, blockers: [[1024, 1015]], priority: "Marath" }).view.combat } }),
    keys: ["Escape"],
  },
  "opponents-duels": {
    what: "Marath attacks Dack with four; Dack blocks two: two duels in the parted middle",
    env: fight({ active: "Marath", attackers: MARATH4, blockers: [[1024, 1015], [1129, 1064]], priority: "Marath" }),
  },
  "opponents-crowded": {
    what: "Marath attacks Dack with four, all blocked: the duels do not fit the middle, so the clash rises",
    env: fight({ active: "Marath", attackers: MARATH4, blockers: [[1024, 1015], [1129, 1064], [1048, 1105], [1080, 1157]], priority: "Marath" }),
  },
  "seat-leaves": { what: "Dack has lost: two opponents share the width three had; Dack's plate is a small chip", envs: [rest(19), gone(20, ["Dack"])] },
  "one-opponent": { what: "Dack and Marath have lost: Atraxa's leaf takes the whole width", envs: [rest(19), gone(20, ["Dack"]), gone(21, ["Dack", "Marath"])] },
  "attacked-by-six": { what: "Atraxa attacks me with six; no blocks yet, nothing to decide", env: fight({ active: "Atraxa", attackers: atraxa6, priority: "Atraxa" }) },
  "choosing-blocks": {
    what: "My block decision: Master of Waves on Steel Overseer, Mulldrifter on Chrome Host Seedshark, Meloku held",
    env: fight({ active: "Atraxa", attackers: atraxa6, decision: blockDecision(atraxa6) }),
    taps: [1057, 1041, 1141, 1117, 1089],
  },
  "blocks-declared": { what: "The owner's still, redone: four of mine block, Tekuthal and Phyrexian Metamorph unblocked", env: fight({ active: "Atraxa", attackers: atraxa6, blockers: BLOCKS4, priority: "Atraxa", phase: "COMBAT_DECLARE_BLOCKERS" }) },
  "my-attack-choosing": { what: "My attack decision: Meloku, Master of Waves and Faerie Mastermind picked at Marath", env: fight({ active: "You", attackers: [], phase: "COMBAT_DECLARE_ATTACKERS", tap: false, decision: attackDecision() }), taps: [1089, 1057, 1027] },
  "my-attack-blocked": {
    what: "I attack Marath with four; Marath blocks Meloku with Herd Baloth and Master of Waves with a Beast",
    env: fight({ active: "You", attackers: [[1089, "Marath"], [1057, "Marath"], [1027, "Marath"], [1090, "Marath"]], blockers: [[1064, 1089], [1066, 1057]], priority: "You" }),
  },
  "opponents-attack": { what: "Marath attacks Dack with four, no blocks yet: the table form", env: fight({ active: "Marath", attackers: [[1015, "Dack"], [1064, "Dack"], [1105, "Dack"], [1157, "Dack"]], phase: "COMBAT_DECLARE_ATTACKERS", priority: "Marath" }) },
  "split-attack": {
    what: "Atraxa attacks me with three and Dack with two; I block one, Dack blocks one (three rows)",
    env: fight({ active: "Atraxa", attackers: [[1019, "You"], [1041, "You"], [1169, "You"], [1117, "Dack"], [1221, "Dack"]], blockers: [[1089, 1041], [1129, 1117]], priority: "Atraxa" }),
  },
  "before-combat": { what: "The table before Atraxa's attack (to compare with home-again)", env: rest(19) },
  "damage-dealt": {
    what: "Combat damage: the plaque says what was dealt (3), Master of Waves gone to the graveyard, the blocked column keeps its clasp",
    envs: [rest(19), fight({ active: "Atraxa", attackers: atraxa6, priority: "Atraxa" }), Object.assign(fight({ active: "Atraxa", attackers: atraxa6, blockers: BLOCKS4, priority: "Atraxa" }), { v: 21 }), dealt(22, "COMBAT_DAMAGE")],
  },
  "home-again": {
    what: "After combat: everyone home, Atraxa's six turned for tapped, Master of Waves gone, life 23",
    envs: [rest(19), fight({ active: "Atraxa", attackers: atraxa6, priority: "Atraxa" }), Object.assign(fight({ active: "Atraxa", attackers: atraxa6, blockers: BLOCKS4, priority: "Atraxa" }), { v: 21 }), dealt(22, "COMBAT_DAMAGE"), Object.assign(dealt(23, "MAIN2", false), {})],
  },
  "one-attacker": { what: "Atraxa attacks me alone: the same picture, one column", env: fight({ active: "Atraxa", attackers: [[1019, "You"]], priority: "Atraxa" }) },
  "double-block": {
    what: "Atraxa attacks me with six; Master of Waves and Mulldrifter both block Atraxa, Meloku blocks Steel Overseer",
    env: fight({ active: "Atraxa", attackers: atraxa6, blockers: [[1057, 1019], [1141, 1019], [1089, 1041]], priority: "Atraxa" }),
  },
  "planeswalker": {
    what: "Dack attacks Tezzeret, Atraxa's planeswalker, with Wispweaver Angel and Dack Fayden, and Atraxa with Fiend Hunter; Atraxa blocks the Angel",
    env: fight({ active: "Dack", attackers: [[1129, 1073], [1024, 1073], [1048, "Atraxa"]], blockers: [[1221, 1129]], priority: "Dack" }),
  },
  "eleven-and-seven": {
    what: "Marath attacks me with eleven (four of them identical Beasts); seven of mine block",
    env: fight({
      active: "Marath",
      priority: "Marath",
      attackers: [1015, 1064, 1035, 1153, 1204, 1205, 1101, 1066, 1105, 1157, 1158].map((id) => [id, "You"]),
      blockers: [[1089, 1015], [1057, 1064], [1027, 1035], [1141, 1153], [1090, 1204], [1142, 1205], [1010, 1101]],
    }),
  },
};

async function settle(page, ms = 20000) {
  for (let calm = 0, end = Date.now() + ms; Date.now() < end && calm < 6; ) {
    calm = (await page.evaluate(() => window.__deckmaster.settled() && window.__deckmaster.art.pending() === 0)) ? calm + 1 : 0;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Tap the middle of the hit group holding this card. */
async function tapCard(page, card) {
  const g = await page.evaluate((c) => window.__deckmaster.hits().filter((h) => h.members.includes(c)).sort((a, b) => b.order - a.order)[0], card);
  if (!g) throw new Error(`no hit group for ${card}`);
  const x = g.quad.reduce((t, p) => t + p.x, 0) / 4, y = g.quad.reduce((t, p) => t + p.y, 0) / 4;
  await page.mouse.click(x, y);
  await settle(page, 4000);
}

(async () => {
  const [outDir = "combat-stills", onlyArg] = process.argv.slice(2);
  const only = onlyArg ? new Set(onlyArg.split(",")) : null;
  fs.mkdirSync(outDir, { recursive: true });
  const { base: url, server } = await serve();
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    for (const [name, m] of Object.entries(MOMENTS)) {
      if (only && !only.has(name)) continue;
      const ctx = await browser.newContext({ viewport: { width: 1210, height: 834 }, deviceScaleFactor: 2, baseURL: url });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.error(name, String(e)));
      const first = m.steps ? [m.steps[0].env] : (m.envs ?? [m.env]);
      await page.route("**/still-scenario.json", (r) => r.fulfill({ json: { catalog: design.catalog, envelopes: first } }));
      await page.goto("index.html?script=still-scenario.json");
      await page.waitForFunction(() => window.__deckmaster && window.__deckmaster.seats().length > 0, null, { timeout: 30000 });
      await settle(page);
      // A sequence: a still after each envelope, pushed one at a time as the bridge would.
      if (m.steps) {
        for (const [i, st] of m.steps.entries()) {
          if (i) await page.evaluate((e) => window.__deckmaster.script.push(e), st.env);
          await settle(page);
          const file = `${name}-${String(i + 1).padStart(2, "0")}.jpg`;
          await page.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 88 });
          console.log(`${file}: ${st.what}`);
        }
        await ctx.close();
        continue;
      }
      for (const c of m.taps ?? []) await tapCard(page, c);
      for (const seat of m.cmd ?? []) {
        await page.click(`[data-plate="${seat}"] [data-cmd]`);
        await settle(page, 4000);
      }
      for (const c of m.hand ?? []) {
        await page.click(`.g-hand [data-id="${c}"]`);
        await settle(page, 4000);
      }
      for (const k of m.keys ?? []) {
        await page.keyboard.press(k);
        await settle(page, 4000);
      }
      await settle(page);
      await page.screenshot({ path: path.join(outDir, `${name}.jpg`), type: "jpeg", quality: 88 });
      console.log(`${name}: ${m.what}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
