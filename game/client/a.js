// Prototype A, "Spotlight": focus plus context. Your board fills the lower half; the three opponents sit across the
// top as seats with a digest of what matters on their board. Tap a seat to spotlight it: its whole board opens in
// the upper area and the other seats shrink to plates. The stack is a chain at centre-right with arrows to targets.
(function () {
  const P = Proto, ME = P.ME, OPPS = P.players.filter(p => p.id !== ME).map(p => p.id);
  const el = P.el;
  let root, opps, spot = null;

  // ---- Sorting a board into what you look at -----------------------------------------------------------------
  const hasCounters = c => Object.keys(c.counters || {}).length > 0;
  const notableLand = c => P.isLand(c) && !!(P.attachments(c.id).length || c.becameLand || c.commander || c.copyOf || c.chosen || hasCounters(c));
  function split(pid) {
    const creatures = [], others = [], mana = [], away = [];
    for (const c of P.battlefield(pid)) {
      if (c.attachedTo) { if (P.card(c.attachedTo).controller !== pid) away.push(c); continue; }
      if (P.isLand(c)) { (notableLand(c) ? others : mana).push(c); continue; }
      const cat = P.category(c);
      if (cat === "creature") creatures.push(c);
      else if (cat === "mana") mana.push(c);
      else others.push(c);
    }
    const power = c => (c.power != null ? c.power : P.basePT(c).power);
    creatures.sort((a, b) => (b.commander - a.commander) || power(b) - power(a));
    const rank = c => (c.commander ? 4 : 0) + (P.isPW(c) ? 3 : 0) + (P.RULES[c.card] ? 2 : 0) + (P.isLand(c) ? -2 : 0);
    others.sort((a, b) => rank(b) - rank(a));
    return { creatures, others, mana, away };
  }
  // The few cards that matter most on a board, for a seat's digest.
  function digest(pid, n) {
    const s = split(pid);
    const score = g => {
      const c = g.rep;
      let v = 0;
      if (c.commander) v += 1000;
      if (P.isPW(c)) v += 500;
      if (P.RULES[c.card]) v += 200;
      if (P.isCreature(c)) v += (c.power || 0) * 12 * Math.min(g.ids.length, 3) + g.ids.length;
      if (hasCounters(c)) v += 30;
      if (c.copyOf || c.transformed || c.faceDown) v += 10;
      return v;
    };
    return P.groups(s.creatures.concat(s.others)).sort((a, b) => score(b) - score(a)).slice(0, n);
  }
  function counts(pid) {
    const s = split(pid), m = manaOf(pid);
    const power = s.creatures.reduce((t, c) => t + Math.max(0, c.power || 0), 0);
    return { creatures: s.creatures.length, power, other: s.others.length + s.away.length, mana: m };
  }

  // ---- Pieces --------------------------------------------------------------------------------------------------
  // Tiles show legendary names up to the comma ("Marath"), so more of the name fits beside the P/T.
  function shorten(t) {
    const nm = t.querySelector(":scope > .nm");
    if (nm && nm.textContent.includes(", ")) nm.textContent = nm.textContent.split(", ")[0];
    return t;
  }
  function bind(t, g) {
    shorten(t);
    P.press(t, {
      tap: () => (g.ids.length > 1 ? groupSheet(`${P.name(g.rep)} ×${g.ids.length}`, g.ids.map(P.card)) : P.inspect(g.rep.id)),
    });
  }
  // A tile with its auras and equipment tucked behind it, peeking out above.
  function hostTile(g) {
    const c = g.rep, t = P.tile(c, { group: g.ids });
    bind(t, g);
    const att = P.attachments(c.id);
    if (!att.length) return t;
    const w = el("div", "host");
    att.forEach((a, i) => {
      const at = P.tile(a, { name: false });
      at.classList.add("tuck");
      at.style.setProperty("--i", i);
      if (a.controller !== c.controller) at.appendChild(el("div", "owner-tag", P.esc(P.player(a.controller).name) + " · " + P.esc(P.name(a))));
      bind(at, { rep: a, ids: [a.id] });
      w.appendChild(at);
    });
    w.appendChild(t);
    return w;
  }
  // An aura or equipment controlled here but attached to someone else's permanent.
  function awayTile(c) {
    const host = P.card(c.attachedTo);
    const w = el("div", "away");
    const t = P.tile(c);
    bind(t, { rep: c, ids: [c.id] });
    w.appendChild(t);
    w.appendChild(el("div", "away-cap", "on " + P.esc(P.player(host.controller).name === "You" ? "your" : P.player(host.controller).name + "'s") + " " + P.esc(P.printed(host).name)));
    return w;
  }
  function row(list, cls) {
    const r = el("div", "row " + (cls || ""));
    P.groups(list).forEach(g => r.appendChild(hostTile(g)));
    return r;
  }
  function manaOf(pid) {
    const sources = P.mana(pid).sources.filter(c => P.isLand(c) || P.category(c) === "mana");
    const untapped = sources.filter(c => !c.tapped), colors = new Set();
    untapped.forEach(c => (c.becameLand ? ["C"] : P.DB[c.card].produces || []).forEach(x => colors.add(x)));
    return { sources, total: sources.length, untapped: untapped.length, colors: "WUBRGC".split("").filter(x => colors.has(x)) };
  }
  const PIP = { W: "W", U: "U", B: "B", R: "R", G: "G", C: "C" };
  function well(pid, size) {
    const m = manaOf(pid);
    const b = el("button", "well " + (size || ""));
    b.innerHTML = `<span class="wnum"><b>${m.untapped}</b><small>/${m.total}</small></span>` +
      `<span class="pips">${m.colors.map(x => `<i class="pip pip-${x}">${PIP[x]}</i>`).join("")}</span>` +
      `<span class="wlabel">mana sources</span>`;
    b.addEventListener("click", e => { e.stopPropagation(); groupSheet(`${P.player(pid).name}: mana sources (${m.untapped} untapped of ${m.total})`, m.sources); });
    return b;
  }
  function zoneButtons(pid, compact) {
    const p = P.player(pid), box = el("div", "zones");
    const add = (label, icon, ids) => {
      const b = el("button", "zbtn", `${P.ICON[icon]}<span>${compact ? "" : label + " "}</span><b>${ids.length}</b>`);
      b.setAttribute("aria-label", `${label}: ${ids.length}`);
      b.addEventListener("click", e => { e.stopPropagation(); P.sheet(`${p.name}: ${label.toLowerCase()} (${ids.length})`, ids); });
      box.appendChild(b);
    };
    add("Graveyard", "grave", p.graveyard);
    add("Exile", "exile", p.exile);
    if (p.command.length) add("Command", "cmd", p.command);
    return box;
  }
  function groupSheet(title, cards) {
    const scrim = el("div", "scrim");
    scrim.style.placeItems = "end stretch";
    const s = el("div", "sheet proto-a-sheet");
    s.appendChild(el("div", "grab"));
    s.appendChild(el("h4", "", P.esc(title)));
    const g = el("div", "grid");
    P.groups(cards).forEach(gr => { const t = P.tile(gr.rep, { group: gr.ids }); P.press(t, { tap: () => P.inspect(gr.rep.id) }); g.appendChild(t); });
    s.appendChild(g);
    scrim.appendChild(s);
    scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
    let y0 = null;
    s.addEventListener("pointerdown", e => (y0 = e.clientY));
    s.addEventListener("pointerup", e => { if (y0 != null && e.clientY - y0 > 60) scrim.remove(); y0 = null; });
    document.body.appendChild(scrim);
  }
  function toast(text) {
    const t = el("div", "a-toast", P.esc(text));
    root.appendChild(t);
    setTimeout(() => t.classList.add("out"), 1400);
    setTimeout(() => t.remove(), 1800);
  }
  const symbols = s => P.esc(s).replace(/\{(\w)\}/g, '<i class="sym">$1</i>');

  // ---- Seats ---------------------------------------------------------------------------------------------------
  function seat(pid) {
    const p = P.player(pid), k = counts(pid), s = split(pid);
    const box = el("section", "seat " + P.seatClass(pid));
    box.dataset.pid = pid;
    const head = el("div", "seat-head");
    head.appendChild(P.plate(pid));
    const cmdZone = p.command.map(P.card).find(c => c.commander);
    if (cmdZone) head.appendChild(el("div", "cz", `${P.ICON.cmd}<span>${P.esc(P.printed(cmdZone).name.split(",")[0])} in command zone · cast ${cmdZone.commanderCasts}×</span>`));
    const tools = el("div", "spot-tools");
    tools.appendChild(well(pid, "small"));
    tools.appendChild(zoneButtons(pid, true));
    head.appendChild(tools);
    head.appendChild(el("div", "chev", '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>'));
    box.appendChild(head);

    // Default: the digest.
    const d = el("div", "digest view");
    const tiles = el("div", "row");
    digest(pid, 8).forEach(g => tiles.appendChild(hostTile(g)));
    d.appendChild(tiles);
    const foot = el("div", "foot");
    foot.appendChild(el("div", "counts", `<b>${k.creatures}</b> creatures · <b>${k.power}</b> power<br><b>${k.other}</b> other · <b>${k.mana.untapped}</b>/${k.mana.total} mana`));
    foot.appendChild(zoneButtons(pid, true));
    d.appendChild(foot);
    box.appendChild(d);

    // Spotlit: the whole board.
    const f = el("div", "full view");
    const rows = el("div", "full-rows");
    rows.appendChild(row(s.creatures, "creatures"));
    const o = row(s.others, "others");
    s.away.forEach(c => o.appendChild(awayTile(c)));
    rows.appendChild(o);
    f.appendChild(rows);
    box.appendChild(f);

    // Shrunk beside a spotlit seat: the plate, the top three cards and the counts.
    const m = el("div", "mini view");
    const mt = el("div", "row");
    digest(pid, 6).forEach(g => mt.appendChild(hostTile(g)));
    m.appendChild(mt);
    m.appendChild(el("div", "counts", `<b>${k.creatures}</b> creatures · <b>${k.power}</b> pow<br><b>${k.mana.untapped}</b>/${k.mana.total} mana · <b>${k.other}</b> other`));
    box.appendChild(m);

    box.addEventListener("click", e => {
      if (e.target.closest(".tile, button, .avatar")) return;
      setSpot(spot === pid ? null : pid);
    });
    return box;
  }
  function setSpot(pid) {
    spot = pid;
    opps.classList.toggle("has-spot", !!pid);
    opps.querySelectorAll(".seat").forEach(s => s.classList.toggle("spot", s.dataset.pid === pid));
    P.clearArrows();
    setTimeout(drawArrows, 420);
  }
  function pulse(id) {
    const t = [...root.querySelectorAll(".seat.spot .full .tile, .mine .tile")]
      .find(x => +x.dataset.id === id || (x.dataset.group || "").split(",").map(Number).includes(id));
    if (!t) return;
    t.classList.remove("pulse");
    void t.offsetWidth;
    t.classList.add("pulse");
    setTimeout(() => t.classList.remove("pulse"), 1700);
  }

  // ---- Your side -------------------------------------------------------------------------------------------------
  function mine() {
    const s = split(ME), p = P.player(ME);
    const box = el("section", "mine " + P.seatClass(ME));
    const side = el("div", "mine-side");
    side.appendChild(P.plate(ME));
    side.appendChild(well(ME));
    side.appendChild(zoneButtons(ME));
    box.appendChild(side);
    const board = el("div", "mine-board");
    board.appendChild(row(s.creatures, "creatures"));
    board.appendChild(row(s.others, "others"));
    P.hand(board, { gap: 64, spread: 8 });
    box.appendChild(board);
    return box;
  }

  function rulesStrip() {
    const r = el("div", "rules");
    const list = P.rules().sort((a, b) => (a.controller === ME) - (b.controller === ME));
    r.appendChild(el("div", "rules-label", `Rules in play <b>${list.length}</b>`));
    const sc = el("div", "rules-scroll");
    list.forEach(x => {
      const b = el("button", "rchip " + P.seatClass(x.controller), `<i class="dot"></i>${symbols(x.text)}`);
      b.addEventListener("click", () => {
        if (x.controller !== ME && spot !== x.controller) { setSpot(x.controller); setTimeout(() => pulse(x.id), 430); }
        else pulse(x.id);
      });
      sc.appendChild(b);
    });
    r.appendChild(sc);
    return r;
  }

  function stackCol() {
    const c = el("aside", "stackcol");
    c.appendChild(el("div", "col-label", `Stack <b>${P.G.stack.length}</b>`));
    const s = el("div", "stack");
    P.G.stack.forEach((item, i) => {
      const it = P.stackItem(item, i);
      it.appendChild(el("i", "anchor"));
      P.press(it, { tap: () => P.inspect(item.card) });
      s.appendChild(it);
    });
    c.appendChild(s);
    const log = el("div", "log");
    log.appendChild(el("div", "col-label", "Log"));
    P.G.log.slice(-5).forEach((line, i, a) => log.appendChild(el("div", "logline" + (i === a.length - 1 ? " last" : ""), P.esc(line))));
    c.appendChild(log);
    return c;
  }

  function prioBar() {
    const active = P.player(P.G.active);
    const b = el("div", "prio a-prio");
    b.innerHTML = `<div class="ptext"><b>You have priority</b><span class="phase">${P.esc(active.name)}'s turn ${P.G.turn} · ${P.esc(P.G.phase)}</span></div>`;
    const pass = el("button", "btn", "Pass");
    pass.addEventListener("click", () => toast("Passed priority (prototype: nothing happens)"));
    b.appendChild(pass);
    return b;
  }

  function drawArrows() {
    if (!root || root.closest(".stage").hidden) return;
    const pairs = [];
    P.G.stack.forEach(item => item.targets.forEach(t => {
      if (!t.stack) return;
      const a = root.querySelector(`.sitem[data-stack="${item.id}"] .anchor`);
      const b = root.querySelector(`.sitem[data-stack="${t.stack}"] .anchor`);
      pairs.push([a, b, P.seatColor(item.controller)]);
    }));
    P.arrows(pairs);
  }

  P.register("a", {
    title: "Spotlight",
    mount(r) {
      root = r;
      opps = el("div", "opps");
      OPPS.forEach(pid => opps.appendChild(seat(pid)));
      root.appendChild(opps);
      root.appendChild(rulesStrip());
      root.appendChild(stackCol());
      root.appendChild(mine());
      root.appendChild(prioBar());
    },
    show() { drawArrows(); if (document.fonts) document.fonts.ready.then(drawArrows); },
    hide() { P.clearArrows(); },
  });
})();
