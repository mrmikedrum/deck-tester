// The clash in words (app/clash.ts): the plaque says who attacks whom and how much is unblocked, never "damage"; the
// plates' tallies take the wing's tone; plaques never meet. No pronouns.
import { describe, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import { clashViewOf, combatDamage, plaqueWords, spreadPlaques, withTallies } from "../../src/app/clash";
import type { CardId } from "../../src/protocol";
import type { PlateView } from "../../src/chrome/view";
import type { TableModel } from "../../src/model";
import { card, creature, land, tableOf } from "../model/fixtures";

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

  it("after combat damage, the plaque says what Forge logged as dealt: not a life payment, not before the combat", () => {
    const log = [
      { i: 3, type: "DAMAGE", text: "Raider (20) deals 6 combat damage to You.", card: 20 }, // an earlier combat
      { i: 8, type: "LIFE", text: "You's life total changed from 40 to 38.", card: null }, // paid 2 life
      { i: 9, type: "DAMAGE", text: "Raider (20) deals 3 combat damage to You.", card: 20 },
      { i: 10, type: "DAMAGE", text: "Brute (21) deals 4 damage to Jace Beleren (40).", card: 21 },
    ];
    const hit = tableOf({
      active: "Atraxa",
      phase: "COMBAT_DAMAGE",
      seats: {
        You: { life: 35, battlefield: [creature(10, "Guard", "You", 1, 3), card(40, "Jace Beleren", "You", "Legendary Planeswalker - Jace", { loyalty: 1 }), land(19, "Plains", "You")] },
        Atraxa: { battlefield: [creature(20, "Raider", "Atraxa", 3), creature(21, "Brute", "Atraxa", 4), land(29, "Plains", "Atraxa")] },
      },
      combat: { attackers: [{ id: 20, defender: "You" }, { id: 21, defender: 40 }] },
      log,
    });
    const plan = planTable(tableInputOf(hit, { viewport: VP }));
    const words = (since: number) => clashViewOf(hit, plan, since)!.plaques.map((p) => p.words).sort();
    expect(words(5)).toEqual(["Atraxa attacks Jace Beleren · 4 dealt", "Atraxa attacks You · 3 dealt"]);
    // before any damage is logged in this combat, what is unblocked
    expect(words(10)).toEqual(["Atraxa attacks Jace Beleren · 4 unblocked", "Atraxa attacks You · 3 unblocked"]);
    expect(combatDamage(hit, 5, new Set([20 as CardId]))).toEqual(new Map([["sYou", 3]]));
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

  it("past one tier, the rest wait in one column that says how many and how much: \"N more · P power\"", () => {
    const ids = Array.from({ length: 20 }, (_, i) => 100 + i);
    const m = tableOf({
      active: "Atraxa",
      phase: "COMBAT_DECLARE_BLOCKERS",
      seats: { You: { battlefield: [land(19, "Plains", "You")] }, Atraxa: { battlefield: ids.map((c, i) => creature(c, `Fighter ${i}`, "Atraxa", 2, 2)) } },
      combat: { attackers: ids.map((c) => ({ id: c, defender: "You" })) },
    });
    const plan = planTable(tableInputOf(m, { viewport: VP }));
    const v = clashViewOf(m, plan)!, n = plan.gathering!.more.length;
    expect(n).toBeGreaterThan(0);
    expect(v.more!.words).toBe(`${n} more · ${2 * n} power`);
    expect(plan.hits.groups.find((g) => g.id === "clash:more")!.members).toHaveLength(n);
  });

  it("plaques that would meet are spread apart and kept on the screen", () => {
    const out = spreadPlaques([{ x: 500, w: 300 }, { x: 560, w: 300 }, { x: 1150, w: 200 }], 16, 1194, 8);
    for (let i = 1; i < out.length; i++) expect(out[i]!.x - out[i]!.w / 2).toBeGreaterThanOrEqual(out[i - 1]!.x + out[i - 1]!.w / 2 + 8 - 1e-6);
    expect(out.at(-1)!.x + out.at(-1)!.w / 2).toBeLessThanOrEqual(1194 + 1e-6);
    expect(out[0]!.x - out[0]!.w / 2).toBeGreaterThanOrEqual(16 - 1e-6);
  });
});
