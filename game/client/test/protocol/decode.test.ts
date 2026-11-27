/// <reference types="node" />
// What the decoders refuse, what they let through, and the key and answer rules.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { answerProblem, answerRequest, decodeAnswerReply, decodeSnapshot } from "../../src/protocol";
import type { DecodeError, Snapshot } from "../../src/protocol";

const CORPUS = resolve(import.meta.dirname, "../../../../tests/fixtures/protocol");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- hand-edited envelopes
const load = (name: string): Json => JSON.parse(readFileSync(resolve(CORPUS, name), "utf8")) as Json;

const files = readdirSync(CORPUS)
  .filter((n) => /^\d.*\.json$/.test(n))
  .sort();
/** A fresh copy of the first corpus envelope whose decision fits, so the tests survive regenerating the corpus. */
function find(fits: (d: Json, env: Json) => boolean): Json {
  for (const name of files) {
    const env = load(name);
    if (env["decision"] && fits(env["decision"], env)) return env;
  }
  throw new Error("no such envelope in the corpus");
}
const play = (): Json =>
  find(
    (d, env) => d.kind === "play" && d.details && d.options.length >= 3 && env.view.players[1].battlefield.length > 0,
  );
const attack = (): Json => find((d) => d.kind === "attack" && d.options.length >= 3);
const decision = (fields: Json): Json => ({
  state: "playing",
  v: 1,
  error: null,
  decision: { id: 7, kind: "play", turn: "T1 main1", prompt: "", min: 1, max: 1, repeat: false, mine: true, ...fields },
});

function ok(json: unknown): Snapshot {
  const r = decodeSnapshot(json);
  if (!r.ok) throw new Error(r.error.summary);
  return r.value;
}

function refused(json: unknown): DecodeError {
  const r = decodeSnapshot(json);
  if (r.ok) throw new Error("decoded");
  return r.error;
}

describe("decodeSnapshot refuses what the client would act on wrongly", () => {
  it("anything but an object", () => {
    for (const x of [null, "x", 3]) expect(refused(x).summary).toMatch(/Expected Object/);
    expect(refused([]).issues.map((i) => i.path)).toEqual(["state", "v"]);
  });

  it("an unknown state", () => {
    const e = refused({ state: "paused", v: 3, error: null });
    expect(e.issues[0]?.path).toBe("state");
    expect(e.summary).toMatch(/^state: /);
  });

  it("a missing version", () => {
    expect(refused({ state: "no game", error: null }).issues.map((i) => i.path)).toEqual(["v"]);
  });

  it("a card id that is not a number, with the path to it", () => {
    const env = play();
    env["view"].players[1].battlefield[0].id = "834";
    expect(refused(env).issues[0]?.path).toBe("view.players.1.battlefield.0.id");
  });

  it("refs that do not line up with the options", () => {
    const env = play();
    const n = env["decision"].options.length;
    env["decision"].refs.pop();
    expect(refused(env).summary).toBe(`decision: refs has ${n - 1} entries for ${n} options`);
  });

  it("a choose's refs, when it has them, that do not line up with the options", () => {
    const env = decision({ kind: "choose", prompt: "a creature", options: ["Grizzly Bears", "Hill Giant"], refs: [{ card: 3 }] });
    expect(refused(env).summary).toBe("decision: refs has 1 entries for 2 options");
  });

  it("details that do not line up with the options", () => {
    const env = play();
    const n = env["decision"].options.length;
    env["decision"].details.push("extra");
    expect(refused(env).summary).toBe(`decision: details has ${n + 1} entries for ${n} options`);
  });

  it("a decision without its id", () => {
    const env = play();
    delete env["decision"].id;
    expect(refused(env).issues[0]?.path).toBe("decision.id");
    env["decision"].id = 0;
    expect(refused(env).issues[0]?.path).toBe("decision.id");
  });

  it("an attack option without its defender", () => {
    const env = attack();
    delete env["decision"].refs[2].to;
    expect(refused(env).issues[0]?.path).toBe("decision.refs.2.to");
  });

  it("a play decision without refs", () => {
    const env = play();
    delete env["decision"].refs;
    expect(refused(env).issues[0]?.path).toBe("decision.refs");
  });

  it("bounds a choice cannot meet", () => {
    const env = attack();
    const n = env["decision"].options.length;
    env["decision"].max = n + 1;
    expect(refused(env).summary).toBe(`decision: max ${n + 1} is above the ${n} options of a choice without repeats`);
    const env2 = attack();
    env2["decision"].min = 5;
    env2["decision"].max = 2;
    expect(refused(env2).summary).toMatch(/min 5 is above max 2/);
  });

  it("an answer status in an unknown state", () => {
    expect(refused({ state: "no game", v: 0, error: null, answer: { key: "k", state: "lost" } }).issues[0]?.path).toBe(
      "answer.state",
    );
  });
});

describe("decodeSnapshot tolerates what the architecture says it must", () => {
  it("decodes priority mana quotes and payment-dependent reductions without requiring them", () => {
    const env = play();
    const hand = env["view"].players[0].hand;
    hand[0].castCost = { mana: "3 {U}", change: "reduced" };
    hand[1].castCost = { mana: "1 {U}", change: "increased" };
    hand[2].castCost = { reducibleBy: ["Convoke"] };
    expect(ok(env).view?.players[0]?.hand?.slice(0, 4).map((card) => card.castCost)).toEqual([
      hand[0].castCost, hand[1].castCost, hand[2].castCost, undefined,
    ]);
  });

  it("an unknown decision kind passes as a generic decision keyed by its wire kind", () => {
    const env = decision({ kind: "vote", options: ["Atraxa", "Dack"], refs: [{}, { card: 1, extra: true }] });
    const d = ok(env).decision;
    expect(d?.kind).toBe("unknown");
    if (d?.kind !== "unknown") return;
    expect(d.wireKind).toBe("vote");
    expect(d.id).toBe(7);
    expect(d.key).toBe("vote|T1 main1||2|Atraxa|Dack");
    expect(d.refs?.[1]).toEqual({ card: 1, extra: true });
  });

  it("a choose asked by label only (a colour, a type, a yes or no: Gson leaves the null refs out) gets one empty ref per option", () => {
    const empty = { card: null, player: null, name: null, search: false };
    for (const refs of [undefined, null]) {
      const env = decision({ kind: "choose", prompt: "a color (Thriving Grove)", options: ["white", "blue", "black", "red"], refs });
      if (refs === undefined) delete env["decision"].refs;
      const d = ok(env).decision;
      expect(d?.kind).toBe("choose");
      if (d?.kind !== "choose") return;
      expect(d.refs).toEqual([empty, empty, empty, empty]);
      expect(d.key).toBe("choose|T1 main1|a color (Thriving Grove)|4|white|blue|black|red");
    }
  });

  it("each decision carries its game's gen, so an answer can name the game it was meant for", () => {
    expect(ok({ ...decision({ kind: "confirm", options: ["yes", "no"] }), gen: 3 }).decision?.gen).toBe(3);
    expect(ok(decision({ kind: "confirm", options: ["yes", "no"] })).decision?.gen).toBeNull();
  });

  it("unknown keys are dropped, unknown phases allowed", () => {
    const env = play();
    env["future"] = 1;
    env["view"].phase = "COMBAT_SOMETHING_NEW";
    env["view"].players[1].battlefield[0].glow = "gold";
    const snap = ok(env);
    expect("future" in snap).toBe(false);
    expect(snap.view?.phase).toBe("COMBAT_SOMETHING_NEW");
    expect("glow" in (snap.view?.players[1]?.battlefield[0] ?? {})).toBe(false);
  });

  it("refs on a kind that has none are ignored", () => {
    const env = find((d) => d.kind === "order");
    env["decision"].refs = env["decision"].options.map(() => ({}));
    const d = ok(env).decision;
    expect(d?.kind).toBe("order");
    expect(d && "refs" in d).toBe(false);
  });

  it("view {} and a missing view are both null; Python's nulls are accepted", () => {
    expect(
      ok({ state: "playing", gen: 1, v: 2, error: null, view: {}, decision: null, over: null, pilots: {} }).view,
    ).toBeNull();
    expect(ok({ state: "playing", gen: null, v: 2, error: null, view: null, over: null }).view).toBeNull();
  });

  it("the answer status and build stamp decode; envelopes from before them get null", () => {
    const snap = ok({
      state: "no game",
      v: 0,
      error: null,
      build: "abc123",
      answer: { key: "k", id: 9, attempt: 4, state: "refused", error: "pick exactly 1" },
    });
    expect(snap.build).toBe("abc123");
    expect(snap.answer).toEqual({ key: "k", id: 9, attempt: 4, state: "refused", error: "pick exactly 1" });
    // a bridge from before the attempt number sends none
    expect(ok({ state: "no game", v: 0, error: null, answer: { key: "k", state: "working" } }).answer).toEqual({
      key: "k",
      id: null,
      state: "working",
      error: null,
    });
  });

  it("an answer status's attempt is a whole number", () => {
    for (const attempt of [-1, 1.5, "2"])
      expect(refused({ state: "no game", v: 0, error: null, answer: { key: "k", attempt, state: "working" } }).issues[0]?.path).toBe(
        "answer.attempt",
      );
  });
});

describe("the decision key", () => {
  const options = [
    "pass",
    "Escape to the Wilds",
    "Stable Wormhole",
    "Incubation Druid",
    "Forest (land)",
    "Terrasymbiosis",
  ];

  it("is game.py's key: kind, turn, prompt, option count and the first six labels", () => {
    const env = decision({ options: [...options, "Genesis Device"], refs: [...options, "x"].map(() => ({})) });
    expect(ok(env).decision?.key).toBe(
      "play|T1 main1||7|pass|Escape to the Wilds|Stable Wormhole|Incubation Druid|Forest (land)|Terrasymbiosis",
    );
  });

  it("for a number, the count is 0 and there are no labels", () => {
    const env = decision({ kind: "number", prompt: "X for Fireball", options: [], min: 0, max: 13 });
    expect(ok(env).decision?.key).toBe("number|T1 main1|X for Fireball|0");
  });

  it("a missing prompt counts as empty", () => {
    const env = decision({ kind: "confirm", options: ["yes", "no"] });
    delete env["decision"].prompt;
    expect(ok(env).decision?.key).toBe("confirm|T1 main1||2|yes|no");
  });
});

describe("answers", () => {
  const d = ok(attack()).decision;
  const pay = ok(find((x) => x.kind === "pay" && x.repeat && x.options.length >= 2)).decision;
  const num = ok(decision({ kind: "number", prompt: "X for Fireball", options: [], min: 0, max: 13 })).decision;

  it("name the decision by its id and its game's gen, and carry its key for the bridge's check", () => {
    if (!d) throw new Error("no decision");
    expect(d.gen).toEqual(expect.any(Number));
    expect(answerRequest(d, { answer: [1, 2] })).toEqual({ id: d.id, gen: d.gen, key: d.key, answer: [1, 2] });
    expect(answerRequest(d, { defer: true })).toEqual({ id: d.id, gen: d.gen, key: d.key, defer: true });
    // a decision from a snapshot without a gen names none (the bridge then checks the id and key alone)
    if (!num) throw new Error("no decision");
    expect(answerRequest(num, { answer: [3] })).toEqual({ id: num.id, key: num.key, answer: [3] });
  });

  it("are checked as the engine checks them", () => {
    if (!d || !pay || !num) throw new Error("no decision");
    expect(answerProblem(d, [])).toBeNull();
    expect(answerProblem(d, [0])).toBe(`options are 1 to ${d.options.length}`);
    expect(answerProblem(d, [3, 3])).toBe("each option at most once");
    expect(answerProblem(pay, [1, 1])).toBeNull(); // pay repeats
    expect(answerProblem(num, [14])).toBe("answer one number from 0 to 13");
    expect(answerProblem(num, [13])).toBeNull();
    for (const bad of [1.5, NaN, Infinity, -Infinity])
      expect(answerProblem(num, [bad]), String(bad)).toBe("answer one number from 0 to 13");
  });

  it("replies decode", () => {
    expect(decodeAnswerReply({ ok: true })).toEqual({ ok: true, value: { ok: true } });
    expect(decodeAnswerReply({ ok: false, error: "that decision has passed" })).toEqual({
      ok: true,
      value: { ok: false, error: "that decision has passed" },
    });
    expect(decodeAnswerReply({ fine: 1 }).ok).toBe(false);
    // a forwarded answer's reply names its attempt, which the snapshot's answer status carries too
    expect(decodeAnswerReply({ ok: true, attempt: 3 })).toEqual({ ok: true, value: { ok: true, attempt: 3 } });
    expect(decodeAnswerReply({ ok: false, error: "pick exactly 1", attempt: 4 })).toEqual({
      ok: true,
      value: { ok: false, error: "pick exactly 1", attempt: 4 },
    });
  });
});
