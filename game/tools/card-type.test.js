const { strictEqual } = require("node:assert");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const { runInNewContext } = require("node:vm");

test("the legacy board classifies a Spacecraft from its current type", () => {
  const name = "Wurmwall Sweeper";
  const printed = "Artifact — Spacecraft";
  const window = { GAME: { players: [] }, CARDS: { [name]: { faces: [{ type: printed }] } } };
  runInNewContext(readFileSync(join(__dirname, "../client/common.js"), "utf8"), { window });
  const { category } = window.Proto;
  strictEqual(category({ card: name, _type: printed }), "other");
  strictEqual(category({ card: name, _type: "Artifact Creature — Spacecraft" }), "creature");
  strictEqual(category({ card: name, _type: printed }), "other");
});
