// Each clip starts at a bridge snapshot and fires beats at virtual times.
// The description tells reviewers what happened in the game.
const { STATES } = require("./fixtures/states.js");
const { BOARDS } = require("./fixtures/boards.js");
const PLAYS = require("./fixtures/plays.js");
// The cast-and-target slice uses real envelopes from the protocol corpus.
const fs = require("fs"), path = require("path");
const CORPUS = path.join(__dirname, "../../tests/fixtures/protocol");
const envelope = f => JSON.parse(fs.readFileSync(path.join(CORPUS, f + ".json"), "utf8"));
const SLICE = ["023-play-monarch", "024-targets-monarch", "025-play-stack-targets-player", "026-play-monarch"].map(envelope);
function catalogFor(envelopes, known) {
  const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return {}; } };
  known = known || Object.assign(read(path.join(__dirname, "../client/test/model/catalog.json")), read(path.join(__dirname, "../../.deckmaster/cache/cards/cards.json")));
  const names = new Set(envelopes.flatMap(e => [...e.view.players.flatMap(p => ["battlefield", "hand", "graveyard", "exile", "command"].flatMap(z => (p[z] || []).map(c => c.name))),
    ...(e.view.stack || []).map(s => s.source && s.source.name).filter(Boolean)]));
  return Object.fromEntries([...names].filter(n => known[n]).map(n => [n, known[n]]));
}

const H = require("./behaviour/harness.js");
// Attach the keywords that the engine normally sends with each card.
const keyworded = view => {
  const fill = c => { if (c && c.keywords == null) { const e = H.CARDS[c.name]; c.keywords = e ? (e.faces[0].keywords || []).slice() : []; } };
  view.players.forEach(p => ["battlefield", "command", "graveyard", "exile", "hand"].forEach(z => (p[z] || []).forEach(fill)));
  (view.stack || []).forEach(it => fill(it.source));
  return view;
};
const env = (st, v) => H.engineShape({ state: "playing", gen: 1, view: keyworded(H.clone(st.view)), decision: st.decision ? H.decision(st.view, H.clone(st.decision)) : null, pilots: {}, v, error: null });
function scripted(clip, start, beats) {
  const first = env(start, 1);
  beats = beats.map(({ state, ...beat }, i) => state ? { ...beat, push: env(state, i + 2) } : beat);
  const catalog = catalogFor([first, ...beats.flatMap(b => b.push ? [b.push] : [])], H.CARDS);
  return { ...clip, first, catalog, beats };
}

const tap = target => ({ tap: target });
const key = key => ({ key });
const board = (plate, name) => [tap({ plate }), { button: `See ${name}'s board` }];

module.exports = [
  scripted({ name: "game", ms: 1500 * BOARDS.length + 4200, audit: true,
    about: "One game from turn 2 to turn 15: every seat's board grows a turn-step at a time. Then I lean in on Marath's crowded side, tap his biggest pile to look through it, and close it." },
    BOARDS[0], [
      ...BOARDS.slice(1).map((state, i) => ({ at: 1500 * (i + 1), label: `turn ${state.turn}`, state })),
      { at: 1500 * BOARDS.length, label: "lean in on Marath", gesture: board("ana", "Marath"), audit: false },
      { at: 1500 * BOARDS.length + 1400, label: "tap Marath's biggest pile", gesture: tap({ pile: "ana" }), audit: false },
      { at: 1500 * BOARDS.length + 2800, label: "close it", gesture: [key("Escape"), key("Escape")] },
    ]),
  scripted({ name: "turns", ms: 6000, audit: true, about: "The turn passes from me to Atraxa, then to Dack who casts a spell, then back to me." },
    STATES.main, [
      { at: 300, label: "Atraxa's turn begins", state: STATES.theirs },
      { at: 2300, label: "Dack's turn: Dack casts Swords to Plowshares on my Meloku", state: STATES.threat },
      { at: 4300, label: "back to my main phase", state: STATES.main },
    ]),
  scripted({ name: "lean", ms: 5000, audit: true, about: "I look at Atraxa's side, go back to the table, then look at Dack's side." },
    STATES.main, [
      { at: 300, label: "lean in on Atraxa", gesture: board("bo", "Atraxa"), audit: false },
      { at: 2000, label: "back to the table", gesture: key("Escape") },
      { at: 3400, label: "lean in on Dack", gesture: board("cy", "Dack"), audit: false },
    ]),
  { name: "slice", first: SLICE[0], catalog: catalogFor(SLICE), ms: 6500,
    about: "On turn 1 I drag Lightning Bolt up from my hand and pick its target. The Bolt goes on the stack and resolves.",
    beats: [
      { at: 300, label: "I drag Lightning Bolt up from my hand", gesture: { drag: { hand: 822, dy: 160 } } },
      { at: 1000, label: "Forge asks for the Bolt's target", push: SLICE[1] },
      { at: 2000, label: "I tap Princess's plate", gesture: tap({ plate: "cy" }) },
      { at: 2600, label: "the Bolt goes on the stack at Princess", push: SLICE[2] },
      { at: 4400, label: "the Bolt resolves", push: SLICE[3] },
    ] },
  scripted({ name: "cast", manual: true, ms: 4500, about: "I cast Snap at Marath's Herd Baloth. It resolves and the Baloth returns to Marath's hand." },
    STATES.cast, [
      { at: 300, label: "Snap goes on the stack", state: STATES.cast.steps[0] },
      { at: 2300, label: "Snap resolves; Herd Baloth leaves", state: STATES.cast.steps[1] },
    ]),
  ...[["creature", "On turn 9 I cast Mulldrifter from my hand: it goes on the stack, resolves onto my side, and I draw two cards.", ["Mulldrifter goes on the stack", "Mulldrifter resolves; I draw two"]],
    ["counter", "Dack casts Swords to Plowshares at my Meloku; I answer with Arcane Denial at the Swords; Denial resolves, countering it, and both spells go to their owners' graveyards.", ["Dack casts Swords to Plowshares at Meloku", "I cast Arcane Denial at the Swords", "Denial resolves: both spells to the graveyard"]],
    ["tokens", "Marath activates his commander; the ability resolves and he gets an Elemental and four more Beasts, joining the tokens he already has.", ["Marath's ability goes on the stack", "it resolves: an Elemental and four Beasts arrive"]],
    ["combat", "Marath attacks me with Marath, Herd Baloth and a Beast; I block the Baloth with Master of Waves and the Beast with Meloku; damage: my Master of Waves and his Beast die, Marath hits me; combat ends.", ["Marath declares three attackers at me", "I declare two blockers", "combat damage: Master of Waves and the Beast die", "combat ends"]],
    ["wipe", "Dack casts Sunfall: it goes on the stack, then resolves, exiling every creature on the table; Dack gets an Incubator token.", ["Dack casts Sunfall", "Sunfall resolves: every creature is exiled"]],
  ].map(([name, about, labels]) => scripted({ name, ms: 2000 * labels.length + 1800, about, audit: true },
    PLAYS[name].first, PLAYS[name].steps.map((state, i) => ({ at: 300 + 2000 * i, label: labels[i], state })))),
  scripted({ name: "stack", ms: 6200, audit: true,
    about: "Dack casts Swords to Plowshares at my Meloku. I set the stack aside, then bring it back." },
    PLAYS.counter.first, [
      { at: 300, label: "Dack casts Swords to Plowshares at Meloku", state: PLAYS.counter.steps[0] },
      { at: 2500, label: "I tap the table: the stack steps aside", gesture: tap({ open: true }) },
      { at: 4300, label: "I tap the small stack: it comes back", gesture: tap({ stack: PLAYS.counter.steps[0].view.stack[0].source.id }) },
    ]),
  scripted({ name: "focus", ms: 4200, about: "I look at two cards in my hand, put it back, then tap Atraxa's nameplate." },
    BOARDS[1], [
      { at: 300, label: "I tap Snap in my hand", gesture: tap({ hand: 1004 }) },
      { at: 1300, label: "I tap Arcane Denial", gesture: tap({ hand: 1005 }) },
      { at: 2300, label: "I put the hand back", gesture: key("Escape") },
      { at: 3000, label: "I tap Atraxa's nameplate", gesture: tap({ plate: "bo" }) },
    ]),
];

if (require.main === module) module.exports.forEach(c => console.log(`${c.name}${c.manual ? " (by name only)" : ""}: ${c.about}`));
