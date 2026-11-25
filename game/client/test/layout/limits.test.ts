import { describe, expect, it } from "vitest";
import { planTable } from "../../src/layout/plan";
import type { TablePlan } from "../../src/layout/plan";
import { audit, seatShapes } from "../../src/layout/shape";
import { randomBoard, resetIds, SEATS, sid } from "./boards";
import type { CardId, SeatId } from "../../src/layout/types";
import { FLOOR, TAB_PX } from "../../src/layout/board";
import { pinhole } from "../../src/layout/projector";
import { reservations } from "../../src/layout/reservations";
import { tableTemplate } from "../../src/layout/template";
import { CH, TAB_H, clearBehind, makeGeo } from "../../src/layout/seat/geometry";

const VIEWPORTS = [
  { w: 1180, h: 820 },
  { w: 1366, h: 1024 },
  { w: 1024, h: 768 },
  { w: 2732, h: 2048 },
] as const;
const SIZES = [0, 1, 3, 8, 15, 24, 33, 45, 60];
const NAMES = SEATS;

function table(seed: number, n: number, vp: { w: number; h: number }): { plan: TablePlan; ids: Map<SeatId, CardId[]> } {
  resetIds(1);
  const ids = new Map<SeatId, CardId[]>();
  const seats = NAMES.map((s, i) => {
    const board = randomBoard(seed * 31 + i, n, s, i === 0);
    ids.set(s, board.cards.map((c) => c.id));
    return { seat: s, board };
  });
  return { plan: planTable({ viewport: vp, mode: "normal", seats, involved: new Set(), settling: false, memory: null, stack: [] }), ids };
}

describe("hard limits and inventory over seeded random boards", () => {
  for (const vp of VIEWPORTS)
    for (const n of SIZES)
      it(`${n} permanents a seat at ${vp.w}x${vp.h}`, () => {
        for (const seed of [1, 2, 3]) {
          const { plan, ids } = table(seed, n, vp);
          // limits: floors, 44 pt patches, nothing covering a name strip, foot or face
          expect(plan.violations, `seed ${seed}`).toEqual([]);
          const again = audit([...plan.seats.values()].flatMap((s, i) => seatShapes(plan.projector, s, i === 0)), vp);
          expect(again).toEqual([]);
          // inventory: every permanent is in exactly one unit
          for (const [seat, want] of ids) {
            const sp = plan.seats.get(seat)!;
            expect([...sp.home.keys()].sort((a, b) => a - b)).toEqual(want.slice().sort((a, b) => a - b));
            const held = sp.units.flatMap((u) => [...u.members, ...u.dressing]);
            expect(new Set(held).size).toBe(held.length);
            for (const u of sp.units) for (const c of [...u.members, ...u.dressing]) expect(sp.home.get(c)).toBe(u.id);
          }
        }
      });

  it("is deterministic and survives a JSON round trip of its memory", () => {
    const a = table(5, 30, VIEWPORTS[0]).plan, b = table(5, 30, VIEWPORTS[0]).plan;
    expect(a.rev).toBe(b.rev);
    for (const m of a.memory.values()) expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    expect(a.seats.get(sid("ana"))!.units.map((u) => u.id)).toEqual(b.seats.get(sid("ana"))!.units.map((u) => u.id));
  });

  it("never folds a lone card of mine while it fits: few cards stay cards", () => {
    const { plan } = table(1, 6, VIEWPORTS[0]);
    for (const s of plan.seats.values()) expect(s.report.folded).toBe(0);
  });
});

describe("the room above a pile on another's page", () => {
  // A title tab is drawn at its size on screen (12 px text, 16.2 px above its card's top), whatever the screen's size:
  // on a small screen the page keeps that much room above the pile, not only the fixed share of a card it keeps on a
  // large one.
  it("is never less than its title tab's height on screen, at any viewport", () => {
    for (const vp of [{ w: 1180, h: 820 }, { w: 1024, h: 768 }, { w: 820, h: 570 }, { w: 700, h: 480 }]) {
      const tpl = tableTemplate(4), proj = pinhole(tpl.camera, vp), g = makeGeo(proj, reservations(vp), FLOOR.theirs);
      for (const slot of tpl.slots.slice(1)) {
        const r = { ...slot, lift: 0 }, s = 1.1, foot = 0.6;
        const behind = clearBehind(g, r, foot, s, CH + TAB_H, TAB_PX);
        const f = g.toWorld(r, 0, r.d / 2 - foot), up = { y: Math.cos(g.pitch), z: -Math.sin(g.pitch) };
        const cardTop = proj.project({ x: f.x, y: f.y + up.y * CH * s, z: f.z + up.z * CH * s }).y;
        const next = proj.project(g.toWorld(r, 0, r.d / 2 - behind)).y;
        expect(cardTop - next, `${vp.w}x${vp.h} ${slot.position}`).toBeGreaterThanOrEqual(TAB_PX);
      }
    }
  });
});
