// An evaluation loop for Seat's transitions: drives the board through focus changes, scenario changes and stack
// changes, and measures what a person would see as stutter, resets or flicker, without a person watching.
//   node tools/eval.js [outdir] [webkit|chromium]
// Serve client/ on :8797 first. Writes <outdir>/eval.json and <outdir>/eval.md, plus a strip of frames per transition.
//
// Checks:
//   rebuilds   how many pieces were built vs reused on each redraw (a redraw that rebuilds everything restarts effects)
//   identity   the same three.js objects survive a redraw when nothing about them changed
//   frames     frame-time p50/p95 during a transition (software rendering here; relative, not absolute)
//   flicker    mean absolute pixel difference between consecutive captures; a spike is a jump cut
//   leaks      scene object, geometry and texture counts before and after a sequence (should return to baseline)
const fs = require("fs"), path = require("path");
const { STATES, CARDS, BASE } = require("./shoot.js");
const pw = require(process.env.PW || "playwright");
const [outDir = "shots/eval", eng = "webkit"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

// Pixel difference between two screenshots, as a mean over a downsampled grid (no PNG decoder needed: raw via jpeg? we use png buffers through the page).
async function diffScore(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = 118, h = 82, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const x = cv.getContext("2d", { willReadFrequently: true });
    x.drawImage(ia, 0, 0, w, h); const da = x.getImageData(0, 0, w, h).data;
    x.drawImage(ib, 0, 0, w, h); const db = x.getImageData(0, 0, w, h).data;
    let s = 0; for (let i = 0; i < da.length; i += 4) s += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    return s / (da.length / 4) / 3;
  }, [a.toString("base64"), b.toString("base64")]);
}
const pct = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

const FRAME_HOOK = () => {
  window.__frames = []; let last = performance.now();
  const loop = t => { window.__frames.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
};
const COUNTS = () => {
  const h = window.__h, r = h.renderer(); let objs = 0; h.scene.traverse(() => objs++);
  return { objects: objs, geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs.length };
};
const IDS = () => Object.fromEntries(Object.entries(window.__h.pieces()).map(([k, pc]) => [k, pc.obj.uuid]));

// Run one transition: snapshot stats, fire it, capture frames for `ms`, snapshot again.
async function transition(page, name, fire, ms = 1400, every = 100) {
  const before = await page.evaluate(COUNTS), idsBefore = await page.evaluate(IDS), statsBefore = await page.evaluate(() => ({ ...window.__h.stats }));
  await page.evaluate(() => (window.__frames = []));
  const err = await page.evaluate(`(() => { try { ${fire}; return null; } catch (e) { return e.stack || String(e); } })()`);
  if (err) console.log("transition " + name + " threw: " + err);
  const shots = []; const t0 = Date.now();
  const times = [];
  while (Date.now() - t0 < ms) { shots.push(await page.screenshot({ type: "png" })); times.push(Date.now() - t0); await page.waitForTimeout(every); }
  const frames = await page.evaluate(() => window.__frames.slice());
  const after = await page.evaluate(COUNTS), idsAfter = await page.evaluate(IDS), statsAfter = await page.evaluate(() => ({ ...window.__h.stats }));
  // Difference per 100 ms of wall clock, so a slow capture doesn't read as a jump.
  const diffs = []; for (let i = 1; i < shots.length; i++) diffs.push(await diffScore(page, shots[i - 1], shots[i]) * 100 / Math.max(50, times[i] - times[i - 1]));
  const kept = Object.keys(idsBefore).filter(k => idsAfter[k] === idsBefore[k]).length, common = Object.keys(idsBefore).filter(k => k in idsAfter).length;
  // A strip of the captures, for a person to glance at.
  await page.evaluate(async ([name, srcs]) => {
    const imgs = await Promise.all(srcs.map(s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; })));
    const w = 295, h = 205, cv = document.createElement("canvas"); cv.width = w * Math.min(8, imgs.length); cv.height = h * Math.ceil(imgs.length / 8);
    const x = cv.getContext("2d"); imgs.forEach((im, i) => x.drawImage(im, (i % 8) * w, Math.floor(i / 8) * h, w, h));
    window.__strip = cv.toDataURL("image/jpeg", 0.8);
  }, [name, shots.map(s => s.toString("base64"))]);
  const strip = await page.evaluate(() => window.__strip);
  fs.writeFileSync(path.join(outDir, `${name}.jpg`), Buffer.from(strip.split(",")[1], "base64"));
  const med = pct(diffs, 0.5), spike = diffs.length ? Math.max(...diffs) : 0;
  return {
    name, builds: statsAfter.builds - statsBefore.builds, built: statsAfter.built - statsBefore.built, reused: statsAfter.reused - statsBefore.reused,
    identity: { kept, common }, frames: { n: frames.length, p50: +pct(frames, 0.5).toFixed(1), p95: +pct(frames, 0.95).toFixed(1), max: +Math.max(0, ...frames).toFixed(1) },
    flicker: { median: +med.toFixed(2), max: +spike.toFixed(2), spike: med > 1 && spike > med * 4 },
    counts: { before, after },
  };
}

(async () => {
  const browser = await pw[eng].launch(eng === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true });
  const results = [], errors = [];
  const watch = p => { p.on("pageerror", e => errors.push(String(e))); p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    p.addInitScript(() => addEventListener("unhandledrejection", e => console.error("rejection: " + (e.reason && e.reason.stack || e.reason)))); };

  // ---- Offline: focus and scenario changes --------------------------------------------------------------------------
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE + "offline.html");
  await page.waitForFunction(() => window.__h, null, { timeout: 60000 });
  await page.evaluate(FRAME_HOOK); await page.evaluate('__h.loadScenario("late")'); await page.waitForTimeout(1500);
  const base = await page.evaluate(COUNTS);
  results.push(await transition(page, "redraw-same", '__h.refresh(0)', 800));                 // nothing changed: everything should be reused
  results.push(await transition(page, "focus-in", '__h.focusOn("ana")'));
  results.push(await transition(page, "focus-out", '__h.focusOn(null)'));
  results.push(await transition(page, "scenario-attack", '__h.loadScenario("attack")'));
  results.push(await transition(page, "scenario-defend", '__h.loadScenario("defend")'));
  results.push(await transition(page, "scenario-late", '__h.loadScenario("late")'));
  const end = await page.evaluate(COUNTS);
  results.push({ name: "leaks", counts: { before: base, after: end }, leak: end.objects - base.objects > 20 || end.geometries - base.geometries > 20 });   // textures are a cache of card faces: they grow with faces seen
  await page.close();

  // ---- Live (mocked): the stack coming and going, a decision changing ----------------------------------------------
  const p = await ctx.newPage(); watch(p);
  await p.route("**/api/**", async route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/api/view")) { if (u.searchParams.get("v") === "0") return route.fulfill({ json: { v: 1, state: "playing", view: STATES.main.view, decision: STATES.main.decision } }); return; }
    if (u.pathname.endsWith("/api/cards")) { const o = {}; u.searchParams.getAll("n").forEach(n => CARDS[n] && (o[n] = CARDS[n])); return route.fulfill({ json: o }); }
    return route.fulfill({ json: { ok: true } });
  });
  await p.goto(BASE + "live.html");
  await p.waitForFunction(() => window.__h && window.Live && window.Live.snap && window.Live.snap.view, null, { timeout: 60000 });
  await p.evaluate(FRAME_HOOK); await p.waitForTimeout(1500);
  const take = (st, v) => `window.Live.take(${JSON.stringify({ v, state: "playing", view: st.view, decision: st.decision })})`;
  results.push(await transition(p, "live-same-view", take(STATES.main, 2), 800));
  results.push(await transition(p, "live-stack-up", take(STATES.threat, 3)));
  results.push(await transition(p, "live-stack-hold", take(STATES.threat, 4), 800));          // the same stack again: spells must not restart
  results.push(await transition(p, "live-stack-down", take(STATES.main, 5)));
  results.push(await transition(p, "live-attack-decision", take(STATES.attack, 6)));
  await p.close();
  await browser.close();

  // ---- Report ----------------------------------------------------------------------------------------------------------
  const verdicts = results.map(r => {
    const bad = [];
    if (r.name === "leaks") { if (r.leak) bad.push("objects, geometries or textures grew across the run"); }
    else {
      if ((r.name === "redraw-same" || r.name === "live-same-view" || r.name === "live-stack-hold") && r.built > 0) bad.push(`${r.built} pieces rebuilt though nothing changed`);
      if (r.identity.common && r.identity.kept / r.identity.common < 0.5 && !/scenario/.test(r.name)) bad.push(`only ${r.identity.kept}/${r.identity.common} pieces kept their objects`);
      if (r.flicker.spike) bad.push(`flicker spike ${r.flicker.max} vs median ${r.flicker.median}`);
    }
    return { name: r.name, ok: !bad.length, bad };
  });
  const report = { when: new Date().toISOString(), engine: eng, results, verdicts, errors: [...new Set(errors)] };
  fs.writeFileSync(path.join(outDir, "eval.json"), JSON.stringify(report, null, 2));
  const md = ["# Seat transition eval", `${report.when} · ${eng} (software rendering: frame times are relative)`, "",
    "| transition | redraws | built | reused | objects kept | frame p50/p95 ms | flicker med/max | verdict |", "|---|---|---|---|---|---|---|---|",
    ...results.filter(r => r.name !== "leaks").map(r => { const v = verdicts.find(x => x.name === r.name); return `| ${r.name} | ${r.builds} | ${r.built} | ${r.reused} | ${r.identity.kept}/${r.identity.common} | ${r.frames.p50}/${r.frames.p95} | ${r.flicker.median}/${r.flicker.max} | ${v.ok ? "ok" : v.bad.join("; ")} |`; }),
    "", `Leaks: objects ${results.find(r => r.name === "leaks").counts.before.objects} → ${results.find(r => r.name === "leaks").counts.after.objects}, geometries ${results.find(r => r.name === "leaks").counts.before.geometries} → ${results.find(r => r.name === "leaks").counts.after.geometries}, textures (a cache) ${results.find(r => r.name === "leaks").counts.before.textures} → ${results.find(r => r.name === "leaks").counts.after.textures}: ${verdicts.find(v => v.name === "leaks").ok ? "ok" : "LEAK"}`,
    "", errors.length ? "Errors:\n" + [...new Set(errors)].map(e => "- " + e).join("\n") : "No page errors."];
  fs.writeFileSync(path.join(outDir, "eval.md"), md.join("\n") + "\n");
  console.log(md.join("\n"));
})();
