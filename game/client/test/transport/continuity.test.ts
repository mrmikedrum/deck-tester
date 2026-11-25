import { describe, expect, it } from "vitest";
import { decodeSnapshot } from "../../src/protocol";
import type { Snapshot } from "../../src/protocol";
import { classify, rewound } from "../../src/transport";
import { corpus } from "./rig";

function snap(name: string, patch: Record<string, unknown> = {}): Snapshot {
  const r = decodeSnapshot(corpus(name, patch));
  if (!r.ok) throw new Error(r.error.summary);
  return r.value;
}
const a = snap("010-play-my-planeswalker-commander"); // gen 1, v 7, turn 2
const b = snap("011-pay-my-planeswalker"); // gen 1, v 9, same turn, a longer log
const view = (s: Snapshot) => {
  if (!s.view) throw new Error("no view");
  return s.view;
};
const withView = (s: Snapshot, patch: Record<string, unknown>): Snapshot => ({ ...s, view: { ...view(s), ...patch } });

describe("classify", () => {
  it("the first snapshot of a run is first", () => expect(classify(null, a)).toBe("first"));
  it("the same game moved on is advance", () => expect(classify(a, b)).toBe("advance"));
  it("the same v is same: an idle poll or a re-sync", () => expect(classify(b, b)).toBe("same"));
  it("a new gen is newGame", () => expect(classify(a, { ...b, gen: 2 })).toBe("newGame"));
  it("a v that went backwards is restart, even with the same gen", () => expect(classify(b, a)).toBe("restart"));
  it("a v that went backwards wins over a new gen: the bridge restarted", () =>
    expect(classify(b, { ...a, gen: 9 })).toBe("restart"));
  it("a v gap is still advance", () => expect(classify(a, { ...b, v: 400 })).toBe("advance"));
  it("an earlier turn at a higher v is rewind", () => {
    expect(classify(b, withView({ ...b, v: 12 }, { turn: 1 }))).toBe("rewind");
  });
  it("a log that does not carry on at a higher v is rewind", () => {
    const first = view(b).log[0];
    if (!first) throw new Error("empty log");
    expect(classify(b, withView({ ...b, v: 12 }, { log: [{ ...first, i: 3, text: "elsewhere" }] }))).toBe("rewind");
  });
  it("snapshots without a view never rewind", () => {
    expect(classify({ ...a, view: null }, b)).toBe("advance");
    expect(classify(a, { ...b, view: null })).toBe("advance");
  });
  it("a no-game envelope after a game at a lower v is restart", () => {
    const none = snap("001-no-game");
    expect(classify(b, none)).toBe("restart");
  });
  it("a new game's first snapshot after a no-game one is newGame", () => {
    const starting = snap("002-starting");
    expect(classify(snap("001-no-game", { v: 1 }), { ...starting, v: 2 })).toBe("newGame");
  });
});

describe("rewound", () => {
  const log = view(b).log;
  const tail = log[log.length - 1];
  if (!tail) throw new Error("empty log");
  const base = view(b);

  it("the log carrying on from the tail is not a rewind", () => {
    expect(rewound(base, { ...base, log: [...log, { ...tail, i: tail.i + 1, text: "more" }] })).toBe(false);
    expect(rewound(base, { ...base, log: [tail] })).toBe(false);
  });
  it("an earlier turn is a rewind whatever the log says", () => {
    expect(rewound(base, { ...base, turn: base.turn - 1 })).toBe(true);
  });
  it("a later turn with the tail missing and newer entries is not a rewind (the window slid)", () => {
    expect(rewound(base, { ...base, turn: base.turn + 1, log: [{ ...tail, i: tail.i + 5, text: "later" }] })).toBe(false);
  });
  it("a log whose first entry is not past the old tail is a rewind", () => {
    expect(rewound(base, { ...base, log: [{ ...tail, i: tail.i, text: "different" }] })).toBe(true);
  });
  it("an empty new log is a rewind once the old one had entries", () => {
    expect(rewound(base, { ...base, log: [] })).toBe(true);
  });
  it("an empty old log never rewinds on the log", () => {
    expect(rewound({ ...base, log: [] }, { ...base, log: [] })).toBe(false);
  });
});
