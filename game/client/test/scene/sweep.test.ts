// What a pending sweep would harm is in danger on the table as plainly as a target is (h.js `swept`): Sunfall on the
// stack marks every creature on every side, and nothing it does not reach.
import { describe as group, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import { NO_FOCUS, describe } from "../../src/scene/stage";
import { creature, land, spell, tableOf } from "../model/fixtures";
import { NO_CUES } from "./corpus";

group("a pending sweep", () => {
  it("Sunfall marks every creature in danger, never a land", () => {
    const sunfall = spell(951, "Sunfall", "Dack", "Exile all creatures. Incubate X, where X is the number of creatures exiled this way.", "Sorcery");
    const m = tableOf({
      active: "Dack",
      seats: { You: { battlefield: [creature(10, "Grizzly Bears", "You"), land(1, "Plains", "You")] }, Atraxa: { battlefield: [creature(20, "Hill Giant", "Atraxa", 3, 3)] } },
      stack: [{ id: 961, source: sunfall }],
    });
    const plan = planTable(tableInputOf(m, { viewport: { w: 1180, h: 820 } }));
    const d = describe({ model: m, plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
    const markOf = (id: number) => [...d.pieces.values()].find((p) => p.kind === "unit" && p.members.includes(id as never))?.mark ?? null;
    expect([markOf(10), markOf(20), markOf(1)]).toEqual(["danger", "danger", null]);
  });
});
