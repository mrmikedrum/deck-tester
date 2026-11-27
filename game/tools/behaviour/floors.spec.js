// The recorder's layout audit (tools/reel.js and packet.js) measures the faces the scene drew; the arrangement engine
// and the table's audit (layout/shape.ts) hold the plan's faces to their floors. They must measure the same thing: a
// face across its middle with the tap's turn taken out, the creature floor for a creature standing and the any-card
// floor for one lying (tapped a quarter turn, in a pile, in the back band). On the stack recording's board, before the spell, with
// it up and with it set aside (the mats parted), at 1180 x 820 and the iPad's 1210 x 834: every face the scene drew agrees
// with the plan's width, gets the floor the plan gives it, and meets it.
const { test, expect } = require("@playwright/test");
const { locate } = require("./locate.js");
const CLIPS = require("../clips.js");
const { floorFor, designUnit } = require("../packet.js");

const clip = CLIPS.find((c) => c.name === "stack");

async function compare(page, label) {
  await expect.poll(() => page.evaluate(() => window.__deckmaster.settled()), { timeout: 30_000 }).toBe(true);
  const { faces, floors, vp } = await page.evaluate(() => {
    const dm = window.__deckmaster;
    return { faces: dm.scene.faces(), floors: dm.floors(), vp: [innerWidth, innerHeight] };
  });
  const u = designUnit(vp), rows = [];
  for (const [id, f] of Object.entries(floors)) {
    const face = faces[id];
    if (!face || !face.visible || face.kind !== "unit") continue;
    const audit = floorFor({ role: f.role, mine: f.mine, stands: face.standing }, u);
    rows.push({ id, drawn: face.width, planned: f.width, audit, engine: f.floor, standing: face.standing });
  }
  expect(rows.length, label).toBeGreaterThan(30);
  // Lying creatures and turned ones are on this board, so the rule that tells them apart is exercised.
  expect(rows.some((r) => !r.standing && floors[r.id].role === "creature"), label).toBe(true);
  // (A card the moment highlights, the spell's target, is drawn a step toward the eye: up to a pixel wider, never narrower.)
  const off = rows.filter((r) => r.drawn - r.planned < -0.5 || r.drawn - r.planned > 1 || Math.abs(r.audit - r.engine) > 1e-9 || r.drawn < r.audit - 1e-6);
  expect(off, `${label}: drawn face vs plan, audit floor vs engine floor`).toEqual([]);
}

for (const [width, height] of [[1180, 820], [1210, 834]])
  test.describe(`${width} x ${height}`, () => {
    test.use({ viewport: { width, height }, deviceScaleFactor: 2 });
    test("the recorder's floors are the engine's", async ({ page }) => {
      test.setTimeout(120_000);
      await page.route("**/floors.json", (route) => route.fulfill({ json: { envelopes: [clip.first], catalog: clip.catalog } }));
      await page.goto("/?script=floors.json");
      await page.waitForFunction(() => window.__deckmaster && window.__deckmaster.seats().length > 0, null, { timeout: 30_000 });
      await compare(page, "before the spell");
      await page.evaluate((snap) => window.__deckmaster.script.push(snap), clip.beats[0].push);
      await expect.poll(() => page.evaluate(() => window.__deckmaster.plan().stack.length), { timeout: 30_000 }).toBeGreaterThan(0);
      await compare(page, "the stack up");
      const at = await locate(page, { open: true });
      await page.touchscreen.tap(at.x, at.y);
      await expect.poll(() => page.evaluate(() => window.__deckmaster.plan().part), { timeout: 30_000 }).toBeGreaterThan(0);
      await compare(page, "the stack set aside");
    });
  });
