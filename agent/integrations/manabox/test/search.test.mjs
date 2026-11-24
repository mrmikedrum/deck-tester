import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("Scryfall views preserve facts and coverage while inspecting saved results without fetching", () => {
  const result = spawnSync("python3", ["-m", "unittest", "discover", "-s", "python", "-p", "test_search.py"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
