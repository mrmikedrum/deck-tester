// Screenshots of Seat for the look: offline scenarios plus a mocked bridge for the live prompt, sheets and marks.
//   node tools/shoot.js <outdir> [webkit|chromium] [only,names]
// Serve client/ on :8797 first (python3 -m http.server 8797).
const path = require("path");
const pw = require(process.env.PW || "playwright");
global.window = {}; require(path.join(__dirname, "../client/data.js")); const CARDS = window.CARDS;
const BASE = process.env.BASE || "http://localhost:8797/";
const [outDir = "shots/after", eng = "webkit", onlyArg] = process.argv.slice(2);
const only = onlyArg ? new Set(onlyArg.split(",")) : null;

// ---- A mocked engine view --------------------------------------------------------------------------------------
const NAMES = ["You", "Marath", "Atraxa", "Dack"];
function board() {
  let id = 100;
  const mk = (name, o = {}) => {
    const f = CARDS[name].faces[0], c = { id: id++, name, type: f.type.replace(/—/g, "-"), text: f.text || "", cost: (f.cost || "").replace(/[{}]/g, " ").trim() };
    if (/Creature/.test(f.type)) { c.power = +f.power || 0; c.toughness = +f.toughness || 0; }
    if (/^Token/.test(f.type)) c.token = true;
    if (o.p1) { c.counters = { "+1/+1": o.p1 }; c.power += o.p1; c.toughness += o.p1; }
    return Object.assign(c, o.tapped ? { tapped: true } : {}, o.commander ? { commander: true } : {});
  };
  const many = (name, n, o) => Array.from({ length: n }, (_, i) => mk(name, typeof o === "function" ? o(i) : o));
  const P = {
    You: { life: 31, library: 71, cmd: [mk("Princess Yue", { commander: true })],
      bf: [mk("Meloku the Clouded Mirror"), mk("Master of Waves"), mk("Faerie Mastermind"), mk("Mulldrifter", { tapped: true }), mk("Whirler Rogue"),
        mk("Springleaf Drum"), mk("Imprisoned in the Moon"), ...many("Island", 6, i => ({ tapped: i < 3 })), mk("Mystic Sanctuary"), mk("Otawara, Soaring City"), mk("Sol Ring", { tapped: true }), mk("Arcane Signet")],
      hand: [mk("Island"), mk("Snap"), mk("Arcane Denial"), mk("Frantic Search"), mk("Ghostly Flicker"), mk("Phantasmal Image"), mk("Reality Shift")],
      gy: [mk("Unwind"), mk("Mulldrifter")] },
    Marath: { life: 27, library: 66, cmd: [],
      bf: [mk("Marath, Will of the Wild", { commander: true, p1: 4 }), mk("Herd Baloth"), mk("Evolution Sage", { tapped: true }), mk("Beast"), mk("Beast"), mk("Felidar Retreat"),
        ...many("Forest", 4), mk("Temple Garden"), mk("Command Tower"), mk("Sol Ring")], handCount: 4, gy: [mk("Farseek")] },
    Atraxa: { life: 36, library: 70, cmd: [],
      bf: [mk("Atraxa, Praetors' Voice", { commander: true }), mk("Glissa, Herald of Predation"), mk("Steel Overseer", { p1: 2 }), mk("Throne of Geth"),
        mk("Swamp"), mk("Breeding Pool"), mk("Overgrown Tomb"), mk("Watery Grave", { tapped: true })], handCount: 5, gy: [] },
    Dack: { life: 40, library: 74, cmd: [mk("Dack Fayden, Helping Hand", { commander: true })],
      bf: [mk("Restoration Angel"), mk("Fiend Hunter"), mk("Felidar Guardian"), mk("Rule of Law"), mk("Smothering Tithe"), mk("Treasure"), mk("Treasure"),
        ...many("Plains", 3), mk("Ancient Tomb")], handCount: 3, gy: [] },
  };
  NAMES.forEach(n => ["bf", "cmd", "hand", "gy"].forEach(z => (P[n][z] || []).forEach(c => (c.owner = c.controller = n))));
  const players = NAMES.map(n => ({ name: n, life: P[n].life, library: P[n].library, battlefield: P[n].bf, command: P[n].cmd, graveyard: P[n].gy, exile: [],
    hand: n === "You" ? P[n].hand : undefined, handCount: P[n].handCount }));
  const find = (who, name, k = 0) => [...P[who].bf, ...P[who].cmd, ...(P[who].hand || [])].filter(c => c.name === name)[k];
  const log = ["Turn 9 (You)", "You drew Reality Shift", "Marath cast Herd Baloth", "Atraxa put a +1/+1 counter on Steel Overseer"].map((text, i) => ({ i, text, type: i ? "Info" : "Turn" }));
  return { players, find, mk, log };
}
function snapshot(over) {
  const b = board();
  const view = { players: b.players, stack: [], combat: null, turn: 9, active: "You", priority: "You", phase: "MAIN1", log: b.log };
  const s = { v: 1, state: "playing", view, decision: null };
  over(s, b);
  return s;
}
const STATES = {
  // My main phase: plays light up (cards in hand, abilities on the board, the commander on my plate).
  main: snapshot((s, b) => {
    const R = [{}, { card: b.find("You", "Island").id }, { card: b.find("You", "Frantic Search").id }, { card: b.find("You", "Phantasmal Image").id },
      { card: b.find("You", "Meloku the Clouded Mirror").id }, { card: b.find("You", "Whirler Rogue").id }, { card: b.find("You", "Princess Yue").id }];
    s.decision = { kind: "play", prompt: "", options: ["Pass", "Island (land)", "Frantic Search", "Phantasmal Image", "Meloku the Clouded Mirror: {1}, Return a land you control to its owner's hand: Create a 1/1 blue Illusion", "Whirler Rogue: Tap two untapped artifacts you control: Target creature can't be blocked this turn.", "Princess Yue (commander)"], refs: R, min: 1, max: 1 };
  }),
  // Attacking: two picked, aimed at Marath; the rest can still join.
  attack: snapshot((s, b) => {
    s.view.phase = "COMBAT_DECLARE_ATTACKERS";
    const cs = ["Meloku the Clouded Mirror", "Master of Waves", "Faerie Mastermind", "Whirler Rogue"].map(n => b.find("You", n).id);
    const R = []; cs.forEach(c => ["Marath", "Atraxa", "Dack"].forEach(to => R.push({ card: c, to })));
    s.decision = { kind: "attack", prompt: "Declare attackers", options: R.map(r => "attack"), refs: R, min: 0, max: 99 };
    s.after = cs.slice(0, 2).map(id => ({ type: "card", id }));
  }),
  // Blocking: Marath's side attacks me; I hold Meloku, so the attackers it can block glow red.
  block: snapshot((s, b) => {
    s.view.active = "Marath"; s.view.phase = "COMBAT_DECLARE_BLOCKERS";
    const atk = [b.find("Marath", "Marath, Will of the Wild"), b.find("Marath", "Herd Baloth"), b.find("Marath", "Beast", 0)];
    atk.forEach(c => (c.tapped = true));
    s.view.combat = { attackers: atk.map(c => ({ id: c.id, defender: "You" })), blockers: [] };
    const mine = ["Meloku the Clouded Mirror", "Master of Waves", "Faerie Mastermind"].map(n => b.find("You", n).id);
    const R = []; mine.forEach(m => atk.forEach(a => R.push({ card: m, blocks: a.id })));
    s.decision = { kind: "block", prompt: "Declare blockers", options: R.map(() => "block"), refs: R, min: 0, max: 99 };
    s.after = [{ type: "card", id: mine[1] }, { type: "card", id: atk[2].id }, { type: "card", id: mine[0] }];
  }),
  // A threat: Dack's Swords to Plowshares targets my Meloku. The stack takes focus; the target glows red.
  threat: snapshot((s, b) => {
    s.view.active = "Dack"; s.view.phase = "MAIN1";
    const meloku = b.find("You", "Meloku the Clouded Mirror"), stp = b.mk("Swords to Plowshares");
    const abil = b.find("Marath", "Felidar Retreat");
    s.view.stack = [{ id: 1, source: stp, controller: "Dack", spell: true, text: "Swords to Plowshares", targets: [meloku.id] },
      { id: 2, source: abil, controller: "Marath", spell: false, text: "Felidar Retreat - Landfall", targets: [] }];
    s.view.log.push({ i: 9, text: "Dack cast Swords to Plowshares targeting Meloku the Clouded Mirror", type: "Stack" });
    s.decision = { kind: "play", prompt: "", options: ["Pass", "Snap", "Arcane Denial"], refs: [{}, { card: b.find("You", "Snap").id }, { card: b.find("You", "Arcane Denial").id }], min: 1, max: 1 };
  }),
  // Their turn, nothing for me to do: Atraxa's side is the soft focus.
  theirs: snapshot((s, b) => { s.view.active = "Atraxa"; s.view.priority = "Atraxa"; s.view.phase = "MAIN1"; }),
  // Targets on the board: choose the one creature for my Reality Shift, picked and waiting on Done (min 0, so the pick shows its arc rather than answering at once).
  target: snapshot((s, b) => {
    const opts = [b.find("Marath", "Herd Baloth"), b.find("Atraxa", "Glissa, Herald of Predation"), b.find("Dack", "Restoration Angel"), b.find("Atraxa", "Steel Overseer"), b.find("Marath", "Marath, Will of the Wild")];
    s.view.stack = [{ id: 3, source: b.find("You", "Reality Shift"), controller: "You", spell: true, text: "Reality Shift", targets: [] }];
    s.decision = { kind: "targets", prompt: "target for Reality Shift (Reality Shift)", options: opts.map(c => c.name), refs: opts.map(c => ({ card: c.id })).concat([{ player: "Dack" }]), min: 0, max: 1 };
    s.decision.options.push("Dack");
    s.after = [{ type: "card", id: opts[1].id }];
  }),
  // Motion: Snap cast from my hand onto the stack, then resolving. reel.js plays the steps.
  cast: snapshot((s, b) => {
    const snap = b.find("You", "Snap"), target = b.find("Marath", "Herd Baloth");
    s.decision = { kind: "play", prompt: "", options: ["Pass", "Snap"], refs: [{}, { card: snap.id }], min: 1, max: 1 };
    const v2 = JSON.parse(JSON.stringify(s.view)); v2.players[0].hand = v2.players[0].hand.filter(c => c.id !== snap.id);
    v2.stack = [{ id: 9, source: snap, controller: "You", spell: true, text: "Snap", targets: [target.id] }];
    const v3 = JSON.parse(JSON.stringify(v2)); v3.stack = []; v3.players[0].graveyard.push(snap); v3.players[1].battlefield = v3.players[1].battlefield.filter(c => c.id !== target.id);
    s.steps = [{ v: 2, view: v2, decision: { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 } }, { v: 3, view: v3, decision: { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 } }];
  }),
  // A sheet: cards from the library to choose from.
  sheet: snapshot((s, b) => {
    const names = ["Island", "Mystic Sanctuary", "Otawara, Soaring City", "Minamo, School at Water's Edge", "Seat of the Synod", "Nykthos, Shrine to Nyx", "Vesuva", "Thespian's Stage"];
    s.decision = { kind: "choose", prompt: "Choose up to two land cards (Ghostly Flicker)", options: names, refs: names.map(n => ({ name: n })), min: 0, max: 2 };
    s.sheetPick = 2;
  }),
};

module.exports = { STATES, CARDS, BASE };
if (require.main === module) (async () => {
  const fs = require("fs"); fs.mkdirSync(outDir, { recursive: true });
  const browser = await pw[eng].launch(eng === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
  const errors = [];
  const watch = page => { page.on("pageerror", e => errors.push(String(e))); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); }); };
  const want = k => !only || only.has(k);

  // Offline scenarios
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE + "offline.html");
  await page.waitForFunction(() => window.__h, null, { timeout: 30000 });
  const snap = async (name, fn, wait = 1300) => { if (!want(name)) return; if (fn) await page.evaluate(fn); await page.waitForTimeout(wait); await page.screenshot({ path: `${outDir}/${name}.png` }); };
  for (const k of ["early", "mid", "attack", "defend", "late"]) await snap("h-" + k, `__h.loadScenario("${k}")`, 1000);
  await snap("h-focus-ana", '__h.loadScenario("late"); __h.focusOn("ana")', 1200);
  await page.close();

  // Live, against the mock
  for (const [name, s] of Object.entries(STATES)) {
    if (!want("live-" + name)) continue;
    const p = await ctx.newPage(); watch(p);
    await p.route("**/api/**", async route => {
      const u = new URL(route.request().url());
      if (u.pathname.endsWith("/api/view")) {
        if (u.searchParams.get("v") === "0") return route.fulfill({ json: { v: s.v, state: s.state, view: s.view, decision: s.decision } });
        return; // hold the long poll open
      }
      if (u.pathname.endsWith("/api/cards")) { const out = {}; u.searchParams.getAll("n").forEach(n => CARDS[n] && (out[n] = CARDS[n])); return route.fulfill({ json: out }); }
      if (u.pathname.endsWith("/api/decks")) return route.fulfill({ json: ["blue-moon.txt", "dack-cedh.txt"] });
      return route.fulfill({ json: { ok: true } });
    });
    await p.goto(BASE + "live.html");
    await p.waitForFunction(() => window.__h && window.Live && window.Live.snap && window.Live.snap.view, null, { timeout: 30000 });
    await p.waitForTimeout(1200);
    for (const pk of s.after || []) { await p.evaluate(pk => window.SeatHooks.tap(pk), pk); await p.waitForTimeout(450); }
    if (s.sheetPick) for (let i = 0; i < s.sheetPick; i++) { await p.click(`.l-sheet .l-card >> nth=${i * 2 + 1}`); await p.waitForTimeout(200); }
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${outDir}/live-${name}.png` });
    if (name === "main" && want("live-main-plays")) { await p.click(".l-buttons button:nth-child(2)"); await p.waitForTimeout(500); await p.screenshot({ path: `${outDir}/live-main-plays.png` }); }
    if (name === "main" && want("live-main-focus")) { await p.evaluate(() => document.querySelector(".l-sheet") && document.querySelector(".l-sheet").remove()); await p.evaluate(() => __h.focusOn("cy")); await p.waitForTimeout(1200); await p.screenshot({ path: `${outDir}/live-main-focus.png` }); }
    if (name === "main") {
      const extra = async (shot, fn, wait = 900) => { if (!want(shot)) return; await p.evaluate(fn); await p.waitForTimeout(wait); await p.screenshot({ path: `${outDir}/${shot}.png` }); };
      const clean = () => { document.querySelectorAll(".l-sheet, .scrim, .g-modal").forEach(e => e.remove()); __h.unsift(); __h.focusOn(null); };
      await extra("live-inspect", `(${clean})(); SeatHooks.tap({ type: "card", id: Object.values(Proto.G.cards).find(c => c.card === "Meloku the Clouded Mirror").id })`);
      await extra("live-profile", `(${clean})(); __h.profile(Proto.player("cy"))`);
      await extra("live-sift", `(${clean})(); const pc = Object.values(__h.pieces()).find(x => x.ids.length > 1 && x.pid === "you"); __h.sift(pc.ids, pc.obj.getWorldPosition(new __h.T.Vector3()), "Island")`, 1200);
    }
    await p.close();
  }
  console.log(errors.length ? "errors: " + [...new Set(errors)].join(" | ") : "no errors");
  await browser.close();
})();
