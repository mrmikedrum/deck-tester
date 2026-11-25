// play is total: over every corpus envelope (as the player and as a spectator), a snapshot and then every kind of act
// (taps on every hit, every button on show, picks, steps, releases, drags, dismissals), deadlines, replies and further
// snapshots never throw (step turns a throw on input into a "play: ... failed" warning, which these tests refuse, and
// lets a throw on a snapshot reach the host as an ingest fault), keep at most
// one answer in flight per stop, only send answers the engine's own check accepts, present consistent stops, and leave
// a state that survives JSON unchanged.
import { afterEach, describe, expect, it, vi } from "vitest";
import { answerProblem } from "../../src/protocol";
import type { CardId, Decision } from "../../src/protocol";
import { present, step } from "../../src/play";
import { play as playKind } from "../../src/play/kinds/play";
import type { Act, Effect, Event, Presentation, State, Target } from "../../src/play";
import { Table, corpusNames, decoded, hitsFor, raw } from "./rig";

/** A small deterministic generator (the walk must replay exactly). */
function lcg(seed: number) {
  let x = seed >>> 0 || 1;
  return (n: number) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return n <= 0 ? 0 : x % n;
  };
}

/** Maps and sets as plain data, to compare presentations. */
const plain = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (_, x: unknown) => (x instanceof Map ? Object.fromEntries(x) : x instanceof Set ? [...x].sort() : x)));

/** Plain data only: what JSON keeps (no maps, sets, functions, undefined in arrays, or non-finite numbers). */
function jsonSafe(v: unknown, path: string): void {
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`${path}: ${v}`);
    return;
  }
  if (Array.isArray(v)) return v.forEach((x, i) => jsonSafe(x, `${path}[${i}]`));
  if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    for (const [k, x] of Object.entries(v)) if (x !== undefined) jsonSafe(x, `${path}.${k}`);
    return;
  }
  throw new Error(`${path}: not plain data (${Object.prototype.toString.call(v)})`);
}

function laws(t: Table, fx: readonly Effect[], where: string, decision: Decision | null, deep = false) {
  for (const e of fx) if (e.kind === "warn") expect(e.text, where).not.toMatch(/^play: /);
  const p: Presentation = present(t.state);
  expect(p.board.stop, where).toBe(p.controls.stop);
  expect(present(t.state), where).toBe(p); // memoised per state
  if (p.controls.stop === null) {
    expect(p.controls.sheet?.kind ?? null, where).not.toBe("chooser");
    expect(p.board.combat, where).toBeNull();
  }
  for (const e of fx) {
    if (e.kind !== "send") continue;
    expect(p.controls.mayAnswer, where).toBe(true);
    expect(e.stop, where).toBe(p.controls.stop); // the answer is for the stop on show, which stays until it is settled
    if ("answer" in e.body && decision) expect(answerProblem(decision, e.body.answer), where).toBeNull();
  }
  expect(() => jsonSafe(t.state, "state"), where).not.toThrow();
  if (deep) {
    const round = JSON.parse(JSON.stringify(t.state)) as State;
    expect(round, where).toEqual(t.state);
    expect(plain(present(round)), where).toEqual(plain(p));
  }
}

const targetsOf = (t: Table): Target[] => {
  const m = t.model;
  if (!m) return [{ nothing: true }];
  const hits = hitsFor(m);
  return [
    { nothing: true },
    ...hits.groups.map((g) => ({ group: g.id, members: g.members })),
    ...[...m.cards.keys()].map((card) => ({ card })),
    ...m.seats.map((s) => ({ seat: s.id })),
  ];
};

function actsFor(t: Table): Act[] {
  const p = present(t.state);
  const buttons = [...(p.controls.prompt?.buttons ?? []), ...(p.controls.sheet?.buttons ?? [])];
  const d = (t.state as unknown as { decision: Decision | null }).decision;
  const n = d?.options.length ?? 3;
  const hand = t.model ? t.model.zone(t.model.viewer.perspective, "hand") : [];
  const pose = { rect: { x: 0, y: 0, w: 10, h: 10 } as never, rotation: 0, scale: 1 };
  const tg = targetsOf(t);
  return [
    ...buttons.map((b): Act => ({ a: "press", button: b.id })),
    { a: "press", button: "no-such-button" },
    ...tg.map((on): Act => ({ a: "tap", on })),
    ...Array.from({ length: n + 2 }, (_, o): Act => ({ a: "pick", option: o })),
    { a: "pick", option: Number.NaN },
    { a: "step", by: 1 },
    { a: "step", by: -1 },
    { a: "step", by: 7.5 },
    ...hand.map((card): Act => ({ a: "release", card, dy: -120, pose, overTable: true })),
    { a: "release", card: 424242 as CardId, dy: -120, pose, overTable: true },
    ...tg.slice(1, 6).flatMap((from) => tg.slice(-5).map((onto): Act => ({ a: "drag", from, onto }))),
    { a: "dismiss" },
  ];
}

describe("play is total over the corpus", () => {
  for (const mayAnswer of [true, false]) {
    it.each(corpusNames)(`%s (mayAnswer ${mayAnswer}): every single act from the adopted stop`, (name) => {
      const base = new Table();
      base.open(name, { mayAnswer });
      const decision = decoded(raw(name)).decision;
      laws(base, [], `${name} open`, decision, true);
      for (const act of actsFor(base)) {
        const t = base.fork();
        const where = `${name} ${JSON.stringify(act)}`;
        const fx = t.act(act);
        laws(t, fx, where, decision);
        // and whatever follows it: the sheet dismissed, time passing, the reply in each of its forms
        const after: Event[] = [
          { t: "act", stamp: { at: t.now, commit: t.commit }, stop: t.stop, act: { a: "dismiss" } },
          { t: "deadline", at: 5000, id: [...t.due.keys()][0] ?? "play/none" },
        ];
        for (const e of after) laws(t, t.feed(e), `${where} then ${e.t}`, decision);
        const token = t.lastSend()?.token;
        if (token !== undefined)
          for (const how of ["applied", "refused", "unseen", "superseded", "lost"] as const) {
            const u = step(t.state, { t: "settled", at: 6000, token, how, reason: null });
            expect(u.effects.filter((e) => e.kind === "send"), where).toEqual([]);
          }
        if (!mayAnswer) expect(t.sends(), where).toEqual([]);
      }
    });
  }

  it.each(corpusNames)("%s: a seeded walk of acts, replies, deadlines, plans and snapshots", (name) => {
    const run = () => {
      const r = lcg(name.length * 7919 + Number(name.slice(0, 3)));
      const t = new Table();
      t.open(name);
      const decision = () => (t.state as unknown as { decision: Decision | null }).decision;
      const out: Effect[] = [];
      let inflight = 0;
      for (let i = 0; i < 80; i++) {
        const roll = r(12);
        let fx: Effect[];
        const d = decision();
        if (roll < 6) {
          const acts = actsFor(t);
          fx = t.act(acts[r(acts.length)]!);
        } else if (roll === 6) fx = t.advance(1000 + r(3000));
        else if (roll === 7) {
          const token = t.lastSend()?.token;
          const hows = ["applied", "refused", "lost"] as const;
          fx = token === undefined ? [] : t.settled(hows[r(3)]!, r(2) ? "no" : null, token);
        } else if (roll === 8) {
          const m = t.model;
          const cards = m ? [...m.cards.keys()].filter((id) => m.cards.get(id)?.zone === "battlefield") : [];
          const start = r(Math.max(1, cards.length - 3));
          fx = t.pile(cards.length > 3 && r(2) ? [cards.slice(start, start + 3)] : []);
        } else if (roll === 9) fx = t.open(name, { continuity: (["same", "advance", "rewind"] as const)[r(3)]! });
        else if (roll === 10) {
          const other = corpusNames[r(corpusNames.length)]!;
          fx = t.open(other, { continuity: (["advance", "newGame", "restart"] as const)[r(3)]! });
        } else fx = t.act({ a: "dismiss" }, r(4) ? t.stop : null);
        laws(t, fx, `${name} walk ${i}`, d, i % 10 === 0);
        for (const e of fx) if (e.kind === "send") inflight++;
        out.push(...fx);
      }
      return { out, inflight };
    };
    const a = run();
    // deterministic: the same walk gives the same effects
    expect(run().out).toEqual(a.out);
  });

  it("at most one answer in flight per stop: sends only after the last one was freed", () => {
    for (const name of corpusNames) {
      const t = new Table();
      t.open(name);
      const acts = actsFor(t);
      let out = 0;
      for (const act of [...acts, ...acts]) {
        const before = t.sends().length;
        t.act(act);
        const sent = t.sends().length - before;
        out += sent;
        expect(sent, `${name} ${JSON.stringify(act)}`).toBeLessThanOrEqual(1);
        expect(out, `${name}: a second answer while the first is out`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("a kind that throws", () => {
  afterEach(() => vi.restoreAllMocks());

  it("while taking a snapshot: the throw reaches the host (its ingest fault), never a silent stale state", () => {
    vi.spyOn(playKind, "start").mockImplementation(() => {
      throw new Error("kind broke");
    });
    const t = new Table();
    expect(() => t.open("009-play-commander-zone.json")).toThrow("kind broke");
  });

  it("while handling an act: a warning, and the state as it was", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    const before = t.state, stop = t.stop;
    vi.spyOn(playKind, "buttons").mockImplementation(() => {
      throw new Error("kind broke");
    });
    const fx = t.feed({ t: "act", stamp: { at: t.now, commit: t.commit }, stop, act: { a: "press", button: "pass" } });
    expect(fx).toEqual([{ kind: "warn", text: expect.stringContaining("kind broke") }]);
    expect(t.state).toBe(before);
  });
});
