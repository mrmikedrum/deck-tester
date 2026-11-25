// How long `planTable` takes (docs/game-client-architecture.md "Budgets": 8 ms on the iPad), with the arrangement
// engine's shadow plan of the across leaf on and off, over the named inputs of docs/game-arrangement-engine.md §7.3
// (client/src/scene/workbench/bench-inputs.ts: the same tables the workbench's bench page times in Safari). A
// measurement, not a test: it prints the median, p90 and worst per plan, and what the engine did.
//
//   node --no-warnings --experimental-transform-types tools/bench-plan.mjs [runs] [--json]
//
// It loads the client's TypeScript directly (Node strips the types; tools/ts-hooks.mjs adds the `.ts` the sources
// leave out of their imports).
import "./ts-hooks.mjs";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const { benchInputs, planFrame, VIEWPORT } = await import("../client/src/scene/workbench/bench-inputs.ts");
const { planTable, tableInputOf } = await import("../client/src/layout/index.ts");

const args = process.argv.slice(2);
const json = args.includes("--json");
const runs = Number(args.find((a) => /^\d+$/.test(a)) ?? 200);
const design = JSON.parse(readFileSync(new URL("../../tests/fixtures/boards/design-pass.json", import.meta.url), "utf8"));
const inputs = benchInputs(design);

const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { median: q(s, 0.5), p90: q(s, 0.9), worst: s.at(-1) };
};

/** Plan every frame of an input in order, `runs` plans in all, carrying memory; per-plan times. */
function time(input, shadow) {
  const times = [], plans = [];
  let prev = null, i = 0;
  const one = (f) =>
    shadow
      ? planFrame(f, prev)
      : planTable(tableInputOf(f.model, { viewport: VIEWPORT, mode: "normal", memory: prev?.memory ?? null, settling: f.settling }));
  for (let w = 0; w < 30; w++) prev = one(input.frames[w % input.frames.length]); // warm the JIT
  prev = null;
  for (let r = 0; r < Math.max(runs, input.frames.length); r++) {
    const f = input.frames[i++ % input.frames.length];
    if (i % input.frames.length === 1) prev = null; // each pass over a sequence starts fresh
    const t0 = performance.now();
    const plan = one(f);
    times.push(performance.now() - t0);
    plans.push(plan);
    prev = plan;
  }
  return { times, plans };
}

const rows = [];
for (const input of inputs) {
  const on = time(input, true), off = time(input, false);
  const shadows = on.plans.map((p) => p.shadow).filter(Boolean);
  const fits = shadows.map((s) => s.result?.fit).filter(Boolean);
  const n = (f) => Math.max(...fits.map(f));
  rows.push({
    input: input.name,
    what: input.what,
    plans: on.times.length,
    withShadow: stats(on.times),
    matOnly: stats(off.times),
    engine: {
      policy: [...new Set(shadows.map((s) => s.policy))].join(","),
      errors: shadows.filter((s) => s.error).length,
      units: n((f) => f.units.length),
      candidates: n((f) => f.report.candidates),
      audits: n((f) => f.report.audits + f.report.poses.length),
      violations: n((f) => f.report.violations.length),
      partedViolations: n((f) => f.report.poses.reduce((t, p) => t + p.violations.length, 0)),
      overflow: shadows.filter((s) => s.result?.overflow).length,
    },
  });
}

if (json) console.log(JSON.stringify({ node: process.version, viewport: VIEWPORT, runs, rows }, null, 2));
else {
  const ms = (x) => x.toFixed(2).padStart(6);
  console.log(`planTable at ${VIEWPORT.w}x${VIEWPORT.h}, Node ${process.version}, ${runs} plans per input (ms per plan; budget 8 on the iPad)`);
  console.log("input        with the shadow leaf          mat only                      engine: candidates audits(+poses) units violations parted");
  console.log("             median    p90  worst          median    p90  worst");
  for (const r of rows)
    console.log(
      `${r.input.padEnd(12)} ${ms(r.withShadow.median)} ${ms(r.withShadow.p90)} ${ms(r.withShadow.worst)}        ${ms(r.matOnly.median)} ${ms(r.matOnly.p90)} ${ms(r.matOnly.worst)}          ${String(r.engine.candidates).padStart(4)} ${String(r.engine.audits).padStart(6)} ${String(r.engine.units).padStart(10)} ${String(r.engine.violations).padStart(5)} ${String(r.engine.partedViolations).padStart(6)}  ${r.engine.policy}${r.engine.errors ? ` ERRORS ${r.engine.errors}` : ""}`,
    );
}
