import { describe, expect, it } from "vitest";
import { planTable } from "../../src/layout/plan";
import type { TablePlan } from "../../src/layout/plan";
import { lines } from "../../src/layout/seat/lines";
import { randomBoard, resetIds, SEATS } from "./boards";
import type { CardId, SeatId } from "../../src/layout/types";

// Battle lines (`?layout=lines`): the same laws as mat (every permanent in exactly one unit, the hard limits as the audit
// measures them), and its own: a head is reached through its file's tail, never alone.
const VP = { w: 1180, h: 820 };
const VIEWPORTS = [VP, { w: 1366, h: 1024 }, { w: 1024, h: 768 }, { w: 2732, h: 2048 }] as const;

function table(
  seed: number,
  n: number,
  memory: TablePlan["memory"] | null = null,
  vp: { w: number; h: number } = VP,
): { plan: TablePlan; ids: Map<SeatId, CardId[]> } {
  resetIds(1);
  const ids = new Map<SeatId, CardId[]>();
  const seats = SEATS.map((s, i) => {
    const board = randomBoard(seed * 31 + i, n, s, i === 0);
    ids.set(
      s,
      board.cards.map((c) => c.id),
    );
    return { seat: s, board };
  });
  return {
    plan: planTable({
      viewport: vp,
      mode: "normal",
      seats,
      involved: new Set(),
      settling: false,
      memory,
      stack: [],
      layout: lines,
    }),
    ids,
  };
}

describe("battle lines", () => {
  for (const vp of VIEWPORTS)
    for (const n of [0, 3, 12, 24, 40])
      it(`${n} permanents a seat at ${vp.w}x${vp.h}: every one in one unit, the limits held`, () => {
        for (const seed of [1, 2, 3]) {
          const { plan, ids } = table(seed, n, null, vp);
          expect(plan.violations, `seed ${seed}`).toEqual([]);
          for (const [seat, want] of ids) {
            const sp = plan.seats.get(seat)!;
            expect([...sp.home.keys()].sort((a, b) => a - b)).toEqual(want.slice().sort((a, b) => a - b));
            // (Nothing this size needs the last resort at the design viewport: the line files and folds instead.)
            if (vp === VP) expect(sp.report.lastResort, `${seat}, seed ${seed}`).toBe(false);
          }
        }
      });

  it("reaches a file's heads through its tail, which holds every one of them", () => {
    const { plan } = table(2, 40);
    const heads = [...plan.seats.values()].flatMap((sp) =>
      sp.units.filter((u) => u.file && u.file.rank > 0 && !u.raised),
    );
    expect(heads.length).toBeGreaterThan(0);
    for (const h of heads) {
      expect(plan.hits.groups.some((g) => g.id === h.id)).toBe(false);
      const tail = plan.hits.groups.find((g) => g.id === `tail:${h.file!.id}`)!;
      expect(tail).toBeDefined();
      for (const id of h.members) expect(tail.members).toContain(id);
    }
  });

  it("keeps each creature in its column from one plan to the next", () => {
    const a = table(4, 30).plan,
      b = table(4, 30, a.memory).plan;
    for (const [seat, sp] of a.seats) {
      const at = (p: TablePlan) =>
        new Map(
          p.seats
            .get(seat)!
            .units.filter((u) => u.file)
            .flatMap((u) => u.members.map((m) => [m, u.file!.id] as const)),
        );
      expect(at(b)).toEqual(at(a));
      void sp;
    }
  });
});
