// The answer ledger against the transport's outcomes and the bridge's answer status, unit by unit and through the
// whole app on the scripted transport.
import { describe, expect, it } from "vitest";
import * as play from "../../src/play";
import { decodeSnapshot } from "../../src/protocol";
import type { AnswerRequest, AnswerToken, DecisionId, DecisionKey, Snapshot, StopId } from "../../src/protocol";
import { answerOutcome, isBusy, NO_ANSWERS, observeAnswer, openAnswer } from "../../src/app/answers";
import type { AnswerLedger } from "../../src/app/answers";
import { envelope, rig } from "./rig";

const snap = (o: Parameters<typeof envelope>[0]): Snapshot => {
  const r = decodeSnapshot(envelope(o));
  if (!r.ok) throw new Error(r.error.summary);
  return r.value;
};
const S1 = "1.1.1" as StopId;
const S2 = "1.2.2" as StopId;
const body = { id: 1 as DecisionId, key: "k" as DecisionKey, answer: [1] } satisfies AnswerRequest;
let tokens = 0;

function sent(): { l: AnswerLedger; token: AnswerToken } {
  const token = ++tokens as AnswerToken;
  const l = openAnswer(NO_ANSWERS, S1, token, S1, body, 100);
  if (!l) throw new Error("not opened");
  return { l, token };
}

describe("the ledger", () => {
  it("lets one answer out at a time, and only for the current stop", () => {
    const { l } = sent();
    expect(isBusy(l, S1)).toBe(true);
    expect(openAnswer(l, S1, 99 as AnswerToken, S1, body, 110)).toBeNull();
    expect(openAnswer(NO_ANSWERS, S2, 99 as AnswerToken, S1, body, 110)).toBeNull();
  });

  it("queued, then working, then applied: busy until the bridge says applied", () => {
    const first = sent();
    const token = first.token;
    let l = first.l;
    l = answerOutcome(l, token, { t: "queued" }, 150);
    expect(l.pending?.phase).toBe("queued");
    l = observeAnswer(l, snap({ v: 2, decision: 1, answer: { id: 1, state: "working" } }), S1, "advance", 140, 160);
    expect(isBusy(l, S1)).toBe(true);
    l = observeAnswer(l, snap({ v: 3, decision: 1, answer: { id: 1, state: "applied" } }), S1, "advance", 170, 180);
    expect(isBusy(l, S1)).toBe(false);
    expect(l.last).toMatchObject({ token, how: "applied" });
  });

  it("queued with nothing said stays busy (the bridge has not finished)", () => {
    const first = sent();
    const token = first.token;
    let l = first.l;
    l = answerOutcome(l, token, { t: "queued" }, 150);
    l = observeAnswer(l, snap({ v: 2, decision: 1 }), S1, "same", 160, 170);
    expect(isBusy(l, S1)).toBe(true);
  });

  it("refused at once frees with the reason; refused later by the engine too", () => {
    const a = sent();
    const l1 = answerOutcome(a.l, a.token, { t: "refused", reason: "that decision has passed" }, 150);
    expect(l1.pending).toBeNull();
    expect(l1.last).toMatchObject({ how: "refused", reason: "that decision has passed" });
    const b = sent();
    let l2 = answerOutcome(b.l, b.token, { t: "queued" }, 150);
    l2 = observeAnswer(l2, snap({ v: 2, decision: 1, answer: { id: 1, state: "refused", error: "illegal" } }), S1, "advance", 160, 170);
    expect(l2.last).toMatchObject({ how: "refused", reason: "illegal" });
  });

  it("indeterminate waits for a snapshot asked for after it", () => {
    const first = sent();
    const token = first.token;
    let l = first.l;
    l = answerOutcome(l, token, { t: "indeterminate", why: "network" }, 200);
    l = observeAnswer(l, snap({ v: 1, decision: 1 }), S1, "same", 150, 210); // asked before the failure: proves nothing
    expect(isBusy(l, S1)).toBe(true);
    l = observeAnswer(l, snap({ v: 1, decision: 1 }), S1, "same", 205, 220);
    expect(l.last).toMatchObject({ how: "lost" });
  });

  it("indeterminate, then the bridge shows it working: still busy until applied", () => {
    const first = sent();
    const token = first.token;
    let l = first.l;
    l = answerOutcome(l, token, { t: "indeterminate", why: "network" }, 200);
    l = observeAnswer(l, snap({ v: 2, decision: 1, answer: { id: 1, state: "working" } }), S1, "advance", 205, 210);
    expect(l.pending?.phase).toBe("queued");
    l = observeAnswer(l, snap({ v: 3, decision: 2, answer: { id: 1, state: "applied" } }), S2, "advance", 215, 220);
    expect(l.last).toMatchObject({ how: "applied" });
  });

  it("a new decision, a new game or a restart supersedes it; a late reply then changes nothing", () => {
    for (const [stop, c] of [
      [S2, "advance"],
      [S1, "newGame"],
      [S1, "restart"],
    ] as const) {
      const first = sent();
    const token = first.token;
    let l = first.l;
      l = observeAnswer(l, snap({ v: 2, decision: 2 }), stop, c, 150, 160);
      expect(l.last?.how).toBe("superseded");
      expect(answerOutcome(l, token, { t: "refused", reason: "late" }, 170)).toBe(l);
    }
  });
});

describe("answers through the app", () => {
  function playing() {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(10);
    return r;
  }

  it("a double tap sends one answer, in one frame or across frames", () => {
    const r = playing();
    r.now = 20;
    r.act();
    r.act();
    r.frame(30);
    r.now = 40;
    r.act();
    r.frame(50);
    expect(r.transport.answers).toHaveLength(1);
    expect(r.transport.answers[0]?.body).toEqual({ id: 1, gen: 1, key: "play|T1 main1||2|pass|Island", answer: [1] });
  });

  it("an act drawn for another stop is dropped", () => {
    const r = playing();
    r.act("1.99.9" as StopId);
    r.frame(30);
    expect(r.transport.answers).toHaveLength(0);
  });

  it("working, then applied, frees the prompt; the next decision answers normally", () => {
    const r = playing();
    r.act();
    r.frame(20);
    r.reply(0, { t: "queued" });
    r.transport.push(envelope({ v: 2, decision: 1, answer: { id: 1, state: "working" } }));
    r.frame(30);
    r.settle();
    expect(isBusy(r.state.answer, r.state.session.stop)).toBe(true);
    r.transport.push(envelope({ v: 3, decision: 2, answer: { id: 1, state: "applied" } }));
    r.settle();
    r.frame(r.now + 16);
    expect(r.state.answer.last?.how).toBe("applied");
    r.act();
    r.frame(r.now + 16);
    expect(r.transport.answers.map((a) => a.body.id)).toEqual([1, 2]);
  });

  it("refused frees the prompt with the reason: a second answer can be sent", () => {
    const r = playing();
    r.act();
    r.frame(20);
    r.reply(0, { t: "refused", reason: "x" });
    r.frame(30);
    expect(r.state.answer.last).toMatchObject({ how: "refused", reason: "x" });
    expect(r.commits.at(-1)?.lines.join("\n")).toMatch(/last answer: refused: x/);
    r.act();
    r.frame(40);
    expect(r.transport.answers).toHaveLength(2);
  });

  it("indeterminate keeps the prompt busy until the next snapshot settles it", () => {
    const r = playing();
    r.act();
    r.frame(20);
    r.now = 25;
    r.reply(0, { t: "indeterminate", why: "Failed to fetch" }); // the transport re-syncs: the snapshot comes again
    r.frame(30);
    expect(r.state.answer.last?.how).toBe("lost");
    r.act();
    r.frame(40);
    expect(r.transport.answers).toHaveLength(2);
    expect(r.transport.acks.map((a) => a.ack)).toEqual(["took", "took"]);
  });

  it("nothing is ever resent on its own", () => {
    const r = playing();
    r.act();
    r.frame(20);
    r.reply(0, { t: "indeterminate", why: "Failed to fetch" });
    for (let t = 30; t < 30000; t += 1000) r.frame(t);
    expect(r.transport.answers).toHaveLength(1);
  });
});

describe("a status speaks only for its own attempt", () => {
  const busy = (r: ReturnType<typeof rig>): boolean | undefined => play.present(r.state.play).controls.prompt?.busy;

  function refusedOnce(attempt: number | undefined) {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(10);
    r.act();
    r.frame(20);
    r.reply(0, { t: "queued" }, attempt);
    r.transport.push(envelope({ v: 2, decision: 1, answer: { id: 1, ...(attempt ? { attempt } : {}), state: "refused", error: "illegal" } }));
    r.frame(30);
    expect(r.state.answer.last).toMatchObject({ how: "refused", reason: "illegal" });
    r.act(); // the retry
    r.frame(40);
    expect(r.transport.answers).toHaveLength(2);
    return r;
  }

  it.each([
    ["before the retry's reply", false],
    ["after the retry's reply", true],
  ])("the old refusal seen again does not free the retry (%s)", (_name, replied) => {
    const r = refusedOnce(1);
    if (replied) r.reply(1, { t: "queued" }, 2);
    r.transport.push(envelope({ v: 3, decision: 1, answer: { id: 1, attempt: 1, state: "refused", error: "illegal" } }));
    r.frame(50);
    expect(r.state.answer.pending?.token).toBe(r.transport.answers[1]!.token);
    expect(busy(r)).toBe(true);
    r.act();
    r.frame(60);
    expect(r.transport.answers).toHaveLength(2); // no third POST before the retry has an outcome
    // Its own status settles it, even refused for the same reason.
    r.transport.push(envelope({ v: 4, decision: 1, answer: { id: 1, attempt: 2, state: "refused", error: "illegal" } }));
    r.frame(70);
    expect(r.state.answer.last).toMatchObject({ token: r.transport.answers[1]!.token, how: "refused", reason: "illegal" });
    expect(busy(r)).toBe(false);
  });

  it("a bridge without attempt numbers: the same status seen again is not the retry's; a changed one is", () => {
    const r = refusedOnce(undefined);
    r.transport.push(envelope({ v: 3, decision: 1, answer: { id: 1, state: "refused", error: "illegal" } }));
    r.frame(50);
    expect(busy(r)).toBe(true);
    r.transport.push(envelope({ v: 4, decision: 1, answer: { id: 1, state: "working" } }));
    r.frame(60);
    r.transport.push(envelope({ v: 5, decision: 1, answer: { id: 1, state: "refused", error: "illegal" } }));
    r.frame(70);
    expect(r.state.answer.last).toMatchObject({ token: r.transport.answers[1]!.token, how: "refused" });
    expect(busy(r)).toBe(false);
  });

  it("a later attempt seen before its own: its outcome came and went; the prompt is free, nothing said", () => {
    const r = refusedOnce(1);
    r.reply(1, { t: "queued" }, 2);
    r.transport.push(envelope({ v: 3, decision: 1, answer: { id: 1, attempt: 3, state: "applied" } }));
    r.frame(50);
    expect(r.state.answer.last).toMatchObject({ token: r.transport.answers[1]!.token, how: "unseen" });
    expect(busy(r)).toBe(false);
  });
});

describe("an answer the bridge is working on that this page did not send (a reload)", () => {
  const busy = (r: ReturnType<typeof rig>): boolean | undefined => play.present(r.state.play).controls.prompt?.busy;

  function reloaded(attempt: number | undefined) {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1, answer: { id: 1, ...(attempt ? { attempt } : {}), state: "working" } }));
    r.frame(10);
    return r;
  }

  it.each([4, undefined])("keeps the prompt busy, and Pass sends nothing, until its status settles it (attempt %s)", (attempt) => {
    const r = reloaded(attempt);
    expect(r.state.answer.pending).toMatchObject({ token: null });
    expect(busy(r)).toBe(true);
    r.act();
    r.frame(20);
    expect(r.transport.answers).toHaveLength(0);
    r.transport.push(envelope({ v: 2, decision: 1, answer: { id: 1, ...(attempt ? { attempt } : {}), state: "applied" } }));
    r.frame(30);
    expect(r.state.answer.last?.how).toBe("applied");
    expect(busy(r)).toBe(false);
    r.act();
    r.frame(40);
    expect(r.transport.answers).toHaveLength(1);
  });

  it("frees when the stop changes", () => {
    const r = reloaded(4);
    r.transport.push(envelope({ v: 2, decision: 2, answer: { id: 1, attempt: 4, state: "working" } }));
    r.frame(20);
    expect(busy(r)).toBe(false);
    r.act();
    r.frame(30);
    expect(r.transport.answers.map((a) => a.body.id)).toEqual([2]);
  });

  it("a status for another decision is not adopted", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 2, answer: { id: 1, attempt: 4, state: "working" } }));
    r.frame(10);
    expect(r.state.answer.pending).toBeNull();
    expect(busy(r)).toBe(false);
  });
});

describe("an answer superseded in the frame that made it", () => {
  it("a press for decision 1 and a snapshot for decision 2 in one frame: nothing is sent for 1", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(10);
    r.now = 20;
    r.act();
    r.now = 25;
    r.transport.push(envelope({ v: 2, decision: 2 }));
    r.frame(30);
    expect(r.state.answer.last?.how).toBe("superseded");
    expect(r.transport.answers).toEqual([]);
    r.act();
    r.frame(40);
    expect(r.transport.answers.map((a) => a.body.id)).toEqual([2]);
  });
});

describe("attempt numbers belong to one bridge process", () => {
  const busy = (r: ReturnType<typeof rig>): boolean | undefined => play.present(r.state.play).controls.prompt?.busy;

  /** Attempt 30 sent and applied on this bridge. */
  function settledThirty() {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 10, decision: 1 }));
    r.frame(10);
    r.act();
    r.frame(20);
    r.reply(0, { t: "queued" }, 30);
    r.transport.push(envelope({ v: 11, decision: 2, answer: { id: 1, attempt: 30, state: "applied" } }));
    r.frame(30);
    expect(r.state.answer.last).toMatchObject({ how: "applied", attempt: 30 });
    return r;
  }

  it("after a restart, the new bridge's low attempt working on the decision on screen holds the prompt", () => {
    const r = settledThirty();
    r.transport.push(envelope({ v: 2, decision: 1, answer: { id: 1, attempt: 2, state: "working" } })); // v went back
    r.frame(40);
    expect(r.state.session.continuity).toBe("restart");
    expect(r.state.answer.pending).toMatchObject({ token: null, attempt: 2 });
    expect(busy(r)).toBe(true);
    r.act();
    r.frame(50);
    expect(r.transport.answers).toHaveLength(1); // only the first, before the restart
  });

  it("a new game on the same bridge keeps the history: an old attempt seen working is not adopted", () => {
    const r = settledThirty();
    r.transport.push(envelope({ v: 12, gen: 2, decision: 1, answer: { id: 1, attempt: 29, state: "working" } }));
    r.frame(40);
    expect(r.state.session.continuity).toBe("newGame");
    expect(r.state.answer.pending).toBeNull();
    expect(busy(r)).toBe(false);
  });
});
