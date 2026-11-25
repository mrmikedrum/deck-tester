// The table's focus layers as layout places them: the stack as the focus (large in the open middle, clear of what it
// aims at and of the plaques), and my mana wells, one per kind of land, never folded or overlapping when some are spent.
import { describe, expect, it } from "vitest";
import { LEAN_LIFT, carry, leanOf, planTable, siftOf, siftQuad, tableInputOf } from "../../src/layout";
import { leanedUnitAt } from "../../src/layout/focus";
import { bounds, unitShape } from "../../src/layout/shape";
import { designUnit } from "../../src/layout/types";
import type { Quad } from "../../src/layout/shape";
import { modelOf } from "../../src/model";
import { catalog, corpusSnapshot, viewerOf } from "../model/fixtures";

const VP = { w: 1180, h: 820 };
const planOf = (name: string) => {
  const model = modelOf(corpusSnapshot(name), catalog, viewerOf())!;
  return { model, plan: planTable(tableInputOf(model, { viewport: VP })) };
};
const meets = (a: Quad, b: Quad): boolean => {
  const p = bounds(a), q = bounds(b);
  return p.l < q.r && p.r > q.l && p.t < q.b && p.b > q.t;
};

describe("the stack as the table's focus", () => {
  it("025: the Bolt stands large in the middle, clear of Princess's plate it aims at and of every plaque", () => {
    const { plan } = planOf("025-play-stack-targets-player.json");
    expect(plan.stackUp).toHaveLength(1);
    const up = plan.stackUp[0]!, rest = plan.stack[0]!;
    const b = bounds(up.quad), r = bounds(rest.quad);
    // Much larger than set aside, and near the middle of the screen.
    expect(b.b - b.t).toBeGreaterThan(2.5 * (r.b - r.t));
    expect(b.b - b.t).toBeGreaterThan(200);
    expect(Math.abs((b.l + b.r) / 2 - VP.w / 2)).toBeLessThan(200);
    expect(up.reachable).toBe(true);
    for (const g of plan.hits.groups.filter((x) => x.kind === "plate")) expect(meets(up.quad, g.quad), g.id).toBe(false);
  });
  it("every corpus stack: the focus never covers what the stack aims at", () => {
    for (const name of ["013-play-stack.json", "014-play-opponent-spell-targets-me-stack-targets-card.json", "025-play-stack-targets-player.json"]) {
      const { model, plan } = planOf(name);
      const aimed = new Set(model.stack.flatMap((s) => s.targets.flatMap((t) => ("card" in t ? [t.card] : []))));
      const seats = new Set(model.stack.flatMap((s) => s.targets.flatMap((t) => ("seat" in t ? [t.seat] : []))));
      const covered = plan.hits.groups.filter(
        (g) => (g.kind === "plate" ? seats.has(g.seat!) : g.members.some((m) => aimed.has(m))) && plan.stackUp.some((s) => meets(s.quad, g.quad)),
      );
      expect(covered.map((g) => g.id), name).toEqual([]);
    }
  });
});

describe("my wells", () => {
  it("025: a well per kind of land, none folded, though some are spent (a well never lies turned)", () => {
    const { plan, model } = planOf("025-play-stack-targets-player.json");
    const mine = plan.seats.get(model.viewer.perspective)!;
    const wells = mine.units.filter((u) => u.kind === "well");
    expect(wells.length).toBeGreaterThanOrEqual(5);
    expect(wells.every((w) => w.title === null)).toBe(true);
    expect(wells.every((w) => !w.tapped)).toBe(true);
    expect(plan.violations).toEqual([]);
  });
});

describe("leaning in", () => {
  const { plan, model } = planOf("023-play-monarch.json");
  const seats = [...plan.seats.keys()];
  const pageQuad = (seat: (typeof seats)[number], l: ReturnType<typeof leanOf>) => {
    const f = plan.seats.get(seat)!.fixtures.page, c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const lu = (a! * f.w) / 2, lv = (b! * f.d) / 2, p = { x: f.pos.x + lu * c + lv * s, y: 0, z: f.pos.z - lu * s + lv * c };
      return plan.projector.project(l && l.seat === seat ? carry(l, p) : l?.slide?.seat === seat ? { ...p, x: p.x + l.slide.dx } : p);
    }) as unknown as Quad;
  };
  it("not on my own seat", () => expect(leanOf(plan, model.viewer.perspective)).toBeNull());
  for (const i of [1, 2, 3])
    it(`seat ${i}: its page comes up larger, squared to me, above my creatures and under the top bar`, () => {
      const l = leanOf(plan, seats[i]!)!;
      expect(l.to.y).toBe(LEAN_LIFT);
      const q = bounds(pageQuad(seats[i]!, l)), r = bounds(pageQuad(seats[i]!, null));
      expect((q.r - q.l) * (q.b - q.t)).toBeGreaterThan(1.1 * (r.r - r.l) * (r.b - r.t));
      expect(q.t).toBeGreaterThanOrEqual(65);
      const mine = plan.seats.get(seats[0]!)!.units.filter((u) => u.role === "creature").map((u) => plan.hits.groups.find((g) => g.id === u.id)!);
      for (const g of mine) expect(q.b, g.id).toBeLessThanOrEqual(bounds(g.quad).t);
      // a side page never covers the page across's cards (that page slides aside)
      if (i !== 2) {
        const across = plan.hits.groups.filter((g) => g.seat === seats[2]);
        for (const g of across) {
          const moved = g.quad.map((p) => ({ x: p.x + (l.slide ? plan.projector.project({ x: l.slide.dx, y: 0, z: plan.seats.get(seats[2]!)!.fixtures.page.pos.z }).x - plan.projector.project({ x: 0, y: 0, z: plan.seats.get(seats[2]!)!.fixtures.page.pos.z }).x : 0), y: p.y })) as unknown as Quad;
          expect(meets(pageQuad(seats[i]!, l), moved), g.id).toBe(false);
        }
      }
    });
  it("its cards then grow where they stand, up to 1.35, each keeping clear of the others and of the plaque (h.js LEAN_GROW)", () => {
    const u = designUnit(plan.viewport);
    for (const i of [1, 2, 3]) {
      const l = leanOf(plan, seats[i]!)!;
      expect(l.grow, `seat ${i}`).toBeGreaterThanOrEqual(1);
      expect(l.grow).toBeLessThanOrEqual(1.35);
      const sp = plan.seats.get(seats[i]!)!;
      const boxAt = (g: number) =>
        sp.units.map((un) => bounds(unitShape(plan.projector, seats[i]!, un, false, leanedUnitAt(plan.projector, l, un, g)).face));
      const gap = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) => Math.max(b.l - a.r, a.l - b.r, b.t - a.b, a.t - b.b) / u;
      const rest = boxAt(1), grown = boxAt(l.grow);
      for (let a = 0; a < rest.length; a++)
        for (let b = a + 1; b < rest.length; b++) {
          const d = gap(rest[a]!, rest[b]!);
          if (d >= 0) expect(gap(grown[a]!, grown[b]!), `seat ${i}`).toBeGreaterThanOrEqual(Math.min(6, d) - 1e-6);
        }
    }
    // the page across (Dack's) has the room: its cards grow the whole way
    expect(leanOf(plan, seats[2]!)!.grow).toBeCloseTo(1.35, 2);
  });
});

describe("a sift", () => {
  it("fans a pile in rows, inside the screen, each card at least 44 px wide up to 27 cards; tapped ones turned", () => {
    for (const n of [1, 3, 6, 7, 14, 27]) {
      const places = siftOf(VP, Array.from({ length: n }, (_, i) => i % 3 === 0));
      expect(places).toHaveLength(n);
      for (const p of places) {
        expect(p.rect.left).toBeGreaterThanOrEqual(0);
        expect(p.rect.right).toBeLessThanOrEqual(VP.w);
        expect(p.rect.top).toBeGreaterThanOrEqual(0);
        expect(p.rect.bottom).toBeLessThanOrEqual(VP.h);
        expect(p.rect.right - p.rect.left, `${n}`).toBeGreaterThanOrEqual(44);
      }
      expect(places.filter((p) => p.turn !== 0)).toHaveLength(Math.ceil(n / 3));
      // no two overlap
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(meets(siftQuad(places[i]!), siftQuad(places[j]!))).toBe(false);
    }
  });
});
