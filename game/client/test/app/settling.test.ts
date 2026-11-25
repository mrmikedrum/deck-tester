// Settling: while cards are in flight between zones, layout keeps each page's shape as cards leave it, and re-fits once
// they have landed. The app plans with `settling` while a queued change set moves a card or the scene reports cards
// flying, and plans again when the scene says they have all landed.
import { describe, expect, it } from "vitest";
import { initialState } from "../../src/app/state";
import { settlingOf } from "../../src/app/update";
import { raw } from "../play/rig";
import { rig } from "./rig";
import type { Rig } from "./rig";

const settlingPlan = (r: Rig): boolean => r.state.planKey?.endsWith("|settling") ?? false;

/** The slice's table at 023, every set the scene was handed consumed, nothing flying. */
function quiet(): Rig {
  const r = rig();
  r.loop.start();
  r.frame(0);
  r.transport.push(raw("023-play-monarch.json"));
  r.frame(100);
  r.renderer.report = { consumedSeq: r.state.changes.seq, flying: false };
  r.frame(116);
  r.frame(132);
  expect(r.state.changes.sets).toEqual([]);
  return r;
}

describe("settling", () => {
  it("starts false", () => {
    const s = initialState({ clientBuild: "b" });
    expect(s.settling).toBe(false);
    expect(settlingOf(s)).toBe(false);
  });

  it("plans with settling while a queued set moves a card, and while the scene reports cards flying; re-fits when they land", () => {
    const r = quiet();
    expect(settlingPlan(r)).toBe(false);

    // Lightning Bolt goes from the hand to the stack: the set that moves it waits for the scene, so pages hold.
    r.transport.push(raw("025-play-stack-targets-player.json"));
    r.frame(200);
    expect(r.state.changes.sets.some((set) => set.changes.some((c) => c.t === "moved"))).toBe(true);
    expect(settlingOf(r.state)).toBe(true);
    expect(settlingPlan(r)).toBe(true);

    // The scene takes the set and reports the card still flying: the set is gone from the queue, the page still holds.
    r.renderer.report = { consumedSeq: r.state.changes.seq, flying: true };
    r.frame(216);
    r.frame(232);
    expect(r.state.changes.sets).toEqual([]);
    expect(r.state.settling).toBe(true);
    expect(settlingPlan(r)).toBe(true);

    // It lands: the scene's report says nothing is flying, and the plan is made again without settling.
    const held = r.state.plan;
    r.renderer.report = { flying: false };
    r.frame(248);
    r.frame(264);
    expect(r.state.settling).toBe(false);
    expect(settlingPlan(r)).toBe(false);
    expect(r.state.plan).not.toBe(held);
  });

  it("a change in flying alone is news the loop folds", () => {
    const r = quiet();
    r.renderer.report = { flying: true };
    r.frame(150);
    r.frame(166);
    expect(r.state.settling).toBe(true);
    expect(settlingPlan(r)).toBe(true);
  });
});
