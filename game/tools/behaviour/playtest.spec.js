// Regressions from the first live game on the rebuilt client.
const path = require("path");
const { test, expect, NEW, snapshot, withDecision, find } = require("./harness.js");

test.skip(!NEW, "rebuilt client");

async function still(table, name) {
  if (process.env.PLAYTEST_STILLS) await table.page.screenshot({ path: path.join(process.env.PLAYTEST_STILLS, name + ".png") });
}

test("failed shuffle offers a new game", async ({ table }) => {
  await table.open({ state: "starting" });
  await expect(table.page.getByText(/Shuffling up/)).toBeVisible();
  await table.push({ state: "error", gen: table.snapshot.gen, error: "Unix domain path too long" });
  await expect(table.page.getByText("Game couldn't start", { exact: true })).toBeVisible();
  await still(table, "01-start-failed");
  await table.press("New game");
  await expect(table.page.getByRole("button", { name: "Start" })).toBeVisible();
});

test("a deck rejected by the lobby explains the failed start", async ({ table }) => {
  await table.open({ state: "starting" });
  await table.push({ state: "error", gen: table.snapshot.gen, startFailure: "deck",
    error: "could not start (a deck failed the lobby's checks)" });
  await expect(table.page.getByText("Deck failed lobby checks", { exact: true })).toBeVisible();
  await expect(table.button("New game")).toBeVisible();
});

test("a generic lobby refusal gives a generic start failure", async ({ table }) => {
  await table.open({ state: "starting" });
  await table.push({ state: "error", gen: table.snapshot.gen, startFailure: "engine", error: "table couldn't start" });
  await expect(table.page.getByText("Game couldn't start", { exact: true })).toBeVisible();
});

test("reconnecting disables play until the same game returns", async ({ table }) => {
  const s = snapshot("main");
  await table.open(s);
  const gen = table.snapshot.gen;
  await table.push({ state: "reconnecting", gen, error: "view stalled" });
  await expect(table.page.getByText("Reconnecting…", { exact: true })).toBeVisible();
  await expect(table.page.locator('.l-prompt [data-button="pass"]')).toHaveCount(0);
  await table.push({ ...s, gen });
  await expect(table.page.locator('.l-prompt [data-button="pass"]')).toBeVisible();
  expect(table.answers()).toEqual([]);
});

test("an interrupted game clears the old decision and offers recovery", async ({ table }) => {
  await table.open("main");
  await expect(table.page.locator('.l-prompt [data-button="pass"]')).toBeVisible();
  await table.push({ state: "interrupted", gen: table.snapshot.gen, error: "engine timed out on view" });
  await expect(table.page.getByText("Game interrupted", { exact: true })).toBeVisible();
  await expect(table.page.locator('.l-prompt [data-button="pass"]')).toHaveCount(0);
  await expect(table.button("New game")).toBeVisible();
  expect(table.answers()).toEqual([]);
});

test("floating mana stays visible from priority through payment", async ({ table }) => {
  const s = snapshot("main");
  await table.open(s);
  s.view.players[0].manaPool = { U: 2 };
  await table.push({ ...s, gen: table.snapshot.gen });
  const pool = table.page.getByText("Floating mana", { exact: true });
  await expect(pool).toBeVisible();
  await expect(pool.locator("..").locator('[aria-label="U"]')).toHaveCount(2);
  const island = find(s, "You", "Island");
  await table.push({ ...withDecision(s, { kind: "pay", prompt: "mana to pay U for a spell", options: ["Island (U)"], refs: [{ card: island.id }], min: 0 }), gen: table.snapshot.gen });
  await expect(pool).toBeVisible();
  await still(table, "02-floating-mana");
  await table.press("Auto-pay");
  expect((await table.answered(1))[0].answer).toEqual([]);
});

test("tapping the nameplate inspects an uncastable commander", async ({ table }) => {
  const s = snapshot("main"), commander = s.view.players[0].command[0];
  await table.open(withDecision(s, { options: ["pass"], refs: [{}] }));
  await table.tapPlate("you");
  await expect(table.page.locator(".inspector")).toBeVisible();
  await expect(table.page.locator(".inspector")).toContainText(commander.name);
  await expect(table.page.locator(".l-actions button")).toHaveCount(0);
  await still(table, "03-commander");
});

test("an opponent's spell shows an opponent target and chosen values", async ({ table }) => {
  const s = snapshot("main");
  const source = { ...s.view.players[0].hand[0], id: 777, name: "Windsoul's Rage", type: "Sorcery", controller: "Dack", owner: "Dack" };
  await table.open(withDecision(s, { options: ["pass"], refs: [{}], mine: false }, v => {
    v.active = "Dack";
    v.stack = [{ id: 1, source, controller: "Dack", spell: true, text: source.name, targets: ["Atraxa"], x: 3, modes: [] }];
    v.log = [{ i: 0, type: "STACK_ADD", text: "Dack cast Windsoul's Rage targeting Atraxa", card: 777 }];
  }));
  const prompt = table.page.locator(".l-prompt");
  await expect(prompt).toContainText("targets Atraxa");
  await expect(prompt).toContainText("X = 3");
  await expect(table.page.locator(".l-feed-event").filter({ hasText: "targeting Atraxa" })).toContainText("X = 3");
  await still(table, "04a-stack-target-and-x");
  await table.press("What happened");
  await expect(table.page.locator(".l-log")).toContainText("Windsoul's Rage targeting Atraxa · X = 3");
  await still(table, "04b-log-target-and-x");
});

test("an ability preview flies back to the permanent it came from", async ({ table }) => {
  const s = snapshot("main"), source = find(s, "You", "Meloku the Clouded Mirror");
  const item = { id: 1, source, controller: "You", spell: false, text: "Meloku - Create a 1/1 Illusion." };
  await table.open(withDecision(s, { options: ["pass"], refs: [{}] }, v => { v.stack = [item]; }));
  await table.step(1000);
  await still(table, "05a-ability-on-stack");
  await table.push({ ...s, gen: table.snapshot.gen }, { animate: false });
  const read = () => table.page.evaluate(id => {
    const scene = window.__deckmaster.scene.inspect();
    return { home: scene.pieces.find(p => p.members.includes(id) && !p.remnant)?.id,
      flight: scene.departures.find(p => p.key === "i1") };
  }, source.id);
  await expect.poll(async () => (await read()).flight?.dest.to).toBe("piece");
  const { home, flight } = await read();
  expect(home).toBeTruthy();
  expect(flight.origin).toEqual({ from: "piece", piece: "stack:1" });
  expect(flight.dest).toEqual({ to: "piece", piece: home });
  if (process.env.PLAYTEST_STILLS) {
    await table.step(420);
    await still(table, "05b-ability-returning");
  }
});

test("dragging onto the empty part of a rival board selects that player", async ({ table }) => {
  const s = snapshot("attack");
  await table.open(s);
  const from = await table.locate({ card: find(s, "You", "Master of Waves").id });
  const to = await table.page.evaluate(() => {
    const scene = window.__deckmaster.scene, canvas = document.querySelector("#stage");
    for (let y = 30; y < innerHeight - 30; y += 12) {
      for (let x = 30; x < innerWidth - 30; x += 12) {
        if (document.elementFromPoint(x, y) === canvas && !scene.pick(x, y) && scene.seatAt(x, y) === "Dack") return { x, y };
      }
    }
    return null;
  });
  expect(to).toBeTruthy();
  await table.drag(from, to);
  await still(table, "07-attack-by-drag");
  await table.press("Attack (1)");
  expect((await table.answered(1))[0].answer).toEqual([6]);
});
