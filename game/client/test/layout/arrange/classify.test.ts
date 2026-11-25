import { describe, expect, it } from "vitest";
import { arrCard, arrCardOf, typesOf } from "../../../src/layout/arrange/card";
import { kindOf } from "../../../src/layout/arrange/policies/kinds";
import type { CardId } from "../../../src/layout/types";
import { modelOf } from "../../../src/model";
import { card, catalog, corpusSnapshot, creature, tableOf, viewerOf } from "../../model/fixtures";

// Classification follows each card's CURRENT types, every plan (§1.2, §7.1's named cases). The engine's type line is
// what a card is now; the catalog's printed line never decides.

const one = (type: string, more: Record<string, unknown> = {}, name = "Thing") => {
  const m = tableOf({ seats: { Atraxa: { battlefield: [card(1, name, "Atraxa", type, more)] } } });
  return arrCard(m, 1 as CardId)!;
};

describe("type flags are the current type line's, non-exclusive", () => {
  it("splits card types, supertypes and subtypes", () => {
    const t = typesOf("Legendary Artifact Creature — Spacecraft");
    expect(t.types).toEqual({ creature: true, land: false, artifact: true, enchantment: false, planeswalker: false, battle: false });
    expect(t.legendary).toBe(true);
    expect(t.subtypes).toEqual(["Spacecraft"]);
    expect(typesOf("Basic Land — Forest").basic).toBe(true);
  });

  it("a Spacecraft with station counters crossing its threshold: a work, then a creature", () => {
    const before = one("Artifact - Spacecraft", {}, "Hearthhull, the Worldseed");
    const after = one("Artifact Creature - Spacecraft", { power: 6, toughness: 7, counters: { Charge: 8 } }, "Hearthhull, the Worldseed");
    expect(kindOf(before)).toBe("works");
    expect(kindOf(after)).toBe("creature");
    expect(after.types.artifact).toBe(true);
    expect(before.lookKey).not.toBe(after.lookKey);
  });

  it("a Vehicle crewed and uncrewed never share a look", () => {
    const parked = one("Artifact - Vehicle", { power: 5, toughness: 5 }, "Smuggler's Copter");
    const crewed = one("Artifact Creature - Vehicle", { power: 5, toughness: 5 }, "Smuggler's Copter");
    expect(kindOf(parked)).toBe("works");
    expect(kindOf(crewed)).toBe("creature");
    expect(parked.lookKey).not.toBe(crewed.lookKey);
  });

  it("an animated Mutavault is a creature and a land, and a land again after", () => {
    const animated = one("Land Creature - Shapeshifter", { power: 2, toughness: 2 }, "Mutavault");
    expect(animated.types.creature && animated.types.land).toBe(true);
    expect(kindOf(animated)).toBe("creature");
    expect(kindOf(one("Land", {}, "Mutavault"))).toBe("mana");
  });

  it("Dryad Arbor is always both, and ranks as a creature", () => {
    const arbor = one("Land Creature - Forest Dryad", { power: 1, toughness: 1 }, "Dryad Arbor");
    expect(arbor.types).toMatchObject({ land: true, creature: true });
    expect(kindOf(arbor)).toBe("creature");
  });

  it("Opalescence makes an enchantment a creature", () => {
    const study = one("Enchantment", {}, "Rhystic Study");
    const animated = one("Enchantment Creature", { power: 3, toughness: 3 }, "Rhystic Study");
    expect(kindOf(study)).toBe("works");
    expect(kindOf(animated)).toBe("creature");
  });

  it("a land Blood Moon turns into a Mountain stays a land", () => {
    const moon = one("Land - Mountain", {}, "Urza's Saga");
    expect(moon.types).toMatchObject({ land: true, creature: false, enchantment: false });
    expect(kindOf(moon)).toBe("mana");
  });

  it("an artifact creature is a creature first", () => {
    expect(kindOf(one("Artifact Creature - Construct", { power: 2, toughness: 2 }))).toBe("creature");
  });

  it("a face-down card is a 2/2 creature with no other types", () => {
    const m = tableOf({ seats: { Atraxa: { battlefield: [creature(1, "Secret", "Atraxa", 2, 2, { faceDown: true, type: "Creature" })] } } });
    const c = arrCard(m, 1 as CardId)!;
    expect(c.faceDown).toBe(true);
    expect(c.types).toEqual({ creature: true, land: false, artifact: false, enchantment: false, planeswalker: false, battle: false });
  });

  it("a noncreature mana source is mana; a creature that makes mana is a creature", () => {
    const signet = one("Artifact", { text: "{T}: Add {C}." }, "Arcane Signet");
    expect(signet.manaSource).toBe(true);
    expect(kindOf(signet)).toBe("mana");
    const elf = one("Creature - Elf Druid", { power: 1, toughness: 1, text: "{T}: Add {G}." }, "Llanowar Elves");
    expect(elf.manaSource).toBe(true);
    expect(kindOf(elf)).toBe("creature");
  });

  it("a card whose types change changes its kind with no memory involved", () => {
    const m1 = tableOf({ seats: { Atraxa: { battlefield: [card(1, "Hearthhull, the Worldseed", "Atraxa", "Artifact - Spacecraft")] } } });
    const m2 = tableOf({ seats: { Atraxa: { battlefield: [card(1, "Hearthhull, the Worldseed", "Atraxa", "Artifact Creature - Spacecraft", { power: 6, toughness: 7 })] } } });
    expect(kindOf(arrCard(m1, 1 as CardId)!)).toBe("works");
    expect(kindOf(arrCard(m2, 1 as CardId)!)).toBe("creature");
  });
});

describe("the corpus case: Gideon Jura as a creature", () => {
  it("card 872 is a planeswalker and a creature now, and ranks as a creature", () => {
    const model = modelOf(corpusSnapshot("031-order-watching.json"), catalog, viewerOf())!;
    const g = model.cards.get(872 as CardId)!;
    const c = arrCardOf(g);
    expect(c.types.planeswalker).toBe(true);
    expect(c.types.creature).toBe(true);
    expect(kindOf(c)).toBe("creature");
  });
});
