// Stills of the chrome's choices and plates on the built new entry, at the iPad's 1210x834 and 2x: the card sheet
// (a library search of 5 and 40 cards, choose one and choose two, a 62-card tutor's pages, a graveyard choice), the
// payment's list, the nameplate focus (mine and an opponent's), the plates at rest and in a combat. The engine is the
// behaviour harness's mock (shoot.js boards); card images come from .deckmaster/cache/cards.
//   npm run build && node tools/chrome-stills.js <outdir> [name,name]
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const { serve } = require("./serve.js");

const [outDir = "chrome-stills", onlyArg] = process.argv.slice(2);
const only = onlyArg ? new Set(onlyArg.split(",")) : null;
process.env.BEHAVIOUR_CLIENT = "new";
const { Table, snapshot, withDecision, find, clone, sleep } = require("./behaviour/harness.js");

// Cards from the library: ids the table does not hold, so the sheet shows them by name, with Forge's details (their text).
let hidden = 5000;
const fromLibrary = (names, CARDS) => ({
  options: names,
  details: names.map((n) => CARDS[n].faces[0].text || n),
  refs: names.map(() => ({ card: hidden++ })),
});
const BASICS = (n, name) => Array.from({ length: n }, () => name);
const FARSEEK_5 = ["Hallowed Fountain", "Island", "Mountain", "Sacred Foundry", "Watery Grave"];
const FARSEEK_40 = [...BASICS(14, "Island"), ...BASICS(11, "Mountain"), ...BASICS(7, "Plains"), "Hallowed Fountain", "Sacred Foundry", "Watery Grave", "Godless Shrine",
  ...BASICS(4, "Swamp")].sort();
const TUTOR = (CARDS) => Object.keys(CARDS).filter((n) => !/Token|Basic/.test(CARDS[n].faces[0].type)).slice(0, 62).sort();
const GRAVE = ["Unwind", "Mulldrifter", "Frantic Search", "Snap", "Arcane Denial", "Ghostly Flicker", "Phantasmal Image", "Reality Shift", "Farseek"];

/** My graveyard and exile filled, and some of the opponents', for the focus and a graveyard choice. */
function zones(view) {
  const you = view.players[0], marath = view.players[1];
  let id = 8000;
  const card = (name, who) => {
    const proto = clone(find({ view }, "You", "Snap"));
    return Object.assign(proto, { id: id++, name, owner: who, controller: who, type: "Instant", text: "", cost: "" });
  };
  you.graveyard = GRAVE.map((n) => card(n, "You"));
  you.exile = ["Reality Shift", "Snap"].map((n) => card(n, "You"));
  marath.graveyard = ["Farseek", "Herd Baloth", "Evolution Sage", "Beast", "Temple Garden", "Command Tower"].map((n) => card(n, "Marath"));
  marath.exile = ["Sol Ring"].map((n) => card(n, "Marath"));
}

const SHOTS = {
  "search-5-choose-1": { sheet: (C) => ({ kind: "choose", prompt: "Choose a land card (Farseek)", ...fromLibrary(FARSEEK_5, C), min: 1, max: 1 }) },
  "search-5-choose-2": { sheet: (C) => ({ kind: "choose", prompt: "Choose up to two land cards (Cultivate)", ...fromLibrary(FARSEEK_5, C), min: 0, max: 2 }), picks: 1 },
  "search-40-choose-1": { sheet: (C) => ({ kind: "choose", prompt: "Choose a land card (Farseek)", ...fromLibrary(FARSEEK_40, C), min: 1, max: 1 }) },
  "search-40-choose-2": { sheet: (C) => ({ kind: "choose", prompt: "Choose two land cards (Explosive Vegetation)", ...fromLibrary(FARSEEK_40, C), min: 2, max: 2 }), picks: 2 },
  "tutor-62-choose-1": { sheet: (C) => ({ kind: "choose", prompt: "Choose a card (Demonic Tutor)", ...fromLibrary(TUTOR(C), C), min: 1, max: 1 }) },
  "tutor-62-page-2": { sheet: (C) => ({ kind: "choose", prompt: "Choose a card (Demonic Tutor)", ...fromLibrary(TUTOR(C), C), min: 1, max: 1 }), next: 1 },
  "graveyard-choose-1": {
    sheet: (C, view) => {
      const ids = view.players[0].graveyard.map((c) => c.id);
      return { kind: "targets", prompt: "target card in your graveyard (Regrowth)", options: GRAVE, details: GRAVE.map((n) => (C[n] ? C[n].faces[0].text : n)), refs: ids.map((card) => ({ card })), min: 1, max: 1 };
    },
  },
  // A payment's list: one card offered twice, for two colours; its tag says which.
  "pay-list": {
    sheet: (C, view) => {
      const ring = find({ view }, "You", "Sol Ring").id, signet = find({ view }, "You", "Arcane Signet").id;
      return { kind: "pay", prompt: "Choose mana to pay {2}{U} for Snap, in order", options: ["Sol Ring (C)", "Arcane Signet (U)", "Arcane Signet (W)"], refs: [{ card: ring }, { card: signet }, { card: signet }], min: 0, max: 3, repeat: true };
    },
  },
  "focus-mine": { state: "theirs", plate: "You" },
  "focus-opponent": { state: "theirs", plate: "Marath" },
  "plates-rest": { state: "theirs" },
  "combat-at-me": { state: "block" },
  "combat-my-attack": {
    state: "main",
    edit: (view) => {
      view.phase = "COMBAT_DECLARE_BLOCKERS";
      view.active = "You";
      const atk = [find({ view }, "You", "Meloku the Clouded Mirror"), find({ view }, "You", "Master of Waves"), find({ view }, "You", "Whirler Rogue")];
      atk.forEach((c) => (c.tapped = true));
      view.combat = { attackers: [{ id: atk[0].id, defender: "Marath" }, { id: atk[1].id, defender: "Marath" }, { id: atk[2].id, defender: "Atraxa" }], blockers: [] };
    },
    decision: { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 },
  },
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const { base, server } = await serve(0, { dist: true });
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1210, height: 834 }, deviceScaleFactor: 2, hasTouch: true, baseURL: base });
  const page = await ctx.newPage();
  const t = new Table(page);
  await t.install();
  const { CARDS } = require("./behaviour/harness.js");
  await t.boot(snapshot("theirs"));
  let gen = 2000;
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (only && !only.has(name)) continue;
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    let s = snapshot(shot.state || "main");
    zones(s.view);
    if (shot.edit) shot.edit(s.view);
    if (shot.sheet) s = withDecision(s, shot.sheet(CARDS, s.view));
    else if (shot.decision) s = withDecision(s, shot.decision);
    s.gen = ++gen;
    await t.push(s);
    await t.step(1500);
    if (shot.sheet && (await page.locator(".l-sheet").count()) === 0 && (await page.getByRole("button", { name: /^(Choose…|List)$/ }).count())) {
      await page.getByRole("button", { name: /^(Choose…|List)$/ }).first().click();
      await t.step(600);
    }
    for (let i = 0; i < (shot.picks || 0); i++) {
      await page.locator(".l-sheet .l-grid button").nth(i === 0 ? 1 : 3).click();
      await t.step(300);
    }
    for (let i = 0; i < (shot.next || 0); i++) {
      await page.getByRole("button", { name: "Next page" }).click();
      await t.step(300);
    }
    if (shot.plate) {
      await page.locator(`.l-plate[aria-label^="${shot.plate},"]`).click();
      await t.step(800);
    }
    await sleep(200);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    console.log("shot", name);
  }
  if (t.errors.length) console.log("page errors:", t.errors);
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
