// Parity of the new pure layout (client/src/layout) with the old three.js client: loads the OLD offline.html on its
// fixture scenarios, reads each piece's face box at rest (__h.cardBoxes), plans the same boards with the new planTable,
// and reports per-card screen-position differences in px.
//   node tools/layout-parity.js [--viewport 1180x820] [--scenarios early,mid,late,attack,defend] [--verbose]
const path = require("path");
const pw = require("playwright");
const { serve } = require("./serve.js");

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const [W, H] = arg("viewport", "1180x820").split("x").map(Number);
const SCENARIOS = arg("scenarios", "early,mid,late,attack,defend").split(",");
const VERBOSE = process.argv.includes("--verbose");

// Runs in the old page: the old client's own predicates (common.js, h.js buildBoard) turned into the booleans the model
// will compute for layout, plus every piece's face box.
function readOld(key) {
  const P = window.Proto, G = P.G, h = window.__h;
  h.loadScenario(key);
  return new Promise(res => setTimeout(() => {
    const text = c => (P.face(c) || {}).text || "";
    const groupKey = c => [c.card, c.copyOf, c.transformed, c.tapped, c.faceDown, c.sick, c.goaded, JSON.stringify(c.counters || {}), c.power, c.toughness].join("|");
    const rockRe = /(^|\n|— )\{T\}[^:\n]*: Add/, specialRe = /\b(Whenever|At the beginning)\b/;
    const seats = G.players.slice().sort((a, b) => a.seat - b.seat).map(p => ({
      seat: p.id,
      mine: p.id === P.ME,
      // The cards drawn on this seat: what it controls, minus what hangs on another seat's permanent, plus what hangs on its own.
      cards: Object.values(G.cards).filter(c => c.zone === "battlefield").filter(c => { const host = c.attachedTo != null && G.cards[c.attachedTo]; return host ? host.controller === p.id : c.controller === p.id; }).map(c => ({
        id: c.id, name: P.name(c), cardKey: c.card, sig: groupKey(c),
        land: !!P.isLand(c), creature: !!P.isCreature(c), planeswalker: !!P.isPW(c),
        artifact: /Artifact/.test(P.typeLine(c)), enchantment: /Enchantment/.test(P.typeLine(c)),
        manaRock: !!(P.isMana(c) && rockRe.test(text(c))),
        specialLand: !!(P.isLand(c) && (!!c.copyOf || specialRe.test(text(c)))),
        treasure: !!(c.token && /Treasure/.test(c.card)),
        basic: /Basic/.test(P.typeLine(c)),
        typeWord: P.typeLine(c).split("—")[0].replace(/Legendary|Snow|Basic|Token/g, "").trim().split(" ").pop(),
        legendary: /Legendary/.test(P.typeLine(c)),
        token: !!c.token, commander: !!c.commander, tapped: !!c.tapped,
        power: c.power == null ? null : +c.power, toughness: c.toughness == null ? null : +c.toughness,
        keywords: c.keywords || [], attachedTo: c.attachedTo == null ? null : c.attachedTo,
      })),
      fixtures: { graveyard: (p.graveyard || []).length, exile: (p.exile || []).length, commandZone: (P.card(p.commander[0]) || {}).zone === "command" },
    }));
    const entries = Object.entries(h.pieces()).filter(([, pc]) => !["floor", "plate", "zone"].includes(pc.role));
    const boxes = h.cardBoxes();
    const fighting = G.combat ? G.combat.attackers.map(a => a.id).concat(G.combat.blockers.map(b => b.id)) : [];
    res({ seats, fighting, boxes: boxes.slice(0, entries.length).map((b, i) => ({ key: entries[i][0], pid: entries[i][1].pid, ids: entries[i][1].ids, box: b.face })), nEntries: entries.length, nBoxes: boxes.length });
  }, 2500));
}

(async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({ configFile: false, root: path.join(__dirname, "../client"), server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const L = await vite.ssrLoadModule("/src/layout/index.ts");
  const { base, server } = await serve();
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const open = async key => {
    // A fresh page per scenario, loaded straight into it: the old layout remembers the board before (held rows).
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(base + "offline.html?s=" + key);
    await page.waitForFunction(() => window.__h, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    return page;
  };
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const summary = [];
  for (const key of SCENARIOS) {
    const page = await open(key);
    const old = await page.evaluate(readOld, key);
    await page.close();
    const plan = L.planTable({
      viewport: { w: W, h: H }, mode: "normal", settling: false, memory: null, stack: [],
      seats: old.seats.map(s => ({ seat: s.seat, board: s })), involved: new Set(old.fighting),
    });
    const diffs = [], missing = [];
    const units = new Map();
    for (const sp of plan.seats.values()) for (const u of sp.units) units.set(u.id, { sp, u });
    for (const o of old.boxes) {
      const hit = plan.hits.groups.find(g => g.id === o.key) || plan.hits.groups.find(g => g.members[0] === o.ids[0] && g.kind !== "plate");
      if (!hit) { missing.push(o.key); continue; }
      const xs = hit.quad.map(p => p.x), ys = hit.quad.map(p => p.y);
      const n = { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
      const d = Math.max(Math.abs(n.l - o.box.l), Math.abs(n.r - o.box.r), Math.abs(n.t - o.box.t), Math.abs(n.b - o.box.b));
      const dc = Math.hypot((n.l + n.r) / 2 - (o.box.l + o.box.r) / 2, (n.t + n.b) / 2 - (o.box.t + o.box.b) / 2);
      if (VERBOSE && d > 30) console.log(`    ${key} ${o.key} old ${JSON.stringify(o.box, (k, v) => typeof v === "number" ? Math.round(v) : v)} new ${JSON.stringify(n, (k, v) => typeof v === "number" ? Math.round(v) : v)} members ${hit.members}`);
      diffs.push({ key: o.key, pid: o.pid, ids: o.ids.length, d, dc, fight: o.ids.some(id => old.fighting.includes(id)) });
    }
    if (VERBOSE) { plan.violations.forEach(v => console.log("    violation", key, v.rule, v.group, v.seat, v.measured.toFixed(2), v.limit.toFixed(2))); for (const sp of plan.seats.values()) if (sp.report.lastResort || sp.report.pressure) {
        console.log(`    ${key} ${sp.seat}: pressure ${sp.report.pressure}${sp.report.lastResort ? " LAST RESORT" : ""}`);
        if (sp.report.lastResort) {
          const i = old.seats.findIndex(x => x.seat === sp.seat), tpl = L.tableTemplate(4), proj = L.pinhole(tpl.camera, { w: W, h: H });
          const inp = { seat: sp.seat, board: old.seats[i], region: { ...tpl.slots[i], lift: 0 }, projector: proj, reserve: L.reservations({ w: W, h: H }, "normal"), viewport: { w: W, h: H }, involved: new Set(old.fighting), settling: false, memory: null, pressure: 0 };
          const pl = L.mat.plan(inp);
          const shs = L.seatShapes(proj, pl, old.seats[i].mine), mb = shs.find(x => x.group === "mbo"), c = mb.foot[0];
          console.log("      foot", JSON.stringify(mb.foot.map(q => [Math.round(q.x), Math.round(q.y)])), "covered by", shs.filter(x => x !== mb && L.inQuad(x.face, (mb.foot[0].x + mb.foot[2].x) / 2, (mb.foot[0].y + mb.foot[2].y) / 2)).map(x => x.group + "@" + x.order.toFixed(1)).join(), "mbo order", mb.order.toFixed(1));
          L.audit(shs, { w: W, h: H }).forEach(v => console.log("      ", v.rule, v.group, v.measured.toFixed(2), v.limit.toFixed(2)));
        }
      } }
    const calm = diffs.filter(x => !x.fight);
    const row = { scenario: key, pieces: diffs.length, missing: missing.length, maxEdge: Math.max(0, ...calm.map(x => x.d)), maxSingle: Math.max(0, ...calm.filter(x => x.ids === 1).map(x => x.d)), medEdge: med(calm.map(x => x.d)), maxCentre: Math.max(0, ...calm.map(x => x.dc)), medCentre: med(calm.map(x => x.dc)), fighters: diffs.length - calm.length, violations: plan.violations.length };
    summary.push(row);
    if (VERBOSE) diffs.sort((a, b) => b.d - a.d).slice(0, 8).forEach(x => console.log(`  ${key} ${x.key} (${x.pid}, ${x.ids} cards) edge ${x.d.toFixed(1)}px centre ${x.dc.toFixed(1)}px${x.fight ? " [fighter]" : ""}`));
    if (missing.length) console.log(`  ${key}: no new unit for ${missing.join(", ")}; new: ${[...units.values()].filter(x => x.sp.seat === "bo").map(x => x.u.id + "[" + x.u.members + "]" + (x.u.title || "")).join(" ")}; old: ${old.boxes.map(b => b.key + "[" + b.ids + "]").join(" ")}`);
  }
  console.table(summary.map(r => ({ ...r, maxEdge: +r.maxEdge.toFixed(1), maxSingle: +r.maxSingle.toFixed(1), medEdge: +r.medEdge.toFixed(1), maxCentre: +r.maxCentre.toFixed(1), medCentre: +r.medCentre.toFixed(1) })));
  await browser.close(); server.close(); await vite.close();
})().catch(e => { console.error(e); process.exit(1); });
