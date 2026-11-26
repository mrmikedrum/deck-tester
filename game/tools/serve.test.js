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

test("POST /api/bench answers every request and never stops serving", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-"));
  const { base, server } = await serve(0, { benchDir: dir });
  const post = (body) => fetch(new URL("api/bench", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  try {
    // too large: refused with 413, not a dropped connection
    assert.equal((await post({ rows: [{ pad: "x".repeat(300 * 1024) }] })).status, 413);
    // not JSON, the wrong shape, too many rows
    assert.equal((await post("{")).status, 400);
    assert.equal((await post({ rows: [1, 2] })).status, 400);
    assert.equal((await post({ rows: Array.from({ length: 65 }, () => ({})) })).status, 400);
    // nested past what serializes: refused, not a crash
    assert.equal((await post(`{"rows":[{"a":${"[".repeat(120000)}${"]".repeat(120000)}}]}`)).status, 400);
    // within the cap as sent, kept within it (compact, and only the page's fields)
    const rows = Array.from({ length: 60 }, (_, i) => Object.fromEntries(Array.from({ length: 400 }, (_, k) => [`k${k}`, i])));
    const r = await post({ rows, userAgent: "iPad", extra: "not kept" });
    assert.equal(r.status, 200);
    const kept = path.join(dir, path.basename((await r.json()).file));
    assert.ok(fs.statSync(kept).size <= 256 * 1024, `${fs.statSync(kept).size} bytes kept`);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(kept, "utf8"))).sort(), ["rows", "userAgent"]);
    // exactly at the cap as kept (its newline counted): kept; one byte more: refused
    const fill = (n) => ({ rows: [{ pad: "x".repeat(n) }] });
    const at = 256 * 1024 - Buffer.byteLength(JSON.stringify(fill(0))) - 1;
    const exact = await post(fill(at));
    assert.equal(exact.status, 200);
    assert.equal(fs.statSync(path.join(dir, path.basename((await exact.json()).file))).size, 256 * 1024);
    assert.equal((await post(fill(at + 1))).status, 413);
    // a folder it cannot write: 500, and the server goes on
    const blocked = await serve(0, { benchDir: path.join(dir, "file") });
    fs.writeFileSync(path.join(dir, "file"), "");
    try {
      const b = await fetch(new URL("api/bench", blocked.base), { method: "POST", body: JSON.stringify({ rows: [] }) });
      assert.equal(b.status, 500);
      assert.equal((await b.json()).ok, false);
      assert.equal((await fetch(new URL("%E0%A4%A", blocked.base))).status, 400);   // a malformed path: refused too
      assert.equal((await fetch(new URL("api/bench", blocked.base), { method: "POST", body: "{" })).status, 400);
    } finally {
      blocked.server.close();
    }
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
