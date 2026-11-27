import { describe, expect, it } from "vitest";
import { planTable } from "../../src/layout/plan";
import { tableInputOf } from "../../src/layout/table-input";
import { boards } from "../../src/layout/board";
import type { CardId } from "../../src/layout/types";
import { modelOf } from "../../src/model";
import { catalog, corpusSnapshot, viewerOf } from "../model/fixtures";

// Real boards from the protocol corpus, planned as the app plans them (no memory, nothing acting, no stack).
const VP = { w: 1180, h: 820 };

function planOf(name: string) {
  const model = modelOf(corpusSnapshot(name), catalog, viewerOf())!;
  return { model, plan: planTable(tableInputOf(model, { viewport: VP })) };
}

describe("a planeswalker that is a creature now (Gideon Jura, card 872)", () => {
  const GIDEON = 872 as CardId;
  for (const name of ["031-order-watching.json", "032-confirm-watching.json", "033-block-attack-on-planeswalker-they-attack.json", "034-order-blocked-poison.json", "046-play-watching.json"])
    it(`${name}: stands once, with the creatures`, () => {
      const { model, plan } = planOf(name);
      const g = model.cards.get(GIDEON)!;
      expect(g.zone).toBe("battlefield");
      const sp = plan.seats.get(g.controller)!;
      const holding = sp.units.filter((u) => u.members.includes(GIDEON) || u.dressing.includes(GIDEON));
      expect(holding.map((u) => u.role)).toEqual(["creature"]);
      expect(sp.home.get(GIDEON)).toBe(holding[0]!.id);
      // every permanent of every seat in exactly one unit
      for (const { seat, board } of boards(model)) {
        const units = plan.seats.get(seat)!.units, held = units.flatMap((u) => [...u.members, ...u.dressing]);
        expect(new Set(held).size, seat).toBe(held.length);
        expect(new Set(held), seat).toEqual(new Set(board.cards.map((c) => c.id)));
      }
    });
});
