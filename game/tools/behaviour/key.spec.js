// 1. The decision key the client sends equals the server's (live.js keyOf, deckmaster/game.py key()).
const { execFileSync } = require("child_process");
const path = require("path");
const { test, expect, snapshot, withDecision, find, keyOf } = require("./harness.js");

const ROOT = path.join(__dirname, "../../..");
const pythonKeys = ds => JSON.parse(execFileSync("python3", ["-c",
  "import sys, json; from deckmaster.game import key; print(json.dumps([key(d) for d in json.load(sys.stdin)]))"], { cwd: ROOT, input: JSON.stringify(ds) }).toString());

const names = ["Island", "Mystic Sanctuary", "Otawara, Soaring City", "Minamo, School at Water's Edge", "Seat of the Synod", "Nykthos, Shrine to Nyx", "Vesuva", "Thespian's Stage"];
const DECISIONS = [
  { kind: "play", turn: "T9 main", prompt: "", options: ["Pass", "Island (land)"], refs: [{}, { card: 0 }] },
  { kind: "number", turn: "T9 main", prompt: "Choose a value for X (Fireball)", options: [], min: 0, max: 5 },
  { kind: "choose", turn: "T9 main", prompt: "Choose up to two land cards (Ghostly Flicker)", options: names, refs: names.map(name => ({ name })), min: 0, max: 2 },   // more than 6 options: only the first 6 count
  { kind: "confirm", turn: "T10 end", prompt: "Use Sol Ring: add {C}{C}? | with a pipe", options: ["Yes", "No"] },
  { kind: "choose", turn: "T9 main", prompt: "", options: ["Café — déjà vu ✓", "B"], refs: [{ name: "A" }, { name: "B" }], min: 1, max: 1 },
];

test("the key sent equals keyOf and the Python key()", { tag: "@cast" }, async ({ table }) => {
  const base = snapshot("theirs");
  const sent = [], sentDecisions = [];
  for (const d of DECISIONS) {
    const s = withDecision(base, d.kind === "play" ? { ...d, refs: [{}, { card: find(base, "You", "Island").id }] } : d);
    await table.open(s);
    if (d.kind === "play") await table.pass(); else { await table.page.keyboard.press("Escape"); await table.press("Auto"); }
    const a = await table.answered(1);
    sent.push(a.at(-1).key); sentDecisions.push(s.decision);
    table.log = [];
  }
  const expected = sentDecisions.map(keyOf);
  expect(sent).toEqual(expected);
  expect(sent).toEqual(pythonKeys(sentDecisions));
  expect(sent[0]).toBe("play|T9 main||2|Pass|Island (land)");
  // the formula's two corner cases, spelled out: no options is "0", and only six options are named
  expect(sent[1]).toBe("number|T9 main|Choose a value for X (Fireball)|0");
  expect(sent[2]).toBe(["choose", "T9 main", "Choose up to two land cards (Ghostly Flicker)", "8", ...names.slice(0, 6)].join("|"));
});
