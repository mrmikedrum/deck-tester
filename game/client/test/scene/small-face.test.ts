// A card at the 44 px floor on screen wears its small face: the size describe measures rides the piece to the actor the
// stage draws, through its face cache, and to the tapped copies it shows. Anything drawn larger keeps its name and art.
import { describe, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import { diff, modelOf } from "../../src/model";
import { NO_FOCUS, SMALL_FACE_PX, Stage, describe as describeTable, poseQuad } from "../../src/scene/stage";
import { catalog, corpusNames, corpusSnapshot, viewerOf } from "../model/fixtures";
import { NO_CUES } from "./corpus";

/** Each unit the stage draws: whether its face is the small form, and whether its card is under the floor where it rests. */
function drawn(name: string, viewport: { w: number; h: number }) {
  const model = modelOf(corpusSnapshot(name), catalog, viewerOf());
  if (!model) return [];
  let plan;
  try {
    plan = planTable(tableInputOf(model, { viewport }));
  } catch {
    return [];
  }
  const pieces = describeTable({ model, plan, cues: NO_CUES, focus: NO_FOCUS, hover: null }).pieces;
  const { view } = new Stage().show({ model, plan, changes: [diff(null, model, 1)], mode: "cut", cues: NO_CUES, focus: NO_FOCUS, moments: [], hover: null, commit: 1 }, 1000);
  return view.actors
    .filter((a) => a.draw.t === "unit" && a.face)
    .map((a) => {
      const q = poseQuad(plan.projector, pieces.get(a.id)!.pose);
      return {
        id: `${name} ${a.id}`,
        under: Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) < SMALL_FACE_PX,
        small: a.face!.small,
        copies: a.draw.t === "unit" ? a.draw.copies.filter((c) => c.face).map((c) => c.face!.small) : [],
      };
    });
}

describe("the small face", () => {
  it("is drawn only at the 44 px floor: nothing on today's 1180x820 table loses its name and art", () => {
    const faces = corpusNames.flatMap((n) => drawn(n, { w: 1180, h: 820 }));
    expect(faces.length).toBeGreaterThan(100);
    for (const f of faces) expect(f.small, f.id).toBe(false);
  });
  it("is the face the stage draws exactly where a card is at the floor, its tapped copies too", () => {
    // A phone-sized table, where a card does reach the floor.
    const faces = corpusNames.flatMap((n) => drawn(n, { w: 480, h: 320 }));
    expect(faces.some((f) => f.under)).toBe(true);
    for (const f of faces) {
      expect(f.small, f.id).toBe(f.under);
      for (const c of f.copies) expect(c, `${f.id}'s copy`).toBe(f.small);
    }
  });
});
