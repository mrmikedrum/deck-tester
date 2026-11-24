// A browser kept open on the live board (a running `bin/deckmaster game`), driven over HTTP:
//   GAME=http://localhost:8765/ node game/tools/pilot.js [webkit|chromium] [port]
//   GET /shot?name=x   screenshot to .deckmaster/shots/live-x.png     POST /eval  body: JS expression, returns JSON
//   GET /tap?x=&y=     a touch tap                           GET /drag?x1=&y1=&x2=&y2=   a pointer drag
//   GET /errors        page errors so far
const pw = require("playwright"), http = require("http");
(async () => {
  const [eng = "webkit", port = "9333"] = process.argv.slice(2);
  const browser = await pw[eng].launch(eng === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true })).newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.stack || e)));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
  await page.goto((process.env.GAME || "http://localhost:8765/") + "live.html");
  http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), q = Object.fromEntries(u.searchParams);
    let body = ""; req.on("data", c => (body += c)); await new Promise(r => req.on("end", r));
    try {
      let out = null;
      if (u.pathname === "/shot") { await page.waitForTimeout(+(q.wait || 700)); await page.screenshot({ path: `${__dirname}/../../.deckmaster/shots/live-${q.name || "x"}.png` }); out = "ok"; }
      else if (u.pathname === "/eval") out = await page.evaluate(body);
      else if (u.pathname === "/tap") { await page.mouse.move(+q.x, +q.y); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); out = "ok"; }
      else if (u.pathname === "/drag") {
        await page.mouse.move(+q.x1, +q.y1); await page.mouse.down();
        for (let i = 1; i <= 12; i++) { await page.mouse.move(+q.x1 + (q.x2 - q.x1) * i / 12, +q.y1 + (q.y2 - q.y1) * i / 12); await page.waitForTimeout(16); }
        await page.mouse.up(); out = "ok";
      }
      else if (u.pathname === "/errors") out = errors.splice(0);
      else if (u.pathname === "/reload") { await page.reload(); out = "ok"; }
      res.end(JSON.stringify(out));
    } catch (e) { res.statusCode = 500; res.end(JSON.stringify(String(e))); }
  }).listen(+port, "127.0.0.1");
  console.log("pilot on", port);
})();
