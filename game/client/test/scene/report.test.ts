// What the stage reports beyond motion: `flying` (cards in flight between zones, layout's `settling`), and a bounded
// history (the recaps and the sets it took) however long the game runs.
import { describe, expect, it } from "vitest";
import type { ChangeSet } from "../../src/model";
import { Stage } from "../../src/scene/stage";
import { corpusSteps, frameOf } from "./corpus";

const runs = corpusSteps();
const FRAME = 16;

describe("flying", () => {
  it("is true exactly while a card is between zones (waiting its turn, on its way, or in a set not yet taken)", () => {
    let flipped = 0;
    for (const run of runs) {
      const stage = new Stage();
      let t = 0;
      for (const step of run) {
        let { report } = stage.show(frameOf(step, [step.set]), (t += FRAME));
        let was = report.flying;
        for (let k = 0; k < 1250; k++) {
          const snap = stage.inspect();
          const carried = snap.flights.some((f) => f.card !== null);
          const waits = snap.backlog.waiting.length > 0 && step.set.changes.some((c) => c.t === "moved");
          expect(report.flying, `${step.name} at ${t}`).toBe(carried || waits);
          if (was && !report.flying) flipped++;
          was = report.flying;
          if (!report.active) break;
          ({ report } = stage.show(frameOf(step, []), (t += FRAME)));
        }
        expect(report.flying, `${step.name} at rest`).toBe(false);
      }
    }
    expect(flipped).toBeGreaterThan(5);
  });

  it("a look that only moves things (a hover's lift) is not flying", () => {
    const step = runs.flat().find((s) => s.plan.hits.groups.some((g) => g.kind === "card"))!;
    const stage = new Stage();
    stage.show(frameOf(step, [step.set], { mode: "cut" }), FRAME);
    const id = step.plan.hits.groups.find((g) => g.kind === "card")!.id;
    const { report } = stage.show(frameOf(step, [], { hover: id }), 2 * FRAME);
    expect(report.active).toBe(true);
    expect(report.flying).toBe(false);
  });
});

describe("bounded history", () => {
  it("keeps the newest recaps and sets taken, however many there were; the report still carries every recap", () => {
    const step = runs[0]![0]!;
    const stage = new Stage();
    let t = 0;
    stage.show(frameOf(step, [step.set]), (t += FRAME));
    const sweeps = (from: number, n: number): ChangeSet[] =>
      Array.from({ length: n }, (_, k) => ({
        seq: from + k,
        rev: `sweep${from + k}`,
        changes: [],
        moments: [{ kind: "sweep", reading: "sweep", changes: [], seats: [], cause: null, detail: null }] as unknown as ChangeSet["moments"],
        order: "log",
        involved: new Set(),
      }));
    let reported = 0;
    let seq = step.set.seq + 1;
    for (let round = 0; round < 10; round++) {
      const { report } = stage.show(frameOf(step, sweeps(seq, 20)), (t += FRAME));
      reported += report.recaps.length;
      seq += 20;
    }
    expect(reported).toBe(200);
    const snap = stage.inspect();
    expect(snap.recaps.length).toBeLessThanOrEqual(64);
    expect(snap.recaps.at(-1)?.seq).toBe(seq - 1);
    expect(snap.backlog.taken.length).toBeLessThanOrEqual(64);
  });
});
