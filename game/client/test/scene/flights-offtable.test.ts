/// <reference types="node" />
// A card bound for an opponent's graveyard or exile, which lie off the table (the nameplate's focus holds them): a
// discard or a mill still flies, to its owner's plate.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe as group, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import { diff } from "../../src/model/delta";
import type { CardId } from "../../src/protocol";
import { NO_FOCUS, describe } from "../../src/scene/stage";
import { planFlights } from "../../src/scene/stage/flights";
import { designModels } from "../../src/scene/workbench/bench-inputs";
import { NO_CUES } from "./corpus";

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../tests/fixtures/boards/design-pass.json"), "utf8")) as { stages: { turn: number; envelope: { view: { players: { name: string; graveyard?: unknown[] }[] } } }[]; catalog: unknown };

function at(extra: readonly unknown[]) {
  const st = structuredClone(raw.stages.find((x) => x.turn === 15)!);
  const dack = st.envelope.view.players.find((p) => p.name === "Dack")!;
  dack.graveyard = [...(dack.graveyard ?? []), ...extra];
  return designModels({ stages: [st], catalog: raw.catalog }).get(15)!;
}

group("flights to an opponent's graveyard off the table", () => {
  it("a discard and a mill fly to the owner's plate", () => {
    const card = (id: number, name: string) => ({ id, name, owner: "Dack", controller: "Dack", type: "Instant" });
    const before = at([]), after = at([card(7001, "Discarded"), card(7002, "Milled")]);
    const plan = planTable(tableInputOf(after, { viewport: { w: 1180, h: 820 }, engine: { draw: true } }));
    const desc = describe({ model: after, plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
    const set = diff(before, after, 1);
    const flights = planFlights(set, { model: after, desc, homeOf: (id: CardId) => desc.home.get(id) ?? null, poseOf: () => null, shownOf: () => [], moments: [] });
    for (const id of [7001, 7002]) {
      const f = flights.find((x) => x.card === id);
      expect(f, String(id)).toBeDefined();
      expect(f!.dest).toEqual({ to: "nowhere", how: "plate", seat: "Dack" });
    }
  });
});
