import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { get, retryDelay } from "../lib/network.mjs";
import { facts, checkDeck } from "../lib/facts.mjs";
import { Store, atomic } from "../lib/store.mjs";
const bin = path.resolve("bin/deckmaster.mjs");
test("CLI rejects misspelled or misplaced options and extra positionals before doing any work", () => {
  for (const args of [
    ["deck", "create", "A", "--quanity", "2"],
    ["deck", "rename", "A", "--quantity", "2"],
    ["pull", "oops"],
  ]) {
    const r = spawnSync("node", [bin, ...args, "--json"], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert(r.stderr.includes("error"));
  }
  const help = spawnSync("node", [bin, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /local iteration; explicit push checkpoint/);
});
test("long Retry-After is respected without early retries; bounded GET retry handles transient failures", async () => {
  assert.equal(retryDelay("60"), 60000);
  assert.equal(retryDelay("Thu, 01 Jan 1970 00:01:00 GMT", 0), 60000);
  let calls = 0;
  await assert.rejects(
    () =>
      get("https://example.invalid/", {
        fetcher: async () => {
          calls++;
          return new Response("", {
            status: 429,
            headers: { "Retry-After": "60" },
          });
        },
      }),
    /No early retry/,
  );
  assert.equal(calls, 1);
  calls = 0;
  const value = await get("https://example.invalid/", {
    fetcher: async () => {
      calls++;
      return calls === 1
        ? new Response("", { status: 503 })
        : new Response('{"ok":true}', { status: 200 });
    },
  });
  assert.equal(calls, 2);
  assert.equal(value.ok, true);
});
test("Scryfall facts batch at 75, cache across calls and surface incomplete coverage as an error", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deckmaster-facts-")),
    store = new Store({ state: tmp, repo: tmp });
  try {
    const ids = Array.from(
      { length: 76 },
      (_, n) => "abcdefab-1234-1234-1234-" + String(n).padStart(12, "0"),
    );
    let calls = 0;
    const fetcher = async (url, options) => {
      calls++;
      assert.equal(url, "https://api.scryfall.com/cards/collection");
      const batch = JSON.parse(options.body).identifiers;
      assert(batch.length <= 75);
      return new Response(
        JSON.stringify({
          object: "list",
          data: batch.map(({ id }) => ({
            id,
            object: "card",
            name: "Example",
          })),
          not_found: [],
        }),
      );
    };
    const r = await facts(store, ids, { fetcher });
    assert.equal(calls, 2);
    assert.equal(r.length, 76);
    await facts(store, ids, { fetcher });
    assert.equal(calls, 2);
    await assert.rejects(
      () =>
        facts(store, [ids[0]], {
          force: true,
          fetcher: async () =>
            new Response(
              JSON.stringify({
                object: "list",
                data: [],
                not_found: [{ id: ids[0] }],
              }),
            ),
        }),
      /not returned/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
test("Scryfall 429 persists a cooldown, preventing another immediate API call", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deckmaster-cooldown-")),
    store = new Store({ state: tmp, repo: tmp });
  try {
    let calls = 0;
    const id = "abcdefab-1234-1234-1234-123456789012";
    const fetcher = async () => {
      calls++;
      return new Response("", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    };
    await assert.rejects(() => facts(store, [id], { fetcher }), /429/);
    await assert.rejects(() => facts(store, [id], { fetcher }), /cooldown/);
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
