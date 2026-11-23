// A static server for client/, for the tools: concurrent and with a deep accept queue, so several browsers can load
// the client at once. serve() resolves to its base URL; `node tools/serve.js [port]` runs it on its own.
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "../client");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
function serve(port = 0) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname), file = path.join(ROOT, rel.endsWith("/") ? rel + "index.html" : rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(buf);
    });
  });
  return new Promise(ok => server.listen(port, "127.0.0.1", 511, () => ok({ base: `http://127.0.0.1:${server.address().port}/`, server })));
}
module.exports = { serve };
if (require.main === module) serve(+process.argv[2] || 8797).then(({ base }) => console.log("serving client/ at " + base));
