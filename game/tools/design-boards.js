// Writes tests/fixtures/boards/design-pass.json: the design pass's game (tools/boards.js) at turns 4, 9 and 15 as
// snapshot envelopes, with the catalog entries of every card on them, so the new client's tests, its Node bench
// (bench-plan.mjs) and the workbench's bench page plan exactly the same tables.
//
//   node tools/design-boards.js
const { writeFileSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { BOARDS } = require("./boards.js");
const CARDS = global.window.CARDS;

const TURNS = [4, 9, 15];
const stages = BOARDS.filter((b) => TURNS.includes(b.turn)).map((b) => ({
  turn: b.turn,
  envelope: {
    state: "playing",
    gen: 1,
    v: b.turn,
    pilots: Object.fromEntries(b.view.players.map((p) => [p.name, p.name === "You" ? "human" : "forge ai"])),
    view: { ...b.view, label: `T${b.turn}`, me: "You" },
    decision: null,
  },
}));
const names = new Set();
for (const s of stages)
  for (const p of s.envelope.view.players)
    for (const z of ["battlefield", "graveyard", "exile", "command", "hand"]) for (const c of p[z] || []) names.add(c.name);
const catalog = Object.fromEntries([...names].sort().filter((n) => CARDS[n]).map((n) => [n, CARDS[n]]));
const out = resolve(__dirname, "../../tests/fixtures/boards");
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "design-pass.json"), JSON.stringify({ stages, catalog }) + "\n");
console.log(`design-pass.json: turns ${TURNS.join(", ")}, ${Object.keys(catalog).length} catalog entries`);
