import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Store, atomic, read, digest, hash, withLock } from "../lib/store.mjs";
import { Catalog } from "../lib/catalog.mjs";
import { columns } from "../lib/schema.mjs";
import * as M from "../lib/model.mjs";
import {
  openDB,
  queue,
  sendPlan,
  reconcile,
  unresolved,
} from "../lib/cloud.mjs";
import { materialize, ingest, parseList } from "../lib/library.mjs";
import { mutate, prepare, apply } from "../lib/workshop.mjs";
import { spawnSync } from "node:child_process";
import { refine, refinementReview } from "../lib/refinements.mjs";
function env() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deckmaster-resilience-"));
  const store = new Store({
    repo: path.join(tmp, "repo"),
    state: path.join(tmp, "state"),
  });
  atomic(store.file("session.json"), { uid: "u" });
  return {
    tmp,
    store,
    done: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}
function fixture() {
  return {
    uid: "u",
    captured_at: new Date().toISOString(),
    tables: Object.fromEntries(Object.keys(columns).map((t) => [t, []])),
    untyped_tables: {},
  };
}
function mini(file, version = 42) {
  const db = new Database(file);
  db.exec(
    `create table metadata(updated_at integer);insert into metadata values(${version});create table cards(c_oracle_id text,c_name text,c_color_identity text,c_cmc real,c_layout integer);create table card_versions(cv_id integer,cv_oracle_id text,cv_scryfall_id text,cv_set_id text,cv_non_foil integer,cv_digital integer,cv_oversized integer,cv_priority integer,cv_promo integer);create table sets(s_id text,s_name text);create table card_faces(x integer);insert into cards values('oracle','Test Card','U',2,0);insert into card_versions values(123,'oracle','abcdefab-1234-1234-1234-123456789012','set',1,0,0,1,0);insert into sets values('set','Test Set');`,
  );
  db.close();
}
function seedCatalog(store) {
  const catalog = new Catalog(store),
    dir = store.file("catalog");
  fs.mkdirSync(dir, { recursive: true });
  mini(path.join(dir, "test.sqlite"));
  atomic(path.join(dir, "current.json"), {
    file: "test.sqlite",
    version: 42,
    sha256: hash(fs.readFileSync(path.join(dir, "test.sqlite"))),
  });
  return catalog;
}
test("refinements persist atomically with local edits, previews do not persist, and plans carry reasoning", async () => {
  const environment = env();
  try {
    const { store } = environment;
    const catalog = seedCatalog(store);
    const base = fixture();
    const deck = M.createDeck(base, "Draft", { folder: "Claw" });
    store.saveWorkspace({ uid: "u", base, working: structuredClone(base) });
    const input = { finding: "Need development", decision: "Test a package", actions: [{ action: "add", deck: deck.id, card: "Test Card", quantity: 20 }] };
    await mutate(store, catalog, (state) => refine(state, catalog, input), { refinement: true, dryRun: true });
    assert.equal(store.workspace().refinements, undefined);
    await assert.rejects(() => mutate(store, catalog, (state) => refine(state, catalog, { ...input, actions: [...input.actions, { action: "set", deck: deck.id, card: "Missing", quantity: 1 }] }), { refinement: true }), /not found/);
    assert.equal(store.workspace().working.tables.deck_cards.length, 0);
    await mutate(store, catalog, (state) => refine(state, catalog, input), { refinement: true });
    assert.equal(store.workspace().refinements.length, 1);
    assert.equal(store.workspace().working.tables.deck_cards[0].dc_quantity, 20);
    const prepared = await prepare(store, catalog, store.workspace());
    assert.equal(prepared.plan.refinement_review.refinements[0].decision, input.decision);
    assert.match(prepared.plan.refinement_review.brief, /Test a package/);
    assert.equal(refinementReview(store.workspace()).refinements.length, 1);
    const run = spawnSync("node", [path.resolve("bin/deckmaster.mjs"), "review", "--repo", store.repo, "--state", store.state, "--json"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).refinements.length, 1);
    assert.equal(store.workspace().refinements_reviewed, 1);
    await mutate(store, catalog, (state) => { state.tables.decks[0].d_notes = "Changed"; });
    await assert.rejects(() => apply(store, catalog, prepared.plan), /Local workspace changed/);
  } finally {
    environment.done();
  }
});
test("local CLI iteration preserves the base and companion notes, and stale checkpoint plans stop before upload", async () => {
  const environment = env();
  try {
    const catalog = seedCatalog(environment.store);
    const base = fixture();
    M.createDeck(base, "Draft", { folder: "Claw" });
    environment.store.saveWorkspace({ uid: "u", base, working: structuredClone(base) });
    materialize(environment.store, environment.store.workspace(), catalog);
    const entry = read(path.join(environment.store.library, "library.json")).decks[0];
    const brief = path.join(environment.store.library, path.dirname(entry.file), "brief.md");
    atomic(brief, "Keep the copy theme\n");
    const run = (...args) => spawnSync("node", [path.resolve("bin/deckmaster.mjs"), ...args,
      "--repo", environment.store.repo, "--state", environment.store.state, "--json"], { encoding: "utf8" });
    const renamed = run("deck", "rename", "Draft", "--name", "Working draft");
    assert.equal(renamed.status, 0, renamed.stderr);
    assert.equal(JSON.parse(renamed.stdout).status, "saved-offline");
    const added = run("card", "add", "Test Card", "--deck", "Working draft");
    assert.equal(added.status, 0, added.stderr);
    assert.equal(JSON.parse(added.stdout).status, "saved-offline");
    const shown = run("deck", "show", "Working draft");
    assert.equal(shown.status, 0, shown.stderr);
    assert.equal(JSON.parse(shown.stdout).cards.length, 1);
    assert.equal(fs.readFileSync(brief, "utf8"), "Keep the copy theme\n");
    assert.equal(digest(environment.store.workspace().base), digest(base));
    assert.equal(environment.store.receipts().length, 0);
    const checkpoint = await prepare(environment.store, catalog, environment.store.workspace());
    await mutate(environment.store, catalog, (state) => { state.tables.decks[0].d_notes = "Another iteration"; });
    await assert.rejects(() => apply(environment.store, catalog, checkpoint.plan), /Local workspace changed/);
    const deletion = run("deck", "delete", "Working draft", "--confirm-delete", "Working draft");
    assert.equal(deletion.status, 0, deletion.stderr);
    await assert.rejects(() => prepare(environment.store, catalog, environment.store.workspace()), /delet/i);
    const deletionPlan = await prepare(environment.store, catalog, environment.store.workspace(), { allowDelete: true });
    assert.equal(deletionPlan.plan.allow_delete, true);
    assert.equal(fs.readFileSync(brief, "utf8"), "Keep the copy theme\n");
  } finally {
    environment.done();
  }
});
test("compressed snapshots deduplicate graph state, retain history, detect tampering and keep private permissions", () => {
  const e = env();
  try {
    const a = fixture(),
      id = e.store.backup(a),
      next = { ...a, captured_at: "later" };
    assert.equal(e.store.backup(next), id);
    assert.equal(e.store.snapshots().length, 1);
    M.createDeck(next, "One", { folder: "/" });
    const other = e.store.backup(next);
    assert.notEqual(id, other);
    assert.equal(e.store.snapshots().length, 2);
    assert.equal(e.store.snapshot(id).tables.decks.length, 0);
    assert.equal(
      fs.statSync(path.join(e.store.home, "snapshots", id + ".json.gz")).mode &
        0o077,
      0,
    );
    fs.writeFileSync(
      path.join(e.store.home, "snapshots", other + ".json.gz"),
      "bad",
    );
    assert.throws(() => e.store.snapshot(other));
  } finally {
    e.done();
  }
});
test("process lock excludes active writers and recovers a dead same-host lock without discarding evidence", async () => {
  const e = env();
  try {
    await e.store.lock(async () => {
      await assert.rejects(() => e.store.lock(async () => {}), /holds/);
    });
    atomic(e.store.file("client.lock"), {
      pid: 2147483647,
      host: os.hostname(),
      token: "dead",
    });
    let ran = false;
    await e.store.lock(async () => {
      ran = true;
    });
    assert.equal(ran, true);
    assert(
      fs
        .readdirSync(e.store.state)
        .some((f) => f.startsWith("client.lock.stale-")),
    );
  } finally {
    e.done();
  }
});
test("catalog update repairs a missing/corrupt catalog, validates real metadata, preserves old pointer on failed refresh", async () => {
  const e = env();
  try {
    const c = seedCatalog(e.store);
    atomic(e.store.file("bin", "sqlcipher"), "placeholder");
    const bytes = fs.readFileSync(e.store.file("catalog", "test.sqlite"));
    const manifest = {
      cards: {
        versions: [{ version: 12, path: "cards/12/cards_42.db?42_abc" }],
      },
      cardsPatches: { schemaVersion: 12, lastDataVersion: 42 },
    };
    let downloads = 0;
    const fetcher = async (url, opts) => {
      if (opts?.binary) {
        downloads++;
        return bytes;
      }
      return manifest;
    };
    const decryptor = (_b, _s, t) => {
      fs.writeFileSync(t, bytes);
      return 42;
    };
    await c.ensure({ fetcher, decryptor });
    assert.equal(downloads, 0);
    fs.writeFileSync(c.current().path, "corrupt");
    const fixed = await c.ensure({ fetcher, decryptor });
    assert.equal(fixed.updated, true);
    assert.equal(downloads, 1);
    assert.equal(c.resolve("Test Card").cv_id, 123);
    fs.writeFileSync(c.current().path, "corrupt hashed catalog");
    await c.ensure({ fetcher, decryptor });
    assert.equal(c.resolve("Test Card").cv_id, 123);
    assert(fs.readdirSync(c.dir).some((f) => f.includes(".corrupt-")));
    const before = read(c.pointer);
    await assert.rejects(
      () => c.ensure({ force: true, fetcher, decryptor: () => 43 }),
      /does not match/,
    );
    assert.deepEqual(read(c.pointer), before);
    await assert.rejects(
      () =>
        c.ensure({
          fetcher: async () => ({
            cards: { versions: [] },
            cardsPatches: { schemaVersion: 13 },
          }),
        }),
      /Unsupported/,
    );
  } finally {
    e.done();
  }
});
test("library round trip preserves unknown raw fields and exact finishes/proxies/tags; hand edits reject mismatched names or references", () => {
  const e = env();
  try {
    const catalog = seedCatalog(e.store),
      s = fixture(),
      d = M.createDeck(s, "Deck", { folder: "Claw" }),
      c = M.addCard(s, d, 123, 2),
      t = M.createTag(s, "Ramp");
    M.tagCard(s, c, t.id);
    d.unknown = "preserved";
    const w = { uid: "u", base: structuredClone(s), working: s };
    materialize(e.store, w, catalog);
    let next = ingest(e.store, w, catalog);
    assert.equal(M.diff(w.working, next.working).length, 0);
    const manifest = read(path.join(e.store.library, "library.json")),
      file = path.join(e.store.library, manifest.decks[0].file),
      doc = read(file);
    doc.cards[0].quantity = 4;
    atomic(file, doc);
    next = ingest(e.store, w, catalog);
    assert.equal(next.working.tables.deck_cards[0].dc_quantity, 4);
    assert.equal(next.working.tables.decks[0].unknown, "preserved");
    assert.equal(next.working.tables.deck_card_tags_rel.length, 1);
    doc.cards[0].name = "Typo";
    atomic(file, doc);
    assert.throws(() => ingest(e.store, w, catalog), /mismatch/);
    assert.deepEqual(
      parseList("# commander\n1 Test Card\n# main\n3 Island").map(
        (r) => r.board,
      ),
      [2, 0],
    );
    assert.throws(() => parseList("Island"), /quantity/);
  } finally {
    e.done();
  }
});
async function sender(e, { post, changeAfter = false } = {}) {
  const base = fixture(),
    next = structuredClone(base);
  M.createDeck(next, "New", { folder: "/" });
  const plan = M.compilePlan(base, next),
    db = await openDB(path.join(e.tmp, "queue-" + Math.random() + ".sqlite"));
  const catalog = { ensure: async () => ({ version: 42 }), lookup: () => ({}) };
  let reads = 0;
  const read = async (_store, { hold = false } = {}) => {
    reads++;
    if (hold) return { s: structuredClone(base), db, close: async () => {} };
    const s = structuredClone(next);
    if (changeAfter) s.tables.decks[0].d_notes = "Unexpected";
    return s;
  };
  return {
    base,
    next,
    plan,
    db,
    catalog,
    read,
    getReads: () => reads,
    post: post ?? (async () => ({ http_status: 200, body: null })),
  };
}
test("writes require fresh graph preconditions, durable receipts, independent verification; no blind retry on timeout", async () => {
  const e = env();
  let x;
  try {
    x = await sender(e);
    const r = await sendPlan(e.store, x.catalog, x.plan, {
      read: x.read,
      post: x.post,
    });
    assert.equal(r.status, "verified");
    assert.equal(x.getReads(), 2);
    assert.equal(e.store.receipts()[0].attempts.length, 1);
    const y = await sender(e, {
      post: async () => {
        throw Error("timeout");
      },
    });
    try {
      await assert.rejects(
        () =>
          sendPlan(e.store, y.catalog, y.plan, { read: y.read, post: y.post }),
        /timeout/,
      );
      assert.equal(unresolved(e.store).length, 1);
      await assert.rejects(
        () =>
          sendPlan(e.store, y.catalog, y.plan, { read: y.read, post: y.post }),
        /reconciliation/,
      );
    } finally {
      await y.db.close();
    }
  } finally {
    await x?.db.close();
    e.done();
  }
});

test("verified publication archives decisions once and clears active state; rejected publication retains it", async () => {
  const environment = env();
  let scenario;
  try {
    scenario = await sender(environment);
    const catalog = seedCatalog(environment.store);
    catalog.ensure = async () => ({ version: 42 });
    const workspace = { uid: "u", base: scenario.base, working: scenario.next, refinement_pass_id: "pass", refinements: [{ id: "decision", finding: "Need a branch", decision: "Create the experiment", reason: "Test direction", alternatives: "Keep prior", tradeoffs: "Separate list", checks: "Test fixture", actions: [{ deck: scenario.next.tables.decks[0].id }], before: digest(scenario.base), after: digest(scenario.next), changes: scenario.plan.operations, warnings: [] }] };
    environment.store.saveWorkspace(workspace);
    const prepared = await prepare(environment.store, catalog, workspace);
    await assert.rejects(() => apply(environment.store, catalog, prepared.plan, { read: scenario.read, post: async () => { throw Error("test failure"); } }), /test failure/);
    assert.equal(environment.store.workspace().refinements.length, 1);
  } finally {
    await scenario?.db.close();
    environment.done();
  }
  const success = env();
  let scenarioSuccess;
  try {
    scenarioSuccess = await sender(success);
    const catalog = seedCatalog(success.store);
    catalog.ensure = async () => ({ version: 42 });
    const workspace = { uid: "u", base: scenarioSuccess.base, working: scenarioSuccess.next, refinement_pass_id: "pass", refinements: [{ id: "decision", decision: "New branch", actions: [{ deck: scenarioSuccess.next.tables.decks[0].id }], before: digest(scenarioSuccess.base), after: digest(scenarioSuccess.next), changes: scenarioSuccess.plan.operations, warnings: [] }] };
    success.store.saveWorkspace(workspace);
    const prepared = await prepare(success.store, catalog, workspace);
    const result = await apply(success.store, catalog, prepared.plan, { read: scenarioSuccess.read, post: scenarioSuccess.post });
    assert.equal(result.status, "verified");
    assert.equal(result.refinement_review.refinements.length, 1);
    assert.equal(success.store.workspace().refinements, undefined);
    assert.equal(success.store.workspace().refinement_history.length, 1);
    assert.equal(success.store.workspace().refinement_history[0].receipt, result.receipt);
  } finally {
    await scenarioSuccess?.db.close();
    success.done();
  }
});

test("a retain-only decision pass finalizes only after an independent read and keeps history", async () => {
  const environment = env();
  try {
    const catalog = seedCatalog(environment.store);
    const base = fixture();
    const deck = M.createDeck(base, "Draft", { folder: "Claw" });
    environment.store.saveWorkspace({ uid: "u", base, working: structuredClone(base) });
    await mutate(environment.store, catalog, (state) => refine(state, catalog, { decision: "Keep current package", actions: [] }), { refinement: true });
    const prepared = await prepare(environment.store, catalog, environment.store.workspace());
    assert.equal(prepared.plan.operations.length, 0);
    let reads = 0;
    const result = await apply(environment.store, catalog, prepared.plan, { read: async () => { reads++; return base; } });
    assert.equal(reads, 1);
    assert.equal(result.status, "verified");
    assert.equal(environment.store.workspace().refinement_history.length, 1);
    assert.equal(environment.store.workspace().refinements, undefined);
  } finally {
    environment.done();
  }
});

test("isolated CLI lab: three decks, package CRUD, self-review, continued iteration and history", async () => {
  const environment = env();
  try {
    const { store } = environment;
    const catalog = seedCatalog(store);
    const base = fixture();
    const decks = ["Forest Story", "Machine Story", "Mechanical Experiment"].map((name) => M.createDeck(base, name, { folder: "Claw" }));
    store.saveWorkspace({ uid: "u", base, working: structuredClone(base) });
    const run = (...args) => {
      const result = spawnSync("node", [path.resolve("bin/deckmaster.mjs"), ...args, "--repo", store.repo, "--state", store.state, "--json"], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const file = path.join(environment.tmp, "package.json");
    const input = { finding: "Support is inconsistent", decision: "Add reliable support", reason: "Fits each deck without changing its story", alternatives: "Keep conditional support", tradeoffs: "Lower ceiling", checks: "Synthetic fixture; no gameplay validation", actions: decks.map((deck) => ({ action: "add", deck: deck.id, card: "Test Card", quantity: 20 })) };
    atomic(file, input);
    const first = run("refine", "--file", file).refinement.id;
    atomic(file, { ...input, decision: "Ten slots suffice", actions: input.actions.map((action) => ({ ...action, quantity: 10 })) });
    run("refine", "--update", first, "--file", file);
    assert(store.workspace().working.tables.deck_cards.every((card) => card.dc_quantity === 10));
    const signed = run("review", "--reason", "The combined package is neutral in each story; the lower ceiling is acceptable. These are not tested decks.");
    assert.equal(signed.self_review.current, true);
    atomic(file, { ...input, decision: "Retain the reduced support", decks: decks.map((deck) => deck.id), actions: [] });
    run("refine", "--file", file);
    assert.equal(run("review").self_review.current, false);
    run("refine", "--delete", first);
    assert.equal(store.workspace().working.tables.deck_cards.length, 0);
    const review = run("review", "--reason", "The original addition did not serve the stories; retain the starting lists pending better alternatives.");
    assert.equal(review.refinements.length, 1);
    const prepared = await prepare(store, catalog, store.workspace());
    const result = await apply(store, catalog, prepared.plan, { read: async () => structuredClone(store.workspace().working), post: async () => ({ http_status: 200, body: null }) });
    assert.equal(result.status, "verified");
    assert.match(result.delivery_brief, /Overall review:/);
    assert.match(result.delivery_brief, /Retain the reduced support/);
    assert.equal(store.workspace().refinements, undefined);
    assert.equal(run("review", "--history", "--deck", decks[2].id).length, 1);
  } finally {
    environment.done();
  }
});
test("verification detects unexpected target changes and prevents subsequent writes", async () => {
  const e = env();
  let x;
  try {
    x = await sender(e, { changeAfter: true });
    await assert.rejects(
      () =>
        sendPlan(e.store, x.catalog, x.plan, { read: x.read, post: x.post }),
      /verification-failed/,
    );
    assert.equal(unresolved(e.store).length, 1);
  } finally {
    await x?.db.close();
    e.done();
  }
});
test("stale plans never reach upload; catalog outdated rejection retries only after zero-change proof and refresh", async () => {
  const e = env();
  let x;
  try {
    x = await sender(e);
    const stale = { ...x.plan, base_digest: "bad" };
    let posts = 0;
    await assert.rejects(
      () =>
        sendPlan(e.store, x.catalog, stale, {
          read: x.read,
          post: async () => {
            posts++;
          },
        }),
      /Cloud changed/,
    );
    assert.equal(posts, 0);
    let current = x.base,
      refresh = 0;
    x.catalog.ensure = async ({ force } = {}) => {
      if (force) refresh++;
      return { version: 42 + refresh };
    };
    const read = async (_s, { hold = false } = {}) =>
      hold ? { s: x.base, db: x.db, close: async () => {} } : current;
    const post = async () => {
      posts++;
      if (posts === 1)
        return { http_status: 400, body: { reason: "outdated_db" } };
      current = x.next;
      return { http_status: 200, body: null };
    };
    const r = await sendPlan(e.store, x.catalog, x.plan, { read, post });
    assert.equal(r.status, "verified");
    assert.equal(posts, 2);
    assert.equal(refresh, 1);
    assert.equal(e.store.receipts()[0].attempts.length, 2);
  } finally {
    await x?.db.close();
    e.done();
  }
});
test("rate-limited uploads are not retried and retain retry-after plus rejection evidence", async () => {
  const e = env();
  let x;
  try {
    x = await sender(e);
    let posts = 0;
    const read = async (_s, { hold = false } = {}) =>
      hold ? { s: x.base, db: x.db, close: async () => {} } : x.base;
    await assert.rejects(
      () =>
        sendPlan(e.store, x.catalog, x.plan, {
          read,
          post: async () => {
            posts++;
            return {
              http_status: 429,
              body: { reason: "rate_limit" },
              retry_after: "60",
            };
          },
        }),
      /rate limit/,
    );
    assert.equal(posts, 1);
    assert.equal(e.store.receipts()[0].status, "rejected");
  } finally {
    await x?.db.close();
    e.done();
  }
});

test("malformed private sessions produce a safe login error without exposing file contents", () => {
  const e = env();
  try {
    atomic(e.store.file("session.json"), "SENSITIVE_TEST_MARKER invalid json");
    assert.throws(
      () => e.store.account,
      (error) =>
        error.message.includes("Private session") &&
        !error.message.includes("SENSITIVE_TEST_MARKER"),
    );
  } finally {
    e.done();
  }
});
