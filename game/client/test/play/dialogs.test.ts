// Behaviour to pin, items 9 and 10, and the controller's laws: `mulligan` and `confirm`; which kinds offer "Let Forge
// decide"; refusals toast and free the prompt; one answer in flight per stop (a double act sends one); stale acts,
// deadlines and replies are no-ops; new games, restarts and rewinds while an answer is out; startup states send
// nothing; a spectator sees the headline, no buttons, and never sends; an unknown kind gets the generic sheet and a warn.
// Also the planning fault fixed here: an answer the bridge says it applied, with the view unchanged, frees the prompt.
import { describe, expect, it } from "vitest";
import type { CardId } from "../../src/protocol";
import type { StopId } from "../../src/play";
import { Table, askedAgain, decoded, ofKind, raw, withDecision } from "./rig";

describe("mulligan and confirm", () => {
  it("mulligan: Keep n sends [1], Mulligan [2]; over the table with the hand away; never \"Auto\" (corpus 007)", () => {
    const t = new Table();
    t.open("007-mulligan-commander-zone.json");
    const p = t.p.controls.prompt!;
    expect(p.style).toBe("overlay");
    expect(p.headline).toBe("Keep this hand?");
    expect(t.buttons()).toEqual(["Mulligan", "Keep 7"]);
    expect(t.p.board.handAway).toBe(true);
    t.press("Keep 7");
    expect(t.answers()).toEqual([[1]]);
    const u = new Table();
    u.open("007-mulligan-commander-zone.json");
    u.press("Mulligan");
    expect(u.answers()).toEqual([[2]]);
  });

  it("confirm: Yes sends [1], No sends [2] (corpus 019)", () => {
    const t = new Table();
    t.open("019-confirm-monarch.json");
    expect(t.buttons()).toEqual(["Yes", "No", "Auto"]);
    expect(t.p.controls.prompt?.headline).toBe("Use this?");
    t.press("Yes");
    expect(t.answers()).toEqual([[1]]);
    const u = new Table();
    u.open("019-confirm-monarch.json");
    u.press("No");
    expect(u.answers()).toEqual([[2]]);
  });

  it("\"Auto\" sends the decision's id, its game's gen and its key with defer, and no picks (corpus 019)", () => {
    const t = new Table();
    t.open("019-confirm-monarch.json");
    t.press("Auto");
    const body = t.lastSend()!.body;
    expect(body).toEqual({ id: 88, gen: 1, key: expect.any(String), defer: true });
    expect(body.key).toBe(decoded(raw("019-confirm-monarch.json")).decision!.key);
  });

  it("\"Auto\" on a play sends defer, not [1] (corpus 009)", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("Auto");
    expect(t.answers()).toEqual(["defer"]);
  });

  const UNKNOWN = () => withDecision("019-confirm-monarch.json", { kind: "vote", prompt: "vote for a player", options: ["Alpha", "Beta"] });
  it.each([
    ["mulligan (007)", "007-mulligan-commander-zone.json", false],
    ["play with plays (009)", "009-play-commander-zone.json", true],
    ["play on my own spell (013)", "013-play-stack.json", true],
    ["play on their spell with responses (048)", "048-play-three-players.json", true],
    ["play on their item with nothing to answer it (030)", "030-play-watching.json", false],
    ["play, empty stack, only mana (026)", "026-play-monarch.json", true],
    ["pay (011)", "011-pay-my-planeswalker.json", true],
    ["targets (021)", "021-targets-monarch.json", true],
    ["choose (029)", "029-choose-monarch.json", true],
    ["order (016)", "016-order-mana-pool.json", true],
    ["number (036)", "036-number-poison.json", true],
    ["mode (039)", "039-mode-poison.json", true],
    ["confirm (019)", "019-confirm-monarch.json", true],
    ["attack (037)", "037-attack-poison.json", true],
    ["block (033)", "033-block-attack-on-planeswalker-they-attack.json", true],
  ])("%s offers \"Auto\": %s", (_, env, offered) => {
    const t = new Table();
    t.open(env);
    expect(t.buttons().includes("Auto")).toBe(offered);
  });
  it("an unknown kind offers \"Auto\" too", () => {
    const t = new Table();
    t.open(UNKNOWN());
    expect(t.buttons()).toContain("Auto");
  });
});

describe("refusals and the answer in flight", () => {
  it("while an answer is out the prompt is busy: \"…\", no answering buttons, nothing lit, no sheet", () => {
    const t = new Table();
    t.open("013-play-stack.json");
    t.press("Resolve");
    const c = t.p.controls;
    expect(c.prompt).toMatchObject({ headline: "…", busy: true });
    expect(t.buttons()).toEqual([]);
    expect(c.cardActions.size).toBe(0);
    expect(t.p.board.marks.hand.size).toBe(0);
  });

  it("a refusal toasts its reason and frees the prompt: a second answer can be sent (corpus 009)", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("To combat");
    expect(ofKind(t.settled("refused", "x"), "toast")).toEqual([{ kind: "toast", text: "x" }]);
    expect(t.buttons()).toContain("To combat");
    t.press("To combat");
    expect(t.answers()).toEqual([[1], [1]]);
  });

  it("a refusal without a reason toasts \"Forge refused that\"", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("To combat");
    expect(t.settled("refused", null)).toEqual([{ kind: "toast", text: "Forge refused that" }]);
  });

  it("a refusal keeps the draft (corpus 037: the attack picked)", () => {
    const t = new Table();
    t.open("037-attack-poison.json");
    t.tapCard(871);
    t.press("Attack (1)");
    t.settled("refused", "no");
    expect(t.buttons()).toContain("Attack (1)");
  });

  it("a lost request toasts \"Lost the bridge\" and frees the prompt (pinned from the old client)", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("To combat");
    expect(t.settled("lost")).toEqual([{ kind: "toast", text: "Lost the bridge" }]);
    t.press("To combat");
    expect(t.sends()).toHaveLength(2);
  });

  it("nothing settled, nothing freed: the prompt stays busy through idle polls of the same view", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("To combat");
    t.open("009-play-commander-zone.json", { continuity: "same" });
    expect(t.p.controls.prompt?.busy).toBe(true);
  });

  // Play does not read the bridge's answer status: the host's ledger matches it to the answer's attempt and settles the
  // answer (test/app/answers.test.ts); play follows each settlement.
  it("the host's settlement frees the prompt: refused toasts its reason, lost says so, the rest say nothing", () => {
    const env = "009-play-commander-zone.json";
    for (const [how, said] of [
      ["refused", ["not now"]],
      ["lost", ["Lost the bridge"]],
      ["applied", []],
      ["unseen", []],
    ] as const) {
      const t = new Table();
      t.open(env);
      t.press("To combat");
      const fx = t.settled(how, how === "refused" ? "not now" : null);
      expect(ofKind(fx, "toast").map((f) => f.text), how).toEqual(said);
      expect(t.p.controls.prompt?.busy, how).toBe(false);
      expect(t.buttons(), how).toContain("To combat");
    }
  });

  it("a transport outcome is not a settlement: only the host's `settled` frees the prompt", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("To combat");
    const token = t.lastSend()!.token;
    // The old public route: a raw transport outcome fed straight to play.
    const legacy = { t: "sent", at: t.now, token, outcome: { t: "indeterminate" } } as unknown as Parameters<typeof t.feed>[0];
    expect(t.feed(legacy)).toEqual([]);
    expect(t.p.controls.prompt?.busy).toBe(true);
    expect(ofKind(t.settled("lost"), "toast")).toEqual([{ kind: "toast", text: "Lost the bridge" }]);
    expect(t.p.controls.prompt?.busy).toBe(false);
  });

  it("a snapshot's answer status frees nothing by itself (an old refusal seen again leaves a retry busy)", () => {
    const env = "009-play-commander-zone.json";
    const t = new Table();
    t.open(env);
    t.press("To combat");
    t.settled("refused", "invalid");
    t.press("To combat");
    const again = raw(env);
    again["answer"] = { key: decoded(raw(env)).decision!.key, id: decoded(raw(env)).decision!.id, attempt: 1, state: "refused", error: "invalid" };
    expect(t.open(again, { continuity: "same" })).toEqual([]);
    expect(t.p.controls.prompt?.busy).toBe(true);
  });

  it("a settlement for another answer frees nothing", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("To combat");
    const token = t.lastSend()!.token;
    t.settled("refused", "x", (token + 1) as typeof token);
    t.settled("applied", null, null);
    expect(t.p.controls.prompt?.busy).toBe(true);
  });

  it("the bridge working on an answer this page did not send keeps the prompt busy until it is settled", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.working();
    expect(t.p.controls.prompt).toMatchObject({ headline: "…", busy: true });
    expect(t.buttons()).not.toContain("To combat"); // nothing to answer with meanwhile
    expect(t.settled("applied", null, null)).toEqual([]);
    expect(t.p.controls.prompt?.busy).toBe(false);
    t.press("To combat");
    expect(t.sends()).toHaveLength(1);
  });

  it("working for another stop, or with an answer of its own out, changes nothing", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.working("1.99.99" as StopId);
    expect(t.p.controls.prompt?.busy).toBe(false);
    t.press("To combat");
    t.working();
    t.settled("applied", null, null);
    expect(t.p.controls.prompt?.busy).toBe(true); // its own answer is still out
  });

  it("the next decision frees the prompt and answers normally (009 then 010)", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("To combat");
    t.open("010-play-my-planeswalker-commander.json");
    expect(t.p.controls.prompt?.busy).toBe(false);
    t.press("To combat");
    expect(t.sends().map((s) => s.body.id)).toEqual([3, 67]);
  });

  it("a double press sends one answer; so does a press then a tap, or two taps that each would send", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    const pass = t.button("To combat").id;
    t.act({ a: "press", button: pass });
    t.act({ a: "press", button: pass });
    t.release(50, -200);
    expect(t.sends()).toHaveLength(1);

    const u = new Table();
    u.open("021-targets-monarch.json");
    u.tapCard(856);
    u.tapCard(856);
    u.tapCard(834);
    expect(u.sends()).toHaveLength(1);
  });

  it("an auto-pass and a press racing send one answer", () => {
    const t = new Table();
    t.open("030-play-watching.json");
    t.press("OK");
    t.advance(5000);
    expect(t.sends()).toHaveLength(1);
  });
});

describe("stale acts, deadlines and replies", () => {
  it("an act drawn for an older stop is dropped, even for the same question asked again", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    const old = t.stop!;
    const pass = t.button("To combat").id;
    t.open(askedAgain(raw("009-play-commander-zone.json")));
    expect(t.stop).not.toBe(old);
    expect(t.act({ a: "press", button: pass }, old)).toEqual([]);
    expect(t.act({ a: "tap", on: { card: 50 as CardId } }, old)).toEqual([]);
    expect(t.act({ a: "release", card: 50 as CardId, dy: -200, pose: { rect: { x: 0, y: 0, w: 1, h: 1 } as never, rotation: 0, scale: 1 }, overTable: true }, old)).toEqual([]);
    expect(t.sends()).toEqual([]);
    t.act({ a: "press", button: pass });
    expect(t.sends()).toHaveLength(1);
  });

  it("an act with no stop while a decision is up, or naming a stop that never was, is dropped", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    expect(t.act({ a: "press", button: "pass" }, null)).toEqual([]);
    expect(t.act({ a: "press", button: "pass" }, "nope" as StopId)).toEqual([]);
  });

  it("a press of a button not on show, or a pick of an option not offered, does nothing", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    expect(t.act({ a: "press", button: "attack" })).toEqual([]);
    expect(t.pick(1)).toEqual([]); // pass is no card's action
    expect(t.pick(99)).toEqual([]);
    expect(t.pick(Number.NaN)).toEqual([]);
    t.press("All plays (3)");
    expect(t.pick(1)).toEqual([]); // not on the open sheet
  });

  it("a reply for an answer no longer out is ignored: no toast for a decision that is gone", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("To combat");
    const token = t.lastSend()!.token;
    t.open("010-play-my-planeswalker-commander.json");
    expect(t.settled("refused", "late", token)).toEqual([]);
    expect(t.settled("lost", null, token)).toEqual([]);
    expect(t.p.controls.prompt?.busy).toBe(false);
  });

  it("a deadline no one set, or set for an older stop, is a no-op", () => {
    const t = new Table();
    t.open("030-play-watching.json");
    const old = [...t.due.keys()][0]!;
    t.open(withDecision("030-play-watching.json", { kind: "confirm", prompt: "use it?", options: ["yes", "no"] }));
    expect(t.feed({ t: "deadline", at: 9999, id: old })).toEqual([]);
    expect(t.feed({ t: "deadline", at: 9999, id: "play/whatever" })).toEqual([]);
    expect(t.sends()).toEqual([]);
  });

  it("link changes change nothing", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    const before = t.state;
    t.feed({ t: "link", at: 1, up: false });
    expect(t.state).toBe(before);
  });
});

describe("new games, restarts and rewinds", () => {
  it("a new game while an answer is out: the old reply is ignored and the new decision answers with its own id", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("To combat");
    const old = t.lastSend()!.token;
    t.open("007-mulligan-commander-zone.json", { continuity: "newGame" });
    expect(t.buttons()).toContain("Keep 7");
    expect(t.settled("refused", "late", old)).toEqual([]);
    t.press("Keep 7");
    expect(t.sends().map((s) => s.body.id)).toEqual([3, 1]);
  });

  it("a new game clears the attack picks; the same game with the same decision keeps them (corpus 037)", () => {
    const t = new Table();
    t.open("037-attack-poison.json");
    t.tapCard(871);
    t.open("037-attack-poison.json", { continuity: "same" });
    expect(t.buttons()).toContain("Attack (1)");
    t.open("037-attack-poison.json", { continuity: "newGame" });
    expect(t.buttons()).toContain("No attack");
    expect(t.sends()).toEqual([]);
  });

  it("a new gen in the model counts as a new game even when the transport says advance", () => {
    const t = new Table();
    t.open("037-attack-poison.json");
    t.tapCard(871);
    const next = raw("037-attack-poison.json");
    next["gen"] = 2;
    t.open(next, { continuity: "advance" });
    expect(t.buttons()).toContain("No attack");
  });

  it("a new game closes an open sheet (corpus 009 then 007)", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("All plays (3)");
    t.open("009-play-commander-zone.json", { continuity: "newGame" });
    expect(t.p.controls.sheet).toBeNull();
  });

  it("a restart (the bridge's v went backwards) replaces the decision and sends nothing; the next answer is the new one's", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("To combat");
    t.open("026-play-monarch.json", { continuity: "restart" });
    expect(t.buttons()).toContain("End turn");
    expect(t.sends()).toHaveLength(1);
    t.press("End turn");
    expect(t.sends().map((s) => s.body.id)).toEqual([3, 135]);
  });

  it("a rewind adopts the decision as a new stop: the draft starts over and older acts are dropped", () => {
    const t = new Table();
    t.open("037-attack-poison.json");
    const old = t.stop;
    t.tapCard(871);
    t.open("037-attack-poison.json", { continuity: "rewind" });
    expect(t.stop).not.toBe(old);
    expect(t.buttons()).toContain("No attack");
    expect(t.act({ a: "tap", on: { card: 871 as CardId } }, old)).toEqual([]);
  });
});

describe("startup and empty states", () => {
  it.each(["001-no-game.json", "002-starting.json", "003-start-failed.json", "005-playing-view-empty.json"])(
    "%s: no prompt, nothing lit, and nothing an act does sends",
    (env) => {
      const t = new Table();
      t.open(env);
      expect(t.p.controls).toMatchObject({ stop: null, prompt: null, sheet: null, mayAnswer: false });
      for (const a of [
        { a: "tap", on: { nothing: true } },
        { a: "press", button: "pass" },
        { a: "pick", option: 1 },
        { a: "step", by: 1 },
        { a: "dismiss" },
      ] as const)
        t.act(a, null);
      t.advance(10_000);
      expect(t.sends()).toEqual([]);
    },
  );

  it("a game with no decision says whose move it is (corpus 006: setup, no one active yet)", () => {
    const t = new Table();
    t.open("006-playing-empty-hand.json");
    expect(t.p.controls.prompt?.headline).toBe("Waiting…");
    expect(t.tap({ nothing: true })).toEqual([{ kind: "unclaimed" }]);
  });

  it.each(["050-over-one-player.json", "060-over-i-lost.json"])("%s: game over, nothing to answer", (env) => {
    const t = new Table();
    t.open(env);
    expect(t.p.controls.prompt?.headline).toBe("Game over");
    expect(t.sends()).toEqual([]);
  });

  it("a game after the empty states plays normally", () => {
    const t = new Table();
    t.open("001-no-game.json");
    t.open("009-play-commander-zone.json", { continuity: "newGame" });
    t.press("To combat");
    expect(t.answers()).toEqual([[1]]);
  });
});

describe("a spectator (mayAnswer false)", () => {
  const ACTS = [
    { a: "tap", on: { card: 871 as CardId } },
    { a: "tap", on: { seat: "Dack" } },
    { a: "drag", from: { card: 871 as CardId }, onto: { seat: "Dack" } },
    { a: "release", card: 33 as CardId, dy: -200, pose: { rect: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0, scale: 1 }, overTable: true },
    { a: "press", button: "attack" },
    { a: "press", button: "defer" },
    { a: "press", button: "sheet-done" },
    { a: "pick", option: 1 },
    { a: "step", by: 1 },
    { a: "dismiss" },
  ] as never[];

  it.each([
    ["037-attack-poison.json", "Declare attackers"],
    ["019-confirm-monarch.json", "Use this?"],
    ["016-order-mana-pool.json", "Triggers onto the stack, first in resolves last"],
    ["030-play-watching.json", "Atraxa's Gideon Jura ability"],
    ["036-number-poison.json", "X for Fireball"],
  ])("%s: the headline, no buttons, no sheet, nothing lit, never a send", (env, headline) => {
    const t = new Table();
    t.open(env, { mayAnswer: false });
    const c = t.p.controls;
    expect(c.mayAnswer).toBe(false);
    expect(c.prompt?.headline).toBe(headline);
    expect(c.prompt?.buttons).toEqual([]);
    expect(c.sheet).toBeNull();
    expect(c.cardActions.size).toBe(0);
    expect(t.p.board.marks.hand.size + [...t.p.board.marks.cards.values()].filter((m) => m !== "danger").length).toBe(0);
    for (const a of ACTS) t.act(a);
    t.advance(10_000);
    expect(t.sends()).toEqual([]);
  });

  it("what threatens the watched seat still glows red (030, targets edited)", () => {
    const t = new Table();
    const env = raw("030-play-watching.json");
    ((env["view"] as Record<string, unknown>)["stack"] as { targets: unknown[] }[])[0]!.targets = [818];
    t.open(env, { mayAnswer: false });
    expect(t.p.board.marks.cards.get(818 as CardId)).toBe("danger");
  });
});

describe("dismiss", () => {
  it("closes play's own sheet first, then sets aside a chooser; with neither it is the app's (a layer, the mulligan)", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("All plays (3)");
    expect(t.dismiss()).toEqual([]);
    expect(t.p.controls.sheet).toBeNull();
    expect(t.dismiss()).toEqual([{ kind: "unclaimed" }]);
    const m = new Table();
    m.open("007-mulligan-commander-zone.json");
    expect(m.dismiss()).toEqual([{ kind: "unclaimed" }]);
  });
});

describe("an unknown kind", () => {
  it("gets the generic sheet by its labels and a warning; a pick answers by number (019, a \"vote\" decision)", () => {
    const t = new Table();
    const fx = t.open(withDecision("019-confirm-monarch.json", { kind: "vote", prompt: "vote for a player", options: ["Alpha", "Beta"] }));
    expect(ofKind(fx, "warn")).toEqual([{ kind: "warn", text: expect.stringContaining('"vote"') }]);
    const sheet = t.p.controls.sheet!;
    expect(sheet.kind).toBe("chooser");
    expect(sheet.items.map((i) => i.label)).toEqual(["Alpha", "Beta"]);
    expect(t.buttons()).toContain("Choose…");
    t.pick(2);
    expect(t.answers()).toEqual([[2]]);
  });

  it("warns once per stop, not on every poll", () => {
    const t = new Table();
    const env = withDecision("019-confirm-monarch.json", { kind: "vote", prompt: "vote", options: ["Alpha", "Beta"] });
    t.open(env);
    expect(ofKind(t.open(env, { continuity: "same" }), "warn")).toEqual([]);
  });
});
