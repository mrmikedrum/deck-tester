// The camera zoom's trial (`?zoom`, the new entry only): a long press on a card zooms the camera onto it; while zoomed,
// and while the camera is still on its way back, a real click on the prompt's pass button sends nothing. Back at the
// table, the next click passes. A long press on a seat's page raised by its nameplate's Board zooms to that seat.
const { Table, test, expect, NEW, snapshot, withDecision, locate, sleep } = require("./harness.js");

const PASS = { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 };

test.describe("the camera zoom's trial", () => {
  test.skip(!NEW, "the zoom is the new entry's");
  test("zoomed in, the prompt's button only brings the table back: no answer is sent", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1, baseURL: process.env.BEHAVIOUR_BASE });
    const t = new Table(await ctx.newPage());
    await t.install();
    const s = snapshot("main");
    await t.boot(withDecision(s, { ...PASS }), "?zoom");
    const me = s.view.players[0].battlefield.find(c => !/Land/.test(c.type || ""));
    const at = await locate(t.page, { card: me.id });
    // A long press: down, held past the hold time on the page's clock, up.
    await t.page.mouse.move(at.x, at.y);
    await t.page.mouse.down();
    await t.step(800);
    await t.page.mouse.up();
    await t.step(800);
    expect(await t.page.evaluate(() => window.__deckmaster.state().zoom.on)).not.toBeNull();
    t.forget();
    await t.pass();
    await t.quiet(1000);
    expect(t.answers()).toEqual([]);
    expect(await t.page.evaluate(() => window.__deckmaster.state().zoom.on)).toBeNull();
    // Back at the table, the same button passes.
    await t.pass();
    expect((await t.answered(1))[0].answer).toEqual([1]);
    expect(t.errors).toEqual([]);
    await sleep(10);
    await ctx.close();
  });

  test("on the camera's way back, a second click on the pass button sends nothing", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1, baseURL: process.env.BEHAVIOUR_BASE });
    const t = new Table(await ctx.newPage());
    await t.install();
    const s = snapshot("main");
    await t.boot(withDecision(s, { ...PASS }), "?zoom");
    await hold(t, await locate(t.page, { card: s.view.players[0].battlefield.find(c => !/Land/.test(c.type || "")).id }));
    expect(await t.page.evaluate(() => window.__deckmaster.state().zoom.on)).not.toBeNull();
    t.forget();
    await t.pass();                                            // brings the table back: the camera sets off
    await t.step(50);
    await t.pass();                                            // 50 ms into its way back
    await t.quiet(1000);
    expect(t.answers()).toEqual([]);
    await t.step(100);                                         // the frame that drew the table's camera is folded
    expect(await t.page.evaluate(() => window.__deckmaster.state().zoom.drawn)).toBe(false);
    await t.pass();
    expect((await t.answered(1))[0].answer).toEqual([1]);
    expect(t.errors).toEqual([]);
    await sleep(10);
    await ctx.close();
  });

  test("a long press on a page its nameplate's Board raised zooms to that seat", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1, baseURL: process.env.BEHAVIOUR_BASE });
    const t = new Table(await ctx.newPage());
    await t.install();
    await t.boot(withDecision(snapshot("main"), { ...PASS }), "?zoom");
    const pages = () => t.page.evaluate(() => window.__deckmaster.scene.boxes().filter(b => b.kind === "page"));
    const resting = await pages();
    await t.tapPlate("cy");                                    // Dack
    const board = t.page.locator('[data-fk^="board:"]').first();          // "See Dack's board"
    await board.waitFor({ state: "visible", timeout: 3000 });
    const seat = (await board.getAttribute("data-fk")).slice("board:".length);
    const r = await board.boundingBox();
    await t.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    await t.step(1500);
    const now = await pages();
    const raised = now.find(b => b.id === `page:${seat}`), was = resting.find(b => b.id === `page:${seat}`);
    expect(raised.quad).not.toEqual(was.quad);
    // A point on the raised page, off where it rests, with no card or label on it.
    const at = await t.page.evaluate(([q, rest]) => {
      const inside = (q, x, y) => { let s = 0; for (let i = 0; i < 4; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4]; const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c); } } return true; };
      const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
      for (let y = Math.min(...ys) + 4; y < Math.max(...ys); y += 6)
        for (let x = Math.min(...xs) + 4; x < Math.max(...xs); x += 6)
          if (inside(q, x, y) && !inside(rest, x, y) && !window.__deckmaster.scene.pick(x, y) && !window.__deckmaster.scene.under(x, y)) return { x, y };
      return null;
    }, [raised.quad, was.quad]);
    expect(at).not.toBeNull();
    await hold(t, at);
    expect(await t.page.evaluate(() => window.__deckmaster.state().zoom.on)).toEqual({ seat });
    expect(t.errors).toEqual([]);
    await sleep(10);
    await ctx.close();
  });
});

/** A long press: down, held past the hold time on the page's clock, up. */
async function hold(t, at) {
  await t.page.mouse.move(at.x, at.y);
  await t.page.mouse.down();
  await t.step(800);
  await t.page.mouse.up();
  await t.step(800);
}
