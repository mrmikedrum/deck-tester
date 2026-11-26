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
