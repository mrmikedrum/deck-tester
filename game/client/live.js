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
  const MOVE = 520, DRAW = 650, AUTO_PASS = 3200;
  let motion = "", motionFrame, motionUntil = 0;
  const flights = new Set(), draws = new Set(), drawAnimations = new Map(), incomingStack = new Set();
  let recentDraws = [], positionLoad = "", loadTimer;

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
      attackers: view.combat.attackers.map(a => ({ id: a.id, defender: defender(a.defender), target: a.defender })).filter(a => a.defender && G.cards[a.id]),
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
    const generationChanged = !!snap?.view?.players?.length && snap.gen !== s.gen;
    const was = snap?.gen === s.gen && snap?.view?.players?.length ? snap.view : null;
    snap = s;
    if (!was || !s.view?.players?.length) {
      clearHistory();
      lastView = ""; known = {}; shutKey = null;
      resetHeld();
      d = dkey = null; busy = false; sel = []; holding = attackTo = null;
      resetAutoPass();
      closeSheet();
      if (lean) { seat.unsift(); seat.setFocus(null); }
    }
    if (!s.view?.players?.length) { status(); mulligan(); return; }
    const viewKey = JSON.stringify(s.view);
    // A view whose log doesn't carry on from the last one (a reload, a jump to another position) isn't play: the table
    // cuts to it rather than animating moves that never happened.
    const tail = was?.log?.at(-1), log = s.view.log || [];
    const jump = !!was && (s.view.turn < was.turn || !!tail && !log.some(e => logKey(e) === logKey(tail)) && (!log.length || log[0].i <= tail.i));
    const nd = s.decision || null, nk = nd ? keyOf(nd) : null;
    // Mana abilities may resolve immediately and return the same menu. A changed game
    // position with another pending decision is a fresh stop, even if its labels match.
    const changedView = viewKey !== lastView, changedDecision = !was || jump || nk !== dkey || (busy && changedView && !!nd);
    let moving = "", sceneBefore;
    if (changedView) {
      await cardsFor(names(s.view));
      remember(s.view);
      const before = myBoard();
      apply(s.view);
      if (jump) {
        clearHistory();
        shutKey = null;
        resetHeld();
        closeSheet();
      }
      const fresh = log.filter(e => !logged.has(logKey(e)));
      const rewound = jump && s.view.turn <= was.turn && (s.view.turn < was.turn || (log.at(-1)?.i ?? -1) < (tail?.i ?? -1));
      clearTimeout(loadTimer);
      positionLoad = rewound ? "Earlier position restored" : jump || generationChanged ? "Game position loaded" : "";
      let outcome = positionLoad ? `${positionLoad}. Turn ${G.turn} · ${whoName(G.active)} ${PHASE_SHORT(G.phase)}.` : "";
      if (positionLoad) loadTimer = setTimeout(() => { positionLoad = ""; status(); }, 1600);
      if (was && !jump) {
        const departed = was.stack.filter(st => st.source && !s.view.stack.some(n => n.id === st.id));
        const lost = noteLosses(before, fresh);
        outcome = outcomes(departed, was, fresh);
        const attacks = attackersAtMe();
        const oldHand = new Set((was.players[0].hand || []).map(c => c.id));
        const newDraws = P.player(P.ME).hand.filter(id => !oldHand.has(id));
        if (newDraws.length) recentDraws = newDraws;
        const drawLine = newDraws.length > 3 ? `${newDraws.length} cards are moving into your hand` :
          newDraws.length ? `Into your hand · ${listNames(newDraws.map(id => P.name(G.cards[id])))}` : "";
        newDraws.forEach(id => draws.add(id));
        const added = G.stack.filter(st => !was.stack.some(o => o.id === st.id));
        added.forEach(st => incomingStack.add(st.id));
        if (added.length) moving = stackHeadline(added[0]);
        else if (["Attackers", "Blockers"].includes(G.phase) && attacks.some(a => !was.combat?.attackers.some(o => o.id === a.id))) moving = `${s.view.active}'s attackers are moving in`;
        else if (departed.length || lost || s.view.phase === "COMBAT_DAMAGE" && s.view.phase !== was.phase) {
          const sweep = /^Sunfall exiled every creature\./i.test(outcome) || /^Sunfall resolved\./i.test(outcome) &&
            was.players.some(p => p.battlefield?.some(c => G.cards[c.id]?.zone === "exile"));
          moving = sweep ? "Sunfall resolves · creatures are going to exile" : drawLine ||
            (departed.length === 1 && departed[0].spell ? `${departed[0].source.name} is leaving the stack` : "Cards are moving");
        } else if (newDraws.length) {
          moving = drawLine;
        }
        if (moving) sceneBefore = new Set(seat.scene.children);
      }
      recordLog(fresh, outcome);
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
    if (lean && (jump || lean.turn !== G.turn || (changedDecision && d) || elsewhere)) { seat.unsift(); seat.setFocus(null); }
    H.soft = G.active !== "you" ? { seat: G.active } : {};
    H.stackLayer = stackOpen();
    H.handAway = !!d && d.kind === "mulligan";
    if (changedView || changedDecision) {
      if (moving) motion = moving;
      redraw(!was || jump ? 0 : changedView ? MOVE : 300);
      if (sceneBefore) {
        motionUntil = performance.now() + MOVE;
        // The board adds departing cards and staggered pile arrivals to the scene until each flight finishes.
        seat.scene.children.filter(o => !sceneBefore.has(o)).forEach(o => flights.add(o));
        if (!motionFrame) motionFrame = requestAnimationFrame(settleMotion);
      }
      status(); feed(); mulligan();
    }
  }
  const keyOf = x => [x.kind, x.turn, x.prompt, (x.options || []).length].concat((x.options || []).slice(0, 6)).join("|");

  // Keep the visual cue on the play until the board and hand finish. Decisions run independently.
  function settleMotion(now) {
    if (incomingStack.size && !document.body.classList.contains("stack-landing")) incomingStack.clear();
    for (const o of flights) if (o.parent !== seat.scene) flights.delete(o);
    const hand = P.player(P.ME).hand;
    for (const id of draws) {
      const card = heldEl?.querySelector(`.hcard[data-id="${id}"]`), animation = drawAnimations.get(id);
      const drawing = animation && animation.effect?.target === card && animation.currentTime < DRAW;
      if (!hand.includes(id) || card && !drawing) draws.delete(id);
    }
    if (incomingStack.size || flights.size || draws.size || now < motionUntil) {
      motionFrame = requestAnimationFrame(settleMotion);
    } else {
      motionFrame = 0; motion = "";
      status(); feed();
    }
  }

  // ---- Answering -----------------------------------------------------------------------------------------------------
  async function send(body) {
    if (busy) return;
    const decision = d;
    busy = true; status();
    try {
      const r = await (await fetch("api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ key: dkey }, body)) })).json();
      if (decision === d && !r.ok) { busy = false; toast(r.error || "Forge refused that"); status(); }
    } catch (e) { if (decision === d) { busy = false; toast("Lost the bridge"); status(); } }
    if (decision === d) closeSheet();
  }
  const answer = picks => send({ answer: picks });
  const auto = () => send({ defer: true });

  // ---- What each decision lets you touch ------------------------------------------------------------------------------
  const refs = () => (d && d.refs) || [];
  const optsFor = id => refs().map((r, i) => (r && r.card === id ? i + 1 : 0)).filter(Boolean);
  // Mana stays on its permanent, not in the play/response menus or auto-pass gate.
  const playOptions = () => refs().flatMap((r, i) => i && r && !r.mana && i < d.options.length ? [i + 1] : []);
  const attackersAtMe = () => (G.combat && G.combat.attackers || []).filter(a => a.defender === P.ME);
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
  }

  // ---- Taps and drags on the board ---------------------------------------------------------------------------------
  function idsOf(pk) { return pk.type === "card" ? [pk.id] : pk.type === "pile" ? pk.ids : []; }
  H.tap = (pk, hit) => {
    if (autoTimer !== null && d) hold();            // touching the table while play runs on holds it
    if (tapDecision(pk, hit)) return true;
    if (pk && pk.stack && !stackOpen()) { shutKey = null; layerChanged(); return true; }     // tap the stack to bring it back
    if (stackOpen()) { shutKey = stackKey(); layerChanged(); return true; }                   // tap past it to see the table
    if (pk?.type === "pile" && hit?.obj) {
      seat.sift(pk.ids, hit.obj.getWorldPosition(new seat.T.Vector3()), null, hit.obj);
      return true;
    }
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
  function resetHeld() {
    cancelAnimationFrame(heldAnim);
    heldEl?.replaceChildren();
    heldIds = ""; focusId = hg = null;
  }
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
  function handSheet() {
    sheet("Your hand", box => {
      const pass = el("div", "l-hand-pass l-buttons", `<span>Auto-pass</span><button class="auto">Hold</button>`);
      pass.querySelector("button").addEventListener("click", hold);
      box.appendChild(pass);
      handIds().forEach(id => {
        const c = G.cards[id], opts = d?.kind === "play" && !busy ? optsFor(id) : [];
        const detail = [recentDraws.includes(id) ? "Last added" : "", opts.length ? "Available play" : ""].filter(Boolean).join(" · ");
        const b = el("button", "l-opt" + (opts.length ? "" : " l-read"), `<b>${handLabel(c)}</b>${detail ? `<small>${esc(detail)}</small>` : ""}`);
        b.addEventListener("click", () => {
          closeSheet();
          if (!handIds().includes(id)) return;
          const current = d?.kind === "play" && !busy ? optsFor(id) : [];
          if (current.length) inspectWith(id, current); else seat.inspect(id);
        });
        box.appendChild(b);
      });
    });
    syncHandPass();
  }
  function handLabel(c) {
    const cost = P.printed(c).cost || P.face(c)?.cost;
    return esc(P.name(c)) + (cost ? `<span class="cost">${pips(cost)}</span>` : "");
  }
  function syncHandPass() {
    const pass = sheetEl?.querySelector(".l-hand-pass");
    if (!pass) return;
    pass.hidden = autoTimer === null || busy;
    if (!pass.hidden) pass.querySelector("button").style.setProperty("--auto-elapsed", autoElapsed());
  }
  function renderHeld(container) {
    const ids = handIds(), key = ids.join(",");
    if (!heldEl || heldEl.parentNode !== container) {
      container.innerHTML = "";
      heldEl = el("div", "held");
      container.appendChild(heldEl);
      const view = el("button", "l-hand-view", "View hand");
      view.addEventListener("click", handSheet);
      container.appendChild(view);
      heldEl.addEventListener("wheel", e => {       // a sideways scroll turns one card per burst
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault();
        const now = performance.now(), fresh = now - lastWheel > 280; lastWheel = now;
        if (fresh && Math.abs(e.deltaX) > 4) turnTo(Math.round(fTo) + (e.deltaX > 0 ? 1 : -1));
      }, { passive: false });
    }
    placeHeld();
    container.querySelector(".l-hand-view").hidden = !ids.length;
    heldEl.querySelectorAll(".hcard").forEach(x => x.classList.remove("playable", "unplayable"));
    if (key === heldIds) { drawHeld(); return heldEl; }          // keep a swipe in progress
    const before = new Map([...heldEl.children].map(hc => [+hc.dataset.id, hc]));
    const changedByDraw = ids.some(id => draws.has(id) && !before.has(id));
    const starts = new Map();
    before.forEach((hc, id) => {
      if (!ids.includes(id)) {
        if (heldIds && G.stack.some(st => st.card === id)) castFrom(id, hc);
        if (hg?.id === id) hg = null;
        hc.remove();
      } else if (changedByDraw) starts.set(id, getComputedStyle(hc).transform);
    });
    ids.forEach((id, i) => {
      let hc = before.get(id);
      if (!hc) {
        hc = el("div", "hcard");
        hc.dataset.id = id;
        hc.style.backgroundImage = `url("${P.printed(G.cards[id]).img}")`;
        hc.appendChild(el("div", "l-hand-label", handLabel(G.cards[id])));
        hc.addEventListener("pointerdown", heldDown);
        hc.addEventListener("pointermove", heldMove);
        hc.addEventListener("pointerup", heldUp);
        hc.addEventListener("pointercancel", heldUp);
      }
      if (heldEl.children[i] !== hc) heldEl.insertBefore(hc, heldEl.children[i] || null);
    });
    heldIds = key;
    let i = ids.indexOf(focusId);
    if (i < 0) i = focusId == null ? ids.length - 1 : Math.min(ids.length - 1, Math.round(fTo));
    focusId = ids[i]; fNow = fTo = i; fVel = 0;
    drawHeld();
    starts.forEach((from, id) => {
      const hc = before.get(id);
      hc.getAnimations().find(a => a.id === "hand-settle")?.cancel();
      hc.animate([{ transform: from }, { transform: hc.style.transform }], { id: "hand-settle", duration: MOVE, easing: "ease-out" });
    });
    ids.filter(id => draws.has(id) && !before.has(id)).forEach(drawn);
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
    const animation = hc.animate([{ translate: `${dx}px ${dy}px`, scale: "0.35", opacity: 0.3 }, { translate: "0px 0px", scale: "1", opacity: 1 }], { duration: DRAW, easing: "cubic-bezier(.2,.7,.2,1)" });
    drawAnimations.set(id, animation);
    const finished = () => { if (drawAnimations.get(id) === animation) drawAnimations.delete(id); };
    animation.finished.then(finished, finished);
    hc.classList.add("drawn"); setTimeout(() => hc.classList.remove("drawn"), 1250);
  }
  function heldDown(e) {
    const hc = e.currentTarget;
    hc.getAnimations().find(a => a.id === "hand-settle")?.cancel();
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
  addEventListener("keydown", e => {
    if (e.key !== "Escape" || !seat) return;
    if (document.querySelector(".scrim, .g-modal")) seat.closeModals();
    else if (sheetEl) closeSheet();
    else if (document.body.classList.contains("sifting")) seat.unsift();
    else return;
    e.stopImmediatePropagation();
  }, true);
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
  function responseButton(opts) {
    if (opts.length !== 1) return [`Respond (${opts.length})`, () => offer(opts, "Respond")];
    const o = opts[0], label = playLabel(d.options[o - 1]);
    return [label, () => answer([o]), "", pips(label) + costOf(o)];
  }
  // What a cast costs, after its name, when the card's cost is known; an ability's cost is already in its label.
  function costOf(o) {
    const label = d.options[o - 1], r = refs()[o - 1], c = r && r.card != null && G.cards[r.card];
    if (!c || r.spell === false || label !== c.card && ![" (commander)", " (from graveyard)", " (from exile)"].some(suffix => label === c.card + suffix)) return "";
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
  const listNames = names => new Intl.ListFormat("en").format(names);
  const stackName = st => P.name(P.card(st.card));
  function stackHeadline(st) {
    const who = st.controller === "you" ? "You" : P.player(st.controller).name;
    return st.spell ? `${who} cast ${stackName(st)}` : `${shortCard(stackName(st))}'s ability is on the stack`;
  }
  function aimedAtMe(st) {
    return st.targets.filter(t => t === "you" || (typeof t === "number" && G.cards[t] && G.cards[t].controller === "you"));
  }
  function targetName(t, short = false) {
    if (t === "you") return "you";
    if (typeof t !== "number") return P.player(t)?.name || "";
    const c = G.cards[t];
    if (!c) return "";
    return (c.controller === "you" ? "your " : "") + (short ? shortCard(P.name(c)) : P.name(c));
  }
  // Use the actual text to explain this targeted exile and life gain, without predicting other players' responses.
  function passEffect(st) {
    const text = (P.face(P.card(st.card)) || {}).text || "";
    const targets = aimedAtMe(st);
    if (targets.length === 1 && /^Exile target creature\. Its controller gains life equal to its power\./i.test(text)) {
      return `If everyone passes, ${targetName(targets[0], true)} goes to exile and you gain life equal to its power.`;
    }
    return "If everyone passes, the top item resolves.";
  }
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
    if (!s.view?.players?.length) {
      promptEl.hidden = false;
      ["asking", "moving", "threat"].forEach(cls => promptEl.classList.remove(cls));
      promptEl.innerHTML = `<div class="l-what">${esc(s.state === "starting" ? "Shuffling up… (the first game takes about a minute)" : s.state === "error" ? "Couldn't start: " + (s.error || "") : "No game yet")}</div><div class="l-buttons"></div>`;
      if (s.state !== "starting") { const b = el("button", "act", "New game"); b.addEventListener("click", menu); promptEl.querySelector(".l-buttons").appendChild(b); }
      return;
    }
    const top = G.stack[0];
    const incoming = G.phase === "Attackers" ? attackersAtMe() : [];
    const attacking = incoming.length > 0;
    const blockers = G.phase === "Blockers" && [...new Set((snap.view.combat?.blockers || []).map(b => G.cards[b.id]?.controller).filter(Boolean))];
    const where = blockers ? `Turn ${G.turn} · ${whoName(G.active)} turn · Declare blockers` : `Turn ${G.turn} · ${whoName(G.active)} ${PHASE_SHORT(G.phase)}`;
    let what = "", hint = "", buttons = [], response = [];
    if (G.over || s.state === "over") { what = "Game over" + (s.over ? ": " + s.over.replace(/^over: /, "") : ""); buttons.push(["New game", menu, "act"]); }
    else if (!d) what = busy ? "…" : top ? `${P.player(top.controller).name}: ${P.name(P.card(top.card))}` : G.active === "you" ? "Moving on…" : "Waiting for " + P.player(G.active).name + "…";
    else if (busy) what = "…";
    else {
      const k = d.kind, R = refs(), opts = k === "play" ? playOptions() : [];
      const canFloat = k === "play" && R.some(r => r?.mana);
      const passOnly = canFloat ? "You can float mana from a marked source before passing." : "Forge offers only Pass at this priority stop.";
      if (k === "mulligan") what = "Opening hand";
      else if (k === "play" && top && top.controller !== "you") {
        const who = P.player(top.controller).name, nm = P.name(P.card(top.card));
        const aimed = aimedAtMe(top).map(t => targetName(t)).filter(Boolean);
        what = aimed.length ? `${who}'s ${nm} targets ${listNames(aimed)}` : stackHeadline(top);
        hint = [opts.length ? "You can respond now." : passOnly, passEffect(top)].join(" ");
        response = opts;
        buttons = [["Pass priority", () => answer([1]), opts.length ? "" : "act"]];
        if (opts.length) buttons.unshift(responseButton(opts));
      } else if (k === "play") {
        const whose = top && (top.controller === "you" ? "Your" : P.player(top.controller).name + "'s");
        const stackTop = !top ? null : top.spell ? `${whose} ${P.name(P.card(top.card))} is on the stack`
          : `${whose} ${shortCard(P.name(P.card(top.card)))} ability is on the stack`;
        const blocking = blockers && blockers.length ? (blockers.length === 1 && blockers[0] === "you" ? "You declared blockers" : `${listNames(blockers.map(pid => P.player(pid).name))} declared blockers`) : "";
        const attacks = new Map();
        incoming.forEach(a => {
          const target = typeof a.target === "number" ? a.target : pidOf[a.target];
          const name = shortCard(P.name(G.cards[a.id]));
          attacks.set(target, (attacks.get(target) || []).concat(name));
        });
        const defense = [...attacks].map(([target, names]) => `${P.player(G.active).name} attacks ${targetName(target, true)} with ${listNames(names)}`).join(". ");
        const main = !top && G.active === "you" && ["Main phase", "Second main"].includes(G.phase);
        const handPlays = opts.some(o => G.cards[R[o - 1].card]?.zone === "hand");
        what = stackTop || defense || blocking || (main ?
          (handPlays ? "Browse the highlighted cards in your hand" : opts.length ? "Choose a play or tap a marked permanent" : canFloat ? "Tap a marked mana source to float mana" : "Forge offers no card plays at this stop") :
          "You have priority");
        if (attacking) {
          hint = `${opts.length ? "" : passOnly + " "}Passing advances toward your chance to block.`;
          response = opts;
        }
        const passLabel = top ? "Pass priority" : attacking ? "Pass toward blocks" : G.active === "you" && G.phase === "Main phase" ? "To combat" : G.active === "you" && G.phase === "Second main" ? "End turn" : "Pass";
        buttons = [[passLabel, () => answer([1]), opts.length ? "" : "act"]];
        if (opts.length) buttons.unshift(attacking ? responseButton(opts) :
          [`Choose a play (${opts.length})`, () => offer(opts, "Everything you can play", false), "act"]);
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
      if (k === "play" && autoTimer !== null && !opts.length) {
        buttons[0][2] += " auto";
        buttons.unshift(["Hold", hold]);
      }
      if (k !== "mulligan" && !(k === "play" && top && opts.length === 0)) {
        const delegate = ["Let Forge decide", auto, "ghost"];
        buttons.push(delegate);
      }
    }
    const floating = Object.entries(P.player(P.ME).manaPool || {}).filter(([, n]) => n > 0)
      .map(([color, n]) => `${n} {${color}}`).join(" ");
    const presentingMotion = !!motion && !G.over && s.state !== "over";
    if (presentingMotion) { what = motion; hint = ""; }
    if (positionLoad) {
      hint = [what, hint].filter(Boolean).join(" · ");
      what = positionLoad;
    }
    const ctx = [hint, d && !busy && !motion && !stackOpen() ? context() : "", floating ? `Floating mana: ${floating}` : ""].filter(Boolean).join(" · ");
    const choices = response.length > 1 ? `<ul class="l-responses" aria-label="Available responses">${response.map(o => `<li>${pips(d.options[o - 1])}${costOf(o)}</li>`).join("")}</ul>` : "";
    promptEl.innerHTML = `${recapHTML()}<div class="l-where">${esc(where)}</div><div class="l-what">${pips(what)}</div>${ctx ? `<div class="l-ctx">${pips(ctx)}</div>` : ""}${choices}<div class="l-buttons${response.length ? " response" : ""}"></div>`;
    promptEl.querySelector(".l-lost")?.addEventListener("click", lostSheet);
    promptEl.querySelector(".l-recap .g-close")?.addEventListener("click", () => { recapLosses = []; status(); });
    const row = promptEl.querySelector(".l-buttons");
    buttons.forEach(([t, fn, cls, html]) => {
      const b = el("button", cls || "", html || esc(t));
      if (b.classList.contains("auto")) b.style.setProperty("--auto-elapsed", autoElapsed());
      if (/off/.test(cls || "")) b.disabled = true;
      b.addEventListener("click", fn); row.appendChild(b);
    });
    promptEl.classList.toggle("moving", !!motion);
    promptEl.classList.toggle("asking", !!d && !busy && !motion);
    promptEl.classList.toggle("threat", !!d && !busy && !motion && threat());
    promptEl.hidden = !!d && d.kind === "mulligan" && !busy;
    syncHandPass();
    if (feedEl) feedEl.classList.toggle("big", G.stack.length > 0);
    stackInfo();
  }
  const PHASE_SHORT = ph => (ph || "").toLowerCase();
  const shortCard = n => n.split(", ")[0].replace(/^(\S{3,}) (?:of )?the .+$/, "$1");
  function abilityText(t, name, full) {
    const x = (t || "").replace(name + " - ", "").replace(/^[^-]+ - /, "").trim();
    return x.length > 90 && !full ? x.slice(0, 88) + "…" : x;
  }
  function effectPreview(text, rules) {
    const enters = text.match(/When (?:this creature|[^.]+) enters, draw [^.]+\./i);
    if (enters) return enters[0].replace(/^When .+ enters, (d)/i, "On entry, $1");
    const effect = effectWithCost(text, rules);
    return effect === text ? text.split(/(?<=\.)\s|\n/)[0] : effect;
  }
  function effectWithCost(text, rules) {
    if (/^create an? (X|\d+)\/\1 (?:green )?Elemental\b/i.test(text)) {
      const cost = rules?.match(/^\{X\}, Remove X \+1\/\+1 counters[^:]*:/m)?.[0];
      if (cost) return `${cost} ${text[0].toUpperCase() + text.slice(1).replace(/\.?$/, ".")}`;
    }
    if (/^Exile all creatures\. Incubate X\b/i.test(text)) return "Exile all creatures. Create one Incubator with a +1/+1 counter per creature exiled.";
    return text;
  }

  let feedEl, menuBtn, turnHeading = "", latest = [], shownLatest = [];
  const history = [], logged = new Set();
  const logKey = e => e.i + "|" + e.text;
  const logText = t => (t || "").replace(/ \[(Card|Zone Changer|Activator):[^\]]*\]/g, "").replace(/ \(\d+\)/g, "").replace(/\s+/g, " ").trim();
  function clearHistory() {
    history.length = 0; logged.clear(); losses = []; recapLosses = [];
    turnHeading = ""; latest = shownLatest = []; recentDraws = []; positionLoad = "";
    clearTimeout(loadTimer);
    cancelAnimationFrame(motionFrame);
    motionFrame = 0; motion = ""; motionUntil = 0;
    flights.clear(); draws.clear(); drawAnimations.clear(); incomingStack.clear();
    if (infoEl) { clearTimeout(stackInfo.t); infoEl.hidden = true; infoEl.classList.remove("out"); }
    feed();
  }
  function outcomes(departed, was, fresh) {
    if (!departed.length) return "";
    const before = new Map(was.players.flatMap(p => p.battlefield || []).map(c => [c.id, c]));
    const draw = fresh.map(e => logText(e.text)).find(t => /^You drew \d+ cards?\.?$/i.test(t));
    const evidence = new Map();
    fresh.forEach(e => {
      const text = logText(e.text).replace(/\.$/, "");
      const items = departed.filter(st => {
        if (e.card != null && e.card !== st.source.id) return false;
        if (e.card != null && /^STACK_RESOLVE$/i.test(e.type)) return true;
        if (st.spell) return text === st.source.name + " was countered" || st.source.name === "Sunfall" && text === "Sunfall exiled every creature";
        return false;
      });
      if (items.length === 1) evidence.set(items[0], text);
    });
    let entered = false;
    const results = departed.flatMap(st => {
      const name = st.source.name, result = evidence.get(st), card = G.cards[st.source.id];
      if (st.spell && card?.zone === "battlefield") entered = true;
      if (name === "Sunfall" && st.spell && result && !/fizzl|countered/i.test(result)) {
        const incubator = Object.values(G.cards).find(c => c.zone === "battlefield" && c.token && c.card === "Incubator" &&
          c.controller === pidOf[st.controller] && !before.has(c.id));
        if (incubator) return [`${result === "Sunfall exiled every creature" ? result : "Sunfall resolved"}. An Incubator arrived on ${incubator.controller === "you" ? "your" : whoName(incubator.controller)} page.`];
      }
      if (result) return [result + "."];
      if (st.spell && card?.zone === "battlefield") return [`${name} entered.`];
      if (st.spell && destination(card) !== "away") return [`${name} went ${destination(card)}.`];
      return [`${st.spell ? name : shortCard(name) + "'s ability"} left the stack.`];
    });
    // A combined creation log can describe more than what the departing ability created.
    const created = fresh.map(e => logText(e.text)).find(t => /\bcreated\b/i.test(t));
    if (created && !results.some(t => t.includes(created))) results.push(created.replace(/\.?$/, "."));
    if (entered && draw) results.push(draw.replace(/\.?$/, "."));
    const targets = [...new Set(departed.flatMap(st => st.targets || []))].filter(t => before.has(t));
    const changes = targets.map(id => {
      const card = G.cards[id], name = shortCard(before.get(id).name);
      if (card?.zone === "battlefield") return `${name} is on the battlefield.`;
      const where = destination(card);
      return where === "away" ? `${name} left the battlefield.` : `${name} went ${where}.`;
    });
    // When the bridge skips steps, zones can establish where cards ended up; a clear stack can't establish why.
    return [...results, ...changes].join(" ");
  }
  function recordLog(fresh, outcome) {
    const player = P.player(G.active).name, heading = `Turn ${G.turn} · ${player}`;
    fresh.forEach(e => logged.add(logKey(e)));
    const entries = fresh.filter(e => logText(e.text));
    const isTurn = e => e.type.toLowerCase() === "turn";
    const active = { type: "turn", text: heading };
    if (heading !== turnHeading) {
      const at = entries.findLastIndex(isTurn);
      if (at >= 0 && logText(entries[at].text) === `Turn ${G.turn} (${player})`) entries[at] = active;
      else entries.splice(at + 1, 0, active);
      turnHeading = heading; latest = shownLatest = [];
    }
    history.push(...entries);
    const turnStart = entries.findLastIndex(isTurn);
    const recent = entries.slice(turnStart + 1).filter(e => !isTurn(e)).reverse().map(e => logText(e.text));
    if (outcome) history.push({ type: "result", text: outcome });
    if (outcome) latest = [outcome];
    else if (recent.length) latest = [...recent, ...latest].slice(0, 3);
  }
  function feed() {
    if (!feedEl) return;
    if (!motion) shownLatest = latest;
    // An opponent's page can rise into this margin during their turn. Keep its zone labels clear.
    const events = G.active !== "you" || G.stack.length || G.combat ? shownLatest.slice(0, 1) : shownLatest;
    feedEl.innerHTML = `<span class="l-feed-turn">${esc(turnHeading)}</span>${events.length ? `<span class="l-feed-events${events.length > 1 ? " recent" : ""}">${events.map(event => `<span class="l-feed-event">${pips(event)}</span>`).join("")}</span>` : ""}`;
    feedEl.hidden = !turnHeading;
  }
  function fullLog() {
    sheet("What happened", box => {
      if (losses.length) {
        const b = el("button", "l-opt", `<b>Your losses · ${esc(lossSummary(losses))}</b>`);
        b.addEventListener("click", lostSheet);
        box.appendChild(b);
      }
      const list = el("div", "l-log");
      const groups = [];
      history.forEach(e => {
        if (e.type.toLowerCase() === "turn" || !groups.length) groups.push([]);
        groups.at(-1).push(e);
      });
      list.innerHTML = groups.reverse().flatMap(g => [g[0], ...g.slice(1).reverse()]).map(e => `<div class="t-${esc(e.type.toLowerCase())}">${pips(logText(e.text))}</div>`).join("") || "<div>Nothing yet</div>";
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
        closeSheet(); lastView = ""; known = {}; clearHistory();
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
  let lean = null, backEl, stackChipEl, autoTimer = null, autoUntil = 0, losses = [], recapLosses = [];
  H.onFocus = pid => { lean = pid ? { seat: pid, turn: G.turn } : null; backBar(); H.stackLayer = stackOpen(); queueStackInfo(); };
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
  const autoElapsed = () => Math.max(0, AUTO_PASS + performance.now() - autoUntil) + "ms";
  function resetAutoPass() { clearTimeout(autoTimer); autoTimer = null; }
  function autoContinue() {
    resetAutoPass();
    const top = G.stack[0];
    if (!d || d.kind !== "play" || !top || top.controller === "you" || threat() || playOptions().length > 0) return;
    const decision = d;
    autoUntil = performance.now() + AUTO_PASS;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (d === decision && !busy) answer([1]);
    }, AUTO_PASS);
  }
  function hold() { resetAutoPass(); status(); }
  // Whether the top of the stack is aimed at you or something of yours.
  function threat() {
    const top = G.stack[0];
    return !!top && top.controller !== "you" && aimedAtMe(top).length > 0;
  }
  const myBoard = () => new Map(Object.values(G.cards).filter(c => c.zone === "battlefield" && c.controller === "you").map(c => [c.id, c]));
  const destination = c => ({ graveyard: "to the graveyard", exile: "to exile", hand: "to hand", command: "to the command zone", library: "to the library" })[c?.zone] || "away";
  // Keep the current losses beside the decision and keep earlier ones in the log.
  function noteLosses(before, log) {
    if (!before.size || G.active === "you") return;
    const gone = [...before].filter(([id]) => G.cards[id]?.zone !== "battlefield" && !G.stack.some(st => st.card === id));
    if (gone.length) recapLosses = [];
    gone.forEach(([id, card]) => {
      const name = card.card;
      const where = destination(G.cards[id]), why = log.slice().reverse().find(e => e.card === id || logText(e.text).includes(name));
      const loss = { name, where, token: !!card.token, why: why ? logText(why.text) : "" };
      losses.push(loss); recapLosses.push(loss);
    });
    return gone.length;
  }
  function lossSummary(list) {
    const counts = {};
    list.forEach(l => {
      const where = l.where !== "away" ? l.where : l.token ? "token" : "unknown";
      counts[where] = (counts[where] || 0) + 1;
    });
    return Object.entries(counts).map(([where, n]) =>
      where === "token" ? `${n} token${n === 1 ? "" : "s"} left play` : where === "unknown" ? `${n} with unknown destination` : `${n} ${where}`).join(" · ");
  }
  const recapHTML = () => !recapLosses.length || motion ? "" : `<div class="l-recap"><button class="l-lost"><b>View your losses (${recapLosses.length})</b><small>${esc(lossSummary(recapLosses))}</small></button><button class="g-close" aria-label="Dismiss loss notice">✕</button></div>`;
  function lostSheet() {
    sheet("What you lost", box => {
      const list = el("div", "l-log");
      list.innerHTML = losses.slice().reverse().map(l => `<div><b>${esc(l.name)}</b> ${l.where === "away" ? l.token ? "(token) left play" : "left play · destination unknown" : "went " + esc(l.where)}${l.why ? `<small>${pips(l.why)}</small>` : ""}</div>`).join("");
      box.appendChild(list);
    }, { wide: true });
  }

  window.SeatPips = pips;

  // ---- The stack layer: over the table, with what each item does beside it ---------------------------------------
  let shutKey = null, infoEl, mullEl, stackFrame;
  const stackKey = () => G.stack.map(st => st.id + ":" + st.card).join(",");
  const stackOpen = () => !!snap?.view?.players?.length && G.stack.length > 0 && shutKey !== stackKey() && !lean;
  function layerChanged() { H.stackLayer = stackOpen(); redraw(380); status(); }
  function queueStackInfo() {
    if (!infoEl || stackFrame) return;
    stackFrame = requestAnimationFrame(() => { stackFrame = 0; stackInfo(); });
  }
  function stackInfo() {
    if (!infoEl) return;
    stackChip();
    const items = G.stack;
    // Closing, it fades out as the spells leave the stack on the board.
    if (!stackOpen() || !items.length) {
      if (!infoEl.hidden && !infoEl.classList.contains("out")) { infoEl.classList.add("out"); clearTimeout(stackInfo.t); stackInfo.t = setTimeout(() => { infoEl.hidden = true; infoEl.classList.remove("out"); }, 320); }
      return;
    }
    clearTimeout(stackInfo.t); infoEl.classList.remove("out");
    infoEl.hidden = false;
    // One panel: what resolves next in full, then everything under it a line each. While I'm still choosing my spell's
    // targets, it says so, and names the ones picked so far.
    const entry = (st, i) => {
      const c = P.card(st.card), f = P.face(c) || {}, nm = P.name(c);
      const who = st.controller === "you" ? "You" : P.player(st.controller).name;
      const what = st.spell ? (f.text || "") : abilityText(st.text, nm, true);
      const choosing = !i && !!d && d.kind === "targets" && st.controller === "you" && !(st.targets || []).length;
      const tg = (choosing ? sel.map(o => refs()[o - 1]).filter(Boolean).map(r => (r.player ? pidOf[r.player] : r.card)) : st.targets).map(t => targetName(t, true)).filter(Boolean);
      const aimed = st.controller !== "you" && (st.targets || []).some(t => t === "you" || (typeof t === "number" && G.cards[t] && G.cards[t].controller === "you"));
      const kind = st.spell ? esc(typeOf(f.type || "Spell").split(" — ")[0].replace(/^Legendary /, "")) : "Ability";
      const title = st.spell ? nm : shortCard(nm) + "'s ability", aim = tg.length ? `<span class="tg">→ ${esc(listNames(tg))}</span>` : "";
      if (i) return `<li class="${aimed ? "aimed" : ""}"><b>${esc(title)}</b>${aim || `<i>${esc(who)} · ${kind}</i>`}</li>`;
      return `<article class="top${aimed ? " aimed" : ""}"><header><b>${esc(title)}</b>${st.spell && f.cost ? `<span>${pips(f.cost)}</span>` : ""}</header>` +
        `<div class="by">${esc(who)} · ${kind} · ${choosing ? "choosing targets" : incomingStack.has(st.id) ? "arriving" : "resolves next"}</div>` +
        `<p>${pips(effectWithCost(what, f.text))}</p>${aim || `<span class="effect">${pips(effectPreview(what, f.text))}</span>`}` +
        `<button class="more" data-stack="${st.id}" aria-label="Read rules for ${esc(nm)}">Rules</button></article>`;
    };
    const under = items.slice(1);
    infoEl.innerHTML = `<div class="panel">${entry(items[0], 0)}${under.length ? `<ol class="rest" aria-label="Then resolves">${under.map((st, i) => entry(st, i + 1)).join("")}</ol>` : ""}` +
      `<footer>Tap the table to look past the stack</footer></div>`;   // the hint is the panel's own foot, on the same parchment
    place();
  }
  // Where the panel goes: somewhere it covers no cards and no plaques. Beside the stack card first (right, then left, level
  // with its top or its foot), then the top margin beside the log, then any open stretch of table. Each spot is scored by
  // the cards it would cover, a card being aimed at or offered and a plaque (who and their life) counting many times over,
  // my own row ruling a spot out; the emptiest wins. Where a full board leaves no room for it whole, it says only what
  // resolves next, by whom and at what (`brief`); its text is a tap away.
  function place() {
    const r = seat && seat.stackRect?.();
    if (!r || infoEl.hidden) return;
    const boxes = panelObstacles();
    infoEl.classList.remove("brief");
    if (placeAt(r, boxes, { dock: true })) return;
    infoEl.classList.add("brief");
    if (placeAt(r, boxes, { dock: true })) return;
    infoEl.classList.remove("brief");
    if (placeAt(r, boxes)) return;
    infoEl.classList.add("brief");
    if (!placeAt(r, boxes)) placeAt(r, boxes, { fallback: true });
  }
  function panelObstacles() {
    const T = seat.T;
    const boxes = [], poses = seat.poses ? seat.poses() : {};
    Object.entries(seat.pieces()).forEach(([k, pc]) => {
      const t = poses[k];
      if (!t || t.hide || pc.role === "floor") return;
      // Project the actual faces and signs at their destination, including the full width of a sideways card.
      const o = pc.obj;
      o.updateWorldMatrix(true, true);
      const local = o.matrixWorld.clone().invert(), target = new T.Matrix4().compose(t.pos, o.quaternion, new T.Vector3().setScalar(t.s || 1));
      const danger = pc.ids.some(id => H.marks?.cards[id] === "danger");
      o.traverse(m => {
        if (!m.isMesh || !m.visible || !(m === o.userData.plate || m.userData.w || m.material?.userData?.dim || danger && m.parent.userData.fxRoot)) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const { min, max } = m.geometry.boundingBox, transform = target.clone().multiply(local).multiply(m.matrixWorld);
        const points = [min.x, max.x].flatMap(x => [min.y, max.y].flatMap(y => [min.z, max.z].map(z => seat.project(new T.Vector3(x, y, z).applyMatrix4(transform)))));
        boxes.push({ left: Math.min(...points.map(p => p.x)) - 6, right: Math.max(...points.map(p => p.x)) + 6,
          top: Math.min(...points.map(p => p.y)) - 6, bottom: Math.max(...points.map(p => p.y)) + 6 });
      });
    });
    [feedEl, menuBtn, promptEl, backEl, ...document.querySelectorAll(".g-hand:not(.away) :is(.hcard, .l-hand-view)")].forEach(e => {
      if (e && !e.hidden) boxes.push(e.getBoundingClientRect());
    });
    return boxes;
  }
  function placeAt(r, boxes, { fallback = false, dock = false } = {}) {
    const w = infoEl.offsetWidth, h = infoEl.offsetHeight;
    const feedR = feedEl.getBoundingClientRect();
    const top = Math.max(70, r.top), foot = r.bottom - h;
    const mid = [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    // Keep the header and the entries beneath it on the right edge as items join the stack.
    const right = innerWidth - w - 14;
    const spots = dock ? [[right, 12], [right, innerHeight * 0.76 - h]] :
      [[r.right + 18, top], [r.left - 18 - w, top], [r.right + 18, foot], [r.left - 18 - w, foot], [feedR.right + 14, 12], [right, 12]];
    const aims = seat.aims ? seat.aims() : [], obstacles = [r, ...boxes];
    let best;
    const test = (x, y) => {
      let cover = 0;
      for (const b of obstacles) {
        const ox = Math.min(b.right, x + w) - Math.max(b.left, x), oy = Math.min(b.bottom, y + h) - Math.max(b.top, y);
        if (ox <= 0 || oy <= 0) continue;
        if (!fallback) return false;
        cover += ox * oy / ((b.right - b.left) * (b.bottom - b.top));
      }
      const arcs = aims.filter(p => p.x > x - 6 && p.x < x + w + 6 && p.y > y - 6 && p.y < y + h + 6).length;
      const n = cover * 1000 + arcs, distance = (x + w / 2 - mid[0]) ** 2 + (y + h / 2 - mid[1]) ** 2;
      if (!best || n < best.n || fallback && n === best.n && distance < best.distance) best = { x, y, n, distance };
      return n === 0;
    };
    for (const [x, y] of spots) {
      if (test(Math.round(Math.max(8, Math.min(innerWidth - w - 8, x))), Math.round(Math.max(8, Math.min(innerHeight - h - 8, y)))) && !fallback) break;
    }
    if (fallback) {
      for (let y = 8; y + h <= innerHeight - 8; y += 12) {
        for (let x = 8; x + w <= innerWidth - 8; x += 12) test(x, y);
      }
    }
    if (!best) return false;
    infoEl.style.left = best.x + "px";
    infoEl.style.top = best.y + "px";
    return true;
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
  H.overlay = ({ statusEl }) => { statusEl.hidden = true; };
  H.afterBuild = queueStackInfo;
  addEventListener("resize", queueStackInfo);

  H.ready = api => {
    seat = api;
    const body = document.body;
    const sift = seat.sift;
    seat.sift = (ids, from, title, src) => {
      if (!title || /^pile$/i.test(title)) {
        const piece = Object.values(seat.pieces()).find(pc => src ? pc.obj === src :
          pc.ids.length === ids.length && pc.ids.every((id, i) => id === ids[i]));
        if (piece) {
          src = piece.obj;
          const name = src.userData.pick?.title || P.name(G.cards[ids[0]]);
          title = `${whoName(piece.pid)} ${name.replace(new RegExp(` (?:×)?${ids.length}$`), "")}`;
        }
      }
      return sift(ids, from, title && !/^pile$/i.test(title) ? title : "Cards", src);
    };
    let siftFrame;
    const siftInScene = () => seat.scene.children.findLast(o => o.children.some(c => c.userData.pick?.sift));
    const finishSift = () => {
      if (siftInScene() || heldEl?.getAnimations().some(a => a.transitionProperty === "transform")) siftFrame = requestAnimationFrame(finishSift);
      else body.classList.remove("sift-returning");
    };
    new MutationObserver(() => {
      if (body.classList.contains("sifting")) {
        const title = document.querySelector(".proto-h .g-sifttitle");
        const hint = title?.querySelector("small"), close = title?.querySelector(".g-close");
        if (hint) hint.textContent = "Tap a card to inspect it · tap outside to put the pile back";
        if (close) { close.textContent = "Put back"; close.setAttribute("aria-label", "Put back"); }
        const shade = siftInScene()?.children.find(c => c.material?.isMeshBasicMaterial && c.material.transparent && !c.userData.pick);
        if (shade && !shade.userData.liveBacking) {
          // A second pass of the same backing follows the spread's existing fade in and out.
          shade.parent.add(shade.clone());
          shade.userData.liveBacking = true;
        }
        if (body.classList.contains("sift-returning")) {
          cancelAnimationFrame(siftFrame);
          body.classList.remove("sift-returning");
        }
      } else if (!body.classList.contains("sift-returning") && siftInScene()) {
        body.classList.add("sift-returning");
        siftFrame = requestAnimationFrame(finishSift);
      }
    }).observe(body, { attributes: true, attributeFilter: ["class"] });
    promptEl = el("div", "l-prompt"); document.body.appendChild(promptEl);
    toastEl = el("div", "l-toast"); document.body.appendChild(toastEl);
    menuBtn = el("button", "l-menu", "Game"); menuBtn.addEventListener("click", menu); document.body.appendChild(menuBtn);
    feedEl = el("button", "l-feed"); feedEl.hidden = true; feedEl.setAttribute("aria-label", "What happened"); feedEl.addEventListener("click", fullLog); document.body.appendChild(feedEl);
    infoEl = el("div", "l-stackinfo"); infoEl.hidden = true; document.body.appendChild(infoEl);
    infoEl.addEventListener("click", e => {
      const st = G.stack.find(s => String(s.id) === e.target.closest(".more")?.dataset.stack);
      if (!st) return;
      if (st.spell) seat.inspect(st.card);
      else sheet(stackName(st) + " ability", box => {
        const c = P.card(st.card), text = abilityText(st.text, stackName(st), true);
        box.appendChild(el("div", "l-rules", pips(text)));
        const rules = (P.face(c) || {}).text;
        if (rules && rules !== text) box.appendChild(el("div", "l-rules", pips(rules)));
      });
    });
    stackChipEl = el("div", "l-stackchip"); stackChipEl.hidden = true; document.body.appendChild(stackChipEl);
    backEl = el("div", "l-back"); backEl.hidden = true;
    backEl.addEventListener("click", e => { if (e.target.closest("button")) { seat.unsift(); seat.focusOn(null); } });
    document.body.appendChild(backEl);

    status();
    poll();
  };
  window.Live = { get decision() { return d; }, get sel() { return sel; }, answer, auto, take, get snap() { return snap; }, newGame,
    override: args => fetch("api/override", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args }) }).then(r => r.json()) };
})();
