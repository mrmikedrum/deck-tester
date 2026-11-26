// How long `planTable` takes (docs/game-client-architecture.md "Budgets": 8 ms on the iPad) as the app plans (every
// opponent leaf drawn by the arrangement engine, a fight gathered) and with mat alone, over the named inputs of docs/game-arrangement-engine.md §7.3
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

const { WARM, benchInputs, course, planFrame, planFrameChanged, planMatOnly, VIEWPORT } = await import("../client/src/scene/workbench/bench-inputs.ts");

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

/** What the engine did in a plan (kept instead of the plan: holding hundreds of plans would time the collector). */
const engineOf = (plan) => {
  const ls = [...(plan.leaves?.values() ?? [])], fs = ls.flatMap((l) => (l.result ? [l.result.fit] : []));
  const sum = (f) => fs.reduce((t, x) => t + f(x), 0);
  return { policy: [...new Set(ls.map((l) => l.policy))].join("+"), error: ls.some((l) => !!l.error), overflow: ls.some((l) => !!l.result?.overflow), units: sum((f) => f.units.length), candidates: sum((f) => f.report.candidates), audits: sum((f) => f.report.audits + f.report.poses.length), violations: sum((f) => f.report.violations.length), parted: sum((f) => f.report.poses.reduce((t, p) => t + p.violations.length, 0)), part: plan.part };
};

/** `runs` plans of an input in the shared course (bench-inputs.ts `course`), after WARM to warm the JIT; per-plan times. */
function time(input, plan) {
  const times = [], plans = [];
  const warm = course(input);
  for (let w = 0; w < WARM; w++) {
    const [f, prev] = warm.next();
    warm.keep(plan(f, prev));
  }
  const c = course(input);
  for (let r = 0; r < Math.max(runs, input.frames.length); r++) {
    const [f, prev] = c.next();
    const t0 = performance.now();
    const p = plan(f, prev);
    times.push(performance.now() - t0);
    plans.push(engineOf(p));
    c.keep(p);
  }
  return { times, plans };
}

const rows = [];
for (const input of inputs) {
  const on = time(input, planFrame), changed = time(input, planFrameChanged), off = time(input, planMatOnly);
  const e = on.plans;
  const n = (k) => Math.max(...e.map((x) => x[k]));
  rows.push({
    input: input.name,
    what: input.what,
    plans: on.times.length,
    withShadow: stats(on.times),
    leafChanged: stats(changed.times),
    matOnly: stats(off.times),
    engine: {
      policy: [...new Set(e.map((x) => x.policy))].join(","),
      errors: e.filter((x) => x.error).length,
      units: n("units"),
      candidates: n("candidates"),
      audits: n("audits"),
      violations: n("violations"),
      partedViolations: n("parted"),
      overflow: e.filter((x) => x.overflow).length,
    },
  });
}

if (json) console.log(JSON.stringify({ node: process.version, viewport: VIEWPORT, runs, rows }, null, 2));
else {
  const ms = (x) => x.toFixed(2).padStart(6);
  console.log(`planTable at ${VIEWPORT.w}x${VIEWPORT.h}, Node ${process.version}, ${runs} plans per input (ms per plan; budget 8 on the iPad)`);
  console.log("input        as the app plans        the leaves changed      mat only                engine: estimates units violations");
  console.log("             median   p90 worst       median   p90 worst       median   p90 worst");
  for (const r of rows)
    console.log(
      `${r.input.padEnd(12)} ${ms(r.withShadow.median)}${ms(r.withShadow.p90)}${ms(r.withShadow.worst)}      ${ms(r.leafChanged.median)}${ms(r.leafChanged.p90)}${ms(r.leafChanged.worst)}      ${ms(r.matOnly.median)}${ms(r.matOnly.p90)}${ms(r.matOnly.worst)}       ${String(r.engine.candidates).padStart(4)} ${String(r.engine.units).padStart(5)} ${String(r.engine.violations).padStart(5)}  ${r.engine.policy}${r.engine.errors ? ` ERRORS ${r.engine.errors}` : ""}`,
    );
}
