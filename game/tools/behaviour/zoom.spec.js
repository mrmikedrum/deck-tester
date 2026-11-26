// The camera zoom's trial (`?zoom`, the new entry only): a long press on a card zooms the camera onto it; while zoomed,
// a real click on the prompt's pass button only brings the table back, and nothing is sent. The next click passes.
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
});
