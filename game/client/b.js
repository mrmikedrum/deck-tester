// Prototype B, "Table": the four boards on one tilted tabletop with a camera (pinch, pan, double-tap to fly) and
// semantic zoom. Overview shows art chips and collapses mana; Board adds names, counters, attachments and lands;
// Close-up turns permanents into real cards. Life, zones, priority, rules and the hand stay in screen space.
(function () {
  const P = Proto, G = P.G, el = P.el;
  const LEVELS = ["Overview", "Board", "Close-up"];
  const UP = [0.6, 1.08];            // zoom (screen px per world px) where the next level starts
  const TILT = 26;
  const INSET = { top: 70, right: 112, bottom: 112, left: 112 };  // screen space the HUD keeps (×u)
  let root, view, plane, world, svg, levelPill, tiltBtn, toastEl;
  let cam = { x: 0, y: 0, s: 0.4 }, tilt = TILT, level = -1, framed = false, raf = 0, lastPinch = 0;

  const u = () => P.unit();
  const cos = () => Math.cos(tilt * Math.PI / 180);
  function frame() {
    const w = root.clientWidth, h = root.clientHeight, k = u();
    const l = INSET.left * k, r = INSET.right * k, t = INSET.top * k, b = INSET.bottom * k;
    return { l, t, w: w - l - r, h: h - t - b, cx: l + (w - l - r) / 2, cy: t + (h - t - b) / 2 };
  }

  // ---- Camera --------------------------------------------------------------------------------------------
  function apply() {
    const f = frame();
    view.style.perspectiveOrigin = `${f.cx}px ${f.cy}px`;
    world.style.setProperty("--tilt", tilt);
    plane.style.transform = `translate(${f.cx}px, ${f.cy}px) rotateX(${tilt}deg) scale(${cam.s}) translate(${-cam.x}px, ${-cam.y}px)`;
    const want = levelFor(cam.s);
    if (want !== level) setLevel(want);
    scheduleArrows();
  }
  function levelFor(s) {
    let l = level < 0 ? 0 : level;
    while (l < 2 && s > UP[l] * 1.03) l++;
    while (l > 0 && s < UP[l - 1] * 0.97) l--;
    return l;
  }
  const clampS = s => Math.max(0.22, Math.min(2.4, s));
  let anim = 0;
  function flyTo(target, ms = 420) {
    cancelAnimationFrame(anim);
    const from = { ...cam }, t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      // zoom in log space so the camera doesn't lurch
      cam.s = Math.exp(Math.log(from.s) + (Math.log(target.s) - Math.log(from.s)) * e);
      cam.x = from.x + (target.x - from.x) * e;
      cam.y = from.y + (target.y - from.y) * e;
      apply();
      if (t < 1) anim = requestAnimationFrame(step);
      else if (target.after) target.after();
    };
    if (ms <= 0) { Object.assign(cam, { x: target.x, y: target.y, s: target.s }); apply(); if (target.after) target.after(); }
    else anim = requestAnimationFrame(step);
  }
  function home(ms = 420) {
    if (level !== 0) setLevel(0);
    const f = frame(), W = world.offsetWidth, H = world.offsetHeight;
    const s = Math.min(f.w / W, f.h / (H * cos())) * (tilt ? 0.92 : 0.985);
    flyTo({ x: W / 2, y: H / 2 + (tilt ? H * 0.015 : 0), s }, ms);
  }
  // Frame one seat readably: Board level at least, the top of the region at the top of the frame if it is tall.
  function seatTo(seat, ms = 460) {
    const f = frame();
    const fit = r => Math.min(f.w / (r.w + 60), f.h / ((r.h + 60) * cos()));
    let r = rect(seat);
    let s = Math.max(UP[0] * 1.15, Math.min(1.05, fit(r)));
    if (levelFor(s) !== level) { setLevel(levelFor(s)); r = rect(seat); s = Math.max(UP[0] * 1.15, Math.min(1.05, fit(r))); }
    const visH = f.h / (s * cos());
    const y = r.h + 60 <= visH ? r.top + r.h / 2 : r.top - 30 + visH / 2;
    flyTo({ x: r.left + r.w / 2, y, s }, ms);
  }
  function rect(seat) {
    const e = world.querySelector(`[data-seat="${seat}"]`);
    return { left: e.offsetLeft, top: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight };
  }

  // Changing level re-lays out the world; keep the same spot of the same region under the camera.
  function setLevel(l) {
    let focus = null;
    if (world.children.length) {
      let best = null, bd = Infinity;
      world.querySelectorAll("[data-seat]").forEach(e => {
        const r = { left: e.offsetLeft, top: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight };
        const dx = Math.max(r.left - cam.x, 0, cam.x - r.left - r.w), dy = Math.max(r.top - cam.y, 0, cam.y - r.top - r.h);
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = { seat: e.dataset.seat, fx: (cam.x - r.left) / r.w, fy: (cam.y - r.top) / r.h }; }
      });
      focus = best;
    }
    level = l;
    render();
    if (focus) {
      const r = rect(focus.seat);
      cam.x = r.left + focus.fx * r.w;
      cam.y = r.top + focus.fy * r.h;
    }
    levelPill.textContent = LEVELS[level];
    root.classList.toggle("b-zoomed", level > 0);
    const f = frame();
    plane.style.transform = `translate(${f.cx}px, ${f.cy}px) rotateX(${tilt}deg) scale(${cam.s}) translate(${-cam.x}px, ${-cam.y}px)`;
  }

  // ---- The world -------------------------------------------------------------------------------------------
  const interestingLand = c => c.becameLand || c.commander || c.chosen || c.copyOf || (c.counters && Object.keys(c.counters).length) || P.attachments(c.id).length;
  const power = c => (c.power != null ? c.power : P.basePT(c).power);

  function render() {
    world.innerHTML = "";
    world.className = "b-world lvl" + level;
    ["bo", "ana", "cy", "you"].forEach(pid => world.appendChild(region(pid)));
    world.appendChild(center());
  }

  function region(pid) {
    const p = P.player(pid);
    const r = el("section", "b-region " + P.seatClass(pid) + (G.active === pid ? " active" : ""));
    r.dataset.seat = pid;
    const cmd = P.card(p.commander[0]);
    r.appendChild(el("div", "b-rlabel", `${P.esc(p.name)} <span>${P.esc(P.printed(cmd).name.split(",")[0])}</span>`));
    const bf = P.battlefield(pid).filter(c => !c.attachedTo);
    const fighters = bf.filter(c => P.isCreature(c) || P.isPW(c)).sort((a, b) =>
      (b.commander ? 1 : 0) - (a.commander ? 1 : 0) || (P.isPW(a) ? 1 : 0) - (P.isPW(b) ? 1 : 0) ||
      (a.token ? 1 : 0) - (b.token ? 1 : 0) || power(b) - power(a));
    const others = bf.filter(c => !P.isCreature(c) && !P.isPW(c) && (P.category(c) === "other" || (P.isLand(c) && interestingLand(c))))
      .sort((a, b) => (b.commander ? 1 : 0) - (a.commander ? 1 : 0) || (P.isLand(a) ? 1 : 0) - (P.isLand(b) ? 1 : 0));
    const mana = bf.filter(c => (P.isLand(c) && !interestingLand(c)) || P.category(c) === "mana");

    const sec = (cls, list, kind, heavy) => {
      if (!list.length) return null;
      const s = el("div", "b-sec " + cls);
      (heavy ? heavyGroups(list) : P.groups(list)).forEach(g => s.appendChild(piece(g, kind)));
      r.appendChild(s);
      return s;
    };
    sec("b-fight", fighters, "fight", level === 0);
    const o = sec("b-other", others, "other", level === 0);
    if (level === 0) {
      (o || r.appendChild(el("div", "b-sec b-other"))).appendChild(manaChip(pid));
    } else {
      sec("b-lands", mana.sort((a, b) => (P.isLand(a) ? 0 : 1) - (P.isLand(b) ? 0 : 1)), "land", false);
    }
    return r;
  }

  // At overview, tokens of one kind group even when their counters or P/T differ; the badge then shows the range.
  function heavyGroups(list) {
    const out = [], seen = {};
    list.forEach(c => {
      if (!c.token || P.attachments(c.id).length) {
        const g = P.groups([c])[0];
        const k = "n|" + [c.card, c.copyOf, c.tapped, c.faceDown, JSON.stringify(c.counters || {}), c.power].join("|");
        if (!c.token && !c.commander && seen[k]) seen[k].ids.push(c.id);
        else { seen[k] = g; out.push(g); }
        return;
      }
      const k = ["t", c.card, c.transformed, c.copyOf, c.tapped].join("|");
      if (seen[k]) seen[k].ids.push(c.id);
      else { seen[k] = { rep: c, ids: [c.id] }; out.push(seen[k]); }
    });
    return out;
  }

  function piece(g, kind) {
    const c = g.rep;
    const t = P.tile(c, { group: g.ids, name: level >= 1 });
    t.classList.add("b-" + kind);
    const full = level === 2 && kind !== "land";
    if (full) {
      t.classList.add("b-card");
      const img = P.image(c);
      if (img) t.querySelector(".art").style.backgroundImage = `url("${img}")`;
      const nm = t.querySelector(".nm");
      if (nm && !(c.faceDown || c.landName || c.copyOf || c.becameLand)) nm.remove();
    }
    if (g.ids.length > 1 && P.isCreature(c)) {
      const ps = g.ids.map(i => P.card(i)), lo = Math.min(...ps.map(power)), hi = Math.max(...ps.map(power));
      if (lo !== hi) {
        const pt = t.querySelector(".pt");
        if (pt) pt.textContent = `${lo}–${hi}`;
        const ctr = t.querySelector(".ctrs");
        if (ctr) ctr.remove();
      }
    }
    if (c.tapped && level >= 1) t.classList.add("b-tapped");
    P.press(t, { tap: () => { if (performance.now() - lastPinch > 350) P.inspect(c.id); } });
    if (level === 0) return t;

    const state = stateText(c);
    const att = P.attachments(c.id);
    if (!state && !att.length) return t;
    const host = el("div", "b-host b-" + kind + (full ? " b-card" : ""));
    att.forEach(a => {
      const tab = el("div", "b-tab " + P.seatClass(a.controller));
      tab.dataset.id = a.id;
      tab.innerHTML = `<i style="background-image:url('${P.art(a)}')"></i><span>${P.esc(P.name(a))}</span>`;
      P.press(tab, { tap: () => P.inspect(a.id) });
      host.appendChild(tab);
    });
    host.appendChild(t);
    if (state) host.appendChild(el("div", "b-state", P.esc(state)));
    return host;
  }
  function stateText(c) {
    if (c.faceDown) return c.controller === P.ME ? "Face-down · you know it" : "Face-down";
    if (c.landName) return "Commander, now a land: " + c.landName;
    if (c.becameLand) return "Now a land";
    if (c.copyOf) return "Copy · " + P.printed(c).name;
    if (c.transformed) return "Transformed Incubator";
    if (c.goaded) return "Goaded";
    if (c.exiling && c.exiling.length) return "Exiling " + P.name(P.card(c.exiling[0]));
    if (c.imprinted && c.imprinted.length) return "Imprint: " + P.name(P.card(c.imprinted[0]));
    return "";
  }

  const PIP = { W: "#f3ecd0", U: "#6fb3e8", B: "#9a8f9f", R: "#ef7d5a", G: "#68c07c", C: "#c3c0bb" };
  function manaChip(pid) {
    const m = P.mana(pid);
    const lands = m.sources.filter(P.isLand).length;
    const box = el("div", "b-mana");
    box.innerHTML = `<div class="b-mnum">${m.untapped}<small>/${m.total}</small></div>
      <div class="b-mlab">untapped · ${lands} lands, ${m.total - lands} rocks</div>
      <div class="b-pips">${m.colors.map(x => `<i style="background:${PIP[x]}">${x}</i>`).join("")}</div>`;
    P.press(box, { tap: () => P.sheet(`${P.player(pid).name}: lands and mana`, m.sources.map(c => c.id)) });
    return box;
  }

  function center() {
    const r = el("section", "b-region b-center");
    r.dataset.seat = "center";
    const st = el("div", "b-stack");
    st.appendChild(el("div", "b-shead", `The stack <span>${G.stack.length}</span>`));
    const row = el("div", "b-srow");
    G.stack.slice().reverse().forEach((item, i, all) => {
      const c = P.card(item.card), top = i === all.length - 1;
      const s = el("div", "b-scard " + P.seatClass(item.controller) + (top ? " top" : ""));
      s.dataset.stack = item.id;
      s.dataset.id = item.card;
      const img = el("div", "b-simg");
      img.style.backgroundImage = `url("${P.printed(c).img}")`;
      img.appendChild(el("b", "", i + 1));
      s.appendChild(img);
      s.appendChild(el("div", "b-scap", `<strong>${P.esc(P.player(item.controller).name)}</strong> · ${P.esc(P.printed(c).name)}` +
        (item.targets.length ? `<br><em>→ ${P.esc(item.targets.map(P.targetLabel).join(", "))}</em>` : "")));
      P.press(s, { tap: () => P.inspect(item.card) });
      row.appendChild(s);
    });
    st.appendChild(row);
    r.appendChild(st);
    return r;
  }

  // ---- Arrows (screen space, from the top of a stack card to the top of its target) -------------------------
  function scheduleArrows() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; drawArrows(); });
  }
  function drawArrows() {
    if (!svg || root.hidden) return;
    const base = root.getBoundingClientRect();
    let html = "";
    G.stack.forEach(item => item.targets.forEach(t => {
      if (!t.stack) return;
      const a = world.querySelector(`[data-stack="${item.id}"] .b-simg`), b = world.querySelector(`[data-stack="${t.stack}"] .b-simg`);
      if (!a || !b) return;
      const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
      const x1 = r1.left + r1.width * 0.5 - base.left, y1 = r1.top + 2 - base.top;
      const x2 = r2.left + r2.width * 0.62 - base.left, y2 = r2.top + 2 - base.top;
      const lift = Math.max(16, Math.min(46, Math.abs(x2 - x1) * 0.28));
      const color = P.seatColor(item.controller);
      html += `<path d="M${x1},${y1} C${x1},${y1 - lift} ${x2},${y2 - lift} ${x2},${y2}" stroke="${color}" marker-end="url(#bhead)"/>`;
    }));
    svg.innerHTML = `<defs><marker id="bhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>` + html;
  }

  // ---- Screen-space HUD ----------------------------------------------------------------------------------
  function hud() {
    const h = el("div", "b-hud");
    const ctl = el("div", "b-ctl");
    const homeBtn = el("button", "b-round", '<svg viewBox="0 0 24 24"><path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>');
    homeBtn.setAttribute("aria-label", "Whole table");
    homeBtn.addEventListener("click", () => home());
    tiltBtn = el("button", "b-round b-tilt", "3D");
    tiltBtn.setAttribute("aria-label", "Tilt the table");
    tiltBtn.addEventListener("click", () => {
      const from = tilt, to = tilt ? 0 : TILT, t0 = performance.now();
      tiltBtn.textContent = to ? "3D" : "2D";
      const step = now => { const t = Math.min(1, (now - t0) / 320); tilt = from + (to - from) * (1 - Math.pow(1 - t, 3)); apply(); if (t < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    const zin = el("button", "b-round", "+"), zout = el("button", "b-round", "−");
    zin.addEventListener("click", () => flyTo({ x: cam.x, y: cam.y, s: clampS(cam.s * 1.5) }, 260));
    zout.addEventListener("click", () => flyTo({ x: cam.x, y: cam.y, s: clampS(cam.s / 1.5) }, 260));
    levelPill = el("div", "b-level", LEVELS[0]);
    [homeBtn, tiltBtn, zout, zin, levelPill].forEach(x => ctl.appendChild(x));
    h.appendChild(ctl);

    ["bo", "ana", "cy", "you"].forEach(pid => {
      const p = P.player(pid);
      const w = el("div", "b-hp b-hp-" + pid + " " + P.seatClass(pid));
      const pl = P.plate(pid);
      P.press(pl, { tap: () => seatTo(pid), peek: false });
      w.appendChild(pl);
      const z = el("div", "b-zones");
      const zb = (icon, n, title, ids) => {
        const b = el("button", "b-zone", `${icon}<span>${n}</span>`);
        b.setAttribute("aria-label", title);
        b.addEventListener("click", () => P.sheet(title, ids));
        z.appendChild(b);
      };
      zb(P.ICON.grave, p.graveyard.length, `${p.name}: graveyard`, p.graveyard);
      zb(P.ICON.exile, p.exile.length, `${p.name}: exile`, p.exile);
      if (p.command.length) {
        const c = P.card(p.command[0]);
        zb(P.ICON.cmd, `${P.printed(c).name.split(",")[0]} · tax {${(c.commanderCasts || 0) * 2}}`, `${p.name}: command zone`, p.command);
      }
      w.appendChild(z);
      h.appendChild(w);
    });

    h.appendChild(rulesPanel());

    const ana = P.player(G.active);
    const prio = el("div", "prio b-prio");
    prio.innerHTML = `<div><div class="b-ptitle">You have priority</div><div class="phase">${P.esc(ana.name)}'s turn ${G.turn} · ${P.esc(G.phase)}</div></div>`;
    const pass = el("button", "btn", "Pass");
    pass.addEventListener("click", () => toast("Passed (prototype: nothing happens)"));
    prio.appendChild(pass);
    h.appendChild(prio);
    toastEl = el("div", "b-toast");
    h.appendChild(toastEl);
    return h;
  }
  // Rules that bind you, from other players' permanents: a pill of their sources that opens into the list.
  function rulesPanel() {
    const rules = P.rules().filter(x => x.controller !== P.ME);
    const box = el("div", "b-rp");
    const pill = el("button", "b-rpill");
    pill.innerHTML = `<span class="b-rplab"><b>${rules.length}</b> rules in effect</span><span class="b-rpsrc">` +
      rules.map(x => `<i class="${P.seatClass(x.controller)}" style="background-image:url('${P.art(P.card(x.id))}')"></i>`).join("") + "</span>";
    const list = el("div", "b-rlist");
    list.hidden = true;
    rules.forEach(x => {
      const row = el("div", "b-rule " + P.seatClass(x.controller), `<i></i><span>${P.esc(x.text)}</span><em>${P.esc(P.name(P.card(x.id)))}</em>`);
      row.dataset.id = x.id;
      P.press(row, { tap: () => P.inspect(x.id) });
      list.appendChild(row);
    });
    pill.addEventListener("click", () => { list.hidden = !list.hidden; pill.classList.toggle("open", !list.hidden); });
    box.appendChild(pill);
    box.appendChild(list);
    return box;
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("on"), 1600);
  }

  // ---- Touch: one finger pans, two pinch, double-tap the table to fly ---------------------------------------
  function gestures() {
    const pts = new Map();
    let g = null, lastTap = { t: 0, seat: null };
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const startPan = (p, target) => (g = { type: "pan", x: p.x, y: p.y, cam: { ...cam }, moved: false, target });
    view.addEventListener("pointerdown", e => {
      cancelAnimationFrame(anim);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) startPan(pts.get(e.pointerId), e.target);
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        g = { type: "pinch", d0: dist(a, b), m0: mid(a, b), cam: { ...cam } };
      }
    });
    window.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const f = frame();
      if (g.type === "pan") {
        const p = pts.get(e.pointerId), dx = p.x - g.x, dy = p.y - g.y;
        if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
        if (!g.moved) return;
        cam.x = g.cam.x - dx / cam.s;
        cam.y = g.cam.y - dy / (cam.s * cos());
        apply();
      } else if (g.type === "pinch" && pts.size >= 2) {
        const [a, b] = [...pts.values()], m = mid(a, b);
        const ns = clampS(g.cam.s * dist(a, b) / g.d0);
        const wx = g.cam.x + (g.m0.x - f.cx) / g.cam.s, wy = g.cam.y + (g.m0.y - f.cy) / (g.cam.s * cos());
        cam.s = ns;
        cam.x = wx - (m.x - f.cx) / ns;
        cam.y = wy - (m.y - f.cy) / (ns * cos());
        lastPinch = performance.now();
        apply();
        // a level change re-lays out the world: re-anchor the pinch to the new layout
        if (g.level !== level) { g = { type: "pinch", d0: dist(a, b), m0: m, cam: { ...cam }, level }; }
      }
    });
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (g && g.type === "pinch") {
        lastPinch = performance.now();
        if (pts.size === 1) startPan([...pts.values()][0], null), (g.moved = true);
        else g = null;
        return;
      }
      if (g && g.type === "pan" && !g.moved && g.target && !g.target.closest(".tile, .b-mana, .b-tab, .b-rule, .b-scard")) {
        const seatEl = g.target.closest("[data-seat]");
        const seat = seatEl ? seatEl.dataset.seat : null;
        const now = performance.now();
        if (now - lastTap.t < 330) {
          if (level >= 1 || !seat || seat === "center") home();
          else seatTo(seat);
          lastTap = { t: 0, seat: null };
        } else lastTap = { t: now, seat };
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
        const wx = cam.x + (e.clientX - f.cx) / cam.s, wy = cam.y + (e.clientY - f.cy) / (cam.s * cos());
        cam.s = ns; cam.x = wx - (e.clientX - f.cx) / ns; cam.y = wy - (e.clientY - f.cy) / (ns * cos());
      } else {
        cam.x += e.deltaX / cam.s;
        cam.y += e.deltaY / (cam.s * cos());
      }
      apply();
    }, { passive: false });
  }

  P.register("b", {
    title: "First table",
    mount(r) {
      root = r;
      view = el("div", "b-view");
      plane = el("div", "b-plane");
      world = el("div", "b-world");
      plane.appendChild(world);
      view.appendChild(plane);
      root.appendChild(view);
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "b-arrows");
      root.appendChild(svg);
      root.appendChild(hud());
      P.hand(root);
      level = 0;
      render();
      gestures();
      window.protoB = { centerOn: (id, sc) => {
        cam.s = sc; apply();
        let e = world.querySelector(`[data-id="${id}"]`), x = e.offsetWidth / 2, y = e.offsetHeight / 2;
        while (e && e !== world) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
        cam.x = x; cam.y = y; apply();
      }, rules: () => root.querySelector('.b-rpill').click(), zoomTo: seat => seatTo(seat, 0), home: () => home(0), setTilt: d => { tilt = d; apply(); }, cam, setCam: (x, y, s) => { Object.assign(cam, { x, y, s }); apply(); } };
    },
    show() {
      if (!framed) { framed = true; home(0); }
      else apply();
      drawArrows();
    },
    hide() { if (svg) svg.innerHTML = ""; },
  });
})();
