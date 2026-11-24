import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { parseList, textList } from "../lib/library.mjs";
import { saveOracle } from "../lib/card-cache.mjs";
import { Catalog } from "../lib/catalog.mjs";
import { columns } from "../lib/schema.mjs";
import * as model from "../lib/model.mjs";

test("native Timelines export preserves boards, printings, foil markers and split names", () => {
  const rows = parseList(fs.readFileSync(new URL("fixtures/timelines.txt", import.meta.url), "utf8"));
  assert.deepEqual([0, 1, 2, 3].map((board) => rows.filter((row) => row.board === board).reduce((sum, row) => sum + row.quantity, 0)), [98, 18, 2, 20]);
  assert.equal(rows.find((row) => row.name === "Knowledge Pool").number, "MBS-111");
  assert.equal(rows.filter((row) => row.name.includes(" // ")).length, 2);
  assert.deepEqual(rows.filter((row) => row.finish === 1).map((row) => row.name), ["The Twelfth Doctor", "Passionate Archaeologist"]);
  const catalog = { lookup: (index) => ({ cv_set_id: rows[index].set, cv_collector_number: rows[index].number }) };
  const doc = { cards: rows.map((row, index) => ({ ...row, board: ["main", "side", "commander", "maybe"][row.board], cv_id: index, proxies: 0, tags: [], finish: row.finish ?? 0 })) };
  const sort = (list) => list.sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(sort(parseList(textList(doc, { catalog }))), sort([...rows]));
  assert.deepEqual(sort(parseList(textList(doc, { catalog, enriched: true }))), sort([...rows]));
});

test("normal, foil and etched rows of the same printing remain distinct", () => {
  const state = { uid: "test", tables: Object.fromEntries(Object.keys(columns).map((key) => [key, []])) };
  const deck = model.createDeck(state, "Draft");
  const catalog = { resolve: () => ({ cv_id: 1, cv_oracle_id: "oracle", cv_non_foil: 1, cv_foil: 1, cv_etched: 1 }), lookup: () => ({ cv_oracle_id: "oracle", cv_set_id: "ABC", cv_collector_number: "1" }) };
  const rows = parseList("1 Example (ABC) 1\n2 Example (ABC) 1 *F*\n3 Example (ABC) 1 *E*");
  model.importList(state, deck, rows, catalog);
  model.importList(state, deck, rows, catalog, { replace: true });
  assert.deepEqual(state.tables.deck_cards.map((card) => [card.dc_foil, card.dc_quantity]), [[0, 1], [1, 2], [2, 3]]);
  model.valid(state);
  const doc = { cards: state.tables.deck_cards.map((card) => ({ name: "Example", cv_id: 1, quantity: card.dc_quantity, proxies: 0, finish: card.dc_foil, board: "main", tags: [] })) };
  assert.deepEqual(parseList(textList(doc, { catalog })), rows);
});

test("plain and enriched imports are identical; annotations never override card facts or tags", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "deckmaster-text-"));
  try {
    const oracleId = "abcdefab-1234-1234-1234-123456789012";
    await saveOracle(repo, { oracle_id: oracleId, name: "Example", mana_cost: "{2}{U}", type_line: "Creature", power: "2", toughness: "3", oracle_text: "First line\nSecond line", card_faces: [{ name: "Other face", oracle_text: "Other text" }] });
    const catalog = { lookup: () => ({ cv_set_id: "abc", cv_collector_number: "12a", cv_oracle_id: oracleId }) };
    const doc = { cards: ["commander", "main", "side", "maybe"].map((board) => ({ board, name: "Example", cv_id: 123, quantity: 1, proxies: 0, finish: 0, tags: ["role"] })) };
    const plain = textList(doc, { catalog });
    const enriched = textList(doc, { catalog, repo, enriched: true, tagNames: { role: "Draw" } });
    assert.deepEqual(parseList(plain), parseList(enriched));
    assert.match(enriched, /Other text/);
    assert.match(enriched, /First line\\nSecond line/);
    assert.match(enriched, /Draw/);
    assert.deepEqual(parseList('1 Example (ABC) 12a | {"name":"Wrong","quantity":99,"tags":["bad"]}'), [{ quantity: 1, name: "Example", board: 0, set: "ABC", number: "12a" }]);
    assert.match(textList(doc, { enriched: true }), /"status":"missing"/);
    assert.deepEqual(parseList("# maybe\n2 Example"), [{ quantity: 2, name: "Example", board: 3 }]);
    assert.deepEqual(parseList("[COMMANDER]\n1 Example\nDeck\n2 Example\n[Sideboard]\n1 Example\n# Maybeboard\n1 Example").map((row) => row.board), [2, 0, 1, 3]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("explicit printings change only the selected printing and retain tags, finish and proxies", () => {
  const state = { uid: "test", tables: Object.fromEntries(Object.keys(columns).map((key) => [key, []])) };
  const deck = model.createDeck(state, "Draft");
  const card = model.addCard(state, deck, 1, 2);
  card.dc_proxy_qty = 1;
  const tag = model.createTag(state, "Theme");
  model.tagCard(state, card, tag.id);
  const catalog = { resolve: (name, options) => ({ cv_id: options.set ? 2 : 3, cv_oracle_id: "oracle", cv_non_foil: 1 }), lookup: () => ({ cv_oracle_id: "oracle" }) };
  model.importList(state, deck, parseList("3 Example"), catalog, { replace: true });
  assert.equal(state.tables.deck_cards[0].dc_cv_id, 1);
  model.importList(state, deck, parseList("3 Example (NEW) 12"), catalog, { replace: true });
  assert.equal(state.tables.deck_cards[0].dc_cv_id, 2);
  assert.equal(state.tables.deck_cards[0].dc_proxy_qty, 1);
  assert.equal(state.tables.deck_card_tags_rel[0].dctr_dc_cv_id, 2);
  model.valid(state);
});

test("catalog resolves set and collector number exactly, rejects missing or ambiguous versions", () => {
  const db = new Database(":memory:");
  db.exec("create table cards(c_oracle_id text,c_name text,c_color_identity text,c_cmc real); create table card_versions(cv_id integer,cv_oracle_id text,cv_set_id text,cv_collector_number text,cv_digital integer,cv_oversized integer); create table sets(s_id text,s_name text); insert into cards values('oracle','Example','U',3); insert into sets values('abc','Example Set'); insert into card_versions values(1,'oracle','abc','12',0,0),(2,'oracle','abc','12a',0,0);");
  const catalog = Object.create(Catalog.prototype);
  catalog.open = () => ({ prepare: (...args) => db.prepare(...args), close() {} });
  try {
    assert.equal(catalog.resolve("Example", { set: "ABC", number: "12a" }).cv_id, 2);
    assert.throws(() => catalog.resolve("Example", { set: "abc" }), /ambiguous/);
    assert.throws(() => catalog.resolve("Example", { set: "xyz", number: "12" }), /not found/);
  } finally { db.close(); }
});

test("only the Deckmaster CLI entry points remain", () => {
  assert(fs.existsSync(path.resolve("../../../bin/deckmaster")));
  assert(!fs.existsSync(path.resolve("../../bin/mb")));
  assert(!fs.existsSync(path.resolve("bin/mb.mjs")));
  assert.deepEqual(JSON.parse(fs.readFileSync("package.json", "utf8")).bin, { deckmaster: "bin/deckmaster.mjs" });
});

test("numeric catalog keys resolve canonical facts offline without namesake collisions", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "deckmaster-identity-"));
  try {
    const real = "abcdefab-1234-1234-1234-123456789012", token = "abcdefab-1234-1234-1234-123456789013", printing = "abcdefab-1234-1234-1234-123456789014";
    await saveOracle(repo, { oracle_id: real, name: "Example", layout: "normal", oracle_text: "Real rules" });
    const ref = { cv_oracle_id: 33980, cv_scryfall_id: printing, c_name: "Example", c_layout: 0 };
    const catalog = { lookup: () => ref };
    const doc = { cards: [{ name: "Example", cv_id: 123, board: "main", quantity: 1, proxies: 0, finish: 0, tags: [] }] };
    const render = () => textList(doc, { repo, catalog, enriched: true });
    assert.match(render(), /Real rules/);
    await saveOracle(repo, { oracle_id: token, name: "Example", layout: "token", oracle_text: "Token rules" });
    assert.match(render(), /"status":"missing"/);
    const dir = path.join(repo, ".manabox", "scryfall");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, printing + ".json");
    fs.writeFileSync(file, JSON.stringify({ retrieved_at: new Date().toISOString(), card: { id: printing, oracle_id: real, name: "Example" } }));
    assert.match(render(), /Real rules/);
    assert.doesNotMatch(render(), /Token rules/);
    assert.deepEqual(parseList(render()), parseList(textList(doc, { catalog })));
    fs.writeFileSync(file, JSON.stringify({ retrieved_at: new Date().toISOString(), card: { id: "wrong-printing", oracle_id: real, name: "Example" } }));
    assert.match(render(), /"status":"missing"/);
    fs.unlinkSync(file);
    ref.c_layout = 10;
    fs.unlinkSync(path.join(repo, ".card-cache", "oracle", token + ".json"));
    assert.match(render(), /"status":"missing"/);
    ref.c_layout = 0;
    ref.cv_scryfall_id = "../../outside";
    assert.match(render(), /Real rules/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
