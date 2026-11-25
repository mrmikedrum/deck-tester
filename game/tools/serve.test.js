// tools/serve.js: the bench page's results come back to the serving machine as a file.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { serve } = require("./serve.js");

test("POST /api/bench keeps the run as a file and says which", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-"));
  const { base, server } = await serve(0, { benchDir: dir });
  try {
    const post = (url, body) => fetch(new URL(url, base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const r = await post("api/bench", { rows: [{ input: "dense" }], userAgent: "iPad" });
    assert.equal(r.status, 200);
    const { ok, file } = await r.json();
    assert.equal(ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, path.basename(file)), "utf8")).rows, [{ input: "dense" }]);
    assert.equal((await post("next/api/bench", { rows: [] })).status, 200);
    assert.equal((await post("api/bench", { no: "rows" })).status, 400);
    assert.equal(fs.readdirSync(dir).length, 2);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
