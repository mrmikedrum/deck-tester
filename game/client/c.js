// Prototype C, Ledger: every permanent on one screen, organised by meaning. One band per player (yours at the bottom),
// each with creatures (by power), permanents that do things, and a mana summary; lands that matter surface as cards.
(function () {
  const P = Proto, { G, el, esc, ICON } = P;
  const ORDER = ["ana", "bo", "cy", "you"];
  let root = null, layoutAll = null;

  // Lands and rocks stay in the mana summary unless something about them matters.
  function notable(c) {
    if (P.isLand(c)) return !!(c.becameLand || c.commander || c.chosen || c.copyOf || c.counters || P.attachments(c.id).length);
    return !!(c.imprinted && c.imprinted.length);
  }
  function lanesFor(pid) {
    const all = P.battlefield(pid).filter(c => !c.attachedTo);
    const creatures = all.filter(c => P.category(c) === "creature")
      .sort((a, b) => (b.power || 0) - (a.power || 0) || (b.toughness || 0) - (a.toughness || 0));
    const rank = c => (P.isPW(c) ? 0 : P.RULES[c.card] ? 1 : P.isLand(c) ? 3 : 2);
    const things = all.filter(c => {
      const k = P.category(c);
      return k === "planeswalker" || k === "other" || ((k === "land" || k === "mana") && notable(c));
    }).sort((a, b) => rank(a) - rank(b));
    return { creatures: P.groups(creatures), things: P.groups(things) };
  }

  // Lens: what you most need to see. A fixed selection, not a rules judgement.
  function lensKeep() {
    const keep = new Set(P.rules().map(r => r.id));
    Object.values(G.cards).forEach(c => {
      if (c.zone !== "battlefield") return;
      if (c.controller !== P.ME && P.category(c) === "creature") keep.add(c.id);
      if (c.attachedTo && c.controller !== P.ME && P.card(c.attachedTo).controller === P.ME) { keep.add(c.id); keep.add(c.attachedTo); }
    });
    G.stack.forEach(s => s.targets.forEach(t => t.card && keep.add(t.card)));
    return keep;
  }

  // ---- Packing: the largest tile width that fits a lane, else overlapping rows ----------------------------------
  const TUCK = 0.34; // each attachment widens its host's slot by this much of a tile
  function pack(items, W, H, minW, maxW, u) {
    const g = 7 * u, vg = 15 * u, top = 7 * u;
    if (!items.length) return { w: maxW, pos: [] };
    for (let w = maxW; w >= minW; w -= 1) {
      const h = w * 0.8, pos = [];
      let x = 0, row = 0;
      for (const it of items) {
        const iw = w * (1 + TUCK * it.k);
        if (x > 0 && x + iw > W) { row++; x = 0; }
        pos.push({ x, y: top + row * (h + vg), w });
        x += iw + g;
      }
      if (top + (row + 1) * h + row * vg + 9 * u <= H) return { w, pos, fit: true };
    }
    // Overlap: smallest tile, as many rows as fit, items spread evenly with a step under the tile width.
    const w = minW, h = w * 0.8;
    const rows = Math.max(1, Math.floor((H - top - 9 * u + vg) / (h + vg)));
    const per = Math.ceil(items.length / rows), pos = [];
    for (let r = 0; r < rows; r++) {
      const slice = items.slice(r * per, (r + 1) * per);
      const widths = slice.map(it => w * (1 + TUCK * it.k));
      const total = widths.reduce((a, b) => a + b, 0);
      const step = slice.length > 1 ? Math.min(g, (W - total) / (slice.length - 1)) : 0;
      let x = 0;
      slice.forEach((it, i) => { pos.push({ x, y: top + r * (h + vg), w }); x += widths[i] + step; });
    }
    return { w, pos, fit: false };
  }

  function slotFor(g, keep) {
    const c = g.rep;
    const slot = el("div", "slot");
    const atts = P.attachments(c.id);
    atts.forEach((a, i) => {
      const tk = el("div", "tuck" + (a.controller !== c.controller ? " cross" : ""));
      const t = P.tile(a);
      if (keep.has(a.id)) t.classList.add("keep");
      P.press(t, { tap: () => P.inspect(a.id) });
      tk.appendChild(t);
      tk.dataset.i = i;
      slot.appendChild(tk);
    });
    const t = P.tile(c, { group: g.ids });
    if (c.becameLand && !c.landName) t.appendChild(el("span", "tag", "LAND"));
    if (c.becameLand && c.landName) t.appendChild(el("span", "tag", "COMMANDER, NOW A LAND"));
    if (keep.has(c.id)) t.classList.add("keep");
    P.press(t, { tap: () => (g.ids.length > 1 ? P.sheet(`${P.name(c)} ×${g.ids.length}`, g.ids) : P.inspect(c.id)) });
    slot.appendChild(t);
    slot._k = atts.length;
    return slot;
  }

  function buildBand(pid, keep) {
    const p = P.player(pid);
    const band = el("section", "band " + P.seatClass(pid) + (pid === P.ME ? " me" : "") + (G.active === pid ? " active" : "") + (G.priority === pid ? " priority" : ""));
    band.dataset.pid = pid;

    // Plate column
    const pc = el("div", "pcol");
    const plate = P.plate(pid);
    P.press(plate.querySelector(".avatar"), { tap: () => P.inspect(p.commander[0]) });
    pc.appendChild(plate);
    const cmd = P.card(p.commander[0]);
    const lines = [];
    if (cmd.zone === "command") lines.push(`<b>${esc(P.printed(cmd).name.split(",")[0])}</b> in command zone · tax {${(cmd.commanderCasts || 0) * 2}}`);
    else if (cmd.becameLand) lines.push(`<b>${esc(P.printed(cmd).name)}</b> is now a land, ${esc(cmd.landName)}`);
    if (pid !== P.ME) { const mine = P.cmdDamageTo(pid, P.ME); if (mine) lines.push(`<span class="mine">Marath has dealt ${mine}</span> of 21`); }
    else {
      const from = G.players.filter(o => o.id !== P.ME).map(o => [o, P.cmdDamageTo(P.ME, o.id)]).filter(x => x[1]);
      from.forEach(([o, n]) => lines.push(`<span style="color:var(--hurt)">${n} commander damage</span> from ${esc(o.name)}`));
    }
    if (lines.length) pc.appendChild(el("div", "cmdline", lines.join("<br>")));
    const zones = el("div", "zones");
    const zb = (icon, ids, title) => {
      const b = el("button", "zbtn", ICON[icon] + ids.length);
      b.setAttribute("aria-label", title);
      b.addEventListener("click", () => P.sheet(title, ids));
      zones.appendChild(b);
    };
    zb("grave", p.graveyard, `${p.name} · graveyard`);
    zb("exile", p.exile, `${p.name} · exile`);
    if (p.command.length) zb("cmd", p.command, `${p.name} · command zone`);
    pc.appendChild(zones);
    band.appendChild(pc);

    // Lanes
    const lanes = el("div", "lanes");
    const { creatures, things } = lanesFor(pid);
    const mk = (cls, label, groups) => {
      const lane = el("div", "lane " + cls);
      lane.appendChild(el("div", "lbl", label));
      lane._slots = groups.map(g => { const s = slotFor(g, keep); lane.appendChild(s); return s; });
      lanes.appendChild(lane);
      return lane;
    };
    lanes._c = mk("creatures", "Creatures", creatures);
    lanes._t = mk("things", "Permanents", things);
    band.appendChild(lanes);

    // Mana column
    const m = P.mana(pid);
    const lands = m.sources.filter(P.isLand).length, rocks = m.total - lands;
    const mc = el("div", "mcol");
    mc.innerHTML = `<div class="mlbl">Mana</div><div class="mnum">${m.untapped}<small>/${m.total}</small></div>` +
      `<div class="mcap">untapped</div><div class="pips">${m.colors.map(x => `<span class="pip ${x}"></span>`).join("")}</div>` +
      `<div class="mcap">${lands} lands${rocks ? `<br>${rocks} rock${rocks > 1 ? "s" : ""}` : ""}</div>`;
    mc.addEventListener("click", e => { e.stopPropagation(); toggleMana(band, m); });
    band.appendChild(mc);
    band._lanes = lanes;
    return band;
  }

  function toggleMana(band, m) {
    const open = band.querySelector(".manapop");
    root.querySelectorAll(".manapop").forEach(x => x.remove());
    if (open) return;
    const pop = el("div", "manapop");
    P.groups(m.sources.slice().sort((a, b) => (a.tapped ? 1 : 0) - (b.tapped ? 1 : 0))).forEach(g => {
      const t = P.tile(g.rep, { group: g.ids });
      P.press(t, { tap: () => P.inspect(g.rep.id) });
      pop.appendChild(t);
    });
    pop.addEventListener("click", e => e.stopPropagation());
    band.appendChild(pop);
  }

  function layoutBand(band, u) {
    const lanes = band._lanes;
    const W = lanes.clientWidth, H = lanes.clientHeight;
    if (!W || !H) return;
    const me = band.classList.contains("me");
    const minW = 50 * u, maxW = (me ? 112 : 100) * u, lbl = 16 * u, pad = 6 * u;
    const ci = lanes._c._slots.map(s => ({ k: s._k })), ti = lanes._t._slots.map(s => ({ k: s._k }));
    let best = null;
    const avail = W - 2 * lbl - 2 * pad;
    const ratios = !ci.length ? [0] : !ti.length ? [1] : Array.from({ length: 41 }, (_, i) => 0.15 + i * 0.0175);
    for (const r of ratios) {
      const wc = avail * r, wt = avail - wc;
      const a = ci.length ? pack(ci, wc, H, minW, maxW, u) : { w: maxW, pos: [], fit: true };
      const b = ti.length ? pack(ti, wt, H, minW, maxW, u) : { w: maxW, pos: [], fit: true };
      const score = Math.min(a.fit ? a.w : a.w * 0.6, (b.fit ? b.w : b.w * 0.6) * 1.3);
      if (!best || score > best.score) best = { score, r, a, b, wc, wt };
    }
    const place = (lane, res, left, width) => {
      lane.style.left = left + "px";
      lane.style.width = width + lbl + "px";
      lane._slots.forEach((s, i) => {
        const p = res.pos[i];
        s.style.left = lbl + p.x + "px";
        s.style.top = p.y + "px";
        s.style.zIndex = i + 1;
        const host = s.lastElementChild;
        host.style.setProperty("--w", p.w + "px");
        host.style.position = "absolute";
        host.style.left = "0px"; host.style.top = "0px";
        s.querySelectorAll(".tuck").forEach(tk => {
          const k = +tk.dataset.i;
          tk.style.left = p.w * TUCK * (s._k - k) + "px";
          tk.style.zIndex = -1;
          tk.firstElementChild.style.setProperty("--w", p.w + "px");
        });
      });
    };
    place(lanes._c, best.a, pad, best.wc);
    place(lanes._t, best.b, pad + lbl + best.wc + pad, best.wt);
  }

  // ---- Rail: priority, stack, table rules, hand -----------------------------------------------------------------
  function buildRail() {
    const rail = el("aside", "rail");
    const pr = el("div", "prioc");
    const act = P.player(G.active);
    pr.innerHTML = `<div class="p1">You have priority</div><div class="p2"><b>${esc(act.name)}</b>'s turn ${G.turn} · ${esc(G.phase)}</div>`;
    const row = el("div", "row");
    const pass = el("button", "btn", "Pass");
    pass.addEventListener("click", () => toast("Passed. In the prototype nothing resolves."));
    const lens = el("button", "btn lensbtn", "Lens");
    lens.setAttribute("aria-pressed", "false");
    lens.addEventListener("click", () => {
      const on = !root.classList.contains("lens");
      root.classList.toggle("lens", on);
      lens.setAttribute("aria-pressed", String(on));
    });
    row.append(pass, lens);
    pr.appendChild(row);
    rail.appendChild(pr);

    if (G.stack.length) {
      rail.appendChild(el("div", "rhead", `<span>Stack</span><span>${G.stack.length}</span>`));
      const st = el("div", "stack");
      G.stack.forEach((s, i) => {
        const it = P.stackItem(s, i);
        it.appendChild(el("span", "anchor"));
        P.press(it, { tap: () => P.inspect(s.card) });
        st.appendChild(it);
      });
      rail.appendChild(st);
    }

    const rules = P.rules();
    rail.appendChild(el("div", "rhead", `<span>Table rules</span><span>${rules.length}</span>`));
    const list = el("div", "rules");
    rules.forEach(r => {
      const b = el("button", "rule " + P.seatClass(r.controller),
        `<span class="dot"></span><span>${esc(r.text).replace(/\{(\w+)\}/g, '<span class="ms">$1</span>')}</span>`);
      b.dataset.id = r.id;
      P.press(b, { tap: () => highlight(r.id, b) });
      list.appendChild(b);
    });
    rail.appendChild(list);

    const dock = el("div", "handdock");
    dock.appendChild(el("div", "rhead handlbl", `<span>Your hand</span><span>${P.player(P.ME).hand.length}</span>`));
    P.hand(dock, { spread: 4, gap: 25 });
    rail.appendChild(dock);
    return rail;
  }

  function stackPairs() {
    const pairs = [];
    G.stack.forEach(s => s.targets.forEach(t => {
      const from = root.querySelector(`.sitem[data-stack="${s.id}"] .anchor`);
      let to = null;
      if (t.stack) to = root.querySelector(`.sitem[data-stack="${t.stack}"] .anchor`);
      if (t.card) to = root.querySelector(`.lane .tile[data-id="${t.card}"]`);
      if (from && to) pairs.push([from, to, P.seatColor(s.controller)]);
    }));
    return pairs;
  }
  function drawArrows() { if (root && !root.hidden) P.arrows(stackPairs()); }

  let hlTimer = null;
  function highlight(id, from) {
    const t = root.querySelector(`.lane .tile[data-id="${id}"]`);
    if (!t) return;
    t.classList.remove("pulse"); void t.offsetWidth; t.classList.add("pulse");
    P.arrows(stackPairs().concat([[from, t, P.seatColor(P.card(id).controller)]]));
    clearTimeout(hlTimer);
    hlTimer = setTimeout(() => { t.classList.remove("pulse"); drawArrows(); }, 1800);
  }

  function toast(msg) {
    const t = el("div", "toast", esc(msg));
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  P.register("c", {
    title: "Ledger",
    mount(r) {
      root = r;
      const keep = lensKeep();
      const bands = el("div", "bands");
      ORDER.forEach(pid => bands.appendChild(buildBand(pid, keep)));
      root.append(bands, buildRail());
      root.addEventListener("click", () => root.querySelectorAll(".manapop").forEach(x => x.remove()));
      layoutAll = () => { const u = P.unit(); bands.querySelectorAll(".band").forEach(b => layoutBand(b, u)); };
    },
    show() { layoutAll && layoutAll(); requestAnimationFrame(drawArrows); },
    hide() { P.clearArrows(); },
  });
})();
