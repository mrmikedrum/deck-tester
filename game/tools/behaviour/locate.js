// ---- The one locator: where a thing is on screen -----------------------------------------------------------------------
// {card: id}  a card on the table or on the stack (a pile counts for any of its cards)
// {plate: pid} a player's life plate ("you","ana","bo","cy")
// {stack: id} a spell on the stack, by its card id
// {hand: id}  a card in the hand fan (DOM)
// {pile: pid} the biggest pile on a player's side (the most cards)
// {open: true} open table nearest the middle of the screen: nothing there to pick, clear of the stack
// {sifted: id} a card laid out in an open sift: a tap there acts on that card alone
// {place: id} a card's place off its drawn face (the arrangement engine's target: a tapped card lying turned in a slot
//             a standing card's height wide is reached there too).
// Returns a screen point (CSS px) where a tap hits that thing, verified against the client's own picking.
async function locate(page, what) {
  const pt = await page.evaluate(point, what);
  if (!pt) throw new Error("cannot locate " + JSON.stringify(what));
  return pt;
}

// Locator inputs: the committed plan's hit groups (their quads on screen), checked against its own picking and against
// what the page has on top at the point (the canvas, not the hand or a panel).
function point(w) {
  const dm = window.__deckmaster, W = innerWidth, H = innerHeight;
  if (w.place != null) {
    const g = dm.hits().find(x => x.members.includes(w.place)), face = g && dm.scene.faces()[g.id];
    if (!g || !face) return null;
    const inside = (q, x, y) => {
      let pos = false, neg = false;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = Array.isArray(q[i]) ? q[i] : [q[i].x, q[i].y], [bx, by] = Array.isArray(q[(i + 1) % 4]) ? q[(i + 1) % 4] : [q[(i + 1) % 4].x, q[(i + 1) % 4].y];
        const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        if (c > 0) pos = true; else if (c < 0) neg = true;
      }
      return !(pos && neg);
    };
    const xs = g.quad.map(p => p.x), ys = g.quad.map(p => p.y), canvas = document.getElementById("stage");
    for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) {
      const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * (0.04 + 0.92 * i / 24), y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * (0.04 + 0.92 * j / 24);
      if (!inside(g.quad, x, y) || inside(face.quad, x, y) || document.elementFromPoint(x, y) !== canvas) continue;
      if (dm.scene.pick(x, y)?.id === g.id) return { x, y };
    }
    return null;
  }
  if (w.sifted != null) {                                  // the sift's piece for the card, where its own picking finds it
    const id = `sift:${w.sifted}`, b = (dm.scene.boxes() || []).find(o => o.id === id && o.visible !== false), canvas = document.getElementById("stage");
    if (!b) return null;
    const [l, t, r, btm] = b.box;
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const x = l + (r - l) * (0.5 + (i % 2 ? 1 : -1) * 0.45 * Math.ceil(i / 2) / 6), y = t + (btm - t) * (0.5 + (j % 2 ? 1 : -1) * 0.45 * Math.ceil(j / 2) / 6);
      if (x < 2 || y < 2 || x > W - 2 || y > H - 2 || document.elementFromPoint(x, y) !== canvas) continue;
      if (dm.scene.pick(x, y)?.id === id) return { x, y };
    }
    return null;
  }
  if (w.hand != null) {
    const c = document.querySelector(`.g-hand .hcard[data-id="${w.hand}"]`);
    if (!c) return null;
    const r = c.getBoundingClientRect();
    for (let f = 0.06; f < 1; f += 0.04) for (const g of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const x = r.left + r.width * f, y = r.top + r.height * g, top = document.elementFromPoint(x, y);
      if (top && top.closest(".hcard") === c) return { x, y };
    }
    return null;
  }
  const PIDS = ["you", "ana", "bo", "cy"], who = w.plate != null ? w.plate : w.pile, seat = who != null ? dm.seats()[PIDS.indexOf(who)] : null;
  if (w.plate != null) {                                   // a nameplate is chrome: its button, where nothing covers it
    const el = document.querySelector(`.l-plate[data-plate="${CSS.escape(String(seat))}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    for (const f of [0.3, 0.5, 0.15, 0.7, 0.85]) {
      const x = r.left + r.width * f, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
      if (top && top.closest(".l-plate") === el) return { x, y };
    }
    return null;
  }
  const canvas = document.getElementById("stage");
  if (w.open) {                                            // the open table: the canvas, nothing picked, clear of the stack
    const quads = [...(dm.stack() || []).map(s => s.quad), ...dm.hits().filter(g => g.kind === "stack").map(g => g.quad)].filter(Boolean);
    const rects = quads.map(q => { const xs = q.map(p => p.x), ys = q.map(p => p.y); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }), pts = [];
    for (let y = 40; y < H - 40; y += 12) for (let x = 40; x < W - 40; x += 12) pts.push([x, y]);
    pts.sort((a, b) => Math.hypot(a[0] - W / 2, a[1] - H / 2) - Math.hypot(b[0] - W / 2, b[1] - H / 2));
    const clear = (x, y) => !rects.some(r => x > r.x - 20 && x < r.x + r.w + 20 && y > r.y - 20 && y < r.y + r.h + 20);
    const at = pts.find(([x, y]) => document.elementFromPoint(x, y) === canvas && !dm.scene.pick(x, y) && clear(x, y));
    return at ? { x: at[0], y: at[1] } : null;
  }
  const pile = w.pile != null ? dm.hits().filter(g => g.seat === seat && ["pile", "well", "summary"].includes(g.kind) && g.members.length > 1)
    .sort((a, b) => b.members.length - a.members.length)[0] : null;
  if (w.pile != null && !pile) return null;
  const wanted = g => w.plate != null ? g.kind === "plate" && g.seat === seat
    : w.pile != null ? g.id === pile.id
    : w.stack != null ? g.kind === "stack" && g.members.includes(w.stack)
    : g.members.includes(w.card);
  const groups = dm.hits().filter(wanted).sort((a, b) => b.order - a.order);
  // Where it rests, then where it is drawn now (a card still on its way, as a fighter stepping out to the combat row):
  // Verify the point against what the scene drew.
  const boxes = dm.scene.boxes ? dm.scene.boxes() : [];
  const regions = groups.flatMap(g => {
    const xs = g.quad.map(p => p.x), ys = g.quad.map(p => p.y), drawn = boxes.find(o => o.id === g.id);
    return [[g, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], ...(drawn ? [[g, drawn.box[0], drawn.box[2], drawn.box[1], drawn.box[3]]] : [])];
  });
  for (const [g, l, r, t, b] of regions) {
    const hits = [];
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const x = l + (r - l) * (0.05 + 0.9 * i / 12), y = t + (b - t) * (0.05 + 0.9 * j / 12);
      if (x < 2 || y < 2 || x > W - 2 || y > H - 2 || document.elementFromPoint(x, y) !== canvas) continue;
      const hit = dm.scene.pick(x, y);
      if (hit && hit.id === g.id) hits.push([x, y]);
    }
    if (hits.length) {                                       // the hit nearest the middle of the hits: away from edges
      const cx = hits.reduce((a, p) => a + p[0], 0) / hits.length, cy = hits.reduce((a, p) => a + p[1], 0) / hits.length;
      hits.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
      return { x: hits[0][0], y: hits[0][1] };
    }
  }
  return null;
}

module.exports = { locate };
