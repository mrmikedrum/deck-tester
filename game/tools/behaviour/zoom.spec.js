// The camera zoom's trial (`?zoom`): a long press on a card zooms the camera onto it; while zoomed,
// and while the camera is still on its way back, a real click on the prompt's pass button sends nothing. Back at the
// table, the next click passes.
const { Table, test, expect, snapshot, withDecision, locate, sleep } = require("./harness.js");

const PASS = { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 };

test.describe("the camera zoom's trial", () => {
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
});

/** A long press: down, held past the hold time on the page's clock, up. */
async function hold(t, at) {
  await t.page.mouse.move(at.x, at.y);
  await t.page.mouse.down();
  await t.step(800);
  await t.page.mouse.up();
  await t.step(800);
}
