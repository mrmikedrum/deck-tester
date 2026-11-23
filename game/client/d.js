// Variation D, "Felt": a calm felt table seen from above. Each player has a mat around it (you at the bottom, Bo
// across, Ana left, Cy right), laid out as players do: creatures toward the centre, other permanents behind them,
// lands and mana at the player's own edge. The camera starts zoomed in on you, follows the recent casts, and can be
// pinched out to the whole table. Cards are the kit's named table cards at one world size; the camera scales them.
(function () {
  const P = window.Proto, K = window.Kit, G = P.G, el = P.el;
  const CW = 100, PAD = 140;
  let root, vp, world, table, layer, stackZone, rulesBox, toastEl;
  let cam = { x: 0, y: 0, s: 1 }, mode = "home", director = null, played = false;
  const mats = {}, rects = {};

  // ---- Building the table --------------------------------------------------------------------------------------
  function zonePile(pid, label, ids, back) {
    const z = el("div", "zpile");
    const slot = el("div", "zslot");
    if (back) slot.appendChild(el("div", "zback"));
    else if (ids.length) slot.appendChild(K.card(P.card(ids[0]), { cw: 60, press: false }));
    else slot.classList.add("empty");
    z.appendChild(slot);
    z.appendChild(el("div", "zcount", back ? P.player(pid).library : ids.length));
    z.appendChild(el("div", "zlabel", label));
    if (!back) P.press(z, { tap: () => P.sheet(`${P.player(pid).name} · ${label}`, ids), peek: false });
    return z;
  }
  function rail(pid) {
    const p = P.player(pid), r = el("div", "rail");
    const plate = P.plate(pid);
    P.press(plate, { tap: () => flyTo(pid), peek: false });
    r.appendChild(plate);
    const zones = el("div", "zones");
    zones.appendChild(zonePile(pid, "Library", [], true));
    zones.appendChild(zonePile(pid, "Graveyard", p.graveyard));
    zones.appendChild(zonePile(pid, "Exile", p.exile));
    if (p.command.length) {
      const z = zonePile(pid, "Command", p.command);
      const c = P.card(p.command[0]);
      if (c.commanderCasts) z.appendChild(el("div", "ztax", `tax {${c.commanderCasts * 2}}`));
      zones.appendChild(z);
    }
    r.appendChild(zones);
    return r;
  }
  const opts = { cw: CW, max: 5 };
  // Fold the least important items of a row into one pile: the commander and the biggest stay out on the felt.
  function fold(items, max, title) {
    if (items.length <= max) return items;
    const power = it => { const c = P.card(it.ids[0]); return c.commander ? 99 : P.isCreature(c) ? (c.power != null ? c.power : P.basePT(c).power) : P.isPW(c) ? 50 : 0; };
    const ranked = items.map((it, i) => ({ it, i, p: power(it) })).sort((a, b) => b.p - a.p || a.i - b.i);
    const keep = new Set(ranked.slice(0, max - 1).map(r => r.it));
    const rest = items.filter(it => !keep.has(it));
    return [...items.filter(it => keep.has(it)), { kind: "cascade", ids: rest.flatMap(it => it.ids), title }];
  }
  function row(items, cls) {
    const r = el("div", "row " + cls);
    items.forEach(it => r.appendChild(K.item(it, opts)));
    return r;
  }
  function grid(items, cls, rows, rtl) {
    const g = el("div", "zone " + cls + (rtl ? " rtl" : ""));
    g.style.gridTemplateRows = `repeat(${rows}, auto)`;
    items.forEach(it => g.appendChild(K.item(it, opts)));
    return g;
  }
  function buildMat(pid) {
    const a = K.arrange(pid), side = pid === "ana" || pid === "cy";
    const m = el("div", "mat " + P.seatClass(pid) + (side ? " side" : " horiz") + (G.active === pid ? " active" : ""));
    m.dataset.pid = pid;
    if (!side) {
      const rows = [
        row(fold(a.creatures, pid === "you" ? 9 : 11, "Smaller creatures"), "creatures"),
        row(K.overflow(a.others, pid === "you" ? 9 : 10, "More permanents"), "others"),
        row(a.mana, "mana"),
      ];
      const col = el("div", "rows");
      (pid === "bo" ? rows.reverse() : rows).forEach(r => col.appendChild(r));
      // Your own plate and zones live in screen space, so they never leave view.
      if (pid === "bo") { m.appendChild(col); m.appendChild(rail(pid)); }
      else m.appendChild(col);
    } else {
      const zones = [
        grid(a.mana, "mana", 3),
        grid(K.overflow(a.others, 8, "More permanents"), "others", 3),
        grid(fold(a.creatures, 12, "Smaller creatures"), "creatures", 3, pid === "ana"),
      ];
      const z = el("div", "zonesrow");
      (pid === "cy" ? zones.reverse() : zones).forEach(x => z.appendChild(x));
      m.appendChild(rail(pid));
      m.appendChild(z);
    }
    return m;
  }
  function buildStack() {
    const z = el("div", "stackzone");
    z.appendChild(el("div", "szlabel", "The stack <span>· the top resolves first</span>"));
    const line = el("div", "sline");
    G.stack.slice().reverse().forEach((it, k) => {
      const s = el("div", "sslot " + P.seatClass(it.controller) + (k === G.stack.length - 1 ? " top" : ""));
      s.dataset.stack = it.id;
      const who = P.player(it.controller).name;
      s.appendChild(K.card(P.card(it.card), { cw: 112 }));
      s.appendChild(el("div", "shead", `<b>${k + 1}</b>${P.esc(who)}${k === G.stack.length - 1 ? '<em>top</em>' : ""}`));
      if (it.targets.length) s.appendChild(el("div", "stgt", "→ " + it.targets.map(P.targetLabel).map(P.esc).join(", ")));
      line.appendChild(s);
    });
    z.appendChild(line);
    return z;
  }

  function build() {
    vp = el("div", "vp");
    world = el("div", "world");
    table = el("div", "tabletop");
    world.appendChild(table);
    ["bo", "ana", "cy", "you"].forEach(pid => { mats[pid] = buildMat(pid); world.appendChild(mats[pid]); });
    stackZone = buildStack();
    world.appendChild(stackZone);
    layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    layer.setAttribute("class", "wlayer");
    world.appendChild(layer);
    vp.appendChild(world);
    root.appendChild(vp);
    buildHud();
    K.hand(root, { gap: 64 });
    layout();
    gestures();
  }

  // Place the mats around a centre band: Bo above, you below, Ana and Cy either side of the stack.
  function layout() {
    const size = e => ({ w: e.offsetWidth, h: e.offsetHeight });
    const m = {};
    Object.keys(mats).forEach(k => (m[k] = size(mats[k])));
    const S = size(stackZone);
    const gapX = 110, gapY = 100;
    const bandH = Math.max(m.ana.h, m.cy.h, S.h + 60);
    const bandW = m.ana.w + gapX + S.w + gapX + m.cy.w;
    const W = Math.max(bandW, m.you.w, m.bo.w) + PAD * 2;
    const cx = W / 2;
    const place = (k, x, y, w, h) => { rects[k] = { x, y, w, h }; const e = k === "stack" ? stackZone : mats[k]; e.style.left = x + "px"; e.style.top = y + "px"; };
    place("bo", cx - m.bo.w / 2, PAD, m.bo.w, m.bo.h);
    const bandTop = PAD + m.bo.h + gapY;
    const bandLeft = cx - bandW / 2;
    place("ana", bandLeft, bandTop + (bandH - m.ana.h) / 2, m.ana.w, m.ana.h);
    place("cy", bandLeft + bandW - m.cy.w, bandTop + (bandH - m.cy.h) / 2, m.cy.w, m.cy.h);
    const sx = bandLeft + m.ana.w + gapX + ((bandW - m.ana.w - m.cy.w - 2 * gapX) - S.w) / 2;
    place("stack", sx, bandTop + bandH - S.h - 10, S.w, S.h);
    const youTop = bandTop + bandH + 64;
    place("you", cx - m.you.w / 2, youTop, m.you.w, m.you.h);
    const H = youTop + m.you.h + PAD;
    world.style.width = W + "px";
    world.style.height = H + "px";
    rects.world = { x: 0, y: 0, w: W, h: H };
    Object.assign(table.style, { left: PAD / 2 + "px", top: PAD / 2 + "px", width: W - PAD + "px", height: H - PAD + "px" });
    layer.setAttribute("width", W);
    layer.setAttribute("height", H);
    layer.setAttribute("viewBox", `0 0 ${W} ${H}`);
  }

  // ---- Camera ------------------------------------------------------------------------------------------------
  function apply(ms = 900) {
    world.style.transition = ms ? `transform ${ms}ms cubic-bezier(.45,.05,.2,1)` : "none";
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`;
  }
  function view() {
    const r = vp.getBoundingClientRect();
    return { w: r.width, h: r.height, t: 66, b: 118, l: 24, r: 24 };
  }
  function fit(rect, { max = 1, min = 0.2 } = {}) {
    const v = view(), aw = v.w - v.l - v.r, ah = v.h - v.t - v.b;
    const s = Math.max(min, Math.min(max, aw / rect.w, ah / rect.h));
    cam = { s, x: v.l + aw / 2 - (rect.x + rect.w / 2) * s, y: v.t + ah / 2 - (rect.y + rect.h / 2) * s };
  }
  const union = (a, b) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  // Where an element sits in world coordinates, whatever the camera is doing.
  function wrect(e) {
    const wr = world.getBoundingClientRect(), s = wr.width / world.offsetWidth, r = e.getBoundingClientRect();
    return { x: (r.left - wr.left) / s, y: (r.top - wr.top) / s, w: r.width / s, h: r.height / s };
  }
  // Home: the stack and the front of your mat (creatures and permanents); your lands sit under the hand.
  function homeRect() {
    const you = rects.you, st = rects.stack, rows = mats.you.querySelector(".rows");
    const others = rows.querySelector(".others");
    const bottom = you.y + others.offsetTop + rows.offsetTop + others.offsetHeight + 24;
    return { x: you.x, y: st.y - 6, w: you.w, h: bottom - st.y + 6 };
  }
  function goHome(ms) { mode = "home"; fit(homeRect(), { max: 1, min: 0.72 }); apply(ms); }
  function overview(ms) { mode = "overview"; fit(rects.world, { max: 1, min: 0.1 }); apply(ms); }
  function flyTo(pid, ms) {
    if (pid === "you") return goHome(ms);
    mode = "seat:" + pid;
    fit(pad(rects[pid], 20), { max: 1, min: 0.55 });
    apply(ms);
  }
  const pad = (r, n) => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });
  function refit() {
    if (mode === "home") goHome(0);
    else if (mode === "overview") overview(0);
    else if (mode.startsWith("seat:")) flyTo(mode.slice(5), 0);
  }
  function focusCard(id) {
    const e = findCard(id);
    if (!e) return;
    const r = wrect(e);
    mode = "free";
    fit(pad(r, 220), { max: 1.15, min: 0.8 });
    apply();
    const all = e.classList.contains("tc") ? [e] : [...e.querySelectorAll(".tc")];
    const t = all[all.length - 1] || e;
    t.classList.remove("pulse");
    setTimeout(() => t.classList.add("pulse"), 700);
    setTimeout(() => t.classList.remove("pulse"), 4400);
  }
  function findCard(id) {
    const direct = world.querySelector(`.tc[data-id="${id}"]`);
    if (direct && !direct.closest(".pile")) return direct;
    const pile = [...world.querySelectorAll(".pile")].find(p => (p.dataset.ids || "").split(",").includes(String(id)));
    return pile || direct;
  }

  // ---- Gestures: one finger pans the felt, two pinch, double-tap a mat to fly there ------------------------------
  function gestures() {
    const pts = new Map();
    let g = null, moved = false, lastTap = { t: 0, x: 0, y: 0 };
    const hudHit = e => e.target.closest(".hud, .hand, .lab, .switcher, .scrim, .sift");
    const begin = () => {
      const a = [...pts.values()];
      if (a.length === 1) g = { kind: "pan", x0: a[0].x, y0: a[0].y, cam0: { ...cam } };
      else if (a.length >= 2) {
        const [p, q] = a;
        g = { kind: "pinch", d0: Math.hypot(p.x - q.x, p.y - q.y), m0: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, cam0: { ...cam } };
      }
    };
    vp.addEventListener("pointerdown", e => {
      if (hudHit(e)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) moved = false;
      begin();
      if (director && pts.size) { director.cancel(); director = null; revealAll(); }
    }, true);
    vp.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const a = [...pts.values()];
      if (g.kind === "pan") {
        const dx = a[0].x - g.x0, dy = a[0].y - g.y0;
        if (!moved && Math.hypot(dx, dy) < 10) return;
        moved = true; mode = "free";
        cam = { s: g.cam0.s, x: g.cam0.x + dx, y: g.cam0.y + dy };
        apply(0);
      } else if (a.length >= 2) {
        const [p, q] = a, d = Math.hypot(p.x - q.x, p.y - q.y), mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const s = Math.max(0.12, Math.min(1.8, g.cam0.s * d / g.d0));
        const wx = (g.m0.x - g.cam0.x) / g.cam0.s, wy = (g.m0.y - g.cam0.y) / g.cam0.s;
        cam = { s, x: mid.x - wx * s, y: mid.y - wy * s };
        moved = true; mode = "free";
        apply(0);
      }
    }, true);
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      const wasMoved = moved;
      if (wasMoved) e.stopPropagation();
      if (pts.size) { begin(); return; }
      g = null;
      if (wasMoved || e.type === "pointercancel") return;
      if (e.target.closest(".tc, .pile, .unit, .zpile, .plate")) return;
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        lastTap.t = 0;
        const mat = e.target.closest(".mat");
        if (mat) flyTo(mat.dataset.pid);
        else (mode === "overview" ? goHome() : overview());
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    };
    vp.addEventListener("pointerup", end, true);
    vp.addEventListener("pointercancel", end, true);
    vp.addEventListener("wheel", e => {
      e.preventDefault();
      const s = Math.max(0.12, Math.min(1.8, cam.s * Math.exp(-e.deltaY * 0.0015)));
      const wx = (e.clientX - cam.x) / cam.s, wy = (e.clientY - cam.y) / cam.s;
      cam = { s, x: e.clientX - wx * s, y: e.clientY - wy * s };
      mode = "free"; apply(0);
    }, { passive: false });
  }

  // ---- Screen-space controls ----------------------------------------------------------------------------------
  function hudButton(label, fn, cls = "") {
    const b = el("button", "hbtn " + cls, label);
    b.addEventListener("click", fn);
    return b;
  }
  function buildHud() {
    const nav = el("div", "hud nav");
    nav.appendChild(hudButton("You", () => goHome()));
    ["ana", "bo", "cy"].forEach(pid => nav.appendChild(hudButton(P.esc(P.player(pid).name), () => flyTo(pid), P.seatClass(pid) + " seatbtn")));
    nav.appendChild(hudButton("Whole table", () => overview()));
    root.appendChild(nav);

    const me = el("div", "hud me");
    me.appendChild(rail("you"));
    root.appendChild(me);

    const rules = P.rules();
    rulesBox = el("div", "hud rules");
    const head = hudButton(`<span class="rdot"></span>${rules.length} rules in effect`, () => rulesBox.classList.toggle("open"), "rhead");
    rulesBox.appendChild(head);
    const list = el("div", "rlist");
    rules.forEach(r => {
      const b = el("button", "rule " + P.seatClass(r.controller));
      b.innerHTML = `<i></i><span>${P.esc(r.text)}</span><small>${P.esc(P.name(P.card(r.id)))} · ${P.esc(P.player(r.controller).name)}</small>`;
      b.addEventListener("click", () => { rulesBox.classList.remove("open"); focusCard(r.id); });
      list.appendChild(b);
    });
    rulesBox.appendChild(list);
    root.appendChild(rulesBox);

    const prio = el("div", "hud prio");
    prio.innerHTML = `<div><div style="font-weight:700">You have priority</div><div class="phase">${P.esc(P.player(G.active).name)}'s turn ${G.turn} · ${P.esc(G.phase)}</div></div>`;
    const pass = el("button", "btn", "Pass");
    pass.addEventListener("click", () => toast("Passed (prototype: nothing happens)"));
    prio.appendChild(pass);
    root.appendChild(prio);

    K.lab(root, { replay: () => play(), at: { right: 14, top: 12 } });
    root._onTapped = () => { layout(); refit(); drawArrows(); };
  }
  function toast(t) {
    if (toastEl) toastEl.remove();
    toastEl = el("div", "hud dtoast", P.esc(t));
    root.appendChild(toastEl);
    setTimeout(() => toastEl && toastEl.remove(), 1800);
  }

  // ---- The stack's arrows, drawn in world space so they move with the camera -----------------------------------
  function drawArrows() {
    layer.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    G.stack.forEach(it => {
      const from = stackZone.querySelector(`.sslot[data-stack="${it.id}"]`);
      if (!from || from.classList.contains("pending")) return;
      it.targets.forEach(t => {
        const to = t.stack ? stackZone.querySelector(`.sslot[data-stack="${t.stack}"]`) : t.card ? findCard(t.card) : null;
        if (!to || to.classList.contains("pending")) return;
        const a = wrect(from.querySelector(".tc")), b = wrect(to.querySelector(".tc") || to);
        const x1 = a.x + a.w * 0.35, y1 = a.y + 4, x2 = b.x + b.w * 0.65, y2 = b.y + 4;
        const lift = Math.max(70, Math.abs(x2 - x1) * 0.45);
        const p = document.createElementNS(ns, "path");
        p.setAttribute("d", `M${x1},${y1} C${x1},${y1 - lift} ${x2},${y2 - lift} ${x2},${y2 - 6}`);
        p.setAttribute("stroke", P.seatColor(it.controller));
        layer.appendChild(p);
        const h = document.createElementNS(ns, "path");
        h.setAttribute("d", `M${x2 - 9},${y2 - 18} L${x2},${y2 - 2} L${x2 + 9},${y2 - 18} Z`);
        h.setAttribute("fill", P.seatColor(it.controller));
        h.setAttribute("class", "head");
        layer.appendChild(h);
      });
    });
  }

  // ---- The director: follow the recent casts, building the stack as it goes -------------------------------------
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function slots() { return [...stackZone.querySelectorAll(".sslot")]; }
  function revealAll() { slots().forEach(s => s.classList.remove("pending")); drawArrows(); }
  async function focusStep(step) {
    if (step.pid === "you") { goHome(1100); await wait(1150); drawArrows(); return; }
    const r = union(pad(rects[step.pid], 10), rects.stack);
    mode = "director";
    fit(r, { max: 1, min: 0.5 });
    apply(1000);
    await wait(1050);
    // The spell rises from its caster's mat, then travels to the stack.
    const slot = stackZone.querySelector(`.sslot[data-stack="${step.stack}"]`);
    const src = rects[step.pid];
    const ghost = K.card(P.card(step.card), { cw: 112, press: false });
    ghost.classList.add("ghost");
    const g0 = { x: src.x + src.w / 2 - 56, y: src.y + src.h / 2 - 78 };
    Object.assign(ghost.style, { left: g0.x + "px", top: g0.y + "px" });
    world.appendChild(ghost);
    await wait(650);
    const target = wrect(slot.querySelector(".tc"));
    ghost.style.transition = "left .8s cubic-bezier(.5,0,.2,1), top .8s cubic-bezier(.5,0,.2,1), opacity .2s .75s";
    ghost.style.left = target.x + "px";
    ghost.style.top = target.y + "px";
    await wait(780);
    slot.classList.remove("pending");
    ghost.style.opacity = "0";
    drawArrows();
    setTimeout(() => ghost.remove(), 300);
  }
  function play() {
    if (director) director.cancel();
    slots().forEach(s => s.classList.add("pending"));
    drawArrows();
    goHome(0);
    director = K.direct(focusStep, { dwell: 900, onDone: () => { director = null; } });
  }

  P.register("d", {
    title: "Felt",
    mount(r) { root = r; r.dataset.tapped = "turn"; build(); },
    show() {
      layout();
      refit();
      drawArrows();
      if (!played) { played = true; slots().forEach(s => s.classList.add("pending")); goHome(0); setTimeout(play, 700); }
    },
    hide() { if (director) { director.cancel(); director = null; revealAll(); } K.caption(null); },
  });
  window.protoD = { play, goHome, overview, flyTo, focusCard, revealAll, cancel: () => { if (director) { director.cancel(); director = null; } revealAll(); } };
})();
