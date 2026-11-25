// Safe-area insets move the chrome (the prompt sits inside them, and the sheet), so the reservations take them in, the
// app's plan key with them, and nothing a tap must reach lies outside the safe area or under the chrome.
import { describe, expect, it } from "vitest";
import { TAP_PX } from "../../src/layout/board";
import { planTable, reservations, tableInputOf } from "../../src/layout";
import type { Insets } from "../../src/layout/types";
import { replan } from "../../src/app/plan";
import { initialState } from "../../src/app/state";
import type { BoardCues } from "../../src/play";
import { creature, land, tableOf } from "../model/fixtures";
import { stress, SUPPORTED } from "./boards";
import { reach } from "./reach";

const VP = { w: 1180, h: 820 };
const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const IPAD: Insets = { top: 24, right: 0, bottom: 20, left: 0 };
const SIDES: Insets = { top: 0, right: 48, bottom: 21, left: 48 };

describe("reservations take the safe area in", () => {
  it("the hand and the prompt grow by the insets at their corners, and the safe area is said", () => {
    const r = reservations(VP, "normal", SIDES), hand = r.items[0]!.rect, prompt = r.items[1]!.rect;
    expect([hand.left, hand.top, hand.right, hand.bottom]).toEqual([0, 605 - 21, 470 + 48, 820]);
    expect([prompt.left, prompt.top, prompt.right, prompt.bottom]).toEqual([838 - 48, 630 - 21, 1180, 820]);
    expect(r.safe).toEqual({ left: 48, top: 0, right: 1180 - 48, bottom: 820 - 21 });
    expect(reservations(VP, "normal").safe).toEqual({ left: 0, top: 0, right: 1180, bottom: 820 });
  });
});

describe("a plan with insets", () => {
  const model = tableOf({
    seats: {
      You: { battlefield: [...Array.from({ length: 9 }, (_, i) => creature(100 + i, `Bear ${i}`, "You")), ...Array.from({ length: 7 }, (_, i) => land(200 + i, "Forest", "You"))] },
      Atraxa: { battlefield: Array.from({ length: 6 }, (_, i) => creature(300 + i, `Angel ${i}`, "Atraxa", 4, 4)) },
    },
  });

  it("changes when the insets do, and keeps everything reachable inside them", () => {
    for (const safe of [IPAD, SIDES]) {
      const none = planTable(tableInputOf(model, { viewport: VP, safe: NONE })), some = planTable(tableInputOf(model, { viewport: VP, safe }));
      expect(some.rev).not.toBe(none.rev);
      expect(some.reserve).toEqual(reservations(VP, "normal", safe));
      expect(some.violations).toEqual([]);
      const r = reach(some);
      for (const g of some.hits.groups) expect(r.get(g.id)!.side, g.id).toBeGreaterThanOrEqual(g.kind === "plate" ? 1 : TAP_PX);
    }
  });

  it("stress boards at every supported viewport stay reachable inside an iPad's insets", () => {
    for (const vp of SUPPORTED) {
      const plan = planTable({ ...stress(2, 40, 8, vp), safe: IPAD });
      const r = reach(plan);
      for (const g of plan.hits.groups) expect(r.get(g.id)!.side, `${vp.w}x${vp.h} ${g.id}`).toBeGreaterThanOrEqual(g.kind === "plate" ? 1 : TAP_PX);
    }
  });

  it("the app replans when only the insets change", () => {
    const cues: BoardCues = { stop: null, marks: { cards: new Map(), seats: new Map(), hand: new Set() }, combat: null, handAway: false };
    const s0 = { ...initialState({ clientBuild: "t", viewport: { ...VP, safe: NONE } }), model };
    const a = replan(s0, cues).state;
    expect(a.plan).not.toBeNull();
    expect(replan(a, cues).state.plan).toBe(a.plan); // unchanged inputs keep the plan
    const b = replan({ ...a, viewport: { ...VP, safe: IPAD } }, cues).state;
    expect(b.planKey).not.toBe(a.planKey);
    expect(b.plan!.rev).not.toBe(a.plan!.rev);
    expect(b.reserve).toEqual(reservations(VP, "normal", IPAD));
  });
});
