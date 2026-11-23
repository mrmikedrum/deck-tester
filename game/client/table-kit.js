// Tabletop kit for the Table variations: the named table card, piles and sifting, a seat's arrangement, the
// director's script of recent actions, and a lab panel for comparing tapped styles. Builds on Proto (common.js).
(function () {
  const P = window.Proto, G = P.G, DB = P.DB;

  // ---- Keyword icons (Arena-style shorthand) ------------------------------------------------------------------
  const KW = {
    Flying: "M2 15c5 0 9-3 12-10 1 3 1 6-1 9 2-1 5-1 8 0-2 2-5 3-8 3 1 1 3 1 5 2-3 1-7 1-10-1-2 0-4-1-6-3z",
    Reach: "M12 2l5 6h-3.5v6h-3V8H7zM5 16c4 3 10 3 14 0v2.5c-4 3-10 3-14 0z",
    Trample: "M3 5l7 7-7 7zm9 0l7 7-7 7z",
    Deathtouch: "M12 2a8 8 0 00-8 8c0 3 1.5 5 3 6v3h2v-2h2v2h2v-2h2v2h2v-3c1.5-1 3-3 3-6a8 8 0 00-8-8zM8.5 9a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4z",
    Lifelink: "M12 21l-1.5-1.3C5 15 2 12 2 8.5 2 5.5 4.5 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.5 3 22 5.5 22 8.5c0 3.5-3 6.5-8.5 11.2z",
    Vigilance: "M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z",
    Haste: "M13 2L4 14h6l-1 8 9-12h-6z",
    Hexproof: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zm-3.5 6.5l7 7 1.4-1.4-7-7z",
    Indestructible: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zm0 5l-3 3 3 3 3-3z",
    Menace: "M4 3c0 6 2 10 6 11l-1 7h6l-1-7c4-1 6-5 6-11-2 3-4 5-7 5S6 6 4 3z",
    "First strike": "M20 2l2 2-11 11 2 2-2 2-2-2-4 4-2-2 4-4-2-2 2-2 2 2z",
    "Double strike": "M20 2l2 2-9 9 2 2-2 2-2-2-3 3-2-2 3-3-2-2 2-2 2 2zM4 2l7 7-2 2-7-7z",
    Ward: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zm0 5l-4 4 4 4 4-4z",
    Protection: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zm-1 13l6-6-1.4-1.4L11 12.2 8.4 9.6 7 11z",
    Toxic: "M12 2s7 8 7 13a7 7 0 01-14 0c0-5 7-13 7-13z",
    Infect: "M12 2s7 8 7 13a7 7 0 01-14 0c0-5 7-13 7-13z",
    Defender: "M2 5h20v4H2zm0 5h9v4H2zm11 0h9v4h-9zM2 15h20v4H2z",
  };
  const KW_ORDER = Object.keys(KW);
  const svg = d => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  function keywords(c) {
    if (c.faceDown || c.becameLand) return [];
    const f = P.face(c), have = new Set();
    (f.keywords || []).forEach(k => KW[k] && have.add(k));
    (c.keywords || []).forEach(k => { const base = k.split(" from")[0]; if (KW[base]) have.add(base); });
    if (c.counters && c.counters.INDESTRUCTIBLE) have.add("Indestructible");
    return KW_ORDER.filter(k => have.has(k));
  }

  // ---- Frame colour by what the card is now --------------------------------------------------------------
  const FRAME = { W: "#e7dfc4", U: "#3f7fcc", B: "#4b4157", R: "#c94b3c", G: "#3f8b50", M: "#c9a64a", C: "#a3abb5", L: "#8d7457" };
  function frame(c) {
    if (c.faceDown) return "#7a5a33";
    if (P.isLand(c)) return FRAME.L;
    const cols = P.face(c).colors || [];
    return cols.length > 1 ? FRAME.M : cols.length ? FRAME[cols[0]] : FRAME.C;
  }

  const actionable = new Set(G.actionable || []);
  const CTR = { P1P1: "+", CHARGE: "charge", LORE: "lore", STORY: "story", LUCK: "luck" };

  // ---- The table card ---------------------------------------------------------------------------------------
  // opts: { cw: px width, press: false to skip touch handlers, onTap }
  function card(c, opts = {}) {
    const t = P.el("div", "tc " + P.seatClass(c.controller));
    t.dataset.id = c.id;
    if (opts.cw) t.style.setProperty("--cw", opts.cw + "px");
    t.style.setProperty("--frame", frame(c));
    if (c.token) t.classList.add("token");
    if (c.faceDown) t.classList.add("facedown");
    if (c.tapped) t.classList.add("tapped");
    if (actionable.has(c.id)) t.classList.add("can");
    const body = P.el("div", "tc-body");
    const nm = P.el("div", "tc-name");
    if (c.commander) nm.insertAdjacentHTML("beforeend", P.ICON.crown);
    nm.insertAdjacentHTML("beforeend", `<span>${P.esc(P.name(c))}</span>`);
    if (c.token) nm.insertAdjacentHTML("beforeend", '<em class="tok">TOKEN</em>');
    body.appendChild(nm);
    const art = P.el("div", "tc-art");
    const src = P.art(c);
    if (src) art.style.backgroundImage = `url("${src}")`;
    body.appendChild(art);
    const foot = P.el("div", "tc-foot");
    const kw = P.el("div", "tc-kw");
    keywords(c).forEach(k => {
      const i = P.el("i", k === "Protection" ? "prot" : "", svg(KW[k]));
      i.title = k;
      kw.appendChild(i);
    });
    foot.appendChild(kw);
    if (P.isCreature(c)) {
      const b = P.basePT(c);
      const p = c.power != null ? c.power : b.power, q = c.toughness != null ? c.toughness : b.toughness;
      const cls = (v, base) => (v > base ? "up" : v < base ? "down" : "");
      foot.appendChild(P.el("div", "tc-pt", `<span class="${cls(p, b.power)}">${p}</span>/<span class="${cls(q, b.toughness)}">${q}</span>`));
    } else if (c.counters && c.counters.LOYALTY != null) {
      foot.appendChild(P.el("div", "tc-pt loy", c.counters.LOYALTY));
    }
    body.appendChild(foot);
    t.appendChild(body);
    const ctrs = Object.entries(c.counters || {}).filter(([k]) => k !== "LOYALTY" && k !== "INDESTRUCTIBLE" && !(k === "P1P1" && P.isCreature(c)));
    if (ctrs.length || c.classLevel || (c.chosen && c.chosen.type)) {
      const box = P.el("div", "tc-ctr");
      ctrs.forEach(([k, v]) => box.appendChild(P.el("b", k.toLowerCase(), k === "P1P1" ? `+${v}` : `${v} ${CTR[k] || k.toLowerCase()}`)));
      if (c.classLevel) box.appendChild(P.el("b", "lore", "Level " + c.classLevel));
      if (c.chosen && c.chosen.type) box.appendChild(P.el("b", "", c.chosen.type));
      t.appendChild(box);
    }
    const badges = [];
    if (c.copyOf) badges.push(["copy", "Copy"]);
    if (c.transformed) badges.push(["dfc", "Transformed"]);
    if (c.goaded) badges.push(["goad", "Goaded"]);
    if (c.sick) badges.push(["sick", "Summoning sick"]);
    if (c.becameLand) badges.push(["", c.landName ? "Now a land" : "Land now"]);
    if (badges.length) t.appendChild(P.el("div", "tc-badges", badges.map(([k, v]) => `<b class="${k}">${v}</b>`).join("")));
    const f = c.faceDown ? null : P.face(c);
    if (f && f.abilities && !c.becameLand) t.appendChild(P.el("div", "tc-gem"));
    t.appendChild(P.el("div", "tc-label", P.esc(P.name(c))));
    if (opts.press !== false) P.press(t, { tap: opts.onTap || (() => P.inspect(c.id)) });
    return t;
  }
  const height = cw => cw * 1.4;

  // A card with what's attached to it: attachments cascade behind it, peeking above with their names showing.
  function unit(c, opts = {}) {
    const cw = opts.cw || 96, step = cw * 0.2;
    const att = P.attachments(c.id).map(a => a);
    if (!att.length) return card(c, opts);
    const u = P.el("div", "unit");
    u.dataset.id = c.id;
    u.style.width = cw + "px";
    u.style.height = height(cw) + step * att.length + "px";
    att.forEach((a, i) => {
      const t = card(a, { cw, onTap: () => P.inspect(a.id) });
      t.style.top = i * step + "px";
      if (a.controller !== c.controller) t.appendChild(P.el("div", "tc-from", P.esc(P.player(a.controller).name) + "'s"));
      u.appendChild(t);
    });
    const host = card(c, opts);
    host.style.top = att.length * step + "px";
    u.appendChild(host);
    return u;
  }

  // A neat stack of identical cards, with a count.
  function stack(ids, opts = {}) {
    const cw = opts.cw || 96, n = ids.length;
    if (n === 1) return unit(P.card(ids[0]), opts);
    const pile = P.el("div", "pile stack");
    const show = Math.min(n, 4), off = Math.max(2, cw * 0.035);
    const top = P.card(ids[0]);
    const tapped = top.tapped;
    const w = tapped ? height(cw) : cw, h = tapped ? cw : height(cw);
    pile.style.width = w + off * (show - 1) + "px";
    pile.style.height = h + off * (show - 1) + "px";
    pile.style.setProperty("--cw", cw + "px");
    for (let i = show - 1; i >= 0; i--) {
      const t = card(P.card(ids[i]), { cw, onTap: () => sift(ids, pile, opts.title || P.name(top)) });
      t.style.left = i * off + "px";
      t.style.top = (show - 1 - i) * off + "px";
      if (i > 0) t.style.filter = "brightness(.8)";
      pile.appendChild(t);
    }
    pile.appendChild(P.el("div", "count", "×" + n));
    pile.dataset.ids = ids.join(",");
    return pile;
  }

  // A cascade of different cards: each shows its name bar; tap to sift through them.
  function cascade(ids, opts = {}) {
    const cw = opts.cw || 96, step = cw * 0.2, max = opts.max || 8;
    const shown = ids.slice(0, max);
    const pile = P.el("div", "pile cascade");
    pile.style.width = cw + "px";
    pile.style.height = height(cw) + step * (shown.length - 1) + "px";
    pile.style.setProperty("--cw", cw + "px");
    shown.slice().reverse().forEach((id, k) => {
      const i = shown.length - 1 - k;
      const c = P.card(id);
      const t = card(c, { cw, onTap: () => sift(ids, pile, opts.title || "Pile") });
      t.style.top = (shown.length - 1 - i) * step + "px";
      t.classList.remove("tapped");
      if (c.tapped) t.querySelector(".tc-name").insertAdjacentHTML("beforeend", '<em class="tok">↻</em>');
      pile.appendChild(t);
    });
    pile.appendChild(P.el("div", "count", ids.length));
    if (opts.title) pile.appendChild(P.el("div", "ptitle", P.esc(opts.title)));
    pile.dataset.ids = ids.join(",");
    return pile;
  }

  // Spread a pile's cards out over the table; tap one to inspect, tap the table to gather them back.
  function sift(ids, from, title) {
    const s = P.el("div", "sift");
    s.dataset.tapped = document.querySelector("[data-tapped]")?.dataset.tapped || "turn";
    s.appendChild(P.el("h4", "", P.esc(title) + ` · ${ids.length}`));
    const spread = P.el("div", "spread");
    const r = from.getBoundingClientRect();
    ids.forEach(id => spread.appendChild(card(P.card(id), { cw: 118 })));
    s.appendChild(spread);
    s.appendChild(P.el("div", "hint", "Tap a card for detail · tap the table to put them back"));
    document.body.appendChild(s);
    const cards = [...spread.children];
    cards.forEach((t, i) => {
      const b = t.getBoundingClientRect();
      t.style.transition = "none";
      t.style.transform = `translate(${r.left - b.left}px, ${r.top - b.top}px) scale(.6)`;
      t.style.opacity = "0";
      requestAnimationFrame(() => requestAnimationFrame(() => {
        t.style.transition = `transform .38s cubic-bezier(.2,.8,.2,1) ${i * 18}ms, opacity .2s ${i * 18}ms`;
        t.style.transform = ""; t.style.opacity = "1";
      }));
    });
    s.addEventListener("click", e => {
      if (e.target !== s && e.target !== spread) return;
      cards.forEach(t => {
        const b = t.getBoundingClientRect();
        t.style.transform = `translate(${r.left - b.left}px, ${r.top - b.top}px) scale(.6)`;
        t.style.opacity = "0";
      });
      s.style.transition = "opacity .3s"; s.style.opacity = "0";
      setTimeout(() => s.remove(), 320);
    });
  }

  // ---- How one seat's permanents are arranged ------------------------------------------------------------
  // Returns rows of items, each { kind: "unit" | "stack" | "cascade", ids, title? }:
  //   creatures (commander first, then by power; identical ones stacked),
  //   others (planeswalkers, then permanents that do things, and lands that matter),
  //   mana (identical lands and rocks stacked, the remaining lands and rocks in cascades).
  function arrange(pid) {
    const all = P.battlefield(pid).filter(c => !c.attachedTo);
    const notableLand = c => P.isLand(c) && (c.becameLand || c.landName || c.counters || c.chosen || c.copyOf || c.commander || P.attachments(c.id).length);
    const isManaLike = c => (P.isLand(c) && !notableLand(c)) || (!P.isCreature(c) && P.isMana(c));
    const creatures = all.filter(c => P.isCreature(c));
    const mana = all.filter(c => isManaLike(c));
    const others = all.filter(c => !creatures.includes(c) && !mana.includes(c));
    const power = c => (c.power != null ? c.power : P.basePT(c).power);
    const sortCreatures = (a, b) => (b.commander - a.commander) || (!!a.token - !!b.token) || power(b) - power(a);
    const grouped = list => P.groups(list).map(g => ({ kind: g.ids.length > 1 ? "stack" : "unit", ids: g.ids }));
    const otherRank = c => (P.isPW(c) ? 0 : P.isLand(c) ? 3 : c.token ? 2 : 1);
    const manaGroups = P.groups(mana.sort((a, b) => P.isLand(b) - P.isLand(a)));
    const stacks = manaGroups.filter(g => g.ids.length > 1).map(g => ({ kind: "stack", ids: g.ids }));
    const singleLands = manaGroups.filter(g => g.ids.length === 1 && P.isLand(g.rep)).map(g => g.ids[0]);
    const singleRocks = manaGroups.filter(g => g.ids.length === 1 && !P.isLand(g.rep)).map(g => g.ids[0]);
    const m = P.mana(pid);
    return {
      creatures: grouped(creatures.sort(sortCreatures)),
      others: grouped(others.sort((a, b) => otherRank(a) - otherRank(b))),
      mana: [
        ...stacks,
        ...(singleLands.length ? [{ kind: "cascade", ids: singleLands, title: "Lands" }] : []),
        ...(singleRocks.length ? [{ kind: "cascade", ids: singleRocks, title: "Mana rocks" }] : []),
      ],
      manaSummary: m,
    };
  }
  // Render an item from arrange().
  function item(it, opts = {}) {
    if (it.kind === "cascade") return cascade(it.ids, Object.assign({ title: it.title }, opts));
    if (it.kind === "stack") return stack(it.ids, opts);
    return unit(P.card(it.ids[0]), opts);
  }
  // Fold the tail of a row into one cascade when it holds more than `max` items.
  function overflow(items, max, title = "More") {
    if (items.length <= max) return items;
    const keep = items.slice(0, max - 1), rest = items.slice(max - 1);
    return [...keep, { kind: "cascade", ids: rest.flatMap(i => i.ids), title }];
  }

  // ---- Director: the recent actions, for the camera to follow ------------------------------------------------
  const sid = n => G.stack.find(s => P.printed(P.card(s.card)).name === n);
  const steps = !sid("Sunfall") ? [] : [
    { pid: "ana", stack: sid("Sunfall").id, text: "Ana casts Sunfall", card: sid("Sunfall").card },
    { pid: "bo", stack: sid("Arcane Denial").id, text: "Bo casts Arcane Denial, targeting Sunfall", card: sid("Arcane Denial").card },
    { pid: "cy", stack: sid("Mana Tithe").id, text: "Cy casts Mana Tithe, targeting Arcane Denial", card: sid("Mana Tithe").card },
    { pid: "you", text: "You have priority: respond or pass" },
  ];
  let capEl = null;
  function caption(step) {
    if (capEl) capEl.remove();
    if (!step) return;
    capEl = P.el("div", "caption " + P.seatClass(step.pid));
    const c = step.card ? P.card(step.card) : P.card(P.player(step.pid).commander[0]);
    capEl.innerHTML = `<span class="cart" style="background-image:url('${P.printed(c).art}')"></span>${P.esc(step.text)}`;
    document.body.appendChild(capEl);
  }
  // Plays the steps, calling focus(step) for each (it may return a promise); dwell ms per step.
  function direct(focus, { dwell = 1700, onDone } = {}) {
    let cancelled = false, i = 0;
    const next = async () => {
      if (cancelled) return;
      if (i >= steps.length) { setTimeout(() => !cancelled && caption(null), 1600); if (onDone) onDone(); return; }
      const s = steps[i++];
      caption(s);
      await focus(s);
      setTimeout(next, dwell);
    };
    next();
    return { cancel() { cancelled = true; caption(null); } };
  }

  // ---- Hand with castable cards marked ----------------------------------------------------------------------
  function hand(container, opts) {
    const h = P.hand(container, opts);
    const ok = new Set(G.playable || []);
    h.querySelectorAll(".hcard").forEach(x => x.classList.add(ok.has(+x.dataset.id) ? "playable" : "unplayable"));
    return h;
  }

  // ---- Lab panel: compare tapped styles, replay the director ------------------------------------------------
  function lab(stage, { replay, at = { right: 12, top: 12 } } = {}) {
    const box = P.el("div", "lab");
    Object.entries(at).forEach(([k, v]) => (box.style[k] = `calc(env(safe-area-inset-${k}, 0px) + ${v}px)`));
    box.appendChild(P.el("span", "lbl", "Tapped"));
    const seg = P.el("div", "seg");
    [["turn", "Turn"], ["rotate", "Rotate"], ["dim", "Dim"]].forEach(([k, label]) => {
      const b = P.el("button", "", label);
      b.setAttribute("aria-pressed", stage.dataset.tapped === k);
      b.addEventListener("click", () => {
        stage.dataset.tapped = k;
        seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
        if (stage._onTapped) stage._onTapped(k);
      });
      seg.appendChild(b);
    });
    box.appendChild(seg);
    if (replay) { const r = P.el("button", "", "▶ Replay"); r.addEventListener("click", replay); box.appendChild(r); }
    stage.appendChild(box);
    return box;
  }

  window.Kit = { KW, keywords, frame, card, unit, stack, cascade, sift, arrange, item, overflow, steps, caption, direct, hand, lab, height };
})();
