// Variation E, "Standees": a real 3D table where height means something. Untapped creatures stand up on the felt
// facing the camera; tapped ones lie flat, knocked over. Everything else lies flat: permanents that do things, then
// mana piles and the player's library, graveyard and exile at their edge. The camera starts close on your side,
// follows the recent casts around the table, then comes home. Plates, priority, rules and the hand stay on screen.
(function () {
  const P = Proto, K = Kit, G = P.G, el = P.el;
  const TILT = 40, CW = 96, STACK_CW = 118;
  const HUD = { top: 100, right: 118, bottom: 128, left: 118 };   // screen space kept clear when framing (×u)
  const MAX_STANDEES = { you: 9, bo: 9, ana: 7, cy: 7 };
  let root, view, plane, world, svg, toastEl, plates = {};
  let cam = { x: 0, y: 0, s: 1 }, anim = 0, framed = false, director = null, arrowRaf = 0;
  const cosT = () => Math.cos(TILT * Math.PI / 180);
  const u = () => P.unit();

  function frame() {
    const w = root.clientWidth, h = root.clientHeight, k = u();
    const l = HUD.left * k, r = HUD.right * k, t = HUD.top * k, b = HUD.bottom * k;
    return { w: w - l - r, h: h - t - b, cx: l + (w - l - r) / 2, cy: t + (h - t - b) / 2 };
  }

  // ---- Camera --------------------------------------------------------------------------------------------
  function apply() {
    const f = frame();
    view.style.perspectiveOrigin = `${f.cx}px ${f.cy}px`;
    plane.style.transform = `translate(${f.cx}px, ${f.cy}px) rotateX(${TILT}deg) scale(${cam.s}) translate(${-cam.x}px, ${-cam.y}px)`;
    root.classList.toggle("e-far", cam.s < 0.5);
    scheduleArrows();
  }
  const clampS = s => Math.max(0.28, Math.min(1.9, s));
  function flyTo(t, ms = 700) {
    cancelAnimationFrame(anim);
    return new Promise(done => {
      const from = { ...cam }, t0 = performance.now();
      const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      if (ms <= 0) { Object.assign(cam, { x: t.x, y: t.y, s: t.s }); apply(); done(); return; }
      const step = now => {
        const k = Math.min(1, (now - t0) / ms), e = ease(k);
        // pull back a little mid-flight so the move reads as travelling across the table
        const dip = Math.sin(Math.PI * k) * 0.12;
        cam.s = Math.exp(Math.log(from.s) + (Math.log(t.s) - Math.log(from.s)) * e) * (1 - dip);
        cam.x = from.x + (t.x - from.x) * e;
        cam.y = from.y + (t.y - from.y) * e;
        apply();
        if (k < 1) anim = requestAnimationFrame(step); else done();
      };
      anim = requestAnimationFrame(step);
    });
  }
  function rectOf(e) {
    let x = 0, y = 0, n = e;
    while (n && n !== world) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { left: x, top: y, w: e.offsetWidth, h: e.offsetHeight };
  }
  // Where the camera must be for these elements to fill the frame, measured on screen (perspective makes near
  // things bigger, so a world-space fit is off): adjust, measure the projected boxes, repeat; then restore.
  function solve(els, { pad = 10, min = 0.45, max = 1.2 } = {}) {
    const f = frame(), save = { ...cam };
    const R = root.getBoundingClientRect();
    const tl = f.cx - f.w / 2 + pad + R.left, tt = f.cy - f.h / 2 + pad + R.top, tw = f.w - 2 * pad, th = f.h - 2 * pad;
    for (let i = 0; i < 6; i++) {
      apply();
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      els.forEach(e => { const q = e.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
      const k = Math.min(tw / (r - l), th / (b - t));
      cam.x += ((l + r) / 2 - (tl + tw / 2)) / cam.s;
      cam.y += ((t + b) / 2 - (tt + th / 2)) / (cam.s * cosT());
      cam.s = Math.max(min, Math.min(max, cam.s * Math.pow(k, 0.85)));
    }
    const out = { ...cam };
    Object.assign(cam, save);
    apply();
    return out;
  }
  const seatEls = pid => { const m = world.querySelector(`[data-seat="${pid}"]`); return [m, ...m.querySelectorAll(".e-up")]; };
  function seatTo(pid, ms = 700) {
    focusPlate(pid);
    return flyTo(solve(seatEls(pid)), ms);
  }
  // Home: your side close up, with the stack standing just beyond your creatures.
  function home(ms = 700) {
    focusPlate("you");
    return flyTo(solve([...seatEls("you"), ...world.querySelectorAll(".e-center .e-up")], { min: 0.5 }), ms);
  }
  function overview(ms) {
    focusPlate(null);
    const f = frame(), W = world.offsetWidth, H = world.offsetHeight;
    return flyTo({ x: W / 2, y: H / 2, s: clampS(Math.min(f.w / W, f.h / (H * cosT())) * 1.04) }, ms);
  }
  function focusPlate(pid) { Object.entries(plates).forEach(([k, e]) => e.classList.toggle("e-focus", k === pid)); }

  // ---- The world -------------------------------------------------------------------------------------------
  function render() {
    world.innerHTML = "";
    const cell = (area, child) => { const c = el("div", "e-cell e-" + area); c.style.gridArea = area; c.appendChild(child); world.appendChild(c); };
    ["bo", "ana", "cy", "you"].forEach(pid => cell(pid, seat(pid)));
    cell("center", center());
  }

  // A standee: the card rises from its base line and faces the camera; tapped ones lie flat instead.
  function standee(it, cw = CW) {
    const node = K.item(it, { cw, max: 4 });
    const first = P.card(it.ids[0]);
    const lying = it.kind !== "cascade" && first.tapped;
    const slot = el("div", "e-slot" + (lying ? " e-lying" : ""));
    slot.appendChild(el("div", "e-shadow"));
    const up = el("div", "e-up");
    up.appendChild(node);
    slot.appendChild(up);
    return slot;
  }

  function seat(pid) {
    const p = P.player(pid), a = K.arrange(pid);
    const mat = el("div", "e-mat " + P.seatClass(pid));
    mat.dataset.seat = pid;
    const cmd = P.card(p.commander[0]);
    mat.appendChild(el("div", "e-matname", `${P.esc(p.name)}<span>${P.esc(P.printed(cmd).name.split(",")[0])}</span>`));

    const stands = el("div", "e-row e-stands");
    const items = K.overflow(a.creatures, MAX_STANDEES[pid], "More creatures");
    items.forEach(it => stands.appendChild(standee(it)));
    if (!items.length) stands.appendChild(el("div", "e-empty", "No creatures"));
    mat.appendChild(stands);

    if (a.others.length) {
      const others = el("div", "e-row e-flat");
      a.others.forEach(it => others.appendChild(K.item(it, { cw: CW * 0.9 })));
      mat.appendChild(others);
    }

    const edge = el("div", "e-row e-edge");
    a.mana.forEach(it => edge.appendChild(K.item(it, { cw: CW * 0.78, max: 5 })));
    const sum = a.manaSummary;
    const ms = el("div", "e-manasum", `<b>${sum.untapped}</b><span>/${sum.total} untapped</span><i>${sum.colors.map(c => `<em class="m-${c}"></em>`).join("")}</i>`);
    edge.appendChild(ms);
    edge.appendChild(el("div", "e-gap"));
    edge.appendChild(zones(p));
    mat.appendChild(edge);
    return mat;
  }

  // Library, graveyard, exile and command zone as physical piles at the player's edge.
  function zones(p) {
    const box = el("div", "e-zones");
    const cw = CW * 0.72;
    const lib = el("div", "e-pile e-lib", `<div class="e-back" style="--cw:${cw}px"></div><b>${p.library}</b>`);
    lib.appendChild(el("div", "e-zl", "Library"));
    box.appendChild(lib);
    const zone = (ids, title, cls) => {
      if (!ids.length) return;
      const w = el("div", "e-pile " + cls);
      w.appendChild(K.stack(ids, { cw, title: `${p.name}: ${title}` }));
      if (ids.length === 1) {   // a lone card has no pile badge or sift: add both
        const only = w.firstChild;
        w.appendChild(el("div", "e-one", "1"));
        only.addEventListener("click", () => K.sift(ids, only, `${p.name}: ${title}`));
      }
      w.appendChild(el("div", "e-zl", title + (cls === "e-cmdz" ? ` · tax {${(P.card(ids[0]).commanderCasts || 0) * 2}}` : "")));
      box.appendChild(w);
    };
    zone(p.graveyard, "Graveyard", "e-gy");
    zone(p.exile, "Exile", "e-ex");
    zone(p.command, "Command zone", "e-cmdz");
    return box;
  }

  // The stack stands in the middle of the table, bottom to top, left to right.
  function center() {
    const c = el("div", "e-centerwrap");
    const row = el("div", "e-row e-stack");
    G.stack.slice().reverse().forEach((s, i) => {
      const card = P.card(s.card);
      const slot = el("div", "e-slot e-sslot " + P.seatClass(s.controller));
      slot.dataset.stack = s.id;
      slot.appendChild(el("div", "e-shadow"));
      const up = el("div", "e-up");
      const t = K.card(card, { cw: STACK_CW });
      t.dataset.stack = s.id;
      up.appendChild(t);
      up.appendChild(el("div", "e-sidx", String(i + 1)));
      slot.appendChild(up);
      const cap = el("div", "e-scap", `<b>${P.esc(P.player(s.controller).name)}</b>${s.targets.length ? " → " + P.esc(s.targets.map(P.targetLabel).join(", ")) : ""}`);
      slot.appendChild(cap);
      row.appendChild(slot);
    });
    const label = el("div", "e-stacklabel", `The stack · ${G.stack.length}`);
    c.appendChild(row);
    c.appendChild(label);
    return c;
  }

  // ---- Stack arrows in screen space (cards are 3D, so measure their projected boxes) -----------------------
  function scheduleArrows() { cancelAnimationFrame(arrowRaf); arrowRaf = requestAnimationFrame(drawArrows); }
  function drawArrows() {
    if (!svg || root.hidden) return;
    const R = root.getBoundingClientRect();
    let out = "";
    G.stack.forEach(s => s.targets.forEach(t => {
      if (!t.stack) return;
      if (world.querySelector(`.e-sslot.e-pending[data-stack="${s.id}"]`)) return;
      const a = world.querySelector(`.tc[data-stack="${s.id}"]`), b = world.querySelector(`.tc[data-stack="${t.stack}"]`);
      if (!a || !b) return;
      const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
      const x1 = r1.left + r1.width / 2 - R.left, y1 = r1.top - R.top + 4, x2 = r2.left + r2.width / 2 - R.left, y2 = r2.top - R.top + 4;
      const lift = Math.max(26, Math.abs(x2 - x1) * 0.32);
      const col = P.seatColor(s.controller);
      out += `<path d="M${x1},${y1} C${x1},${y1 - lift} ${x2},${y2 - lift} ${x2},${y2 - 6}" stroke="${col}" marker-end="url(#e-ah-${s.controller})"/>`;
    }));
    const defs = ["you", "ana", "bo", "cy"].map(pid => `<marker id="e-ah-${pid}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${P.seatColor(pid)}"/></marker>`).join("");
    svg.innerHTML = `<defs>${defs}</defs>` + out;
  }

  // ---- Screen-space HUD -------------------------------------------------------------------------------------
  function hud() {
    const h = el("div", "e-hud");
    const ctl = el("div", "e-ctl");
    const btn = (html, label, fn) => { const b = el("button", "e-round", html); b.setAttribute("aria-label", label); b.addEventListener("click", fn); ctl.appendChild(b); };
    btn('<svg viewBox="0 0 24 24"><path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>', "Back to your side", () => home());
    btn('<svg viewBox="0 0 24 24"><path d="M3 3h7v2H5v5H3zm11 0h7v7h-2V5h-5zM3 14h2v5h5v2H3zm16 0h2v7h-7v-2h5z"/></svg>', "Whole table", () => overview());
    btn("−", "Zoom out", () => flyTo({ x: cam.x, y: cam.y, s: clampS(cam.s / 1.4) }, 260));
    btn("+", "Zoom in", () => flyTo({ x: cam.x, y: cam.y, s: clampS(cam.s * 1.4) }, 260));
    h.appendChild(ctl);

    ["bo", "ana", "cy", "you"].forEach(pid => {
      const w = el("div", "e-hp e-hp-" + pid + " " + P.seatClass(pid));
      const pl = P.plate(pid);
      P.press(pl, { tap: () => (pid === "you" ? home() : seatTo(pid)), peek: false });
      w.appendChild(pl);
      plates[pid] = w;
      h.appendChild(w);
    });

    h.appendChild(rulesPanel());
    const prio = el("div", "prio e-prio");
    prio.innerHTML = `<div><div class="e-ptitle">You have priority</div><div class="phase">${P.esc(P.player(G.active).name)}'s turn ${G.turn} · ${P.esc(G.phase)}</div></div>`;
    const pass = el("button", "btn", "Pass");
    pass.addEventListener("click", () => toast("Passed (prototype: nothing happens)"));
    prio.appendChild(pass);
    h.appendChild(prio);
    toastEl = el("div", "e-toast");
    h.appendChild(toastEl);
    return h;
  }
  function rulesPanel() {
    const rules = P.rules().filter(x => x.controller !== P.ME);
    const box = el("div", "e-rp");
    const pill = el("button", "e-rpill", `<b>${rules.length}</b> rules in play`);
    const list = el("div", "e-rlist");
    list.hidden = true;
    rules.forEach(x => {
      const row = el("button", "e-rule " + P.seatClass(x.controller), `<i style="background-image:url('${P.art(P.card(x.id))}')"></i><span>${P.esc(x.text)}</span>`);
      row.addEventListener("click", () => { list.hidden = true; showCard(x.id); });
      list.appendChild(row);
    });
    pill.addEventListener("click", () => { list.hidden = !list.hidden; pill.classList.toggle("open", !list.hidden); });
    box.appendChild(pill);
    box.appendChild(list);
    return box;
  }
  // Fly to a card on the table and make it pulse.
  async function showCard(id) {
    const t = world.querySelector(`.tc[data-id="${id}"]`);
    if (!t) return;
    const seatEl = t.closest("[data-seat]");
    if (seatEl) await seatTo(seatEl.dataset.seat, 600);
    t.classList.remove("pulse"); void t.offsetWidth; t.classList.add("pulse");
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("on"), 1600);
  }

  // ---- Director: follow the recent casts around the table -------------------------------------------------
  function settle() { world.querySelectorAll(".e-pending").forEach(s => s.classList.remove("e-pending")); scheduleArrows(); }
  function play() {
    if (director) director.cancel();
    world.querySelectorAll(".e-sslot").forEach(s => s.classList.add("e-pending"));
    director = K.direct(async step => {
      if (step.pid === "you") { await home(900); return; }
      // frame the caster's side of the table together with the spell landing on the stack
      const slot = world.querySelector(`.e-sslot[data-stack="${step.stack}"]`);
      focusPlate(step.pid);
      await flyTo(solve([...seatEls(step.pid), slot]), 900);
      if (slot) slot.classList.remove("e-pending");
      scheduleArrows();
    }, { dwell: 1500, onDone: settle });
  }

  // ---- Touch: one finger pans, two pinch, double-tap the felt to fly to that seat -------------------------
  function gestures() {
    const pts = new Map();
    let g = null, lastTap = 0;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    view.addEventListener("pointerdown", e => {
      cancelAnimationFrame(anim);
      if (director) { director.cancel(); director = null; settle(); }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) g = { type: "pan", x: e.clientX, y: e.clientY, cam: { ...cam }, moved: false, target: e.target };
      else if (pts.size === 2) { const [a, b] = [...pts.values()]; g = { type: "pinch", d0: dist(a, b), m0: mid(a, b), cam: { ...cam } }; }
    });
    window.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const f = frame();
      if (g.type === "pan") {
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
        if (!g.moved) return;
        cam.x = g.cam.x - dx / cam.s;
        cam.y = g.cam.y - dy / (cam.s * cosT());
        apply();
      } else if (pts.size >= 2) {
        const [a, b] = [...pts.values()], m = mid(a, b);
        const ns = clampS(g.cam.s * dist(a, b) / g.d0);
        const wx = g.cam.x + (g.m0.x - f.cx) / g.cam.s, wy = g.cam.y + (g.m0.y - f.cy) / (g.cam.s * cosT());
        cam.s = ns; cam.x = wx - (m.x - f.cx) / ns; cam.y = wy - (m.y - f.cy) / (ns * cosT());
        apply();
      }
    });
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (g && g.type === "pinch") { g = pts.size === 1 ? { type: "pan", ...[...pts.values()][0], cam: { ...cam }, moved: true } : null; return; }
      if (g && g.type === "pan" && !g.moved && !g.target.closest(".tc, .pile, .e-pile")) {
        const now = performance.now();
        if (now - lastTap < 330) {
          const s = g.target.closest("[data-seat]");
          if (s) (s.dataset.seat === "you" ? home() : seatTo(s.dataset.seat)); else home();
          lastTap = 0;
        } else lastTap = now;
      }
      if (!pts.size) g = null;
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    view.addEventListener("wheel", e => {
      e.preventDefault();
      const f = frame();
      if (e.ctrlKey) {
        const ns = clampS(cam.s * Math.exp(-e.deltaY * 0.01));
        const wx = cam.x + (e.clientX - f.cx) / cam.s, wy = cam.y + (e.clientY - f.cy) / (cam.s * cosT());
        cam.s = ns; cam.x = wx - (e.clientX - f.cx) / ns; cam.y = wy - (e.clientY - f.cy) / (ns * cosT());
      } else { cam.x += e.deltaX / cam.s; cam.y += e.deltaY / (cam.s * cosT()); }
      apply();
    }, { passive: false });
  }

  P.register("e", {
    title: "Standees (CSS)",
    mount(r) {
      root = r;
      root.dataset.tapped = "turn";
      view = el("div", "e-view");
      plane = el("div", "e-plane");
      world = el("div", "e-world");
      plane.appendChild(world);
      view.appendChild(plane);
      root.appendChild(view);
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "e-arrows");
      root.appendChild(svg);
      root.appendChild(hud());
      K.hand(root);
      K.lab(root, { replay: () => { home(500).then(() => setTimeout(play, 300)); }, at: { left: 12, top: 62 } });
      root._onTapped = () => { setTimeout(scheduleArrows, 350); };
      render();
      gestures();
      window.protoE = { home: () => home(0), seatTo: p => seatTo(p, 0), overview: () => overview(0), play, cam,
        sift: pid => { const pile = world.querySelector(`[data-seat="${pid}"] .pile`); pile.querySelector(".tc").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); pile.querySelector(".tc").dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); } };
    },
    show() {
      if (!framed) {
        framed = true;
        world.querySelectorAll(".e-sslot").forEach(s => s.classList.add("e-pending"));
        home(0);
        // the creatures stand up, one after another, before the camera sets off
        const ups = [...world.querySelectorAll(".e-stands .e-slot:not(.e-lying) .e-up")];
        ups.forEach(u => u.classList.add("e-down"));
        requestAnimationFrame(() => requestAnimationFrame(() => ups.forEach((u, i) => {
          u.style.transitionDelay = `${120 + i * 45}ms`;
          u.classList.remove("e-down");
          setTimeout(() => (u.style.transitionDelay = ""), 1200 + i * 45);
        })));
        setTimeout(play, 1500);
      } else apply();
    },
    hide() {
      if (director) { director.cancel(); director = null; settle(); }
      if (svg) svg.innerHTML = "";
    },
  });
})();
