import { describe, expect, it } from "vitest";
import type { AnswerToken, ScriptedTransport, TransportEvent } from "../../src/transport";
import { scriptedTransport } from "../../src/transport";
import { BODY, corpus } from "./rig";

const T1 = 1 as AnswerToken;
const T2 = 2 as AnswerToken;
const S4 = () => corpus("004-bridge-error-on-a-playing-envelope");
const S6 = () => corpus("009-play-commander-zone");
const S7 = () => corpus("010-play-my-planeswalker-commander");

function rig(autoReply?: Parameters<typeof scriptedTransport>[0]["autoReply"]): { t: ScriptedTransport; at: { now: number } } {
  const at = { now: 100 };
  return { t: scriptedTransport(autoReply ? { clock: () => at.now, autoReply } : { clock: () => at.now }), at };
}
const snaps = (es: TransportEvent[]) => es.flatMap((e) => (e.t === "snapshot" ? [e] : []));

describe("scriptedTransport snapshots", () => {
  it("holds pushed envelopes until started, then releases the first", () => {
    const { t } = rig();
    t.push(S4());
    t.push(S6());
    expect(t.backlog).toBe(2);
    expect(t.out.drain()).toEqual([]);
    t.start(1);
    const got = snaps(t.out.drain());
    expect(got.map((e) => [e.snap.v, e.continuity, e.epoch])).toEqual([[4, "first", 1]]);
    expect(t.backlog).toBe(1);
  });

  it("releases one at a time, in order, as the app acks", () => {
    const { t } = rig();
    t.start(1);
    t.push(S4());
    t.push(S6());
    t.push(S7());
    expect(snaps(t.out.drain()).map((e) => e.snap.v)).toEqual([4]);
    t.ack(1, 4, "took");
    expect(snaps(t.out.drain()).map((e) => [e.snap.v, e.continuity])).toEqual([[6, "advance"]]);
    t.ack(1, 6, "took");
    expect(snaps(t.out.drain()).map((e) => e.snap.v)).toEqual([7]);
    expect(t.backlog).toBe(0);
  });

  it("records every ack", () => {
    const { t } = rig();
    t.start(1);
    t.push(S4());
    t.ack(1, 4, "took");
    t.ack(1, 9, "fault");
    expect(t.acks).toEqual([{ v: 4, ack: "took" }, { v: 9, ack: "fault" }]);
  });

  it("stamps events with the injected clock", () => {
    const { t, at } = rig();
    t.start(1);
    at.now = 777;
    t.push(S4());
    expect(t.out.drain()[0]).toMatchObject({ at: 777, asked: 777 });
  });

  it("a stale ack re-delivers the current snapshot, a fault ack once, then skips", () => {
    const { t } = rig();
    t.start(1);
    t.push(S4());
    t.out.drain();
    t.ack(1, 4, "stale");
    expect(snaps(t.out.drain()).map((e) => e.snap.v)).toEqual([4]);
    t.ack(1, 4, "fault");
    expect(snaps(t.out.drain()).map((e) => e.snap.v)).toEqual([4]);
    t.ack(1, 4, "fault");
    expect(t.out.drain()).toEqual([]);
  });

  it("an undecodable envelope becomes a fault event and the next one still flows", () => {
    const { t } = rig();
    t.start(1);
    t.push({ ...S4(), state: "nonsense" });
    const evs = t.out.drain();
    expect(evs[0]).toMatchObject({ t: "fault", code: "decode", v: 4 });
    t.push(S6());
    expect(snaps(t.out.drain()).map((e) => e.snap.v)).toEqual([6]);
  });

  it("classifies newGame and restart and bumps the epoch", () => {
    const { t } = rig();
    t.start(1);
    t.push(S7());
    t.ack(1, 7, "took");
    t.push({ ...S6(), gen: 2 });
    const a = snaps(t.out.drain());
    expect(a.map((e) => [e.continuity, e.epoch])).toEqual([["first", 1], ["restart", 2]]);
  });

  it("start again resets: queued events cleared, next is first", () => {
    const { t } = rig();
    t.start(1);
    t.push(S4());
    t.start(2);
    expect(t.out.drain().length).toBe(0);
    t.push(S6());
    expect(snaps(t.out.drain())[0]).toMatchObject({ continuity: "first", epoch: 2 });
  });

  it("stop discards queued events and emits nothing while stopped", () => {
    const { t } = rig();
    t.start(1);
    t.push(S4());
    t.stop();
    expect(t.out.drain()).toEqual([]);
    t.link(false);
    t.art(["Island"]);
    t.started(true);
    t.deckList(["a"]);
    t.reply(T1, { t: "queued" });
    expect(t.out.drain()).toEqual([]);
  });
});

describe("scriptedTransport requests and replies", () => {
  it("records sent answers with token, epoch, body and time", () => {
    const { t, at } = rig();
    t.start(1);
    at.now = 250;
    t.answer(T1, 1, BODY);
    expect(t.answers).toEqual([{ token: T1, epoch: 1, body: BODY, at: 250 }]);
    expect(t.out.drain()).toEqual([]);
  });

  it("reply delivers the outcome stamped with the epoch the answer was sent under", () => {
    const { t } = rig();
    t.start(1);
    t.answer(T1, 1, BODY);
    t.answer(T2, 1, BODY);
    t.reply(T2, { t: "refused", reason: "no" });
    t.reply(T1, { t: "queued" });
    const got = t.out.drain();
    expect(got).toMatchObject([
      { t: "answered", token: T2, epoch: 1, outcome: { t: "refused", reason: "no" } },
      { t: "answered", token: T1, epoch: 1, outcome: { t: "queued" } },
    ]);
  });

  it("an indeterminate reply re-delivers the current snapshot at once", () => {
    const { t } = rig();
    t.start(1);
    t.push(S4());
    t.ack(1, 4, "took");
    t.push(S6());
    t.ack(1, 6, "took");
    t.out.drain();
    t.answer(T1, 1, BODY);
    t.reply(T1, { t: "indeterminate", why: "reset" });
    const got = t.out.drain();
    expect(got.map((e) => e.t)).toEqual(["answered", "snapshot"]);
    expect(snaps(got)[0]).toMatchObject({ snap: { v: 6 }, continuity: "same" });
  });

  it("autoReply answers every answer at once", () => {
    const { t } = rig({ t: "queued" });
    t.start(1);
    t.answer(T1, 1, BODY);
    expect(t.out.drain()).toMatchObject([{ t: "answered", token: T1, outcome: { t: "queued" } }]);
  });

  it("records new games and deck requests, and delivers link, art, started and decks events", () => {
    const { t } = rig();
    t.start(2);
    const req = { deck: "d", opponents: ["o"], mana: "auto" } as const;
    t.newGame(2, req);
    t.decks(2);
    t.decks(2);
    expect(t.newGames).toEqual([req]);
    expect(t.deckRequests).toBe(2);
    t.link(false);
    t.art(["Island", "Plains"]);
    t.started(false, "no deck");
    t.started(true);
    t.deckList(["a", "b"]);
    t.deckList(null, "boom");
    expect(t.out.drain()).toMatchObject([
      { t: "link", up: false, epoch: 2 },
      { t: "art", names: ["Island", "Plains"] },
      { t: "started", ok: false, error: "no deck" },
      { t: "started", ok: true, error: null },
      { t: "decks", decks: ["a", "b"], error: null },
      { t: "decks", decks: null, error: "boom" },
    ]);
  });
});
