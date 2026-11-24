// Shared model and widgets for the board prototypes. Reads window.GAME and window.CARDS (data.js); computes no rules:
// P/T, counters and links come from the state the way Forge's views would deliver them.
(function () {
  const G = window.GAME, DB = window.CARDS;
  const players = G.players, byId = {};
  players.forEach(p => (byId[p.id] = p));
  const card = id => G.cards[id];
  const ME = "you";

  // ---- What a card currently is ------------------------------------------------------------------------------
  function face(c) {
    if (c.faceDown) return null;
    const d = DB[c.copyOf || c.card];
    return d.faces[c.transformed ? 1 : 0] || d.faces[0];
  }
  const printed = c => DB[c.card].faces[0];
  function name(c) {
    if (c.faceDown) return c.controller === ME ? "Face-down · " + printed(c).name : "Face-down 2/2";
    if (c.landName) return c.landName;
    return face(c).name;
  }
  function typeLine(c) {
    if (c.faceDown) return "Creature";
    if (c.becameLand) return c.landName ? "Legendary Land" : "Land";
    return face(c).type;
  }
  function art(c) { return c.faceDown ? null : c.landName ? printed(c).art : face(c).art; }
  function image(c) { return c.faceDown ? null : face(c).img; }
  const isLand = c => !!c.becameLand || /\bLand\b/.test(typeLine(c));
  const isCreature = c => !isLand(c) && (c.faceDown || /Creature/.test(typeLine(c)));
  const isPW = c => /Planeswalker/.test(typeLine(c));
  const isMana = c => !isCreature(c) && !isLand(c) && !isPW(c) && !RULES[c.card] && (DB[c.card].produces || []).length > 0;
  function category(c) {
    if (c.attachedTo) return "attached";
    if (isLand(c)) return "land";
    if (isCreature(c)) return "creature";
    if (isPW(c)) return "planeswalker";
    if (isMana(c)) return "mana";
    return "other";
  }
  const zone = (pid, z) => Object.values(G.cards).filter(c => c.zone === z && c.controller === pid);
  const battlefield = pid => zone(pid, "battlefield");
  const attachments = id => Object.values(G.cards).filter(c => c.attachedTo === id);
  function basePT(c) {
    const f = c.faceDown ? { power: 2, toughness: 2 } : face(c);
    const n = v => (v == null || isNaN(+v) ? 0 : +v);
    return { power: n(f.power), toughness: n(f.toughness) };
  }

  // Cards that are identical to the eye (same name, state, counters, P/T, nothing attached) collapse into one group.
  function groupKey(c) {
    return [c.card, c.copyOf, c.transformed, c.tapped, c.faceDown, c.sick, c.goaded, JSON.stringify(c.counters || {}),
      c.power, c.toughness].join("|");
  }
  function groups(list) {
    const out = [], seen = {};
    for (const c of list) {
      if (attachments(c.id).length || c.commander) { out.push({ rep: c, ids: [c.id] }); continue; }
      const k = groupKey(c);
      if (seen[k]) seen[k].ids.push(c.id);
      else { seen[k] = { rep: c, ids: [c.id] }; out.push(seen[k]); }
    }
    return out;
  }

  // Mana a player's lands and rocks can make: totals and colours among the untapped sources.
  function mana(pid) {
    const src = battlefield(pid).filter(c => !c.attachedTo && (isLand(c) || isMana(c)));
    const untapped = src.filter(c => !c.tapped);
    const colors = new Set();
    untapped.forEach(c => (c.becameLand ? ["C"] : DB[c.card].produces || []).forEach(x => colors.add(x)));
    return { sources: src, total: src.length, untapped: untapped.length, colors: "WUBRGC".split("").filter(x => colors.has(x)) };
  }

  // Effects that change how the game plays for everyone: short digests for the table (a real client would need these
  // written per card, or generated once and cached; Forge provides only the oracle text).
  const RULES = {
    "Trinisphere": "Spells cost at least {3}",
    "Thorn of Amethyst": "Noncreature spells cost {1} more",
    "Rule of Law": "One spell per player per turn",
    "Deafening Silence": "One noncreature spell per player per turn",
    "Suppression Field": "Non-mana activated abilities cost {2} more",
    "Cursed Totem": "Creatures' activated abilities can't be activated",
    "Defense Grid": "Spells cost {3} more except on their caster's turn",
    "Smothering Tithe": "Each draw: pay {2} or Cy makes a Treasure",
    "Paladin Class": "Your spells cost {1} more on Cy's turn",
    "Tekuthal, Inquiry Dominus": "Ana proliferates twice",
    "Unbound Flourishing": "Your X spells and abilities double",
    "Kami of Whispered Hopes": "Your +1/+1 counters get one extra",
  };
  function rules() {
    return Object.values(G.cards).filter(c => c.zone === "battlefield" && RULES[c.card] && !c.faceDown)
      .map(c => ({ id: c.id, text: RULES[c.card], controller: c.controller }));
  }

  const CTR = { P1P1: "+1/+1", LOYALTY: "loyalty", CHARGE: "charge", LORE: "lore", STORY: "story", LUCK: "luck", INDESTRUCTIBLE: "indestructible" };

  // ---- Icons -----------------------------------------------------------------------------------------------
  const ICON = {
    crown: '<svg viewBox="0 0 24 24"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><path d="M8 3h11a2 2 0 012 2v11h-2V5H8zM4 7h11a2 2 0 012 2v11a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z"/></svg>',
    goad: '<svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z"/></svg>',
    sick: '<svg viewBox="0 0 24 24"><path d="M4 4h7v2l-4 5h4v2H4v-2l4-5H4zm9 7h6v2l-3 4h3v2h-6v-2l3-4h-3z"/></svg>',
    dfc: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 100 18 9 9 0 000-18zm0 2v14a7 7 0 010-14z"/></svg>',
    sword: '<svg viewBox="0 0 24 24"><path d="M20 2l2 2-11 11 2 2-2 2-2-2-4 4-2-2 4-4-2-2 2-2 2 2z"/></svg>',
    hand: '<svg viewBox="0 0 24 24"><path d="M6 3h9l5 5v13H6zm2 2v14h10V9h-4V5z"/></svg>',
    library: '<svg viewBox="0 0 24 24"><path d="M5 3h12v16H5zm2 18h12V7h2v16H7z"/></svg>',
    grave: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 017 7v13H5V9a7 7 0 017-7zm-1 5v3H8v2h3v5h2v-5h3v-2h-3V7z"/></svg>',
    exile: '<svg viewBox="0 0 24 24"><path d="M12 2l2.5 7.5H22l-6 4.5 2.3 7.5L12 17l-6.3 4.5L8 14 2 9.5h7.5z"/></svg>',
    poison: '<svg viewBox="0 0 24 24"><path d="M12 2s7 8 7 13a7 7 0 01-14 0c0-5 7-13 7-13z"/></svg>',
    cmd: '<svg viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7z"/></svg>',
    tap: "↻",
  };

  // ---- Elements ----------------------------------------------------------------------------------------------
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const seatClass = pid => "seat-" + pid;

  // A battlefield card: art, name, P/T or loyalty, counters, marks. opts: {group: ids[], name: bool, pt: bool}
  function tile(c, opts = {}) {
    const t = el("div", "tile " + seatClass(c.controller));
    t.dataset.id = c.id;
    if (c.token) t.classList.add("token");
    if (c.faceDown) t.classList.add("facedown");
    if (c.tapped) t.classList.add("tapped");
    const a = el("div", "art");
    const src = art(c);
    if (src) a.style.backgroundImage = `url("${src}")`;
    t.appendChild(a);
    if (c.tapped) t.appendChild(el("div", "tapmark", ICON.tap));
    if (opts.name !== false) t.appendChild(el("div", "nm", esc(name(c))));
    if (isCreature(c)) {
      t.classList.add("has-pt");
      const b = basePT(c);
      const p = c.power != null ? c.power : b.power, q = c.toughness != null ? c.toughness : b.toughness;
      const cls = (v, base) => (v > base ? "up" : v < base ? "down" : "");
      t.appendChild(el("div", "pt", `<span class="${cls(p, b.power)}">${p}</span>/<span class="${cls(q, b.toughness)}">${q}</span>`));
    } else if (c.counters && c.counters.LOYALTY != null) {
      t.classList.add("has-pt");
      t.appendChild(el("div", "loy", c.counters.LOYALTY));
    }
    const ctrs = Object.entries(c.counters || {}).filter(([k]) => k !== "LOYALTY" && !(k === "P1P1" && isCreature(c)));
    if (ctrs.length || c.classLevel || (c.chosen && c.chosen.type)) {
      const box = el("div", "ctrs");
      ctrs.forEach(([k, v]) => box.appendChild(el("span", "ctr " + k.toLowerCase(), k === "P1P1" ? `+${v}` : `${v} ${CTR[k] || k.toLowerCase()}`)));
      if (c.classLevel) box.appendChild(el("span", "ctr lore", "Lv " + c.classLevel));
      if (c.chosen && c.chosen.type) box.appendChild(el("span", "ctr", c.chosen.type));
      t.appendChild(box);
    }
    const marks = el("div", "marks");
    if (c.commander) marks.appendChild(el("span", "mark cmd", ICON.crown));
    if (c.copyOf) marks.appendChild(el("span", "mark copy", ICON.copy));
    if (c.transformed) marks.appendChild(el("span", "mark dfc", ICON.dfc));
    if (c.goaded) marks.appendChild(el("span", "mark goad", ICON.goad));
    if (c.sick) marks.appendChild(el("span", "mark sick", ICON.sick));
    const att = attachments(c.id);
    if (att.length) marks.appendChild(el("span", "mark attach", ICON.sword + att.length));
    if (marks.children.length) t.appendChild(marks);
    if (opts.group && opts.group.length > 1) {
      t.classList.add("group");
      t.appendChild(el("div", "count", "×" + opts.group.length));
      t.dataset.group = opts.group.join(",");
    }
    return t;
  }
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  function plate(pid, opts = {}) {
    const p = byId[pid];
    const box = el("div", "plate " + seatClass(pid));
    const cmd = card(p.commander[0]);
    const av = el("div", "avatar" + (G.active === pid ? " active" : ""));
    av.style.backgroundImage = `url("${printed(cmd).art}")`;
    av.dataset.id = cmd.id;
    box.appendChild(av);
    const who = el("div", "who");
    who.appendChild(el("div", "pname", esc(p.name) + (p.jev ? '<span class="jev">JEV</span>' : "") + (p.monarch ? `<span class="crown" title="Monarch">${ICON.crown.replace("<svg", '<svg style="width:1em;height:1em;fill:currentColor"')}</span>` : "")));
    const stats = [];
    if (p.poison) stats.push(`<span class="poison">${ICON.poison}${p.poison}</span>`);
    stats.push(`<span>${ICON.hand}${p.handCount}</span>`, `<span>${ICON.library}${p.library}</span>`);
    const toMe = cmdDamageTo(ME, pid);
    if (pid !== ME && toMe) stats.push(`<span class="cmddmg" title="Commander damage dealt to you">${ICON.cmd}${toMe}</span>`);
    if (opts.stats !== false) who.appendChild(el("div", "stats", stats.join("")));
    box.appendChild(who);
    box.appendChild(el("div", "life", p.life));
    return box;
  }

  // Commander damage dealt to `target` by `source`'s commanders.
  function cmdDamageTo(target, source) {
    const d = byId[target].commanderDamage || {};
    return byId[source].commander.reduce((s, id) => s + (d[id] || 0), 0);
  }

  // ---- Touch: tap vs long-press, with a peek while held ------------------------------------------------------
  function press(elm, { tap, hold, peek = true } = {}) {
    let timer = null, start = null, held = false, peekEl = null;
    elm.addEventListener("pointerdown", e => {
      if (e.button > 0) return;
      start = { x: e.clientX, y: e.clientY };
      held = false;
      elm.classList.add("pressing");
      timer = setTimeout(() => {
        held = true;
        elm.classList.remove("pressing");
        const id = elm.dataset.id;
        if (hold) hold(e);
        else if (peek && id) peekEl = showPeek(card(+id), start);
      }, 330);
    });
    const cancel = () => { clearTimeout(timer); timer = null; elm.classList.remove("pressing"); if (peekEl) { peekEl.remove(); peekEl = null; } };
    elm.addEventListener("pointermove", e => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12 && !held) { cancel(); start = null; }
    });
    elm.addEventListener("pointerup", e => {
      const wasHeld = held;
      cancel();
      if (!wasHeld && start && tap) tap(e);
      start = null;
    });
    elm.addEventListener("pointercancel", cancel);
    elm.addEventListener("pointerleave", () => { if (!held) cancel(); });
    elm.addEventListener("contextmenu", e => e.preventDefault());
  }
  function showPeek(c, at) {
    if (!image(c) && !c.faceDown) return null;
    const p = el("div", "peek");
    if (c.faceDown) p.style.background = "repeating-linear-gradient(45deg,#3a2a1c 0 10px,#2c2015 10px 20px)";
    else p.style.backgroundImage = `url("${image(c)}")`;
    const w = 250 * unit(), h = w * 680 / 488;
    let x = at.x - w / 2, y = at.y - h - 30;
    if (y < 10) y = Math.min(window.innerHeight - h - 10, at.y + 30);
    x = Math.max(10, Math.min(window.innerWidth - w - 10, x));
    p.style.left = x + "px"; p.style.top = y + "px";
    document.body.appendChild(p);
    return p;
  }
  const unit = () => Math.min(window.innerWidth / 1180, window.innerHeight / 820);

  // ---- Inspector: everything about one card ------------------------------------------------------------------
  function inspect(id) {
    const c = card(id);
    const scrim = el("div", "scrim");
    const box = el("div", "inspector " + seatClass(c.controller));
    const faces = el("div", "faces");
    const big = (src, cap, cls = "") => {
      const b = el("div", "big " + cls);
      if (src) b.style.backgroundImage = `url("${src}")`;
      if (cap) b.appendChild(el("div", "facecap", esc(cap)));
      return b;
    };
    if (c.faceDown) {
      faces.appendChild(big(null, "Face down", "back"));
      if (c.controller === ME) faces.appendChild(big(printed(c).img, "You can look: " + printed(c).name, "small"));
    } else if (c.copyOf) {
      faces.appendChild(big(face(c).img, "Copying " + face(c).name));
      faces.appendChild(big(printed(c).img, "The card: " + printed(c).name, "small"));
    } else if (c.transformed) {
      faces.appendChild(big(face(c).img, "Transformed"));
      faces.appendChild(big(DB[c.card].faces[0].img, "Front face", "small"));
    } else {
      faces.appendChild(big(printed(c).img, c.landName ? "Now a land named " + c.landName : ""));
    }
    box.appendChild(faces);
    const info = el("div", "info");
    const owner = byId[c.controller];
    info.appendChild(el("h3", "", esc(name(c))));
    info.appendChild(el("div", "owner", esc(owner.name) + (c.owner !== c.controller ? ` · owned by ${esc(byId[c.owner].name)}` : "") +
      ` · ${esc(zoneLabel(c.zone))}`));
    const chips = [];
    if (c.commander) chips.push("Commander");
    if (c.token) chips.push("Token");
    if (c.tapped) chips.push("Tapped");
    if (c.sick) chips.push("Summoning sick");
    if (c.goaded) chips.push("Goaded");
    if (isCreature(c)) { const b = basePT(c); chips.push(`${c.power}/${c.toughness}` + (b.power !== c.power || b.toughness !== c.toughness ? ` (printed ${b.power}/${b.toughness})` : "")); }
    Object.entries(c.counters || {}).forEach(([k, v]) => chips.push(`${v} ${CTR[k] || k.toLowerCase()} counter${v > 1 ? "s" : ""}`));
    if (c.classLevel) chips.push("Class level " + c.classLevel);
    if (c.chosen && c.chosen.type) chips.push("Chosen type: " + c.chosen.type);
    if (c.commanderCasts) chips.push(`Cast ${c.commanderCasts}× · tax {${c.commanderCasts * 2}}`);
    (c.keywords || []).forEach(k => chips.push(k));
    if (chips.length) info.appendChild(el("div", "chips", chips.map(x => `<span class="chip">${esc(x)}</span>`).join("")));
    if (c.note) info.appendChild(el("div", "note", esc(c.note)));
    const related = (label, ids) => {
      if (!ids.length) return;
      info.appendChild(el("div", "label", label));
      const r = el("div", "rel");
      ids.forEach(i => { const t = tile(card(i)); press(t, { tap: () => { scrim.remove(); inspect(i); } }); r.appendChild(t); });
      info.appendChild(r);
    };
    related("Attached", attachments(c.id).map(a => a.id));
    if (c.attachedTo) related("Attached to", [c.attachedTo]);
    related("Exiling", c.exiling || []);
    related("Imprinted", c.imprinted || []);
    if (c.exiledWith) related("Exiled with", [c.exiledWith]);
    const f = c.faceDown ? null : face(c);
    if (f && f.text) { info.appendChild(el("div", "label", c.becameLand ? "Printed text (it has lost these abilities)" : "Rules text")); info.appendChild(el("div", "oracle", (window.SeatPips || esc)(f.text))); }   // a client may draw mana symbols
    box.appendChild(info);
    scrim.appendChild(box);
    scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
    document.body.appendChild(scrim);
    return scrim;
  }
  const zoneLabel = z => ({ battlefield: "Battlefield", graveyard: "Graveyard", exile: "Exile", command: "Command zone", stack: "On the stack", hand: "Hand" }[z] || z);

  // A sheet listing one zone's cards.
  function sheet(title, ids) {
    const scrim = el("div", "scrim");
    scrim.style.placeItems = "end stretch";
    const s = el("div", "sheet");
    s.appendChild(el("div", "grab"));
    s.appendChild(el("h4", "", esc(title)));
    const g = el("div", "grid");
    ids.forEach(i => { const t = tile(card(i)); press(t, { tap: () => inspect(i) }); g.appendChild(t); });
    if (!ids.length) g.appendChild(el("div", "", '<span style="color:var(--muted)">Empty</span>'));
    s.appendChild(g);
    scrim.appendChild(s);
    scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
    let y0 = null;
    s.addEventListener("pointerdown", e => (y0 = e.clientY));
    s.addEventListener("pointerup", e => { if (y0 != null && e.clientY - y0 > 60) scrim.remove(); y0 = null; });
    document.body.appendChild(scrim);
  }

  // ---- Hand: a fan along the bottom (or wherever opts.place puts each card); tap lifts a card, drag pulls it up ------
  function hand(container, opts = {}) {
    if (opts.render) return opts.render(container);  // a page that draws its own hand
    const h = el("div", "hand" + (opts.cls ? " " + opts.cls : ""));
    const ids = byId[ME].hand;
    const n = ids.length, spread = opts.spread || 9, gap = opts.gap || 62;
    const u = v => `calc(${v} * var(--u))`;
    ids.forEach((id, i) => {
      const c = card(id);
      const k = i - (n - 1) / 2;
      const at = opts.place ? opts.place(i, n) : { x: k * gap, y: 0, rot: k * spread / n * 2 };
      const hc = el("div", "hcard");
      hc.dataset.id = id;
      hc.style.backgroundImage = `url("${printed(c).img}")`;
      const rest = `translate(${u(at.x)}, ${u(at.y)}) rotate(${at.rot}deg)`;
      hc.style.transform = rest;
      hc.style.zIndex = i;
      let drag = null;
      hc.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, moved: false }; hc.setPointerCapture(e.pointerId); });
      hc.addEventListener("pointermove", e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 10) { drag.moved = true; hc.classList.add("dragging", "up"); }
        if (drag.moved) hc.style.transform = `translate(calc(${u(at.x)} + ${dx}px), ${dy}px) scale(1.1)`;
      });
      hc.addEventListener("pointerup", e => {
        const moved = drag && drag.moved, dy = drag ? e.clientY - drag.y : 0;
        drag = null;
        hc.classList.remove("dragging");
        if (moved) { hc.classList.remove("up"); hc.style.transform = rest; if (opts.onDrop) opts.onDrop(id, dy, hc); return; }
        const up = hc.classList.contains("up");
        if (opts.onTap && opts.onTap(id, hc, up)) return;
        h.querySelectorAll(".hcard.up").forEach(x => { x.classList.remove("up"); x.style.transform = x.dataset.rest; });
        if (!up) { hc.classList.add("up"); hc.style.transform = `translateX(${u(at.x)}) scale(${opts.lift || 1.55})`; }
        else inspect(id);
      });
      hc.dataset.rest = rest;
      h.appendChild(hc);
    });
    container.appendChild(h);
    return h;
  }

  // ---- Stack ---------------------------------------------------------------------------------------------
  function stackItem(item, i) {
    const c = card(item.card);
    const box = el("div", "sitem " + seatClass(item.controller) + (i === 0 ? " top" : ""));
    box.dataset.stack = item.id;
    box.dataset.id = item.card;
    box.appendChild(el("div", "sidx", G.stack.length - i));
    const a = el("div", "sart");
    a.style.backgroundImage = `url("${printed(c).art}")`;
    box.appendChild(a);
    const t = el("div", "");
    t.appendChild(el("div", "stitle", esc(printed(c).name)));
    t.appendChild(el("div", "sby", esc(byId[item.controller].name) + (item.kind === "trigger" ? " · trigger" : "")));
    if (item.targets.length) t.appendChild(el("div", "starget", "→ " + item.targets.map(targetLabel).join(", ")));
    box.appendChild(t);
    return box;
  }
  function targetLabel(t) {
    if (t.stack) { const s = G.stack.find(x => x.id === t.stack); return printed(card(s.card)).name; }
    if (t.card) return name(card(t.card));
    if (t.player) return byId[t.player].name;
    return "?";
  }

  // Curved arrows between elements: pairs of [fromEl, toEl, colour]. Redraws on resize.
  function arrows(pairs) {
    let svg = document.querySelector("svg.arrows");
    if (!svg) { svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "arrows"); document.body.appendChild(svg); }
    svg.innerHTML = '<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>';
    pairs.forEach(([a, b, color]) => {
      if (!a || !b) return;
      const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
      if (!r1.width || !r2.width) return;
      const x1 = r1.left + r1.width / 2, y1 = r1.top + r1.height / 2, x2 = r2.left + r2.width / 2, y2 = r2.top + r2.height / 2;
      const mx = (x1 + x2) / 2 - (y2 - y1) * 0.25, my = (y1 + y2) / 2 + (x2 - x1) * 0.25;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", `M${x1},${y1} Q${mx},${my} ${x2},${y2}`);
      p.setAttribute("stroke", color);
      p.setAttribute("marker-end", "url(#arrowhead)");
      svg.appendChild(p);
    });
    return svg;
  }
  const clearArrows = () => { const s = document.querySelector("svg.arrows"); if (s) s.innerHTML = ""; };
  const seatColor = pid => getComputedStyle(document.documentElement).getPropertyValue("--" + pid).trim();

  // ---- Registry of prototypes ------------------------------------------------------------------------------
  const protos = [];
  function register(key, def) { protos.push(Object.assign({ key }, def)); }

  window.Proto = {
    G, DB, ME, players, player: pid => byId[pid], card, face, printed, name, typeLine, art, image, isLand, isCreature,
    isPW, isMana, category, zone, battlefield, attachments, groups, mana, rules, RULES, basePT, cmdDamageTo, ICON, el,
    esc, tile, plate, press, inspect, sheet, hand, stackItem, targetLabel, arrows, clearArrows, seatColor, seatClass,
    register, protos, unit,
  };
})();
