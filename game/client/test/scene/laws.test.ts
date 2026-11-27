// The stage's laws over the protocol corpus (docs "scene: the table", Laws): every card in the model is drawn or counted
// in exactly one piece at rest; every card that left has exactly one departure; a cut leaves nothing in flight; the
// backlog's bounds hold. Consecutive envelopes → modelOf → change sets, played through the stage on a fake clock.
import { describe as group, expect, it } from "vitest";
import type { ChangeSet, TableModel } from "../../src/model";
import type { CardId } from "../../src/protocol";
import { BACKLOG, DRAWN, Stage, describe, poseQuad } from "../../src/scene/stage";
import type { SceneSnapshot } from "../../src/scene/stage";
import { NO_CUES, corpusSteps, frameOf, unplanned } from "./corpus";
import type { Step } from "./corpus";
import { NO_FOCUS } from "../../src/scene/stage";

/** The clash's marks in the chrome (a brand slot, the "more" column): hit groups that are not pieces. */
const CLASH_MARK = /^(slot:|clash:)/;

const runs = corpusSteps();
const steps = runs.flat();
const FRAME = 16;

/** Frames until nothing moves (at most 20 s of them). Returns the time it got to. */
function settle(stage: Stage, step: Step, t: number): number {
  for (let i = 0; i < 1250; i++) {
    t += FRAME;
    const { report } = stage.show(frameOf(step, []), t);
    if (!report.active) return t;
  }
  throw new Error(`${step.name}: still moving after 20 s`);
}

function expectAtRest(snap: SceneSnapshot, model: TableModel, name: string): void {
  expect(snap.flights, `${name}: flights at rest`).toEqual([]);
  // Faces kept for cards gone from the model live only while a flight or a remnant shows them.
  expect(snap.faces, `${name}: fallback faces at rest`).toBe(0);
  const seen = new Map<CardId, string>();
  for (const p of snap.pieces) {
    expect(p.remnant, `${name}: ${p.id} is a remnant at rest`).toBe(false);
    for (const id of p.shown) {
      expect(seen.get(id), `${name}: card ${id} shown by ${p.id} and ${seen.get(id)}`).toBeUndefined();
      seen.set(id, p.id);
    }
    expect([...p.shown].sort(), `${name}: ${p.id} shows its members`).toEqual([...p.members].sort());
    if (p.kind !== "hidden" && p.members.length) expect(p.visible, `${name}: ${p.id} visible`).toBe(true);
    const d = Math.hypot(p.now.pos.x - p.target.pos.x, p.now.pos.y - p.now.lift - p.target.pos.y, p.now.pos.z - p.target.pos.z);
    expect(d, `${name}: ${p.id} at its target`).toBeLessThan(1e-6);
  }
  const counted = onTable(model);
  for (const id of counted) expect(seen.has(id), `${name}: card ${id} (${model.cards.get(id)?.name}, ${model.cards.get(id)?.zone}) drawn or counted`).toBe(true);
  expect(seen.size, `${name}: nothing extra`).toBe(counted.length);
}

/** Every card the table draws or counts: all but graveyards and exile, which are the nameplates' (chrome). */
const onTable = (model: TableModel): CardId[] => [...model.cards.values()].filter((c) => c.zone !== "graveyard" && c.zone !== "exile").map((c) => c.id);

group("describe over the corpus", () => {
  it("has steps to play", () => {
    expect(steps.length).toBeGreaterThan(40);
  });
  it.each(steps.map((s) => [s.name, s] as const))("%s: every card on the table in exactly one piece", (_, s) => {
    const d = describe({ model: s.model, plan: s.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
    const all = [...d.pieces.values()].flatMap((p) => p.members);
    expect(new Set(all).size, "no card twice").toBe(all.length);
    expect(all.length).toBe(onTable(s.model).length);
    for (const id of onTable(s.model)) expect(d.home.has(id)).toBe(true);
    // Every hit group is a piece, with the same members (the scene's targets are layout's); but the clash's brand slots
    // and its "more" column, chrome marks that reach fighters drawn as their own pieces.
    for (const g of s.plan.hits.groups) {
      if (CLASH_MARK.test(g.id)) continue;
      const p = d.pieces.get(g.id);
      expect(p, g.id).toBeDefined();
      if (g.kind !== "plate" && g.kind !== "stack") expect(p!.members.slice(0, g.members.length)).toEqual(g.members);
    }
  });
});

group("the stage over the corpus", () => {
  it.each(runs.map((r, i) => [`run ${i + 1} (${r.length} envelopes)`, r] as const))("%s: at rest every card is drawn or counted exactly once", (_, run) => {
    const stage = new Stage();
    let t = 0;
    for (const step of run) {
      stage.show(frameOf(step, [step.set]), (t += FRAME));
      t = settle(stage, step, t);
      expectAtRest(stage.inspect(), step.model, step.name);
    }
  });

  it.each(runs.map((r, i) => [`run ${i + 1}`, r] as const))("%s: every card that left a drawn piece has exactly one departure", (_, run) => {
    const stage = new Stage();
    let t = 0;
    let checked = 0;
    for (const step of run) {
      const before = stage.inspect();
      const shown = new Set(before.pieces.flatMap((p) => p.shown));
      stage.show(frameOf(step, [step.set]), (t += FRAME));
      const snap = stage.inspect();
      if (snap.cuts && snap.backlog.taken.at(-1)?.how === "cut") {
        t = settle(stage, step, t);
        continue;
      }
      const left = step.set.changes.filter((c): c is Extract<ChangeSet["changes"][number], { t: "moved" }> => c.t === "moved" && c.from !== null && DRAWN.has(c.from) && shown.has(c.card));
      const deps = snap.departures.filter((d) => d.card !== null);
      const keys = deps.map((d) => d.key);
      expect(new Set(keys).size, `${step.name}: one departure per card`).toBe(keys.length);
      expect(deps.map((d) => d.card).sort(), `${step.name}: departures`).toEqual(expect.arrayContaining(left.map((c) => c.card)));
      for (const d of deps) expect(left.some((c) => c.card === d.card) || !shown.has(d.card!), `${step.name}: ${d.key} left`).toBe(true);
      checked += left.length;
      t = settle(stage, step, t);
    }
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it("nothing teleports: a piece moves at most 2 units in a 16 ms frame, except on a cut", () => {
    let worst = 0;
    for (const run of runs) {
      const stage = new Stage();
      let t = 0;
      for (const step of run) {
        let before = new Map(stage.inspect().pieces.map((p) => [p.id, p.now.pos]));
        const cutsBefore = stage.inspect().cuts;
        for (let k = 0; k < 300; k++) {
          const { report } = stage.show(frameOf(step, k === 0 ? [step.set] : []), (t += FRAME));
          const snap = stage.inspect();
          if (snap.cuts === cutsBefore) {
            for (const p of snap.pieces) {
              const b = before.get(p.id);
              if (!b) continue;
              const d = Math.hypot(p.now.pos.x - b.x, p.now.pos.y - b.y, p.now.pos.z - b.z);
              worst = Math.max(worst, d);
              expect(d, `${step.name}: ${p.id} jumped ${d.toFixed(2)}`).toBeLessThan(2);
            }
          }
          before = new Map(snap.pieces.map((p) => [p.id, p.now.pos]));
          if (!report.active) break;
        }
      }
    }
    expect(worst).toBeGreaterThan(0);
  });

  it("a resolved ability leaves from where it stood on the stack without a flare", () => {
    let checked = 0;
    for (const run of runs) {
      const stage = new Stage();
      let t = 0;
      for (const step of run) {
        const before = new Map(stage.inspect().pieces.map((p) => [p.id, p.now.pos]));
        stage.show(frameOf(step, [step.set]), (t += FRAME));
        const abilities = stage.inspect().flights.filter((f) => f.card === null && f.origin.from === "piece");
        const waiting = new Set(abilities.map((f) => f.id));
        for (let k = 0; k < 200 && waiting.size; k++) {
          const { view } = stage.show(frameOf(step, []), (t += FRAME));
          for (const f of abilities) {
            const g = view.ghosts.find((x) => x.id === f.id);
            const at = f.origin.from === "piece" ? before.get(f.origin.piece) : undefined;
            if (!g || !at || !waiting.has(f.id)) continue;
            waiting.delete(f.id);
            // Its first frame: it has barely moved from the stack entry it was; no flare.
            const d = Math.hypot(g.sample.pos.x - at.x, g.sample.pos.z - at.z);
            expect(d, `${step.name}: ${f.key} starts ${d.toFixed(2)} from its stack entry`).toBeLessThan(0.5);
            expect(g.flare).toBeNull();
            checked++;
          }
        }
        t = settle(stage, step, t);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a cut leaves nothing in flight", () => {
    let cutsChecked = 0;
    for (const run of runs) {
      const stage = new Stage();
      let t = 0;
      for (const step of run) {
        stage.show(frameOf(step, [step.set]), (t += FRAME));
        t += 5 * FRAME;
        stage.show(frameOf(step, []), t);
        stage.show(frameOf(step, [], { mode: "cut" }), (t += FRAME));
        const snap = stage.inspect();
        expect(snap.flights, step.name).toEqual([]);
        for (const p of snap.pieces) expect(p.remnant || p.moving, `${step.name}: ${p.id}`).toBe(false);
        expectAtRest(snap, step.model, step.name);
        cutsChecked++;
      }
    }
    expect(cutsChecked).toBeGreaterThan(40);
  });

  it("the backlog compresses past two waiting and collapses past eight, leaving recaps for what must not be missed", () => {
    const run = runs.reduce((a, b) => (b.length > a.length ? b : a));
    const stage = new Stage();
    let t = 0;
    // A first frame (a cut), then the rest all at once, one frame apart: the stage cannot keep up.
    stage.show(frameOf(run[0]!, [run[0]!.set]), (t += FRAME));
    let maxWaiting = 0;
    let compressed = 0;
    let collapsed = 0;
    for (const step of run.slice(1)) {
      stage.show(frameOf(step, [step.set]), (t += FRAME));
      const snap = stage.inspect();
      maxWaiting = Math.max(maxWaiting, snap.backlog.waiting.length);
      compressed = snap.backlog.taken.filter((x) => x.how === "compressed").length;
      collapsed = snap.backlog.taken.filter((x) => x.how === "collapsed").length;
    }
    expect(run.length).toBeGreaterThan(BACKLOG.cutWaiting + 2);
    expect(maxWaiting).toBeLessThanOrEqual(BACKLOG.cutWaiting);
    expect(compressed + collapsed).toBeGreaterThan(0);
    expect(collapsed).toBeGreaterThan(0);
    const last = run[run.length - 1]!;
    settle(stage, last, t);
    expectAtRest(stage.inspect(), last.model, last.name);
    const snap = stage.inspect();
    expect(snap.backlog.consumedSeq).toBe(last.set.seq);
    // Every recap names a set that was compressed or collapsed.
    const how = new Map(snap.backlog.taken.map((x) => [x.seq, x.how]));
    for (const r of snap.recaps) expect(["compressed", "collapsed"]).toContain(how.get(r.seq));
  });

  it("the oldest waiting set collapses past 3 s", () => {
    const run = runs.reduce((a, b) => (b.length > a.length ? b : a));
    const stage = new Stage();
    let t = 0;
    stage.show(frameOf(run[0]!, [run[0]!.set]), (t += FRAME));
    t = settle(stage, run[0]!, t);
    // Two sets in one frame: the second waits; frames stall for 3.1 s (a frozen tab), then one comes.
    stage.show(frameOf(run[2]!, [run[1]!.set, run[2]!.set]), (t += FRAME));
    expect(stage.inspect().backlog.waiting.length).toBe(1);
    stage.show(frameOf(run[2]!, []), t + BACKLOG.cutAge + 100);
    const snap = stage.inspect();
    expect(snap.backlog.waiting.length).toBe(0);
    expect(snap.backlog.taken.at(-1)?.how).toBe("collapsed");
    expect(snap.flights).toEqual([]);
  });
});

group("layout over the corpus", () => {
  it("plans nearly every envelope (the ones it cannot are layout's to fix)", () => {
    expect(unplanned).toEqual([]);
  });
});

group("moments and epochs", () => {
  const run = runs.find((r) => r.some((s) => s.set.changes.some((c) => c.t === "moved" && c.from === "hand" && c.to === "stack")))!;
  const i = run.findIndex((s) => s.set.changes.some((c) => c.t === "moved" && c.from === "hand" && c.to === "stack"));
  const cast = run[i]!.set.changes.find((c): c is Extract<ChangeSet["changes"][number], { t: "moved" }> => c.t === "moved" && c.from === "hand" && c.to === "stack")!;

  it("a card a moment carries starts from its pose, and its moment lands exactly once", () => {
    const stage = new Stage();
    let t = 0;
    stage.show(frameOf(run[i - 1]!, [run[i - 1]!.set]), (t += FRAME));
    t = settle(stage, run[i - 1]!, t);
    const pose = { rect: { left: 300, top: 560, right: 380, bottom: 672 }, rotation: 0, scale: 1 };
    const moments = [{ id: "m1", card: cast.card, pose, owner: "chrome" as const }];
    stage.show(frameOf(run[i]!, [run[i]!.set], { moments }), (t += FRAME));
    const f = stage.inspect().flights.find((x) => x.card === cast.card)!;
    expect(f.origin).toEqual({ from: "hand", moment: "m1", pose });
    expect(f.dest.to).toBe("piece");
    let landed = 0;
    for (let k = 0; k < 200; k++) {
      const { report } = stage.show(frameOf(run[i]!, [], { moments }), (t += FRAME));
      landed += report.landed.filter((m) => m === "m1").length;
    }
    expect(landed).toBe(1);
  });

  // A card a moment carries joins the battlefield (run 2's Island, played as from the hand), then leaves it again
  // before its join is a third done: the moment still ends exactly once.
  const lands = runs[1]!;
  const j = lands.findIndex((s) => s.set.changes.some((c) => c.t === "moved" && c.to === "battlefield" && s.model.cards.get(c.card)?.name === "Island"));
  const land = (lands[j]!.set.changes.find((c) => c.t === "moved" && c.to === "battlefield") as Extract<ChangeSet["changes"][number], { t: "moved" }>).card;
  const leaves = (seq: number): ChangeSet => ({
    seq,
    rev: `${lands[j - 1]!.model.rev}+gone`,
    changes: [{ t: "moved", kind: "vanish", from: "battlefield", to: null, card: land, before: lands[j]!.model.cards.get(land)!, after: null }],
    moments: [],
    order: "log",
    involved: new Set(),
  });
  const pose = { rect: { left: 300, top: 560, right: 380, bottom: 672 }, rotation: 0, scale: 1 };
  const landsOnce = (mode: "animate" | "cut") => {
    const stage = new Stage();
    let t = 0;
    stage.show(frameOf(lands[j - 1]!, [lands[j - 1]!.set]), (t += FRAME));
    t = settle(stage, lands[j - 1]!, t);
    const moments = [{ id: "m1", card: land, pose, owner: "scene" as const }];
    let landed = 0;
    landed += stage.show(frameOf(lands[j]!, [lands[j]!.set], { moments }), (t += FRAME)).report.landed.length;
    expect(stage.inspect().flights.find((f) => f.card === land)?.origin).toMatchObject({ from: "hand", moment: "m1" });
    landed += stage.show(frameOf(lands[j - 1]!, [leaves(lands[j]!.set.seq + 1)], { moments, mode }), (t += FRAME)).report.landed.length;
    for (let k = 0; k < 300; k++) {
      const { report } = stage.show(frameOf(lands[j - 1]!, [], { moments }), (t += FRAME));
      landed += report.landed.filter((m) => m === "m1").length;
      if (!report.active) break;
    }
    expect(landed).toBe(1);
  };
  it("a carried card that leaves again before its flight commits still lands its moment exactly once", () => landsOnce("animate"));
  it("a cut that drops a carried card's flight lands its moment exactly once", () => landsOnce("cut"));

  it("a set older than one already seen starts a new epoch: the table cuts", () => {
    const stage = new Stage();
    let t = 0;
    stage.show(frameOf(run[i]!, [run[i]!.set]), (t += FRAME));
    settle(stage, run[i]!, t);
    // An ordinary set (no reset in it), numbered as a fresh epoch numbers its first.
    const again = { ...run[1]!.set, seq: 1 };
    expect(again.changes.some((c) => c.t === "reset")).toBe(false);
    expect(run[i]!.set.seq).toBeGreaterThan(1);
    const { report } = stage.show(frameOf(run[1]!, [again]), t + 5000);
    // It reports the new epoch's set as consumed, not the old game's newer seq (the app would drop the new sets).
    expect(report.consumedSeq).toBe(1);
    expect(report.consumed).toBe(again.rev);
    const snap = stage.inspect();
    expect(snap.backlog.consumedSeq).toBe(1);
    expect(snap.cuts).toBe(2);
    expect(snap.flights).toEqual([]);
    expectAtRest(snap, run[1]!.model, run[1]!.name);
  });
});

group("the scene's targets are layout's", () => {
  const near = (q: readonly { x: number; y: number }[], r: readonly { x: number; y: number }[]) =>
    Math.max(...q.map((p, k) => Math.hypot(p.x - r[k]!.x, p.y - r[k]!.y)));
  it.each(steps.map((s) => [s.name, s] as const))("%s: at rest a card or a stack entry is drawn on its hit group's face", (_, s) => {
    const d = describe({ model: s.model, plan: s.plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
    for (const g of s.plan.hits.groups) {
      if (CLASH_MARK.test(g.id)) continue;
      const p = d.pieces.get(g.id)!;
      if (g.kind === "stack" || ((g.kind === "card" || g.kind === "pile") && p.look.tap === 0))
        // (a lying pile's top is posed on the page; the view lifts it onto its block, as the engine measured it: under a px)
        expect(near(poseQuad(s.plan.projector, p.pose), g.face ?? g.quad), g.id).toBeLessThan(1);
    }
  });
});
