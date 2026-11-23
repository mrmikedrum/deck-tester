// Frame-exact motion capture for Seat. The page runs on a virtual clock (requestAnimationFrame, performance.now,
// timers and CSS animations), so every frame of a transition is captured at true time however slow the renderer is.
//   node tools/reel.js <outdir> [clip,clip] [--quick] [--jobs 2] [--fps 30] [--engine chromium|webkit]
// --quick is for checking a change: 15 fps and no video, the same packet. Several clips record in parallel (--jobs).
// Motion is recorded at 1×; audit stills come from a second, coarse pass at the iPad's 2× (--scale).
// Serve client/ on :8797 first. Per clip, writes <outdir>/<clip>/: frames/NNN.jpg, clip.mp4, track.json (the screen
// quad of every mat and the box of every piece, per frame) and beats.json (what happened when).
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const pw = require(process.env.PW || "playwright");
const { STATES, CARDS } = require("./shoot.js");
let BASE = process.env.BASE;   // unset: serve client/ ourselves (tools/serve.js), shared with the processes we start
const CLIPS = require("./clips.js");

const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv.splice(i, 2)[1]; };
const QUICK = argv.includes("--quick") && !!argv.splice(argv.indexOf("--quick"), 1);
const FPS = +flag("fps", QUICK ? 15 : 30), ENG = flag("engine", "chromium"), SCALE = +flag("scale", 2), JOBS = +flag("jobs", 2);
const [outDir = "reels/latest", onlyArg] = argv;
const only = onlyArg ? new Set(onlyArg.split(",")) : null;

// ---- The virtual clock, installed before any page script ----------------------------------------------------------
// It runs in real time until __clock.freeze(), so boot, fetches and art loading work normally; after that nothing
// advances except through __clock.step(ms).
const CLOCK = () => {
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window), realCancel = window.cancelAnimationFrame.bind(window);
  const realSet = window.setTimeout.bind(window), realClear = window.clearTimeout.bind(window), realSetI = window.setInterval.bind(window), realClearI = window.clearInterval.bind(window);
  let frozen = false, base = 0, now = 0, nextId = 1e6;
  const rafs = new Map(), timers = new Map(), anims = new Map();
  performance.now = () => (frozen ? now : realNow());
  window.requestAnimationFrame = cb => { if (!frozen) return realRaf(cb); const id = nextId++; rafs.set(id, cb); return id; };
  window.cancelAnimationFrame = id => { rafs.delete(id); realCancel(id); };
  window.setTimeout = (cb, ms = 0, ...a) => { if (!frozen) return realSet(cb, ms, ...a); const id = nextId++; timers.set(id, { at: now + Math.max(0, +ms || 0), cb, a }); return id; };
  window.clearTimeout = id => { timers.delete(id); realClear(id); };
  window.setInterval = (cb, ms = 0, ...a) => { if (!frozen) return realSetI(cb, ms, ...a); const id = nextId++; timers.set(id, { at: now + ms, cb, a, every: Math.max(1, ms) }); return id; };
  window.clearInterval = id => { timers.delete(id); realClearI(id); };
  // CSS animations and transitions: pause each as it appears and drive its currentTime from the virtual clock.
  const syncCss = () => {
    if (!document.getAnimations) return;
    for (const a of document.getAnimations()) {
      if (!anims.has(a)) { anims.set(a, now - (a.currentTime || 0)); try { a.pause(); } catch (e) {} }
      try { a.currentTime = now - anims.get(a); } catch (e) {}
    }
  };
  window.__clock = {
    get frozen() { return frozen; }, get now() { return now; },
    freeze() { if (frozen) return; now = realNow(); base = now; frozen = true; syncCss(); },
    step(ms) {
      const end = now + ms;
      for (;;) {   // timers due inside the step, in order
        let due = null; for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due[1].at)) due = [id, t];
        if (!due) break;
        const [id, t] = due; now = Math.max(now, t.at);
        if (t.every) t.at += t.every; else timers.delete(id);
        try { t.cb(...t.a); } catch (e) { console.error(e); }
      }
      now = end;
      const cbs = [...rafs.values()]; rafs.clear();
      for (const cb of cbs) try { cb(now); } catch (e) { console.error(e); }
      syncCss();
      return now - base;
    },
  };
};

// ---- What gets measured each frame ---------------------------------------------------------------------------------
const TRACK = () => {
  const h = window.__h, T = h.T, cam = h.cam, W = innerWidth, H = innerHeight;
  const toScreen = v => { const p = v.clone().project(cam); return [+((p.x + 1) / 2 * W).toFixed(1), +((1 - p.y) / 2 * H).toFixed(1)]; };
  const out = {};
  for (const [k, pc] of Object.entries(h.pieces())) {
    const o = pc.obj; if (!o.visible) continue;
    o.updateWorldMatrix(true, true);
    const rec = { role: pc.role, pid: pc.pid };
    if (pc.ids && pc.ids.length) { const c = window.Proto.card(pc.ids[0]); if (c) rec.name = window.Proto.name(c) + (pc.ids.length > 1 ? " ×" + pc.ids.length : ""); }
    if (pc.role === "floor" && o.userData.floor) {
      const m = o.userData.floor, mat = m.material;
      rec.quad = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => toScreen(new T.Vector3(x, y, 0).applyMatrix4(m.matrixWorld)));
      rec.size = [+m.scale.x.toFixed(3), +m.scale.y.toFixed(3)];
      rec.opacity = +mat.opacity.toFixed(3); rec.shade = +mat.color.r.toFixed(3);
      rec.tex = mat.map ? mat.map.uuid.slice(0, 8) : null;
      rec.texSize = mat.map && mat.map.image ? [mat.map.image.width, mat.map.image.height] : null;
      rec.order = m.renderOrder;
    } else {
      const b = new T.Box3().setFromObject(o);
      if (b.isEmpty()) continue;
      const pts = []; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(toScreen(new T.Vector3(x, y, z)));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      rec.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(v => +v.toFixed(1));
      rec.fade = +(o.userData.fade || 0).toFixed(3);
      let face = null; o.traverse(m => { if (!face && m.isMesh && m.visible && m.material && m.material.userData && m.material.userData.dim) face = m; });
      if (face && face.geometry) {   // the card face's width on screen: the mean of its top and bottom edges
        face.geometry.computeBoundingBox(); const fb = face.geometry.boundingBox, z = (fb.min.z + fb.max.z) / 2;
        const q = [[fb.min.x, fb.min.y], [fb.max.x, fb.min.y], [fb.max.x, fb.max.y], [fb.min.x, fb.max.y]].map(([x, y]) => toScreen(new T.Vector3(x, y, z).applyMatrix4(face.matrixWorld)));
        rec.face = +((Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) + Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1])) / 2).toFixed(1);
      }
    }
    out[k] = rec;
  }
  return { focus: h.focus || null, objects: out };
};

// ---- A layout audit, at chosen frames: what the hit test gives each piece, what is hidden --------------------------
const AUDIT = step => {
  const h = window.__h, cv = h.renderer().domElement, byObj = new Map(), cells = {};
  for (const [k, pc] of Object.entries(h.pieces())) byObj.set(pc.obj, k);
  const keyOf = o => { for (let q = o; q; q = q.parent) if (byObj.has(q)) return byObj.get(q); return null; };
  const W = innerWidth, H = innerHeight, cols = Math.ceil(W / step), rows = Math.ceil(H / step), owner = new Array(cols * rows).fill(null);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i * step + step / 2, y = j * step + step / 2, el = document.elementFromPoint(x, y);
    if (el !== cv) { const c = el && el.closest("[class]"); owner[j * cols + i] = "panel:" + (c ? c.className.split(" ")[0] : el ? el.tagName.toLowerCase() : "?"); continue; }   // the hand, the prompt or another overlay
    const hit = h.pickAt(x, y); if (!hit) continue;
    const k = keyOf(hit.obj); if (!k) continue;
    owner[j * cols + i] = k;
    (cells[k] = cells[k] || { pick: hit.pick, set: new Set() }).set.add(j * cols + i);
  }
  // What covers each card: of the points inside its face (and its name strip, the top sixth, and its foot, the bottom
  // sixth, where power, toughness and counters sit), what is drawn on
  // top there. A panel over the canvas, or the first visible thing a ray from the eye meets, labels and signs included;
  // parts of the card's own piece don't count, nor does the page or the table under it.
  const ray = new h.T.Raycaster(), pieceOf = new Map();
  for (const [k, pc] of Object.entries(h.pieces())) pc.obj.traverse(m => pieceOf.set(m, pc.role === "floor" ? null : k));
  const seen = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (el !== cv) { const c = el && el.closest("[class]"); return "panel:" + (c ? c.className.split(" ")[0] : el ? el.tagName.toLowerCase() : "?"); }
    ray.setFromCamera(new h.T.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), h.cam);
    for (const hit of ray.intersectObjects(h.scene.children, true)) {
      const m = hit.object; if (!m.isMesh || !m.material) continue;
      let vis = true; for (let q = m; q; q = q.parent) if (!q.visible) { vis = false; break; }
      const mat = [].concat(m.material)[0]; if (!vis || (mat.transparent && mat.opacity < 0.1)) continue;
      let q = m; while (q && !pieceOf.has(q)) q = q.parent;
      return q ? pieceOf.get(q) : null;                              // the table, the page, or nothing of a piece
    }
    return null;
  };
  const T = h.T, cam = h.cam, scr = v => { const q = v.project(cam); return [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H]; };
  const inQuad = (q, x, y) => { let s = 0; for (let n = 0; n < 4; n++) { const a = q[n], b = q[(n + 1) % 4], c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c); } } return true; };
  const coverOf = (k, o) => {
    let face = null; o.traverse(m => { if (!face && m.isMesh && m.visible && m.material && m.material.userData && m.material.userData.dim) face = m; });
    if (!face) return null;
    face.updateWorldMatrix(true, false); face.geometry.computeBoundingBox(); const fb = face.geometry.boundingBox, z = (fb.min.z + fb.max.z) / 2;
    const quad = (y0, y1) => [[fb.min.x, y0], [fb.max.x, y0], [fb.max.x, y1], [fb.min.x, y1]].map(([x, y]) => scr(new T.Vector3(x, y, z).applyMatrix4(face.matrixWorld)));
    const tally = q => {
      const xs = q.map(p => p[0]), ys = q.map(p => p[1]), out = { n: 0, by: {} };
      for (let j = Math.max(0, Math.floor(Math.min(...ys) / step)); j <= Math.min(rows - 1, Math.floor(Math.max(...ys) / step)); j++)
        for (let i = Math.max(0, Math.floor(Math.min(...xs) / step)); i <= Math.min(cols - 1, Math.floor(Math.max(...xs) / step)); i++) {
          if (!inQuad(q, i * step + step / 2, j * step + step / 2)) continue;
          out.n++; const w = seen(i * step + step / 2, j * step + step / 2); if (w && w !== k) out.by[w] = (out.by[w] || 0) + 1;
        }
      return out;
    };
    const hgt = fb.max.y - fb.min.y, f = tally(quad(fb.min.y, fb.max.y)), nm = tally(quad(fb.max.y - hgt / 6, fb.max.y)), ft = tally(quad(fb.min.y, fb.min.y + hgt / 6));
    const pct = t => (t.n ? Math.round(100 * Object.values(t.by).reduce((a, b) => a + b, 0) / t.n) : 0);
    const top = t => Object.entries(t.by).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w);
    return { face: pct(f), name: pct(nm), foot: pct(ft), by: [...new Set([...top(nm), ...top(ft), ...top(f)])] };
  };
  const square = set => {   // the largest square of cells the piece owns, in px
    let best = 0; const dp = new Map();
    for (const c of [...set].sort((a, b) => a - b)) { const i = c % cols, j = (c - i) / cols; const v = 1 + Math.min(dp.get(c - 1) || 0, dp.get(c - cols) || 0, dp.get(c - cols - 1) || 0); if (i === 0) dp.set(c, 1); else dp.set(c, v); best = Math.max(best, dp.get(c)); }
    return best * step;
  };
  const poses = h.poses(), pieces = {};
  for (const [k, pc] of Object.entries(h.pieces())) {
    if (["floor", "zone"].includes(pc.role)) continue;
    const c = cells[k], t = poses[k] || {};
    pieces[k] = { role: pc.role, pid: pc.pid, n: pc.ids.length, names: pc.ids.slice(0, 6).map(id => { const c = window.Proto.card(id); return c ? window.Proto.name(c) : null; }).filter(Boolean),
      pick: c ? c.pick.type : null, tapPx: c ? c.set.size * step * step : 0, tapSquare: c ? square(c.set) : 0, hidden: !!t.hide,
      cover: t.hide ? null : coverOf(k, pc.obj) };
  }
  return { pieces };
};

async function livePage(ctx, first) {
  const p = await ctx.newPage();
  await p.route("**/api/**", async route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/api/view")) { if (u.searchParams.get("v") === "0") return route.fulfill({ json: { v: 1, state: "playing", view: first.view, decision: first.decision } }); return; }
    if (u.pathname.endsWith("/api/cards")) { const o = {}; u.searchParams.getAll("n").forEach(n => CARDS[n] && (o[n] = CARDS[n])); return route.fulfill({ json: o }); }
    return route.fulfill({ json: { ok: true } });
  });
  await p.goto(BASE + "live.html");
  await p.waitForFunction(() => window.__h && window.Live && window.Live.snap && window.Live.snap.view, null, { timeout: 180000 });
  return p;
}

async function open(ctx, clip) {
  const errors = [];
  let p;
  if (clip.live) p = await livePage(ctx, typeof clip.live === "string" ? STATES[clip.live] : clip.live);
  else { p = await ctx.newPage(); await p.goto(BASE + "index.html?nodirector#h"); await p.waitForFunction(() => window.__h, null, { timeout: 60000 }); }
  p.on("pageerror", e => errors.push(String(e))); p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  for (const js of clip.setup || []) { await p.evaluate(js); await p.waitForTimeout(700); }
  await p.waitForTimeout(2500);                                      // art, textures and the first layout settle in real time
  await p.evaluate(() => window.__clock.freeze());
  return { p, errors };
}
const fire = (p, js) => p.evaluate(`(() => { try { ${js}; return null; } catch (e) { return e.stack || String(e); } })()`);

// The motion pass, at 1×: every frame at FPS, with what moved where.
async function motion(ctx, clip, dir) {
  const { p, errors } = await open(ctx, clip), dt = 1000 / FPS, frames = Math.round(clip.ms / dt), beats = [], track = [];
  const due = clip.beats.map(b => ({ ...b, frame: Math.round(b.at / dt) }));
  for (let f = 0; f <= frames; f++) {
    for (const b of due.filter(b => b.frame === f)) beats.push({ frame: f, ms: Math.round(f * dt), label: b.label, err: await fire(p, b.js) });
    await p.evaluate(ms => window.__clock.step(ms), f === 0 ? 0 : dt);
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
async function stills(ctx, clip, dir, frames) {
  const { p, errors } = await open(ctx, clip), dt = 1000 / FPS;
  const due = clip.beats.map(b => ({ ...b, frame: Math.round(b.at / dt) })), at = [];
  due.forEach((b, i) => {
    const settled = (i + 1 < due.length ? due[i + 1].frame : frames + 1) - 1;
    at.push({ t: Math.max(0, (b.frame - 1) * dt), beat: b });
    at.push({ t: settled * dt, audit: settled, gate: b.audit !== false, label: b.label });
  });
  if (due.length && due[0].frame > 1) at.push({ t: (due[0].frame - 1) * dt, audit: due[0].frame - 1, gate: true, label: "start" });
  at.sort((a, b) => a.t - b.t || (a.audit != null ? -1 : 1));
  const audits = []; let now = 0;
  await p.evaluate(() => window.__clock.step(0));
  for (const e of at) {
    while (now < e.t - 0.01) { const s = Math.min(100, e.t - now); await p.evaluate(ms => window.__clock.step(ms), s); now += s; }
    if (e.beat) { await fire(p, e.beat.js); continue; }
    const name = `still-${String(e.audit).padStart(3, "0")}.png`;
    audits.push({ frame: e.audit, label: e.label, gate: e.gate, objects: (await p.evaluate(TRACK)).objects, ...(e.gate ? await p.evaluate(AUDIT, 4) : { pieces: {} }) });
    await p.screenshot({ path: path.join(dir, name), type: "png" });
  }
  await p.close();
  return { audits, errors };
}

async function record(browser, clip, dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  const context = async scale => { const c = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: scale, hasTouch: true }); await c.addInitScript(CLOCK); return c; };
  let c = await context(1);
  const m = await motion(c, clip, dir); await c.close();
  let audits = [], errors = m.errors;
  if (clip.audit) { c = await context(SCALE); const st = await stills(c, clip, dir, m.frames); await c.close(); audits = st.audits; errors = errors.concat(st.errors); }
  fs.writeFileSync(path.join(dir, "track.json"), JSON.stringify({ clip: clip.name, about: clip.about, fps: FPS, viewport: [1180, 820], beats: m.beats, errors, audits, frames: m.track }));
  fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify(m.beats, null, 1));
  if (!QUICK) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "frames", "%03d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", path.join(dir, "clip.mp4")]);
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
const ready = slot().then(() => (BASE ? null : require("./serve.js").serve().then(s => { BASE = s.base; process.env.BASE = BASE; })));
if (chosen.length > 1 && JOBS > 1) ready.then(() => {
  const { spawn } = require("child_process"), queue = chosen.map(c => c.name), passed = process.argv.slice(2).filter((a, i, all) => a.startsWith("--") || (i && all[i - 1].startsWith("--") && all[i - 1] !== "--quick"));
  let failed = 0;
  const next = () => new Promise(done => {
    const name = queue.shift(); if (!name) return done();
    const ch = spawn(process.execPath, [__filename, outDir, name, ...passed, "--jobs", "1"], { stdio: "inherit" });
    ch.on("exit", code => { if (code) failed++; next().then(done); });
  });
  Promise.all(Array.from({ length: Math.min(JOBS, chosen.length) }, next)).then(() => process.exit(failed ? 1 : 0));
}); else ready.then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await pw[ENG].launch(ENG === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } : {});
  for (const clip of chosen) {
    const t0 = Date.now(), r = await record(browser, clip, path.join(outDir, clip.name));
    console.log(`${clip.name}: ${r.frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s${r.errors.length ? " · errors: " + r.errors.slice(0, 3).join(" | ") : ""}`);
  }
  await browser.close();
  process.exit(0);   // the server we started would otherwise keep us alive
});
