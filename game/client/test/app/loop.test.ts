// The frame loop: drain order and the tie rule, deadlines (made and cancelled during a fold), and the wake contract.
import { describe, expect, it } from "vitest";
import { cancelDeadline, setDeadline } from "../../src/app/deadlines";
import { AMBIENT_MS } from "../../src/app/loop";
import type { DeadlineId } from "../../src/app/ids";
import type { Msg } from "../../src/app/msg";
import type { AppState } from "../../src/app/state";
import { update } from "../../src/app/update";
import type { Step } from "../../src/app/update";
import { envelope, rig } from "./rig";

const PASS: DeadlineId = "play/autopass";
const label = (m: Msg): string => (m.t === "deadline" ? `deadline ${m.id}` : m.t);

/** The app's router, recording what it folds, with a hold (any act cancels the auto-pass) and the pass itself. */
function recording(seen: string[], fired: string[] = []) {
  return (s: AppState, m: Msg): Step => {
    seen.push(label(m));
    if (m.t === "act") return { state: { ...s, deadlines: cancelDeadline(s.deadlines, PASS) }, effects: [] };
    if (m.t === "deadline" && m.id === PASS && s.deadlines.items.get(PASS)?.serial === m.serial) fired.push(`pass@${m.at}`);
    return update(s, m);
  };
}

const withPass = (s: AppState, due: number): AppState => ({ ...s, deadlines: setDeadline(s.deadlines, PASS, due) });

describe("draining", () => {
  it("folds a frame's messages in time order across sources", () => {
    const seen: string[] = [];
    const r = rig({ update: recording(seen) });
    r.loop.start();
    r.frame(0);
    seen.length = 0;
    r.now = 50;
    r.transport.push(envelope({ v: 1, decision: 1 })); // stamped 50
    r.now = 30;
    r.act(); // stamped 30
    r.inputs.push({ t: "dismiss", stamp: { at: 45, commit: 1 } });
    r.frame(60);
    expect(seen).toEqual(["act", "dismiss", "snapshot"]);
  });

  it("on a tie: the player's input, then snapshots, then deadlines", () => {
    const seen: string[] = [];
    const r = rig({ update: (s, m) => recording(seen)(m.t === "snapshot" ? withPass(s, 3200) : s, m) });
    r.loop.start();
    r.frame(0);
    r.now = 100;
    r.transport.push(envelope({ v: 1, decision: 1 })); // sets the pass for 3200
    r.frame(100);
    seen.length = 0;
    // Everything at 3200 exactly, pushed in the worst order.
    r.now = 3200;
    r.transport.push(envelope({ v: 2, decision: 2 }));
    r.inputs.push({ t: "dismiss", stamp: { at: 3200, commit: 2 } });
    r.frame(3200);
    expect(seen).toEqual(["dismiss", "snapshot", `deadline ${PASS}`]);
  });

  it.each([
    [3190, "a hold before the pass cancels it", []],
    [3200, "a hold at the same ms cancels it (input first)", []],
    [3210, "a hold after the pass is too late", ["pass@3200"]],
  ])("hold at %i ms: %s", (holdAt, _name, expected) => {
    const fired: string[] = [];
    const r = rig({ update: (st, m) => recording([], fired)(m.t === "snapshot" ? withPass(st, 3200) : st, m) });
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(0);
    r.now = holdAt;
    r.act();
    r.frame(3220); // one late frame sees both the hold and the due pass
    expect(fired).toEqual(expected);
  });
});

describe("deadlines", () => {
  it("one set during a fold fires in a later frame, even if already due", () => {
    const seen: string[] = [];
    const r = rig({
      update: (s, m) =>
        recording(seen)(m.t === "dismiss" ? { ...s, deadlines: setDeadline(s.deadlines, "app/x", 0) } : s, m),
    });
    r.loop.start();
    r.frame(0);
    r.inputs.push({ t: "dismiss", stamp: { at: 10, commit: 1 } });
    r.frame(10);
    expect(seen.slice(-1)).toEqual(["dismiss"]);
    expect(r.sched.requested).toBe(true); // already due: the next frame runs it
    r.frame(26);
    expect(seen.slice(-1)).toEqual(["deadline app/x"]);
    expect(r.state.deadlines.items.size).toBe(0);
  });

  it("a cancellation during the fold takes effect at once", () => {
    const fired: string[] = [];
    const r = rig({ update: (s, m) => recording([], fired)(m.t === "snapshot" ? withPass(s, 100) : s, m) });
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(0);
    r.now = 90;
    r.act(); // cancels the pass that is due in this same frame
    r.frame(150);
    expect(fired).toEqual([]);
  });
});

describe("waking", () => {
  it("runs no frames while idle, and an arrival asks for one at once", () => {
    const r = rig();
    r.loop.start();
    expect(r.sched.requests).toBe(1); // the first frame: the waiting state
    r.frame(0);
    expect(r.sched.requested).toBe(false);
    expect(r.sched.wakes.at(-1)).toBeNull();
    const before = r.sched.requests;
    r.transport.push(envelope({ v: 1, decision: 1 }));
    expect(r.sched.requests).toBe(before + 1);
    r.frame(5);
    r.settle();
    expect(r.sched.requested).toBe(false); // took it; nothing moves, nothing waits
    expect(r.commits.at(-1)?.lines.join("\n")).toMatch(/decision 1/);
  });

  it("idles with one wake at the earliest deadline", () => {
    const r = rig({
      update: (s, m) =>
        m.t === "dismiss"
          ? { state: { ...s, deadlines: setDeadline(setDeadline(s.deadlines, "app/late", 5000), "app/soon", 1200) }, effects: [] }
          : update(s, m),
    });
    r.loop.start();
    r.frame(0);
    r.inputs.push({ t: "dismiss", stamp: { at: 10, commit: 1 } });
    r.frame(10);
    expect(r.sched.requested).toBe(false);
    expect(r.sched.wakes.at(-1)).toBe(1200);
    r.frame(1200);
    expect(r.sched.wakes.at(-1)).toBe(5000);
    r.frame(5000);
    expect(r.sched.wakes.at(-1)).toBeNull();
  });

  it("an ambient table (the rim breathing) keeps a slow cadence while idle, and still counts as settled", () => {
    const r = rig({
      update: (st, m) => (m.t === "dismiss" ? { state: { ...st, deadlines: setDeadline(st.deadlines, "app/soon", 1040) }, effects: [] } : update(st, m)),
    });
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(5);
    r.settle();
    r.renderer.ambient = true;
    r.frame(1000);
    expect(r.sched.requested).toBe(false);
    expect(r.sched.wakes.at(-1)).toBe(1000 + AMBIENT_MS);
    expect(r.loop.settled()).toBe(true);
    expect(AMBIENT_MS).toBe(100);
    // A deadline before the ambient beat comes first.
    r.inputs.push({ t: "dismiss", stamp: { at: 1000, commit: r.state.commit } });
    r.renderer.ambient = true;
    r.frame(1010);
    expect(r.sched.wakes.at(-1)).toBe(1040);
    // Nothing ambient: idle with no wake.
    r.frame(1040);
    expect(r.sched.wakes.at(-1)).toBeNull();
  });

  it("a deadline within a frame runs on the next frame rather than a timer", () => {
    const r = rig({
      update: (s, m) =>
        m.t === "dismiss" ? { state: { ...s, deadlines: setDeadline(s.deadlines, "app/x", 18) }, effects: [] } : update(s, m),
    });
    r.loop.start();
    r.frame(0);
    r.inputs.push({ t: "dismiss", stamp: { at: 10, commit: 1 } });
    r.frame(10);
    expect(r.sched.requested).toBe(true);
  });

  it("keeps requesting frames while the renderer reports activity", () => {
    const r = rig();
    r.loop.start();
    r.renderer.active = true;
    r.frame(0);
    r.frame(16);
    expect(r.sched.requested).toBe(true);
    r.renderer.active = false;
    r.frame(32);
    expect(r.sched.requested).toBe(false);
  });

  it("commits once per frame, with increasing commit ids, never going back in time", () => {
    const r = rig();
    r.loop.start();
    r.frame(100);
    r.frame(90);
    expect(r.commits.map((c) => [c.commit, c.now])).toEqual([
      [1, 100],
      [2, 100],
    ]);
  });
});
