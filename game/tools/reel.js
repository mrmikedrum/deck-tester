// Record the built client on its scripted transport at a fixed virtual time.
//   node tools/reel.js <outdir> [clip,clip] [--quick | --stills] [--jobs 2] [--fps 30] [--engine chromium|webkit] [--viewport 1210x834]
// --quick records 15 fps without video. --stills records only the 2× stills and their audit. --viewport is in CSS px
// (1180x820 by default; the iPad in landscape is 1210x834).
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const pw = require(process.env.PW || "playwright");
const { CLOCK } = require("./behaviour/clock.js");
const { locate } = require("./behaviour/locate.js");
let BASE = process.env.BASE;   // unset: serve the build ourselves (tools/serve.js), shared with the processes we start
const CLIPS = require("./clips.js");
const HAS_FFMPEG = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch (e) { return false; } })();   // without it, no clip.mp4
const ORIGIN = 1e6;   // the virtual time playback starts at, ms: later than any boot

const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv.splice(i, 2)[1]; };
const QUICK = argv.includes("--quick") && !!argv.splice(argv.indexOf("--quick"), 1);
const STILLS = argv.includes("--stills") && !!argv.splice(argv.indexOf("--stills"), 1);
const FPS = +flag("fps", QUICK ? 15 : 30), ENG = flag("engine", "chromium"), SCALE = +flag("scale", 2), JOBS = +flag("jobs", 2);
const VIEWPORT = flag("viewport", "1180x820").split("x").map(Number);
const [outDir = "reels/latest", onlyArg] = argv;
const only = onlyArg ? new Set(onlyArg.split(",")) : null;

// ---- The virtual clock (behaviour/clock.js), installed before any page script ------------------------------------------
// It runs in real time until __clock.freeze(ORIGIN), so boot, fetches and art loading work normally; after that nothing
// advances except through __clock.step(ms).

// ---- What gets measured each frame ---------------------------------------------------------------------------------
const TRACK = () => {
  const dm = window.__deckmaster, snap = dm.scene.inspect(), faces = dm.scene.faces(), out = {};
  const seats = dm.seats(), pidOf = s => (s == null ? null : ["you", "ana", "bo", "cy"][seats.indexOf(s)] || s);
  const members = new Map((snap ? snap.pieces : []).map(p => [p.id, p])), flights = new Map((snap ? snap.flights : []).map(f => [f.id, f]));
  const nameOf = ids => { const c = ids.length ? dm.card(ids[0]) : null; return c ? c.name + (ids.length > 1 ? " ×" + ids.length : "") : undefined; };
  for (const b of dm.scene.boxes()) {
    if (!b.visible) continue;
    const pc = members.get(b.id), fl = flights.get(b.id);
    const rec = { role: b.kind === "page" ? "floor" : b.kind, pid: pc ? pidOf(pc.seat) : null };
    const name = pc ? nameOf(pc.shown) : fl && fl.card != null ? nameOf([fl.card]) : undefined;
    if (name) rec.name = name;
    if (b.quad) rec.quad = b.quad;
    else Object.assign(rec, { box: b.box, fade: pc ? +pc.now.fade.toFixed(3) : 0 });
    // The card face's width on screen as a floor measures it (across its middle, unturned), and whether it stands.
    if (faces[b.id]) Object.assign(rec, { face: +faces[b.id].width.toFixed(1), stands: faces[b.id].standing });
    out[b.kind === "page" && pc ? "floor" + pidOf(pc.seat) : b.id] = rec;
  }
  return { objects: out };
};

// ---- A layout audit, at chosen frames: what the hit test gives each piece, what is hidden --------------------------
// Audit the drawn table through `window.__deckmaster`: its pieces as the
// scene last drew them (`scene.faces()`: each card face's quad on screen), what a tap reaches at each point
// (`scene.pick`, the scene's own picking of its drawn poses), and what is drawn on top there (`scene.under`, a ray
// against the drawn cards and labels). Roles come from the plan's units. The stack standing up as the table's focus is
// set aside (one tap does that), except that it may not cover what it aims at; a stack set aside is measured as one
// more thing on the table. Panels marked data-focus (the sift's caption, the lean-in's bar) are hidden while measuring.
const AUDIT = step => {
  const dm = window.__deckmaster, plan = dm.plan(), snap = dm.scene.inspect(), faces = dm.scene.faces(), state = dm.state();
  const seats = dm.seats(), pidOf = s => (s == null ? null : ["you", "ana", "bo", "cy"][seats.indexOf(s)] || s);
  const cv = document.querySelector("canvas"), W = innerWidth, H = innerHeight, cols = Math.ceil(W / step), rows = Math.ceil(H / step);
  const role = new Map();
  for (const sp of plan.seats.values()) {
    for (const u of sp.units) role.set(u.id, u.role);
    if (sp.fixtures.commander) role.set("command:" + sp.seat, "commander");
  }
  const up = Object.entries(faces).filter(([, f]) => f.kind === "stack" && f.up && f.visible).map(([id]) => id), stackUp = up.length > 0;
  const aimed = new Set(stackUp ? ((state.model || {}).stack || []).flatMap(st => (st.targets || []).map(t => (t && typeof t === "object" ? t.card : t)).filter(c => typeof c === "number")) : []);
  const panel = el => { const a = el && el.closest("[data-audit]"); if (a) return "panel:" + a.dataset.audit; const c = el && el.closest("[class]"); return "panel:" + (c ? String(c.className).split(" ")[0] : el ? el.tagName.toLowerCase() : "?"); };
  const owned = new Map();   // piece id -> the grid cells a tap there reaches it
  const grid = () => { for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i * step + step / 2, y = j * step + step / 2, el = document.elementFromPoint(x, y);
    if (el !== cv) continue;
    const g = dm.scene.pick(x, y, up); if (!g) continue;
    if (!owned.has(g.id)) owned.set(g.id, new Set()); owned.get(g.id).add(j * cols + i);
  } };
  const seen = (x, y, skip) => { const el = document.elementFromPoint(x, y); return el !== cv ? panel(el) : dm.scene.under(x, y, skip); };
  const inQuad = (q, x, y) => { let s = 0; for (let n = 0; n < 4; n++) { const a = q[n], b = q[(n + 1) % 4], c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c); } } return true; };
  const lerp = (q, u, v) => { const a = [q[0][0] + (q[1][0] - q[0][0]) * u, q[0][1] + (q[1][1] - q[0][1]) * u], b = [q[3][0] + (q[2][0] - q[3][0]) * u, q[3][1] + (q[2][1] - q[3][1]) * u]; return [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v]; };
  const strip = (q, v0, v1) => [lerp(q, 0, v0), lerp(q, 1, v0), lerp(q, 1, v1), lerp(q, 0, v1)];
  const coverOf = (k, q, skip) => {
    const tally = qq => {
      const xs = qq.map(p => p[0]), ys = qq.map(p => p[1]), out = { n: 0, by: {} };
      for (let j = Math.max(0, Math.floor(Math.min(...ys) / step)); j <= Math.min(rows - 1, Math.floor(Math.max(...ys) / step)); j++)
        for (let i = Math.max(0, Math.floor(Math.min(...xs) / step)); i <= Math.min(cols - 1, Math.floor(Math.max(...xs) / step)); i++) {
          const x = i * step + step / 2, y = j * step + step / 2;
          if (!inQuad(qq, x, y)) continue;
          out.n++; const w = seen(x, y, skip); if (w && w !== k) out.by[w] = (out.by[w] || 0) + 1;
        }
      return out;
    };
    const f = tally(q), nm = tally(strip(q, 5 / 6, 1)), ft = tally(strip(q, 0, 1 / 6));
    const pct = t => (t.n ? Math.round(100 * Object.values(t.by).reduce((a, b) => a + b, 0) / t.n) : 0);
    const top = t => Object.entries(t.by).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w);
    return { face: pct(f), name: pct(nm), foot: pct(ft), by: [...new Set([...top(nm), ...top(ft), ...top(f)])] };
  };
  const square = set => {   // the largest square of cells the piece owns, in px
    let best = 0; const dp = new Map();
    for (const c of [...set].sort((a, b) => a - b)) { const i = c % cols; const v = i === 0 ? 1 : 1 + Math.min(dp.get(c - 1) || 0, dp.get(c - cols) || 0, dp.get(c - cols - 1) || 0); dp.set(c, v); best = Math.max(best, v); }
    return best * step;
  };
  const panels = [...document.querySelectorAll("[data-focus]")].map(e => [e, e.style.visibility]);
  panels.forEach(([e]) => (e.style.visibility = "hidden"));
  const pieces = {};
  try {
    grid();
    for (const pc of snap ? snap.pieces : []) {
      if (!["unit", "plate", "stack"].includes(pc.kind) || pc.remnant || up.includes(pc.id)) continue;
      const f = faces[pc.id], cells = owned.get(pc.id), ids = pc.shown.length ? pc.shown : pc.members;
      const hidden = pc.kind === "unit" && (!pc.visible || !f || !f.visible);
      pieces[pc.id] = { role: pc.kind === "plate" ? "plate" : pc.kind === "stack" ? "stack" : role.get(pc.id) || "card", pid: pc.kind === "stack" ? "stack" : pidOf(pc.seat), n: ids.length,
        names: ids.slice(0, 6).map(id => (dm.card(id) || {}).name).filter(Boolean),
        pick: cells ? pc.kind : null, tapPx: cells ? cells.size * step * step : 0, tapSquare: cells ? square(cells) : 0, hidden,
        cover: hidden || !f || pc.kind === "plate" ? null : coverOf(pc.id, f.quad, up) };
      if (f && !hidden && pc.members.some(id => aimed.has(id))) {   // what the stack points at: the stack may not cover it
        const a = coverOf(pc.id, f.quad, []), b = pieces[pc.id].cover;
        pieces[pc.id].cover = { face: Math.max(a.face, b.face), name: Math.max(a.name, b.name), foot: Math.max(a.foot, b.foot), by: [...new Set([...a.by, ...b.by])] };
      }
    }
  } finally { panels.forEach(([e, v]) => (e.style.visibility = v)); }
  // Labels at rest (the stack's focus set aside: the board under it keeps its labels where they are): each one's box and
  // text size as drawn (unrounded), and every card's name strip and foot, so the packet can check that no label meets
  // another, or another unit's name or stats. `labelled`: the board draws labels (or has piles that would carry them),
  // so a beat without them measured is not a pass. Null labels: the scene could not say.
  const strips = Object.entries(faces).filter(([id, f]) => f.visible && f.kind === "unit" && !up.includes(id))
    .flatMap(([id, f]) => [{ id, part: "name", q: strip(f.quad, 5 / 6, 1) }, { id, part: "foot", q: strip(f.quad, 0, 1 / 6) }])
    .map(({ id, part, q }) => ({ id, part, box: [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))] }));
  const drawn = dm.scene.labels ? dm.scene.labels() : null;
  const labels = drawn ? drawn.filter(l => l.visible && !up.includes(l.id)).map(l => ({ id: l.id, box: l.box, px: l.px, name: ((pieces[l.id] || {}).names || [])[0] || l.id })) : null;
  const labelled = (drawn || []).some(l => !up.includes(l.id)) || Object.values(pieces).some(p => p.role !== "plate" && p.role !== "stack" && p.n > 1);
  return { pieces, stackUp, labels, labelled, strips };
};

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
  if (clip.audit) { c = await context(SCALE); const st = await stills(c, clip, dir, m.frames); await c.close(); audits = st.audits; errors = errors.concat(st.errors); }
  fs.writeFileSync(path.join(dir, "track.json"), JSON.stringify({ clip: clip.name, about: clip.about, fps: FPS, viewport: VIEWPORT, beats: m.beats, errors, audits, frames: m.track }));
  fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify(m.beats, null, 1));
  if (!QUICK && HAS_FFMPEG) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "frames", "%03d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", path.join(dir, "clip.mp4")]);
  return { frames: m.frames + 1, errors };
}

// A machine-wide cap on recordings at once (lanes and fixers record side by side): each top-level run holds one of
// SLOTS slots, a directory with its pid in it; a slot whose pid has gone is free again.
const SLOTS = 2, LOCKS = path.join(require("os").homedir(), ".cache/seat-look");
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
  const { spawn } = require("child_process"), queue = chosen.map(c => c.name), passed = process.argv.slice(2).filter((a, i, all) => a.startsWith("--") || (i && all[i - 1].startsWith("--") && all[i - 1] !== "--quick" && all[i - 1] !== "--stills"));
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
