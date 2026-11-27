// The stage's pure parts: the motion math, the causality table and its schedule, the backlog's bounds, piles that show
// what has arrived, and the animator's interruption rules. No three.js, no clock.
import { describe, expect, it } from "vitest";
import type { ChangeSet } from "../../src/model";
import type { CardId } from "../../src/protocol";
import {
  Actor,
  BACKLOG,
  Backlog,
  COMMITTED,
  DURATION,
  LOOK,
  NORMAL,
  ORDER,
  STAGGER,
  cubic,
  order,
  paced,
  retitle,
  sampleLeg,
  schedule,
  shownMembers,
  sine,
  spring,
  stackPose,
} from "../../src/scene/stage";
import { STACK_POSE } from "../../src/layout";
import { CH } from "../../src/layout/geometry";
import { corpusSteps } from "./corpus";
import type { FlightPlan, Sample, ScheduleInput } from "../../src/scene/stage";

const at = (x: number, s = 1): Sample => ({ ...LOOK, pos: { x, y: 0, z: 0 }, rx: 0, ry: 0, s });
const id = (n: number) => n as CardId;

function flight(over: Partial<FlightPlan> & Pick<FlightPlan, "key">): FlightPlan {
  const base: Omit<FlightPlan, "phase" | "cohort"> = {
    card: id(1),
    departure: true,
    origin: { from: "piece", piece: "c1" },
    dest: { to: "piece", piece: "c9" },
    face: null,
    token: false,
    motion: "depart",
    rank: 0,
    distance: 0,
    ...over,
  };
  return { ...base, ...order(base), ...over };
}
const input = (f: FlightPlan, more: Partial<ScheduleInput> = {}): ScheduleInput => ({ flight: f, pileLift: false, big: false, afterAbility: false, ...more });

describe("motion math", () => {
  it("eases run 0 to 1 and are symmetric in the middle", () => {
    for (const e of [cubic, sine]) {
      expect(e(0)).toBeCloseTo(0);
      expect(e(1)).toBeCloseTo(1);
      expect(e(0.5)).toBeCloseTo(0.5);
    }
  });
  it("the spring is frame-rate independent and settles without overshoot", () => {
    let a = { x: 0, v: 0 };
    for (let i = 0; i < 30; i++) a = spring(a.x, a.v, 1, 28, 10);
    const b = spring(0, 0, 1, 28, 300);
    expect(a.x).toBeCloseTo(b.x, 9);
    let x = { x: 0, v: 0 };
    for (let i = 0; i < 100; i++) {
      x = spring(x.x, x.v, 1, 28, 16);
      expect(x.x).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(x.x).toBeCloseTo(1, 6);
  });
  it("compressed halves, reduced shortens and never exceeds its cap", () => {
    expect(paced(520, NORMAL)).toBe(520);
    expect(paced(520, { compressed: true, reduced: false })).toBe(520 * BACKLOG.compress);
    expect(paced(5000, { compressed: false, reduced: true })).toBeLessThanOrEqual(200);
  });
});

describe("causality", () => {
  it("is one table, ending in a catch-all", () => {
    expect(ORDER[ORDER.length - 1]!.when(flight({ key: "x" }))).toBe(true);
  });
  it("orders the stack's acts first, departures second, joins with the reflow", () => {
    expect(flight({ key: "cast", motion: "cast", departure: false, origin: { from: "hand", moment: null, pose: null }, dest: { to: "piece", piece: "stack:9" } }).phase).toBe(0);
    expect(flight({ key: "spell", motion: "spell", origin: { from: "piece", piece: "stack:9" } }).phase).toBe(0);
    expect(flight({ key: "ability", motion: "fizzle", card: null, dest: { to: "nowhere", how: "fizzle", seat: null } }).phase).toBe(0);
    expect(flight({ key: "dies" }).phase).toBe(1);
    expect(flight({ key: "join", motion: "join", departure: false, origin: { from: "plate", seat: "A" as never }, dest: { to: "piece", piece: "c5" } }).phase).toBe(2);
  });
  it("staggers a cohort min(140, 700/n) apart, nearest first, after the stack has acted", () => {
    const spell = flight({ key: "s", motion: "spell", origin: { from: "piece", piece: "stack:1" } });
    const deps = [3, 1, 2].map((d, i) => flight({ key: `d${i}`, card: id(10 + i), distance: d }));
    const tl = schedule([input(spell), ...deps.map((f) => input(f))], NORMAL);
    const byKey = new Map(tl.flights.map((f) => [f.key, f]));
    expect(byKey.get("s")!.start).toBe(0);
    const p1 = Math.min(DURATION.spell, 450);
    const step = Math.min(STAGGER.tripStep, STAGGER.tripSpan / 3);
    expect(byKey.get("d1")!.start).toBe(p1); // nearest
    expect(byKey.get("d2")!.start).toBe(p1 + step);
    expect(byKey.get("d0")!.start).toBe(p1 + 2 * step);
    expect(tl.p2).toBe(p1 + 2 * step + DURATION.lift);
  });
  it("a pile's shown face leaves last; compressed drops the stagger", () => {
    const a = flight({ key: "a", rank: 1, distance: 0 }),
      b = flight({ key: "b", card: id(2), distance: 5 });
    const tl = schedule([input(a), input(b)], NORMAL);
    expect(tl.flights.find((f) => f.key === "a")!.start).toBeGreaterThan(tl.flights.find((f) => f.key === "b")!.start);
    const fast = schedule([input(a), input(b)], { compressed: true, reduced: false });
    expect(new Set(fast.flights.map((f) => f.start)).size).toBe(1);
  });
  it("joins are one queue, min(240, 900/n) apart, the pile gaining fewest first", () => {
    const join = (key: string, piece: string, rank: number) =>
      flight({ key, card: id(key.length), motion: "join", departure: false, origin: { from: "plate", seat: "A" as never }, dest: { to: "piece", piece }, rank });
    const tl = schedule([input(join("b1", "p4", 4)), input(join("e", "p1", 1)), input(join("b2", "p4", 4))], NORMAL);
    const starts = tl.flights.map((f) => [f.key, f.start] as const).sort((x, y) => x[1] - y[1]);
    expect(starts[0]![0]).toBe("e");
    expect(starts[1]![1] - starts[0]![1]).toBe(Math.min(STAGGER.joinStep, STAGGER.joinSpan / 3));
  });
});

describe("the backlog", () => {
  const set = (seq: number): ChangeSet => ({ seq, rev: `r${seq}`, changes: [], moments: [], order: "log", involved: new Set() });
  it("takes in order, one when ready", () => {
    const b = new Backlog();
    b.push(set(1), 0);
    b.push(set(2), 0);
    expect(b.take(10, false)).toBeNull();
    const t = b.take(10, true);
    expect(t && t.how !== "collapse" ? t.set.seq : null).toBe(1);
  });
  it("compresses past two waiting or 1.5 s, but never the newest alone", () => {
    const b = new Backlog();
    [1, 2, 3].forEach((s) => b.push(set(s), 0));
    expect(b.take(0, true)?.how).toBe("compressed");
    const c = new Backlog();
    c.push(set(1), 0);
    c.push(set(2), 0);
    expect(c.take(BACKLOG.compressAge + 1, true)?.how).toBe("compressed");
    const d = new Backlog();
    d.push(set(1), 0);
    expect(d.take(BACKLOG.compressAge + 1, true)?.how).toBe("play");
  });
  it("collapses past eight waiting or 3 s", () => {
    const b = new Backlog();
    for (let s = 1; s <= BACKLOG.cutWaiting + 1; s++) b.push(set(s), 0);
    const t = b.take(0, false);
    expect(t?.how).toBe("collapse");
    expect(b.size).toBe(0);
    const c = new Backlog();
    c.push(set(1), 0);
    expect(c.take(BACKLOG.cutAge + 1, false)?.how).toBe("collapse");
  });
  it("ignores a set it has already queued", () => {
    const b = new Backlog();
    b.push(set(2), 0);
    b.push(set(2), 0);
    b.push(set(1), 0);
    expect(b.size).toBe(1);
  });
});

describe("piles show what has arrived", () => {
  it("lose a card when it leaves, gain it when it lands", () => {
    expect(shownMembers([id(1), id(2), id(3)], new Set([id(3)]), [])).toEqual([1, 2]);
    expect(shownMembers([id(1)], new Set(), [id(7)])).toEqual([7, 1]);
  });
  it("titles count what has arrived", () => {
    expect(retitle("Beast 9", 8)).toBe("Beast 8");
    expect(retitle("Lands", 3)).toBe("Lands");
    expect(retitle(null, 3)).toBeNull();
  });
});

describe("the animator", () => {
  it("time comes only from step: a leg lands exactly at its end", () => {
    const a = new Actor(at(0), 0);
    a.go({ t0: 0, dur: 500, path: { k: "ease", ease: "sine" }, to: () => at(10), commit: false }, "replace");
    expect(a.step(250).pos.x).toBeCloseTo(5);
    expect(a.step(500).pos.x).toBe(10);
    expect(a.moving()).toBe(false);
  });
  it("a reflow retargets at once from where it is", () => {
    const a = new Actor(at(0), 0);
    a.go({ t0: 0, dur: 500, path: { k: "ease", ease: "linear" }, to: () => at(10), commit: false }, "replace");
    const mid = a.step(250).pos.x;
    a.go({ t0: 250, dur: 500, path: { k: "ease", ease: "linear" }, to: () => at(-10), commit: false }, "replace");
    expect(a.step(250).pos.x).toBeCloseTo(mid);
    expect(a.step(500).pos.x).toBeCloseTo(mid + (-10 - mid) / 2);
  });
  it("a committed flight past a third finishes before a newer target", () => {
    const a = new Actor(at(0), 0);
    a.go({ t0: 0, dur: 300, path: { k: "ease", ease: "linear" }, to: () => at(3), commit: true }, "replace");
    a.step(200);
    expect(a.committed(200)).toBe(200 / 300 > COMMITTED);
    a.go({ t0: 200, dur: 300, path: { k: "ease", ease: "linear" }, to: () => at(-3), commit: false }, "after");
    expect(a.step(300).pos.x).toBeCloseTo(3);
    expect(a.step(600).pos.x).toBeCloseTo(-3);
  });
  it("a flight whose destination moves follows it", () => {
    let dest = 10;
    const a = new Actor(at(0), 0);
    a.go({ t0: 0, dur: 100, path: { k: "ease", ease: "linear" }, to: () => at(dest), commit: true }, "replace");
    a.step(50);
    dest = 20;
    expect(a.step(100).pos.x).toBe(20);
  });
  it("a flight lifts, arcs and lands at the pile's size", () => {
    const from = at(0, 2),
      to = at(10, 1);
    const path = { k: "flight" as const, lift: 80, rise: 0.15, arc: 0.6, ease: "out2" as const, settle: 0.55, shrinkFrom: 0 };
    expect(sampleLeg(path, from, to, 40 / 600, 600).pos.y).toBeCloseTo(0.075);
    const mid = sampleLeg(path, from, to, 0.5, 600);
    expect(mid.pos.y).toBeGreaterThan(0.15);
    const end = sampleLeg(path, from, to, 1, 600);
    expect(end.pos.x).toBeCloseTo(10);
    expect(end.s).toBeCloseTo(1);
  });
});

describe("the stack's height", () => {
  const step = corpusSteps()
    .flat()
    .find((s) => s.plan.stack.length > 0)!;
  const proj = step.plan.projector;
  const quad = step.plan.stack[0]!.quad;
  /** How high a stack card's foot (the middle of its lower edge) stands over the table. */
  const foot = (i: number): number => {
    const p = stackPose(proj, quad, i);
    return p.pos.y - proj.up.y * 0.5 * CH * p.s;
  };
  it("stands each card at layout's STACK_POSE height, each under the one before it a step lower", () => {
    for (let i = 0; i < 4; i++) expect(stackPose(proj, quad, i).pos.y).toBeCloseTo(STACK_POSE.raise - STACK_POSE.step * i, 9);
  });
  it("never puts a card through the table, however deep the stack; each deeper card still stands lower", () => {
    let last = Infinity;
    for (let i = 0; i < 16; i++) {
      expect(foot(i), `card ${i}`).toBeGreaterThan(0);
      const y = stackPose(proj, quad, i).pos.y;
      expect(y, `card ${i}`).toBeLessThan(last);
      last = y;
    }
  });
});
