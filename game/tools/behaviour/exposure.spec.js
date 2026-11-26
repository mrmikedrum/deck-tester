// The physical table's exposure (the new entry only): a card the combat gathering lifts toward the lamp is lit as it is
// on the table. Atraxa's six attackers on the design pass's turn-15 table, tapped, at rest on their leaf and then
// gathered in a fight: each one's face, as drawn, keeps its mean luminance within a fifth of the same card at rest
// (before the gathering's exposure was matched, the cards nearest the lamp came out up to 1.75 times as bright, milky).
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test, expect, NEW } = require("./harness.js");

const design = JSON.parse(readFileSync(resolve(__dirname, "../../../tests/fixtures/boards/design-pass.json"), "utf8"));
const ATTACKERS = [1019, 1041, 1117, 1169, 1221, 1072];

/** Turn 15 with Atraxa's attackers tapped; `fight`: they attack me (the gathering). */
function table(fight) {
  const e = JSON.parse(JSON.stringify(design.stages.find((s) => s.turn === 15).envelope));
  for (const c of e.view.players.find((p) => p.name === "Atraxa").battlefield) if (ATTACKERS.includes(c.id)) c.tapped = true;
  if (fight) {
    e.v = 16;
    e.view = { ...e.view, active: "Atraxa", phase: "COMBAT_DECLARE_BLOCKERS", priority: "You", combat: { attackers: ATTACKERS.map((id) => ({ id, defender: "You" })), blockers: [] } };
  }
  return e;
}

/** Each attacker's face's mean luminance as drawn (its middle nine tenths), by card; absent when it shows no face. */
async function faces(browser, envelope) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, baseURL: process.env.BEHAVIOUR_BASE });
  const page = await ctx.newPage();
  await page.route("**/exposure-scenario.json", (r) => r.fulfill({ json: { catalog: design.catalog, envelopes: [envelope] } }));
  await page.goto("index.html?script=exposure-scenario.json");
  await page.waitForFunction(() => window.__deckmaster && window.__deckmaster.seats().length > 0, null, { timeout: 30000 });
  for (let calm = 0, end = Date.now() + 20000; Date.now() < end && calm < 6; ) {
    calm = (await page.evaluate(() => window.__deckmaster.settled() && window.__deckmaster.art.pending() === 0)) ? calm + 1 : 0;
    await new Promise((r) => setTimeout(r, 250));
  }
  const png = (await page.screenshot({ type: "png" })).toString("base64");
  const out = await page.evaluate(async ([png, ids]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const px = x.getImageData(0, 0, c.width, c.height).data;
    const drawn = window.__deckmaster.scene.faces();
    const inside = (q, X, Y) => {
      let s = 0;
      for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4], k = (b.x - a.x) * (Y - a.y) - (b.y - a.y) * (X - a.x);
        if (k !== 0) { if (s && Math.sign(k) !== s) return false; s = Math.sign(k); }
      }
      return true;
    };
    const res = {};
    for (const id of ids) {
      const f = drawn[`u:c${id}`];
      if (!f || !f.visible) continue;
      const cx = f.quad.reduce((t, p) => t + p[0], 0) / 4, cy = f.quad.reduce((t, p) => t + p[1], 0) / 4;
      const q = f.quad.map(([X, Y]) => ({ x: cx + (X - cx) * 0.9, y: cy + (Y - cy) * 0.9 }));
      const xs = q.map((p) => p.x), ys = q.map((p) => p.y);
      let sum = 0, n = 0;
      for (let Y = Math.ceil(Math.min(...ys)); Y < Math.max(...ys); Y++)
        for (let X = Math.ceil(Math.min(...xs)); X < Math.max(...xs); X++) {
          if (X < 0 || Y < 0 || X >= c.width || Y >= c.height || !inside(q, X, Y)) continue;
          const i = (Y * c.width + X) * 4;
          sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          n++;
        }
      if (n > 200) res[id] = sum / n;
    }
    return res;
  }, [png, ATTACKERS]);
  await ctx.close();
  return out;
}

test.describe("the physical table's exposure", () => {
  test.skip(!NEW, "the physical table is the new entry's");
  test("a card the gathering lifts toward the lamp keeps its brightness at rest", async ({ browser }) => {
    const rest = await faces(browser, table(false)), gathered = await faces(browser, table(true));
    const both = ATTACKERS.filter((id) => rest[id] !== undefined && gathered[id] !== undefined);
    expect(both.length).toBeGreaterThanOrEqual(4);
    for (const id of both) {
      const ratio = gathered[id] / rest[id];
      expect(ratio, `card ${id}: gathered ${gathered[id].toFixed(1)}, at rest ${rest[id].toFixed(1)}`).toBeGreaterThan(0.8);
      expect(ratio, `card ${id}: gathered ${gathered[id].toFixed(1)}, at rest ${rest[id].toFixed(1)}`).toBeLessThan(1.2);
    }
  });
});
