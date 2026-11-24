import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("Google callback rejects wrong origin/nonce; refresh rotates tokens and rejects account mismatch (3 Python tests)", () => {
  const result = spawnSync(
    "python3",
    ["-m", "unittest", "discover", "-s", "python", "-p", "test_auth.py"],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
