// My piles' title tabs as drawn (the new entry only): on the design pass's turn-15 table at iPad landscape, every title
// of mine is on top where it is drawn, never tucked behind the standing card beside it (the end of my field's muster read
// "5 ↷3" half behind Mulldrifter, as the ledger placed it on the card's bounds, not on its leaning top edge).
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test, expect, NEW } = require("./harness.js");

const design = JSON.parse(readFileSync(resolve(__dirname, "../../../tests/fixtures/boards/design-pass.json"), "utf8"));

test("my pile titles are drawn clear of my standing cards", async ({ browser }) => {
  test.skip(!NEW, "the physical table is the new entry's");
  const ctx = await browser.newContext({ viewport: { width: 1210, height: 834 }, deviceScaleFactor: 1, baseURL: process.env.BEHAVIOUR_BASE });
  const page = await ctx.newPage();
  const envelope = design.stages.find((s) => s.turn === 15).envelope;
  await page.route("**/piles-scenario.json", (r) => r.fulfill({ json: { catalog: design.catalog, envelopes: [envelope] } }));
  await page.goto("index.html?script=piles-scenario.json");
  await page.waitForFunction(() => window.__deckmaster && window.__deckmaster.seats().length > 0, null, { timeout: 30000 });
  for (let calm = 0, end = Date.now() + 20000; Date.now() < end && calm < 6; ) {
    calm = (await page.evaluate(() => window.__deckmaster.settled() && window.__deckmaster.art.pending() === 0)) ? calm + 1 : 0;
    await new Promise((r) => setTimeout(r, 250));
  }
  const covered = await page.evaluate(() => {
    const d = window.__deckmaster;
    const mine = new Set(d.hits().filter((h) => h.seat === "You").map((h) => h.id));
    const out = [];
    // across the title's box, short of its ends, and through its middle: inside the tab however it leans
    for (const l of d.scene.labels().filter((l) => l.visible && mine.has(l.id) && !/(rocks|lands|basic)/.test(l.id))) {
      const [x0, y0, x1, y1] = l.box;
      for (const u of [0.15, 0.3, 0.5, 0.7, 0.85]) {
        const on = d.scene.under(x0 + (x1 - x0) * u, (y0 + y1) / 2);
        if (on !== l.id) out.push(`${l.id} under ${on}`);
      }
    }
    return { out, n: d.scene.labels().filter((l) => l.visible && mine.has(l.id)).length };
  });
  expect(covered.n).toBeGreaterThan(0);
  expect(covered.out).toEqual([]);
  await ctx.close();
});
