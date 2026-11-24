import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { Store, atomic } from "../lib/store.mjs";
import { sendPlan } from "../lib/cloud.mjs";

test("active ManaBox cooldown is read from disk and blocks network callbacks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckmaster-cooldown-regression-"));
  try {
    const store = new Store({ state: dir, repo: dir });
    atomic(store.file("session.json"), { uid: "test-user" });
    atomic(store.file("upload-cooldown.json"), { until: Date.now() + 60000 });
    let reads = 0;
    const plan = { version: 1, uid: "test-user", operations: [] };
    await assert.rejects(
      () =>
        sendPlan(store, {}, plan, {
          read: async () => {
            reads++;
            return {};
          },
        }),
      /ManaBox requested a cooldown/,
    );
    assert.equal(reads, 0);
    atomic(store.file("upload-cooldown.json"), { until: Date.now() - 1 });
    assert.deepEqual(
      await sendPlan(store, {}, plan, {
        read: async () => {
          reads++;
          return {};
        },
      }),
      { status: "no-changes" },
    );
    assert.equal(reads, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("read-only compatibility inspector detects identity, correction, finish and shape changes (5 Python tests)", () => {
  const result = spawnSync(
    "python3",
    [
      "-m",
      "unittest",
      "discover",
      "-s",
      "compatibility",
      "-p",
      "test_inspect.py",
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
