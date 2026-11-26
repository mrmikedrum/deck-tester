// Stills of table moments on the design pass's tables (tests/fixtures/boards/design-pass.json), for judging by eye: the
// table at rest (turns 4, 9 and 15), the stack at rest, combat (the clash, duels in the parted middle), a seat leaving.
// Each moment is its envelopes on the scripted transport, then the taps and keys it names, then a screenshot once the
// table is settled.
//   npm run build && node tools/combat-stills.js <outdir> [only,names]
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const { serve } = require("./serve.js");

const design = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/boards/design-pass.json"), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
const stage = (turn) => clone(design.stages.find((s) => s.turn === turn).envelope);
const base = () => stage(15);

// Atraxa's six (Atraxa, Steel Overseer, Chrome Host Seedshark, Tekuthal, Brimaz, Phyrexian Metamorph), and my blockers.
const ATRAXA6 = [1019, 1041, 1117, 1169, 1221, 1072];
const BLOCKS4 = [[1057, 1041], [1141, 1117], [1089, 1019], [1027, 1221]];
const MINE = [1010, 1027, 1057, 1089, 1090, 1141, 1142];

/** The turn-15 table in a combat: `active` attacks with `attackers` ([id, defender]), `blockers` ([blocker, attacker]). */
function fight({ active, attackers, blockers = [], phase = "COMBAT_DECLARE_BLOCKERS", priority = "You", tap = true, decision = null, edit }) {
  const e = base();
  e.v = 20;
  const seat = (n) => e.view.players.find((p) => p.name === n);
  const card = (id) => e.view.players.flatMap((p) => p.battlefield).find((c) => c.id === id);
  if (tap) for (const [id] of attackers) if (!/Vigilance/.test(card(id).text || "")) card(id).tapped = true;
  e.view = { ...e.view, active, priority, phase, combat: {
    ordinal: 1,
    // Forge's verdict per attacker, as the engine sends it
    attackers: attackers.map(([id, defender]) => ({ id, defender, blocked: blockers.some(([, a]) => a === id) })),
    blockers: blockers.map(([id, blocking]) => ({ id, blocking })),
    damage: [],
  } };
  if (decision) e.decision = { gen: 1, turn: `T15 ${phase.toLowerCase()}`, repeat: false, mine: active === "You", ...decision };
  if (edit) edit(e, seat, card);
  return e;
}

/** My block decision against `attackers`: every untapped creature of mine may block each. */
function blockDecision(attackers) {
  const refs = [];
  for (const m of MINE) for (const [a] of attackers) refs.push({ card: m, blocks: a });
  return { id: 7, kind: "block", prompt: "Declare blockers", options: refs.map(() => "block"), refs, min: 0, max: refs.length };
}
/** My attack decision: each untapped creature of mine at each opponent. */
function attackDecision() {
  const refs = [];
  for (const m of MINE) for (const to of ["Marath", "Atraxa", "Dack"]) refs.push({ card: m, to });
  return { id: 8, kind: "attack", prompt: "Declare attackers", options: refs.map(() => "attack"), refs, min: 0, max: refs.length };
}

const atraxa6 = ATRAXA6.map((id) => [id, "You"]);

/** Combat damage on the owner's fight: Tekuthal's 3 dealt to me, Master of Waves dead under Steel Overseer. */
const dealt = (v, phase, combat = true) => {
  const e = fight({ active: "Atraxa", attackers: atraxa6, blockers: BLOCKS4, priority: "Atraxa", phase });
  const me = e.view.players.find((p) => p.name === "You");
  me.life = 23;
  const i = me.battlefield.findIndex((c) => c.id === 1057);
  me.graveyard = [...(me.graveyard || []), me.battlefield[i]];
  me.battlefield.splice(i, 1);
  e.view.combat = combat ? { ...e.view.combat, blockers: e.view.combat.blockers.filter((b) => b.id !== 1057) } : null;
  // the engine's combat damage facts (Steel Overseer stays blocked by Forge's verdict though its blocker died)
  if (combat) e.view.combat.damage = [{ source: 1169, target: "You", defender: "You", amount: 3 }, { source: 1041, target: 1057, defender: "You", amount: 6 }];
  e.v = v;
  return e;
};
const rest = (v) => Object.assign(base(), { v });
const at = (turn, v) => Object.assign(stage(turn), { v });

/** The turn-15 table with spells on the stack (top first): Dack's Swords on Herd Baloth, Marath's Chaos Warp on
 *  Wispweaver Angel, my Arcane Denial on the Chaos Warp. */
function withStack(v) {
  const e = rest(v);
  const spell = (id, name, who, type, targets) => ({ id, source: { id, name, owner: who, controller: who, type, zone: "stack" }, controller: who, spell: true, text: name, targets });
  e.view = { ...e.view, active: "Dack", priority: "You", phase: "MAIN1", stack: [spell(9003, "Arcane Denial", "You", "Instant", [9002]), spell(9002, "Chaos Warp", "Marath", "Instant", [1129]), spell(9001, "Swords to Plowshares", "Dack", "Instant", [1064])] };
  return e;
}

/** The turn-15 table after Dack has lost: Forge lists only players still in the game; the seat keeps its place. */
function dackGone(v) {
  const e = rest(v);
  e.view = { ...e.view, players: e.view.players.filter((p) => p.name !== "Dack") };
  return e;
}

const MARATH4 = [[1015, "Dack"], [1064, "Dack"], [1105, "Dack"], [1157, "Dack"]];
const MOMENTS = {
  "turn-4": { what: "Turn 4 at rest: an early board", env: at(4, 19) },
  "turn-9": { what: "Turn 9 at rest: a mid board", env: at(9, 19) },
  "turn-15": { what: "Turn 15 at rest: the dense board", env: rest(19) },
  "stack-at-rest": { what: "Three spells on the stack, the focus set aside: the mats part and the stack rests in the middle", env: withStack(19), keys: ["Escape"] },
  "opponents-duel": {
    what: "Marath attacks Dack with four; Dack Fayden blocks Marath: one duel in the parted middle, the rest laned",
    env: fight({ active: "Marath", attackers: MARATH4, blockers: [[1024, 1015]], priority: "Marath" }),
  },
  "opponents-duels": {
    what: "Marath attacks Dack with four; Dack blocks two: two duels in the parted middle",
    env: fight({ active: "Marath", attackers: MARATH4, blockers: [[1024, 1015], [1129, 1064]], priority: "Marath" }),
  },
  "opponents-crowded": {
    what: "Marath attacks Dack with four, all blocked: the duels do not fit the middle, so the clash rises",
    env: fight({ active: "Marath", attackers: MARATH4, blockers: [[1024, 1015], [1129, 1064], [1048, 1105], [1080, 1157]], priority: "Marath" }),
  },
  "seat-leaves": { what: "Dack has lost: the leaf empties, every other seat stays where it was", envs: [rest(19), dackGone(20)] },
  "attacked-by-six": { what: "Atraxa attacks me with six; no blocks yet, nothing to decide", env: fight({ active: "Atraxa", attackers: atraxa6, priority: "Atraxa" }) },
  "choosing-blocks": {
    what: "My block decision: Master of Waves on Steel Overseer, Mulldrifter on Chrome Host Seedshark, Meloku held",
    env: fight({ active: "Atraxa", attackers: atraxa6, decision: blockDecision(atraxa6) }),
    taps: [1057, 1041, 1141, 1117, 1089],
  },
  "blocks-declared": { what: "The owner's still, redone: four of mine block, Tekuthal and Phyrexian Metamorph unblocked", env: fight({ active: "Atraxa", attackers: atraxa6, blockers: BLOCKS4, priority: "Atraxa", phase: "COMBAT_DECLARE_BLOCKERS" }) },
  "my-attack-choosing": { what: "My attack decision: Meloku, Master of Waves and Faerie Mastermind picked at Marath", env: fight({ active: "You", attackers: [], phase: "COMBAT_DECLARE_ATTACKERS", tap: false, decision: attackDecision() }), taps: [1089, 1057, 1027] },
  "my-attack-blocked": {
    what: "I attack Marath with four; Marath blocks Meloku with Herd Baloth and Master of Waves with a Beast",
    env: fight({ active: "You", attackers: [[1089, "Marath"], [1057, "Marath"], [1027, "Marath"], [1090, "Marath"]], blockers: [[1064, 1089], [1066, 1057]], priority: "You" }),
  },
  "opponents-attack": { what: "Marath attacks Dack with four, no blocks yet: the table form", env: fight({ active: "Marath", attackers: [[1015, "Dack"], [1064, "Dack"], [1105, "Dack"], [1157, "Dack"]], phase: "COMBAT_DECLARE_ATTACKERS", priority: "Marath" }) },
  "split-attack": {
    what: "Atraxa attacks me with three and Dack with two; I block one, Dack blocks one (three rows)",
    env: fight({ active: "Atraxa", attackers: [[1019, "You"], [1041, "You"], [1169, "You"], [1117, "Dack"], [1221, "Dack"]], blockers: [[1089, 1041], [1129, 1117]], priority: "Atraxa" }),
  },
  "before-combat": { what: "The table before Atraxa's attack (to compare with home-again)", env: rest(19) },
  "damage-dealt": {
    what: "Combat damage: the plaque says what was dealt (3), Master of Waves gone to the graveyard, the blocked column keeps its clasp",
    envs: [rest(19), fight({ active: "Atraxa", attackers: atraxa6, priority: "Atraxa" }), Object.assign(fight({ active: "Atraxa", attackers: atraxa6, blockers: BLOCKS4, priority: "Atraxa" }), { v: 21 }), dealt(22, "COMBAT_DAMAGE")],
  },
  "home-again": {
    what: "After combat: everyone home, Atraxa's six turned for tapped, Master of Waves gone, life 23",
    envs: [rest(19), fight({ active: "Atraxa", attackers: atraxa6, priority: "Atraxa" }), Object.assign(fight({ active: "Atraxa", attackers: atraxa6, blockers: BLOCKS4, priority: "Atraxa" }), { v: 21 }), dealt(22, "COMBAT_DAMAGE"), Object.assign(dealt(23, "MAIN2", false), {})],
  },
  "one-attacker": { what: "Atraxa attacks me alone: the same picture, one column", env: fight({ active: "Atraxa", attackers: [[1019, "You"]], priority: "Atraxa" }) },
  "double-block": {
    what: "Atraxa attacks me with six; Master of Waves and Mulldrifter both block Atraxa, Meloku blocks Steel Overseer",
    env: fight({ active: "Atraxa", attackers: atraxa6, blockers: [[1057, 1019], [1141, 1019], [1089, 1041]], priority: "Atraxa" }),
  },
  "planeswalker": {
    what: "Dack attacks Tezzeret, Atraxa's planeswalker, with Wispweaver Angel and Dack Fayden, and Atraxa with Fiend Hunter; Atraxa blocks the Angel",
    env: fight({ active: "Dack", attackers: [[1129, 1073], [1024, 1073], [1048, "Atraxa"]], blockers: [[1221, 1129]], priority: "Dack" }),
  },
  "eleven-and-seven": {
    what: "Marath attacks me with eleven (four of them identical Beasts); seven of mine block",
    env: fight({
      active: "Marath",
      priority: "Marath",
      attackers: [1015, 1064, 1035, 1153, 1204, 1205, 1101, 1066, 1105, 1157, 1158].map((id) => [id, "You"]),
      blockers: [[1089, 1015], [1057, 1064], [1027, 1035], [1141, 1153], [1090, 1204], [1142, 1205], [1010, 1101]],
    }),
  },
};

async function settle(page, ms = 20000) {
  for (let calm = 0, end = Date.now() + ms; Date.now() < end && calm < 6; ) {
    calm = (await page.evaluate(() => window.__deckmaster.settled() && window.__deckmaster.art.pending() === 0)) ? calm + 1 : 0;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Tap the middle of the hit group holding this card. */
async function tapCard(page, card) {
  const g = await page.evaluate((c) => window.__deckmaster.hits().filter((h) => h.members.includes(c)).sort((a, b) => b.order - a.order)[0], card);
  if (!g) throw new Error(`no hit group for ${card}`);
  const x = g.quad.reduce((t, p) => t + p.x, 0) / 4, y = g.quad.reduce((t, p) => t + p.y, 0) / 4;
  await page.mouse.click(x, y);
  await settle(page, 4000);
}

(async () => {
  const [outDir = "combat-stills", onlyArg] = process.argv.slice(2);
  const only = onlyArg ? new Set(onlyArg.split(",")) : null;
  fs.mkdirSync(outDir, { recursive: true });
  const { base: url, server } = await serve(0, { dist: true });
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    for (const [name, m] of Object.entries(MOMENTS)) {
      if (only && !only.has(name)) continue;
      const ctx = await browser.newContext({ viewport: { width: 1210, height: 834 }, deviceScaleFactor: 2, baseURL: url });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.error(name, String(e)));
      await page.route("**/still-scenario.json", (r) => r.fulfill({ json: { catalog: design.catalog, envelopes: m.envs ?? [m.env] } }));
      await page.goto("index.html?script=still-scenario.json");
      await page.waitForFunction(() => window.__deckmaster && window.__deckmaster.seats().length > 0, null, { timeout: 30000 });
      await settle(page);
      for (const c of m.taps ?? []) await tapCard(page, c);
      for (const k of m.keys ?? []) {
        await page.keyboard.press(k);
        await settle(page, 4000);
      }
      await settle(page);
      await page.screenshot({ path: path.join(outDir, `${name}.jpg`), type: "jpeg", quality: 88 });
      console.log(`${name}: ${m.what}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
