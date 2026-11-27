// Record the built client on its scripted transport at a fixed virtual time.
//   node tools/reel.js <outdir> [clip,clip] [--quick | --stills | --motion-only] [--jobs 2] [--fps 30] [--engine chromium|webkit] [--viewport 1210x834]
// --quick records 15 fps without video. --stills records only the 2× stills and their audit. --motion-only skips them.
// --viewport is in CSS px (1180x820 by default; the iPad in landscape is 1210x834).
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const pw = require(process.env.PW || "playwright");
const { CLOCK } = require("./behaviour/clock.js");
const { locate } = require("./behaviour/locate.js");
let BASE = process.env.BASE;   // unset: serve the build ourselves (tools/serve.js), shared with the processes we start
const { TRACK, AUDIT } = require("./scene-audit.js");
const CLIPS = require("./clips.js");
const HAS_FFMPEG = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch (e) { return false; } })();   // without it, no clip.mp4
const ORIGIN = 1e6;   // the virtual time playback starts at, ms: later than any boot

const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv.splice(i, 2)[1]; };
const QUICK = argv.includes("--quick") && !!argv.splice(argv.indexOf("--quick"), 1);
const STILLS = argv.includes("--stills") && !!argv.splice(argv.indexOf("--stills"), 1);
const MOTION_ONLY = argv.includes("--motion-only") && !!argv.splice(argv.indexOf("--motion-only"), 1);
const FPS = +flag("fps", QUICK ? 15 : 30), ENG = flag("engine", "chromium"), SCALE = +flag("scale", 2), JOBS = +flag("jobs", 2);
const VIEWPORT = flag("viewport", "1180x820").split("x").map(Number);
if (VIEWPORT.length !== 2 || !VIEWPORT.every(n => Number.isInteger(n) && n > 0)) throw new Error("--viewport takes WIDTHxHEIGHT in whole CSS px, e.g. 1210x834");
const [outDir = "reels/latest", onlyArg] = argv;
const only = onlyArg ? new Set(onlyArg.split(",")) : null;

// ---- The virtual clock (behaviour/clock.js), installed before any page script ------------------------------------------
// It runs in real time until __clock.freeze(ORIGIN), so boot, fetches and art loading work normally; after that nothing
// advances except through __clock.step(ms).

async function open(ctx, clip) {
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", e => errors.push(String(e)));
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const scenario = { catalog: clip.catalog, envelopes: [clip.first], reply: { t: "queued" } };
  await p.route("**/script.json", route => route.fulfill({ json: scenario }));
  await p.route("**/api/**", route => route.fulfill({ status: 404, json: {} }));   // a scripted page asks the bridge nothing
  await p.goto(BASE + "?script=script.json");
  await p.waitForFunction(() => window.__deckmaster, null, { timeout: 60000 });
  await p.evaluate(() => window.__deckmaster.ready);
  await p.waitForFunction(() => window.__deckmaster.seats().length > 0, null, { timeout: 60000 });
  const urls = [...new Set(Object.values(clip.catalog).flatMap(e => (e.faces || []).flatMap(f => [f.art, f.img])).filter(Boolean))];
  await p.evaluate(u => window.__deckmaster.art.preload(u), urls);
  await p.waitForFunction(() => window.__deckmaster.settled(), null, { timeout: 60000, polling: 50 });
  await p.evaluate(o => window.__clock.freeze(o), ORIGIN);
  // The page was idle at the freeze, its canvas last drawn at a real time: draw the first frame at the origin.
  await p.evaluate(() => window.__deckmaster.redraw());
  return { p, errors };
}
// Advance the virtual clock once no art is loading: what a decode finishing would change shows
// at the same frame on every run.
async function step(p, ms) {
  // Polled from here: the page's own timers are on the frozen clock, so a wait polled inside the page would never look again.
  for (let t0 = Date.now(); await p.evaluate(() => window.__deckmaster.art.pending()) > 0; await new Promise(r => setTimeout(r, 10)))
    if (Date.now() - t0 > 30000) throw new Error("card art still loading after 30 s");
  return p.evaluate(ms => window.__clock.step(ms), ms);
}
// A beat injects a bridge snapshot or sends a real gesture.
async function beat(p, b) {
  if (b.push) await p.evaluate(snap => window.__deckmaster.script.push(snap), b.push);
  else await gesture(p, b.gesture);
}

// {drag: {hand: id, dy}}: a hand card dragged straight up; {tap: {card|plate|stack|pile|open: ...}}: a finger tap there;
// {key: "Escape"} presses a key. {button: name} clicks a named button. An array drains a frame between gestures.
async function gesture(p, g) {
  if (Array.isArray(g)) {
    for (const [i, one] of g.entries()) { if (i) await p.evaluate(() => window.__clock.step(0)); await gesture(p, one); }
    return;
  }
  if (g.key) await p.keyboard.press(g.key);
  else if (g.button) {
    const button = p.getByRole("button", { name: g.button, exact: true });
    await button.waitFor({ state: "visible", timeout: 3000 });
    const r = await button.boundingBox();
    await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  } else if (g.drag) {
    const from = await locate(p, { hand: g.drag.hand }), m = p.mouse;
    await m.move(from.x, from.y); await m.down();
    for (let i = 1; i <= 8; i++) await m.move(from.x, from.y - g.drag.dy * i / 8);
    await m.up();
  } else if (g.tap) {
    const at = await locate(p, g.tap);
    await p.touchscreen.tap(at.x, at.y);
  } else throw new Error("unknown gesture " + JSON.stringify(g));
}

// The motion pass, at 1×: every frame at FPS, with what moved where.
async function motion(ctx, clip, dir) {
  const { p, errors } = await open(ctx, clip), dt = 1000 / FPS, frames = Math.round(clip.ms / dt), beats = [], track = [];
  const due = clip.beats.map(b => ({ ...b, frame: Math.round(b.at / dt) }));
  for (let f = 0; f <= frames; f++) {
    for (const b of due.filter(b => b.frame === f)) {
      await beat(p, b);
      beats.push({ frame: f, ms: Math.round(f * dt), label: b.label });
    }
    await step(p, f === 0 ? 0 : dt);
    track.push({ frame: f, ms: Math.round(f * dt), ...(await p.evaluate(TRACK)) });
    await p.screenshot({ path: path.join(dir, "frames", String(f).padStart(3, "0") + ".jpg"), type: "jpeg", quality: 88 });
  }
  await p.close();
  return { beats, track, errors, frames };
}

// The stills pass, at the iPad's 2×: the same beats at the same virtual times, stepped coarsely (nothing is
// captured between), and at each settled moment a full-resolution still, the audit and the scene's measurements.
// An audit is on the frame before each beat (and the last frame), for the state the beat before left: the start and
// every beat marked `audit`; other beats get the still only.
async function stills(ctx, clip, dir, frames, gated = true) {
  const { p, errors } = await open(ctx, clip), dt = 1000 / FPS;
  const due = clip.beats.map(b => ({ ...b, frame: Math.round(b.at / dt) })), at = [];
  due.forEach((b, i) => {
    const settled = (i + 1 < due.length ? due[i + 1].frame : frames + 1) - 1;
    at.push({ t: Math.max(0, (b.frame - 1) * dt), beat: b });
    at.push({ t: settled * dt, audit: settled, gate: gated && b.audit !== false, label: b.label });
  });
  if (due.length && due[0].frame > 1) at.push({ t: (due[0].frame - 1) * dt, audit: due[0].frame - 1, gate: gated, label: "start" });
  at.sort((a, b) => a.t - b.t || (a.audit != null ? -1 : 1));
  const audits = []; let now = 0;
  await step(p, 0);
  for (const e of at) {
    while (now < e.t - 0.01) { const s = Math.min(100, e.t - now); await step(p, s); now += s; }
    if (e.beat) { await beat(p, e.beat); continue; }
    const name = `still-${String(e.audit).padStart(3, "0")}.png`;
    audits.push({ frame: e.audit, label: e.label, gate: e.gate, objects: (await p.evaluate(TRACK)).objects, ...(e.gate ? await p.evaluate(AUDIT, 4) : { pieces: {} }) });
    await p.screenshot({ path: path.join(dir, name), type: "png" });
  }
  await p.close();
  return { audits, errors };
}

async function record(browser, clip, dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  const context = async scale => { const c = await browser.newContext({ viewport: { width: VIEWPORT[0], height: VIEWPORT[1] }, deviceScaleFactor: scale, hasTouch: true }); await c.addInitScript(CLOCK); return c; };
  let c;
  if (STILLS) {
    // No motion: the stills pass alone, on every clip (gated only where the clip asks for an audit).
    const frames = Math.round(clip.ms / (1000 / FPS));
    c = await context(SCALE); const st = await stills(c, clip, dir, frames, !!clip.audit); await c.close();
    fs.writeFileSync(path.join(dir, "track.json"), JSON.stringify({ clip: clip.name, about: clip.about, fps: FPS, viewport: VIEWPORT, beats: [], errors: st.errors, audits: clip.audit ? st.audits : [], frames: [] }));
    return { frames: 0, errors: st.errors };
  }
  c = await context(1);
  const m = await motion(c, clip, dir); await c.close();
  let audits = [], errors = m.errors;
  if (clip.audit && !MOTION_ONLY) { c = await context(SCALE); const st = await stills(c, clip, dir, m.frames); await c.close(); audits = st.audits; errors = errors.concat(st.errors); }
  fs.writeFileSync(path.join(dir, "track.json"), JSON.stringify({ clip: clip.name, about: clip.about, fps: FPS, viewport: VIEWPORT, beats: m.beats, errors, audits, frames: m.track }));
  fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify(m.beats, null, 1));
  if (!QUICK && HAS_FFMPEG) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "frames", "%03d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", path.join(dir, "clip.mp4")]);
  return { frames: m.frames + 1, errors };
}

// A machine-wide cap on recordings at once (lanes and fixers record side by side): each top-level run holds one of
// SLOTS slots, a directory with its pid in it; a slot whose pid has gone is free again.
const SLOTS = 2, LOCKS = path.join(require("os").tmpdir(), "deckmaster-reel-slots");
async function slot() {
  if (process.env.SEAT_SLOT) return;                                  // a child of a run that holds one
  fs.mkdirSync(LOCKS, { recursive: true });
  for (let waited = 0; ; waited++) {
    for (let i = 0; i < SLOTS; i++) {
      const d = path.join(LOCKS, "slot-" + i);
      try { fs.mkdirSync(d); fs.writeFileSync(path.join(d, "pid"), String(process.pid)); process.env.SEAT_SLOT = d;
        process.on("exit", () => fs.rmSync(d, { recursive: true, force: true })); ["SIGINT", "SIGTERM"].forEach(sg => process.on(sg, () => process.exit(1))); return; }
      catch (e) { let pid = 0; try { pid = +fs.readFileSync(path.join(d, "pid"), "utf8"); } catch (_) {} try { if (pid) process.kill(pid, 0); else if (waited > 2) throw 0; } catch (_) { fs.rmSync(d, { recursive: true, force: true }); } }
    }
    if (waited === 0) console.log("waiting for a recording slot");
    await new Promise(r => setTimeout(r, 5000));
  }
}

// More than one clip: one process per clip, JOBS at a time (each has its own browser; software rendering is per core).
const chosen = CLIPS.filter(c => only ? only.has(c.name) : !c.manual);
if (only && chosen.length !== only.size) throw new Error("Unknown clip: " + [...only].filter(name => !chosen.some(c => c.name === name)).join(", "));
const ready = slot().then(() => (BASE ? null : require("./serve.js").serve().then(s => { BASE = s.base; process.env.BASE = BASE; })));
if (chosen.length > 1 && JOBS > 1) ready.then(() => {
  const { spawn } = require("child_process"), queue = chosen.map(c => c.name), passed = process.argv.slice(2).filter((a, i, all) => a.startsWith("--") || (i && all[i - 1].startsWith("--") && all[i - 1] !== "--quick" && all[i - 1] !== "--stills" && all[i - 1] !== "--motion-only"));
  let failed = 0;
  const next = () => new Promise(done => {
    const name = queue.shift(); if (!name) return done();
    const ch = spawn(process.execPath, [__filename, outDir, name, ...passed, "--jobs", "1"], { stdio: "inherit" });
    ch.on("exit", code => { if (code) failed++; next().then(done); });
  });
  Promise.all(Array.from({ length: Math.min(JOBS, chosen.length) }, next)).then(() => process.exit(failed ? 1 : 0));
}); else ready.then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  // GPU rasterization of the page (the chrome over the canvas) is off: on SwiftShader it decodes and filters images (the
  // hand's art, a ring's rounded corners) differently from run to run, so two recordings differed. WebGL is unaffected.
  const browser = await pw[ENG].launch(ENG === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-rasterization"] } : {});
  try {
    for (const clip of chosen) {
      const t0 = Date.now(), r = await record(browser, clip, path.join(outDir, clip.name));
      console.log(`${clip.name}: ${r.frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s${r.errors.length ? " · errors: " + r.errors.slice(0, 3).join(" | ") : ""}`);
    }
  } finally {
    await browser.close();
  }
  process.exit(0);   // the server we started would otherwise keep us alive
}).catch(error => { console.error(error); process.exit(1); });
