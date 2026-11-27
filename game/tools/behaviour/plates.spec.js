const { test, expect } = require("@playwright/test");
const envelope = require("../../../tests/fixtures/protocol/054-play-commander-damage.json");
const catalog = require("../../client/test/model/catalog.json");

test("nameplates and every icon stay on screen without overlapping", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/nameplates.json", route => route.fulfill({ json: { envelopes: [envelope], catalog } }));
  await page.goto("/?script=nameplates.json");
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

test("partner portraits stay tappable and the full nameplate clears my hand", async ({ page }) => {
  test.setTimeout(120_000);
  // Partners waiting: two in Dack's command zone and two in mine.
  const e = JSON.parse(JSON.stringify(envelope));
  const seat = (n) => e.view.players.find((p) => p.name === n);
  const partner = (id, name, owner) => ({ id, name, owner, controller: owner, type: "Legendary Creature - Human Cleric", commander: true, power: 0, toughness: 2 });
  seat("Dack").command.push(partner(9901, "Tymna the Weaver", "Dack"));
  seat("You").command = [partner(9902, "Thrasios, Triton Hero", "You"), partner(9903, "Kraum, Ludevic's Opus", "You")];
  seat("You").exile = [seat("You").graveyard.pop()];
  // (every opponent with a pair: three pairs along the top still fit at 1024 × 768, the smallest supported)
  seat("Atraxa").command.push(partner(9904, "Ishai, Ojutai Dragonspeaker", "Atraxa"));
  seat("Princess").command = [partner(9905, "Reyhan, Last of the Abzan", "Princess"), partner(9906, "Vial Smasher the Fierce", "Princess")];
  await page.route("**/partners.json", (route) => route.fulfill({ json: { envelopes: [e], catalog } }));
  await page.goto("/?script=partners.json");
  await expect(page.locator(".l-plate .cmd")).toHaveCount(8, { timeout: 30_000 });
  await expect(page.locator(".l-plate.mine .fig")).toHaveCount(5);
  await expect(page.locator(".g-hand .hcard")).toHaveCount(seat("You").hand.length);
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
    // The full plates stay on screen and clear of each other and the hand fan.
    const plates = await page.locator(".l-plate").evaluateAll((ps) => {
      const rs = ps.map((p) => p.getBoundingClientRect());
      const handRight = Math.max(...[...document.querySelectorAll(".g-hand .hcard")].map((c) => c.getBoundingClientRect().right));
      return ps.flatMap((p, i) => [
        ...(rs[i].left < 0 || rs[i].top < 0 || rs[i].right > innerWidth || rs[i].bottom > innerHeight ? [`${p.dataset.plate} off screen`] : []),
        ...(p.classList.contains("mine") && rs[i].left < handRight ? [`${p.dataset.plate} overlaps the hand fan`] : []),
        ...rs.flatMap((o, j) => (j > i && o.left < rs[i].right && rs[i].left < o.right && o.top < rs[i].bottom && rs[i].top < o.bottom ? [`${p.dataset.plate} overlaps ${ps[j].dataset.plate}`] : [])),
      ]);
    });
    expect(plates, `${width} × ${height}`).toEqual([]);
  }
});
