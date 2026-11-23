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
  const flights = new Set(), pendingHand = new Map(), incomingStack = new Set();
  const handBatches = new Set(), tokenBatches = new Set();
  let restoreNotice = "", handNotice = "", exileFlight = false, playChoice = null;

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
    const actors = new Map(G.stack.map(st => [st.id, st.actor]));
    G.stack.length = 0;
    view.stack.forEach(s => {
      if (!s.source) return;
      if (!G.cards[s.source.id]) G.cards[s.source.id] = conv(s.source, "stack");
      G.stack.push({ id: s.id, card: s.source.id, controller: pidOf[s.controller] || "you", text: s.text, spell: s.spell, actor: actors.get(s.id),
        targets: (s.targets || []).map(t => (typeof t === "number" ? t : pidOf[t])).filter(t => t != null), unknownController: !s.controller });
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
  async function take(s, replay = false) {
    const was = snap?.gen === s.gen && snap?.view?.players?.length ? snap.view : null;
    snap = s;
    if (!was || !s.view?.players?.length) {
      clearHistory();
      lastView = ""; known = {}; shutKey = null;
      resetHeld();
      d = dkey = null; busy = false; sel = []; holding = attackTo = null;
      resetAutoPass();
      closeSheet();
      closeMulligan();
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
    if (changedDecision) closeMulligan();
    let moving = "", tokenArrival, sweep = false, sceneBefore;
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
      if (!was || jump) G.stack.forEach(st => { st.actor = replay ? "Replay" : null; });
      const fresh = log.filter(e => !logged.has(logKey(e))).map(e => ({ ...e }));
      const rewound = jump && s.view.turn <= was.turn && (s.view.turn < was.turn || (log.at(-1)?.i ?? -1) < (tail?.i ?? -1));
      restoreNotice = rewound ? "Earlier position restored" : "";
      handNotice = "";
      if (was?.phase !== s.view.phase) recapLosses = [];
      let outcome = "";
      if (was && !jump) {
        const departed = was.stack.filter(st => st.source && !s.view.stack.some(n => n.id === st.id));
        const entered = departed.filter(st => st.spell && G.cards[st.source.id]?.zone === "battlefield");
        const gone = [...before].filter(([id]) => G.cards[id]?.zone !== "battlefield" && !G.stack.some(st => st.card === id));
        noteLosses(gone, fresh);
        const lost = gone.length;
        const damage = /^COMBAT_(FIRST_STRIKE_)?DAMAGE$/.test(s.view.phase);
        const events = fresh.map(e => logText(e.text));
        const damageEvent = damage && events.findLast(t => /\bdamage\b/i.test(t));
        tokenArrival = tokenResult(departed, was, fresh);
        outcome = outcomes(departed, was, fresh, tokenArrival);
        const attacks = attackersAtMe();
        const arrivals = trackHandArrivals(was, s.view, fresh);
        if (arrivals.length) {
          const entries = arrivals.map(id => pendingHand.get(id));
          const draw = entries.find(a => a.draw)?.draw;
          const text = handArrivalHeadline(arrivals);
          const drawIds = draw && arrivals.filter(id => pendingHand.get(id).draw === draw);
          const drawText = draw && handArrivalHeadline(drawIds);
          if (draw) draw.display = handArrivalHeadline(drawIds, false);
          handBatches.add({ viewKey, ids: arrivals, entries, draw, drawText, text });
        }
        const countered = events.find(t => /\bwas countered\b/i.test(t));
        const created = creationEvents(events).join(" ");
        const one = lost === 1 && gone[0][1];
        const where = one && destination(G.cards[one.id]);
        const loss = one ? `${one.card} ${where === "away" ? "left the battlefield" : "went " + where}` :
          lost ? `${lost} of your cards left the battlefield` : "";
        if (!outcome && !events.some(Boolean)) outcome = loss;
        const added = G.stack.filter(st => !was.stack.some(o => o.id === st.id));
        departed.forEach(st => incomingStack.delete(st.id));
        added.forEach(st => {
          incomingStack.add(st.id);
          if (replay) st.actor = "Replay";
          else if (st.controller === "you" && playChoice?.refs.some(r => r.card === st.card && (r.spell == null || r.spell === st.spell))) {
            st.actor = playChoice.label;
            playChoice = null;
          }
        });
        if (added.length) {
          moving = stackHeadline(added[0]);
        } else if (["Attackers", "Blockers"].includes(G.phase) && attacks.some(a => !was.combat?.attackers.some(o => o.id === a.id))) moving = `${s.view.active}'s attackers are moving in`;
        else if (departed.length || lost || damage && s.view.phase !== was.phase) {
          sweep = /^Sunfall exiled every creature\./i.test(outcome) || /^Sunfall resolved\./i.test(outcome) &&
            was.players.some(p => p.battlefield?.some(c => G.cards[c.id]?.zone === "exile"));
          moving = sweep ? "Sunfall resolves · creatures are going to exile" :
            entered.length && arrivals.length ? `${listNames(entered.map(st => st.source.name))} ${entered.length === 1 ? "is" : "are"} entering` :
            countered || damageEvent || tokenArrival?.moving || outcome || created || loss || "Combat damage";
        }
        if (moving) sceneBefore = new Set(seat.scene.children);
      }
      const result = recordLog(fresh, outcome, restoreNotice, tokenArrival?.log);
      if (tokenArrival) {
        result.display = tokenArrival.moving;
        tokenArrival.entry = result;
      }
      lastView = viewKey;
    }
    if (changedDecision) {
      if (nd?.kind === "play") playChoice = null;
      d = nd; dkey = nk; sel = []; holding = null; busy = false; await prepare(); autoContinue();
    }
    // Focus: my side never moves; on another player's turn their side comes toward the middle. The stack is a layer
    // over everything, open whenever something new goes on it. Leaning in on a side yourself holds until the turn moves
    // on or a new decision comes to you.
    // The leaned page covers part of the table, so whatever happens beyond it (anything on the stack, a combat, any other
    // opponent's cards or life) brings the whole table back at once; a look is a tap away again.
    const table = p => JSON.stringify(p ? [p.battlefield, p.graveyard, p.exile, p.life] : null), same = k => JSON.stringify(was[k] || null) === JSON.stringify(s.view[k] || null);
    const elsewhere = !!lean && !!was && changedView && (!same("stack") || !same("combat") ||
      s.view.players.some(p => { const pid = pidOf[p.name]; return pid !== lean.seat && pid !== P.ME && table(was.players.find(q => q.name === p.name)) !== table(p); }));
    const stackChanged = !!was && changedView && !same("stack");
    if ((stackChanged || jump || !was) && document.body.classList.contains("sifting")) {
      shutKey = null;
      seat.closeModals();
      seat.unsift();
    }
    if (lean && (jump || lean.turn !== G.turn || (changedDecision && d) || elsewhere)) { seat.unsift(); seat.setFocus(null); }
    H.soft = G.active !== "you" ? { seat: G.active } : {};
    H.stackLayer = stackOpen();
    H.handAway = !!d && d.kind === "mulligan";
    if (changedView || changedDecision) {
      if (moving) { motion = moving; exileFlight = sweep; }
      redraw(!was || jump ? 0 : changedView ? MOVE : 300);
      if (sceneBefore) {
        motionUntil = performance.now() + MOVE;
        // The board adds departing cards and staggered pile arrivals to the scene until each flight finishes.
        const added = seat.scene.children.filter(o => !sceneBefore.has(o));
        added.forEach(o => flights.add(o));
        if (tokenArrival) tokenBatches.add({ entry: tokenArrival.entry, flights: added, until: motionUntil });
      }
      if (!motionFrame && (sceneBefore || pendingHand.size || handBatches.size)) motionFrame = requestAnimationFrame(settleMotion);
      if (!was || jump) {
        const shownDecision = d;
        requestAnimationFrame(() => { if (d === shownDecision) { status(); mulligan(); } });
      }
      else { status(); mulligan(); }
    }
  }
  const keyOf = x => [x.kind, x.turn, x.prompt, (x.options || []).length].concat((x.options || []).slice(0, 6)).join("|");

  // Keep the visual cue on the play until the board and hand finish. Decisions run independently.
  function settleMotion(now) {
    const stackLanded = incomingStack.size && !document.body.classList.contains("stack-landing");
    if (stackLanded) incomingStack.clear();
    for (const o of flights) if (o.parent !== seat.scene) flights.delete(o);
    for (const [id, { animation }] of pendingHand) {
      if (animation && animation.currentTime >= animation.effect.getComputedTiming().endTime) {
        animation.effect.target.classList.remove("arriving");
        pendingHand.delete(id);
      }
    }
    let updated = stackLanded;
    for (const batch of handBatches) {
      if (batch.ids.some((id, i) => pendingHand.get(id) === batch.entries[i])) continue;
      handBatches.delete(batch);
      if (batch.draw) batch.draw.display = batch.drawText;
      if (lastView === batch.viewKey) handNotice = batch.text;
      updated = true;
    }
    for (const batch of tokenBatches) {
      if (now < batch.until || batch.flights.some(o => o.parent === seat.scene)) continue;
      delete batch.entry.display;
      tokenBatches.delete(batch);
      updated = true;
    }
    const boardMoving = incomingStack.size || flights.size || now < motionUntil;
    if (!boardMoving && motion) { motion = ""; exileFlight = false; updated = true; }
    if (updated) status();
    if (boardMoving || pendingHand.size) {
      motionFrame = requestAnimationFrame(settleMotion);
    } else motionFrame = 0;
  }

  // ---- Answering -----------------------------------------------------------------------------------------------------
  async function send(body) {
    if (busy) return;
    const decision = d;
    let choice = null;
    if (decision?.kind === "play") {
      const options = body.defer ? playOptions() : body.answer || [];
      const available = options.map(o => refs()[o - 1]).filter(r => r?.card != null && !r.mana);
      choice = available.length ? { refs: available, label: body.defer ? "Forge chose" : "Your choice" } : null;
    }
    if (choice) playChoice = choice;
    busy = true; status();
    try {
      const r = await (await fetch("api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ key: dkey }, body)) })).json();
      if (decision === d && !r.ok) { if (playChoice === choice) playChoice = null; busy = false; toast(r.error || "Forge refused that"); status(); }
    } catch (e) { if (decision === d) { if (playChoice === choice) playChoice = null; busy = false; toast("Lost the bridge"); status(); } }
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
  H.tap = (pk, hit, sifting) => {
    if (autoTimer !== null && d) hold();            // touching the table while play runs on holds it
    if (tapDecision(pk, hit)) return true;
    if (sifting) return false;
    if (pk && pk.stack && !stackOpen()) { shutKey = null; layerChanged(); return true; }     // tap the stack to bring it back
    if (pk?.type === "pile" && hit?.obj) {
      const from = hit.obj.getWorldPosition(new seat.T.Vector3());
      if (stackOpen()) { shutKey = stackKey(); layerChanged(); }
      seat.sift(pk.ids, from, null, hit.obj);
      return true;
    }
    if (stackOpen()) {
      shutKey = stackKey(); layerChanged();
      return pk?.type !== "zone";                    // a zone pile can also open in the same tap
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
  let lastHandArrivals = [], thumbing = false;
  function resetHeld() {
    cancelAnimationFrame(heldAnim);
    heldEl?.replaceChildren();
    heldIds = ""; focusId = hg = null;
    lastHandArrivals = [];
    thumbing = false;
  }
  const unit = () => Math.min(innerWidth / 1180, innerHeight / 820);
  const handIds = () => P.player("you").hand.slice();
  function heldSize() { const W = HELD.w * unit(); return { W, H: W * 680 / 488 }; }
  // The gap after the open card is a card wide when possible. Recent draws can share that space.
  function poses(ids, f) {
    const { W } = heldSize(), span = W * HELD.span, wide = W * HELD.open;
    const open = i => Math.max(0, 1 - Math.abs(i - f));               // gap i lies between card i and card i + 1
    const weights = ids.slice(0, -1).map((id, i) => Math.max(!thumbing && lastHandArrivals.includes(id) ? 1 : 0, open(i)));
    const opened = weights.reduce((a, b) => a + b, 0);
    const other = weights.length - opened;
    const shoulder = Math.min(W * 0.14, span / (weights.length || 1));
    const gap = opened <= 1 ? wide : Math.min(wide, (span - other * shoulder) / opened, Math.max(W * 0.65, (span - other * W * 0.3) / opened));
    const base = other ? Math.min(wide, (span - opened * gap) / other) : 0;
    const step = weights.map(w => base + w * (gap - base));
    const xs = [0];
    step.forEach(w => xs.push(xs.at(-1) + w));
    const mid = xs.at(-1) / 2, half = Math.max(1, mid);
    const lean = Math.max(-1, Math.min(1, fVel * 14)), dirn = fVel < 0 ? 1 : -1;
    return xs.map((x0, i) => {
      const k = (x0 - mid) / half, near = 0.4 + 0.6 * Math.exp(-Math.abs(i - f));
      const lift = Math.sin(Math.PI * Math.max(0, Math.min(1, 1 - Math.abs(i - f - 0.5) * 2)));   // the card being thumbed over
      return {
        x: x0 - mid - lean * W * 0.05 * near, y: k * k * W * 0.05 - lift * W * 0.07,
        rot: k * 4 - 1.5 - lean * 7 * near + lift * 3 * dirn, z: 10 + i, label: Math.max(0, (step[i] ?? W) - W * 0.08),
      };
    });
  }
  function drawHeld() {
    if (!heldEl) return;
    const cards = [...heldEl.children], qs = poses(cards.map(hc => +hc.dataset.id), fNow);
    cards.forEach((hc, i) => {
      if (hc.classList.contains("dragging")) return;
      const q = qs[i];
      hc.style.transform = `translate(${q.x}px, ${q.y}px) rotate(${q.rot}deg)`;
      hc.style.zIndex = q.z;
      hc.style.setProperty("--label-w", q.label + "px");
      hc.classList.toggle("open-label", q.label >= heldSize().W * 0.62);
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
    thumbing = true;
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
        const detail = [lastHandArrivals.includes(id) ? "Last added" : "", opts.length ? "Available play" : ""].filter(Boolean).join(" · ");
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
    const arriving = [...pendingHand.keys()].filter(id => ids.includes(id));
    heldEl.querySelectorAll(".hcard").forEach(hc => hc.classList.remove("playable", "unplayable"));
    if (key === heldIds) {
      drawHeld(); return heldEl;          // keep a swipe in progress
    }
    const before = new Map([...heldEl.children].map(hc => [+hc.dataset.id, hc]));
    const newCards = arriving.filter(id => !before.has(id));
    if (newCards.length) { thumbing = false; lastHandArrivals = newCards; }
    const starts = new Map();
    before.forEach((hc, id) => {
      if (!ids.includes(id)) {
        if (heldIds && G.stack.some(st => st.card === id)) castFrom(id, hc);
        if (hg?.id === id) hg = null;
        hc.remove();
      } else if (newCards.length) starts.set(id, getComputedStyle(hc).transform);
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
    if (newCards.length && !lastHandArrivals.includes(focusId)) i = ids.indexOf(lastHandArrivals[0]);
    if (i < 0) i = focusId == null ? ids.length - 1 : Math.min(ids.length - 1, Math.round(fTo));
    focusId = ids[i]; fNow = fTo = i; fVel = 0;
    drawHeld();
    starts.forEach((from, id) => {
      const hc = before.get(id);
      hc.getAnimations().find(a => a.id === "hand-settle")?.cancel();
      hc.animate([{ transform: from }, { transform: hc.style.transform }], { id: "hand-settle", duration: MOVE, easing: "ease-out" });
    });
    if (newCards.length) {
      const stagger = Math.min(100, 240 / Math.max(1, newCards.length - 1));
      newCards.forEach((id, i) => animateHandArrival(id, i * stagger, i - (newCards.length - 1) / 2));
      status();
    }
    return heldEl;
  }
  // Start the stack face at the hand's projected pose. Only its inner pose eases away, so the board keeps its flight.
  function castFrom(id, hc) {
    const ms = Math.min(240, seat.stackLanding()), r = hc.getBoundingClientRect();
    if (!ms || !r.height || !hc.offsetHeight || hc.closest(".g-hand.away")) return;
    let mesh;
    seat.scene.traverse(o => { if (o.userData.pick?.stack && o.userData.pick.id === id) mesh = o; });
    if (!mesh?.userData.cardBody) return;
    const { T, cam } = seat, body = mesh.userData.cardBody, parent = mesh.parent;
    const mat = new DOMMatrixReadOnly(getComputedStyle(hc).transform);
    const angle = Math.atan2(mat.b, mat.a), aspect = hc.offsetWidth / hc.offsetHeight;
    const height = r.height / (Math.abs(Math.cos(angle)) + aspect * Math.abs(Math.sin(angle)));
    const z = mesh.getWorldPosition(new T.Vector3()).project(cam).z;
    const screen = new T.Vector3((r.left + r.right) / innerWidth - 1, 1 - (r.top + r.bottom) / innerHeight, z);
    const from = mesh.worldToLocal(screen.clone().unproject(cam));
    const upper = mesh.worldToLocal(screen.add(new T.Vector3(0, height / innerHeight, 0)).unproject(cam));
    const geom = mesh.userData.front.geometry;
    if (!geom.boundingBox) geom.computeBoundingBox();
    const scale = 2 * upper.distanceTo(from) / (geom.boundingBox.max.y - geom.boundingBox.min.y);
    const facing = mesh.getWorldQuaternion(new T.Quaternion()).invert().multiply(cam.quaternion)
      .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -angle));
    const rest = body.quaternion.clone(), t0 = performance.now();
    const step = now => {
      const k = mesh.parent === parent && parent.parent ? Math.max(0, Math.min(1, (now - t0) / ms)) : 1;
      const q = k * k * (3 - 2 * k);
      body.position.copy(from).multiplyScalar(1 - q);
      body.quaternion.slerpQuaternions(facing, rest, q);
      body.scale.setScalar(scale + (1 - scale) * q);
      if (k < 1) requestAnimationFrame(step);
    };
    step(t0);
  }
  // Stage each arrival where it can be seen while it waits its turn, then slide it into the fan.
  function animateHandArrival(id, delay, offset) {
    const arrival = pendingHand.get(id), hc = heldEl.querySelector(`.hcard[data-id="${id}"]`);
    if (!hc?.animate) { pendingHand.delete(id); return; }
    const r = hc.getBoundingClientRect(), fan = heldEl.getBoundingClientRect();
    const centreX = r.left + r.width / 2, centreY = r.top + r.height / 2;
    const stage = arrival.from || { x: centreX, y: r.top - r.height * 0.15 };
    const x = Math.max(r.width * 0.28, Math.min(innerWidth - r.width * 0.28, stage.x + offset * r.width * 0.52));
    const y = Math.max(r.height * 0.28, Math.min(innerHeight - r.height * 0.28, stage.y));
    const dx = x - (centreX + fan.left) / 2, dy = y - (centreY + fan.top) / 2;
    const animation = hc.animate([{ translate: `${dx}px ${dy}px`, scale: "0.5" }, { translate: "0px 0px", scale: "1" }],
      { delay, duration: DRAW, fill: "backwards", easing: "cubic-bezier(.2,.7,.2,1)" });
    arrival.animation = animation;
    hc.classList.add("arriving");
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
      const ids = [...heldEl.children].map(hc => +hc.dataset.id), q = poses(ids, fNow)[ids.indexOf(hg.id)];
      if (!q) return;
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
    const from = label.match(/^(.*) \(from (graveyard|exile)\)$/);
    if (from) return `Cast ${from[1]} from ${formerZones[from[2]]}`;
    const name = label.replace(/\s*\((\w+)\)$/, "");
    if (/\(land\)$/.test(label)) return "Play " + name;
    if (/\(commander\)$/.test(label)) return `Cast ${name} from the command zone`;
    const alt = label.match(/\((\w+)\)$/);
    return alt ? `Cast ${name} (${alt[1]})` : "Cast " + name;
  }
  function responseButton(opts) {
    if (opts.length !== 1) {
      return [`Choose response (${opts.length})…`, () => offer(opts, "Choose a response"), "act l-respond"];
    }
    const o = opts[0], label = playLabel(d.options[o - 1]);
    return [label, () => answer([o]), "act", pips(label) + costOf(o)];
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
  const stackController = st => st.unknownController ? "Controller unrecorded" : P.player(st.controller).name;
  function stackHeadline(st) {
    const name = st.spell ? stackName(st) : `${shortCard(stackName(st))}'s ability`;
    return `${name} is going on the stack`;
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
      feed();
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
    const where = `Turn ${G.turn} · ${whoName(G.active)} ${String(G.phase || "").toLowerCase()}`;
    const play = d?.kind === "play" && !busy && !G.over && s.state !== "over";
    const stack = stackOpen();
    const arriving = stack && incomingStack.size > 0;
    const drawing = pendingHand.size > 0;
    let what = "", hint = "", buttons = [], response = [];
    if (G.over || s.state === "over") { what = "Game over" + (s.over ? ": " + s.over.replace(/^over: /, "") : ""); buttons.push(["New game", menu, "act"]); }
    else if (!d) what = busy ? "…" : G.active === "you" ? "Moving on…" : "Waiting for " + P.player(G.active).name + "…";
    else if (busy) what = "…";
    else {
      const k = d.kind, R = refs(), opts = k === "play" ? playOptions() : [];
      const canFloat = k === "play" && R.some(r => r?.mana);
      if (k === "mulligan") what = "Opening hand";
      else if (k === "play" && top && top.controller !== "you") {
        what = "You have priority";
        if (canFloat && !opts.length) hint = "You can float mana from a marked source.";
        response = opts;
        buttons = [["Pass priority", () => answer([1]), opts.length ? "l-pass" : "act l-pass"]];
        if (opts.length) buttons.unshift(responseButton(opts));
      } else if (k === "play") {
        const blocking = blockers && blockers.length ? (blockers.length === 1 && blockers[0] === "you" ? "You declared blockers" : `${listNames(blockers.map(pid => P.player(pid).name))} declared blockers`) : "";
        const attacks = new Map();
        incoming.forEach(a => {
          const target = typeof a.target === "number" ? a.target : pidOf[a.target];
          const name = shortCard(P.name(G.cards[a.id]));
          attacks.set(target, (attacks.get(target) || []).concat(name));
        });
        const defense = [...attacks].map(([target, names]) => `${P.player(G.active).name} attacks ${targetName(target, true)} with ${listNames(names)}`).join(". ");
        const main = !top && G.active === "you" && ["Main phase", "Second main"].includes(G.phase);
        const zones = new Set(opts.map(o => G.cards[R[o - 1].card]?.zone));
        const places = [["hand", "in your hand"], ["battlefield", "on the battlefield"], ["command", "on your commander plaque"]]
          .filter(([zone]) => zones.has(zone)).map(([, place]) => place);
        const other = [["graveyard", "the graveyard"], ["exile", "exile"]].filter(([zone]) => zones.has(zone)).map(([, place]) => place);
        const unmarked = [...zones].some(zone => !["hand", "battlefield", "command", "graveyard", "exile"].includes(zone));
        hint = [places.length && `Highlights ${listNames(places)} mark available plays.`,
          other.length && `Open Choose a play for plays from ${listNames(other)}${unmarked ? " and other unmarked options" : ""}.`,
          !other.length && unmarked && "Open Choose a play for unmarked options."].filter(Boolean).join(" ");
        what = defense || blocking || (main ?
          (opts.length ? "Available plays" : canFloat ? "Tap a marked mana source to float mana" : "You have priority") :
          "You have priority");
        if (attacking) {
          hint = "Passing advances toward your chance to block.";
          response = opts;
        }
        const passLabel = top ? "Pass priority" : attacking ? "Pass toward blocks" : G.active === "you" && G.phase === "Main phase" ? "To combat" : G.active === "you" && G.phase === "Second main" ? "End turn" : "Pass";
        buttons = [[passLabel, () => answer([1]), opts.length ? "l-pass" : "act l-pass"]];
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
        const delegate = ["Let Forge decide", auto, "ghost l-delegate"];
        buttons.push(delegate);
      }
    }
    const floating = Object.entries(P.player(P.ME).manaPool || {}).filter(([, n]) => n > 0)
      .map(([color, n]) => `${n} {${color}}`).join(" ");
    const presentingMotion = !!motion && !exileFlight && !G.over && s.state !== "over";
    const drawingAfterEntry = drawing && !G.combat && [...handBatches].some(batch => batch.viewKey === lastView && batch.entries.some(a => a.animation));
    if (arriving) what = "On the way to the stack";
    else if (drawingAfterEntry && play && !stack && !exileFlight) { what = handArrivalHeadline([...pendingHand.keys()], false); hint = ""; }
    else if (presentingMotion && !stack) { what = motion; hint = ""; }
    else if (exileFlight && play && what === "You have priority") what = "";
    else if (drawing && play && !stack) { what = handArrivalHeadline([...pendingHand.keys()], false); hint = ""; }
    const ctx = [hint, d && !busy && !motion && !stackOpen() ? context() : "", floating ? `Floating mana: ${floating}` : ""].filter(Boolean).join(" · ");
    if (top) buttons.unshift(["Stack rules", openStackRules, "ghost l-stack-rules"]);
    const choices = response.length > 1 && !arriving ? `<ul class="l-responses" aria-label="Available responses">${response.map(o => `<li>${pips(d.options[o - 1])}${costOf(o)}</li>`).join("")}</ul>` : "";
    const notice = restoreNotice || handNotice;
    promptEl.innerHTML = `<div class="l-where">${esc(where)}</div>${notice ? `<div class="l-notice">${esc(notice)}</div>` : ""}` +
      `${what ? `<div class="l-what">${pips(what)}</div>` : ""}${stack ? stackSummary() : ""}${ctx ? `<div class="l-ctx">${pips(ctx)}</div>` : ""}` +
      `${choices}${recapHTML()}<div class="l-buttons${play ? " l-play-buttons" : ""}"></div>`;
    promptEl.querySelector(".l-lost")?.addEventListener("click", lostSheet);
    promptEl.querySelector(".l-recap .g-close")?.addEventListener("click", () => { recapLosses = []; status(); });
    const row = promptEl.querySelector(".l-buttons");
    const shownDecision = d;
    buttons.forEach(([t, fn, cls, html]) => {
      const b = el("button", cls || "", html || esc(t));
      if (b.classList.contains("auto")) b.style.setProperty("--auto-elapsed", autoElapsed());
      if (b.classList.contains("off")) b.disabled = true;
      b.addEventListener("click", () => { if (d === shownDecision) fn(); }); row.appendChild(b);
    });
    promptEl.classList.toggle("play", play || stack);
    promptEl.classList.toggle("moving", arriving || drawing || presentingMotion && !stack);
    promptEl.classList.toggle("asking", !!d && !busy && !arriving && !drawing && !exileFlight && (!presentingMotion || stack));
    promptEl.classList.toggle("threat", !arriving && !busy && threat());
    promptEl.hidden = !!d && d.kind === "mulligan" && !busy;
    syncHandPass();
    feed();
  }
  const shortCard = n => n.split(", ")[0].replace(/^(\S{3,}) (?:of )?the .+$/, "$1");
  function abilityText(t, name, full) {
    const text = (t || "").trim(), prefix = name + " - ";
    const x = text.startsWith(prefix) ? text.slice(prefix.length) : text;
    return x.length > 90 && !full ? x.slice(0, 88) + "…" : x;
  }
  function effectPreview(text, rules) {
    if (/^Landfall\.?$/i.test(text) && /Create a 2\/2 white Cat(?: Beast)? creature token/.test(rules) && /Put a \+1\/\+1 counter on each creature/.test(rules)) {
      return "Landfall · Mode unrecorded";
    }
    const enters = text.match(/When (?:this creature|[^.]+) enters, draw [^.]+\./i);
    if (enters) return enters[0].replace(/^When .+ enters, (d)/i, "On entry, $1");
    const elemental = text.match(/^create an? (X|\d+)\/\1 (?:green )?Elemental\b/i);
    if (elemental) {
      const x = elemental[1].toUpperCase();
      return `Create an Elemental token · ${x}/${x}${x === "X" ? " · X unrecorded" : ""}`;
    }
    if (/^Exile all creatures\. Incubate X\b/i.test(text)) return "Exile all creatures. Create one Incubator with a +1/+1 counter per creature exiled.";
    return text.split(/(?<=\.)\s|\n/)[0];
  }

  let feedEl, menuBtn, turnHeading = "", latest = [];
  const history = [], logged = new Set();
  const logKey = e => e.i + "|" + e.text;
  const logText = t => (t || "").replace(/ \[(Card|Zone Changer|Activator):[^\]]*\]/g, "").replace(/ \(\d+\)/g, "").replace(/\s+/g, " ").trim();
  const drawReports = (events, player) => events.flatMap(entry => {
    const text = logText(entry.text);
    const who = [player, "You"].find(name => text.startsWith(name + " "));
    const count = who && text.slice(who.length + 1).match(/^drew (a|\d+) cards?\.?$/i)?.[1];
    return count ? [{ entry, count: count.toLowerCase() === "a" ? 1 : Number(count) }] : [];
  });
  const creationEvents = events => events.filter(text => /\bcreated\b/i.test(text)).map(t => t.replace(/\.?$/, "."));
  const formerZones = { battlefield: "the battlefield", graveyard: "the graveyard", exile: "exile", command: "the command zone", stack: "the stack" };
  function trackHandArrivals(was, view, events) {
    const oldHand = new Set((was.players[0].hand || []).map(c => c.id));
    const hand = (view.players[0].hand || []).map(c => c.id);
    for (const [id, arrival] of pendingHand) {
      if (!hand.includes(id)) { arrival.animation?.cancel(); pendingHand.delete(id); }
    }
    const added = hand.filter(id => !oldHand.has(id));
    if (!added.length) return added;
    const previous = new Map(was.players.flatMap(p =>
      Object.keys(formerZones).flatMap(zone => (p[zone] || []).map(c => [c.id, zone]))));
    was.stack.forEach(st => { if (st.spell && st.source && !previous.has(st.source.id)) previous.set(st.source.id, "stack"); });
    const unknown = added.filter(id => !previous.has(id));
    const draws = drawReports(events, view.players[0].name);
    const drawn = draws.reduce((total, report) => total + report.count, 0);
    const pcs = seat.pieces();
    for (const id of added) {
      const zone = previous.get(id) || (drawn > 0 && drawn === unknown.length ? "library" : null);
      const piece = zone === "library" ? pcs.zlibraryyou || pcs.plateyou :
        zone && Object.values(pcs).find(p => p.ids.includes(id));
      const stack = !piece && zone === "stack" && seat.stackAt(id);
      const from = piece ? seat.project(piece.obj.getWorldPosition(new seat.T.Vector3())) :
        stack ? { x: (stack.left + stack.right) / 2, y: (stack.top + stack.bottom) / 2 } : null;
      pendingHand.set(id, { zone, from, draw: zone === "library" && draws.length === 1 ? draws[0].entry : null });
    }
    return added;
  }
  function handArrivalHeadline(ids, named = true) {
    const byZone = new Map();
    ids.forEach(id => {
      const zone = pendingHand.get(id).zone;
      if (!byZone.has(zone)) byZone.set(zone, []);
      byZone.get(zone).push(id);
    });
    return [...byZone].map(([zone, group]) => {
      const count = group.length, quantity = count === 1 ? "a card" : `${count} cards`;
      const cards = named && count <= 3 ? listNames(group.map(id => P.name(G.cards[id]))) : quantity;
      if (zone === "library") return `${named ? "Drew" : "Drawing"} ${cards}`;
      if (zone) return `${named && count <= 3 ? cards : count === 1 ? "A card" : quantity} returned from ${formerZones[zone]} to your hand`;
      return named ? `Into your hand · ${cards}` : "Into your hand";
    }).join(" · ");
  }
  function clearHistory() {
    history.length = 0; logged.clear(); losses = []; recapLosses = [];
    turnHeading = restoreNotice = handNotice = "";
    latest = []; playChoice = null; exileFlight = false;
    cancelAnimationFrame(motionFrame);
    motionFrame = 0; motion = ""; motionUntil = 0;
    pendingHand.forEach(arrival => arrival.animation?.cancel());
    flights.clear(); pendingHand.clear(); incomingStack.clear(); handBatches.clear(); tokenBatches.clear();
  }
  function tokenResult(departed, was, fresh) {
    const log = fresh.find(e => !G.cards[e.card] && /created an Elemental and \w+ Beasts\.?$/i.test(logText(e.text)));
    if (!log || !departed.some(st => !st.spell && /create an? (?:X|\d+)\/(?:X|\d+) Elemental/i.test(st.text))) return;
    const before = new Set(was.players.flatMap(p => (p.battlefield || []).map(c => c.id)));
    const elements = Object.values(G.cards).filter(c => c.zone === "battlefield" && c.token && !before.has(c.id) && /^Elemental\b/.test(c.card));
    const { power, toughness } = elements.length === 1 ? elements[0] : {};
    if (power == null || toughness == null || before.has(log.card)) return;
    const beasts = logText(log.text).match(/created an Elemental and (\w+ Beasts)\.?$/i)[1];
    const group = `${power}/${toughness} Elemental and ${beasts}`;
    return { log, moving: `${group} arriving. Beast source unrecorded.`, landed: `${group} arrived. Beast source unrecorded.` };
  }
  function outcomes(departed, was, fresh, tokenArrival) {
    if (!departed.length) return "";
    const before = new Map(was.players.flatMap(p => p.battlefield || []).map(c => [c.id, c]));
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
    const results = departed.flatMap(st => {
      const name = st.source.name, result = evidence.get(st), card = G.cards[st.source.id];
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
    for (const created of fresh.filter(e => /\bcreated\b/i.test(logText(e.text)))) {
      let result = logText(created.text).replace(/\.?$/, ".");
      const source = G.cards[created.card] || before.get(created.card);
      if (source) result += ` Source: ${source.card || source.name}.`;
      else if (tokenArrival?.log === created) {
        result = tokenArrival.landed;
        if (departed.length === 1 && !evidence.has(departed[0])) results.length = 0;
      }
      if (!results.includes(result)) results.push(result);
    }
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
  function recordLog(fresh, outcome, load, summarized) {
    const player = P.player(G.active).name, heading = `Turn ${G.turn} · ${player}`;
    fresh.forEach(e => logged.add(logKey(e)));
    const entries = fresh.filter(e => logText(e.text));
    const isTurn = e => e.type.toLowerCase() === "turn";
    const active = { type: "turn", text: heading };
    if (heading !== turnHeading) {
      const at = entries.findLastIndex(isTurn);
      if (at >= 0 && logText(entries[at].text) === `Turn ${G.turn} (${player})`) entries[at] = active;
      else entries.splice(at + 1, 0, active);
      turnHeading = heading; latest = [];
    }
    history.push(...entries);
    if (load) history.push({ type: "result", text: load });
    const turnStart = entries.findLastIndex(isTurn);
    const recent = entries.slice(turnStart + 1).filter(e => !isTurn(e) && e !== summarized).reverse();
    const result = outcome && { type: "result", text: outcome };
    if (result) history.push(result);
    latest = (result ? [result, ...recent.filter(e => !outcome.startsWith(logText(e.text)))] : recent).concat(latest);
    return result;
  }
  function feed() {
    if (!feedEl) return;
    const visibleStack = stackOpen() && !promptEl.hidden && !document.body.classList.contains("sifting");
    const duplicate = entry => visibleStack && G.stack.some(st => {
      if (!st.spell) return false;
      const text = logText(entry.text), name = stackName(st), controller = stackController(st);
      return [controller, st.controller === P.ME ? "You" : controller].some(who => {
        const cast = `${who} cast ${name}`;
        return text === cast || text === cast + "." || text.startsWith(cast + " targeting ");
      });
    });
    // An opponent's page can rise into this margin, leaving room for one event.
    const events = exileFlight ? [motion] : latest.filter(e => !duplicate(e)).slice(0, G.active !== "you" || G.combat ? 1 : 3)
      .map(e => e.display || logText(e.text));
    const draw = events.findIndex(t => /^(?:You drew|Drew)\b/i.test(t) || t.startsWith(P.player(P.ME).name + " drew "));
    feedEl.classList.toggle("l-exile-event", exileFlight);
    feedEl.innerHTML = `<span class="l-feed-turn">${esc(turnHeading)}</span>${events.length ? `<span class="l-feed-events${events.length > 1 ? " recent" : ""}">${events.map((event, i) => `<span class="l-feed-event${i === draw ? " l-feed-draw" : ""}">${pips(event)}</span>`).join("")}</span>` : ""}`;
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
      list.innerHTML = groups.reverse().flatMap(g => [g[0], ...g.slice(1).reverse()]).map(e => `<div class="t-${esc(e.type.toLowerCase())}">${pips(e.display || logText(e.text))}</div>`).join("") || "<div>Nothing yet</div>";
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
  H.onFocus = pid => { lean = pid ? { seat: pid, turn: G.turn } : null; backBar(); H.stackLayer = stackOpen(); requestAnimationFrame(status); };
  function backBar() {
    if (!backEl) return;
    const returning = document.body.classList.contains("sift-returning");
    const side = lean ? `${P.player(lean.seat).name}'s side` : "the table";
    backEl.hidden = !lean && !returning;
    backEl.innerHTML = `<span>${esc(returning ? `Returning to ${side}` : side)}</span>${lean ? "<button>Back to the table</button>" : ""}`;
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
  function noteLosses(gone, log) {
    if (!gone.length || G.active === "you") return;
    recapLosses = [];
    gone.forEach(([id, card]) => {
      const name = card.card;
      const where = destination(G.cards[id]), why = log.slice().reverse().find(e => e.card === id || logText(e.text).includes(name));
      const loss = { name, where, token: !!card.token, why: why ? logText(why.text) : "" };
      losses.push(loss); recapLosses.push(loss);
    });
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
  function recapHTML() {
    if (!recapLosses.length || motion) return "";
    const one = recapLosses.length === 1 && recapLosses[0];
    const title = one ? one.name : `View your losses (${recapLosses.length})`;
    const summary = one ? one.where === "away" ? one.token ? "Token left play" : "Destination unknown" : one.where : lossSummary(recapLosses);
    return `<div class="l-recap"><button class="l-lost"${one ? ` aria-label="${esc(`${title}, ${summary}. View your losses`)}"` : ""}><b>${esc(title)}</b><small>${esc(summary)}</small></button><button class="g-close" aria-label="Dismiss loss notice">✕</button></div>`;
  }
  function lostSheet() {
    sheet("What you lost", box => {
      const list = el("div", "l-log");
      list.innerHTML = losses.slice().reverse().map(l => `<div><b>${esc(l.name)}</b> ${l.where === "away" ? l.token ? "(token) left play" : "left play · destination unknown" : "went " + esc(l.where)}${l.why ? `<small>${pips(l.why)}</small>` : ""}</div>`).join("");
      box.appendChild(list);
    }, { wide: true });
  }

  window.SeatPips = pips;

  // ---- The stack layer: the effects and decision share the same margin --------------------------------------------
  let shutKey = null, mullEl;
  const stackKey = () => G.stack.map(st => st.id + ":" + st.card).join(",");
  const stackOpen = () => !!snap?.view?.players?.length && G.stack.length > 0 && shutKey !== stackKey() && !lean;
  function layerChanged() { H.stackLayer = stackOpen(); redraw(380); status(); }
  function openStackRules() {
    const items = G.stack.slice();
    if (!items.length) return;
    if (items.length === 1 && items[0].spell) return seat.inspect(items[0].card);
    sheet("Stack rules · first to last", box => {
      items.forEach(st => {
        const name = stackName(st), rules = P.face(P.card(st.card))?.text || "";
        const effect = st.spell ? "" : abilityText(st.text, name, true);
        const row = el("section", "l-rules", `<b>${esc(name + " · " + stackController(st))}</b>`);
        if (effect) {
          row.appendChild(el("div", "", pips(effect)));
          const preview = effectPreview(effect, rules);
          const unknown = preview.match(/(?:X|Mode) unrecorded$/)?.[0];
          if (unknown) row.appendChild(el("small", "", esc(unknown)));
        }
        if (rules && rules !== effect) row.appendChild(el("div", "", pips(rules)));
        box.appendChild(row);
      });
    });
  }
  function stackSummary() {
    const rows = G.stack.map((st, i) => {
      const name = stackName(st), title = st.spell ? name : shortCard(name) + "'s ability";
      const who = [stackController(st), st.actor].filter(Boolean).join(" · ");
      const rules = P.face(P.card(st.card))?.text || "";
      const text = st.spell ? rules || st.text || "" : abilityText(st.text, name, true);
      const choosing = !i && d?.kind === "targets" && st.controller === "you" && !st.targets.length;
      const targets = choosing ? sel.map(o => refs()[o - 1]).filter(Boolean).map(r => r.player ? pidOf[r.player] : r.card) : st.targets;
      const aim = targets.map(t => targetName(t, true) || "unrecorded target");
      const threatened = st.controller !== "you" && aimedAtMe(st).length > 0;
      let effect = effectPreview(text, rules);
      if (aim.length === 1 && /^Exile target creature\. Its controller gains life equal to its power\./i.test(text)) {
        effect = `Exile ${aim[0]}. Its controller gains life equal to its power.`;
      } else if (aim.length === 1 && /^Counter target spell\./i.test(text)) {
        const consequences = text.slice("Counter target spell.".length).trim();
        const drawAtUpkeep = /^Its controller may draw up to two cards at the beginning of the next turn['’]s upkeep\.\s+You draw a card at the beginning of the next turn['’]s upkeep\.$/i;
        effect = [`Counter ${aim[0]}.`, drawAtUpkeep.test(consequences) ? "Next upkeep its controller may draw up to two. You draw one." : consequences].filter(Boolean).join(" ");
      }
      else if (aim.length) effect = `Aimed at ${listNames(aim)}. ${effect}`.trim();
      else if (choosing) effect = "Choosing targets";
      return `<li><b>${esc(title)}</b> <span>· ${esc(who)}</span>${effect ? `<div class="${threatened ? "aimed" : ""}">${pips(effect)}</div>` : ""}</li>`;
    });
    return `<ol class="l-stackinfo" aria-label="Stack in resolution order">${rows.join("")}</ol>`;
  }
  // Mulligans: the hand comes to the middle of the screen, over a dimmed table.
  function closeMulligan() { mullEl?.remove(); mullEl = null; }
  function mulligan() {
    if (d?.kind !== "mulligan" || busy) { closeMulligan(); return; }
    const decision = d, ids = P.player("you").hand.slice();
    if (!mullEl) { mullEl = el("div", "l-mull"); document.body.appendChild(mullEl); }
    mullEl.innerHTML = `<div class="l-mullbox"><h2>${esc(d.prompt.replace(/^keep this hand\??/i, "Keep this hand?"))}</h2><div class="cards"></div><div class="l-buttons"></div></div>`;
    const row = mullEl.querySelector(".cards");
    ids.forEach(id => {
      const b = el("button", "pic"); b.style.backgroundImage = `url("${P.image(G.cards[id])}")`; b.setAttribute("aria-label", P.name(G.cards[id]));
      b.addEventListener("click", () => seat.inspect(id)); row.appendChild(b);
    });
    const bs = mullEl.querySelector(".l-buttons");
    const overlay = mullEl;
    [["Mulligan", 2], ["Keep " + ids.length, 1, "act"]].forEach(([t, option, cls]) => {
      const b = el("button", cls || "", esc(t));
      b.addEventListener("click", () => { if (mullEl === overlay && d === decision) answer([option]); });
      bs.appendChild(b);
    });
  }

  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text; toastEl.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove("on"), 2600);
  }
  const newGame = menu;
  H.overlay = ({ statusEl }) => { statusEl.hidden = true; };

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
    let siftFrame, siftBackdrop;
    const siftInScene = () => seat.scene.children.findLast(o => o.children.some(c => c.userData.pick?.sift));
    const layerSift = group => {
      const shade = group?.children.find(o => o.isMesh);
      if (!shade || shade === siftBackdrop) return;
      if (siftBackdrop) siftBackdrop.visible = false;
      siftBackdrop = shade;
      // Composite one shade over the board, then give the moving cards their own depth buffer.
      group.renderOrder = 30;
      shade.material.depthFunc = seat.T.AlwaysDepth;
      shade.material.depthWrite = true;
      shade.material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace("#include <alphamap_fragment>",
          "#include <alphamap_fragment>\ndiffuseColor.a = 1.0 - (1.0 - diffuseColor.a) * (1.0 - diffuseColor.a);");
      };
      shade.onAfterRender = renderer => renderer.clearDepth();
      const shared = new Map(), materials = new Set([shade.material]);
      const overShade = mat => {
        if (!mat.userData.tap) {
          if (!shared.has(mat)) shared.set(mat, mat.clone());
          mat = shared.get(mat);
        }
        mat.transparent = true;
        mat.needsUpdate = true;
        materials.add(mat);
        return mat;
      };
      group.children.filter(o => o.userData.pick?.sift).forEach(card => card.traverse(mesh => {
        if (mesh.isGroup) mesh.renderOrder = group.renderOrder;
        if (!mesh.isMesh) return;
        mesh.renderOrder = shade.renderOrder + 1;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(overShade) : overShade(mesh.material);
      }));
      group.addEventListener("removed", () => {
        if (siftBackdrop === shade) siftBackdrop = null;
        shade.geometry.dispose();
        materials.forEach(mat => mat.dispose());
      });
    };
    const finishSift = () => {
      if (siftInScene() || heldEl?.getAnimations().some(a => a.transitionProperty === "transform")) siftFrame = requestAnimationFrame(finishSift);
      else { body.classList.remove("sift-returning"); backBar(); }
    };
    new MutationObserver(() => {
      if (body.classList.contains("sifting")) {
        layerSift(siftInScene());
        const title = document.querySelector(".proto-h .g-sifttitle");
        const hint = title?.querySelector("small"), close = title?.querySelector(".g-close");
        const dest = lean ? `${P.player(lean.seat).name}'s side` : "the table";
        if (hint) hint.textContent = `Tap a card to inspect it · tap outside to put the pile back on ${dest}`;
        if (close) {
          close.textContent = "✕ Put back";
          close.setAttribute("aria-label", `Put the pile back on ${dest}`);
        }
        if (body.classList.contains("sift-returning")) {
          cancelAnimationFrame(siftFrame);
          body.classList.remove("sift-returning");
          backBar();
        }
      } else if (!body.classList.contains("sift-returning") && siftInScene()) {
        body.classList.add("sift-returning");
        backBar();
        siftFrame = requestAnimationFrame(finishSift);
      }
    }).observe(body, { attributes: true, attributeFilter: ["class"] });
    promptEl = el("div", "l-prompt"); document.body.appendChild(promptEl);
    toastEl = el("div", "l-toast"); document.body.appendChild(toastEl);
    menuBtn = el("button", "l-menu", "Game"); menuBtn.addEventListener("click", menu); document.body.appendChild(menuBtn);
    feedEl = el("button", "l-feed"); feedEl.hidden = true; feedEl.setAttribute("aria-label", "What happened"); feedEl.addEventListener("click", fullLog); document.body.appendChild(feedEl);
    stackChipEl = el("div", "l-stackchip"); stackChipEl.hidden = true; document.body.appendChild(stackChipEl);
    backEl = el("div", "l-back"); backEl.hidden = true;
    backEl.addEventListener("click", e => { if (e.target.closest("button")) { seat.unsift(); seat.focusOn(null); } });
    document.body.appendChild(backEl);

    status();
    poll();
  };
  window.Live = { get decision() { return d; }, get sel() { return sel; }, answer, auto, take: s => take(s, true), get snap() { return snap; }, newGame,
    override: args => fetch("api/override", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args }) }).then(r => r.json()) };
})();
