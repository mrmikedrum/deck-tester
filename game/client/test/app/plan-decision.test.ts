/// <reference types="node" />
// The decision in hand is part of what the table is laid out from (app/plan.ts): the cards it offers step out of a fold
// or are named where one hides them, so two prompts on the same board revision are two plans.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionFactsOf, replan } from "../../src/app/plan";
import { initialState } from "../../src/app/state";
import type { BoardCues } from "../../src/play";
import type { CardId, Decision } from "../../src/protocol";
import { designModels } from "../../src/scene/workbench/bench-inputs";

const VP = { w: 1210, h: 834, safe: { top: 0, right: 0, bottom: 0, left: 0 } };
const design = designModels(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../tests/fixtures/boards/design-pass.json"), "utf8")));
const cues: BoardCues = { stop: null, marks: { cards: new Map(), seats: new Map(), hand: new Set() }, combat: null, handAway: false };
const targets = (id: number, cards: readonly number[]): Decision =>
  ({ kind: "targets", id, turn: "T15 main1", prompt: "Choose a target", options: cards.map(String), refs: cards.map((c) => ({ card: c as CardId, player: null, name: null })), min: 1, max: 1, repeat: false, mine: true }) as unknown as Decision;

describe("the decision in hand", () => {
  it("its facts: the kind, the cards it offers, my attack draft", () => {
    expect(decisionFactsOf(null, cues)).toEqual({ kind: null, options: [], draft: [] });
    expect(decisionFactsOf(targets(1, [1064, 1015, 1064]), cues)).toEqual({ kind: "targets", options: [1015, 1064], draft: [] });
  });

  it("two target prompts on the same board revision: two plans, each naming its own folded target", () => {
    const model = design.get(15)!;
    const s0 = { ...initialState({ clientBuild: "t", viewport: VP }), model };
    const rest = replan(s0, cues).state;
    // a card of Marath's folded into a fan (not its top): what a target prompt would leave hidden
    const marath = model.seats[1]!.id;
    const fan = rest.plan!.leaves!.get(marath)!.result!.fit.units.find((u) => u.kind === "fan" && u.members.length > 2)!;
    const [a, b] = [fan.members[1]!, fan.members[2]!];
    const withA = replan({ ...rest, session: { ...rest.session, decision: targets(7, [a]) } }, cues).state;
    const withB = replan({ ...withA, session: { ...withA.session, decision: targets(8, [b]) } }, cues).state;
    expect(withA.model!.rev).toBe(withB.model!.rev);
    expect(withA.planKey).not.toBe(rest.planKey);
    expect(withB.planKey).not.toBe(withA.planKey);
    expect(withB.plan).not.toBe(withA.plan);
    const offered = (s: typeof withA, id: CardId) => s.plan!.leaves!.get(marath)!.result!.fit.attention.some((x) => x.why === "offered" && x.cards.includes(id));
    expect(offered(withA, a)).toBe(true);
    expect(offered(withA, b)).toBe(false);
    expect(offered(withB, b)).toBe(true);
    expect(offered(withB, a)).toBe(false);
  });
});
