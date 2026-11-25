// Combat on the table, as the scene draws it: the fighters stand in the combat row (layout) and step out along the
// middle and home again (`fight` legs, one after another per seat); what doesn't fight dims; each attack is a lane from
// its attacker to where it lands, following the pieces as they move; unblocked damage strikes the plaque with a bolt per
// attacker; and lanes, bolts and every other effect that moves on its own say so in the report (`ambient`).
import { describe as suite, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import type { CombatPairs } from "../../src/layout";
import { diff, modelOf, seatId } from "../../src/model";
import type { TableModel } from "../../src/model";
import type { BoardCues } from "../../src/play";
import type { CardId } from "../../src/protocol";
import { DIM, NO_FOCUS, Stage, boltPath, describe, fightPath, lanePath, sampleLeg, LOOK } from "../../src/scene/stage";
import type { SceneFrame, Sample } from "../../src/scene/stage";
import { catalog, corpusSnapshot, viewerOf } from "../model/fixtures";
import { NO_CUES } from "./corpus";

const VP = { w: 1180, h: 820 };
const id = (n: number) => n as CardId;
const atraxa = seatId("Atraxa"), princess = seatId("Princess");
const model = (name: string): TableModel => modelOf(corpusSnapshot(name), catalog, viewerOf())!;
const cuesWith = (combat: CombatPairs | null): BoardCues => ({ ...NO_CUES, combat: combat as BoardCues["combat"] });
const frame = (m: TableModel, combat: CombatPairs | null, over: Partial<SceneFrame> = {}): SceneFrame => ({
  model: m,
  plan: planTable(tableInputOf(m, { viewport: VP, combat })),
  changes: [],
  mode: "animate",
  cues: cuesWith(combat),
  focus: NO_FOCUS,
  moments: [],
  hover: null,
  commit: 1,
  ...over,
});
const DRAFT: CombatPairs = { attacks: [{ attacker: id(871), defender: { seat: atraxa } }], blocks: [] };

suite("describe", () => {
  it("an attack draft is a lane from the fighter's piece to the defender's page edge; what doesn't fight dims", () => {
    const m = model("037-attack-poison.json");
    const f = frame(m, DRAFT);
    const d = describe({ model: m, plan: f.plan, cues: f.cues, focus: NO_FOCUS, hover: null });
    expect(d.lanes).toHaveLength(1);
    const l = d.lanes[0]!;
    const fighter = [...d.pieces.values()].find((p) => p.members.includes(id(871)))!;
    expect(l.from).toBe(fighter.id);
    expect(fighter.fight).toBe(true);
    expect("at" in l.to).toBe(true);
    expect(l.blocked).toBe(false);
    const others = [...d.pieces.values()].filter((p) => p.kind === "unit" && !p.fight);
    expect(others.length).toBeGreaterThan(0);
    for (const p of others) expect(p.look.fade).toBeGreaterThanOrEqual(DIM.fightCreature);
    // with no combat, no lane and no dim from it
    const calm = frame(m, null);
    const d0 = describe({ model: m, plan: calm.plan, cues: calm.cues, focus: NO_FOCUS, hover: null });
    expect(d0.lanes).toEqual([]);
    expect([...d0.pieces.values()].some((p) => p.fight)).toBe(false);
  });

  it("a block draft keeps the engine's attackers: the blocked one lands on its blocker's piece (033)", () => {
    const m = model("033-block-attack-on-planeswalker-they-attack.json");
    const draft: CombatPairs = { attacks: [], blocks: [{ blocker: id(818), attacker: id(834) }] };
    const f = frame(m, draft);
    const d = describe({ model: m, plan: f.plan, cues: f.cues, focus: NO_FOCUS, hover: null });
    expect(d.lanes.map((l) => l.attacker).sort()).toEqual([834, 872]);
    const blocked = d.lanes.find((l) => l.attacker === 834)!;
    expect("piece" in blocked.to && d.pieces.get(blocked.to.piece)!.members).toContain(818);
    expect(blocked.blocked).toBe(true);
  });
});

suite("the stage", () => {
  it("a fighter steps out along the middle: its own page's depth first, then across (a `fight` leg)", () => {
    const a: Sample = { ...LOOK, pos: { x: 4, y: 0, z: 3 }, rx: 0, ry: 0, s: 1 };
    const b: Sample = { ...a, pos: { x: -2, y: 0, z: -1 } };
    const up = { x: 0, y: 1, z: 0 };
    const mid = sampleLeg({ k: "fight", out: true, hop: 0, up, wait: 0 }, a, b, 0.5, 500);
    const want = fightPath(a.pos, b.pos, true)(0.5);
    expect(mid.pos.x).toBeCloseTo(want.x, 6);
    expect(mid.pos.z).toBeCloseTo(want.z, 6);
    // going out, it has crossed more of its depth than of the middle by half way
    expect(Math.abs(mid.pos.z - a.pos.z) / 4).toBeGreaterThan(Math.abs(mid.pos.x - a.pos.x) / 6);
    // waiting its turn, it has not set off
    expect(sampleLeg({ k: "fight", out: true, hop: 0.5, up, wait: 0.4 }, a, b, 0.3, 500).pos).toEqual(a.pos);
  });

  it("draws the lane between where its pieces are now, and the fighter on its way out by a fight leg", () => {
    const m = model("037-attack-poison.json");
    const stage = new Stage();
    let t = 1000;
    stage.show(frame(m, null, { mode: "cut" }), t);
    const out = stage.show(frame(m, DRAFT), (t += 16));
    expect(out.view.lanes).toHaveLength(1);
    const piece = stage.inspect().pieces.find((p) => p.members.includes(id(871)))!;
    expect(piece.moving).toBe(true);
    const lane = out.view.lanes[0]!;
    const first = lane.points[0]!;
    const foot = (n: typeof piece.now) => ({ x: n.pos.x, z: n.pos.z - Math.sin(n.rx) * 0.5 * n.s });
    expect(Math.hypot(first.x - foot(piece.now).x, first.z - foot(piece.now).z)).toBeLessThan(0.31);
    expect(out.report.ambient).toBe(true);
    // settled: the lane starts at the fighter where it stands in the row
    let r = out;
    for (let i = 0; i < 200 && r.report.active; i++) r = stage.show(frame(m, DRAFT), (t += 16));
    const now = stage.inspect().pieces.find((p) => p.members.includes(id(871)))!;
    expect(now.moving).toBe(false);
    expect(now.now.pos).toEqual(now.target.pos);
    const p0 = r.view.lanes[0]!.points[0]!;
    expect(Math.hypot(p0.x - foot(now.now).x, p0.z - foot(now.now).z)).toBeCloseTo(0.3, 5);
    // reduced motion holds the effects still
    expect(stage.show(frame(m, DRAFT, { reducedMotion: true }), t + 16).view.still).toBe(true);
  });

  it("unblocked combat damage strikes the plaque with a bolt per attacker, gone after half a second (054)", () => {
    const snap = corpusSnapshot("054-play-commander-damage.json");
    const next = modelOf(snap, catalog, viewerOf())!;
    const at = next.combat!.attackers.filter((a) => a.defending === princess);
    const lost = at.reduce((n, a) => n + (next.cards.get(a.attacker)!.power ?? 0), 0);
    expect(lost).toBeGreaterThan(0);
    const view = snap.view!;
    const before = { ...snap, view: { ...view, players: view.players.map((p) => (p.name === "Princess" ? { ...p, life: p.life + lost } : p)) } };
    const prev = modelOf(before, catalog, viewerOf())!;
    const set = diff(prev, next, 2);
    expect(set.changes.some((c) => c.t === "life")).toBe(true);
    const stage = new Stage();
    let t = 1000;
    stage.show(frame(prev, null, { mode: "cut" }), t);
    const struck = stage.show(frame(next, null, { changes: [set] }), (t += 16));
    expect(struck.view.bolts.map((b) => b.id).sort()).toEqual(at.map((a) => `bolt:${a.attacker}:2`).sort());
    expect(struck.report.active).toBe(true);
    let r = struck;
    for (let i = 0; i < 40; i++) r = stage.show(frame(next, null), (t += 16));
    expect(r.view.bolts).toEqual([]);
    // a loss that is not the attackers' power (life paid, a spell) has no bolt
    const other = { ...snap, view: { ...view, players: view.players.map((p) => (p.name === "Princess" ? { ...p, life: p.life + lost + 1 } : p)) } };
    const s2 = new Stage();
    s2.show(frame(modelOf(other, catalog, viewerOf())!, null, { mode: "cut" }), 0);
    expect(s2.show(frame(next, null, { changes: [diff(modelOf(other, catalog, viewerOf()), next, 3)] }), 16).view.bolts).toEqual([]);
  });

  it("any life lost strikes the plaque with a burst, timed by the frame and gone after 700 ms; a cut strikes nothing", () => {
    const snap = corpusSnapshot("054-play-commander-damage.json");
    const next = modelOf(snap, catalog, viewerOf())!;
    const view = snap.view!;
    const before = modelOf(
      {
        ...snap,
        view: { ...view, players: view.players.map((p) => (p.name === "Princess" ? { ...p, life: p.life + 7 } : p)) },
      },
      catalog,
      viewerOf(),
    )!;
    const stage = new Stage();
    stage.show(frame(before, null, { mode: "cut" }), 1000);
    const struck = stage.show(frame(next, null, { changes: [diff(before, next, 2)] }), 1016);
    expect(struck.view.strikes).toEqual([
      { id: "strike:Princess:2", plate: "plate:Princess", t0: 1016, seed: 2 * 31 + 7 },
    ]);
    expect(struck.report.active).toBe(true);
    expect(stage.show(frame(next, null), 1016 + 690).view.strikes).toHaveLength(1);
    expect(stage.show(frame(next, null), 1016 + 700).view.strikes).toEqual([]);
    const cut = new Stage();
    cut.show(frame(before, null, { mode: "cut" }), 0);
    expect(cut.show(frame(next, null, { mode: "cut", changes: [diff(before, next, 2)] }), 16).view.strikes).toEqual([]);
  });
});

suite("paths", () => {
  it("a lane runs low: from its start, cresting at its apex, down to its end", () => {
    const pts = lanePath({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: -4 }, 0.2);
    expect(pts[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 4, y: 0, z: -4 });
    expect(Math.max(...pts.map((p) => p.y))).toBeLessThanOrEqual(0.2);
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(0.1);
  });
  it("a bolt passes through where its lane landed on its way to the plaque", () => {
    const via = { x: 1, y: 0, z: -2 };
    const pts = boltPath({ x: 0, y: 0, z: 0 }, via, { x: 3, y: 0, z: -6 });
    expect(pts[0]).toMatchObject({ x: 0, y: 0.3, z: 0 });
    expect(pts[pts.length - 1]!.x).toBeCloseTo(3, 6);
    expect(Math.min(...pts.map((p) => Math.hypot(p.x - via.x, p.z - via.z)))).toBeLessThan(0.05);
  });
});
