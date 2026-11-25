// Frame-exact motion capture for Seat. The page runs on a virtual clock (requestAnimationFrame, performance.now,
// timers and CSS animations), so every frame of a transition is captured at true time however slow the renderer is.
//   node tools/reel.js <outdir> [clip,clip] [--quick | --stills] [--jobs 2] [--fps 30] [--engine chromium|webkit]
// --quick is for checking a change: 15 fps and no video, the same packet. --stills skips the motion pass: only the 2×
// stills at each beat and their audit, for every clip (comparing layout and legibility, not motion). Several clips record in parallel (--jobs).
// Motion is recorded at 1×; audit stills come from a second, coarse pass at the iPad's 2× (--scale).
// It serves client/ itself (tools/serve.js) unless BASE is set. Per clip, writes <outdir>/<clip>/: frames/NNN.jpg, clip.mp4, track.json (the screen
// quad of every mat and the box of every piece, per frame) and beats.json (what happened when).
// ENTRY=new records the built new entry (client/dist, `npx vite build`) on the scripted transport (index.html?script):
// the clip's envelopes and card data are its scenario, every answer is replied to at once, and it is read only through
// `window.__deckmaster`. Only clips with a new-entry form (`entries` naming "new") record there; a beat's `new` is its
// form there. Playback starts at a
// fixed virtual time (ORIGIN) once the page is settled and its art decoded, and the clock steps only when no art is
// loading, so two recordings of the same clip are the same frames.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const pw = require(process.env.PW || "playwright");
const { CARDS } = require("./shoot.js");
const { CLOCK } = require("./behaviour/clock.js");
const { locate } = require("./behaviour/locate.js");
let BASE = process.env.BASE;   // unset: serve client/ ourselves (tools/serve.js), shared with the processes we start
const CLIPS = require("./clips.js");
const NEW = process.env.ENTRY === "new";
const HAS_FFMPEG = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch (e) { return false; } })();   // without it, no clip.mp4
const ORIGIN = 1e6;   // the virtual time playback starts at, ms: later than any boot

const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv.splice(i, 2)[1]; };
const QUICK = argv.includes("--quick") && !!argv.splice(argv.indexOf("--quick"), 1);
const STILLS = argv.includes("--stills") && !!argv.splice(argv.indexOf("--stills"), 1);
const FPS = +flag("fps", QUICK ? 15 : 30), ENG = flag("engine", "chromium"), SCALE = +flag("scale", 2), JOBS = +flag("jobs", 2);
const [outDir = "reels/latest", onlyArg] = argv;
const only = onlyArg ? new Set(onlyArg.split(",")) : null;

// ---- The virtual clock (behaviour/clock.js), installed before any page script ------------------------------------------
// It runs in real time until __clock.freeze(ORIGIN), so boot, fetches and art loading work normally; after that nothing
// advances except through __clock.step(ms).

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

// The new entry's track, through its tools' surface: every piece and flying card on screen (a page is a mat, with its
// quad). Opacity, shade and textures are not read there: those fields are left out. Seats are named as the current
// client's (you, ana, bo, cy: the perspective first, then in turn order), so a packet reads both alike.
const TRACK_NEW = () => {
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
    if (b.quad) Object.assign(rec, { quad: b.quad, size: [1, 1], opacity: 1, shade: 1, tex: null, texSize: null, order: 0 });
    else Object.assign(rec, { box: b.box, fade: pc ? +pc.now.fade.toFixed(3) : 0 });
    if (faces[b.id]) rec.face = +faces[b.id].width.toFixed(1);   // the card face's width on screen, as TRACK's
    out[b.kind === "page" && pc ? "floor" + pidOf(pc.seat) : b.id] = rec;
  }
  return { focus: null, objects: out };
};

// ---- A layout audit, at chosen frames: what the hit test gives each piece, what is hidden --------------------------
const AUDIT = step => {
  const h = window.__h, cv = h.renderer().domElement, byObj = new Map(), cells = {};
  // A focus (the stack while it is up, or anything marked as one) may stand in front of the board, since one tap sets it
  // aside: the board is measured as it is with the focus set aside, except that the focus may not cover what it involves.
  // Any other focus (a combat, a leaned seat) marks its objects userData.focus and what it involves userData.involves.
  const stackGs = new Set(), shownNow = g => { for (let q = g; q; q = q.parent) if (!q.visible) return false; return true; };
  const stackOpen = !!(window.SeatHooks || {}).stackLayer && !h.focus;   // set aside, the stack is not a focus
  h.scene.traverse(o => { if (stackOpen && o.userData.pick && o.userData.pick.stack && o.parent) stackGs.add(o.parent); if (o.userData.focus) stackGs.add(o); });
  const stackUp = [...stackGs].some(shownNow);
  const aimed = new Set(stackUp ? (window.Proto.G.stack || []).flatMap(st => (st.targets || []).filter(t => typeof t === "number")) : []);
  stackGs.forEach(g => shownNow(g) && (g.userData.involves || []).forEach(id => aimed.add(id)));
  const panels = [...document.querySelectorAll("[data-focus]")].map(e => [e, e.style.visibility]);
  for (const [k, pc] of Object.entries(h.pieces())) byObj.set(pc.obj, k);
  const keyOf = o => { for (let q = o; q; q = q.parent) if (byObj.has(q)) return byObj.get(q); return null; };
  const W = innerWidth, H = innerHeight, cols = Math.ceil(W / step), rows = Math.ceil(H / step), owner = new Array(cols * rows).fill(null);
  const grid = () => { for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i * step + step / 2, y = j * step + step / 2, el = document.elementFromPoint(x, y);
    if (el !== cv) { const c = el && el.closest("[class]"); owner[j * cols + i] = "panel:" + (c ? c.className.split(" ")[0] : el ? el.tagName.toLowerCase() : "?"); continue; }   // the hand, the prompt or another overlay
    const hit = h.pickAt(x, y); if (!hit) continue;
    const k = keyOf(hit.obj); if (!k) continue;
    owner[j * cols + i] = k;
    (cells[k] = cells[k] || { pick: hit.pick, set: new Set() }).set.add(j * cols + i);
  } };
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
      let q = m; while (q && !pieceOf.has(q)) { if (stackGs.has(q)) return q.userData.focus ? "focus" : "stack"; q = q.parent; }
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
  const poses = h.poses(), pieces = {}, aimCover = {};
  for (const [k, pc] of Object.entries(h.pieces()))                  // what the stack points at, with the stack up
    if (!["floor", "zone"].includes(pc.role) && pc.ids.some(id => aimed.has(id)) && !(poses[k] || {}).hide) aimCover[k] = coverOf(k, pc.obj);
  const shown = [...stackGs].map(g => [g, g.visible]); shown.forEach(([g]) => (g.visible = false)); panels.forEach(([e]) => (e.style.visibility = "hidden"));
  try { grid(); for (const [k, pc] of Object.entries(h.pieces())) {
    if (["floor", "zone"].includes(pc.role)) continue;
    const c = cells[k], t = poses[k] || {};
    pieces[k] = { role: pc.role, pid: pc.pid, n: pc.ids.length, names: pc.ids.slice(0, 6).map(id => { const c = window.Proto.card(id); return c ? window.Proto.name(c) : null; }).filter(Boolean),
      pick: c ? c.pick.type : null, tapPx: c ? c.set.size * step * step : 0, tapSquare: c ? square(c.set) : 0, hidden: !!t.hide,
      cover: t.hide ? null : coverOf(k, pc.obj) };
    const a = aimCover[k], b = pieces[k].cover;                    // the worse of the two, for what the stack points at
    if (a && b) pieces[k].cover = { face: Math.max(a.face, b.face), name: Math.max(a.name, b.name), foot: Math.max(a.foot, b.foot), by: [...new Set([...a.by, ...b.by])] };
  } } finally { shown.forEach(([g, v]) => (g.visible = v)); panels.forEach(([e, v]) => (e.style.visibility = v)); }
  return { pieces, stackUp };
};

// The same audit of the new entry's drawn table, through `window.__deckmaster`, in the same shape: its pieces as the
// scene last drew them (`scene.faces()`: each card face's quad on screen), what a tap reaches at each point
// (`scene.pick`, the scene's own picking of its drawn poses), and what is drawn on top there (`scene.under`, a ray
// against the drawn cards and labels). Roles come from the plan's units. The stack standing up as the table's focus is
// set aside (one tap does that), except that it may not cover what it aims at; a stack set aside is measured as one
// more thing on the table. Panels marked data-focus (the sift's caption, the lean-in's bar) are hidden while measuring.
const AUDIT_NEW = step => {
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
  // Labels at rest (the stack's focus set aside): each one's box and text size, and every card's name strip and foot, so
  // the packet can check that no label meets another, or another unit's name or stats.
  const strips = Object.entries(faces).filter(([id, f]) => f.visible && f.kind === "unit" && !up.includes(id))
    .flatMap(([id, f]) => [{ id, part: "name", q: strip(f.quad, 5 / 6, 1) }, { id, part: "foot", q: strip(f.quad, 0, 1 / 6) }])
    .map(({ id, part, q }) => ({ id, part, box: [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))] }));
  const labels = stackUp ? [] : dm.scene.labels().filter(l => l.visible).map(l => ({ id: l.id, box: l.box, px: Math.round(l.px * 10) / 10, name: ((pieces[l.id] || {}).names || [])[0] || l.id }));
  return { pieces, stackUp, labels, strips: stackUp ? [] : strips };
};

// The current client on a mocked bridge: /api/view is a long poll held until a beat pushes the next snapshot (a beat's
// `push`), as the bridge would send it; card data is the clip's catalog, or shoot.js's.
async function livePage(ctx, first, catalog) {
  const p = await ctx.newPage(), cards = catalog || CARDS;
  let held = null, v = 1;
  await p.route("**/api/**", async route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/api/view")) { if (u.searchParams.get("v") === "0") return route.fulfill({ json: Object.assign({ state: "playing" }, first, { v: 1 }) }); held = route; return; }
    if (u.pathname.endsWith("/api/cards")) { const o = {}; u.searchParams.getAll("n").forEach(n => cards[n] && (o[n] = cards[n])); return route.fulfill({ json: o }); }
    return route.fulfill({ json: { ok: true } });
  });
  p.pushSnapshot = async snap => {
    for (let t = 0; !held && t < 3000; t += 20) await new Promise(r => setTimeout(r, 20));
    if (!held) throw new Error("the client never asked for the next snapshot");
    const r = held; held = null;
    await r.fulfill({ json: Object.assign({}, snap, { v: ++v }) });
    for (let t = 0; !held && t < 3000; t += 20) await new Promise(r => setTimeout(r, 20));   // taken: it polls again
  };
  await p.goto(BASE + "live.html");
  await p.waitForFunction(() => window.__h && window.Live && window.Live.snap && window.Live.snap.view, null, { timeout: 180000 });
  return p;
}

// The new entry on the scripted transport: the clip's first envelope and its catalog are the scenario; the art it can
// show is decoded (and the hand's images loaded) before playback, which starts once nothing is moving or loading.
async function newPage(ctx, clip) {
  if (!(clip.entries || []).includes("new")) throw new Error(`clip ${clip.name} has no new-entry form yet`);
  const p = await ctx.newPage();
  const catalog = clip.catalogNew || clip.catalog || {};
  const scenario = { catalog, envelopes: [clip.liveNew || clip.live], reply: { t: "queued" } };
  await p.route("**/script.json", route => route.fulfill({ json: scenario }));
  await p.route("**/api/**", route => route.fulfill({ status: 404, json: {} }));   // a scripted page asks the bridge nothing
  await p.goto(BASE + "index.html?script=script.json");
  await p.waitForFunction(() => window.__deckmaster, null, { timeout: 60000 });
  await p.evaluate(() => window.__deckmaster.ready);
  await p.waitForFunction(() => window.__deckmaster.seats().length > 0, null, { timeout: 60000 });
  const urls = [...new Set(Object.values(catalog).flatMap(e => (e.faces || []).flatMap(f => [f.art, f.img])).filter(Boolean))];
  await p.evaluate(u => window.__deckmaster.art.preload(u), urls);
  await settledNew(p);
  return p;
}
const settledNew = p => p.waitForFunction(() => window.__deckmaster.settled(), null, { timeout: 60000, polling: 50 });

async function open(ctx, clip) {
  const errors = [];
  let p;
  const live = typeof clip.live === "string" ? require("./shoot.js").STATES[clip.live] : clip.live;
  if (NEW) p = await newPage(ctx, clip);
  else if (clip.live) p = await livePage(ctx, live, clip.catalog);
  else { p = await ctx.newPage(); await p.goto(BASE + "offline.html"); await p.waitForFunction(() => window.__h, null, { timeout: 60000 }); }
  p.on("pageerror", e => errors.push(String(e))); p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  for (const js of clip.setup || []) { await p.evaluate(js); await p.waitForTimeout(700); }
  if (NEW) await settledNew(p);
  else await p.waitForTimeout(2500);                                 // art, textures and the first layout settle in real time
  await p.evaluate(o => window.__clock.freeze(o), ORIGIN);
  // The page was idle at the freeze, its canvas last drawn at a real time: draw the first frame at the origin.
  if (NEW) await p.evaluate(() => window.__deckmaster.redraw());
  return { p, errors };
}
// Advance the virtual clock. On the new entry, only once no art is loading: what a decode finishing would change shows
// at the same frame on every run.
async function step(p, ms) {
  // Polled from here: the page's own timers are on the frozen clock, so a wait polled inside the page would never look again.
  if (NEW) for (let t0 = Date.now(); await p.evaluate(() => window.__deckmaster.art.pending()) > 0; await new Promise(r => setTimeout(r, 10)))
    if (Date.now() - t0 > 30000) throw new Error("card art still loading after 30 s");
  return p.evaluate(ms => window.__clock.step(ms), ms);
}
// A beat: script in the page (`js`), a snapshot as the bridge sends it (`push`), or a real gesture (`gesture`). A beat's
// `new` is its form on the new entry, where the current client's form (`js` through `__h` and `Live`) has no meaning.
async function beat(p, b) {
  if (NEW && b.new) b = { label: b.label, ...b.new };
  try {
    if (b.push) {
      if (NEW) return await fire(p, `__deckmaster.script.push(${JSON.stringify(b.push)})`);
      await p.pushSnapshot(b.push); return null;
    }
    if (b.gesture) { await gesture(p, b.gesture); return null; }
    return await fire(p, b.js);
  } catch (e) { return e.stack || String(e); }
}
// {drag: {hand: id, dy}}: a hand card dragged straight up; {tap: {card|plate|stack|pile|open: ...}}: a finger tap there;
// {key: "Escape"}: a key pressed. An array is several, in order, each taken (a frame at the same time) before the next.
async function gesture(p, g) {
  if (Array.isArray(g)) {
    for (const [i, one] of g.entries()) { if (i && NEW) await p.evaluate(() => window.__clock.step(0)); await gesture(p, one); }
    return;
  }
  if (g.key) await p.keyboard.press(g.key);
  else if (g.drag) {
    const from = await locate(p, { hand: g.drag.hand }, NEW), m = p.mouse;
    await m.move(from.x, from.y); await m.down();
    for (let i = 1; i <= 8; i++) await m.move(from.x, from.y - g.drag.dy * i / 8);
    await m.up();
  } else if (g.tap) {
    const at = await locate(p, g.tap, NEW);
    await p.touchscreen.tap(at.x, at.y);
  } else throw new Error("unknown gesture " + JSON.stringify(g));
}
const fire = (p, js) => p.evaluate(`(() => { try { ${js}; return null; } catch (e) { return e.stack || String(e); } })()`);

// The motion pass, at 1×: every frame at FPS, with what moved where.
async function motion(ctx, clip, dir) {
  const { p, errors } = await open(ctx, clip), dt = 1000 / FPS, frames = Math.round(clip.ms / dt), beats = [], track = [];
  const due = clip.beats.map(b => ({ ...b, frame: Math.round(b.at / dt) }));
  for (let f = 0; f <= frames; f++) {
    for (const b of due.filter(b => b.frame === f)) beats.push({ frame: f, ms: Math.round(f * dt), label: b.label, err: await beat(p, b) });
    await step(p, f === 0 ? 0 : dt);
    track.push({ frame: f, ms: Math.round(f * dt), ...(await p.evaluate(NEW ? TRACK_NEW : TRACK)) });
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
    audits.push({ frame: e.audit, label: e.label, gate: e.gate, objects: (await p.evaluate(NEW ? TRACK_NEW : TRACK)).objects, ...(e.gate ? await p.evaluate(NEW ? AUDIT_NEW : AUDIT, 4) : { pieces: {} }) });
    await p.screenshot({ path: path.join(dir, name), type: "png" });
  }
  await p.close();
  return { audits, errors };
}

async function record(browser, clip, dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  const context = async scale => { const c = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: scale, hasTouch: true }); await c.addInitScript(CLOCK); return c; };
  let c;
  if (STILLS) {
    // No motion: the stills pass alone, on every clip (gated only where the clip asks for an audit).
    const frames = Math.round(clip.ms / (1000 / FPS));
    c = await context(SCALE); const st = await stills(c, clip, dir, frames, !!clip.audit); await c.close();
    fs.writeFileSync(path.join(dir, "track.json"), JSON.stringify({ clip: clip.name, about: clip.about, fps: FPS, viewport: [1180, 820], beats: [], errors: st.errors, audits: clip.audit ? st.audits : [], frames: [] }));
    return { frames: 0, errors: st.errors };
  }
  c = await context(1);
  const m = await motion(c, clip, dir); await c.close();
  let audits = [], errors = m.errors;
  if (clip.audit) { c = await context(SCALE); const st = await stills(c, clip, dir, m.frames); await c.close(); audits = st.audits; errors = errors.concat(st.errors); }
  fs.writeFileSync(path.join(dir, "track.json"), JSON.stringify({ clip: clip.name, about: clip.about, fps: FPS, viewport: [1180, 820], beats: m.beats, errors, audits, frames: m.track }));
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
const chosen = CLIPS.filter(c => only ? only.has(c.name) : !c.manual && (!NEW || (c.entries || []).includes("new")));
if (NEW && only) for (const c of chosen) if (!(c.entries || []).includes("new")) { console.error(`${c.name}: no new-entry form yet`); process.exit(1); }
const ready = slot().then(() => (BASE ? null : require("./serve.js").serve(0, { dist: NEW }).then(s => { BASE = s.base; process.env.BASE = BASE; })));
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
  for (const clip of chosen) {
    const t0 = Date.now(), r = await record(browser, clip, path.join(outDir, clip.name));
    console.log(`${clip.name}: ${r.frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s${r.errors.length ? " · errors: " + r.errors.slice(0, 3).join(" | ") : ""}`);
  }
  await browser.close();
  process.exit(0);   // the server we started would otherwise keep us alive
});
