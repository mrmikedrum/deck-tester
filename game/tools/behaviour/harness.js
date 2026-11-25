// Black-box harness for the game client. The seam is HTTP: /api/view is a long poll the test feeds snapshots into,
// /api/answer (and /api/new, /api/override) are recorded. Input is real touch/mouse input. The only things that look
// inside the client are in `locate` (and `boot`'s readiness checks): when debug hooks change, change those.
// BEHAVIOUR_CLIENT=new runs the same specs on the built new entry (client/dist/index.html, `npx vite build`), which is
// looked into only through its tools' surface, `window.__deckmaster`. A test the new entry cannot pass yet, because the
// lane that builds it has not landed, says so with `pending(reason)` and is skipped there, never deleted.
const { test: base, expect } = require("@playwright/test");
const path = require("path");
const { CLOCK } = require("./clock.js");
const { locate: locateOn } = require("./locate.js");
const { STATES, CARDS } = require("../shoot.js");
const { fixtureKeywords } = require("../fixture-keywords.js");

const clone = v => JSON.parse(JSON.stringify(v));
// Which client is under test: the current one (live.html) or the new entry (index.html, built).
const NEW = process.env.BEHAVIOUR_CLIENT === "new";
// Skip the calling test (or describe block) on the new entry, with the reason it cannot pass there yet.
const pending = reason => base.skip(NEW, "new entry: " + reason);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- Snapshots in the engine's real shape: { state, gen, view, decision, pilots } -----------------------------------
// The mocks in shoot.js omit decision.turn/mine/repeat; fill them. `turn` is a string (the engine's turnLabel).
function snapshot(stateName) {
  const s = clone(STATES[stateName]);
  const out = { state: "playing", gen: 1, view: s.view, decision: null, pilots: {} };
  out.decision = s.decision ? decision(out.view, s.decision) : null;
  return out;
}
function decision(view, d) {
  return Object.assign({ kind: "play", turn: "T" + view.turn + " main", prompt: "", options: [], refs: undefined, min: 1, max: 1, repeat: false, mine: view.active === "You" }, d);
}
// The fields the engine always sends and shoot.js's hand-written mocks leave out (tests/fixtures/protocol/index.json,
// "shapes"): the new entry decodes envelopes strictly, the current client ignores what it does not read. A decision's
// id is the bridge's: the same decision (game and key) keeps its id when it is sent again.
const ids = new Map();
function engineShape(body) {
  if (!("answer" in body)) body.answer = null;
  if (!("build" in body)) body.build = null;
  const v = body.view;
  if (v && v.players && v.players.length) {                // an empty view is left as the test wrote it
    if (v.me == null) v.me = v.players[0].name;
    if (v.phase == null) v.phase = "MAIN1";
    if (v.label == null) v.label = body.decision && body.decision.turn || `T${v.turn} ${v.phase.toLowerCase()}`;
    v.log = (v.log || []).map((e, i) => typeof e === "string" ? { i, type: "INFO", text: e } : Object.assign({ i, type: "INFO", text: "" }, e));
    v.stack = v.stack || [];
    for (const p of v.players) {
      for (const [k, d] of [["battlefield", []], ["command", []], ["graveyard", []], ["exile", []], ["manaPool", {}], ["library", 0], ["life", 40]]) if (p[k] == null) p[k] = clone(d);
      for (const z of ["battlefield", "command", "graveyard", "exile", "hand"]) for (const c of p[z] || []) { if (c.owner == null) c.owner = p.name; if (c.controller == null) c.controller = p.name; }
    }
    for (const it of v.stack) if (it.source) { if (it.source.controller == null) it.source.controller = it.controller; if (it.source.owner == null) it.source.owner = it.controller; }
  }
  const d = body.decision;
  // The engine asks for at most as many as it offers (ManualController: attack and block ask `0..options.size()`); the
  // mocks' `max: 99` is a shape the new entry refuses as inconsistent.
  if (d && !d.repeat && Array.isArray(d.options) && d.options.length && d.max > d.options.length) d.max = d.options.length;
  if (d && d.id == null) { const k = `${body.gen}|${keyOf(d)}`; if (!ids.has(k)) ids.set(k, ids.size + 1); d.id = ids.get(k); }
  return body;
}
// Replace a snapshot's decision (and optionally edit the view).
function withDecision(snap, d, edit) {
  const s = clone(snap);
  if (edit) edit(s.view);
  s.decision = d ? decision(s.view, d) : null;
  return s;
}
// Cards of a snapshot's view by controller name and card name.
function find(snapOrView, who, name, k = 0) {
  const view = snapOrView.view || snapOrView;
  const p = view.players.find(x => x.name === who);
  const all = [...p.battlefield, ...(p.command || []), ...(p.hand || []), ...(p.graveyard || [])];
  const c = all.filter(x => x.name === name)[k];
  if (!c) throw new Error(`no ${name} for ${who}`);
  return c;
}
// A card in my hand by name.
const inHand = (snap, name) => { const c = (snap.view || snap).players[0].hand.find(x => x.name === name); if (!c) throw new Error("no " + name + " in hand"); return c; };
// A spell of the opponent's on the stack, optionally aimed at targets (ids or player names).
function opponentSpell(view, name = "Swords to Plowshares", targets, controller = "Dack") {
  const src = clone(find({ view: STATES.threat.view }, "Dack", "Restoration Angel"));   // any card shaped right
  const f = CARDS[name].faces[0];
  Object.assign(src, { id: 777, name, type: f.type.replace(/—/g, "-"), text: f.text || "", cost: (f.cost || "").replace(/[{}]/g, " ").trim(), owner: controller, controller });
  delete src.power; delete src.toughness; delete src.tapped; delete src.keywords;
  Object.assign(src, fixtureKeywords(f));
  const item = { id: 1, source: src, controller, spell: true, text: name };
  if (targets) item.targets = targets;
  view.stack = [item];
  return item;
}

// The key the server expects (deckmaster/game.py key()). Written out again here on purpose: the test is the second
// implementation the client's keyOf must agree with.
const keyOf = d => [d.kind, d.turn, d.prompt || "", String((d.options || []).length)].concat((d.options || []).slice(0, 6)).join("|");

// The new entry takes input in its next frame (its loop drains what the handlers queued), where the current client
// answers inside the handler. So that a click is answered at the same virtual time on both, once each input event has
// been handled the frame it asked for runs at once: the virtual clock's animation frames, without advancing it.
const INPUT_FRAME = () => {
  for (const type of ["click", "pointerdown", "pointerup", "pointercancel", "keydown"])
    window.addEventListener(type, () => queueMicrotask(() => { if (window.__clock && window.__clock.frozen) window.__clock.step(0); }));
};

// ---- The table under test -------------------------------------------------------------------------------------------
class Table {
  constructor(page) {
    this.page = page; this.queue = []; this.held = null; this.v = 0; this.log = []; this.errors = [];
    this.reply = { answer: { ok: true }, new: { ok: true }, override: { ok: true } };
    this.vnow = 0; this.cards = {}; this.hold = false; this.heldAnswers = []; this.gen = 0; this.protocolErrors = [];
    page.on("pageerror", e => this.errors.push(String(e)));
  }
  async install() {
    await this.page.addInitScript(CLOCK);
    if (NEW) await this.page.addInitScript(INPUT_FRAME);
    await this.page.route("**/api/**", route => this.route(route).catch(() => {}));
  }
  async route(route) {
    const req = route.request(), u = new URL(req.url()), name = u.pathname.split("/").pop();
    if (name === "view") {
      if (this.queue.length) return route.fulfill({ json: this.queue.shift() });
      this.held = route; return;                            // the long poll waits for the next push
    }
    if (name === "cards") { const out = {}; u.searchParams.getAll("n").forEach(n => CARDS[n] && (out[n] = CARDS[n])); return route.fulfill({ json: out }); }
    if (name === "decks") return route.fulfill({ json: ["blue-moon.txt", "dack-cedh.txt"] });
    if (name === "answer" || name === "new" || name === "override") {
      let body = null; try { body = JSON.parse(req.postData() || "null"); } catch (e) { body = req.postData(); }
      const raw = body;
      // The new entry's answers carry the decision's id and the game's gen besides the key (the stronger identity of
      // docs/game-client-migration.md, phase 1): checked here, then left out so the specs compare what both clients send.
      if (NEW && name === "answer" && body && typeof body === "object") {
        const { id, gen, ...rest } = body;
        const d = this.snapshot && this.snapshot.decision;
        if (typeof id !== "number" || typeof gen !== "number") this.protocolErrors.push("answer without id and gen: " + JSON.stringify(body));
        else if (d && d.id === id && this.snapshot.gen !== gen) this.protocolErrors.push(`answer gen ${gen}, snapshot gen ${this.snapshot.gen}`);
        body = rest;
      }
      this.log.push({ endpoint: name, body, raw, at: this.vnow });
      if (this.reply[name] === null) return route.abort("failed");   // the network is down
      if (this.hold && name === "answer") { this.heldAnswers.push(route); return; }   // the request stays pending
      return route.fulfill({ json: this.reply[name] });
    }
    return route.fulfill({ status: 404, json: {} });
  }
  // The poll is held again once the client has finished handling the last snapshot.
  get idle() { return !!this.held && !this.queue.length; }
  // Hand the client a snapshot (as the next long-poll response) and wait until it has dealt with it. `animate: false`
  // leaves the virtual clock alone, for tests that measure time from the push.
  async push(snap, { animate = true, v, gen } = {}) {
    this.v = v != null ? v : this.v + 1;
    const body = Object.assign({}, clone(snap), { v: this.v, error: snap.error || null });
    if (gen != null) body.gen = gen;
    engineShape(body);
    this.snapshot = body;
    if (this.held) { const r = this.held; this.held = null; await r.fulfill({ json: body }); } else this.queue.push(body);
    await this.settle(animate);
    if (animate && this.frozen) await this.step(800);
  }
  // `mayStep`: if the client is stuck on one of its own timers (art that is slow to load is waited for up to 1,200 ms),
  // nudge the virtual clock. Tests that measure from the push forbid it.
  // The new entry takes a snapshot in its next frame, not in the fetch callback: there its animation frames run at the
  // same virtual time (step(0)) until it asks again, so even a push that may not move the clock is taken at once.
  async settle(mayStep = true) {
    // A board rebuild under software rendering can take several seconds on a loaded runner.
    const deadline = performance.now() + 30_000;
    for (let i = 0; !this.idle && performance.now() < deadline; i++) {
      await sleep(15);
      if (NEW && this.frozen) await this.catchUp();
      if (mayStep && this.frozen && i > 100 && i % 10 === 0) await this.step(100);
    }
    if (!this.idle) throw new Error("the client never asked for the next snapshot");
  }
  // On the new entry, replies that have come back (card data) are taken at the current virtual time before it moves on,
  // as the current client takes them in their fetch callbacks: frames at the same time until none is outstanding.
  async catchUp() {
    for (let i = 0; i < 100; i++) {
      const out = await this.page.evaluate(() => { window.__clock.step(0); return window.__deckmaster.outstanding().cards; });
      if (!out) return;
      await sleep(10);
    }
  }
  // Advance the virtual clock in chunks, letting the page's fetches reach the routes between chunks.
  async step(ms, chunk = 250) {
    if (NEW && this.frozen) await this.catchUp();
    for (let left = ms; left > 0; left -= chunk) {
      this.vnow = await this.page.evaluate(c => window.__clock.step(c), Math.min(chunk, left));
      await sleep(12);
    }
    return this.vnow;
  }
  async boot(snap) {
    this.queue.push(engineShape(Object.assign({}, clone(snap), { v: ++this.v, error: null })));
    await this.page.goto("/" + (process.env.BEHAVIOUR_ENTRY || (NEW ? "index.html" : "live.html")));
    const T0 = Date.now(); const lap = m => process.env.BEHAVIOUR_TIMING && console.log(m, Date.now() - T0);
    if (NEW) {                                               // the scene can draw and the first snapshot is taken
      await this.page.waitForFunction(() => window.__deckmaster, null, { timeout: 30000 });
      await this.page.evaluate(() => window.__deckmaster.ready);
      await this.page.waitForFunction(() => window.__deckmaster.seats().length > 0, null, { timeout: 30000 });
    } else await this.page.waitForFunction(() => window.__h && window.Live && window.Live.snap && window.Live.snap.view, null, { timeout: 30000 });
    lap("ready");
    await sleep(1500);                                       // real time: fonts, art, the first tweens
    await this.settle(); lap("settled");
    if (NEW) await this.page.waitForFunction(() => window.__deckmaster.settled(), null, { timeout: 30000 });
    await this.page.evaluate(() => window.__clock.freeze());
    this.frozen = true; this.snapshot = this.queue.length ? null : this.snapshot;
    await this.step(1200);
  }
  // Answer the requests held by `hold = true`.
  async release(json = { ok: true }) { const rs = this.heldAnswers.splice(0); this.hold = false; for (const r of rs) await r.fulfill({ json }).catch(() => {}); await sleep(40); await this.step(100); }
  // Between tests on a shared page: nothing pending, nothing recorded, a fresh game (a new gen resets the client).
  async reset() {
    for (const r of this.heldAnswers.splice(0)) await r.fulfill({ json: { ok: true } }).catch(() => {});
    await this.page.keyboard.press("Escape"); await this.page.keyboard.press("Escape");
    await this.step(2700, 900);                          // a toast left by the last test goes away
    this.hold = false; this.log = []; this.errors = []; this.protocolErrors = []; this.reply = { answer: { ok: true }, new: { ok: true }, override: { ok: true } };
  }
  forget() { this.log = []; }
  answers() { return this.log.filter(e => e.endpoint === "answer").map(e => e.body); }
  async lastAnswer(timeout = 3000) {
    const n = this.log.length;
    for (let t = 0; t < timeout && this.log.length === n; t += 20) await sleep(20);
    return this.answers().at(-1);
  }
  // Wait until n answers have been sent; returns all of them.
  async answered(n, timeout = 3000) {
    for (let t = 0; t < timeout && this.answers().length < n; t += 20) await sleep(20);
    return this.answers();
  }
  // Assert that nothing is sent over `ms` of virtual time.
  async quiet(ms) { const n = this.log.length; await this.step(ms, 1000); await sleep(60); expect(this.log.length).toBe(n); }

  // ---- Input: real input only ----------------------------------------------------------------------------------------
  button(name) { return this.page.getByRole("button", { name, exact: true }); }
  async press(name) { const b = this.button(name).first(); await b.waitFor({ state: "visible", timeout: 3000 }); const r = await b.boundingBox(); await this.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await sleep(30); }
  // The pass button of a play decision, whatever its label says.
  async pass() { const b = this.page.locator(".l-buttons .l-pass").first(); await b.waitFor({ state: "visible", timeout: 3000 }); const r = await b.boundingBox(); await this.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await sleep(30); }
  buttons() { return this.page.locator(".l-buttons button:visible").allInnerTexts(); }
  async tap(point) { await this.page.touchscreen.tap(point.x, point.y); await sleep(40); await this.step(100); }
  // A mouse click rather than a touch. Opening the inspector by touch can dismiss it at once (the browser's click after
  // the tap lands on the new modal's scrim when the finger was outside its box: suspected client bug), so tests that
  // only need the inspector open use this.
  async click(point) { await this.page.mouse.click(point.x, point.y); await sleep(40); await this.step(100); }
  async tapCard(id) { await this.tap(await locate(this.page, { card: id })); }
  async tapPlate(pid) { await this.tap(await locate(this.page, { plate: pid })); }
  async drag(from, to) {
    const m = this.page.mouse;
    await m.move(from.x, from.y); await m.down();
    for (let i = 1; i <= 8; i++) { await m.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8); await sleep(8); }
    await m.up(); await sleep(40); await this.step(100);
  }
  // Drag a hand card straight up by `dy` px.
  async dragHandCard(id, dy) {
    const p = await locate(this.page, { hand: id });
    const m = this.page.mouse;
    await m.move(p.x, p.y); await m.down();
    for (let i = 1; i <= 8; i++) { await m.move(p.x, p.y - dy * i / 8); await sleep(8); }
    await m.up(); await sleep(60); await this.step(100);
  }
  locateHand(id) { return locate(this.page, { hand: id }); }
  // A touch drag the browser then cancels (pointercancel), by dispatching touchCancel through the DevTools protocol.
  async cancelledTouchDrag(from, dx, dy) {
    base.skip(this.page.context().browser().browserType().name() !== "chromium", "needs the DevTools protocol's touchCancel (Chromium only)");
    const cdp = await this.page.context().newCDPSession(this.page);
    const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
    await send("touchStart", [{ x: from.x, y: from.y }]);
    for (let i = 1; i <= 8; i++) { await send("touchMove", [{ x: from.x + dx * i / 8, y: from.y + dy * i / 8 }]); await sleep(8); }
    await send("touchCancel", []);
    await sleep(60); await this.step(100);
    await cdp.detach();
  }
  toast() { return this.page.locator(".l-toast, .toast").first(); }
  async toastText() { return this.page.evaluate(() => { const e = document.querySelector(".l-toast.on, .toast.on, [class*=toast].on"); return e ? e.textContent : ""; }); }
  async sheetTitle() { return this.page.evaluate(() => { const e = document.querySelector(".l-sheet h3"); return e ? e.textContent : null; }); }
  sheet() { return this.page.locator(".l-sheet"); }
}

// ---- The one locator: where a thing is on screen (locate.js, shared with the recorder) ------------------------------
const locate = (page, what) => locateOn(page, what, NEW);

// ---- Playwright fixtures ------------------------------------------------------------------------------------------------
// Booting the client costs ~15 s (three.js, fonts, software rendering), so a worker boots it once and every test gets
// a fresh game on that page: a snapshot with a new `gen` resets the client's whole game state. `table.open(snap)` is
// that snapshot (a name from shoot.js STATES, or a snapshot object); the clock is frozen from the first boot on.
const test = base.extend({
  rig: [async ({ browser }, use) => {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1, baseURL: process.env.BEHAVIOUR_BASE });
    const page = await ctx.newPage();
    const t = new Table(page);
    await t.install();
    await t.boot(snapshot("theirs"));
    await use(t);
    await ctx.close();
  }, { scope: "worker" }],
  table: async ({ rig: t }, use) => {
    await t.reset();
    t.open = async (snap, opts) => {
      const s = typeof snap === "string" ? snapshot(snap) : clone(snap);
      s.gen = ++t.gen + 1000;
      await t.push(s, opts);
      return t;
    };
    await use(t);
    expect(t.errors, "page errors").toEqual([]);
    expect(t.protocolErrors, "answer identity").toEqual([]);
  },
});

module.exports = { test, expect, NEW, pending, engineShape, snapshot, decision, withDecision, find, inHand, opponentSpell, keyOf, locate, clone, sleep, STATES, CARDS };
