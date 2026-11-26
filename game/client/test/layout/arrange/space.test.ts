import { describe, expect, it } from "vitest";
import type { ArrangeResult, Container, ContainerMemory } from "../../../src/layout/arrange/contract";
import { NO_ACTING, NO_RELATIONS } from "../../../src/layout/arrange/contract";
import { onFrame, slotFrame } from "../../../src/layout/arrange/frame";
import { LEAN } from "../../../src/layout/arrange/frame";
import { REST } from "../../../src/layout/arrange/moment";
import { readyTapped } from "../../../src/layout/arrange/policies/ready-tapped";
import { works } from "../../../src/layout/arrange/policies/works";
import { arrange } from "../../../src/layout/arrange/solver";
import { pinhole } from "../../../src/layout/projector";
import { tableTemplate } from "../../../src/layout/template";
import type { SeatId, Viewport } from "../../../src/layout/types";
import { prng } from "../boards";
import { CLOCK, ME, THEM, ac, board, resetIds } from "./cards";

// The engine assumes no number of rows or columns (owner, Nov 25: seats come and go during a game, so containers change
// size): rows come from the space and the cards. Over leaves of many sizes, for tables of one to six opponents, and as
// the seat count changes mid-game with memory carried, the guarantees hold and the rows and places vary with the space.

const camera = tableTemplate(4).camera;

/** The far side of the table split among `n` opponents: each leaf turned toward me, as wide as its share, `depth` deep. */
function leaves(n: number, vp: Viewport, depth: number, near = -3.9): Container[] {
  const proj = pinhole(camera, vp);
  const span = 26, w = Math.min(12, span / n - 0.4);
  return Array.from({ length: n }, (_, k) => {
    const t = n === 1 ? 0 : k / (n - 1) - 0.5;
    const yaw = -t * 0.4, x = t * (span - w), z = near - Math.abs(t) * 2.5;
    const base = slotFrame({ position: "across", x, z: z - depth / 2, w, d: depth, yaw });
    const frame = { ...base, anchor: onFrame(base, 0, -0.75), d: depth };
    const top = proj.project(onFrame(frame, 0, depth));
    const seat = `s${k}` as SeatId;
    return {
      id: `rest:${seat}`,
      role: "rest",
      owner: seat,
      viewer: ME,
      frame,
      projector: proj,
      poses: [],
      layer: { kind: "table" },
      stand: { lean: LEAN },
      floors: { creature: 56, any: 44, tapPx: 44 },
      keepouts: [{ on: "screen", rect: { left: top.x - 120, right: top.x + 120, top: 6, bottom: 50 }, kind: "plate" }],
      safe: { left: 0, top: 0, right: vp.w, bottom: vp.h },
      captions: null,
      growth: "fixed",
      entry: `plate:${seat}`,
      paging: null,
    } satisfies Container;
  });
}

const VPS: readonly Viewport[] = [
  { w: 1024, h: 768 },
  { w: 1180, h: 820 },
  { w: 1366, h: 1024 },
];

function arrangeOn(container: Container, seed: number, n: number, memory: ContainerMemory | null = null, policy = readyTapped): ArrangeResult {
  const cards = board(seed, n).map((c) => ({ ...c, controller: container.owner ?? THEM, owner: container.owner ?? THEM }));
  return arrange({ container, cards, relations: NO_RELATIONS, acting: NO_ACTING, moment: REST, policy, memory, clock: CLOCK });
}

/** Every card is in exactly one unit, or named by an overflow; every unit has one target; nothing breaks silently. */
function sound(r: ArrangeResult, ids: readonly number[], label: string) {
  const held = r.fit.units.flatMap((u) => [...u.members, ...u.dressing]);
  const off = r.overflow?.cards ?? [];
  expect(new Set(held).size, label).toBe(held.length);
  expect(new Set([...held, ...off.filter((id) => !held.includes(id))]), label).toEqual(new Set(ids));
  for (const u of r.fit.units) expect(r.fit.targets.filter((t) => t.piece === u.id).length, label).toBe(1);
  if (r.fit.report.violations.length) expect(r.overflow, `${label}: violations must be said`).not.toBeNull();
}

describe("rows and places come from the space and the cards", () => {
  it("one to six opponents, leaves of every depth and viewport: the guarantees hold", () => {
    const rnd = prng(42);
    for (const vp of VPS)
      for (let n = 1; n <= 6; n++)
        for (const depth of [5, 8, 11, 14]) {
          const cs = leaves(n, vp, depth);
          for (const c of cs) {
            const seed = Math.floor(rnd() * 1e6), count = Math.floor(rnd() * 90);
            const r = arrangeOn(c, seed, count, null, rnd() < 0.5 ? readyTapped : works);
            sound(r, board(seed, count).map((x) => x.id), `${vp.w} n${n} d${depth} ${c.id} ${count}`);
            // no row is laid where its cards would break their floor
            expect(r.fit.report.violations.filter((v) => v.rule === "floor"), `${vp.w} n${n} d${depth}`).toEqual([]);
          }
        }
  });

  it("deeper or nearer leaves hold more standing rows, wider ones more places: nothing is a fixed count", () => {
    resetIds(1);
    const crowd = Array.from({ length: 30 }, (_, i) => ac({ name: `Body ${i}`, power: 2 + (i % 5) }));
    const standingRows = new Set<number>(), places = new Set<number>();
    // (A far leaf meets the 56 px floor in two standing rows at most; one brought nearer, in more.)
    for (const n of [1, 2, 3, 4, 5, 6])
      for (const [depth, near] of [[4, -3.9], [7, -3.9], [10, -3.9], [13, -3.9], [16, 1], [16, 3]] as const) {
        const c = leaves(n, VPS[1]!, depth, near)[0]!;
        const r = arrange({ container: c, cards: crowd.map((x) => ({ ...x, controller: c.owner!, owner: c.owner! })), relations: NO_RELATIONS, acting: NO_ACTING, moment: REST, policy: readyTapped, memory: null, clock: CLOCK });
        const stand = r.fit.rows.filter((row) => row.posture === "stand");
        standingRows.add(stand.length);
        if (stand[0]) places.add(stand[0].places);
      }
    expect(Math.max(...standingRows)).toBeGreaterThanOrEqual(3);
    expect(Math.min(...standingRows)).toBeLessThanOrEqual(1);
    expect(places.size).toBeGreaterThanOrEqual(4);
  });

  it("seats come and go mid-game: each leaf is replanned in its new space from its memory, soundly", () => {
    const counts = [3, 4, 5, 2, 1, 3];
    const memory = new Map<string, ContainerMemory>();
    let turn = CLOCK.turn;
    for (const n of counts) {
      turn++;
      for (const c of leaves(n, VPS[1]!, 13)) {
        const r = arrangeOn(c, 7 + Number(c.id.slice(-1)), 40, memory.get(c.id) ?? null);
        sound(r, board(7 + Number(c.id.slice(-1)), 40).map((x) => x.id), `${n} seats ${c.id}`);
        memory.set(c.id, r.fit.memory);
      }
    }
    void turn;
  });
});
