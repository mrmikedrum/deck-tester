// The clips reel.js records: the moments a player watches the table change. Each starts from a live state (mocked
// bridge) or an offline scenario, then fires beats at virtual times. `about` is what a reviewer is told happens;
// it says what the game did, never what the screen should look like.
const { STATES } = require("./shoot.js");
const { BOARDS } = require("./boards.js");
const PLAYS = require("./plays.js");
const take = (st, v) => `window.Live.take(${JSON.stringify({ v, state: "playing", view: st.view, decision: st.decision })})`;

// Tap the biggest pile on a seat's page, as a player would to look through it.
const siftBiggest = pid => `(() => { const pc = Object.values(__h.pieces()).filter(p => p.pid === "${pid}" && p.ids.length > 1 && p.role !== "zone").sort((a, b) => b.ids.length - a.ids.length)[0]; if (pc) __h.sift(pc.ids, pc.obj.getWorldPosition(new __h.T.Vector3()), "pile"); })()`;

module.exports = [
  { name: "game", live: BOARDS[0], ms: 1500 * BOARDS.length + 4200, audit: true,
    about: "One game from turn 2 to turn 15: every seat's board grows a turn-step at a time. Then I lean in on Marath's crowded side, tap his biggest pile to look through it, and close it.",
    beats: [...BOARDS.slice(1).map((b, i) => ({ at: 1500 * (i + 1), label: `turn ${b.turn}`, js: take(b, i + 2), audit: true })),
            { at: 1500 * BOARDS.length, label: "lean in on Marath", js: '__h.focusOn("ana")', audit: false },
            { at: 1500 * BOARDS.length + 1400, label: "tap Marath's biggest pile", js: siftBiggest("ana"), audit: false },
            { at: 1500 * BOARDS.length + 2800, label: "close it", js: "__h.unsift(); __h.focusOn(null)" }] },
  { name: "turns", live: "main", ms: 6000, audit: true, about: "The turn passes around the table: from my main phase to Atraxa's turn, then Dack's turn where Dack casts a spell, then back to me.",
    beats: [{ at: 300, label: "Atraxa's turn begins", js: take(STATES.theirs, 2) },
            { at: 2300, label: "Dack's turn: Dack casts Swords to Plowshares on my Meloku", js: take(STATES.threat, 3) },
            { at: 4300, label: "back to my main phase", js: take(STATES.main, 4) }] },
  { name: "lean", live: "main", ms: 5000, audit: true, about: "I tap Atraxa's side of the table to look closely at it, then go back to the whole table, then look at Dack's side.",
    // Leaned in, the page held up may cover others' cards (they come back the moment anything happens there: live.js), so
    // those stills are looked at, not gated, as in the game clip.
    beats: [{ at: 300, label: "lean in on Atraxa", js: '__h.focusOn("bo")', audit: false },
            { at: 2000, label: "back to the table", js: "__h.focusOn(null)" },
            { at: 3400, label: "lean in on Dack", js: '__h.focusOn("cy")', audit: false }] },
  { name: "cast", manual: true, live: "cast", ms: 4500, about: "I cast Snap from my hand at Marath's Herd Baloth; it goes on the stack, resolves, and the Baloth returns to Marath's hand.",
    beats: [{ at: 300, label: "Snap goes on the stack", js: take({ view: STATES.cast.steps[0].view, decision: STATES.cast.steps[0].decision }, 2) },
            { at: 2300, label: "Snap resolves; Herd Baloth leaves", js: take({ view: STATES.cast.steps[1].view, decision: STATES.cast.steps[1].decision }, 3) }] },
  ...[["creature", "On turn 9 I cast Mulldrifter from my hand: it goes on the stack, resolves onto my side, and I draw two cards.", ["Mulldrifter goes on the stack", "Mulldrifter resolves; I draw two"]],
    ["counter", "Dack casts Swords to Plowshares at my Meloku; I answer with Arcane Denial at the Swords; Denial resolves, countering it, and both spells go to their owners' graveyards.", ["Dack casts Swords to Plowshares at Meloku", "I cast Arcane Denial at the Swords", "Denial resolves: both spells to the graveyard"]],
    ["tokens", "Marath activates his commander; the ability resolves and he gets an Elemental and four more Beasts, joining the tokens he already has.", ["Marath's ability goes on the stack", "it resolves: an Elemental and four Beasts arrive"]],
    ["combat", "Marath attacks me with Marath, Herd Baloth and a Beast; I block the Baloth with Master of Waves and the Beast with Meloku; damage: my Master of Waves and his Beast die, Marath hits me; combat ends.", ["Marath declares three attackers at me", "I declare two blockers", "combat damage: Master of Waves and the Beast die", "combat ends"]],
    ["wipe", "Dack casts Sunfall: it goes on the stack, then resolves, exiling every creature on the table; Dack gets an Incubator token.", ["Dack casts Sunfall", "Sunfall resolves: every creature is exiled"]],
  ].map(([name, about, labels]) => ({ name, live: PLAYS[name].first, ms: 2000 * labels.length + 1800, about, audit: true,
    beats: PLAYS[name].steps.map((st, i) => ({ at: 300 + 2000 * i, label: labels[i], js: take(st, i + 2) })) })),
  // Offline scenario jumps cut between unrelated boards: a dev tool, not a game moment. Record it by name if wanted.
  { name: "scenarios", manual: true, live: null, ms: 5000, setup: ['__h.loadScenario("early")'], about: "The game jumps ahead: from an early board to a mid-game board to a late-game board, each side gaining many permanents.",
    beats: [{ at: 300, label: "mid-game board", js: '__h.loadScenario("mid")' },
            { at: 2600, label: "late-game board", js: '__h.loadScenario("late")' }] },
];

if (require.main === module) module.exports.forEach(c => console.log(`${c.name}${c.manual ? " (by name only)" : ""}: ${c.about}`));
