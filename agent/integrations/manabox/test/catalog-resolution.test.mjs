import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { Catalog } from "../lib/catalog.mjs";
import { parseList } from "../lib/library.mjs";
import { columns } from "../lib/schema.mjs";
import * as model from "../lib/model.mjs";

function fixture(t) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    create table cards(c_oracle_id integer,c_name text,c_layout integer,c_color_identity text,c_cmc real);
    create table sets(s_id text,s_name text);
    create table card_versions(cv_id integer,cv_oracle_id integer,cv_set_id text,cv_collector_number text,cv_digital integer default 0,cv_oversized integer default 0,cv_non_foil integer default 1,cv_foil integer default 1,cv_etched integer default 0,cv_priority integer default 0,cv_promo integer default 0);
    insert into cards values(4156,'Vizier of Many Faces',10,'W',0),(4079,'Vizier of Many Faces',0,'U',4),(99,'Spirit',10,'W',0),(100,'Vizier of Many Faces',11,'W',0);
    insert into sets values('tdrc','Tokens'),('drc','Commander'),('akh','Amonkhet');
    insert into card_versions(cv_id,cv_oracle_id,cv_set_id,cv_collector_number) values
      (102945,4156,'tdrc','2'),(103239,4079,'drc','84'),(200000,4079,'akh','74'),(1,99,'tdrc','1'),(2,100,'tdrc','3');
  `);
  const catalog = Object.create(Catalog.prototype);
  catalog.open = () => ({ prepare: (...args) => db.prepare(...args), close() {} });
  return { db, catalog };
}

test("default names prefer a real oracle over lower-id same-name tokens", (t) => {
  const { catalog } = fixture(t);
  assert.equal(catalog.resolve("vizier of many faces").cv_id, 103239);
  assert.equal(catalog.resolve("Spirit").cv_id, 1);
});

test("set/collector requests remain exact, including intentional tokens", (t) => {
  const { catalog } = fixture(t);
  assert.equal(catalog.resolve("Vizier of Many Faces", { set: "AKH", number: "74" }).cv_id, 200000);
  assert.equal(catalog.resolve("Vizier of Many Faces", { set: "TDRC", number: "2" }).cv_id, 102945);
  assert.equal(catalog.resolve("Vizier of Many Faces", { set: "drc" }).cv_id, 103239);
  assert.throws(() => catalog.resolve("Vizier of Many Faces", { set: "tdrc" }), /ambiguous/);
  assert.throws(() => catalog.resolve("Vizier of Many Faces", { set: "akh", number: "2" }), /not found/);
});

test("replacement keeps retained non-default printing, foil, proxies, tags and board", (t) => {
  const { catalog } = fixture(t);
  const state = { uid: "test", tables: Object.fromEntries(Object.keys(columns).map((key) => [key, []])) };
  const deck = model.createDeck(state, "Isolated draft");
  const card = model.addCard(state, deck, 200000, 2, 1, 1);
  card.dc_proxy_qty = 1;
  const tag = model.createTag(state, "Theme");
  model.tagCard(state, card, tag.id);
  const original = structuredClone(card);
  model.importList(state, deck, parseList("[Sideboard]\n4 Vizier of Many Faces"), catalog, { replace: true });
  assert.deepEqual(state.tables.deck_cards, [{ ...original, dc_quantity: 3 }]);
  assert.equal(state.tables.deck_card_tags_rel.length, 1);
  assert.equal(state.tables.deck_card_tags_rel[0].dctr_dc_cv_id, 200000);
  model.valid(state);
  model.importList(state, deck, parseList("[Sideboard]\n4 Vizier of Many Faces (DRC) 84 *F*"), catalog, { replace: true });
  assert.equal(state.tables.deck_cards[0].dc_cv_id, 103239);
  assert.equal(state.tables.deck_cards[0].dc_proxy_qty, 1);
  assert.equal(state.tables.deck_card_tags_rel[0].dctr_dc_cv_id, 103239);
  model.valid(state);
});

test("distinct non-token oracles fail before mutating the deck", (t) => {
  const { db, catalog } = fixture(t);
  db.exec("insert into cards values(999,'Vizier of Many Faces',0,'U',4); insert into card_versions(cv_id,cv_oracle_id,cv_set_id,cv_collector_number) values(300000,999,'drc','99')");
  const state = { uid: "test", tables: Object.fromEntries(Object.keys(columns).map((key) => [key, []])) };
  const deck = model.createDeck(state, "Isolated draft");
  model.addCard(state, deck, 103239, 1);
  const before = structuredClone(state);
  assert.throws(() => model.importList(state, deck, parseList("1 Vizier of Many Faces"), catalog, { replace: true }), /name is ambiguous/);
  assert.deepEqual(state, before);
  assert.equal(catalog.resolve("Vizier of Many Faces", { set: "drc", number: "84" }).cv_id, 103239);
});
