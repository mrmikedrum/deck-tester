import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveOracle, findOracle } from "../lib/card-cache.mjs";
import { facts } from "../lib/facts.mjs";
import { Store, atomic, read } from "../lib/store.mjs";
import { spawnSync } from "node:child_process";

test("Oracle cache separates printings and dynamic facts, preserves faces, and refreshes without accepting older observations", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-cache-"));
  try {
    const card = { oracle_id: "abcdefab-1234-1234-1234-123456789012", name: "Example",
      oracle_text: "Old text", prices: { usd: "100" }, legalities: { commander: "legal" },
      id: "printing", image_uris: { normal: "image" }, game_changer: true,
      card_faces: [{ name: "Back", oracle_text: "Face text", artist: "Artist", image_uris: {} }] };
    const old = new Date(Date.now() - 172800000).toISOString();
    await saveOracle(repo, card, old);
    assert.equal(findOracle(repo, "Example").retrieved_at, old);
    const saved = findOracle(repo, "EXAMPLE");
    assert.deepEqual(saved.card.card_faces, [{ name: "Back", oracle_text: "Face text" }]);
    for (const key of ["prices", "legalities", "id", "image_uris", "game_changer"]) assert.equal(saved.card[key], undefined);
    await saveOracle(repo, { ...card, oracle_text: "Errata" });
    await saveOracle(repo, card, old);
    assert.equal(findOracle(repo, "Example").card.oracle_text, "Errata");
    assert.equal(findOracle(repo, "Unknown"), null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("deck checks share the canonical cache while retaining their separate full-response cache", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-facts-"));
  try {
    const store = new Store({ repo, state: path.join(repo, "private") });
    const card = { object: "card", id: "abcdefab-1234-1234-1234-123456789013",
      oracle_id: "abcdefab-1234-1234-1234-123456789012", name: "Example", oracle_text: "Text",
      prices: { usd: "5" } };
    const result = await facts(store, [card.id], { fetcher: async () => new Response(JSON.stringify({ object: "list", data: [card] })) });
    assert.equal(result[0].card.prices.usd, "5");
    assert.equal(findOracle(repo, "Example").card.oracle_text, "Text");
    assert.equal(findOracle(repo, "Example").card.prices, undefined);
    const cacheFile = store.file("scryfall", card.id + ".json");
    atomic(cacheFile, { ...read(cacheFile), retrieved_at: "2020-01-01T00:00:00Z" });
    await facts(store, [card.id], { fetcher: () => { throw Error("Unexpected network"); } });
    let forcedRequests = 0;
    await facts(store, [card.id], { force: true, fetcher: async () => {
      forcedRequests++;
      return new Response(JSON.stringify({ object: "list", data: [card] }));
    } });
    assert.equal(forcedRequests, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Python lookup reads the same canonical cache offline without exposing printing data", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-python-"));
  try {
    const script = path.join(repo, "skills/commander-search/scripts/scryfall.py");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(path.resolve("../../skills/commander-search/scripts/scryfall.py"), script);
    const library = path.join(repo, "tools/manabox/lib");
    fs.mkdirSync(library, { recursive: true });
    for (const file of ["card-cache.mjs", "store.mjs", "account.mjs"]) fs.copyFileSync(path.resolve("lib", file), path.join(library, file));
    await saveOracle(repo, { oracle_id: "abcdefab-1234-1234-1234-123456789012", name: "Example", oracle_text: "Cached text", prices: {} }, "2020-01-01T00:00:00Z");
    const result = spawnSync("python3", [script, "named", "Example", "--offline"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "cached");
    assert.equal(output.retrieved_at, "2020-01-01T00:00:00Z");
    assert.equal(output.cards[0].prices, undefined);
    assert(output.warnings.some((warning) => warning.includes("Offline snapshot")));
    const normal = spawnSync("python3", [script, "named", "Example"], { encoding: "utf8" });
    assert.equal(normal.status, 0, normal.stderr);
    assert.equal(JSON.parse(normal.stdout).status, "cached");
    assert.equal(JSON.parse(normal.stdout).retrieved_at, "2020-01-01T00:00:00Z");
    const missing = spawnSync("python3", [script, "named", "Missing", "--offline"], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.equal(JSON.parse(missing.stdout).status, "not_found");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
