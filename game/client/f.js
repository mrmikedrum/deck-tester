// Variation F, "Carousel": a lazy Susan. The four seats sit on a ring that turns; whoever you look at comes round to
// the front, big and legible, while the others recede around the rim. Text stays upright at every angle (mats face
// the viewer; the ring only moves and scales them). Built on the tabletop kit (table-kit.js).
(function () {
  const P = window.Proto, K = window.Kit;
  const SEATS = ["you", "ana", "bo", "cy"];
  const BASE = { you: 0, ana: 90, bo: 180, cy: 270 }; // clockwise from the front: you, left, across, right
  const W = 950, H = 440; // one mat, unscaled, in design pixels (the scene is 1180×820)
  const D = { cx: 590, rx: 360, frontShift: 85, yFront: 545, yBack: 108, ySide: 200, sBack: 0.29, sSide: 0.34 };
  const PY = Math.log((D.ySide - D.yBack) / (D.yFront - D.yBack)) / Math.log(0.5);
  const PS = Math.log((D.sSide - D.sBack) / (1 - D.sBack)) / Math.log(0.5);

  let root, scene, disc, plateBox, rulesPop, front = "you", phi = 0, anim = 0, director = null, directed = false;
  const mats = {}, labels = {};
  const el = P.el;

  // Where a seat sits for a displayed angle a (degrees, 0 = front, 90 = left, 180 = across, -90 = right).
  function place(a) {
    const r = (a * Math.PI) / 180, t = (1 + Math.cos(r)) / 2, s = Math.sin(r);
    const fy = Math.pow(t, PY), fs = Math.pow(t, PS);
    return {
      x: D.cx - D.rx * s + D.frontShift * fs,
      y: D.yBack + (D.yFront - D.yBack) * fy,
      sc: D.sBack + (1 - D.sBack) * fs,
      ry: s * 24 * (1 - fs),
      depth: Math.cos(r),
    };
  }
  const shown = seat => { let a = (((BASE[seat] - phi) % 360) + 360) % 360; return a > 180 ? a - 360 : a; };

  function layout() {
    SEATS.forEach(seat => {
      const a = shown(seat), p = place(a), m = mats[seat];
      m.style.transform = `translate3d(${p.x - W / 2}px, ${p.y - H / 2}px, 0) rotateY(${p.ry}deg) scale(${p.sc})`;
      m.style.zIndex = String(Math.round(20 + p.depth * 10));
      m._shade.style.opacity = String(Math.min(0.5, ((1 - p.sc) / (1 - D.sBack)) * 0.42));
      const lab = labels[seat];
      lab.style.transform = p.depth < -0.7 // across the table: above its mat; at the sides: below, clear of the corners
        ? `translate(${p.x}px, ${p.y - (H * p.sc) / 2 - 8}px) translate(-50%, -100%)`
        : `translate(${p.x}px, ${p.y + (H * p.sc) / 2 + 8}px) translate(-50%, 0)`;
      lab.style.opacity = String(Math.min(1, Math.max(0, (Math.abs(a) - 25) / 40)));
      lab.style.zIndex = String(Math.round(40 + p.depth * 10));
      lab.style.pointerEvents = Math.abs(a) < 40 ? "none" : "auto";
    });
    disc.style.transform = `rotate(${-phi}deg)`;
  }

  function nearestSeat() {
    return SEATS.reduce((best, s) => (Math.abs(shown(s)) < Math.abs(shown(best)) ? s : best), "you");
  }
  function settle() {
    const f = nearestSeat();
    SEATS.forEach(s => mats[s].classList.toggle("front", s === f));
    if (f !== front || !plateBox.childElementCount) { front = f; renderPlate(); }
  }

  // Turn the table to an angle (the nearest equivalent), easing; resolves when it lands.
  function turnTo(target, ms = 700) {
    const delta = ((((target - phi) % 360) + 540) % 360) - 180;
    const from = phi, to = phi + delta, t0 = performance.now();
    cancelAnimationFrame(anim);
    return new Promise(res => {
      const step = now => {
        const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        phi = from + (to - from) * e;
        layout();
        if (k < 1) anim = requestAnimationFrame(step);
        else { phi = to; layout(); settle(); res(); }
      };
      anim = requestAnimationFrame(step);
    });
  }
  const bring = (seat, ms) => turnTo(BASE[seat], ms);

  // ---- One seat's mat: creatures toward the hub, then other permanents, then mana at the player's edge ------------
  function buildMat(pid) {
    const m = el("div", "f-mat " + P.seatClass(pid));
    const a = K.arrange(pid);
    const row = (items, cls, opts, max, title) => {
      const r = el("div", "f-row " + cls);
      // Too many to lay out: tokens go into one pile of their stacks first, then the tail folds into a pile.
      const isTok = it => P.card(it.ids[0]).token;
      let tokPile = null;
      if (items.length > max && items.filter(isTok).length > 1) {
        tokPile = items.filter(isTok);
        items = items.filter(it => !isTok(it));
        max -= 1;
      }
      K.overflow(items, max, title).forEach(it => r.appendChild(K.item(it, opts)));
      if (tokPile) r.appendChild(groupPile(tokPile, opts.cw, "Tokens"));
      return r;
    };
    m.appendChild(row(a.creatures, "cre", { cw: 84 }, 8, "More creatures"));
    m.appendChild(row(a.others, "oth", { cw: 70 }, 9, "More permanents"));
    m.appendChild(row(a.mana, "man", { cw: 50, max: 3 }, 12, "More mana"));
    m._shade = el("div", "f-shade");
    m.appendChild(m._shade);
    const hit = el("div", "f-hit");
    hit.addEventListener("click", () => { if (!root._swiped) { stopDirector(); bring(pid); } });
    m.appendChild(hit);
    return m;
  }

  // A pile of stacks: one strip per group of identical cards, each naming its count and P/T; tap to sift them all.
  function groupPile(items, cw, title) {
    const step = cw * 0.2, n = items.length, all = items.flatMap(it => it.ids);
    const pile = el("div", "pile cascade f-gpile");
    pile.style.width = cw + "px";
    pile.style.height = K.height(cw) + step * (n - 1) + "px";
    pile.style.setProperty("--cw", cw + "px");
    pile.dataset.ids = all.join(",");
    items.slice().reverse().forEach((it, k) => {
      const c = P.card(it.ids[0]);
      const t = K.card(c, { cw, onTap: () => K.sift(all, pile, title) });
      t.style.top = k * step + "px";
      t.classList.remove("tapped");
      const nm = t.querySelector(".tc-name");
      nm.querySelectorAll(".tok").forEach(x => x.remove());
      const pt = P.isCreature(c) ? ` ${c.power}/${c.toughness}` : "";
      nm.insertAdjacentHTML("beforeend", `<em class="f-n">${it.ids.length > 1 ? "×" + it.ids.length : ""}${pt}${c.tapped ? " ↻" : ""}</em>`);
      pile.appendChild(t);
    });
    pile.appendChild(el("div", "count", all.length));
    pile.appendChild(el("div", "ptitle", P.esc(title)));
    return pile;
  }

  // A seat's tag on the rim: who, life, and what they've done to you.
  function buildLabel(pid) {
    const p = P.player(pid);
    const lab = el("button", "f-label " + P.seatClass(pid));
    const cmd = P.card(p.commander[0]);
    const toMe = pid !== P.ME ? P.cmdDamageTo(P.ME, pid) : 0;
    lab.innerHTML = `<span class="av${P.G.active === pid ? " active" : ""}" style="background-image:url('${P.printed(cmd).art}')"></span>` +
      `<span class="nm">${P.esc(p.name)}</span><span class="lf">${p.life}</span>` +
      (p.poison ? `<span class="ps">${P.ICON.poison}${p.poison}</span>` : "") +
      (toMe ? `<span class="cd">${P.ICON.cmd}${toMe}</span>` : "") +
      (p.monarch ? `<span class="mo">${P.ICON.crown}</span>` : "");
    lab.addEventListener("click", () => { stopDirector(); bring(pid); });
    return lab;
  }

  // ---- The front seat's plate, large, beside its mat ------------------------------------------------------------
  function commanderLine(pid) {
    const p = P.player(pid), c = P.card(p.commander[0]), nm = P.esc(P.printed(c).name.split(",")[0]);
    if (c.zone === "command") return `<b>${nm}</b> in the command zone · tax {${(c.commanderCasts || 0) * 2}}`;
    if (c.landName) return `<b>${nm}</b> is now a land, ${P.esc(c.landName)}`;
    return `<b>${nm}</b> on the battlefield`;
  }
  function renderPlate() {
    const pid = front, p = P.player(pid), cmd = P.card(p.commander[0]);
    plateBox.className = "f-plate f-hud " + P.seatClass(pid);
    plateBox.innerHTML = "";
    const top = el("div", "top");
    top.innerHTML = `<span class="av${P.G.active === pid ? " active" : ""}" style="background-image:url('${P.printed(cmd).art}')"></span>` +
      `<div class="who"><div class="nm">${P.esc(p.name)}${p.jev ? '<span class="jev">JEV</span>' : ""}${p.monarch ? `<span class="mo">${P.ICON.crown}</span>` : ""}</div>` +
      `<div class="lf">${p.life}</div></div>`;
    plateBox.appendChild(top);
    const stats = [];
    if (p.poison) stats.push(`<span class="ps">${P.ICON.poison}${p.poison} poison</span>`);
    stats.push(`<span>${P.ICON.hand}${p.handCount} in hand</span>`, `<span>${P.ICON.library}${p.library} in library</span>`);
    plateBox.appendChild(el("div", "stats", stats.join("")));
    plateBox.appendChild(el("div", "cmdline", commanderLine(pid)));
    if (pid === P.ME) {
      const hits = P.players.filter(o => o.id !== P.ME).map(o => [o, P.cmdDamageTo(P.ME, o.id)]).filter(([, d]) => d);
      hits.forEach(([o, d]) => plateBox.appendChild(el("div", "dmg " + P.seatClass(o.id), `${P.ICON.cmd}${d} commander damage from ${P.esc(o.name)}`)));
    } else {
      const d = P.cmdDamageTo(P.ME, pid);
      if (d) plateBox.appendChild(el("div", "dmg", `${P.ICON.cmd}${d} commander damage to you`));
      const mine = P.cmdDamageTo(pid, P.ME);
      if (mine) plateBox.appendChild(el("div", "dmg mine seat-you", `${P.ICON.cmd}You've dealt ${mine} of 21`));
    }
    const m = K.arrange(pid).manaSummary;
    plateBox.appendChild(el("div", "mana", `<b>${m.untapped}</b>/${m.total} mana untapped <span class="pips">${m.colors.map(x => `<i class="pip ${x}"></i>`).join("")}</span>`));
    const zones = el("div", "zones");
    [["Graveyard", p.graveyard, P.ICON.grave], ["Exile", p.exile, P.ICON.exile], ["Command", p.command, P.ICON.cmd]].forEach(([nm, ids, ic]) => {
      if (nm === "Command" && !ids.length) return;
      const b = el("button", "", `${ic}<span>${nm}</span><b>${ids.length}</b>`);
      b.addEventListener("click", () => P.sheet(`${p.name}'s ${nm.toLowerCase()}`, ids));
      zones.appendChild(b);
    });
    plateBox.appendChild(zones);
  }

  // ---- The stack, standing over the hub ------------------------------------------------------------------------
  function buildHub() {
    const hub = el("div", "f-hub");
    const row = el("div", "cards");
    P.G.stack.slice().reverse().forEach((s, i, all) => {
      const c = P.card(s.card), pl = P.player(s.controller);
      const slot = el("div", "slot " + P.seatClass(s.controller) + (i === all.length - 1 ? " top" : ""));
      const t = K.card(c, { cw: 74 });
      t.dataset.stack = s.id;
      slot.appendChild(t);
      slot.appendChild(el("div", "cap", `<b>${i + 1}</b> ${P.esc(pl.name)}` + (s.targets.length ? ` → ${P.esc(P.targetLabel(s.targets[0]))}` : "")));
      row.appendChild(slot);
    });
    hub.appendChild(row);
    return hub;
  }
  function drawArrows() {
    if (root.hidden) return;
    const pairs = [];
    P.G.stack.forEach(s => s.targets.forEach(t => {
      if (!t.stack) return;
      const a = root.querySelector(`.f-hub .tc[data-stack="${s.id}"] .tc-name`), b = root.querySelector(`.f-hub .tc[data-stack="${t.stack}"] .tc-name`);
      pairs.push([a, b, P.seatColor(s.controller)]);
    }));
    P.arrows(pairs);
  }

  // ---- Screen-space controls -----------------------------------------------------------------------------------
  function buildPriority() {
    const box = el("div", "f-prio f-hud seat-you");
    const ana = P.player(P.G.active);
    box.innerHTML = `<div class="who"><div class="big">You have priority</div><div class="sub"><b class="seat-${ana.id}">${P.esc(ana.name)}</b>'s turn ${P.G.turn} · ${P.esc(P.G.phase)}</div></div>`;
    const pass = el("button", "pass", "Pass");
    pass.addEventListener("click", () => toast("Passed: Mana Tithe resolves next (prototype)"));
    box.appendChild(pass);
    const rules = P.rules();
    const chip = el("button", "rules", `<span class="dots">${rules.map(r => `<i class="seat-${r.controller}"></i>`).join("")}</span>${rules.length} rules in effect`);
    chip.addEventListener("click", () => (rulesPop.hidden = !rulesPop.hidden));
    box.appendChild(chip);
    rulesPop = el("div", "f-rules f-hud");
    rulesPop.hidden = true;
    rules.forEach(r => {
      const b = el("button", P.seatClass(r.controller), `<i></i><span>${P.esc(r.text)}</span><em>${P.esc(P.name(P.card(r.id)))}</em>`);
      b.addEventListener("click", async () => {
        rulesPop.hidden = true;
        stopDirector();
        await bring(r.controller);
        const t = mats[r.controller].querySelector(`.tc[data-id="${r.id}"]`) || mats[r.controller].querySelector(`.pile[data-ids*="${r.id}"]`);
        if (t) { const tc = t.classList.contains("tc") ? t : t.querySelector(".tc"); tc.classList.remove("pulse"); void tc.offsetWidth; tc.classList.add("pulse"); }
      });
      rulesPop.appendChild(b);
    });
    return [box, rulesPop];
  }
  function buildNav() {
    const nav = el("div", "f-nav f-hud");
    const btn = (label, title, fn) => { const b = el("button", "", label); b.title = title; b.setAttribute("aria-label", title); b.addEventListener("click", () => { stopDirector(); fn(); }); nav.appendChild(b); };
    btn("⌂", "Your seat", () => bring("you"));
    btn("↺", "Turn the table: bring the seat on the left round", () => turnTo(Math.round(phi / 90) * 90 + 90, 550));
    btn("↻", "Turn the table: bring the seat on the right round", () => turnTo(Math.round(phi / 90) * 90 - 90, 550));
    return nav;
  }
  let toastEl = null;
  function toast(text) {
    if (toastEl) toastEl.remove();
    toastEl = el("div", "f-toast", P.esc(text));
    root.appendChild(toastEl);
    setTimeout(() => toastEl && toastEl.remove(), 2200);
  }

  // ---- Turning by hand: swipe across the table, or twist with two fingers ----------------------------------------
  function gestures() {
    const pts = new Map();
    let drag = null;
    const skip = e => e.target.closest(".hand, .f-hud, .lab, .sift, .scrim, .switcher, .f-label");
    root.addEventListener("pointerdown", e => {
      if (skip(e)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, phi0: phi, mode: null, dx: 0 }; root._swiped = false; }
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        drag = { mode: "twist", a0: Math.atan2(b.y - a.y, b.x - a.x), phi0: phi };
        root._swiped = true; cancelAnimationFrame(anim); stopDirector();
      }
    });
    root.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId) || !drag) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (drag.mode === "twist") {
        if (pts.size < 2) return;
        const [a, b] = [...pts.values()];
        phi = drag.phi0 - ((Math.atan2(b.y - a.y, b.x - a.x) - drag.a0) * 180) / Math.PI;
        layout();
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.mode && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        drag.mode = "swipe"; root._swiped = true; cancelAnimationFrame(anim); stopDirector();
        root.querySelectorAll(".tc.pressing").forEach(t => t.classList.remove("pressing"));
      }
      if (drag.mode === "swipe") { drag.dx = dx; phi = drag.phi0 + dx * 0.3 / P.unit(); layout(); }
    });
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (drag && drag.mode && pts.size === 0) {
        let target = Math.round(phi / 90) * 90;
        const start = Math.round(drag.phi0 / 90) * 90;
        if (drag.mode === "swipe" && target === start && Math.abs(drag.dx) > 45) target += Math.sign(phi - drag.phi0) * 90;
        turnTo(target, 420);
        e.stopPropagation(); // a swipe that began on a card must not open it
        drag = null;
      }
      if (!pts.size) drag = null;
    };
    root.addEventListener("pointerup", end, true);
    root.addEventListener("pointercancel", end, true);
  }

  // ---- Director: the table turns to each player as they cast ---------------------------------------------------
  function stopDirector() {
    if (director) { director.cancel(); director = null; }
    if (root) root.querySelectorAll(".f-hub .slot.now").forEach(s => s.classList.remove("now"));
  }
  function direct() {
    stopDirector();
    director = K.direct(async step => {
      root.querySelectorAll(".f-hub .slot").forEach(s => s.classList.remove("now"));
      if (step.stack) {
        const t = root.querySelector(`.f-hub .tc[data-stack="${step.stack}"]`);
        if (t) t.parentElement.classList.add("now");
      }
      await bring(step.pid, 750);
    }, { dwell: 1250, onDone: () => root.querySelectorAll(".f-hub .slot").forEach(s => s.classList.remove("now")) });
  }

  function fit() {
    const u = P.unit(), ox = (innerWidth - 1180 * u) / 2, oy = (innerHeight - 820 * u) / 2;
    scene.style.transform = `translate(${ox}px, ${oy}px) scale(${u})`;
    const lab = root.querySelector(":scope > .lab"); // keep the lab beside the scene's turning controls
    if (lab) { lab.style.left = `${ox + 176 * u}px`; lab.style.top = `${oy + 18 * u}px`; }
  }

  P.register("f", {
    title: "Carousel",
    mount(r) {
      root = r;
      root.dataset.tapped = "rotate";
      scene = el("div", "f-scene");
      const table = el("div", "f-table");
      disc = el("div", "f-disc");
      table.appendChild(disc);
      scene.appendChild(table);
      const ring = el("div", "f-ring");
      SEATS.forEach(s => { mats[s] = buildMat(s); ring.appendChild(mats[s]); });
      scene.appendChild(ring);
      SEATS.forEach(s => { labels[s] = buildLabel(s); scene.appendChild(labels[s]); });
      scene.appendChild(buildHub());
      plateBox = el("div", "f-plate f-hud");
      scene.appendChild(plateBox);
      buildPriority().forEach(x => scene.appendChild(x));
      scene.appendChild(buildNav());
      root.appendChild(scene);
      K.hand(root);
      K.lab(root, { replay: () => { stopDirector(); bring("you", 400).then(direct); }, at: { left: 176, top: 12 } });
      gestures();
      addEventListener("resize", fit);
      fit();
      layout();
      settle();
      window.protoF = { setAngle: a => { cancelAnimationFrame(anim); phi = a; layout(); settle(); }, bring, direct, stop: stopDirector };
    },
    show() {
      fit();
      layout();
      requestAnimationFrame(drawArrows);
      if (!directed) { directed = true; setTimeout(direct, 500); }
    },
    hide() { stopDirector(); P.clearArrows(); },
  });
})();
