// The bench page (`workbench.html?only=bench`): `planTable` timed in this browser on the same named inputs as the Node
// bench (tools/bench-plan.mjs), with the arrangement engine's shadow leaf on and off. It is how the 8 ms budget is
// measured on the iPad (docs/game-arrangement-engine.md §7.3): open it there from the Home Screen or Safari, wait for
// "Done", and press "Send to Mac": the results go back to the machine serving the page (POST api/bench, kept under
// .deckmaster/bench/). Over plain http on the network a browser offers no clipboard or share sheet, so the page also
// shows the results in a box to select by hand, and offers Copy and Share only where the browser has them.
import { after, frame, now } from "../../platform";
import type { TablePlan } from "../../layout";
import { VIEWPORT, WARM, benchInputs, course, planFrame, planFrameChanged, planMatOnly } from "./bench-inputs";
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
  /** The same, as if the leaf's cards had just changed (what the engine keeps between plans forgotten). */
  readonly leafChanged: Stats;
  readonly matOnly: Stats;
  readonly engine: { readonly units: number; readonly candidates: number; readonly audits: number; readonly overflow: number; readonly errors: number };
}

const quantile = (xs: readonly number[], p: number): number => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? NaN;


interface EngineDid {
  readonly units: number;
  readonly candidates: number;
  readonly audits: number;
  readonly overflow: boolean;
  readonly error: boolean;
}
/** What the engine did in a plan (kept instead of the plan: holding hundreds of plans would time the collector). */
const did = (p: TablePlan): EngineDid => {
  const f = p.shadow?.result?.fit;
  return { units: f?.units.length ?? 0, candidates: f?.report.candidates ?? 0, audits: f ? f.report.audits + f.report.poses.length : 0, overflow: !!p.shadow?.result?.overflow, error: !!p.shadow?.error };
};

/** Per-plan times over `PLANS` plans of `input` in the shared course (bench-inputs.ts `course`: what Node times), after
 *  WARM to warm the JIT, and batch means over the same course. */
async function time(input: Named, plan: (f: Frame, prev: TablePlan | null) => TablePlan): Promise<{ stats: Stats; plans: EngineDid[] }> {
  const warm = course(input);
  for (let i = 0; i < WARM; i++) {
    const [f, prev] = warm.next();
    warm.keep(plan(f, prev));
    if (i % 50 === 49) await nextFrame();
  }
  const times: number[] = [], plans: EngineDid[] = [];
  const c = course(input);
  for (let i = 0; i < Math.max(PLANS, input.frames.length); i++) {
    const [f, prev] = c.next();
    const t0 = now();
    const p = plan(f, prev);
    times.push(now() - t0);
    plans.push(did(p));
    c.keep(p);
    if (i % 50 === 49) await nextFrame(); // let the page breathe (and draw progress)
  }
  const batches: number[] = [];
  const b = course(input);
  for (let k = 0; k < 8; k++) {
    const t0 = now();
    for (let i = 0; i < BATCH; i++) {
      const [f, prev] = b.next();
      b.keep(plan(f, prev));
    }
    batches.push((now() - t0) / BATCH);
    await nextFrame();
  }
  const s = [...times].sort((x, y) => x - y);
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
    <p style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <button id="b-send" disabled>Send to Mac</button> <button id="b-select">Select all</button>
      <button id="b-copy" hidden>Copy</button> <button id="b-share" hidden>Share</button> <button id="b-run">Run again</button>
      <span id="b-sent" style="color:#a69c8b;font-size:13px"></span>
    </p>
    <textarea id="b-json" readonly style="box-sizing:border-box;width:100%;height:40vh;font:11px/1.4 monospace;background:#120b06;color:#d8cfbf;border:1px solid #3b2717;padding:8px"></textarea>`;
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
    table.innerHTML = `<tr><th align=left>input</th><th>with the shadow leaf: median</th><th>p90</th><th>worst</th><th>batch mean</th><th>leaf changed: median</th><th>worst</th><th>batch mean</th><th>mat only: median</th><th>worst</th><th>batch mean</th><th>engine units</th><th>candidates</th><th>audits</th></tr>`;
    for (const input of inputs) {
      $("b-status").textContent = `Timing ${input.name} (${input.what})…`;
      await wait(50);
      const on = await time(input, planFrame), changed = await time(input, planFrameChanged), off = await time(input, planMatOnly);
      const most = (g: (d: EngineDid) => number) => Math.max(0, ...on.plans.map(g));
      const row: Row = {
        input: input.name,
        what: input.what,
        plans: on.plans.length,
        withShadow: on.stats,
        leafChanged: changed.stats,
        matOnly: off.stats,
        engine: {
          units: most((d) => d.units),
          candidates: most((d) => d.candidates),
          audits: most((d) => d.audits),
          overflow: on.plans.filter((d) => d.overflow).length,
          errors: on.plans.filter((d) => d.error).length,
        },
      };
      rows.push(row);
      const over = (x: number) => (x > 8 ? ` style="color:#e06a4f"` : "");
      table.insertAdjacentHTML(
        "beforeend",
        `<tr><td>${row.input}</td><td align=right${over(row.withShadow.median)}>${ms(row.withShadow.median)}</td><td align=right${over(row.withShadow.p90)}>${ms(row.withShadow.p90)}</td><td align=right${over(row.withShadow.worst)}>${ms(row.withShadow.worst)}</td><td align=right>${ms(row.withShadow.batchMean)}</td><td align=right${over(row.leafChanged.median)}>${ms(row.leafChanged.median)}</td><td align=right${over(row.leafChanged.worst)}>${ms(row.leafChanged.worst)}</td><td align=right>${ms(row.leafChanged.batchMean)}</td><td align=right>${ms(row.matOnly.median)}</td><td align=right>${ms(row.matOnly.worst)}</td><td align=right>${ms(row.matOnly.batchMean)}</td><td align=right>${row.engine.units}</td><td align=right>${row.engine.candidates}</td><td align=right>${row.engine.audits}</td></tr>`,
      );
    }
    last = { userAgent: navigator.userAgent, screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio }, viewport: VIEWPORT, clockResolutionMs: res, plansPerInput: PLANS, budgetMs: 8, rows };
    (root.querySelector("#b-json") as HTMLTextAreaElement).value = JSON.stringify(last, null, 1);
    (root.querySelector("#b-send") as HTMLButtonElement).disabled = false;
    (globalThis as { __bench?: unknown }).__bench = last;
    $("b-status").textContent = "Done. Times are ms per planTable; the budget is 8 ms worst case on the dense board and the combat.";
    document.documentElement.dataset["ready"] = "1";
  };
  $("b-run").onclick = () => void run();
  const text = () => JSON.stringify(last, null, 1);
  const said = (t: string) => ($("b-sent").textContent = t);
  $("b-send").onclick = async () => {
    said("Sending…");
    try {
      // relative: /next/api/bench under the game server, /api/bench under tools/serve.js
      const r = await fetch("api/bench", { method: "POST", headers: { "Content-Type": "application/json" }, body: text() });
      const reply = (await r.json()) as { ok?: boolean; file?: string; error?: string };
      said(r.ok && reply.ok ? `Sent: ${reply.file ?? ""}` : `Not sent: ${reply.error ?? r.status}`);
    } catch (e) {
      said(`Not sent: ${e instanceof Error ? e.message : String(e)} (select all and copy instead)`);
    }
  };
  $("b-select").onclick = () => {
    const t = root.querySelector("#b-json") as HTMLTextAreaElement;
    t.focus();
    t.select();
    t.setSelectionRange(0, t.value.length);
  };
  // Only where the browser has them: a secure page (https, localhost) for the clipboard; a share sheet where offered.
  if (globalThis.isSecureContext && navigator.clipboard) {
    $("b-copy").hidden = false;
    $("b-copy").onclick = () => void navigator.clipboard.writeText(text()).then(() => said("Copied"), () => said("Not copied: select all instead"));
  }
  if (typeof navigator.share === "function") {
    $("b-share").hidden = false;
    $("b-share").onclick = () => void navigator.share({ title: "planTable timings", text: text() }).catch(() => undefined);
  }
  await run();
}
