import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../lib/model.mjs";
import { canonical, cardKey } from "../lib/account.mjs";
import { queue, openDB, unexpected } from "../lib/cloud.mjs";
import { columns } from "../lib/schema.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export function fixture() {
  return {
    uid: "test-user",
    captured_at: new Date().toISOString(),
    tables: Object.fromEntries(Object.keys(columns).map((t) => [t, []])),
    untyped_tables: {},
  };
}
function example() {
  const s = fixture(),
    d = M.createDeck(s, "Example", {
      folder: "Claw/Tests",
      commander: { cv_id: 93029 },
    }),
    c = M.addCard(s, d, 123, 2),
    t = M.createTag(s, "Ramp");
  M.tagCard(s, c, t.id);
  return { s, d, c, t };
}
test("copy preserves notes, folder, card quantities/finishes/proxies and card tag assignments with new identities", () => {
  const { s, d, c, t } = example();
  d.d_notes = "Keep the theme";
  c.dc_foil = 1;
  c.dc_proxy_qty = 1;
  c.id = cardKey(c);
  s.tables.deck_card_tags_rel = [];
  M.tagCard(s, c, t.id);
  const before = structuredClone(s),
    copy = M.copyDeck(s, d, "Copy", "Claw/Copies");
  assert.notEqual(copy.id, d.id);
  assert.equal(copy.d_notes, d.d_notes);
  assert.equal(M.folderPath(s, copy.d_parent_folder), "Claw/Copies");
  assert.equal(
    s.tables.deck_cards.filter((c) => c.dc_d_id === copy.id).length,
    2,
  );
  assert.equal(
    s.tables.deck_card_tags_rel.find((r) => r.dctr_dc_d_id === copy.id)
      .dctr_dc_foil,
    1,
  );
  M.valid(s);
  const p = M.compilePlan(before, s);
  assert.equal(M.verifyPlan(p, s).ok, true);
  assert.equal(unexpected(before, p, s).length, 0);
});
test("card board moves preserve tags and merge quantities, then removal deletes only related assignments", () => {
  const { s, d, c, t } = example();
  M.addCard(s, d, 123, 3, 3);
  const moved = M.moveCard(s, d, c, 3);
  assert.equal(moved.dc_quantity, 5);
  assert.equal(s.tables.deck_card_tags_rel[0].dctr_dc_board_category, 3);
  M.valid(s);
  M.deleteCard(s, d, moved);
  assert.equal(s.tables.deck_card_tags_rel.length, 0);
  assert.equal(s.tables.deck_card_tags.length, 1);
  M.valid(s);
});
test("three-way merge keeps independent edits and unknown columns, rejects concurrent same-field edits and delete/edit conflicts", () => {
  const { s, d } = example();
  d.future_column = "preserved";
  const base = structuredClone(s),
    local = structuredClone(s),
    remote = structuredClone(s);
  local.tables.decks[0].d_name = "Local";
  remote.tables.decks[0].d_notes = "Remote";
  const merged = M.merge(base, local, remote);
  assert.equal(merged.tables.decks[0].d_name, "Local");
  assert.equal(merged.tables.decks[0].d_notes, "Remote");
  assert.equal(merged.tables.decks[0].future_column, "preserved");
  remote.tables.decks[0].d_name = "Other";
  assert.throws(() => M.merge(base, local, remote), /conflict/);
  const deleted = structuredClone(base);
  M.removeDeck(deleted, deleted.tables.decks[0]);
  assert.throws(() => M.merge(base, deleted, remote), /conflict/);
});
test("write policy protects original deck, ancestor folders and shared tags; blocks linked, locked, identity and unknown-field edits", () => {
  const { s, d, c, t } = example(),
    base = structuredClone(s);
  d.d_notes = "Change";
  assert.throws(
    () => M.compilePlan(base, s, { protectedDecks: [d.id] }),
    /protected/,
  );
  const folder = structuredClone(base);
  folder.tables.decks_folders[0].df_name = "Oops";
  assert.throws(
    () => M.compilePlan(base, folder, { protectedDecks: [d.id] }),
    /protected/,
  );
  const tags = structuredClone(base);
  tags.tables.deck_card_tags[0].dct_name = "Oops";
  assert.throws(
    () => M.compilePlan(base, tags, { protectedDecks: [d.id] }),
    /protected/,
  );
  for (const patch of [{ owner_id: "bad" }, { d_config: "bad" }]) {
    const x = structuredClone(base);
    Object.assign(x.tables.decks[0], patch);
    assert.throws(() => M.compilePlan(base, x));
  }
  const locked = structuredClone(base);
  locked.tables.decks[0].d_locked = 1;
  const after = structuredClone(locked);
  after.tables.decks[0].d_name = "No";
  assert.throws(() => M.compilePlan(locked, after), /locked/);
  const linked = structuredClone(base);
  linked.tables.binders.push({
    id: "b",
    b_id: "b",
    owner_id: base.uid,
    b_linked_deck_id: d.id,
  });
  const next = structuredClone(linked);
  next.tables.decks[0].d_name = "No";
  assert.throws(() => M.compilePlan(linked, next), /linked/);
});
test("cycles, invalid references and duplicate card IDs are rejected; non-Commander reads remain possible", () => {
  const { s, d } = example();
  s.tables.decks_folders[0].df_parent_folder = s.tables.decks_folders[1].id;
  assert.throws(() => M.valid(s), /folder_cycle/);
  const { s: x } = example();
  x.tables.deck_cards.push({ ...x.tables.deck_cards[0] });
  assert.throws(() => M.valid(x), /duplicate/);
  const a = example();
  a.d.d_format = 1;
  M.valid(a.s);
  assert.throws(() => M.editable(a.s, a.d), /Commander/);
});
test("deletion requires explicit confirmation in plan and leaves no dangling card tags", () => {
  const { s, d } = example(),
    base = structuredClone(s);
  M.removeDeck(s, d);
  assert.throws(() => M.compilePlan(base, s), /deletion requires/);
  const p = M.compilePlan(base, s, { allowDelete: true });
  assert.equal(p.operations[0].table, "deck_card_tags_rel");
  M.valid(M.applyOps(base, p.operations));
});
test("real PowerSync SQL queue serializes folder/tag/deck/card creation and updates/deletes exactly", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckmaster-queue-test-")),
    db = await openDB(path.join(dir, "db.sqlite"));
  try {
    const base = fixture(),
      { s } = example(),
      ops = M.compilePlan(base, s).operations;
    const wire = await queue(db, ops);
    assert.equal(wire.length, ops.length);
    assert.equal(wire[0].table, "decks_folders");
    assert.equal(wire.at(-1).table, "deck_card_tags_rel");
    const batch = await db.getCrudBatch(100);
    await batch.complete();
    const next = structuredClone(s);
    next.tables.decks[0].d_notes = null;
    next.tables.deck_cards.find((c) => c.dc_cv_id === 123).dc_quantity = 4;
    M.removeDeck(next, next.tables.decks[0]);
    const deletes = M.compilePlan(s, next, { allowDelete: true }).operations;
    const removed = await queue(db, deletes);
    assert.equal(removed[0].op, "DELETE");
    assert.equal(removed.at(-1).table, "decks");
  } finally {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("text replacement retains existing printing, finish, proxy split, raw fields and role tags; ambiguous rows fail before mutation", () => {
  const { s, d, c, t } = example();
  c.dc_foil = 1;
  c.dc_proxy_qty = 1;
  c.id = cardKey(c);
  c.future = "keep";
  s.tables.deck_card_tags_rel = [];
  M.tagCard(s, c, t.id);
  const catalog = {
    resolve: (name) => ({
      cv_id: name === "Test Card" ? 999 : 93029,
      cv_oracle_id: name === "Test Card" ? "oracle" : "obeka",
    }),
    lookup: (id) => ({ cv_oracle_id: id === 123 ? "oracle" : "obeka" }),
  };
  M.importList(
    s,
    d,
    [
      { name: "Test Card", quantity: 4, board: 0 },
      { name: "Obeka", quantity: 1, board: 2 },
    ],
    catalog,
    { replace: true },
  );
  const row = s.tables.deck_cards.find((r) => r.dc_cv_id === 123);
  assert.equal(row.dc_foil, 1);
  assert.equal(row.dc_quantity, 3);
  assert.equal(row.dc_proxy_qty, 1);
  assert.equal(row.future, "keep");
  assert.equal(s.tables.deck_card_tags_rel[0].dctr_dc_foil, 1);
  M.valid(s);
  const extra = { ...row, dc_foil: 0 };
  extra.id = cardKey(extra);
  s.tables.deck_cards.push(extra);
  const before = canonical(s);
  assert.throws(
    () =>
      M.importList(
        s,
        d,
        [{ name: "Test Card", quantity: 1, board: 0 }],
        catalog,
        { replace: true },
      ),
    /ambiguous/,
  );
  assert.equal(canonical(s), before);
});
