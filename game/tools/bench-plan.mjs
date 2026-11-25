// How long `planTable` takes on the budget's dense board (docs/game-client-architecture.md "Budgets": four seats, about
// 40 permanents each, a stack of four; 8 ms on the iPad). A measurement, not a test: it prints the median and the worst.
//
//   node --no-warnings --experimental-transform-types tools/bench-plan.mjs [runs] [w]x[h] [stack depth]
//
// It loads the client's TypeScript directly (Node strips the types); the resolve hook adds the `.ts` the sources leave
// out of their imports.
import { registerHooks } from "node:module";
import { performance } from "node:perf_hooks";

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (!spec.startsWith(".")) throw e;
      for (const ext of [".ts", "/index.ts"])
        try {
          return next(spec + ext, ctx);
        } catch {
          /* the next */
        }
      throw e;
    }
  },
  // (The package has no "type": the sources are ES modules.)
  load: (url, ctx, next) => next(url, url.endsWith(".ts") ? { ...ctx, format: "module-typescript" } : ctx),
});

const { planTable } = await import("../client/src/layout/index.ts");
const { randomBoard, resetIds, SEATS, cid } = await import("../client/test/layout/boards.ts");

const runs = Number(process.argv[2] ?? 200);
const [w, h] = (process.argv[3] ?? "1180x820").split("x").map(Number);
const viewport = { w, h };
const depth = Number(process.argv[4] ?? 4);

function input(seed) {
  resetIds(1);
  const seats = SEATS.map((s, i) => ({ seat: s, board: randomBoard(seed * 31 + i, 40, s, i === 0) }));
  const stack = Array.from({ length: depth }, (_, i) => ({ key: `s${i}`, card: cid(9000 + i), ability: i % 2 === 1, answers: false }));
  return { viewport, mode: "normal", seats, involved: new Set(), settling: false, memory: null, stack };
}

const seeds = [1, 2, 3, 4, 5];
const inputs = seeds.map(input);
for (let i = 0; i < 30; i++) planTable(inputs[i % inputs.length]); // warm the JIT
const times = [];
for (let i = 0; i < runs; i++) {
  const inp = inputs[i % inputs.length];
  const t0 = performance.now();
  planTable(inp);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
console.log(`planTable ${w}x${h}, 4 seats x 40 permanents, stack of ${depth}, ${runs} runs over ${seeds.length} boards:`);
console.log(`  median ${q(0.5).toFixed(2)} ms   p90 ${q(0.9).toFixed(2)} ms   max ${times.at(-1).toFixed(2)} ms`);
