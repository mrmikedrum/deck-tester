// The clips reel.js records: the moments a player watches the table change. Each starts from a live state (mocked
// bridge) or an offline scenario, then fires beats at virtual times. `about` is what a reviewer is told happens;
// it says what the game did, never what the screen should look like.
const { STATES } = require("./shoot.js");
const { BOARDS } = require("./boards.js");
const PLAYS = require("./plays.js");
// The slice (docs/game-client-migration.md, phase 2) from the protocol corpus: real envelopes, which both clients take.
// Its card data is the game server's cache (.deckmaster/cache/cards/cards.json) over the tests' catalog.
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

const take = (st, v) => `window.Live.take(${JSON.stringify({ v, state: "playing", view: st.view, decision: st.decision })})`;

// The new entry's form of a mocked live state: the envelope the bridge would send, in the engine's full shape (the
// behaviour harness's: the new entry decodes strictly), and its card data, the same as the current client's (data.js).
const H = require("./behaviour/harness.js");
// Keep the original reels' catalog decoration (including Master of Waves's Protection glyph).
const withCatalogKeywords = view => {
  const fill = c => { if (c) c.keywords = H.CARDS[c.name]?.faces[0].keywords?.slice() || []; };
  view.players.forEach(p => ["battlefield", "command", "graveyard", "exile", "hand"].forEach(z => (p[z] || []).forEach(fill)));
  (view.stack || []).forEach(it => fill(it.source));
  return view;
};
const env = (st, v, catalogKeywords) => {
  const view = H.clone(st.view);
  if (catalogKeywords) withCatalogKeywords(view);
  return H.engineShape({ state: "playing", gen: 1, view, decision: st.decision ? H.decision(view, H.clone(st.decision)) : null, pilots: {}, v, error: null });
};
// A clip of the current client's, also on the new entry: its first state and every `take` as envelopes; `news` gives
// a beat its new-entry form by index where it is not a snapshot (a gesture in place of `__h`).
function bothEntries(clip, first, states, news = {}, catalogKeywords = true) {
  const liveNew = env(first, 1, catalogKeywords), pushes = states.map((st, i) => (st ? env(st, i + 2, catalogKeywords) : null));
  return Object.assign(clip, { entries: ["old", "new"], liveNew, catalogNew: catalogFor([liveNew, ...pushes.filter(Boolean)], H.CARDS),
    beats: clip.beats.map((b, i) => Object.assign(b, { new: news[i] || { push: pushes[i] } })) });
}

function playClip([name, about, labels], catalogKeywords) {
  const { first, steps } = PLAYS[name];
  return bothEntries({ name, live: first, ms: 2000 * labels.length + 1800, about, audit: true,
    beats: steps.map((st, i) => ({ at: 300 + 2000 * i, label: labels[i], js: take(st, i + 2) })) }, first, steps, {}, catalogKeywords);
}

// Tap the biggest pile on a seat's page, as a player would to look through it.
const siftBiggest = pid => `(() => { const pc = Object.values(__h.pieces()).filter(p => p.pid === "${pid}" && p.ids.length > 1 && p.role !== "zone").sort((a, b) => b.ids.length - a.ids.length)[0]; if (pc) __h.sift(pc.ids, pc.obj.getWorldPosition(new __h.T.Vector3()), "pile"); })()`;

// A finger tap on the table at a point, the way the canvas hears one.
const tapAt = xy => `(() => { const [x, y] = ${xy}, cv = __h.renderer().domElement, o = { clientX: x, clientY: y, pointerId: 1, isPrimary: true, bubbles: true };
  cv.dispatchEvent(new PointerEvent("pointerdown", o)); cv.dispatchEvent(new PointerEvent("pointerup", o)); })()`;
// The open table nearest the middle of the screen: no card, pile or panel there, and clear of the stack.
const openTable = `(() => { const cv = __h.renderer().domElement, r = __h.stackRect(), pts = [];
  for (let y = 40; y < innerHeight - 40; y += 12) for (let x = 40; x < innerWidth - 40; x += 12) pts.push([x, y]);
  pts.sort((a, b) => Math.hypot(a[0] - innerWidth / 2, a[1] - innerHeight / 2) - Math.hypot(b[0] - innerWidth / 2, b[1] - innerHeight / 2));
  return pts.find(([x, y]) => document.elementFromPoint(x, y) === cv && !__h.pickAt(x, y) && !(r && x > r.left - 20 && x < r.right + 20 && y > r.top - 20 && y < r.bottom + 20)) || [innerWidth / 2, innerHeight / 2]; })()`;
const stackMiddle = `(() => { const r = __h.stackRect(); return r ? [(r.left + r.right) / 2, (r.top + r.bottom) / 2] : [innerWidth / 2, innerHeight / 2]; })()`;

module.exports = [
  bothEntries({ name: "game", live: BOARDS[0], ms: 1500 * BOARDS.length + 4200, audit: true,
    about: "One game from turn 2 to turn 15: every seat's board grows a turn-step at a time. Then I lean in on Marath's crowded side, tap his biggest pile to look through it, and close it.",
    beats: [...BOARDS.slice(1).map((b, i) => ({ at: 1500 * (i + 1), label: `turn ${b.turn}`, js: take(b, i + 2), audit: true })),
            { at: 1500 * BOARDS.length, label: "lean in on Marath", js: '__h.focusOn("ana")', audit: false },
            { at: 1500 * BOARDS.length + 1400, label: "tap Marath's biggest pile", js: siftBiggest("ana"), audit: false },
            { at: 1500 * BOARDS.length + 2800, label: "close it", js: "__h.unsift(); __h.focusOn(null)" }] },
    BOARDS[0], BOARDS.slice(1), { [BOARDS.length - 1]: { gesture: { tap: { plate: "ana" } } }, [BOARDS.length]: { gesture: { tap: { pile: "ana" } } },
      [BOARDS.length + 1]: { gesture: [{ key: "Escape" }, { key: "Escape" }] } }),
  bothEntries({ name: "turns", live: "main", ms: 6000, audit: true, about: "The turn passes around the table: from my main phase to Atraxa's turn, then Dack's turn where Dack casts a spell, then back to me.",
    beats: [{ at: 300, label: "Atraxa's turn begins", js: take(STATES.theirs, 2) },
            { at: 2300, label: "Dack's turn: Dack casts Swords to Plowshares on my Meloku", js: take(STATES.threat, 3) },
            { at: 4300, label: "back to my main phase", js: take(STATES.main, 4) }] }, STATES.main, [STATES.theirs, STATES.threat, STATES.main]),
  bothEntries({ name: "lean", live: "main", ms: 5000, audit: true, about: "I tap Atraxa's side of the table to look closely at it, then go back to the whole table, then look at Dack's side.",
    // Leaned in, the page held up may cover others' cards (they come back the moment anything happens there: live.js), so
    // those stills are looked at, not gated, as in the game clip.
    beats: [{ at: 300, label: "lean in on Atraxa", js: '__h.focusOn("bo")', audit: false },
            { at: 2000, label: "back to the table", js: "__h.focusOn(null)" },
            { at: 3400, label: "lean in on Dack", js: '__h.focusOn("cy")', audit: false }] }, STATES.main, [],
    { 0: { gesture: { tap: { plate: "bo" } } }, 1: { gesture: { tap: { plate: "bo" } } }, 2: { gesture: { tap: { plate: "cy" } } } }),
  { name: "slice", entries: ["old", "new"], live: SLICE[0], catalog: catalogFor(SLICE), ms: 6500,
    about: "On turn 1 I drag Lightning Bolt up from my hand; Forge asks for its target and I tap Princess's plate; the Bolt goes on the stack aimed at Princess, then resolves.",
    beats: [{ at: 300, label: "I drag Lightning Bolt up from my hand", gesture: { drag: { hand: 822, dy: 160 } } },
            { at: 1000, label: "Forge asks for the Bolt's target", push: SLICE[1] },
            { at: 2000, label: "I tap Princess's plate", gesture: { tap: { plate: "cy" } } },
            { at: 2600, label: "the Bolt goes on the stack at Princess", push: SLICE[2] },
            { at: 4400, label: "the Bolt resolves", push: SLICE[3] }] },
  bothEntries({ name: "cast", manual: true, live: "cast", ms: 4500, about: "I cast Snap from my hand at Marath's Herd Baloth; it goes on the stack, resolves, and the Baloth returns to Marath's hand.",
    beats: [{ at: 300, label: "Snap goes on the stack", js: take({ view: STATES.cast.steps[0].view, decision: STATES.cast.steps[0].decision }, 2) },
            { at: 2300, label: "Snap resolves; Herd Baloth leaves", js: take({ view: STATES.cast.steps[1].view, decision: STATES.cast.steps[1].decision }, 3) }] },
    STATES.cast, STATES.cast.steps),
  ...[["creature", "On turn 9 I cast Mulldrifter from my hand: it goes on the stack, resolves onto my side, and I draw two cards.", ["Mulldrifter goes on the stack", "Mulldrifter resolves; I draw two"]],
    ["counter", "Dack casts Swords to Plowshares at my Meloku; I answer with Arcane Denial at the Swords; Denial resolves, countering it, and both spells go to their owners' graveyards.", ["Dack casts Swords to Plowshares at Meloku", "I cast Arcane Denial at the Swords", "Denial resolves: both spells to the graveyard"]],
    ["tokens", "Marath activates his commander; the ability resolves and he gets an Elemental and four more Beasts, joining the tokens he already has.", ["Marath's ability goes on the stack", "it resolves: an Elemental and four Beasts arrive"]],
    ["combat", "Marath attacks me with Marath, Herd Baloth and a Beast; I block the Baloth with Master of Waves and the Beast with Meloku; damage: my Master of Waves and his Beast die, Marath hits me; combat ends.", ["Marath declares three attackers at me", "I declare two blockers", "combat damage: Master of Waves and the Beast die", "combat ends"]],
    ["wipe", "Dack casts Sunfall: it goes on the stack, then resolves, exiling every creature on the table; Dack gets an Incubator token.", ["Dack casts Sunfall", "Sunfall resolves: every creature is exiled"]],
  ].map(beat => playClip(beat, true)),
  bothEntries({ name: "stack", live: PLAYS.counter.first, ms: 6200, audit: true,
    about: "Dack casts Swords to Plowshares at my Meloku. I tap the open table to set the stack aside and see the whole board, then tap the small stack to look at it again.",
    beats: [{ at: 300, label: "Dack casts Swords to Plowshares at Meloku", js: take(PLAYS.counter.steps[0], 2) },
            { at: 2500, label: "I tap the table: the stack steps aside", js: tapAt(openTable) },
            { at: 4300, label: "I tap the small stack: it comes back", js: tapAt(stackMiddle) }] },
    PLAYS.counter.first, [PLAYS.counter.steps[0]], { 1: { gesture: { tap: { open: true } } }, 2: { gesture: { tap: { stack: PLAYS.counter.steps[0].view.stack[0].source.id } } } }),
  // Offline scenario jumps cut between unrelated boards: a dev tool, not a game moment. Record it by name if wanted.
  { name: "scenarios", manual: true, live: null, ms: 5000, setup: ['__h.loadScenario("early")'], about: "The game jumps ahead: from an early board to a mid-game board to a late-game board, each side gaining many permanents.",
    beats: [{ at: 300, label: "mid-game board", js: '__h.loadScenario("mid")' },
            { at: 2600, label: "late-game board", js: '__h.loadScenario("late")' }] },
  ...[
    ["attack15", "On turn 15 Forge asks which of my creatures attack and where. I send six at Marath.",
      ["Forge asks me to declare attackers", "I attack Marath with six creatures"]],
    ["block15", "On turn 15 Marath attacks me with eleven creatures. Forge offers me the legal pairs of blockers and attackers.",
      ["Marath attacks me with eleven creatures", "Forge asks me to declare blockers"]],
    ["threat15", "It's Marath's main phase on turn 15. He has priority and has yet to attack.",
      ["Marath has priority in his main phase"]],
    ["alpha15", "On turn 15 Marath attacks me with eleven creatures. I block seven attackers. One Beast and two Cat Beasts die.",
      ["Marath attacks me with eleven creatures", "I block four Beasts, two Cat Beasts and an Elemental", "Combat damage kills one Beast and two Cat Beasts"]],
    ["wipe15", "On turn 15 Dack casts Sunfall. It exiles all creatures and Dack gets an Incubator.",
      ["Dack casts Sunfall", "Sunfall resolves: every creature is exiled"]],
    ["snipe15", "On turn 15 I cast Snap targeting Marath's Kami of Whispered Hopes. It returns to his hand.",
      ["I cast Snap targeting Kami of Whispered Hopes", "Snap resolves: Kami of Whispered Hopes returns to Marath's hand"]],
    ["snipeToken15", "On turn 15 I cast Snap targeting one of Marath's nine Beast tokens. That Beast leaves the battlefield and ceases to exist.",
      ["I cast Snap targeting one Beast token", "Snap resolves: the targeted Beast token leaves"]],
  ].map(beat => playClip(beat, false)),
];

if (require.main === module) module.exports.forEach(c => console.log(`${c.name}${c.manual ? " (by name only)" : ""}: ${c.about}`));
