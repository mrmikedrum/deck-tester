// A static server for client/, for the tools: concurrent and with a deep accept queue, so several browsers can load
// the client at once. Card images (cache/) come from the game server's cache, .deckmaster/cache/cards/; a fresh checkout
// fills it with `bin/deckmaster game --fill-cache`. serve() resolves to its base URL; `node tools/serve.js [port]` runs it.
// serve(port, { dist: true }) serves the built new entry (client/dist, `vite build`) instead, at index.html; `--dist` on
// the command line. Card images may be cached by the browser (they never change), so a page can preload them.
const http = require("http"), fs = require("fs"), path = require("path");
const SOURCE = path.join(__dirname, "../client"), DIST = path.join(SOURCE, "dist"), CACHE = path.join(__dirname, "../../.deckmaster/cache/cards");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".webmanifest": "application/manifest+json" };
function serve(port = 0, { dist = false } = {}) {
  const ROOT = dist ? DIST : SOURCE, INDEX = dist ? "index.html" : "live.html";
  if (dist && !fs.existsSync(path.join(DIST, "index.html"))) throw new Error("no built entry in client/dist: run `npx vite build` in game/");
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname), cached = rel.startsWith("/cache/"), root = cached ? CACHE : ROOT;
    const file = cached ? path.join(CACHE, rel.slice("/cache/".length)) : path.join(ROOT, rel.endsWith("/") ? rel + INDEX : rel);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": cached ? "max-age=86400" : "no-store" });
      res.end(buf);
    });
  });
  return new Promise(ok => server.listen(port, "127.0.0.1", 511, () => ok({ base: `http://127.0.0.1:${server.address().port}/`, server })));
}
module.exports = { serve };
if (require.main === module) {
  const dist = process.argv.includes("--dist"), port = +process.argv.slice(2).filter(a => a !== "--dist")[0] || 8797;
  serve(port, { dist }).then(({ base }) => console.log(`serving client/${dist ? "dist/" : ""} at ${base}`));
}
