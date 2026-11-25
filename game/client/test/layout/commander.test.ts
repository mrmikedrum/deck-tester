// The commander beside its plaque (h.js `banner`): while it waits in the command zone it stands next to its seat's plaque,
// a card of its own a tap reaches (its group "command:<seat>"), at least the any-card floor wide, clear of the plaque;
// once it has left the command zone there is none.
import { describe, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import { bounds } from "../../src/layout/shape";
import { modelOf } from "../../src/model";
import { NO_FOCUS, describe as describeTable } from "../../src/scene/stage";
import { decodeSnapshot } from "../../src/protocol";
import { catalog, corpusSnapshot, rawCorpus, viewerOf } from "../model/fixtures";
import { NO_CUES } from "../scene/corpus";

const SUPPORTED = [
  { w: 1180, h: 820 },
  { w: 1024, h: 768 },
  { w: 1366, h: 1024 },
];

describe("the commander beside its plaque", () => {
  const model = modelOf(corpusSnapshot("009-play-commander-zone.json"), catalog, viewerOf())!;
  it("stands beside every seat's plaque, tappable, at least 44 px wide, never over it", () => {
    for (const vp of SUPPORTED) {
      const plan = planTable(tableInputOf(model, { viewport: vp }));
      expect(plan.violations, `${vp.w}x${vp.h}`).toEqual([]);
      for (const seat of model.seats) {
        const cmd = model.zone(seat.id, "command")[0]!;
        const g = plan.hits.groups.find((x) => x.id === `command:${seat.id}`)!;
        expect(g, `${seat.id} ${vp.w}x${vp.h}`).toMatchObject({ kind: "card", seat: seat.id, members: [cmd] });
        const b = bounds(g.quad), p = bounds(plan.hits.groups.find((x) => x.id === `plate:${seat.id}`)!.quad);
        expect((b.r - b.l) * (1180 / vp.w), `${seat.id} width`).toBeGreaterThanOrEqual(44 - 1e-6);
        expect(b.l >= p.r - 1 || b.r <= p.l + 1, `${seat.id} beside its plaque`).toBe(true);
      }
    }
  });
  it("is drawn as its own card, which the plaque no longer counts", () => {
    const plan = planTable(tableInputOf(model, { viewport: SUPPORTED[0]! }));
    const d = describeTable({ model, plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
    for (const seat of model.seats) {
      const cmd = model.zone(seat.id, "command")[0]!;
      expect(d.pieces.get(`command:${seat.id}`)?.members).toEqual([cmd]);
      expect(d.pieces.get(`plate:${seat.id}`)?.members).not.toContain(cmd);
      expect(d.home.get(cmd)).toBe(`command:${seat.id}`);
    }
  });
  it("gone from the command zone, it has no place there", () => {
    const env = structuredClone(rawCorpus.get("009-play-commander-zone.json")!) as { view: { players: Record<string, unknown>[] } };
    env.view.players[0]!["command"] = [];
    const r = decodeSnapshot({ ...env, decision: null });
    if (!r.ok) throw new Error(r.error.summary);
    const later = modelOf(r.value, catalog, viewerOf())!;
    const plan = planTable(tableInputOf(later, { viewport: SUPPORTED[0]! }));
    const me = later.viewer.perspective;
    expect(plan.hits.groups.some((g) => g.id === `command:${me}`)).toBe(false);
    expect(plan.hits.groups.filter((g) => g.id.startsWith("command:"))).toHaveLength(3);
  });
});
