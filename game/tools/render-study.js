// The render study's stills and frame times (client/render-study.html, docs/game-render-study.md).
//   node tools/render-study.js <outdir> [stills|times|all] [only,names]
// Builds nothing: run `npx vite build` in game/ first. Serves client/dist with the card image cache.
// Stills: Chromium at 2x, 1180 x 820 (the game's design viewport). Times: WebKit headless, the same page, `measure`
// drawing continuously for a few seconds: the median interval between frames and the median cost of a frame drawn and
// finished on the GPU (a pixel read back), which is what an iPad would pay before its own GPU's speed.
const fs = require("fs"), path = require("path");
const pw = require(process.env.PW || "playwright");
const { serve } = require("./serve");

const [outDir = "shots/render-study", what = "all", onlyArg] = process.argv.slice(2);
const only = onlyArg ? new Set(onlyArg.split(",")) : null;
const VIEWPORT = { width: 1180, height: 820 };

const STILLS = [
  ["A-game", "v=A"],
  ["A-lands", "v=A&view=lands"],
  ["A-creatures", "v=A&view=creatures"],
  ["B-game", "v=B"],
  ["B-lands", "v=B&view=lands"],
  ["B-creatures", "v=B&view=creatures"],
  ["C-game", "v=C"],
  ["C-lands", "v=C&view=lands"],
  ["C-creatures", "v=C&view=creatures"],
  ["D-rest", "v=D"],
  ["D-main", "v=D&moment=main"],
  ["D-combat", "v=D&moment=combat"],
  ["D-spell", "v=D&moment=spell"],
  ["D-spell-half", "v=D&moment=spell&t=0.4"],
  ["D-spell-target", "v=D&moment=spell&view=target"],
  ["D-main-creatures", "v=D&moment=main&view=creatures"],
];

const TIMES = [
  ["A", "v=A"],
  ["A live shadows", "v=A&live=1"],
  ["A vsm live", "v=A&shadow=vsm&live=1"],
  ["A 1024 live", "v=A&ssize=1024&live=1"],
  ["B", "v=B"],
  ["C", "v=C"],
  ["C live shadows", "v=C&live=1"],
  ["D spell (focus)", "v=D&moment=spell"],
  ["D main (focus)", "v=D&moment=main"],
  ["D combat (focus)", "v=D&moment=combat"],
];

async function open(browser, base, query, scale) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}render-study.html?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1" || document.documentElement.dataset.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => document.documentElement.dataset.error || null);
  if (err) throw new Error(`${query}: ${err}`);
  return { ctx, page, errors };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { base, server } = await serve(0, { dist: true });
  try {
    if (what === "stills" || what === "all") {
      const browser = await pw.chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
      for (const [name, query] of STILLS) {
        if (only && !only.has(name)) continue;
        const { ctx, page, errors } = await open(browser, base, query, 2);
        const file = path.join(outDir, `${name}.png`);
        await page.screenshot({ path: file });
        console.log(`${file}${errors.length ? `  (${errors.length} errors: ${errors[0]})` : ""}`);
        await ctx.close();
      }
      await browser.close();
    }
    if (what === "times" || what === "all") {
      const browser = await pw.webkit.launch();
      const rows = [];
      for (const [name, query] of TIMES) {
        if (only && !only.has(name)) continue;
        const { ctx, page } = await open(browser, base, query, 2);
        await page.evaluate(() => window.study.measure(1000)); // warm: programs compiled, textures resident
        const r = await page.evaluate(() => window.study.measure(4000));
        rows.push({ name, ...r });
        console.log(`${name.padEnd(18)} frame ${r.cost.toFixed(1)} ms median (${r.mean.toFixed(2)} mean) drawn+finished, interval ${r.interval.toFixed(1)} ms, ${r.frames} frames, ${r.calls} calls, ${r.triangles} tris, shadows ${r.shadowMap}`);
        await ctx.close();
      }
      await browser.close();
      fs.writeFileSync(path.join(outDir, "times.json"), JSON.stringify(rows, null, 2) + "\n");
    }
  } finally {
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
