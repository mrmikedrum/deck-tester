// The clash in words (app/clash.ts): the plaque says who attacks whom and how much is unblocked, never "damage"; the
// plates' tallies take the wing's tone; plaques never meet. No pronouns.
import { describe, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import { clashViewOf, plaqueWords, spreadPlaques, withTallies } from "../../src/app/clash";
import type { PlateView } from "../../src/chrome/view";
import type { TableModel } from "../../src/model";
import { creature, land, tableOf } from "../model/fixtures";

const VP = { w: 1210, h: 834 };
const PRONOUN = /\b(you|your|yours|he|she|they|them|his|her|their|it|its)\b/;
const plate = (seat: string, mine = false): PlateView => ({ seat, group: `plate:${seat}`, name: seat, life: 40, place: "near", mine, active: false, ring: null, out: false, x: 0, y: 0, unit: 1, icons: [] });

function table(active: "You" | "Atraxa", attackers: { id: number; defender: string }[], blockers: { id: number; blocking: number }[] = []): TableModel {
  return tableOf({
    active,
    phase: "COMBAT_DECLARE_BLOCKERS",
    seats: {
      You: { battlefield: [creature(10, "Guard", "You", 1, 3), creature(11, "Scout", "You", 2, 2), land(19, "Plains", "You")] },
      Atraxa: { battlefield: [creature(20, "Raider", "Atraxa", 3), creature(21, "Brute", "Atraxa", 4), creature(22, "Wisp", "Atraxa", 0, 1), land(29, "Plains", "Atraxa")] },
      Dack: { battlefield: [creature(30, "Watcher", "Dack", 1, 4), land(39, "Plains", "Dack")] },
    },
    combat: { attackers, blockers },
  });
}

describe("the clash's words", () => {
  it("attacked: \"Atraxa attacks You · 3 unblocked\"; a hollow brand at 0; my plate's tally in red", () => {
    const m = table("Atraxa", [20, 21, 22].map((id) => ({ id, defender: "You" })), [{ id: 10, blocking: 21 }]);
    const plan = planTable(tableInputOf(m, { viewport: VP }));
    const v = clashViewOf(m, plan)!;
    expect(v.plaques.map((p) => p.words)).toEqual(["Atraxa attacks You · 3 unblocked"]);
    expect(v.brands.map((b) => b.figure ?? "hollow").sort()).toEqual(["3", "hollow"]);
    expect(v.clasps).toHaveLength(1);
    const plates = withTallies([plate("You", true), plate("Atraxa")], m, plan);
    expect(plates[0]!.tally).toEqual({ figure: "−3", tone: "danger", place: "left" });
    expect(plates[1]!.attacking).toBe(true);
  });

  it("my attack blocked: \"You attack Atraxa · 2 unblocked\", gold", () => {
    const m = table("You", [10, 11].map((id) => ({ id, defender: "Atraxa" })), [{ id: 20, blocking: 10 }]);
    const plan = planTable(tableInputOf(m, { viewport: VP }));
    const v = clashViewOf(m, plan)!;
    expect(v.plaques.map((p) => [p.words, p.tone])).toEqual([["You attack Atraxa · 2 unblocked", "gold"]]);
    expect(withTallies([plate("Atraxa")], m, plan)[0]!.tally).toMatchObject({ figure: "−2", tone: "gold" });
  });

  it("between opponents, the attacker's ink; the words say unblocked, never damage, and carry no pronoun but the seat named You", () => {
    const m = table("Atraxa", [20, 21].map((id) => ({ id, defender: "Dack" })), [{ id: 30, blocking: 20 }]);
    const plan = planTable(tableInputOf(m, { viewport: VP }));
    const v = clashViewOf(m, plan)!;
    expect(v.plaques[0]!.tone).toBe("ink");
    for (const p of v.plaques) {
      expect(p.words).not.toMatch(/damage/i);
      expect(p.words.replace(/\bYou\b/g, "")).not.toMatch(PRONOUN);
    }
    expect(plaqueWords(m, plan.gathering!.wings[0]!)).toBe("Atraxa attacks Dack · 4 unblocked");
  });

  it("plaques that would meet are spread apart and kept on the screen", () => {
    const out = spreadPlaques([{ x: 500, w: 300 }, { x: 560, w: 300 }, { x: 1150, w: 200 }], 16, 1194, 8);
    for (let i = 1; i < out.length; i++) expect(out[i]!.x - out[i]!.w / 2).toBeGreaterThanOrEqual(out[i - 1]!.x + out[i - 1]!.w / 2 + 8 - 1e-6);
    expect(out.at(-1)!.x + out.at(-1)!.w / 2).toBeLessThanOrEqual(1194 + 1e-6);
    expect(out[0]!.x - out[0]!.w / 2).toBeGreaterThanOrEqual(16 - 1e-6);
  });
});
