// Live: Seat driven by a real Forge game through the bridge. The engine's view becomes GAME (the shape the board
// reads); its decision becomes marks on the board, taps and drags, and a prompt. Forge decides what is legal: every
// option comes from the decision, and the board only ever answers with option numbers.
(function () {
  const P = window.Proto, G = P.G, DB = window.CARDS, H = window.SeatHooks;
  const PIDS = ["you", "ana", "bo", "cy"];
  const el = P.el, esc = P.esc;
  let seat = null;                     // Seat's API once mounted
  let v = 0, snap = null, d = null, dkey = null, busy = false;
  let pidOf = {};                      // engine player name → seat id
  let sel = [];                        // option numbers picked so far (1-based)
  let holding = null;                  // blocking: the blocker picked up, waiting for an attacker
  let attackTo = null;                 // attacking: where a tapped creature goes
  let lastView = "", known = {};       // known: commander cards seen, by player, for plates when they leave view
  let promptEl, sheetEl, toastEl, dragLine;

  // ---- The engine's view, as GAME ---------------------------------------------------------------------------------
  const COUNTER = { "+1/+1": "P1P1", "-1/-1": "M1M1", "Loyalty": "LOYALTY", "LOYAL": "LOYALTY" };
  const ctr = n => COUNTER[n] || n.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const typeOf = t => (t || "").replace(/ - /g, " — ");
  function conv(c, zone) {
    const out = { id: c.id, card: c.faceDown ? "Face-down" : c.name, owner: pidOf[c.owner] || "you", controller: pidOf[c.controller] || "you", zone };
    ["tapped", "token", "commander", "sick", "attachedTo", "faceDown", "power", "toughness"].forEach(k => c[k] != null && (out[k] = c[k]));
    if (c.counters) { out.counters = {}; Object.entries(c.counters).forEach(([k, n]) => (out.counters[ctr(k)] = n)); }
    if (c.loyalty != null) out.counters = Object.assign(out.counters || {}, { LOYALTY: c.loyalty });
    if (c.keywords) out.keywords = c.keywords;
    if (c.copy) out.copyOf = c.name;
    out._type = typeOf(c.type); out._text = c.text || ""; out._cost = c.cost || "";
    return out;
  }
  function names(view) {
    const out = new Set();
    view.players.forEach(p => ["battlefield", "command", "graveyard", "exile", "hand"].forEach(z => (p[z] || []).forEach(c => out.add(c.faceDown ? "Face-down" : c.name))));
    view.stack.forEach(s => s.source && out.add(s.source.name));
    return [...out];
  }
  // Scryfall gives art and what a card produces; the engine's own type and text win, since they are what it is now.
  function remember(view) {
    const seen = {};
    view.players.forEach(p => ["battlefield", "command", "graveyard", "exile", "hand"].forEach(z => (p[z] || []).forEach(c => (seen[c.name] = c))));
    view.stack.forEach(s => s.source && (seen[s.source.name] = seen[s.source.name] || s.source));
    Object.values(seen).forEach(c => {
      const e = DB[c.name];
      if (!e) return;
      const f = e.faces[0];
      if (!e._engine) { e._engine = true; f.type = typeOf(c.type) || f.type; if (c.text && !f.text) f.text = c.text; f.cost = f.cost || (c.cost ? "{" + c.cost.replace(/ /g, "}{") + "}" : ""); }
      if (/Creature/.test(f.type) && f.power == null && c.power != null) { f.power = String(c.power); f.toughness = String(c.toughness); }
      f.abilities = /^[^:\n(]*\{[^}]+\}[^:\n]*:|^[^:\n]*(Sacrifice|Remove|Exile|Discard|Pay|Tap)[^:\n]*:/m.test(f.text || "") && !/^\{T\}: Add/m.test(f.text || "");
    });
    if (!DB["Face-down"]) DB["Face-down"] = { name: "Face-down", faces: [{ name: "Face-down", type: "Creature", power: "2", toughness: "2", art: null, img: null, keywords: [] }], produces: [] };
  }
  function apply(view) {
    pidOf = {};
    view.players.forEach((p, i) => (pidOf[p.name] = PIDS[i]));
    Object.keys(G.cards).forEach(k => delete G.cards[k]);
    view.players.forEach((p, i) => {
      const pl = P.player(PIDS[i]);
      const ids = z => (p[z] || []).map(c => { G.cards[c.id] = conv(c, z); return c.id; });
      const bf = ids("battlefield"), cmd = ids("command"), gy = ids("graveyard"), ex = ids("exile"), hand = ids("hand").sort(handOrder);
      const all = Object.values(G.cards).filter(c => c.owner === PIDS[i] && c.commander);
      if (all.length) known[PIDS[i]] = all.map(c => Object.assign({}, c));
      const commanders = (known[PIDS[i]] || []).map(c => { if (!G.cards[c.id]) G.cards[c.id] = Object.assign({}, c, { zone: "elsewhere" }); return c.id; });
      Object.assign(pl, {
        name: p.name, life: p.life, poison: p.poison || 0, monarch: !!p.monarch, lost: !!p.lost, hand, handCount: p.hand ? p.hand.length : p.handCount,
        library: p.library, graveyard: gy, exile: ex, command: cmd, commander: commanders, battlefieldIds: bf,
        commanderDamage: p.commanderDamage || {}, manaPool: p.manaPool || {},
      });
    });
    G.stack.length = 0;
    view.stack.forEach(s => {
      if (!s.source) return;
      if (!G.cards[s.source.id]) G.cards[s.source.id] = conv(s.source, "stack");
      G.stack.push({ id: s.id, card: s.source.id, controller: pidOf[s.controller] || "you", text: s.text, spell: s.spell,
        targets: (s.targets || []).map(t => (typeof t === "number" ? t : pidOf[t])).filter(t => t != null) });
    });
    const defender = x => (typeof x === "number" ? (G.cards[x] ? G.cards[x].controller : null) : pidOf[x]);
    G.combat = view.combat ? {
      attackers: view.combat.attackers.map(a => ({ id: a.id, defender: defender(a.defender) })).filter(a => a.defender && G.cards[a.id]),
      blockers: view.combat.blockers.filter(b => G.cards[b.id]),
    } : null;
    G.turn = view.turn; G.active = pidOf[view.active] || "you"; G.priority = pidOf[view.priority] || null;
    G.phase = PHASE[view.phase] || view.phase; G.over = !!view.over;
  }
  // My hand reads left to right: lands, then spells from cheapest to dearest.
  const manaValue = c => { const f = DB[c.card] && DB[c.card].faces[0], cost = (f && f.cost) || ""; let n = 0; (cost.match(/\{([^}]+)\}/g) || []).forEach(t => { const x = t.slice(1, -1); n += /^\d+$/.test(x) ? +x : x === "X" ? 0 : 1; }); return n; };
  function handOrder(a, b) {
    const A = G.cards[a], B = G.cards[b], la = /Land/.test(A._type) && !/Creature/.test(A._type), lb = /Land/.test(B._type) && !/Creature/.test(B._type);
    return (lb - la) || (manaValue(A) - manaValue(B)) || A.card.localeCompare(B.card);
  }
  const PHASE = { UNTAP: "Untap", UPKEEP: "Upkeep", DRAW: "Draw", MAIN1: "Main phase", COMBAT_BEGIN: "Combat", COMBAT_DECLARE_ATTACKERS: "Attackers",
    COMBAT_DECLARE_BLOCKERS: "Blockers", COMBAT_FIRST_STRIKE_DAMAGE: "First strike", COMBAT_DAMAGE: "Damage", COMBAT_END: "End of combat",
    MAIN2: "Second main", END_OF_TURN: "End step", CLEANUP: "Cleanup", setup: "Setup" };

  // ---- Fetching: long polls for the game, card data before a card is drawn -------------------------------------------
  async function cardsFor(list) {
    const missing = list.filter(n => n && !DB[n]);
    for (let i = 0; i < missing.length; i += 40) {
      const q = missing.slice(i, i + 40).map(n => "n=" + encodeURIComponent(n)).join("&");
      try { Object.assign(DB, await (await fetch("api/cards?" + q)).json()); } catch (e) { /* drawn without art */ }
    }
    missing.forEach(n => { if (!DB[n]) DB[n] = { name: n, faces: [{ name: n, type: "", art: null, img: null, keywords: [] }], produces: [] }; });
    // Art that arrives late redraws the board; the board doesn't wait for it long.
    const art = Promise.all(list.map(n => DB[n] && seat.loadImage(DB[n].faces[0].art)));
    let late = false;
    art.then(() => late && redraw(0));
    await Promise.race([art, new Promise(r => setTimeout(r, 1200))]);
    late = true;
  }
  async function poll() {
    for (;;) {
      try {
        const r = await fetch("api/view?v=" + v);
        const s = await r.json();
        v = s.v;
        await take(s);
      } catch (e) { await new Promise(r => setTimeout(r, 1000)); }
    }
  }
  async function take(s) {
    const was = snap && snap.view;
    snap = s;
    if (!s.view || !s.view.players) { status(); return; }
    const viewKey = JSON.stringify(s.view);
    // A view whose log doesn't carry on from the last one (a reload, a jump to another position) isn't play: the table
    // cuts to it rather than animating moves that never happened.
    const tail = was && was.log && was.log[was.log.length - 1], jump = !!tail && !(s.view.log || []).some(e => e.i === tail.i && e.text === tail.text);
    const nd = s.decision || null, nk = nd ? keyOf(nd) : null;
    // Mana abilities may resolve immediately and return the same menu. A changed game
    // position with another pending decision is a fresh stop, even if its labels match.
    const changedView = viewKey !== lastView, changedDecision = nk !== dkey || (busy && changedView && !!nd);
    if (changedView) {
      await cardsFor(names(s.view));
      remember(s.view);
      const before = myBoard();
      apply(s.view);
      noteLosses(before);
      lastView = viewKey;
    }
    if (changedDecision) { d = nd; dkey = nk; sel = []; holding = null; busy = false; await prepare(); autoContinue(); }
    // Focus: my side never moves; on another player's turn their side comes toward the middle. The stack is a layer
    // over everything, open whenever something new goes on it. Leaning in on a side yourself holds until the turn moves
    // on or a new decision comes to you.
    // The leaned page covers part of the table, so whatever happens beyond it (anything on the stack, a combat, any other
    // opponent's cards or life) brings the whole table back at once; a look is a tap away again.
    const table = p => JSON.stringify(p ? [p.battlefield, p.graveyard, p.exile, p.life] : null), same = k => JSON.stringify(was[k] || null) === JSON.stringify(s.view[k] || null);
    const elsewhere = !!lean && !!was && changedView && (!same("stack") || !same("combat") ||
      s.view.players.some(p => { const pid = pidOf[p.name]; return pid !== lean.seat && pid !== P.ME && table(was.players.find(q => q.name === p.name)) !== table(p); }));
    if (lean && (lean.turn !== G.turn || (changedDecision && d) || elsewhere)) { lean = null; seat.setFocus(null); }
    H.soft = G.active !== "you" ? { seat: G.active } : {};
    H.stackLayer = stackOpen();
    H.handAway = !!d && d.kind === "mulligan";
    if (changedView || changedDecision) redraw(changedView && jump ? 0 : changedView ? 520 : 300);
    if (changedView && jump && infoEl) { clearTimeout(stackInfo.t); infoEl.hidden = true; infoEl.classList.remove("out"); }   // a cut leaves nothing of the last position fading over the new one
    feed(); stackInfo(); mulligan();
  }
  const keyOf = x => [x.kind, x.turn, x.prompt, (x.options || []).length].concat((x.options || []).slice(0, 6)).join("|");

  // ---- Answering -----------------------------------------------------------------------------------------------------
  async function send(body) {
    if (busy) return;
    busy = true; status();
    try {
      const r = await (await fetch("api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ key: dkey }, body)) })).json();
      if (!r.ok) { busy = false; toast(r.error || "Forge refused that"); status(); }
    } catch (e) { busy = false; toast("Lost the bridge"); status(); }
    closeSheet();
  }
  const answer = picks => send({ answer: picks });
  const auto = () => send({ defer: true });

  // ---- What each decision lets you touch ------------------------------------------------------------------------------
  const refs = () => (d && d.refs) || [];
  const optsFor = id => refs().map((r, i) => (r && r.card === id ? i + 1 : 0)).filter(Boolean);
  // Mana stays on its permanent, not in the play/response menus or auto-pass gate.
  const playOptions = () => refs().map((r, i) => i && !r.mana ? i + 1 : 0).filter(Boolean);
  const onBoard = id => G.cards[id] && (G.cards[id].zone === "battlefield" || G.cards[id].zone === "stack");
  // A choice is made on the board when every option is a permanent or a player; otherwise from a sheet.
  function boardChoice() {
    if (!d || !["targets", "choose"].includes(d.kind) || !d.refs || !d.refs.length) return false;
    // A pile shows one face: options hidden in a pile of different cards go to a sheet, where each can be seen.
    const pcs = Object.values(seat.pieces()), opt = new Set(d.refs.map(r => r.card));
    // A well holds one land by name, tapped and untapped together: same-named cards don't hide each other.
    const hidden = id => { const pc = pcs.find(p => p.ids.includes(id)); return pc && pc.ids.length > 1 && !pc.ids.every(x => (opt.has(x) || G.cards[x].tapped) && G.cards[x].card === G.cards[id].card); };
    return d.refs.every(r => (r.card != null && onBoard(r.card) && !hidden(r.card)) || (r.player && pidOf[r.player]));
  }
  async function prepare() {
    closeSheet();
    if (!d) return;
    if (d.kind === "attack") {
      const tos = [...new Set(refs().map(r => r.to))];
      attackTo = tos.find(t => typeof t === "string" && pidOf[t] && !P.player(pidOf[t]).lost) || tos[0];
    }
    // Cards a sheet will show that the board doesn't hold (a library search, cards by name).
    const extra = (d.options || []).map(o => o.replace(/ \(.*\)$/, "").replace(/ \d+\/\d+.*$/, "")).filter(n => !DB[n] && /^[A-Z]/.test(n));
    if (extra.length && !["play", "attack", "block", "pay", "mode", "confirm", "mulligan"].includes(d.kind)) await cardsFor(extra);
  }
  // Whatever of mine the others' spells and abilities aim at glows red, over any other mark.
  function marks() {
    const m = marks0();
    G.stack.forEach(st => st.controller !== "you" && (st.targets || []).forEach(t => { if (typeof t === "number" && G.cards[t] && G.cards[t].controller === "you") m.cards[t] = "danger"; }));
    return m;
  }
  function marks0() {
    const m = { cards: {}, players: {} };
    G.playable = []; G.actionable = [];
    if (!d || busy) return m;
    const R = refs();
    if (d.kind === "play") {
      R.forEach(r => {
        const c = r && r.card != null && G.cards[r.card];
        if (!c) return;
        if (c.zone === "hand") G.playable.push(c.id);
        else if (c.zone === "battlefield") { G.actionable.push(c.id); m.cards[c.id] = "option"; }
        else if (c.commander) m.players.you = "option";
      });
    } else if (d.kind === "attack") {
      R.forEach(r => (m.cards[r.card] = "option"));
      sel.forEach(i => (m.cards[R[i - 1].card] = "selected"));
      if (typeof attackTo === "string" && pidOf[attackTo]) m.players[pidOf[attackTo]] = "selected";
    } else if (d.kind === "block") {
      // The attackers are choices here, not dangers: ember, like anything else I could pick. Holding a blocker, only the
      // attackers it can legally block stay lit, in red: the one it is about to meet.
      R.forEach(r => { m.cards[r.card] = "option"; if (holding == null) m.cards[r.blocks] = "option"; else if (r.card === holding) m.cards[r.blocks] = "danger"; });
      sel.forEach(i => (m.cards[R[i - 1].card] = "selected"));
      if (holding != null) m.cards[holding] = "selected";
    } else if (d.kind === "pay") {
      R.forEach(r => r.card != null && (m.cards[r.card] = m.cards[r.card] || "option"));
      sel.forEach(i => (m.cards[R[i - 1].card] = "selected"));
    } else if (boardChoice()) {
      R.forEach((r, i) => {
        const kind = sel.includes(i + 1) ? "selected" : "option";
        if (r.card != null) m.cards[r.card] = kind; else m.players[pidOf[r.player]] = kind;
      });
    }
    return m;
  }
  // Attacks and blocks picked so far show on the board before they are sent: the same lanes Forge's combat gets.
  function preview() {
    if (!d || busy) return;
    const R = refs();
    if (d.kind === "attack") {
      G.combat = sel.length ? { attackers: sel.map(i => ({ id: R[i - 1].card, defender: typeof R[i - 1].to === "number" ? (G.cards[R[i - 1].to] || {}).controller : pidOf[R[i - 1].to] })), blockers: [] } : null;
    } else if (d.kind === "block" && G.combat) {
      G.combat.blockers = sel.map(i => ({ id: R[i - 1].card, blocking: R[i - 1].blocks }));
    }
  }
  function redraw(ms) {
    preview();
    H.marks = marks();
    seat.refresh(ms);
    place();
  }

  // ---- Taps and drags on the board ---------------------------------------------------------------------------------
  function idsOf(pk) { return pk.type === "card" ? [pk.id] : pk.type === "pile" ? pk.ids : []; }
  H.tap = (pk, hit) => {
    if (autoTimer && !held && d) hold();            // touching the table while play runs on holds it
    if (tapDecision(pk, hit)) return true;
    if (pk && pk.stack && !stackOpen()) { shutKey = null; layerChanged(); return true; }     // tap the stack to bring it back
    if (stackOpen()) { shutKey = stackKey(); layerChanged(); return true; }                   // tap past it to see the table
    return false;
  };
  function tapDecision(pk, hit) {
    if (!d || busy || !pk) return false;
    const R = refs(), ids = idsOf(pk);
    if (d.kind === "play") {
      const id = pk.type === "plate" && pk.pid === "you" ? (G.cards[(P.player("you").commander || [])[0]] || {}).id : ids[0];
      const opts = id != null ? optsFor(id) : [];
      if (!opts.length) return false;
      inspectWith(id, opts);                        // a tap looks; the card's plays are buttons on it
      return true;
    }
    if (d.kind === "attack") {
      if (pk.type === "plate" || pk.type === "seat") {
        const name = P.player(pk.pid).name;
        if (pk.pid === "you" || !R.some(r => r.to === name)) return false;
        attackTo = name;
        sel = sel.map(i => { const c = R[i - 1].card, j = R.findIndex(r => r.card === c && r.to === name); return j >= 0 ? j + 1 : i; });
        redraw(350); status(); return true;
      }
      const id = ids.find(x => R.some(r => r.card === x));
      if (id == null) {
        const walker = ids.find(x => R.some(r => r.to === x));        // a planeswalker: attack it
        if (walker == null) return false;
        attackTo = walker; redraw(350); status(); return true;
      }
      const at = sel.findIndex(i => R[i - 1].card === id);
      if (at >= 0) sel.splice(at, 1);
      else { const j = R.findIndex(r => r.card === id && r.to === attackTo); sel.push((j >= 0 ? j : R.findIndex(r => r.card === id)) + 1); }
      redraw(350); status(); return true;
    }
    if (d.kind === "block") {
      const mine = ids.find(x => R.some(r => r.card === x)), theirs = ids.find(x => R.some(r => r.blocks === x));
      if (mine != null) {
        const at = sel.findIndex(i => R[i - 1].card === mine);
        if (at >= 0) { sel.splice(at, 1); holding = null; }
        else {
          const can = R.map((r, i) => (r.card === mine ? i + 1 : 0)).filter(Boolean);
          if (can.length === 1) { sel.push(can[0]); holding = null; } else holding = mine;
        }
        redraw(350); status(); return true;
      }
      if (theirs != null && holding != null) {
        const j = R.findIndex(r => r.card === holding && r.blocks === theirs);
        if (j >= 0) { sel.push(j + 1); holding = null; redraw(350); status(); }
        else toast("That creature can't block that attacker");
        return true;
      }
      return false;
    }
    if (d.kind === "pay") {
      const id = ids.find(x => optsFor(x).some(o => !sel.includes(o)) || optsFor(x).length);
      if (id == null) return false;
      const opts = optsFor(id);
      if (sel.some(o => opts.includes(o)) && opts.every(o => sel.includes(o) || R[o - 1].card !== id) && !ids.some(x => x !== id && optsFor(x).length)) {
        sel = sel.filter(o => !opts.includes(o)); redraw(250); status(); return true;           // tapped again: take it back
      }
      const kinds = new Set(ids.filter(x => optsFor(x).length).map(x => G.cards[x].card));
      if (kinds.size > 1) {                         // different sources in one fan: say which
        sheet("Which source?", box => ids.filter(x => optsFor(x).length).forEach(x => optsFor(x).forEach(o => {
          const b = el("button", "l-opt" + (sel.includes(o) ? " on" : ""), `<b>${esc(d.options[o - 1])}</b>`);
          b.addEventListener("click", () => { closeSheet(); if (sel.includes(o)) sel = sel.filter(y => y !== o); else sel.push(o); redraw(250); status(); });
          box.appendChild(b);
        })));
        return true;
      }
      const free = ids.find(x => optsFor(x).length && !sel.some(o => optsFor(x).includes(o)));
      const use = free != null ? free : id, uo = optsFor(use);
      if (uo.length === 1) { sel.push(uo[0]); redraw(250); status(); }
      else pickColor(uo, use);
      return true;
    }
    if (boardChoice()) {
      const i = R.findIndex(r => (pk.type === "plate" || pk.type === "seat") ? r.player && pidOf[r.player] === pk.pid : ids.includes(r.card));
      if (i < 0) return false;
      toggle(i + 1);
      return true;
    }
    return false;
  }
  function toggle(o) {
    const at = sel.indexOf(o);
    if (at >= 0) sel.splice(at, 1);
    else if (sel.length < d.max) sel.push(o);
    else if (d.max === 1) sel = [o];
    if (d.max === 1 && d.min === 1 && sel.length === 1 && !d.repeat) return answer(sel);
    redraw(250); status();
  }
  // Drags: a creature onto an opponent attacks them; a blocker onto an attacker blocks it.
  H.drag = (fromHit, toHit) => {
    clearDragLine();
    const from = fromHit && fromHit.pick, to = toHit && toHit.pick;
    if (!d || busy || !from || !to) return;
    const R = refs(), fids = idsOf(from), tids = idsOf(to);
    if (d.kind === "attack") {
      const id = fids.find(x => R.some(r => r.card === x));
      if (id == null) return;
      const name = (to.type === "plate" || to.type === "seat") ? P.player(to.pid).name : tids.map(x => G.cards[x]).filter(Boolean).map(c => (R.some(r => r.to === c.id) ? c.id : P.player(c.controller).name))[0];
      const j = R.findIndex(r => r.card === id && r.to === name);
      if (j < 0) { toast("It can't attack there"); return; }
      sel = sel.filter(i => R[i - 1].card !== id); sel.push(j + 1);
      if (typeof name === "string") attackTo = name;
      redraw(350); status();
    } else if (d.kind === "block") {
      const mine = fids.find(x => R.some(r => r.card === x)), theirs = tids.find(x => R.some(r => r.blocks === x));
      const j = R.findIndex(r => r.card === mine && r.blocks === theirs);
      if (j < 0) { if (mine != null) toast("It can't block that"); return; }
      sel = sel.filter(i => R[i - 1].card !== mine); sel.push(j + 1); holding = null;
      redraw(350); status();
    } else if (d.kind === "play" && fids.length) {
      const opts = fids.flatMap(optsFor);
      if (opts.length) offer(opts, P.name(G.cards[fids[0]]));
    }
  };
  H.dragMove = (fromHit, x, y) => {
    const from = fromHit && fromHit.pick;
    if (!d || !from || !["attack", "block"].includes(d.kind)) return;
    const id = idsOf(from).find(i => refs().some(r => r.card === i));
    if (id == null) return;
    const pc = Object.values(seat.pieces()).find(p => p.ids.includes(id));
    if (!pc) return;
    const a = seat.project(pc.obj.getWorldPosition(new seat.T.Vector3()));
    if (!dragLine) { dragLine = document.createElementNS("http://www.w3.org/2000/svg", "svg"); dragLine.classList.add("l-drag"); document.body.appendChild(dragLine); }
    dragLine.innerHTML = `<line x1="${a.x}" y1="${a.y}" x2="${x}" y2="${y}"/><circle cx="${x}" cy="${y}" r="14"/>`;
  };
  function clearDragLine() { if (dragLine) { dragLine.remove(); dragLine = null; } }
  addEventListener("pointerup", () => setTimeout(clearDragLine, 0));

  // Hand: held like a real one, in the bottom left corner, about three cards wide, each card in front of the one to its
  // left. The cards never change order or stacking: thumbing through them slides them along, opening the gap after one
  // card so it shows in full while the rest bunch up. A swipe turns one card; the cards lean with the push and settle
  // on a spring, and the card being thumbed over lifts as it goes. Hover with a mouse to open the card under it. Drag a
  // card up onto the table to play it; tap the open card to read it.
  const HELD = { w: 150, span: 1.9, open: 0.94 };
  let heldEl = null, heldIds = "", focusId = null, fNow = 0, fVel = 0, fTo = 0, heldAnim = 0, lastTick = 0, lastWheel = 0, hg = null;
  const unit = () => Math.min(innerWidth / 1180, innerHeight / 820);
  const handIds = () => P.player("you").hand.slice();
  function heldSize() { const W = HELD.w * unit(); return { W, H: W * 680 / 488 }; }
  // Where each card sits for a focus f (fractional mid-turn): the gap after card f is a card wide, and the other gaps
  // share what's left of the span, so the hand keeps its width.
  function poses(n, f) {
    const { W } = heldSize(), span = W * HELD.span, wide = W * HELD.open;
    const open = i => Math.max(0, 1 - Math.abs(i - f));               // gap i lies between card i and card i + 1
    let opened = 0;
    for (let i = 0; i < n - 1; i++) opened += open(i);
    const base = n > 1 ? Math.max(W * 0.06, (span - opened * wide) / (n - 1 - opened || 1)) : 0;
    const xs = [0];
    for (let i = 0; i < n - 1; i++) xs.push(xs[i] + base + open(i) * (wide - base));
    const mid = (xs[0] + xs[n - 1]) / 2, half = Math.max(1, (xs[n - 1] - xs[0]) / 2);
    const lean = Math.max(-1, Math.min(1, fVel * 14)), dirn = fVel < 0 ? 1 : -1;
    return xs.map((x0, i) => {
      const k = (x0 - mid) / half, near = 0.4 + 0.6 * Math.exp(-Math.abs(i - f));
      const lift = Math.sin(Math.PI * Math.max(0, Math.min(1, 1 - Math.abs(i - f - 0.5) * 2)));   // the card being thumbed over
      return {
        x: x0 - mid - lean * W * 0.05 * near, y: k * k * W * 0.05 - lift * W * 0.07,
        rot: k * 4 - 1.5 - lean * 7 * near + lift * 3 * dirn, z: 10 + i,
      };
    });
  }
  function drawHeld() {
    if (!heldEl) return;
    const cards = [...heldEl.children], qs = poses(cards.length, fNow);
    cards.forEach((hc, i) => {
      if (hc.classList.contains("dragging")) return;
      const q = qs[i];
      hc.style.transform = `translate(${q.x}px, ${q.y}px) rotate(${q.rot}deg)`;
      hc.style.zIndex = q.z;
      hc.classList.toggle("front", Math.round(fTo) === i);
    });
  }
  // A damped spring from where the hand is to where it's going, so a turn overshoots a touch and settles.
  function spring() {
    cancelAnimationFrame(heldAnim);
    lastTick = performance.now();
    const tick = now => {
      let frames = Math.min(3, (now - lastTick) / 16.7); lastTick = now;
      while (frames > 0) {
        const h = Math.min(1, frames); frames -= h;
        fVel += (0.07 * (fTo - fNow) - 0.32 * fVel) * h; fNow += fVel * h;
      }
      const done = Math.abs(fTo - fNow) < 0.002 && Math.abs(fVel) < 0.002;
      if (done) { fNow = fTo; fVel = 0; }
      drawHeld();
      if (!done) heldAnim = requestAnimationFrame(tick);
    };
    heldAnim = requestAnimationFrame(tick);
  }
  function turnTo(i) {
    const ids = handIds();
    i = Math.max(0, Math.min(ids.length - 1, i));
    focusId = ids[i]; fTo = i; spring();
  }
  function placeHeld() {
    const { W, H } = heldSize(), u = unit();
    heldEl.style.setProperty("--hw", W + "px"); heldEl.style.setProperty("--hh", H + "px");
    heldEl.style.left = 34 * u + W * (HELD.span + 1) / 2 + "px";   // the fan leans past its cards
  }
  function renderHeld(container) {
    const ids = handIds(), key = ids.join(",");
    if (heldEl && key === heldIds && heldEl.parentNode === container) {
      heldEl.querySelectorAll(".hcard").forEach(x => x.classList.remove("playable", "unplayable"));
      placeHeld(); drawHeld();
      return heldEl;                                // same hand: keep it, so a swipe in progress carries on
    }
    const before = heldIds ? new Set(heldIds.split(",").map(Number)) : null;   // null: the first hand, which just appears
    if (heldEl) heldEl.querySelectorAll(".hcard").forEach(x => { const id = +x.dataset.id; if (!ids.includes(id) && G.stack.some(st => st.card === id)) castFrom(id, x); });
    container.innerHTML = "";
    heldEl = el("div", "held"); heldIds = key;
    placeHeld();
    ids.forEach(id => {
      const hc = el("div", "hcard");
      hc.dataset.id = id;
      hc.style.backgroundImage = `url("${P.printed(G.cards[id]).img}")`;
      hc.addEventListener("pointerdown", heldDown);
      hc.addEventListener("pointermove", heldMove);
      hc.addEventListener("pointerup", heldUp);
      hc.addEventListener("pointercancel", heldUp);
      heldEl.appendChild(hc);
    });
    let i = ids.indexOf(focusId);
    if (i < 0) i = focusId == null ? ids.length - 1 : Math.min(ids.length - 1, Math.round(fTo));
    focusId = ids[i]; fNow = fTo = i; fVel = 0;
    heldEl.addEventListener("wheel", e => {         // a sideways scroll turns one card per burst
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = performance.now(), fresh = now - lastWheel > 280; lastWheel = now;
      if (fresh && Math.abs(e.deltaX) > 4) turnTo(Math.round(fTo) + (e.deltaX > 0 ? 1 : -1));
    }, { passive: false });
    container.appendChild(heldEl);
    drawHeld();
    if (before) ids.filter(id => !before.has(id)).forEach(drawn);
    return heldEl;
  }
  // A card I cast leaves the hand as itself: it lifts out of its slot and rides with the table's card as it flies to the
  // stack (from under the hand, where the table can't be seen), handing over to it as it lands. Nothing blinks out between.
  function castFrom(id, hc) {
    const r = hc.getBoundingClientRect(), g = el("div", "l-cast"), t0 = performance.now(), ms = Math.max(300, seat.stackLanding ? seat.stackLanding() : 520);
    g.style.backgroundImage = hc.style.backgroundImage; g.style.borderRadius = getComputedStyle(hc).borderRadius;
    document.body.appendChild(g);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms), b = seat.stackAt && seat.stackAt(id), q = 1 - (1 - k) * (1 - k);   // off at once, easing in to the card
      const to = b || { left: r.left, top: r.top - r.height, right: r.right, bottom: r.top }, mix = (a, c) => a + (c - a) * Math.min(1, q * 1.6);
      const L = mix(r.left, to.left), T = mix(r.top, to.top), W = mix(r.width, to.right - to.left), H = mix(r.height, to.bottom - to.top);
      Object.assign(g.style, { left: L + "px", top: T + "px", width: W + "px", height: H + "px", opacity: String(k < 0.7 ? 1 : (1 - k) / 0.3) });
      if (k < 1) requestAnimationFrame(step); else g.remove();
    };
    step();
  }
  // A card just drawn slides into the hand from my library (at my plate, where the library is kept) and its edge burns
  // with embers for a moment, so it's plain which one is new. The fan's own transform is left alone: the slide uses the
  // separate translate and scale properties.
  function drawn(id) {
    const hc = heldEl && heldEl.querySelector(`.hcard[data-id="${id}"]`), pcs = seat.pieces(), pc = pcs.zlibraryyou || pcs.plateyou;
    if (!hc || !pc || !hc.animate) return;
    const from = seat.project(pc.obj.getWorldPosition(new seat.T.Vector3())), r = hc.getBoundingClientRect();
    const dx = from.x - (r.left + r.width / 2), dy = from.y - (r.top + r.height / 2);
    hc.animate([{ translate: `${dx}px ${dy}px`, scale: "0.35", opacity: 0.3 }, { translate: "0px 0px", scale: "1", opacity: 1 }], { duration: 650, easing: "cubic-bezier(.2,.7,.2,1)" });
    hc.classList.add("drawn"); setTimeout(() => hc.classList.remove("drawn"), 1250);
  }
  function heldDown(e) {
    const hc = e.currentTarget;
    hg = { id: +hc.dataset.id, hc, x: e.clientX, y: e.clientY, f0: Math.round(fTo), mode: null, turned: false, lastX: e.clientX, v: 0 };
    hc.setPointerCapture(e.pointerId);
  }
  function heldMove(e) {
    if (!hg) {                                      // a mouse over the hand opens the card under it
      if (e.pointerType === "mouse" && !e.buttons) { const i = handIds().indexOf(+e.currentTarget.dataset.id); if (i >= 0 && i !== Math.round(fTo)) turnTo(i); }
      return;
    }
    const dx = e.clientX - hg.x, dy = e.clientY - hg.y;
    if (!hg.mode && Math.hypot(dx, dy) > 10) hg.mode = dy < 0 && -dy > Math.abs(dx) * 1.1 ? "play" : "page";
    if (hg.mode === "page" && !hg.turned) {
      hg.v = e.clientX - hg.lastX; hg.lastX = e.clientX;
      if (Math.abs(dx) > 30 * unit() + 10) {        // one card per swipe, however far it goes
        hg.turned = true; fVel = dx > 0 ? -0.04 : 0.04; turnTo(hg.f0 + (dx > 0 ? -1 : 1));
      } else {
        cancelAnimationFrame(heldAnim);
        fNow = hg.f0 - Math.max(-0.2, Math.min(0.2, dx / (heldSize().W * 1.5))); drawHeld();   // give a little before it goes
      }
    } else if (hg.mode === "play") {
      const i = handIds().indexOf(hg.id), q = poses(handIds().length, fNow)[i];
      hg.hc.classList.add("dragging"); hg.hc.style.zIndex = 200;
      hg.hc.style.transform = `translate(${q.x + dx}px, ${q.y + dy}px) scale(1.06)`;
    }
  }
  function heldUp(e) {
    const g = hg; hg = null;
    if (!g) return;
    const dy = e.clientY - g.y;
    if (g.mode === "page") {
      if (!g.turned) { if (Math.abs(g.v) > 3) turnTo(g.f0 + (g.v > 0 ? -1 : 1)); else turnTo(g.f0); }   // a flick turns one; a nudge settles back
    } else if (g.mode === "play") {
      g.hc.classList.remove("dragging"); drawHeld();
      if (e.type === "pointerup") H.handOpts.onDrop(g.id, dy);
    } else if (g.id === focusId) {
      const opts = d && d.kind === "play" && !busy ? optsFor(g.id) : [];
      if (opts.length) inspectWith(g.id, opts); else seat.inspect(g.id);
    } else turnTo(handIds().indexOf(g.id));
  }
  H.handOpts = {
    render: renderHeld,
    onDrop(id, dy) {
      if (!d || d.kind !== "play" || busy || dy > -90) return;
      const opts = optsFor(id);
      if (opts.length === 1) answer(opts);
      else if (opts.length) offer(opts, P.name(G.cards[id]));
      else toast("You can't play that now");
    },
  };

  // ---- Sheets: choices the board can't show (abilities of one card, modes, colours, cards from a library) -----------
  // While a sheet is open it owns the decision: the prompt behind it steps back (body.sheet-open).
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } document.body.classList.remove("sheet-open"); }
  function sheet(title, build, { wide = false } = {}) {
    closeSheet();
    document.body.classList.add("sheet-open");
    sheetEl = el("div", "l-sheet" + (wide ? " wide" : ""));
    const box = el("div", "l-box");
    box.appendChild(el("h3", "", esc(title)));
    build(box);
    const x = el("button", "g-close", "✕"); x.setAttribute("aria-label", "Close"); x.addEventListener("click", closeSheet);
    box.appendChild(x);
    sheetEl.appendChild(box);
    sheetEl.addEventListener("pointerup", e => { if (e.target === sheetEl) closeSheet(); });
    document.body.appendChild(sheetEl);
  }
  // The inspector, with what you can do with the card as buttons under its text.
  function inspectWith(id, opts) {
    seat.inspect(id);
    const info = document.querySelector(".inspector .info");
    if (!info) return offer(opts, P.name(G.cards[id]));
    const box = el("div", "l-actions");
    opts.forEach(o => {
      const b = el("button", "l-opt", `<b>${pips(actionLabel(d.options[o - 1], P.name(G.cards[id])))}</b>${costOf(o)}`);
      b.addEventListener("click", () => { seat.closeModals(); answer([o]); });
      box.appendChild(b);
    });
    // The facts first (owner, its numbers), then what you can do; a keyword the rules text already says isn't said twice.
    const chips = info.querySelector(".chips"), oracle = (info.querySelector(".oracle") || {}).textContent || "";
    if (chips) chips.querySelectorAll(".chip").forEach(ch => { const k = ch.textContent.trim(); if (/^[A-Z][a-z]+( [a-z]+)?$/.test(k) && new RegExp("(^|\\n|, )" + k + "\\b", "i").test(oracle)) ch.remove(); });
    if (chips && !chips.children.length) chips.remove();
    const after = info.querySelector(".chips") || info.children[1];
    info.insertBefore(box, after ? after.nextSibling : null);
  }
  // One card's plays: a single one goes at once; several (cast, abilities, alternative costs) are listed.
  function offer(opts, title, autoSingle = true) {
    if (autoSingle && opts.length === 1 && d.kind === "play") return answer(opts);
    sheet(title, box => {
      opts.forEach(o => {
        const b = el("button", "l-opt", `<b>${pips(playLabel(d.options[o - 1]))}${costOf(o)}</b>${d.details && d.details[o - 1] ? `<small>${pips(d.details[o - 1])}</small>` : ""}`);
        b.addEventListener("click", () => answer([o]));
        box.appendChild(b);
      });
    });
  }
  // Every play names its card: "Play Island", "Cast Frantic Search", "Meloku the Clouded Mirror: {1}, Return a land…".
  function playLabel(label) {
    if (/^[^:]+: (.*)$/.test(label)) return label;
    const name = label.replace(/\s*\((\w+)\)$/, "");
    if (/\(land\)$/.test(label)) return "Play " + name;
    if (/\(commander\)$/.test(label)) return `Cast ${name} from the command zone`;
    const alt = label.match(/\((\w+)\)$/);
    return alt ? `Cast ${name} (${alt[1]})` : "Cast " + name;
  }
  // What a cast costs, after its name, when the card's cost is known; an ability's cost is already in its label.
  function costOf(o) {
    const label = d.options[o - 1], r = refs()[o - 1], c = r && r.card != null && G.cards[r.card];
    if (!c || /^[^:]+: /.test(label) || /\(land\)$/.test(label)) return "";
    const e = DB[c.card], cost = (e && e.faces[0].cost) || (P.face(c) || {}).cost;
    return cost ? `<span class="cost">${pips(cost)}</span>` : "";
  }
  // In the inspector, under the card's own name and text: just the cost and what it does, shortly.
  function actionLabel(label, name) {
    const m = label.match(/^[^:]+: (.*)$/);
    if (!m) return playLabel(label).replace(" " + name, "");
    const body = m[1], cut = body.lastIndexOf(": ");
    if (cut < 0) return body;
    let cost = body.slice(0, cut), eff = body.slice(cut + 2).replace(/\.$/, "");
    eff = eff.replace(/^Create (?:a|an|one) (\d+\/\d+ )?(?:[a-z]+ )*([A-Z][\w-]*)\b.*$/, "$1$2 token").replace(/^Create (\w+) .*?([A-Z][\w-]*)(?: creature)? tokens.*$/, "$1 $2 tokens");
    if (eff.length > 44) eff = eff.slice(0, 42).replace(/\s+\S*$/, "") + "…";
    cost = cost.replace(/Return a land you control to its owner's hand/i, "return a land");
    return `${cost}: ${eff}`;
  }
  function pickColor(opts, id) {
    sheet(P.name(G.cards[id]) + ": which mana?", box => {
      opts.forEach(o => {
        const m = d.options[o - 1].match(/\((\w+)\)$/);
        const b = el("button", "l-opt l-mana", `<b>${esc(m ? m[1] : d.options[o - 1])}</b>`);
        b.addEventListener("click", () => { closeSheet(); sel.push(o); redraw(250); status(); });
        box.appendChild(b);
      });
    });
  }
  const cardName = label => label.replace(/ \((?:[^()]*)\)$/, "").replace(/ \d+\/\d+$/, "").replace(/ \[[^\]]*\]$/, "").replace(/ \d+\/\d+$/, "");
  // A choice from a sheet: cards as cards, everything else as buttons; tap to pick, Done when enough.
  function chooser() {
    const R = refs(), isOrder = d.kind === "order", isNumber = !d.options.length;
    sheet(promptText(), box => {
      if (isNumber) {
        let n = d.min;
        const row = el("div", "l-number");
        const out = el("output", "", String(n));
        const step = k => { n = Math.max(d.min, Math.min(d.max, n + k)); out.textContent = n; };
        [["−", -1], ["+", 1]].forEach(([t, k], i) => { const b = el("button", "", t); b.addEventListener("click", () => step(k)); row.appendChild(b); if (!i) row.appendChild(out); });
        box.appendChild(row);
        const ok = el("button", "l-done", "Choose");
        ok.addEventListener("click", () => answer([n]));
        box.appendChild(ok);
        return;
      }
      const grid = el("div", "l-grid");
      d.options.forEach((label, i) => {
        const r = R[i] || {}, c = r.card != null ? G.cards[r.card] : null;
        const name = c ? P.name(c) : r.name || cardName(label), e = DB[c ? c.card : name];
        const img = c ? P.image(c) : e && e.faces[0].img;
        const b = el("button", img ? "l-card" : "l-opt", img ? `<span class="pic" style="background-image:url('${img}')"></span><small>${esc(label)}</small>` : `<b>${esc(label)}</b>${d.details && d.details[i] && d.details[i] !== label ? `<small>${esc(d.details[i])}</small>` : ""}`);
        const n = sel.filter(o => o === i + 1).length;
        if (n) { b.classList.add("on"); if (isOrder || d.repeat) b.dataset.n = isOrder ? sel.indexOf(i + 1) + 1 : n; }
        b.addEventListener("click", () => {
          if (d.repeat && sel.length < d.max) sel.push(i + 1);
          else if (sel.includes(i + 1)) sel.splice(sel.indexOf(i + 1), 1);
          else if (sel.length < d.max) sel.push(i + 1);
          else if (d.max === 1) sel = [i + 1];
          if (d.max === 1 && d.min === 1 && !isOrder) return answer(sel);
          chooser();
        });
        grid.appendChild(b);
      });
      // More than six cards: two balanced rows, the cards as large as the sheet's height allows.
      const nCards = grid.querySelectorAll(".l-card").length;
      if (nCards > 6) { grid.classList.add("two"); grid.style.setProperty("--cols", Math.ceil(nCards / 2)); }
      box.appendChild(grid);
      const row = el("div", "l-row");
      if (sel.length) { const u = el("button", "l-ghost", "Clear"); u.addEventListener("click", () => { sel = []; chooser(); }); row.appendChild(u); }
      const ok = el("button", "l-done", sel.length ? `Done (${sel.length})` : d.min ? `Pick ${d.min === d.max ? d.min : d.min + "–" + d.max}` : "None");
      ok.disabled = sel.length < d.min;
      ok.addEventListener("click", () => answer(sel));
      row.appendChild(ok);
      box.appendChild(row);
    }, { wide: d.options.length > 6 });
  }

  // ---- The prompt: what's happening, what you're being asked, and the buttons that answer it --------------------------
  const whoName = pid => (pid === "you" ? "Your" : P.player(pid).name + "'s");
  // Forge's prompts, said plainly where we know them; the card a choice comes from is shown beside it (see context).
  const sourceOf = () => { const m = d && (d.prompt || "").match(/\(([^()]+)\)\s*$/); return m ? m[1] : null; };
  function promptText() {
    if (!d) return "";
    const pr = (d.prompt || "").trim(), src = sourceOf();
    const p = pr.replace(/\s*\([^()]*\)\s*$/, "").replace(/^\w/, ch => ch.toUpperCase());
    if (d.kind === "pay") { const m = pr.match(/mana to pay (.+?) for (.+?), in order/); return m ? `Pay ${m[1].trim()} for ${m[2]}` : p; }
    if (/its owner may put it into the command zone/.test(pr)) return `Move ${src || "your commander"} to the command zone?`;
    let m = pr.match(/multiple legendary permanents named "(.+?)"/);
    if (m) return `Legend rule: which ${m[1]} stays?`;
    if (d.kind === "targets") {
      const top = G.stack[0], spell = src || (top && top.controller === "you" ? P.name(P.card(top.card)) : null), of = spell ? ` for ${spell}` : "";
      return (d.max > 1 ? (d.min === d.max ? `Choose ${d.max} targets` : `Choose up to ${d.max} targets`) : "Choose a target") + of;
    }
    if (/^Choose a card$/i.test(p) && src) return `${src}: choose a card`;
    if (/^use /.test(pr)) return `Use ${src || "this"}?`;
    if (/^Select cards to (\w+)/i.test(p)) return p.replace(/^Select cards/i, "Choose cards");
    return p + (src && !p.includes(src) ? ` (${src})` : "");
  }
  // What a choice or confirmation is about: the spell or ability on top of the stack, or the source card's text.
  function context() {
    if (!d || ["play", "attack", "block", "mulligan"].includes(d.kind)) return "";
    if (/command zone/.test(d.prompt || "")) return "";              // the feed says what sent it there
    const top = G.stack[0];
    if (/^target for /.test(d.prompt || "")) return (d.prompt || "").replace(/^target for /, "");
    if (/^use /.test(d.prompt || "")) return (d.prompt || "").replace(/^use [^:]+:\s*/, "");
    if (top && d.kind !== "pay") {
      const c = P.card(top.card), t = top.spell ? ((P.face(c) || {}).text || "") : abilityText(top.text, P.name(c));
      return `${P.name(c)}: ${t.length > 160 ? t.slice(0, 158) + "…" : t}`;
    }
    const src = sourceOf(), e = src && DB[src];
    const t = e && (e.faces[0].text || "");
    return t ? `${src}: ${t.length > 140 ? t.slice(0, 138) + "…" : t}` : "";
  }
  function status() {
    if (!promptEl || !seat) return;
    const s = snap || {};
    if (!s.view || !s.view.players) {
      promptEl.innerHTML = `<div class="l-what">${esc(s.state === "starting" ? "Shuffling up… (the first game takes about a minute)" : s.state === "error" ? "Couldn't start: " + (s.error || "") : "No game yet")}</div><div class="l-buttons"></div>`;
      if (s.state !== "starting") { const b = el("button", "act", "New game"); b.addEventListener("click", menu); promptEl.querySelector(".l-buttons").appendChild(b); }
      return;
    }
    const top = G.stack[0];
    const where = `Turn ${G.turn} · ${whoName(G.active)} ${PHASE_SHORT(G.phase)}`;
    let what = "", buttons = [];
    if (G.over || s.state === "over") { what = "Game over" + (s.over ? ": " + s.over.replace(/^over: /, "") : ""); buttons.push(["New game", menu, "act"]); }
    else if (!d) what = busy ? "…" : top ? `${P.player(top.controller).name}: ${P.name(P.card(top.card))}` : G.active === "you" ? "Moving on…" : "Waiting for " + P.player(G.active).name + "…";
    else if (busy) what = "…";
    else {
      const k = d.kind, R = refs();
      if (k === "mulligan") what = "Opening hand";
      else if (k === "play" && top && top.controller !== "you") {
        const who = P.player(top.controller).name, nm = P.name(P.card(top.card));
        const aimed = (top.targets || []).map(t => (t === "you" ? "you" : typeof t === "number" && G.cards[t] && G.cards[t].controller === "you" ? "your " + P.name(G.cards[t]) : null)).filter(Boolean);
        what = threat() ? `${who}'s ${nm} targets ${aimed.join(" and ")}` : top.spell ? `${who} casts ${nm}` : `${who} activated ${shortCard(nm)}`;
        const auto = !!autoTimer && !held && !threat() && playOptions().length === 0;
        buttons = [[playOptions().length > 0 ? "Let it resolve" : "OK", () => answer([1]), "act" + (auto ? " auto" : "")]];
        if (auto) buttons.unshift(["Hold", hold]);
        if (playOptions().length > 0) buttons.unshift([`Respond (${playOptions().length})`, () => offer(playOptions(), "Respond")]);
      } else if (k === "play") {
        const whose = top && (top.controller === "you" ? "Your" : P.player(top.controller).name + "'s");
        const stackTop = !top ? null : top.spell ? `${whose} ${P.name(P.card(top.card))} is on the stack`
          : `${whose} ${shortCard(P.name(P.card(top.card)))} ability is on the stack`;
        what = stackTop || (G.active === "you" ? (G.phase === "Main phase" ? "Your main phase: play cards, then go to combat" : G.phase === "Second main" ? "Your second main phase" : "You have priority") :
          G.phase === "Attackers" ? "You're being attacked: respond or pass" : G.phase === "End step" ? `End of ${P.player(G.active).name}'s turn: instants now` : "You have priority");
        const passLabel = top ? "Resolve" : G.active === "you" && G.phase === "Main phase" ? "To combat" : G.active === "you" && G.phase === "Second main" ? "End turn" : "Pass";
        buttons = [[passLabel, () => answer([1]), "act"]];
        if (playOptions().length > 0) buttons.unshift([`All plays (${playOptions().length})`, () => offer(playOptions(), "Everything you can play", false)]);
      } else if (k === "attack") {
        const n = sel.length, to = typeof attackTo === "number" ? P.name(G.cards[attackTo]) : attackTo;
        what = n ? `Attacking with ${n}. Tap more, or drag one to another player` : `Tap creatures to attack ${to || ""}, or drag them to a player`;
        buttons = [[n ? `Attack (${n})` : "No attack", () => answer(sel.slice()), "act"]];
        if (n) buttons.unshift(["Clear", () => { sel = []; redraw(350); status(); }]);
        const all = [...new Set(R.map(r => r.card))];
        if (all.length > n) buttons.unshift(["Everyone attacks", () => { sel = all.map(c => { const j = R.findIndex(r => r.card === c && r.to === attackTo); return (j >= 0 ? j : R.findIndex(r => r.card === c)) + 1; }); redraw(350); status(); }]);
      } else if (k === "block") {
        const n = sel.length;
        what = holding != null ? `Now tap the attacker for ${P.name(G.cards[holding])} to block` : n ? `Blocking with ${n}` : "Tap a creature, then the attacker it blocks (or drag it there)";
        buttons = [[n ? `Block (${n})` : "No blocks", () => answer(sel.slice()), "act"]];
        if (n || holding != null) buttons.unshift(["Clear", () => { sel = []; holding = null; redraw(350); status(); }]);
      } else if (k === "pay") {
        what = promptText() + (sel.length ? ` · ${sel.map(o => d.options[o - 1]).join(", ")}` : ": tap your mana, or let Forge pay");
        buttons = [[sel.length ? "Pay" : "Auto-pay", () => answer(sel.slice()), "act"]];
        if (sel.length) buttons.unshift(["Undo", () => { sel.pop(); redraw(250); status(); }]);
      } else if (k === "confirm") { what = promptText(); buttons = [["Yes", () => answer([1]), "act"], ["No", () => answer([2])]]; }
      else if (boardChoice()) {
        what = promptText() + (d.max > 1 && d.kind !== "targets" ? ` (${sel.length}/${d.max})` : "");   // targets say their count; Done (n) counts
        if (d.max > 1 || d.min === 0) buttons.push([sel.length ? `Done (${sel.length})` : "None", () => answer(sel.slice()), "act" + (sel.length < d.min ? " off" : "")]);
        buttons.unshift(["List", chooser]);
      } else {
        what = promptText();
        buttons = [["Choose…", chooser, "act"]];
        if (!sheetEl) setTimeout(() => !sheetEl && d && !busy && chooser(), 0);
      }
      if (k !== "mulligan" && !(k === "play" && top && playOptions().length === 0)) buttons.unshift(["Let Forge decide", auto, "ghost"]);
    }
    const floating = Object.entries(P.player(P.ME).manaPool || {}).filter(([, n]) => n > 0)
      .map(([color, n]) => `${n} {${color}}`).join(" ");
    const ctx = [d && !busy && !stackOpen() ? context() : "", floating ? `Floating mana: ${floating}` : ""].filter(Boolean).join(" · ");
    promptEl.innerHTML = recapHTML() + `<div class="l-where">${esc(where)}</div><div class="l-what">${pips(what)}</div>${ctx ? `<div class="l-ctx">${pips(ctx)}</div>` : ""}<div class="l-buttons"></div>`;
    const rx = promptEl.querySelector(".l-recap .g-close"), rl = promptEl.querySelector(".l-lost");
    if (rx) rx.addEventListener("click", e => { e.stopPropagation(); losses = []; status(); });
    if (rl) rl.addEventListener("click", e => { e.stopPropagation(); lostSheet(); });
    const row = promptEl.querySelector(".l-buttons");
    buttons.forEach(([t, fn, cls]) => { const b = el("button", cls || "", esc(t)); if (/off/.test(cls || "")) b.disabled = true; b.addEventListener("click", fn); row.appendChild(b); });
    promptEl.classList.toggle("asking", !!d && !busy);
    promptEl.classList.toggle("threat", !!d && !busy && threat());
    promptEl.hidden = !!d && d.kind === "mulligan" && !busy;
    if (feedEl) feedEl.classList.toggle("big", G.stack.length > 0);
    if (infoEl && !infoEl.hidden && !infoEl.classList.contains("out")) stackInfo();   // the panel names the targets as they're picked
  }
  const PHASE_SHORT = ph => (ph || "").toLowerCase();
  const shortCard = n => (n.includes(", ") ? n.split(", ")[0] : n);
  function abilityText(t, name, full) {
    const x = (t || "").replace(name + " - ", "").replace(/^[^-]+ - /, "").trim();
    return x.length > 90 && !full ? x.slice(0, 88) + "…" : x;
  }

  let feedEl, menuBtn, seenLog = -1;
  const logText = t => (t || "").replace(/ \[(Card|Zone Changer|Activator):[^\]]*\]/g, "").replace(/ \(\d+\)/g, "").replace(/\s+/g, " ").trim();
  function feed() {
    const log = ((snap && snap.view && snap.view.log) || []).filter(e => logText(e.text));
    if (!feedEl) return;
    const last = log.slice(G.stack.length ? -6 : -4);
    feedEl.innerHTML = last.map(e => `<div class="${e.i > seenLog ? "new" : ""}">${pips(logText(e.text))}</div>`).join("");
    feedEl.hidden = !last.length;
    if (log.length) seenLog = Math.max(seenLog, log[log.length - 1].i);
  }
  function fullLog() {
    const log = ((snap && snap.view && snap.view.log) || []).slice().reverse();
    sheet("What happened", box => {
      const list = el("div", "l-log");
      list.innerHTML = log.map(e => `<div class="t-${e.type.toLowerCase()}">${pips(logText(e.text))}</div>`).join("") || "<div>Nothing yet</div>";
      box.appendChild(list);
    }, { wide: true });
  }
  // The game menu: start a new game with a deck for you and three for Jev.
  let decks = null;
  async function menu() {
    if (!decks) { try { decks = await (await fetch("api/decks")).json(); } catch (e) { decks = []; } }
    const pick = (label, value) => {
      const w = el("label", "l-field", `<span>${esc(label)}</span>`), sl = el("select");
      decks.forEach(n => { const o = el("option", "", esc(n.replace(/\.txt$/, ""))); o.value = n; if (n === value) o.selected = true; sl.appendChild(o); });
      w.appendChild(sl); return [w, sl];
    };
    const saved = (() => { try { return JSON.parse(localStorage.getItem("seat-game") || "null"); } catch (e) { return null; } })() || {};
    const deflt = ["blue-moon-combat-revision.txt", "eternities-living-worlds-iii.txt", "eternities-assimilation-iii.txt", "dack-cedh.txt"];
    sheet("New game", box => {
      const fields = [["Your deck", saved.deck || deflt[0]], ["Left (Jev)", (saved.opponents || [])[0] || deflt[1]], ["Across (Jev)", (saved.opponents || [])[1] || deflt[2]], ["Right (Jev)", (saved.opponents || [])[2] || deflt[3]]].map(([l, v]) => pick(l, v));
      fields.forEach(([w]) => box.appendChild(w));
      const mw = el("label", "l-field", "<span>Paying mana</span>"), ms = el("select");
      [["creatures", "Ask when a creature could pay"], ["always", "Always ask"], ["auto", "Forge pays"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; if (v === (saved.mana || "creatures")) o.selected = true; ms.appendChild(o); });
      mw.appendChild(ms); box.appendChild(mw);
      const row = el("div", "l-row"), go = el("button", "l-done", "Start");
      go.addEventListener("click", async () => {
        const body = { deck: fields[0][1].value, opponents: fields.slice(1).map(f => f[1].value), mana: ms.value };
        try { localStorage.setItem("seat-game", JSON.stringify(body)); } catch (e) { /* not remembered */ }
        closeSheet(); lastView = ""; known = {}; seenLog = -1;
        await fetch("api/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      });
      row.appendChild(go); box.appendChild(row);
      box.appendChild(el("p", "l-note", "Jev and the deck advisors pilot the other three seats. Starting a game ends the one in progress."));
    });
  }

  // {2}{U} as mana symbols. Text is escaped first; only the braces become symbols.
  const PIPC = { W: "w", U: "u", B: "b", R: "r", G: "g", C: "c", S: "n", X: "n", T: "t", Q: "t" };
  function pips(text) {
    return esc(text).replace(/\{([^}]{1,5})\}/g, (_, t) => {
      const k = t.toUpperCase(), cls = /^\d+$/.test(k) ? "n" : PIPC[k] || (k.includes("/") ? "h" : "n");
      return `<i class="pip pip-${cls}" aria-label="${k}">${k === "T" ? "↷" : k === "Q" ? "↶" : k.replace("/", "")}</i>`;
    });
  }

  // ---- Focus you chose, pauses on what the others do, and what you lost while they did it -----------------------
  let lean = null, backEl, stackChipEl, autoTimer = null, held = false, losses = [];
  H.onFocus = pid => { lean = pid ? { seat: pid, turn: G.turn } : null; backBar(); H.stackLayer = stackOpen(); stackInfo(); };   // leaning in sets the stack aside, however you got there
  function backBar() {
    if (!backEl) return;
    backEl.hidden = !lean;
    if (lean) backEl.innerHTML = `<span>${esc(P.player(lean.seat).name)}'s side</span><button>Back to the table</button>`;
    stackChip();
  }
  // Leaning in hides the stack; a slip at the top says it is still there and how deep. Words only: the way back is the bar.
  function stackChip() {
    if (!stackChipEl) return;
    stackChipEl.hidden = !(lean && G.stack.length);
    if (!stackChipEl.hidden) stackChipEl.textContent = `Stack: ${G.stack.length}`;
  }
  // On an opponent's spell you can't answer, play goes on by itself after a moment, unless you hold it.
  function autoContinue() {
    clearTimeout(autoTimer); held = false;
    const top = G.stack[0];
    if (!d || d.kind !== "play" || !top || top.controller === "you" || threat() || playOptions().length > 0) return;
    const k = dkey;
    autoTimer = setTimeout(() => { if (dkey === k && !held && !busy) answer([1]); }, 3200);
  }
  function hold() { held = true; clearTimeout(autoTimer); status(); }
  // Whether the top of the stack is aimed at you or something of yours.
  function threat() {
    const top = G.stack[0];
    return !!top && top.controller !== "you" && (top.targets || []).some(t => t === "you" || (typeof t === "number" && G.cards[t] && G.cards[t].controller === "you"));
  }
  const myBoard = () => new Map(Object.values(G.cards).filter(c => c.zone === "battlefield" && c.controller === "you").map(c => [c.id, c.card]));
  // Cards of yours that leave the battlefield on another player's turn are listed until you dismiss them, with why.
  function noteLosses(before) {
    if (!before.size || G.active === "you") return;
    const now = myBoard(), log = (snap.view && snap.view.log) || [];
    const gone = [...before].filter(([id]) => !now.has(id) && !G.stack.some(st => st.card === id));
    if (!gone.length) return;
    gone.forEach(([id, name]) => {
      const c = G.cards[id], where = c ? { graveyard: "to the graveyard", exile: "into exile", hand: "back to your hand", command: "to the command zone", library: "into the library" }[c.zone] || "away" : "away";
      const why = log.slice().reverse().find(e => logText(e.text).includes(name) && !/^Turn /.test(e.text));
      losses.push({ name, where, why: why ? logText(why.text) : "" });
    });
    recap();
  }
  // One line on top of the prompt, where your eyes go when it's your move again: what you lost, by name. Every card, where
  // it went and why are a tap away, so the prompt never grows up over the board.
  const recapHTML = () => !losses.length ? "" : `<div class="l-recap"><button class="l-lost">Lost: <b>${esc(losses.map(l => l.name).join(", "))}</b></button><button class="g-close" aria-label="Dismiss">✕</button></div>`;
  function lostSheet() {
    sheet("What you lost", box => {
      const list = el("div", "l-log");
      list.innerHTML = losses.map(l => `<div><b>${esc(l.name)}</b> went ${esc(l.where)}${l.why ? `<small>${pips(l.why)}</small>` : ""}</div>`).join("");
      box.appendChild(list);
    }, { wide: true });
  }
  const recap = () => status();

  window.SeatPips = pips;

  // ---- The stack layer: over the table, with what each item does beside it ---------------------------------------
  let shutKey = null, infoEl, mullEl;
  const stackKey = () => G.stack.map(st => st.id + ":" + st.card).join(",");
  const stackOpen = () => G.stack.length > 0 && shutKey !== stackKey() && !lean;
  function layerChanged() { H.stackLayer = stackOpen(); stackInfo(); status(); redraw(380); }
  function stackInfo() {
    if (!infoEl) return;
    stackChip();
    // Closing, it fades out as the spells leave the stack on the board.
    if (!stackOpen()) {
      if (!infoEl.hidden && !infoEl.classList.contains("out")) { infoEl.classList.add("out"); clearTimeout(stackInfo.t); stackInfo.t = setTimeout(() => { infoEl.hidden = true; infoEl.classList.remove("out"); }, 320); }
      return;
    }
    clearTimeout(stackInfo.t); infoEl.classList.remove("out");
    const was = infoEl.hidden;
    infoEl.hidden = false;
    if (was) infoEl.style.setProperty("--land", Math.round(seat.stackLanding ? seat.stackLanding() : 0) + "ms");   // it arrives as the card lands
    // One panel: what resolves next in full, then everything under it a line each. While I'm still choosing my spell's
    // targets, it says so, and names the ones picked so far.
    const name = t => t === "you" ? "you" : typeof t === "number" && G.cards[t] ? (G.cards[t].controller === "you" ? "your " : "") + P.name(G.cards[t]) : P.player(t) ? P.player(t).name : "";
    const entry = (st, i) => {
      const c = P.card(st.card), f = P.face(c) || {}, nm = P.name(c);
      const who = st.controller === "you" ? "You" : P.player(st.controller).name;
      const what = st.spell ? (f.text || "") : abilityText(st.text, nm, true);
      const choosing = !i && !!d && d.kind === "targets" && st.controller === "you" && !(st.targets || []).length;
      const tg = (choosing ? sel.map(o => refs()[o - 1]).filter(Boolean).map(r => (r.player ? pidOf[r.player] : r.card)) : (st.targets || [])).map(name).filter(Boolean);
      const aimed = st.controller !== "you" && (st.targets || []).some(t => t === "you" || (typeof t === "number" && G.cards[t] && G.cards[t].controller === "you"));
      const kind = st.spell ? esc(typeOf(f.type || "Spell").split(" — ")[0].replace(/^Legendary /, "")) : "Ability";
      if (i) return `<li class="${aimed ? "aimed" : ""}"><b>${esc(nm)}</b><i>${esc(who)} · ${kind}${tg.length ? ` → ${esc(tg.join(", "))}` : ""}</i>${f.cost && st.spell ? `<span>${pips(f.cost)}</span>` : ""}</li>`;
      return `<article class="top${aimed ? " aimed" : ""}"><header><b>${esc(nm)}</b>${f.cost ? `<span>${pips(f.cost)}</span>` : ""}</header>` +
        `<div class="by">${esc(who)} · ${kind} · ${choosing ? "choosing targets" : "resolves next"}</div>` +
        `<p>${pips(what)}</p>` + `<button class="more${what.length > 120 ? "" : " short"}" data-id="${st.card}">…more</button>` + (tg.length ? `<div class="tg">→ ${esc(tg.join(", "))}</div>` : "") + "</article>";
    };
    const under = G.stack.slice(1);
    infoEl.innerHTML = `<div class="panel">${entry(G.stack[0], 0)}${under.length ? `<ol class="rest">${under.map((st, i) => entry(st, i + 1)).join("")}</ol>` : ""}` +
      `<footer>Tap the table to look past the stack</footer></div>`;   // the hint is the panel's own foot, on the same parchment
    place();
  }
  // Where the panel goes: somewhere it covers no cards and no plaques. Beside the stack card first (right, then left, level
  // with its top or its foot), then the top margin beside the log, then any open stretch of table. Each spot is scored by
  // the cards it would cover, a card being aimed at or offered and a plaque (who and their life) counting many times over,
  // my own row ruling a spot out; the emptiest wins. Where a full board leaves no room for it whole, it says only what
  // resolves next, by whom and at what (`brief`); its text is a tap away.
  function place() {
    if (!infoEl || infoEl.classList.contains("out")) return;   // leaving, it fades where it was, as it was
    infoEl.classList.remove("brief");
    if (!placeAt() && infoEl.querySelector(".more, p")) { infoEl.classList.add("brief"); placeAt(); }
  }
  function placeAt() {
    const r = seat && seat.stackRect && seat.stackRect();
    if (!r || !infoEl || infoEl.hidden) return true;
    infoEl.style.maxHeight = "";
    const w = infoEl.offsetWidth || 250, h = infoEl.offsetHeight || 200, V = seat.T.Vector3;
    const aimed = new Set(Object.keys((H.marks && H.marks.cards) || {}).map(Number));
    G.stack.forEach(st => (st.targets || []).forEach(t => typeof t === "number" && aimed.add(t)));
    // Where every piece is going, not where it is mid-move: the board may still be on its way.
    const boxes = [], poses = seat.poses ? seat.poses() : {};
    let rowTop = innerHeight;
    Object.entries(seat.pieces()).forEach(([k, pc]) => {
      const t = poses[k];
      if (!t || t.hide || pc.role === "floor") return;
      // A tapped standee lies turned, as wide as a card is tall; a folded pile's tab stands above its top.
      const turned = ["creature", "walker"].includes(pc.role) && (G.cards[pc.ids[0]] || {}).tapped, piled = pc.ids.length > 1 && pc.role !== "plate";
      const at = t.pos.clone(), s = t.s || 1, hw = pc.role === "plate" ? 1.6 : turned ? 0.52 : 0.4, ht = (pc.role === "plate" ? 0.85 : 1.05 + (piled ? 0.24 : 0)) * s;
      const a = seat.project(at.clone().add(new V(-hw * s, 0, 0))), b = seat.project(at.clone().add(new V(hw * s, ht * 0.66, -ht * 0.76)));
      boxes.push({ l: a.x, r: b.x, t: b.y, b: a.y, k: pc.role === "plate" ? 30 : pc.ids.some(id => aimed.has(id)) ? 8 : pc.pid === "you" && pc.role === "creature" ? 40 : 1 });
      if (pc.pid === "you" && pc.role === "creature") rowTop = Math.min(rowTop, b.y);
    });
    const feedR = feedEl && !feedEl.hidden ? feedEl.getBoundingClientRect() : { right: 12, bottom: 60 };
    const top = Math.max(70, r.top), foot = r.bottom - h;
    const above = rowTop - h - 10;                 // as low as it can go and still stand clear of my row
    const slide = [0, 40, 80, 120, 160];             // just above my row, stepping out from the stack card, for a clear stretch
    const grid = [];                                 // then anywhere above my row, nearest the stack card first
    for (let y = 8; y + h < rowTop; y += 16) for (let x = 8; x + w < innerWidth - 8; x += 16) grid.push([x, y]);
    const mid = [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    grid.sort((a, b) => Math.hypot(a[0] + w / 2 - mid[0], a[1] + h / 2 - mid[1]) - Math.hypot(b[0] + w / 2 - mid[0], b[1] + h / 2 - mid[1]));
    const spots = [[r.right + 18, top], [r.left - 18 - w, top], [r.right + 18, foot], [r.left - 18 - w, foot], ...slide.map(dx => [r.right + 18 + dx, above]), ...slide.map(dx => [r.left - 18 - w - dx, above]), [feedR.right + 14, 12], [innerWidth - w - 14, 12], ...grid]
      .map(([x, y]) => ({ x: Math.round(Math.max(8, Math.min(innerWidth - w - 8, x))), y: Math.round(Math.max(8, y)) }));
    // (Clear of the stack's own cards, which it speaks for, and of the log, the menu and the prompt, chrome that stays.)
    boxes.push({ l: r.left, r: r.right, t: r.top, b: r.bottom, k: 30 });
    [feedEl, menuBtn, promptEl].forEach(e => { if (!e || e.hidden) return; const b = e.getBoundingClientRect(); boxes.push({ l: b.left, r: b.right, t: b.top, b: b.bottom, k: 30 }); });
    spots.forEach((sp, i) => {
      sp.n = i * 1e-5 + (sp.y + h > rowTop ? 1e4 : 0);
      boxes.forEach(bx => { const ox = Math.min(bx.r, sp.x + w) - Math.max(bx.l, sp.x), oy = Math.min(bx.b, sp.y + h) - Math.max(bx.t, sp.y); if (ox > 0 && oy > 0) sp.n += bx.k * ox * oy / ((bx.r - bx.l) * (bx.b - bx.t) || 1); });
    });
    const aims = seat.aims ? seat.aims() : [];                      // and the arcs: a panel over an arc hides what it aims at
    spots.forEach(sp => aims.forEach(p => { if (p.x > sp.x - 14 && p.x < sp.x + w + 14 && p.y > sp.y - 14 && p.y < sp.y + h + 14) sp.n += 1; }));
    const best = spots.reduce((a, b) => (b.n < a.n ? b : a));
    infoEl.classList.toggle("left", best.x + w / 2 < (r.left + r.right) / 2);
    infoEl.style.left = best.x + "px";
    infoEl.style.top = best.y + "px";
    return best.n < 0.01;
  }
  // Mulligans: the hand comes to the middle of the screen, over a dimmed table.
  function mulligan() {
    const on = !!d && d.kind === "mulligan" && !busy;
    if (!on) { if (mullEl) { mullEl.remove(); mullEl = null; } return; }
    const ids = P.player("you").hand.slice(), m = (d.prompt || "").match(/(\d+)/);
    if (!mullEl) { mullEl = el("div", "l-mull"); document.body.appendChild(mullEl); }
    mullEl.innerHTML = `<div class="l-mullbox"><h2>${esc(d.prompt.replace(/^keep this hand\??/i, "Keep this hand?"))}</h2><div class="cards"></div><div class="l-buttons"></div></div>`;
    const row = mullEl.querySelector(".cards");
    ids.forEach(id => {
      const b = el("button", "pic"); b.style.backgroundImage = `url("${P.image(G.cards[id])}")`; b.setAttribute("aria-label", P.name(G.cards[id]));
      b.addEventListener("click", () => seat.inspect(id)); row.appendChild(b);
    });
    const bs = mullEl.querySelector(".l-buttons");
    [["Mulligan", () => answer([2])], ["Keep " + ids.length, () => answer([1]), "act"]].forEach(([t, fn, cls]) => {
      const b = el("button", cls || "", esc(t)); b.addEventListener("click", fn); bs.appendChild(b);
    });
  }

  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text; toastEl.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove("on"), 2600);
  }
  const newGame = menu;
  H.overlay = ({ statusEl }) => { statusEl.hidden = true; status(); };

  H.ready = api => {
    seat = api;
    promptEl = el("div", "l-prompt"); document.body.appendChild(promptEl);
    toastEl = el("div", "l-toast"); document.body.appendChild(toastEl);
    menuBtn = el("button", "l-menu", "Game"); menuBtn.addEventListener("click", menu); document.body.appendChild(menuBtn);
    feedEl = el("div", "l-feed"); feedEl.hidden = true; feedEl.addEventListener("click", fullLog); document.body.appendChild(feedEl);
    infoEl = el("div", "l-stackinfo"); infoEl.hidden = true; document.body.appendChild(infoEl);
    infoEl.addEventListener("click", e => { const b = e.target.closest(".more"); if (b) { e.stopPropagation(); seat.inspect(+b.dataset.id); } });
    stackChipEl = el("div", "l-stackchip"); stackChipEl.hidden = true; document.body.appendChild(stackChipEl);
    backEl = el("div", "l-back"); backEl.hidden = true; backEl.addEventListener("click", () => { lean = null; seat.setFocus(null); backBar(); redraw(450); }); document.body.appendChild(backEl);

    status();
    poll();
  };
  window.Live = { get decision() { return d; }, get sel() { return sel; }, answer, auto, take, get snap() { return snap; }, newGame,
    override: args => fetch("api/override", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args }) }).then(r => r.json()) };
})();
