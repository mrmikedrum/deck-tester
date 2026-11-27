// The scene's `ambient`: an idle table is drawn at the loop's slow cadence only while something on it moves on its own.
// A spent well is a still stain, and reduced motion holds every effect still: neither keeps the cadence.
import { describe, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import { diff, modelOf } from "../../src/model";
import type { TableModel } from "../../src/model";
import { decodeSnapshot } from "../../src/protocol";
import { NO_FOCUS, Stage } from "../../src/scene/stage";
import type { SceneFrame, SceneReport } from "../../src/scene/stage";
import { catalog, rawCorpus, viewerOf } from "../model/fixtures";
import { NO_CUES } from "./corpus";

type Raw = { view: { players: { battlefield: Record<string, unknown>[] }[] } };
const modelFrom = (env: unknown): TableModel => {
  const r = decodeSnapshot({ ...(env as object), decision: null });
  if (!r.ok) throw new Error(r.error.summary);
  return modelOf(r.value, catalog, viewerOf())!;
};
/** 009 (one Island, Princess's, on the whole table), made four (a well of them), tapped or not. */
const island = (tapped: boolean): TableModel => {
  const env = structuredClone(rawCorpus.get("009-play-commander-zone.json")!) as Raw;
  const bf = env.view.players[3]!.battlefield, first = bf[0]!;
  bf.push(...[1, 2, 3].map((k) => ({ ...first, id: 9000 + k })));
  for (const c of bf) c["tapped"] = tapped;
  return modelFrom(env);
};

function atRest(model: TableModel, reducedMotion = false): SceneReport {
  const plan = planTable(tableInputOf(model, { viewport: { w: 1180, h: 820 } }));
  const frame = (changes: SceneFrame["changes"]): SceneFrame => ({ model, plan, changes, mode: "cut", cues: NO_CUES, focus: NO_FOCUS, moments: [], hover: null, commit: 1, reducedMotion });
  const stage = new Stage();
  let t = 0;
  let r = stage.show(frame([diff(null, model, 1)]), (t += 16)).report;
  for (let k = 0; k < 300 && r.active; k++) r = stage.show(frame([]), (t += 16)).report;
  expect(r.active).toBe(false);
  return r;
}

describe("ambient", () => {
  it("a well with a land ready breathes; a spent one is still", () => {
    expect(atRest(island(false)).ambient).toBe(true);
    expect(atRest(island(true)).ambient).toBe(false);
  });
  it("reduced motion: nothing moves on its own", () => {
    expect(atRest(island(false), true).ambient).toBe(false);
  });
});

describe("the turn's edge changing hands", () => {
  it("keeps the frames coming for the handover, then rests", () => {
    const at = (active: string): TableModel => {
      const env = structuredClone(rawCorpus.get("009-play-commander-zone.json")!) as Raw & { view: { active: string } };
      env.view.active = active;
      return modelFrom(env);
    };
    const a = at("You"), b = at("Atraxa");
    const plan = (m: TableModel) => planTable(tableInputOf(m, { viewport: { w: 1180, h: 820 } }));
    const pa = plan(a), pb = plan(b);
    const frame = (model: TableModel, p: typeof pa, changes: SceneFrame["changes"], commit: number): SceneFrame => ({ model, plan: p, changes, mode: "animate", cues: NO_CUES, focus: NO_FOCUS, moments: [], hover: null, commit });
    const stage = new Stage();
    let t = 0;
    let r = stage.show(frame(a, pa, [diff(null, a, 1)], 1), (t += 16)).report;
    for (let k = 0; k < 300 && r.active; k++) r = stage.show(frame(a, pa, [], 1), (t += 16)).report;
    expect(r.active).toBe(false);
    r = stage.show(frame(b, pb, [diff(a, b, 2)], 2), (t += 16)).report;
    const from = t;
    while (r.active && t - from < 2000) r = stage.show(frame(b, pb, [], 2), (t += 16)).report;
    expect(t - from).toBeGreaterThanOrEqual(300);
  });
});
