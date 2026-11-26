/// <reference types="node" />
import { underClash } from "../reach";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boards, hitTest, planTable, tableInputOf } from "../../../src/layout";
import { pickDrawn } from "../../../src/scene/stage/pick";
import type { TablePlan } from "../../../src/layout";
import { bounds, inQuad } from "../../../src/layout/shape";
import { ARRANGED } from "../../../src/layout/arrange/adapter";
import type { TableModel } from "../../../src/model";
import { modelOf } from "../../../src/model";
import { designModels } from "../../../src/scene/workbench/bench-inputs";
import { catalog, corpusNames, corpusSnapshot, viewerOf } from "../../model/fixtures";

// Steps 6 and 8: every opponent's leaf drawn by the engine. Its seat plan is the engine's (memory and all); every card
// of the seat is in a unit; every unit is reachable: a tap in its place's middle reaches it, as play's hit testing sees
// the table.

const VP = { w: 1180, h: 820 };
const VIEWPORTS = [VP, { w: 1210, h: 834 }, { w: 1366, h: 1024 }, { w: 1024, h: 768 }];
const design = designModels(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")));

function check(model: TableModel, plan: TablePlan, label: string) {
  // every group on the table its own (a leaf's fans and well carry their seat)
  const ids = plan.hits.groups.map((g) => g.id);
  expect(new Set(ids).size, `${label}: unique group ids`).toBe(ids.length);
  const out = [];
  // every opponent still in the game is laid out; one out of it gives its room back (no seat plan)
  for (const st of model.seats.slice(1))
    if (plan.seats.has(st.id)) out.push(...checkSeat(model, plan, st.id, `${label} ${st.id}`));
    else expect(st.out, `${label} ${st.id} is out`).toBe(true);
  return [...out, ...plan.violations.filter((v) => v.seat === null)];
}

function checkSeat(model: TableModel, plan: TablePlan, seat: TableModel["seats"][number]["id"], label: string) {
  const sp = plan.seats.get(seat)!;
  expect(sp.memory.paradigm, label).toBe(ARRANGED);
  const theirs = boards(model).find((b) => b.seat === seat)!.board.cards.map((c) => c.id);
  expect(new Set(sp.home.keys()), label).toEqual(new Set(theirs));
  for (const u of sp.units) {
    if (u.fighting) continue;
    const g = plan.hits.groups.find((x) => x.id === u.id);
    expect(g, `${label} ${u.id} has a hit group`).toBeDefined();
    if (underClash(plan, g!)) continue;
    const b = bounds(g!.quad);
    const hit = hitTest(plan, { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 });
    expect(hit?.id, `${label} ${u.id} is reached in its place`).toBe(u.id);
  }
  return plan.violations.filter((v) => v.seat === seat);
}

describe("every opponent's leaf, drawn by the engine", () => {
  it("the design pass's tables: held, reachable, within the limits, at every supported viewport", () => {
    for (const vp of VIEWPORTS)
      for (const turn of [4, 9, 15]) {
        const m = design.get(turn)!;
        const plan = planTable(tableInputOf(m, { viewport: vp, engine: { draw: true, auditPoses: true } }));
        expect(check(m, plan, `${vp.w} turn ${turn}`), `${vp.w} turn ${turn}`).toEqual([]);
        expect(plan.part).toBe(0);
        // each leaf's own audit, at rest and parted at the most
        for (const [seat, l] of plan.leaves!) {
          expect(l.result!.fit.report.violations, `${vp.w} turn ${turn} ${seat}`).toEqual([]);
          expect(l.result!.fit.report.poses.flatMap((p) => p.violations), `${vp.w} turn ${turn} ${seat} parted`).toEqual([]);
        }
      }
  });

  it("a seat that leaves gives its room back: three, two and one opponents share the table's width", () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as { stages: { turn: number; envelope: { view: { players: { name: string }[] } } }[]; catalog: unknown };
    const without = (turn: number, gone: readonly string[]): TableModel => {
      const st = structuredClone(raw.stages.find((x) => x.turn === turn)!);
      st.envelope.view.players = st.envelope.view.players.filter((p) => !gone.includes(p.name));
      return designModels({ stages: [st], catalog: raw.catalog }).get(turn)!;
    };
    for (const vp of [VP, { w: 1210, h: 834 }])
      for (const gone of [[], ["Dack"], ["Dack", "Marath"]] as const)
        for (const turn of [4, 9, 15]) {
          const m = without(turn, gone), label = `${vp.w} turn ${turn} without ${gone.join("+") || "anyone"}`;
          const plan = planTable(tableInputOf(m, { viewport: vp, engine: { draw: true } }));
          expect(plan.seats.size, label).toBe(4 - gone.length);
          expect(check(m, plan, label), label).toEqual([]);
          // the leaves span what three did: their outer edges where the four-seat table's are
          const frames = [...plan.leaves!.values()].map((l) => l.result!.fit.frame);
          const left = Math.min(...frames.map((f) => f.anchor.x - f.w / 2)), right = Math.max(...frames.map((f) => f.anchor.x + f.w / 2));
          expect(left, label).toBeCloseTo(-12.58, 1);
          expect(right, label).toBeCloseTo(12.58, 1);
          for (const [seat, l] of plan.leaves!) expect(l.result!.fit.report.violations, `${label} ${seat}`).toEqual([]);
        }
  });

  it("eliminations in a row: the near place stays the camera's, opponents out give their room back, none brought back", () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as { stages: { turn: number; envelope: { view: { players: { name: string }[] } } }[]; catalog: unknown };
    const without = (gone: readonly string[]): TableModel => {
      const st = structuredClone(raw.stages.find((x) => x.turn === 15)!);
      st.envelope.view.players = st.envelope.view.players.filter((p) => !gone.includes(p.name));
      return designModels({ stages: [st], catalog: raw.catalog }).get(15)!;
    };
    let memory: TablePlan["memory"] | null = null;
    const steps: [readonly string[], readonly string[]][] = [
      [[], ["You", "Marath", "Atraxa", "Dack"]],
      [["Dack"], ["You", "Marath", "Atraxa"]],
      // the viewer is out: the near place is still the camera's (its board empty), the opponents still in keep theirs
      [["Dack", "You"], ["You", "Marath", "Atraxa"]],
      [["Dack", "You", "Marath"], ["You", "Atraxa"]],
      // the last opponent out: the game is over, the near place alone (no eliminated seat comes back)
      [["Dack", "You", "Marath", "Atraxa"], ["You"]],
    ];
    for (const [gone, seats] of steps) {
      const m = without(gone), label = `without ${gone.join("+") || "anyone"}`;
      const plan: TablePlan = planTable(tableInputOf(m, { viewport: VP, memory, engine: { draw: true } }));
      expect([...plan.seats.keys()].map(String), label).toEqual(seats);
      expect(check(m, plan, label), label).toEqual([]);
      if (gone.includes("You")) expect(plan.seats.get(m.viewer.perspective)!.units, label).toEqual([]);
      memory = plan.memory;
    }
  });

  it("a waiting commander is never on a leaf, at rest or parted: its nameplate holds it (playtest item 10)", () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as { stages: { turn: number; envelope: { view: Record<string, unknown> } }[]; catalog: unknown };
    const st = structuredClone(raw.stages.find((x) => x.turn === 4)!);
    const spell = { id: 9001, source: { id: 9001, name: "Swords to Plowshares", owner: "Dack", controller: "Dack", type: "Instant", zone: "stack" }, controller: "Dack", spell: true, text: "Swords to Plowshares", targets: [] };
    for (const stack of [[], [spell]]) {
      st.envelope.view = { ...st.envelope.view, stack };
      const m = designModels({ stages: [st], catalog: raw.catalog }).get(4)!;
      expect(m.seats.slice(1).every((s2) => m.zone(s2.id, "command").length > 0)).toBe(true);
      const plan = planTable(tableInputOf(m, { viewport: VP, engine: { draw: true } }));
      if (stack.length) expect(plan.part).toBeGreaterThan(0);
      for (const sp of plan.seats.values()) expect(sp.fixtures.commander, String(sp.seat)).toBeUndefined();
      expect(plan.hits.groups.filter((g) => g.id.startsWith("command:"))).toEqual([]);
    }
  });

  it("the stack held up as the focus moves nothing; set aside it parts the mats (playtest: the mats shifted at every cast)", () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as { stages: { turn: number; envelope: { view: Record<string, unknown> } }[]; catalog: unknown };
    const spell = { id: 9001, source: { id: 9001, name: "Swords to Plowshares", owner: "Dack", controller: "Dack", type: "Instant", zone: "stack" }, controller: "Dack", spell: true, text: "Swords to Plowshares", targets: [] };
    const modelWith = (turn: number, stack: unknown[]) => {
      const st = structuredClone(raw.stages.find((x) => x.turn === turn)!);
      st.envelope.view = { ...st.envelope.view, stack };
      return designModels({ stages: [st], catalog: raw.catalog }).get(turn)!;
    };
    const places = (p: TablePlan) => [...p.seats.values()].flatMap((sp) => [`${sp.seat}:${JSON.stringify(sp.fixtures.page)}`, ...sp.units.map((u) => `${u.id}@${JSON.stringify(u.placement.pos)}`)]);
    for (const turn of [4, 9, 15]) {
      const rest = planTable(tableInputOf(modelWith(turn, []), { viewport: VP, engine: { draw: true } }));
      const held = planTable(tableInputOf(modelWith(turn, [spell]), { viewport: VP, engine: { draw: true }, stackHeld: true }));
      const aside = planTable(tableInputOf(modelWith(turn, [spell]), { viewport: VP, engine: { draw: true } }));
      expect(held.part, `turn ${turn}`).toBe(0);
      expect(places(held), `turn ${turn}`).toEqual(places(rest));
      expect(held.violations.filter((v) => v.group.startsWith("stack:")), `turn ${turn}`).toEqual([]);
      expect(aside.part, `turn ${turn}`).toBeGreaterThan(0);
    }
  });

  it("the plan's rev follows the stack as the focus (review: turn 9, the lower stack entry's controller switched)", () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as { stages: { turn: number; envelope: { view: Record<string, unknown> } }[]; catalog: unknown };
    const spell = (id: number, who: string) => ({ id, source: { id, name: "Swords to Plowshares", owner: who, controller: who, type: "Instant", zone: "stack" }, controller: who, spell: true, text: "Swords to Plowshares", targets: [] });
    const planned = (lower: string) => {
      const st = structuredClone(raw.stages.find((x) => x.turn === 9)!);
      st.envelope.view = { ...st.envelope.view, stack: [spell(9002, "Atraxa"), spell(9001, lower)] };
      return planTable(tableInputOf(designModels({ stages: [st], catalog: raw.catalog }).get(9)!, { viewport: VP, engine: { draw: true } }));
    };
    const a = planned("Marath"), b = planned("Dack"), again = planned("Marath");
    expect(b.stackUp.map((x) => x.quad)).not.toEqual(a.stackUp.map((x) => x.quad));
    expect(b.rev).not.toBe(a.rev);
    expect(again.rev).toBe(a.rev);
  });

  it("a snapshot that changes one seat rebuilds that seat's leaf only: the others are reused as they were", () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as { stages: { turn: number; envelope: { view: { players: { name: string; battlefield: { id: number; tapped?: boolean }[] }[] } } }[]; catalog: unknown };
    const at = (tapDack: boolean): TableModel => {
      const st = structuredClone(raw.stages.find((x) => x.turn === 15)!);
      if (tapDack) {
        const c = st.envelope.view.players.find((p) => p.name === "Dack")!.battlefield[0]!;
        c.tapped = !c.tapped;
      }
      return designModels({ stages: [st], catalog: raw.catalog }).get(15)!;
    };
    let memory: TablePlan["memory"] | null = null;
    let plan: TablePlan | null = null;
    for (let i = 0; i < 3; i++) {
      plan = planTable(tableInputOf(at(false), { viewport: VP, memory, engine: { draw: true } }));
      memory = plan.memory;
    }
    const next = planTable(tableInputOf(at(true), { viewport: VP, memory, engine: { draw: true } }));
    for (const seat of ["Marath", "Atraxa"]) expect(next.leaves!.get(seat as never)!.result, seat).toBe(plan!.leaves!.get(seat as never)!.result);
    expect(next.leaves!.get("Dack" as never)!.result).not.toBe(plan!.leaves!.get("Dack" as never)!.result);
  });

  it("a tap on a stack's count die reaches its stack (review: turn 15, Dack's Spirits), in hitTest and the scene's pick", () => {
    const plan = planTable(tableInputOf(design.get(15)!, { viewport: VP, engine: { draw: true } }));
    const spirits = plan.hits.groups.find((g) => g.seat === ("Dack" as never) && g.id.includes("Spirit"))!;
    expect(hitTest(plan, { x: 889, y: 332 })?.id).toBe(spirits.id);
    expect(pickDrawn(plan, new Map(), { x: 889, y: 332 })?.id).toBe(spirits.id);
  });

  it("a tap on a face reaches that face, never the neighbour whose wider place it is under (review: turn 9)", () => {
    const plan = planTable(tableInputOf(design.get(9)!, { viewport: VP, engine: { draw: true } }));
    expect(hitTest(plan, { x: 931, y: 116 })?.id).toBe("u:c1135");
    // every face's middle, where no face drawn over it covers the point, reaches its own group
    for (const vp of [VP, { w: 1210, h: 834 }])
      for (const turn of [4, 9, 15]) {
        const p = planTable(tableInputOf(design.get(turn)!, { viewport: vp, engine: { draw: true } }));
        for (const g of p.hits.groups) {
          if (!g.face) continue;
          const b = bounds(g.face), mid = { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 };
          const over = p.hits.groups.some((o) => o !== g && o.order >= g.order && inQuad(o.face ?? o.quad, mid.x, mid.y));
          if (!over) expect(hitTest(p, mid)?.id, `${vp.w} turn ${turn} ${g.id}`).toBe(g.id);
        }
      }
  });

  it("the protocol corpus, memory carried from plan to plan", () => {
    let memory: TablePlan["memory"] | null = null;
    for (const n of corpusNames) {
      const snap = corpusSnapshot(n);
      const model = snap.view && modelOf(snap, catalog, viewerOf());
      if (!model || model.seats.length !== 4) continue;
      const plan: TablePlan = planTable(tableInputOf(model, { viewport: VP, memory, engine: { draw: true } }));
      expect(check(model, plan, n), n).toEqual([]);
      memory = plan.memory;
    }
  });
});
