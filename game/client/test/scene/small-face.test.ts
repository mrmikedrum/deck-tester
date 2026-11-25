// A card under 56 px on screen wears its small face: the size describe measures rides the piece to the actor the stage
// draws, through its face cache, and to the tapped copies it shows.
import { describe, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import { diff, modelOf } from "../../src/model";
import { NO_FOCUS, Stage, describe as describeTable, poseQuad } from "../../src/scene/stage";
import { catalog, corpusNames, corpusSnapshot, viewerOf } from "../model/fixtures";
import { NO_CUES } from "./corpus";

const count = (n: string): number => {
  const m = modelOf(corpusSnapshot(n), catalog, viewerOf());
  return m ? [...m.cards.values()].filter((c) => c.zone === "battlefield").length : 0;
};

/** Each unit the stage draws: whether its face is the small form, and whether its card is under 56 px where it rests. */
function drawn(name: string, viewport: { w: number; h: number }) {
  const model = modelOf(corpusSnapshot(name), catalog, viewerOf())!;
  const plan = planTable(tableInputOf(model, { viewport }));
  const pieces = describeTable({ model, plan, cues: NO_CUES, focus: NO_FOCUS, hover: null }).pieces;
  const { view } = new Stage().show({ model, plan, changes: [diff(null, model, 1)], mode: "cut", cues: NO_CUES, focus: NO_FOCUS, moments: [], hover: null, commit: 1 }, 1000);
  return view.actors
    .filter((a) => a.draw.t === "unit" && a.face)
    .map((a) => {
      const q = poseQuad(plan.projector, pieces.get(a.id)!.pose);
      return {
        id: a.id,
        under: Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) < 56,
        small: a.face!.small,
        copies: a.draw.t === "unit" ? a.draw.copies.filter((c) => c.face).map((c) => c.face!.small) : [],
      };
    });
}

describe("the small face", () => {
  // The corpus table with the most permanents in play.
  const name = [...corpusNames].sort((a, b) => count(b) - count(a))[0]!;
  it("is the face the stage draws exactly where a card is under 56 px, its tapped copies too", () => {
    const all = [...drawn(name, { w: 1180, h: 820 }), ...drawn(name, { w: 568, h: 320 })];
    expect(all.some((f) => f.under)).toBe(true);
    expect(all.some((f) => !f.under)).toBe(true);
    for (const f of all) {
      expect(f.small, f.id).toBe(f.under);
      for (const c of f.copies) expect(c, `${f.id}'s copy`).toBe(f.small);
    }
  });
});
