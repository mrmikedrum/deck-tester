// Auras and Equipment on a card (a unit's `dressed`): one cast onto a creature is drawn on it only once its flight has
// landed, and never counted in the unit's title. Rancor (826) onto 855, from 022.
import { describe, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import { diff, modelOf } from "../../src/model";
import type { TableModel } from "../../src/model";
import { decodeSnapshot } from "../../src/protocol";
import type { CardId } from "../../src/protocol";
import { NO_FOCUS, Stage, describe as describeTable } from "../../src/scene/stage";
import type { ActorView } from "../../src/scene/stage";
import { catalog, rawCorpus, viewerOf } from "../model/fixtures";
import { NO_CUES } from "./corpus";

const RANCOR = 826 as CardId;
const raw = rawCorpus.get("022-play-attachment.json")! as { view: { players: Record<string, unknown[]>[] } };
const modelFrom = (env: unknown): TableModel => {
  const r = decodeSnapshot({ ...(env as object), decision: null });
  if (!r.ok) throw new Error(r.error.summary);
  return modelOf(r.value, catalog, viewerOf())!;
};
/** Before: Rancor still in my hand. */
const before = (() => {
  const env = structuredClone(raw);
  const me = env.view.players[0]!;
  const bf = me["battlefield"]!;
  const i = bf.findIndex((c) => (c as { id: number }).id === RANCOR);
  const [rancor] = bf.splice(i, 1) as [Record<string, unknown>];
  delete rancor["attachedTo"];
  me["hand"] = [...me["hand"]!, rancor];
  return modelFrom(env);
})();
const after = modelFrom(raw);
const VP = { w: 1180, h: 820 };

const dressedOn = (actors: readonly ActorView[]): CardId[][] =>
  actors.flatMap((a) => (a.draw.t === "unit" && a.draw.dressed.length ? [a.draw.dressed.map((d) => d.card)] : []));

describe("dressing", () => {
  it("Rancor cast onto a creature is drawn on it once it lands, not while it flies", () => {
    const p0 = planTable(tableInputOf(before, { viewport: VP }));
    const p1 = planTable(tableInputOf(after, { viewport: VP, memory: p0.memory }));
    const s0 = diff(null, before, 1), s1 = diff(before, after, 2);
    expect(s1.changes.some((c) => c.t === "moved" && c.card === RANCOR)).toBe(true);
    const frame = (model: TableModel, plan: typeof p0, changes: typeof s0[], commit: number) =>
      ({ model, plan, changes, mode: "animate", cues: NO_CUES, focus: { layer: null, seat: null, group: null, card: null }, moments: [], hover: null, commit }) as const;
    const stage = new Stage();
    let t = 0;
    stage.show(frame(before, p0, [s0], 1), (t += 16));
    for (let k = 0; k < 300; k++) if (!stage.show(frame(before, p0, [], 1), (t += 16)).report.active) break;
    let r = stage.show(frame(after, p1, [s1], 2), (t += 16));
    let flewWhileDressed = false, landed = false;
    for (let k = 0; k < 600; k++) {
      const flying = stage.inspect().flights.some((f) => f.card === RANCOR);
      const on = dressedOn(r.view.actors).some((ids) => ids.includes(RANCOR));
      if (flying && on) flewWhileDressed = true;
      if (!flying && on) landed = true;
      if (!r.report.active) break;
      r = stage.show(frame(after, p1, [], 2), (t += 16));
    }
    expect(flewWhileDressed).toBe(false);
    expect(landed).toBe(true);
    // The unit it dresses counts its own card only.
    const host = r.view.actors.find((a) => a.draw.t === "unit" && a.draw.dressed.some((d) => d.card === RANCOR))!;
    expect(host.shown).toBe(1);
  });

  it("review: a lone host says when its attachment is offered, and wears the newcomer light when its Aura is new", () => {
    const plan = planTable(tableInputOf(after, { viewport: VP, engine: { decision: { kind: "targets", options: [RANCOR], draft: [] } } }));
    const host = [...plan.seats.values()].flatMap((p) => p.units).find((u) => u.dressing.includes(RANCOR))!;
    expect(host.members.length).toBe(1);
    expect(host.cue).toBe("act");
    const rest = planTable(tableInputOf(after, { viewport: VP, engine: {} }));
    const d = describeTable({ model: after, plan: rest, cues: NO_CUES, focus: NO_FOCUS, hover: null, news: [RANCOR] });
    const piece = [...d.pieces.values()].find((p) => p.draw.t === "unit" && p.members.includes(RANCOR))!;
    expect(piece.draw).toMatchObject({ cue: "news", light: "forward" });
    const offered = describeTable({ model: after, plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
    expect([...offered.pieces.values()].find((p) => p.draw.t === "unit" && p.members.includes(RANCOR))!.draw).toMatchObject({ cue: "act" });
  });
});
