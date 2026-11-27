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
    if (faces[b.id]) Object.assign(rec, { face: faces[b.id].width, stands: faces[b.id].standing });
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

module.exports = { TRACK, AUDIT };
