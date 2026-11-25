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

/** Keep a bench run as a file; its name relative to the repository (the bench page shows it). */
function keepBench(dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let name = `bench-${stamp}.json`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `bench-${stamp}-${n}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(body, null, 1) + "\n");
  const old = fs.readdirSync(dir).filter((f) => /^bench-.*\.json$/.test(f)).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t);
  for (const { f } of old.slice(0, Math.max(0, old.length - KEEP))) fs.unlinkSync(path.join(dir, f));
  return `.deckmaster/bench/${name}`;
}

function postBench(req, res, dir) {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > 256 * 1024) req.destroy();
    else chunks.push(c);
  });
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      body = null;
    }
    const json = (status, x) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(x)));
    if (!body || typeof body !== "object" || !Array.isArray(body.rows)) return json(400, { ok: false, error: "expected the bench page's results: {rows: [...], ...}" });
    json(200, { ok: true, file: keepBench(dir, body) });
  });
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".webmanifest": "application/manifest+json" };
function serve(port = 0, { dist = false, lan = false, benchDir = BENCH } = {}) {
  const ROOT = dist ? DIST : SOURCE, INDEX = dist ? "index.html" : "live.html";
  if (dist && !fs.existsSync(path.join(DIST, "index.html"))) throw new Error("no built entry in client/dist: run `npx vite build` in game/");
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && new URL(req.url, "http://x").pathname.replace(/^\/next/, "") === "/api/bench") return postBench(req, res, benchDir);
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname), cached = rel.startsWith("/cache/"), root = cached ? CACHE : ROOT;
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
