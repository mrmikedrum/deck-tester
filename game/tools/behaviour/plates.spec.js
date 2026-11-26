const { test, expect } = require("@playwright/test");
const envelope = require("../../../tests/fixtures/protocol/054-play-commander-damage.json");
const catalog = require("../../client/test/model/catalog.json");

test("nameplates and every icon stay on screen without overlapping", async ({ page }) => {
  test.skip(process.env.BEHAVIOUR_CLIENT !== "new", "The nameplates belong to the TypeScript client");
  test.setTimeout(120_000);
  await page.route("**/nameplates.json", route => route.fulfill({ json: { envelopes: [envelope], catalog } }));
  await page.goto("/index.html?script=nameplates.json");
  await expect(page.locator(".l-plate")).toHaveCount(4, { timeout: 30_000 });
  for (const [width, height] of [[1600, 1112], [1180, 820], [1024, 768], [700, 480]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => window.__deckmaster.state().viewport.w), { timeout: 30_000 }).toBe(width);
    const errors = await page.locator(".l-plate").evaluateAll(plates => {
      const rects = plates.map(plate => plate.getBoundingClientRect());
      return plates.flatMap((plate, i) => {
        const box = rects[i], name = plate.dataset.plate, errors = [];
        if (box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight) errors.push(`${name} is off screen`);
        for (const [j, other] of rects.entries()) {
          if (j > i && other.left < box.right && box.left < other.right && other.top < box.bottom && box.top < other.bottom) {
            errors.push(`${name} overlaps ${plates[j].dataset.plate}`);
          }
        }
        for (const part of plate.querySelectorAll(".tab, .fig")) {
          const bounds = part.getBoundingClientRect();
          if (bounds.left < box.left || bounds.right > box.right) errors.push(`${name}'s icons overflow`);
        }
        return errors;
      });
    });
    expect(errors, `${width} × ${height}`).toEqual([]);
  }
});

test("every waiting commander's portrait is a finger's target of its own, partners side by side (review: 1024 × 768)", async ({ page }) => {
  test.skip(process.env.BEHAVIOUR_CLIENT !== "new", "The nameplates belong to the TypeScript client");
  test.setTimeout(120_000);
  // Partners waiting: two in Dack's command zone and two in mine.
  const e = JSON.parse(JSON.stringify(envelope));
  const seat = (n) => e.view.players.find((p) => p.name === n);
  const partner = (id, name, owner) => ({ id, name, owner, controller: owner, type: "Legendary Creature - Human Cleric", commander: true, power: 0, toughness: 2 });
  seat("Dack").command.push(partner(9901, "Tymna the Weaver", "Dack"));
  seat("You").command = [partner(9902, "Thrasios, Triton Hero", "You"), partner(9903, "Kraum, Ludevic's Opus", "You")];
  await page.route("**/partners.json", (route) => route.fulfill({ json: { envelopes: [e], catalog } }));
  await page.goto("/index.html?script=partners.json");
  await expect(page.locator(".l-plate .cmd")).toHaveCount(5, { timeout: 30_000 });
  for (const [width, height] of [[1024, 768], [1180, 820], [1210, 834]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => window.__deckmaster.state().viewport.w), { timeout: 30_000 }).toBe(width);
    await page.waitForTimeout(100);
    const errors = await page.locator(".l-plate .cmd").evaluateAll((cmds) =>
      cmds.flatMap((cmd) => {
        const r = cmd.getBoundingClientRect(), id = cmd.dataset.cmd;
        // What shows of it: up to the next portrait or the bronze over it.
        const next = cmd.nextElementSibling?.getBoundingClientRect();
        const right = next ? Math.min(r.right, next.left) : r.right;
        const out = [];
        if (right - r.left < 44 - 0.5 || r.height < 44 - 0.5) out.push(`${id}: ${(right - r.left).toFixed(1)} × ${r.height.toFixed(1)} px shows`);
        for (const x of [r.left + 2, (r.left + right) / 2, right - 2])
          for (const y of [r.top + 2, (r.top + r.bottom) / 2, r.bottom - 2]) {
            const hit = document.elementFromPoint(x, y)?.closest("[data-cmd]");
            if (hit !== cmd) out.push(`${id}: (${x.toFixed(0)}, ${y.toFixed(0)}) reaches ${hit ? hit.dataset.cmd : "no portrait"}`);
          }
        return out;
      }),
    );
    expect(errors, `${width} × ${height}`).toEqual([]);
  }
});
