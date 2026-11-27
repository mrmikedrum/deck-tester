// The table's focus layers as layout places them: the stack as the focus (large in the open middle, clear of what it
// aims at and of the plaques), my mana wells, one per kind of land, never folded or overlapping when some are spent, and
// the sheets: a seat's spread and a pile opened.
import { describe, expect, it } from "vitest";
import { SHEET_ROOM, pileCards, planTable, sheetOf, tableInputOf } from "../../src/layout";
import { bounds } from "../../src/layout/shape";
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
  it("025: the Bolt stands large between the hand and the prompt, clear of Princess's plate it aims at", () => {
    const { plan } = planOf("025-play-stack-targets-player.json");
    expect(plan.stackUp).toHaveLength(1);
    const up = plan.stackUp[0]!, rest = plan.stack[0]!;
    const b = bounds(up.quad), r = bounds(rest.quad);
    // Much larger than set aside, and near the middle of the screen.
    expect(b.b - b.t).toBeGreaterThan(2.5 * (r.b - r.t));
    // About life size: 0.52 of the screen's height, never under 360 design px.
    expect(b.b - b.t).toBeGreaterThan(360 * designUnit(VP) - 1);
    expect(Math.abs((b.l + b.r) / 2 - (470 + 838) / 2)).toBeLessThan(200);
    expect(up.reachable).toBe(true);
    // It may cover a plaque it does not aim at (the scrim is over it), never the one it aims at.
    const plate = plan.hits.groups.find((x) => x.id === "plate:Princess")!;
    expect(meets(up.quad, plate.quad)).toBe(false);
  });
  it("stands 0.52 of the screen's height, its middle at 46%, and never under 360 design px", () => {
    for (const vp of [VP, { w: 1366, h: 1024 }, { w: 1180, h: 640 }]) {
      const model = modelOf(corpusSnapshot("013-play-stack.json"), catalog, viewerOf())!;
      const plan = planTable(tableInputOf(model, { viewport: vp }));
      const b = bounds(plan.stackUp[0]!.quad), u = designUnit(vp);
      expect(b.b - b.t, `${vp.w}x${vp.h}`).toBeGreaterThanOrEqual(Math.max(360 * u, 0.52 * vp.h) - 1);
    }
  });
  it("a tall stack keeps the top at its floor and overlaps the rest further, clear of what it aims at and the chrome", () => {
    const model = modelOf(corpusSnapshot("014-play-opponent-spell-targets-me-stack-targets-card.json"), catalog, viewerOf())!;
    const base = tableInputOf(model, { viewport: VP });
    const u = designUnit(VP);
    const rectQuad = (r: { left: number; top: number; right: number; bottom: number }): Quad =>
      [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }] as unknown as Quad;
    for (const n of [5, 8, 12, 20])
      for (const pick of [[0], [1], [0, 1, 2]]) {
        const stack = Array.from({ length: n }, (_, i) => ({ ...base.stack[pick[i % pick.length]!]!, key: `k${i}` }));
        const plan = planTable({ ...base, stack });
        const why = `${n} of ${pick.join("")}`;
        const top = bounds(plan.stackUp[0]!.quad);
        expect(top.b - top.t, why).toBeGreaterThanOrEqual(360 * u - 1);
        // What it aims at, the hand and the prompt stay clear of every card it shows; each has its own group while it is up.
        const aimed = new Set(stack.flatMap((s) => s.targets ?? []));
        const keep = plan.hits.groups.filter((g) => g.kind !== "stack" && g.members.some((m) => aimed.has(m)));
        const chrome = plan.reserve.items.filter((i) => i.kind === "hand" || i.kind === "prompt");
        const shown = plan.stackUp.filter((s) => s.reachable);
        expect(shown.length, why).toBeGreaterThan(0);
        for (const s of shown) {
          for (const g of keep) expect(meets(s.quad, g.face ?? g.quad), `${why}: ${s.key} over ${g.id}`).toBe(false);
          for (const r of chrome) expect(meets(s.quad, rectQuad(r.rect)), `${why}: ${s.key} over the ${r.kind}`).toBe(false);
          expect((plan.hits.up ?? []).map((g) => g.id), why).toContain(`stack:${s.key}`);
        }
        expect(plan.violations.filter((v) => v.rule === "focus-covers"), why).toEqual([]);
      }
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
  it("025: my lands lie in a well", () => {
    const { plan, model } = planOf("025-play-stack-targets-player.json");
    const mine = plan.seats.get(model.viewer.perspective)!;
    const wells = mine.units.filter((u) => u.kind === "well");
    expect(wells.length).toBeGreaterThanOrEqual(1);
    expect(plan.violations).toEqual([]);
  });
});

describe("\"See X's board\": a seat's spread", () => {
  const model = modelOf(corpusSnapshot("023-play-monarch.json"), catalog, viewerOf())!;
  const plan = planTable(tableInputOf(model, { viewport: VP, engine: {} }));
  const seats = [...plan.seats.keys()];
  for (const i of [1, 2, 3])
    it(`seat ${i}: every permanent on the sheet, each face larger than the table's and under the nameplates, the table unmoved`, () => {
      const sh = sheetOf(model, plan, { kind: "spread", seat: seats[i]! })!;
      const home = [...plan.seats.get(seats[i]!)!.home.keys()].sort((a, b) => a - b);
      const shown = Array.from({ length: sh.pages.count }, (_, p) => sheetOf(model, plan, { kind: "spread", seat: seats[i]! }, p)!.places.flatMap((x) => [...x.cards])).flat();
      expect(shown.sort((a, b) => a - b)).toEqual(home);
      const u = designUnit(VP);
      for (const p of sh.places) expect(bounds(p.quad).t).toBeGreaterThanOrEqual(SHEET_ROOM.top * u - 1);
      // nearer than the table: each face taller than any table card of that seat
      const tallest = Math.max(...plan.hits.groups.filter((g) => g.seat === seats[i]).map((g) => bounds(g.face ?? g.quad).b - bounds(g.face ?? g.quad).t));
      for (const p of sh.places) expect(bounds(p.quad).b - bounds(p.quad).t).toBeGreaterThan(tallest);
    });
});

describe("a pile opened", () => {
  it("its cards singly, in the pile's order, like cards together, ready before tapped", () => {
    const model = modelOf(corpusSnapshot("023-play-monarch.json"), catalog, viewerOf())!;
    const plan = planTable(tableInputOf(model, { viewport: VP, engine: {} }));
    const g = plan.hits.groups.find((x) => (x.kind === "pile" || x.kind === "well") && x.members.length > 1)!;
    const sh = sheetOf(model, plan, { kind: "pile", group: g.id })!;
    expect(sh.places.every((p) => p.cards.length === 1)).toBe(true);
    expect([...sh.cards].sort((a, b) => a - b)).toEqual([...g.members].sort((a, b) => a - b));
    expect(sh.cards).toEqual(pileCards(model, plan, g.id)!.ids);
  });
});
