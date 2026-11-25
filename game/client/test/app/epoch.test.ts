// Continuity and epochs: a new gen, the bridge's v going backwards, a new game asked for, and teardown. Replies from
// an older epoch are ignored; nothing queued before teardown reaches the next run.
import { describe, expect, it } from "vitest";
import { setDeadline } from "../../src/app/deadlines";
import { isBusy } from "../../src/app/answers";
import { update } from "../../src/app/update";
import { envelope, rig } from "./rig";

function playing(o: Parameters<typeof rig>[0] = {}) {
  const r = rig(o);
  r.loop.start();
  r.frame(0);
  r.transport.push(envelope({ v: 1, decision: 1 }));
  r.frame(10);
  return r;
}

describe("continuity", () => {
  it("a new gen moves the epoch on, resets the game and ignores the old answer's reply", () => {
    const r = playing();
    const stopAtFirst = r.state.session.stop;
    r.act();
    r.frame(20);
    r.transport.push(envelope({ v: 2, gen: 2, decision: 1 }));
    r.frame(30);
    expect(r.state.session.continuity).toBe("newGame");
    expect(r.state.epoch).toBe(1);
    expect(r.state.answer.last?.how).toBe("superseded");
    expect(r.state.answer.pending).toBeNull();
    r.reply(0, { t: "refused", reason: "late" }); // the old request fails late: nothing to tell
    r.frame(40);
    expect(r.state.answer.last?.how).toBe("superseded");
    r.act();
    r.frame(50);
    expect(r.transport.answers).toHaveLength(2);
    expect(r.state.session.stop).not.toBe(stopAtFirst); // the same decision id, a new stop
  });

  it("the same decision id in a new game is a new stop", () => {
    const r = playing();
    const first = r.state.session.stop;
    r.transport.push(envelope({ v: 2, gen: 2, decision: 1 }));
    r.frame(20);
    expect(r.state.session.stop).not.toBe(first);
  });

  it("v going backwards is a restart: the new decision takes over and nothing is sent", () => {
    const r = playing();
    r.act();
    r.frame(20);
    r.transport.push(envelope({ v: 1, decision: 1 })); // same v, same gen: an idle poll
    r.frame(30);
    expect(r.state.session.continuity).toBe("same");
    r.transport.push(envelope({ v: 7, decision: 3 }));
    r.settle();
    r.frame(r.now + 16);
    r.transport.push(envelope({ v: 2, decision: 1, prompt: "after a restart" }));
    r.frame(r.now + 16);
    expect(r.state.session.continuity).toBe("restart");
    expect(r.state.epoch).toBe(1);
    expect(r.state.session.decision?.prompt).toBe("after a restart");
    expect(isBusy(r.state.answer, r.state.session.stop)).toBe(false);
    expect(r.transport.answers).toHaveLength(1);
  });

  it("a rewound view is classified as such, in the same epoch", () => {
    const r = playing();
    r.transport.push(envelope({ v: 2, decision: 2, turn: 3 }));
    r.frame(20);
    r.transport.push(envelope({ v: 3, decision: 3, turn: 2 }));
    r.frame(30);
    expect(r.state.session.continuity).toBe("rewind");
    expect(r.state.epoch).toBe(0);
  });
});

describe("a new game asked for", () => {
  it("moves the epoch on, posts the request and drops replies from before", () => {
    const r = playing();
    r.act();
    r.frame(20);
    r.inputs.push({ t: "newGame", stamp: { at: 25, commit: r.state.commit }, req: { deck: "a.txt", opponents: ["b", "c", "d"], mana: "creatures" } });
    r.frame(30);
    expect(r.state.epoch).toBe(1);
    expect(r.transport.newGames).toEqual([{ deck: "a.txt", opponents: ["b", "c", "d"], mana: "creatures" }]);
    expect(r.state.model).toBeNull();
    r.reply(0, { t: "queued" });
    r.frame(40);
    expect(r.state.answer.pending).toBeNull();
    r.transport.started(true);
    r.frame(50);
    expect(r.state.session.started).toEqual({ ok: true, error: null });
  });

  it("a snapshot issued before it is asked for again under the new epoch", () => {
    const r = playing();
    r.transport.push(envelope({ v: 2, decision: 2 })); // out, stamped with epoch 0
    r.inputs.push({ t: "newGame", stamp: { at: 0, commit: r.state.commit }, req: { deck: "a.txt", opponents: [], mana: "auto" } });
    r.frame(20); // the request sorts first (earlier), so the snapshot is stale
    expect(r.transport.acks.at(-1)).toEqual({ v: 2, ack: "stale" });
    r.frame(30);
    expect(r.transport.acks.at(-1)).toEqual({ v: 2, ack: "took" });
    expect(r.state.session.v).toBe(2);
  });

  it("deck lists are asked for each time (a failure is not cached)", () => {
    const r = playing();
    r.inputs.push({ t: "listDecks", stamp: { at: 20, commit: 1 } });
    r.frame(20);
    r.transport.deckList(null, "HTTP 500");
    r.inputs.push({ t: "listDecks", stamp: { at: 30, commit: 1 } });
    r.frame(30);
    expect(r.transport.deckRequests).toBe(2);
    expect(r.state.session.decks).toEqual({ list: null, error: "HTTP 500" });
  });
});

describe("teardown", () => {
  it("stops the transport, cancels deadlines, disposes the renderer and ignores what was queued", () => {
    const r = playing({
      update: (s, m) => (m.t === "dismiss" ? { state: { ...s, deadlines: setDeadline(s.deadlines, "play/x", 5000) }, effects: [] } : update(s, m)),
    });
    const first = r.state.session.stop;
    r.inputs.push({ t: "dismiss", stamp: { at: 15, commit: 1 } });
    r.frame(20);
    expect(r.state.deadlines.items.size).toBe(1);
    r.act();
    r.frame(25);
    r.transport.push(envelope({ v: 2, decision: 2 })); // queued, never drained
    r.inputs.push({ t: "dismiss", stamp: { at: 26, commit: 1 } });
    const epoch = r.state.epoch;
    r.loop.teardown();
    expect(r.state.epoch).toBe(epoch + 1);
    expect(r.state.deadlines.items.size).toBe(0);
    expect(r.state.session.bridge).toBe("connecting");
    expect(r.renderer.disposed).toBe(1);
    expect(r.sched.disposed).toBe(1);
    r.reply(0, { t: "refused", reason: "late" }); // a stopped transport emits nothing
    r.loop.start();
    r.frame(100);
    expect(r.state.session.v).toBeNull();
    expect(r.state.answer.last).toBeNull();
    expect(r.state.deadlines.items.size).toBe(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(110);
    expect(r.state.session.continuity).toBe("first");
    expect(r.state.session.stop).not.toBeNull();
    expect(r.state.session.stop).not.toBe(first); // play lives for the page: the same decision again is a new stop
  });

  it("answer tokens stay unique across teardown", () => {
    const r = playing();
    r.act();
    r.frame(20);
    r.loop.teardown();
    r.loop.start();
    r.frame(30);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(40);
    r.act();
    r.frame(50);
    const tokens = r.transport.answers.map((a) => a.token);
    expect(new Set(tokens).size).toBe(2);
  });
});
