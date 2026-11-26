// A static server for client/, for the tools: concurrent and with a deep accept queue, so several browsers can load
// the client at once. Card images (cache/) come from the game server's cache, .deckmaster/cache/cards/; a fresh checkout
// fills it with `bin/deckmaster game --fill-cache`. serve() resolves to its base URL; `node tools/serve.js [port]` runs it.
// serve(port, { dist: true }) serves the built new entry (client/dist, `vite build`) instead, at index.html; `--dist` on
// the command line. Card images may be cached by the browser (they never change), so a page can preload them.
// { lan: true } (`--lan`) listens on every interface, so a tablet on the network can open the workbench's bench page
// (workbench.html?only=bench, from --dist) without the game server; POST /api/bench keeps its results as a file under
// .deckmaster/bench/ (the newest 20), as the game server does.
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path");
const SOURCE = path.join(__dirname, "../client"), DIST = path.join(SOURCE, "dist"), CACHE = path.join(__dirname, "../../.deckmaster/cache/cards");
const BENCH = path.join(__dirname, "../../.deckmaster/bench"), KEEP = 20;

const BENCH_CAP = 256 * 1024, BENCH_ROWS = 64;
/** The bench page's fields (bench.ts `last`); anything else a request carries is not kept. */
const BENCH_FIELDS = ["userAgent", "screen", "viewport", "clockResolutionMs", "plansPerInput", "budgetMs", "rows"];

/** The run as stored (compact JSON, the page's fields only), or why it is refused. */
function benchRecord(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.rows) || body.rows.length > BENCH_ROWS || !body.rows.every((r) => r && typeof r === "object" && !Array.isArray(r)))
    return { error: `expected the bench page's results: {rows: [...] (at most ${BENCH_ROWS}), ...}` };
  const text = JSON.stringify(Object.fromEntries(BENCH_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]))) + "\n";
  return Buffer.byteLength(text) > BENCH_CAP ? { error: "too large" } : { text };   // the file as kept, newline and all
}

/** Keep a bench run as a file; its name relative to the repository (the bench page shows it). Old runs past KEEP go. */
function keepBench(dir, text) {
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  for (let n = 1; ; n++) {
    const name = n === 1 ? `bench-${stamp}.json` : `bench-${stamp}-${n}.json`;
    try {
      fs.writeFileSync(path.join(dir, name), text, { flag: "wx" });   // never over another run
    } catch (e) {
      if (e.code === "EEXIST") continue;
      throw e;
    }
    // Pruning is housekeeping: a file that went meanwhile, or one that will not go, does not fail the run kept.
    const age = (f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return -1; } };
    const old = fs.readdirSync(dir).filter((f) => /^bench-.*\.json$/.test(f)).map((f) => ({ f, t: age(f) })).sort((a, b) => a.t - b.t);
    for (const { f } of old.slice(0, Math.max(0, old.length - KEEP))) fs.rm(path.join(dir, f), { force: true }, () => {});
    return `.deckmaster/bench/${name}`;
  }
}

/** POST /api/bench: every request is answered (a refusal or a failure to keep it says why); none takes the server down. */
function postBench(req, res, dir) {
  const json = (status, x) => {
    if (res.headersSent) return;
    res.writeHead(status, { "Content-Type": "application/json", ...(status === 413 ? { Connection: "close" } : {}) });
    res.end(JSON.stringify(x));
  };
  let size = 0, over = false;
  const chunks = [];
  req.on("error", () => {});
  req.on("data", (c) => {
    if (over) return;
    size += c.length;
    if (size > BENCH_CAP) {
      over = true;
      chunks.length = 0;
      json(413, { ok: false, error: "too large" });
      req.resume();
    } else chunks.push(c);
  });
  req.on("end", () => {
    if (over) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return json(400, { ok: false, error: "not JSON" });
    }
    let r;
    try {
      r = benchRecord(body);
    } catch {
      r = { error: "not a bench run" };   // a structure too deep to serialize
    }
    if (r.error) return json(r.error === "too large" ? 413 : 400, { ok: false, error: r.error });
    try {
      json(200, { ok: true, file: keepBench(dir, r.text) });
    } catch (e) {
      json(500, { ok: false, error: `not kept: ${e.code || e.message}` });
    }
  });
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".webmanifest": "application/manifest+json" };
function serve(port = 0, { dist = false, lan = false, benchDir = BENCH } = {}) {
  const ROOT = dist ? DIST : SOURCE, INDEX = dist ? "index.html" : "live.html";
  if (dist && !fs.existsSync(path.join(DIST, "index.html"))) throw new Error("no built entry in client/dist: run `npx vite build` in game/");
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && new URL(req.url, "http://x").pathname.replace(/^\/next/, "") === "/api/bench") return postBench(req, res, benchDir);
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    const cached = rel.startsWith("/cache/"), root = cached ? CACHE : ROOT;
    const file = cached ? path.join(CACHE, rel.slice("/cache/".length)) : path.join(ROOT, rel.endsWith("/") ? rel + INDEX : rel);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": cached ? "max-age=86400" : "no-store" });
      res.end(buf);
    });
  });
  return new Promise(ok => server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", 511, () => ok({ base: `http://127.0.0.1:${server.address().port}/`, server })));
}

/** This machine's addresses on the network, for a tablet to type. */
const lanAddresses = () => Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
module.exports = { serve };
if (require.main === module) {
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
  const dist = flags.has("--dist"), lan = flags.has("--lan"), port = +process.argv.slice(2).filter((a) => !a.startsWith("--"))[0] || 8797;
  serve(port, { dist, lan }).then(({ base, server }) => {
    console.log(`serving client/${dist ? "dist/" : ""} at ${base}`);
    if (lan) for (const a of lanAddresses()) console.log(`  on the network: http://${a}:${server.address().port}/${dist ? "workbench.html?only=bench" : ""}`);
  });
}
