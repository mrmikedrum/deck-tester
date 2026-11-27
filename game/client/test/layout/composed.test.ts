// The audit is of the composed table as the scene draws it: every seat with its cards acting where they stand, and the
// stack, with draw order (depth, plates over all) deciding what covers what and what a tap reaches.
import { describe, expect, it } from "vitest";
import { TAP_PX } from "../../src/layout/board";
import { hitTest, planTable } from "../../src/layout/plan";
import type { HitGroup, TablePlan } from "../../src/layout/plan";
import { audit, seatShapes } from "../../src/layout/shape";
import type { Quad } from "../../src/layout/shape";
import { cids, stress } from "./boards";
import { reach } from "./reach";

const VP = { w: 1180, h: 820 };
const centre = (q: Quad) => ({ x: q.reduce((t, p) => t + p.x, 0) / 4, y: q.reduce((t, p) => t + p.y, 0) / 4 });

describe("cards acting", () => {
  const plan = planTable(stress(1, 24, 0, VP));
  const acting = [...plan.seats.values()].flatMap((sp) => sp.units.filter((u) => u.acting).map((u) => ({ sp, u })));

  it("stand where they are drawn and are audited there", () => {
    expect(acting.length).toBeGreaterThan(4);
    // one acting card laid over its neighbour: the one under it is covered, and the audit says so
    const { sp, u } = acting.find(({ sp, u }) => sp.units.some((o) => o !== u && !o.acting))!;
    const other = sp.units.find((o) => o !== u && !o.acting)!;
    const over = { ...u, placement: { ...other.placement, pos: { ...other.placement.pos, z: other.placement.pos.z + 0.05 } } };
    const moved = { ...sp, units: sp.units.map((x) => (x === u ? over : x)) };
    const v = audit(seatShapes(plan.projector, moved, sp.seat === "you"), VP);
    expect(v.filter((x) => x.group === other.id).some((x) => x.rule.startsWith("covers-"))).toBe(true);
  });

  it("each has a 44 px patch the picker gives it", () => {
    const r = reach(plan);
    for (const { u } of acting) expect(r.get(u.id)!.side, u.id).toBeGreaterThanOrEqual(TAP_PX);
    expect(plan.violations).toEqual([]);
  });
});

describe("the stack is drawn by depth, like any card", () => {
  const plan = planTable(stress(1, 10, 3, VP));
  const stack = plan.hits.groups.filter((g) => g.kind === "stack");
  const unit = plan.hits.groups.find((g) => g.kind === "card")!;

  it("a seat's card nearer the camera than a stack card is drawn, and tapped, over it", () => {
    const s = stack[0]!;
    const over = (g: HitGroup, order: number): TablePlan => ({ ...plan, hits: { ...plan.hits, groups: plan.hits.groups.map((x) => (x.id === g.id ? { ...x, quad: s.quad, face: s.quad, order } : x)) } });
    expect(hitTest(over(unit, s.order + 1), centre(s.quad))?.id).toBe(unit.id);
    expect(hitTest(over(unit, s.order - 1), centre(s.quad))?.id).toBe(s.id);
  });

  it("the top of the stack is nearest of the stack, and plates are over everything", () => {
    expect(stack.map((g) => g.id)).toEqual(plan.stack.map((s) => `stack:${s.key}`));
    for (let i = 1; i < stack.length; i++) expect(stack[i]!.order).toBeLessThan(stack[i - 1]!.order);
    const plate = plan.hits.groups.find((g) => g.kind === "plate")!;
    for (const g of plan.hits.groups) if (g.kind !== "plate") expect(g.order).toBeLessThan(plate.order);
  });

  it("is audited with the seats: what it covers is a violation of what it covers", () => {
    // A stack laid over a seat's cards (the top card's quad moved onto a unit) breaks the unit's limits, not nothing.
    const shapes = [...plan.seats.values()].flatMap((sp) => seatShapes(plan.projector, sp, sp.seat === "you"));
    const target = shapes.find((x) => x.group === unit.id)!;
    const s = { group: "stack:x", kind: "stack" as const, seat: null, face: target.face, name: target.name, foot: target.foot, order: target.order + 1, floor: 44, width: target.width, members: cids(9) };
    expect(audit([...shapes, s], VP).filter((v) => v.group === unit.id).map((v) => v.rule)).toEqual(expect.arrayContaining(["covers-face", "tap-patch"]));
  });
});
