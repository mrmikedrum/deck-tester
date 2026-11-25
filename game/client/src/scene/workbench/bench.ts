// The bench page (`workbench.html?only=bench`): `planTable` timed in this browser on the same named inputs as the Node
// bench (tools/bench-plan.mjs), with the arrangement engine's shadow leaf on and off. It is how the 8 ms budget is
// measured on the iPad (docs/game-arrangement-engine.md §7.3): open it there from the Home Screen or Safari, wait for
// "done", and send the results (Copy, or `window.__bench` through the Web Inspector).
import { after, frame, now } from "../../platform";
import { planTable, tableInputOf } from "../../layout";
import type { TablePlan } from "../../layout";
import { VIEWPORT, benchInputs, planFrame } from "./bench-inputs";
import type { Frame, Named } from "./bench-inputs";

const design = import.meta.glob<unknown>("../../../../../tests/fixtures/boards/design-pass.json", { import: "default" });

const PLANS = 200;
/** Wait for the next frame, or `ms` (callback-style platform timers, as promises). */
const nextFrame = (): Promise<void> => new Promise((r) => void frame(() => r()));
const wait = (ms: number): Promise<void> => new Promise((r) => void after(ms, r));
const BATCH = 25;

interface Stats {
  readonly median: number;
  readonly p90: number;
  readonly worst: number;
  /** Mean per plan over batches of BATCH (the timer's resolution does not round it away). */
  readonly batchMean: number;
}

interface Row {
  readonly input: string;
  readonly what: string;
  readonly plans: number;
  readonly withShadow: Stats;
  readonly matOnly: Stats;
  readonly engine: { readonly units: number; readonly candidates: number; readonly audits: number; readonly overflow: number; readonly errors: number };
}

const quantile = (xs: readonly number[], p: number): number => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? NaN;

function matOnly(f: Frame, prev: TablePlan | null): TablePlan {
  return planTable(tableInputOf(f.model, { viewport: VIEWPORT, mode: "normal", memory: prev?.memory ?? null, settling: f.settling }));
}

/** Per-plan times over `PLANS` plans of `input`'s frames in order (memory carried), and batch means. */
async function time(input: Named, plan: (f: Frame, prev: TablePlan | null) => TablePlan): Promise<{ stats: Stats; plans: TablePlan[] }> {
  const fs = input.frames;
  let prev: TablePlan | null = null;
  for (let i = 0; i < 20; i++) prev = plan(fs[i % fs.length]!, prev);
  const times: number[] = [], plans: TablePlan[] = [];
  prev = null;
  for (let i = 0; i < Math.max(PLANS, fs.length); i++) {
    if (i % fs.length === 0) prev = null;
    const t0 = now();
    const p = plan(fs[i % fs.length]!, prev);
    times.push(now() - t0);
    plans.push(p);
    prev = p;
    if (i % 50 === 49) await nextFrame(); // let the page breathe (and draw progress)
  }
  const batches: number[] = [];
  prev = null;
  for (let b = 0; b < 8; b++) {
    const t0 = now();
    for (let i = 0; i < BATCH; i++) {
      if ((b * BATCH + i) % fs.length === 0) prev = null;
      prev = plan(fs[(b * BATCH + i) % fs.length]!, prev);
    }
    batches.push((now() - t0) / BATCH);
    await nextFrame();
  }
  const s = [...times].sort((a, b) => a - b);
  return { stats: { median: quantile(s, 0.5), p90: quantile(s, 0.9), worst: s.at(-1) ?? NaN, batchMean: batches.reduce((t, x) => t + x, 0) / batches.length }, plans };
}

/** The smallest step the clock shows (Safari coarsens it, often to 1 ms). */
function resolution(): number {
  let least = Infinity;
  for (let i = 0; i < 200; i++) {
    const a = now();
    let b = now();
    while (b === a) b = now();
    least = Math.min(least, b - a);
  }
  return least;
}

const ms = (x: number): string => x.toFixed(2);

export async function bench(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <h2>Arrangement engine: planTable timings</h2>
    <p id="b-env" style="color:#a69c8b;font-size:13px"></p>
    <p id="b-status">Loading the inputs…</p>
    <style>#b-table td, #b-table th { padding: 2px 10px; } #b-table th { font-weight: 600; }</style>
    <div style="overflow-x:auto"><table id="b-table" style="border-collapse:collapse;font:14px/1.5 Barlow, sans-serif"></table></div>
    <p><button id="b-run">Run again</button> <button id="b-copy">Copy results</button></p>
    <pre id="b-json" style="white-space:pre-wrap;font-size:11px;color:#a69c8b"></pre>`;
  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const load = Object.values(design)[0];
  if (!load) throw new Error("the design pass's boards are missing (tests/fixtures/boards/design-pass.json)");
  const inputs = benchInputs(await load());
  const res = resolution();
  $("b-env").textContent = `${navigator.userAgent} · screen ${screen.width}x${screen.height} @${devicePixelRatio}x · planned at ${VIEWPORT.w}x${VIEWPORT.h} · clock resolution ${res.toFixed(3)} ms · ${PLANS} plans per input`;
  let last: unknown = null;
  const run = async () => {
    const rows: Row[] = [];
    const table = $("b-table");
    table.innerHTML = `<tr><th align=left>input</th><th>with the shadow leaf: median</th><th>p90</th><th>worst</th><th>batch mean</th><th>mat only: median</th><th>worst</th><th>batch mean</th><th>engine units</th><th>candidates</th><th>audits</th></tr>`;
    for (const input of inputs) {
      $("b-status").textContent = `Timing ${input.name} (${input.what})…`;
      await wait(50);
      const on = await time(input, planFrame), off = await time(input, matOnly);
      const fits = on.plans.map((p) => p.shadow?.result?.fit).filter((f) => !!f);
      const most = (g: (f: (typeof fits)[number]) => number) => Math.max(0, ...fits.map(g));
      const row: Row = {
        input: input.name,
        what: input.what,
        plans: on.plans.length,
        withShadow: on.stats,
        matOnly: off.stats,
        engine: {
          units: most((f) => f.units.length),
          candidates: most((f) => f.report.candidates),
          audits: most((f) => f.report.audits + f.report.poses.length),
          overflow: on.plans.filter((p) => p.shadow?.result?.overflow).length,
          errors: on.plans.filter((p) => p.shadow?.error).length,
        },
      };
      rows.push(row);
      const over = (x: number) => (x > 8 ? ` style="color:#e06a4f"` : "");
      table.insertAdjacentHTML(
        "beforeend",
        `<tr><td>${row.input}</td><td align=right${over(row.withShadow.median)}>${ms(row.withShadow.median)}</td><td align=right${over(row.withShadow.p90)}>${ms(row.withShadow.p90)}</td><td align=right${over(row.withShadow.worst)}>${ms(row.withShadow.worst)}</td><td align=right>${ms(row.withShadow.batchMean)}</td><td align=right>${ms(row.matOnly.median)}</td><td align=right>${ms(row.matOnly.worst)}</td><td align=right>${ms(row.matOnly.batchMean)}</td><td align=right>${row.engine.units}</td><td align=right>${row.engine.candidates}</td><td align=right>${row.engine.audits}</td></tr>`,
      );
    }
    last = { userAgent: navigator.userAgent, screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio }, viewport: VIEWPORT, clockResolutionMs: res, plansPerInput: PLANS, budgetMs: 8, rows };
    $("b-json").textContent = JSON.stringify(last, null, 1);
    (globalThis as { __bench?: unknown }).__bench = last;
    $("b-status").textContent = "Done. Times are ms per planTable; the budget is 8 ms worst case on the dense board and the combat.";
    document.documentElement.dataset["ready"] = "1";
  };
  $("b-run").onclick = () => void run();
  $("b-copy").onclick = () => void navigator.clipboard?.writeText(JSON.stringify(last, null, 1));
  await run();
}
