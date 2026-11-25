// A pile's title tab follows what it holds through the renderer: the view repaints a piece only when its description's
// update key (`mods`) changes, so everything its tab says (title, second line, whether it is mixed) must be in that key.
// The view's pieces are stubbed to record what each was last built or patched with.
import { describe, expect, it, vi } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import type { TablePlan } from "../../src/layout";
import { diff } from "../../src/model";
import type { ChangeSet, TableModel } from "../../src/model";
import { NO_FOCUS, Stage } from "../../src/scene/stage";
import type { ActorView, Draw } from "../../src/scene/stage";
import { StageRenderer } from "../../src/scene/three/view";
import type { Host } from "../../src/scene/three/host";
import { tableOf, token } from "../model/fixtures";
import { NO_CUES } from "./corpus";

/** What each piece view was last built or patched with, by piece id. */
const shown = new Map<string, ActorView>();
vi.mock("../../src/scene/three/pieces", async () => {
  const { Group } = await import("three");
  return {
    createPiece: (_env: unknown, v: ActorView) => {
      shown.set(v.id, v);
      return { group: new Group(), patch: (w: ActorView) => void shown.set(w.id, w), look() {}, dispose() {} };
    },
    placeGroup() {},
    artWanted: () => [],
    GhostPiece: class {},
  };
});

const VP = { w: 1180, h: 820 };
const host = { scene: { add() {}, remove() {} }, setTableTone() {}, painter: { fx: () => null }, renderer: { getPixelRatio: () => 1 } } as unknown as Host;

/** Dack's 30 Elementals (5 tapped), 20 Beasts (`beasts` of them tapped) and 12 Spirits: folded into one pile of unlike
 * creatures, its top an untapped Elemental whatever the Beasts do. */
const crowd = (beasts: number): TableModel =>
  tableOf({
    active: "You",
    seats: {
      Dack: {
        battlefield: [
          ...Array.from({ length: 30 }, (_, i) => token(200 + i, "Elemental", "Dack", 3, 3, { tapped: i < 5 })),
          ...Array.from({ length: 20 }, (_, i) => token(300 + i, "Beast", "Dack", 4, 4, { tapped: i < beasts })),
          ...Array.from({ length: 12 }, (_, i) => token(400 + i, `Spirit ${i}`, "Dack", 1, 1)),
        ],
      },
    },
  });

const tabs = (views: ReadonlyMap<string, ActorView>): Record<string, [string | null, string | null, boolean]> => {
  const out: Record<string, [string | null, string | null, boolean]> = {};
  for (const [id, v] of views) {
    if (v.draw.t !== "unit" || !v.draw.title) continue;
    const d = v.draw as Extract<Draw, { t: "unit" }>;
    out[id] = [d.title, d.sub, d.mixed];
  }
  return out;
};

describe("a pile's tab through the renderer", () => {
  it("a mixed pile whose tapped count changes (its top card the same) is repainted with its new second line", () => {
    const m0 = crowd(0), m1 = crowd(1);
    const p0 = planTable(tableInputOf(m0, { viewport: VP }));
    const p1 = planTable(tableInputOf(m1, { viewport: VP, memory: p0.memory }));
    const stage = new Stage(), view = new StageRenderer(host, () => 0);
    let t = 0, last: readonly ActorView[] = [];
    const run = (model: TableModel, plan: TablePlan, set: ChangeSet, commit: number) => {
      const frame = (changes: ChangeSet[]) => ({ model, plan, changes, mode: "animate", cues: NO_CUES, focus: NO_FOCUS, moments: [], hover: null, commit }) as const;
      let r = stage.show(frame([set]), (t += 16));
      for (let k = 0; ; k++) {
        view.draw(r.view);
        last = r.view.actors;
        if (!r.report.active || k > 600) break;
        r = stage.show(frame([]), (t += 16));
      }
    };
    run(m0, p0, diff(null, m0, 1), 1);
    const before = tabs(shown);
    expect(Object.values(before).some(([, sub, mixed]) => mixed && / · 5 tapped$/.test(sub ?? "")), JSON.stringify(before)).toBe(true);
    run(m1, p1, diff(m0, m1, 2), 2);
    // What the stage describes now, and what the pieces were last painted with, say the same.
    const described = tabs(new Map(last.map((a) => [a.id, a])));
    expect(Object.values(described).some(([, sub]) => / · 6 tapped$/.test(sub ?? "")), JSON.stringify(described)).toBe(true);
    expect(tabs(shown)).toEqual(described);
  });
});
