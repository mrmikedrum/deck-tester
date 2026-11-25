// How answers settle between the ledger and play (the ledger decides; play hears refused, lost and queued), play's
// deadlines as app deadlines, notices, and stops staying unique across new games and teardown. Through the whole app
// on the scripted transport, with real corpus envelopes.
import { describe, expect, it } from "vitest";
import * as play from "../../src/play";
import { AUTO_PASS_MS } from "../../src/play";
import type { AnswerToken, DecisionId, DecisionKey } from "../../src/protocol";
import { NOTICE_MS } from "../../src/app/slots";
import { STILL_WAITING, update } from "../../src/app/update";
import { raw } from "../play/rig";
import { envelope, rig } from "./rig";
import type { Rig } from "./rig";

const busy = (r: Rig): boolean | undefined => play.present(r.state.play).controls.prompt?.busy;
const toast = (r: Rig): string | null => r.commits.at(-1)?.view.toast ?? null;

function playing(): Rig {
  const r = rig();
  r.loop.start();
  r.frame(0);
  r.transport.push(envelope({ v: 1, decision: 1 }));
  r.frame(10);
  r.act();
  r.frame(20);
  expect(r.transport.answers).toHaveLength(1);
  expect(busy(r)).toBe(true);
  return r;
}

describe("settling an answer", () => {
  it("play's token is the one sent, and the ledger holds it", () => {
    const r = playing();
    expect(r.state.answer.pending?.token).toBe(r.transport.answers[0]?.token);
  });

  it("queued proves nothing: the prompt stays busy", () => {
    const r = playing();
    r.reply(0, { t: "queued" });
    r.frame(30);
    expect(busy(r)).toBe(true);
    expect(r.state.answer.pending?.phase).toBe("queued");
  });

  it("refused: play frees the prompt and says why", () => {
    const r = playing();
    r.reply(0, { t: "refused", reason: "not your priority" });
    r.frame(30);
    expect(busy(r)).toBe(false);
    expect(toast(r)).toBe("not your priority");
  });

  it("a failed request keeps the prompt busy until a snapshot asked for afterwards settles it as lost", () => {
    const r = playing();
    // The outcome alone is not forwarded to play: the ledger waits, the prompt stays busy.
    const token = r.transport.answers[0]!.token;
    const alone = update(r.state, { t: "answered", at: 25, epoch: r.state.epoch, token, outcome: { t: "indeterminate", why: "Failed to fetch" } });
    expect(alone.state.answer.pending?.phase).toBe("unknown");
    expect(play.present(alone.state.play).controls.prompt?.busy).toBe(true);
    // Through the transport, which re-syncs at once: the same snapshot, asked for after the failure, settles it.
    r.now = 25;
    r.reply(0, { t: "indeterminate", why: "Failed to fetch" });
    r.frame(30);
    expect(r.state.answer.last?.how).toBe("lost");
    expect(busy(r)).toBe(false);
    expect(toast(r)).toBe("Lost the bridge");
    r.act();
    r.frame(40);
    expect(r.transport.answers).toHaveLength(2);
  });

  it("applied: play frees the prompt from the bridge's status, with nothing to say", () => {
    const r = playing();
    r.reply(0, { t: "queued" });
    r.frame(30);
    r.transport.push(envelope({ v: 2, decision: 1, answer: { id: 1, state: "applied" } }));
    r.frame(40);
    expect(r.state.answer.last?.how).toBe("applied");
    expect(busy(r)).toBe(false);
    expect(toast(r)).toBeNull();
  });

  it("refused later by the engine: one toast, and the prompt is free", () => {
    const r = playing();
    r.reply(0, { t: "queued" });
    r.frame(30);
    r.transport.push(envelope({ v: 2, decision: 1, answer: { id: 1, state: "refused", error: "illegal" } }));
    r.frame(40);
    expect(r.state.answer.last).toMatchObject({ how: "refused", reason: "illegal" });
    expect(busy(r)).toBe(false);
    expect(r.state.narrative.toasts.map((n) => n.text)).toEqual(["illegal"]);
  });

  it("superseded by a new decision: play adopts it, free", () => {
    const r = playing();
    r.transport.push(envelope({ v: 2, decision: 2 }));
    r.frame(30);
    expect(r.state.answer.last?.how).toBe("superseded");
    expect(busy(r)).toBe(false);
    expect(toast(r)).toBeNull();
  });

  it("when the ledger will not let an answer out, play is told and frees its prompt", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(10);
    const s = r.state;
    const stop = s.session.stop!;
    const held = { token: 99 as AnswerToken, stop, id: 1 as DecisionId, key: "k" as DecisionKey, at: 5, phase: "queued" as const, unknownSince: null, attempt: null, floor: null, since: null };
    const pass = play.present(s.play).controls.prompt!.buttons.find((b) => b.role === "pass")!;
    const out = update({ ...s, answer: { ...s.answer, pending: held } }, { t: "act", stamp: { at: 20, commit: s.commit }, stop, act: { a: "press", button: pass.id } });
    expect(out.effects.filter((e) => e.kind === "answer")).toEqual([]);
    expect(out.state.answer.pending).toBe(held);
    expect(play.present(out.state.play).controls.prompt?.busy).toBe(false);
    expect(out.state.narrative.toasts.map((n) => n.text)).toEqual([STILL_WAITING]);
  });
});

describe("notices", () => {
  it("a toast lasts NOTICE_MS on the app's deadline", () => {
    const r = playing();
    r.now = 100;
    r.reply(0, { t: "refused", reason: "x" });
    r.frame(100);
    expect(toast(r)).toBe("x");
    r.frame(100 + NOTICE_MS - 1);
    expect(toast(r)).toBe("x");
    r.frame(100 + NOTICE_MS);
    expect(toast(r)).toBeNull();
  });
});

describe("play's deadlines", () => {
  function counting(): Rig {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.now = 1000;
    r.transport.push(raw("030-play-watching.json")); // an opponent's spell, nothing to answer it with: auto-pass
    r.frame(1000);
    return r;
  }

  it("auto-pass is an app deadline; when it falls due, play passes", () => {
    const r = counting();
    const [id, d] = [...r.state.deadlines.items].find(([k]) => k.startsWith("play/autopass:"))!;
    expect(d.due).toBe(1000 + AUTO_PASS_MS);
    expect(r.sched.wakes.at(-1)).toBe(1000 + AUTO_PASS_MS);
    r.frame(1000 + AUTO_PASS_MS - 1);
    expect(r.transport.answers).toHaveLength(0);
    r.frame(1000 + AUTO_PASS_MS);
    expect(r.transport.answers.map((a) => a.body)).toEqual([expect.objectContaining({ answer: [1] })]);
    expect(r.state.deadlines.items.has(id)).toBe(false);
  });

  it("Hold tapped at the same ms beats the pass; the deadline is cancelled", () => {
    const r = counting();
    const hold = play.present(r.state.play).controls.prompt!.buttons.find((b) => b.role === "hold")!;
    r.now = 1000 + AUTO_PASS_MS;
    r.send({ a: "press", button: hold.id });
    r.frame(1000 + AUTO_PASS_MS + 10);
    expect(r.transport.answers).toHaveLength(0);
    expect([...r.state.deadlines.items.keys()].some((k) => k.startsWith("play/"))).toBe(false);
  });

  it("a new game cancels the countdown", () => {
    const r = counting();
    const fresh = raw("030-play-watching.json");
    fresh["gen"] = 2;
    r.now = 1100;
    r.transport.push(fresh);
    r.frame(1100);
    const timers = [...r.state.deadlines.items].filter(([k]) => k.startsWith("play/"));
    expect(timers).toHaveLength(1); // the new game's own countdown, from its arrival
    expect(timers[0]![1].due).toBe(1100 + AUTO_PASS_MS);
  });
});

describe("stops stay unique", () => {
  it("across a new game asked for here, and across teardown, the same decision is a new stop", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    const stops: (string | null)[] = [];
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(10);
    stops.push(r.state.session.stop);
    r.inputs.push({ t: "newGame", stamp: { at: 15, commit: r.state.commit }, req: { deck: "a", opponents: [], mana: "auto" } });
    r.frame(20);
    expect(r.state.session.stop).toBeNull();
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(30);
    r.frame(40);
    stops.push(r.state.session.stop);
    r.loop.teardown();
    r.loop.start();
    r.frame(50);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(60);
    stops.push(r.state.session.stop);
    expect(stops.every((s) => s !== null)).toBe(true);
    expect(new Set(stops).size).toBe(3);
  });
});
