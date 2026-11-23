// Record one live state as video: node tools/record.js <state> <outbase> [seconds]
const path = require("path"), { STATES, CARDS, BASE } = require("./shoot.js");
const pw = require(process.env.PW || "playwright");
const [state = "threat", out = "shots/after/threat", secs = "7"] = process.argv.slice(2);
(async () => {
  const s = STATES[state];
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true, recordVideo: { dir: path.dirname(out), size: { width: 1180, height: 820 } } });
  const p = await ctx.newPage(); const errors = [];
  p.on("pageerror", e => errors.push(String(e)));
  await p.route("**/api/**", async route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/api/view")) { if (u.searchParams.get("v") === "0") return route.fulfill({ json: { v: s.v, state: s.state, view: s.view, decision: s.decision } }); return; }
    if (u.pathname.endsWith("/api/cards")) { const o = {}; u.searchParams.getAll("n").forEach(n => CARDS[n] && (o[n] = CARDS[n])); return route.fulfill({ json: o }); }
    return route.fulfill({ json: { ok: true } });
  });
  await p.goto(BASE + "live.html");
  await p.waitForFunction(() => window.__h && window.Live && window.Live.snap && window.Live.snap.view, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  for (const pk of s.after || []) { await p.evaluate(pk => window.SeatHooks.tap(pk), pk); await p.waitForTimeout(450); }
  for (const st of s.steps || []) { await p.waitForTimeout(1800); await p.evaluate(st => window.Live.take({ v: st.v, state: "playing", view: st.view, decision: st.decision }), st); }
  await p.waitForTimeout(+secs * 1000);
  await p.screenshot({ path: out + ".png" });
  const v = p.video(); await ctx.close();
  const file = await v.path(); require("fs").renameSync(file, out + ".webm");
  console.log(errors.length ? "errors: " + errors.join(" | ") : "ok", out + ".webm");
  await browser.close();
})();
