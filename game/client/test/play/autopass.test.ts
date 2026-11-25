// Behaviour to pin, item 3: auto-pass. On someone else's spell or ability, with nothing real to answer it with (mana
// abilities don't count) and nothing aimed at me or mine, play passes by itself 3,200 ms after the decision arrived.
// A threat, my own spell, a real option or Hold stops it; a replacement decision during the countdown never answers
// the old one. Time is the events' own: the rig fires deadlines when it advances, as the app's loop does.
import { describe, expect, it } from "vitest";
import { AUTO_PASS_MS } from "../../src/play";
import { Table, askedAgain, edited, ofKind, raw, withDecision } from "./rig";

/** Corpus 030: Atraxa's Gideon Jura ability on top, my only option a mana ability. */
const THEIRS = "030-play-watching.json";
const aimedAt = (target: number | string) =>
  edited(THEIRS, (v) => {
    (v["stack"] as { targets: unknown[] }[])[0]!.targets = [target];
  });

describe("it passes", () => {
  it.each([
    ["an opponent's ability, only mana on offer (corpus 030)", THEIRS],
    ["an opponent's spell, only mana on offer (corpus 038)", "038-play-watching.json"],
    ["an opponent's trigger at their end step (corpus 046)", "046-play-watching.json"],
    ["three of their items, the lower ones aimed at their own commander (corpus 040)", "040-play-watching.json"],
  ])("%s: nothing at 3,199 ms, one [1] at 3,200 ms", (_, env) => {
    const t = new Table();
    const fx = t.open(env);
    const armed = ofKind(fx, "deadline");
    expect(armed).toEqual([{ kind: "deadline", id: expect.stringMatching(/^play\/autopass:/), ms: AUTO_PASS_MS }]);
    expect(AUTO_PASS_MS).toBe(3200);
    t.advance(3199);
    expect(t.answers()).toEqual([]);
    t.advance(1);
    expect(t.answers()).toEqual([[1]]);
    t.advance(10_000);
    expect(t.answers()).toHaveLength(1);
  });

  it("while it counts, the prompt shows the countdown, the pass button counts, and Hold leads", () => {
    const t = new Table();
    t.now = 500;
    t.open(THEIRS);
    const p = t.p.controls.prompt!;
    expect(p.countdown).toEqual({ from: 500, ms: 3200 });
    expect(p.headline).toBe("Atraxa's Gideon Jura ability");
    expect(p.hint).toBeNull();
    expect(t.buttons()).toEqual(["Hold", "OK"]);
    expect(t.button("OK").countdown).toBe(true);
    expect(t.buttons()).not.toContain("Auto");
  });
});

describe("it does not pass", () => {
  const never = (t: Table) => {
    t.advance(10_000);
    expect(t.answers()).toEqual([]);
    expect(t.buttons()).not.toContain("Hold");
  };
  it("a threat to me: the item aimed at me (030, targets edited)", () => {
    const t = new Table();
    expect(ofKind(t.open(aimedAt("You")), "deadline")).toEqual([]);
    expect(t.p.controls.prompt?.tone).toBe("threat");
    never(t);
  });
  it("a threat to my permanent (030, targets edited), which glows red", () => {
    const t = new Table();
    t.open(aimedAt(818));
    expect(t.p.board.marks.cards.get(818 as never)).toBe("danger");
    never(t);
  });
  it("a real play on offer (corpus 048: responses)", () => {
    const t = new Table();
    t.open("048-play-three-players.json");
    never(t);
  });
  it("my own spell on top (corpus 013)", () => {
    const t = new Table();
    t.open("013-play-stack.json");
    never(t);
  });
  it("an empty stack (corpus 026)", () => {
    const t = new Table();
    t.open("026-play-monarch.json");
    never(t);
  });
  it("a decision that is not a play (corpus 032: a confirm on Atraxa's turn)", () => {
    const t = new Table();
    t.open("032-confirm-watching.json");
    never(t);
  });
  it("a spectator's table (030 watched with mayAnswer false)", () => {
    const t = new Table();
    expect(ofKind(t.open(THEIRS, { mayAnswer: false }), "deadline")).toEqual([]);
    t.advance(10_000);
    expect(t.sends()).toEqual([]);
  });

  it("Hold stops it and goes away", () => {
    const t = new Table();
    t.open(THEIRS);
    t.advance(1000);
    const fx = t.press("Hold");
    expect(ofKind(fx, "deadline")).toEqual([{ kind: "deadline", id: expect.stringMatching(/^play\/autopass:/), ms: null }]);
    expect(t.buttons()).toEqual(["OK"]);
    expect(t.p.controls.prompt?.countdown).toBeNull();
    never(t);
    t.press("OK");
    expect(t.answers()).toEqual([[1]]);
  });

  it("touching the table holds it (and the touch is still the app's to use)", () => {
    const t = new Table();
    t.open(THEIRS);
    t.advance(1000);
    const fx = t.tap({ nothing: true });
    expect(fx).toEqual([{ kind: "deadline", id: expect.any(String), ms: null }, { kind: "unclaimed" }]);
    never(t);
  });

  it("Hold at 3,190 ms beats the pass due at 3,200 ms; the deadline arriving after it is a no-op", () => {
    const t = new Table();
    t.open(THEIRS);
    const id = [...t.due.keys()][0]!;
    t.advance(3190);
    t.press("Hold");
    expect(t.feed({ t: "deadline", at: 3200, id })).toEqual([]);
    expect(t.answers()).toEqual([]);
  });

  it("Hold after the pass went is too late: the answer is out and Hold is gone", () => {
    const t = new Table();
    t.open(THEIRS);
    t.advance(3210);
    expect(t.answers()).toEqual([[1]]);
    expect(t.buttons()).toEqual([]);
    expect(t.p.controls.prompt?.busy).toBe(true);
  });
});

describe("a decision arriving during the countdown", () => {
  it("the same decision again (an idle poll) neither restarts nor stops it", () => {
    const t = new Table();
    t.open(THEIRS);
    t.advance(2000);
    expect(t.open(THEIRS, { continuity: "same" })).toEqual([]);
    t.advance(1199);
    expect(t.answers()).toEqual([]);
    t.advance(1);
    expect(t.answers()).toEqual([[1]]);
  });

  it("a different decision replaces it: the old timer never answers, the new one counts from its arrival", () => {
    const t = new Table();
    t.open(THEIRS);
    const old = [...t.due.keys()][0]!;
    t.advance(2000);
    const next = askedAgain(raw(THEIRS), { prompt: "again" });
    const fx = t.open(next);
    const deadlines = ofKind(fx, "deadline");
    expect(deadlines[0]).toEqual({ kind: "deadline", id: old, ms: null });
    expect(deadlines[1]?.ms).toBe(3200);
    expect(deadlines[1]?.id).not.toBe(old);
    // the old deadline, had it fired anyway, answers nothing
    expect(t.feed({ t: "deadline", at: 3200, id: old })).toEqual([]);
    t.advance(1200 + 1999);
    expect(t.answers()).toEqual([]);
    t.advance(1);
    expect(t.sends()).toHaveLength(1);
    expect(t.lastSend()!.body).toMatchObject({ id: (next["decision"] as { id: number }).id, answer: [1] });
  });

  it("a replacement with a real play never passes, and the old timer is cancelled (030, a response added)", () => {
    const t = new Table();
    t.open(THEIRS);
    t.advance(2000);
    t.open(withDecision(THEIRS, { kind: "play", options: ["pass", "Brainstorm"], refs: [{}, { card: 830, spell: true }] }));
    expect(t.due.size).toBe(0);
    t.advance(10_000);
    expect(t.answers()).toEqual([]);
  });

  it("a replacement that is a threat never passes", () => {
    const t = new Table();
    t.open(THEIRS);
    t.advance(2000);
    t.open(askedAgain(aimedAt("You")));
    t.advance(10_000);
    expect(t.answers()).toEqual([]);
  });

  it("a replacement that is not a play (a confirm) is never passed", () => {
    const t = new Table();
    t.open(THEIRS);
    t.advance(2000);
    t.open(withDecision(THEIRS, { kind: "confirm", prompt: "use it?", options: ["yes", "no"] }));
    t.advance(10_000);
    expect(t.answers()).toEqual([]);
  });

  it("the same decision turning into a threat (030, a target changed to me) cancels it at once", () => {
    const t = new Table();
    t.open(THEIRS);
    t.advance(1000);
    const fx = t.open(aimedAt("You"), { continuity: "same" });
    expect(ofKind(fx, "deadline")).toEqual([{ kind: "deadline", id: expect.stringMatching(/^play\/autopass:/), ms: null }]);
    expect(t.p.controls.prompt?.tone).toBe("threat");
    expect(t.p.controls.prompt?.countdown).toBeNull();
    t.advance(10_000);
    expect(t.answers()).toEqual([]);
  });

  it("a deadline that fires after the decision stopped qualifying passes nothing (checked again when it fires)", () => {
    const t = new Table();
    t.open(THEIRS);
    const id = [...t.due.keys()][0]!;
    t.advance(1000);
    t.open(aimedAt(818), { continuity: "same" });
    expect(t.feed({ t: "deadline", at: 3200, id })).toEqual([]);
    expect(t.answers()).toEqual([]);
  });

  it("a new game during the countdown cancels it", () => {
    const t = new Table();
    t.open(THEIRS);
    t.advance(1000);
    t.open("009-play-commander-zone.json", { continuity: "newGame" });
    expect(t.due.size).toBe(0);
    t.advance(10_000);
    expect(t.answers()).toEqual([]);
  });

  it("a snapshot without a game during the countdown cancels it", () => {
    const t = new Table();
    t.open(THEIRS);
    t.advance(1000);
    t.open("001-no-game.json");
    expect(t.due.size).toBe(0);
  });
});
