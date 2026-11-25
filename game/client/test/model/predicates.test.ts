// The presentation predicates against the old client's own expressions (old.ts), over every card in the corpus, and as
// tables over real cards.
import { describe, expect, it } from "vitest";
import {
  cardKey,
  decodeCatalog,
  handOrder,
  hasAbilities,
  manaValue,
  inWell,
  isArtifact,
  isBasic,
  isCreature,
  isEnchantment,
  isLand,
  isLegendary,
  isManaRock,
  isManaSource,
  isPlaneswalker,
  isSpecialLand,
  isTreasure,
  roleOf,
  sig,
  typeWord,
} from "../../src/model";
import type { Card } from "../../src/model";
import { boardOf } from "../../src/layout";
import { catalog, catalogJson, corpusNames, corpusSnapshot, rawCorpus, tableOf, viewerOf, card as wire, land, token } from "./fixtures";
import { modelOf } from "../../src/model";
import { oldWorld } from "./old";

const ZONES = ["battlefield", "command", "graveyard", "exile", "hand"] as const;

describe("every corpus card reads as the old client read it", () => {
  const envelopes = corpusNames.filter((n) => corpusSnapshot(n).view?.players.length);
  it.each(envelopes)("%s", (n) => {
    const raw = rawCorpus.get(n)!["view"] as { players: Record<string, unknown>[] };
    const old = oldWorld(raw, catalogJson);
    const m = modelOf(corpusSnapshot(n), catalog, viewerOf())!;
    // the old world named seats by position, which holds while "You" is listed first
    if (raw.players[0]!["name"] !== "You") return;
    const bf: { o: unknown; c: Card }[] = [];
    // The one deliberate difference: the old DB kept one engine type line per card name (the last seen), so a copy
    // (Phantasmal Image as "Creature - Giant Illusion") rewrote every same-named card's; the model reads each card's own.
    const types = new Map<string, Set<string>>();
    for (const p of raw.players)
      for (const z of ZONES)
        for (const w of (p[z] as { name: string; type: string }[] | null) ?? []) types.set(w.name, (types.get(w.name) ?? new Set()).add(w.type));
    for (const p of raw.players)
      for (const z of ZONES)
        for (const w of (p[z] as { id: number; name: string; type: string }[] | null) ?? []) {
          const o = old.conv(w, z), c = m.cards.get(w.id as never)!;
          const at = `${n} ${c.name} (${c.id})`;
          expect(c.face.name, at).toBe(old.name(o));
          if (types.get(w.name)!.size > 1) {
            expect(c.face.type, at).toBe(w.type.replace(/ - /g, " — "));
            continue;
          }
          expect(c.face.type, at).toBe(old.typeLine(o));
          expect(isLand(c), at).toBe(old.isLand(o));
          expect(isCreature(c), at).toBe(old.isCreature(o));
          expect(isPlaneswalker(c), at).toBe(old.isPW(o));
          expect(isManaSource(c), at).toBe(old.isMana(o));
          expect(isManaRock(c), at).toBe(old.rock(o));
          expect(isSpecialLand(c), at).toBe(old.special(o));
          expect(isTreasure(c), at).toBe(old.treasure(o));
          expect(typeWord(c), at).toBe(old.word(o));
          expect(cardKey(c), at).toBe(o.card);
          if (z === "battlefield") bf.push({ o, c });
        }
    // sig groups exactly the cards groupKey grouped
    for (const a of bf) for (const b of bf) expect(sig(a.c) === sig(b.c)).toBe(old.groupKey(a.o) === old.groupKey(b.o));
  });
});

/** A battlefield card of "You" from a wire card, through the real catalog. */
const one = (w: ReturnType<typeof wire>): Card => {
  const m = tableOf({ seats: { You: { battlefield: [w] } } });
  return m.cards.get(w.id as never)!;
};

describe("predicate tables over real cards", () => {
  const rows: [string, ReturnType<typeof wire>, Partial<Record<string, boolean | string>>][] = [
    ["Sol Ring taps for mana: a rock", wire(1, "Sol Ring", "You", "Artifact"), { rock: true, source: true, artifact: true, word: "Artifact", well: true }],
    ["Arcane Signet: a rock", wire(2, "Arcane Signet", "You", "Artifact"), { rock: true, word: "Artifact" }],
    ["Smothering Tithe makes Treasure but is a rule card, never mana", wire(3, "Smothering Tithe", "You", "Enchantment"), { source: false, rock: false, enchantment: true, word: "Enchantment" }],
    ["Kami of Whispered Hopes taps for mana but is a creature", wire(4, "Kami of Whispered Hopes", "You", "Creature - Spirit", { power: 1, toughness: 1 }), { creature: true, source: false, rock: false, word: "Creature" }],
    ["a basic land", land(5, "Forest", "You"), { land: true, basic: true, special: false, word: "Land", well: true }],
    ["Command Tower: a land that only makes mana", wire(6, "Command Tower", "You", "Land"), { land: true, special: false, legendary: false }],
    ["Urza's Saga is a land first", wire(7, "Urza's Saga", "You", "Enchantment Land - Urza's Saga"), { land: true, enchantment: true, creature: false, word: "Land" }],
    ["a copied land stands apart (Vesuva)", wire(8, "Vesuva", "You", "Land", { copy: true }), { land: true, special: true, well: false }],
    ["a land with a trigger stands apart (Felidar Retreat)", wire(9, "Felidar Retreat", "You", "Land"), { land: true, special: true }],
    ["a Treasure token is mana", token(10, "Treasure Token", "You", 0, 0, { type: "Artifact - Treasure", power: null, toughness: null }), { treasure: true, well: true, creature: false }],
    ["a legendary planeswalker", wire(11, "Wrenn and Realmbreaker", "You", "Legendary Planeswalker - Wrenn", { loyalty: 7 }), { walker: true, legendary: true, word: "Planeswalker", creature: false }],
    ["a face-down card is a creature named by nobody", wire(12, "", "You", "Creature", { faceDown: true, power: 2, toughness: 2 }), { creature: true, key: "Face-down" }],
  ];
  it.each(rows)("%s", (_, w, want) => {
    const c = one(w);
    const got: Record<string, boolean | string> = {
      rock: isManaRock(c),
      source: isManaSource(c),
      artifact: isArtifact(c),
      enchantment: isEnchantment(c),
      creature: isCreature(c),
      land: isLand(c),
      basic: isBasic(c),
      special: isSpecialLand(c),
      legendary: isLegendary(c),
      walker: isPlaneswalker(c),
      treasure: isTreasure(c),
      well: inWell(c),
      word: typeWord(c),
      key: cardKey(c),
    };
    for (const [k, v] of Object.entries(want)) expect(got[k], k).toBe(v);
  });

  it("a rock is read by its own {T}: Add, whatever word heads the ability, and not by an Equipment that grants mana", () => {
    const cat = decodeCatalog({
      "Mox Opal": { faces: [{ type: "Legendary Artifact", text: "Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts." }], produces: ["W", "U"] },
      "Paradise Mantle": { faces: [{ type: "Artifact — Equipment", text: "Equipped creature has \"{T}: Add one mana of any color.\"\nEquip {1}" }], produces: ["W"] },
    });
    const m = tableOf({ seats: { You: { battlefield: [wire(1, "Mox Opal", "You", "Legendary Artifact"), wire(2, "Paradise Mantle", "You", "Artifact - Equipment")] } } }, cat);
    expect(isManaRock(m.cards.get(1 as never)!)).toBe(true);
    expect(isManaRock(m.cards.get(2 as never)!)).toBe(false);
    expect(isManaSource(m.cards.get(2 as never)!)).toBe(true);
  });

  it("roles are h.js's piece roles", () => {
    expect(roleOf(one(wire(1, "Sol Ring", "You", "Artifact")))).toBe("mana");
    expect(roleOf(one(land(2, "Forest", "You")))).toBe("mana");
    expect(roleOf(one(wire(3, "Felidar Retreat", "You", "Land")))).toBe("support");
    expect(roleOf(one(wire(4, "Smothering Tithe", "You", "Enchantment")))).toBe("support");
    expect(roleOf(one(token(5, "Soldier Token", "You")))).toBe("creature");
    expect(roleOf(one(wire(6, "Wrenn and Realmbreaker", "You", "Legendary Planeswalker - Wrenn")))).toBe("walker");
  });
});

describe("sig: identical to the eye", () => {
  const base = token(1, "Soldier Token", "You");
  const variants: [string, ReturnType<typeof wire>][] = [
    ["tapped", token(2, "Soldier Token", "You", 1, 1, { tapped: true })],
    ["sick", token(2, "Soldier Token", "You", 1, 1, { sick: true })],
    ["a counter", token(2, "Soldier Token", "You", 2, 2, { counters: { "+1/+1": 1 } })],
    ["pumped", token(2, "Soldier Token", "You", 3, 3)],
    ["another card", token(2, "Spirit Token", "You")],
    ["a copy", token(2, "Soldier Token", "You", 1, 1, { copy: true })],
  ];
  it("copies in the same state share it", () => {
    const m = tableOf({ seats: { You: { battlefield: [base, token(2, "Soldier Token", "You")] } } });
    expect(sig(m.cards.get(1 as never)!)).toBe(sig(m.cards.get(2 as never)!));
  });
  it.each(variants)("%s differs", (_, other) => {
    const m = tableOf({ seats: { You: { battlefield: [base, other] } } });
    expect(sig(m.cards.get(1 as never)!)).not.toBe(sig(m.cards.get(2 as never)!));
  });
});

describe("boardOf: one board per card on screen", () => {
  it("an Aura on another seat's creature is drawn with its host; a host off the battlefield leaves it home", () => {
    const m = tableOf({
      seats: {
        You: { battlefield: [token(1, "Soldier Token", "You"), wire(3, "Rancor", "You", "Enchantment - Aura", { attachedTo: 2 }), wire(4, "Pacifism", "You", "Enchantment - Aura", { attachedTo: 99 })] },
        Atraxa: { battlefield: [wire(2, "Grizzly Bears", "Atraxa", "Creature - Bear", { power: 2, toughness: 2 }), wire(5, "Swiftfoot Boots", "Atraxa", "Artifact - Equipment", { attachedTo: 1 })] },
      },
    });
    const mine = boardOf(m, "You" as never), hers = boardOf(m, "Atraxa" as never);
    expect(mine.cards.map((c) => c.id).sort()).toEqual([1, 4, 5]);
    expect(hers.cards.map((c) => c.id).sort()).toEqual([2, 3]);
    expect(mine.mine).toBe(true);
    expect(hers.mine).toBe(false);
  });

  it("fixtures count the seat's graveyard and exile and see the commander at home", () => {
    const m = tableOf({
      seats: {
        You: { graveyard: [wire(1, "Brainstorm", "You", "Instant")], exile: [wire(2, "Fireball", "You", "Sorcery"), wire(3, "Doom Blade", "You", "Instant")], command: [wire(4, "Marath, Will of the Wild", "You", "Legendary Creature - Elemental Beast", { commander: true })] },
      },
    });
    expect(boardOf(m, "You" as never).fixtures).toEqual({ graveyard: 1, exile: 2, commandZone: true, commander: 4 });
    expect(boardOf(m, "Dack" as never).fixtures).toEqual({ graveyard: 0, exile: 0, commandZone: false });
  });

  it("every corpus battlefield card is on exactly one board", () => {
    for (const n of corpusNames) {
      const m = modelOf(corpusSnapshot(n), catalog, viewerOf());
      if (!m) continue;
      const drawn = m.seats.flatMap((s) => boardOf(m, s.id).cards.map((c) => c.id));
      const field = [...m.cards.values()].filter((c) => c.zone === "battlefield").map((c) => c.id);
      expect(drawn.sort(), n).toEqual(field.sort());
    }
  });
});

describe("faces and the hand (live.js remember, manaValue, handOrder)", () => {
  it("the ability gem lights for an activated ability, not for a bare {T}: Add", () => {
    expect(hasAbilities(one(wire(1, "Marath, Will of the Wild", "You", "Legendary Creature - Elemental Beast", { power: 3, toughness: 3 })))).toBe(true);
    expect(hasAbilities(one(wire(2, "Sol Ring", "You", "Artifact")))).toBe(false);
    expect(hasAbilities(one(wire(3, "Swords to Plowshares", "You", "Instant")))).toBe(false);
  });
  it("my hand reads lands first, then by mana value (X is 0), then by name", () => {
    const m = tableOf({
      seats: {
        You: {
          hand: [
            wire(1, "Sunfall", "You", "Sorcery"),
            wire(2, "Forest", "You", "Basic Land - Forest"),
            wire(3, "Swords to Plowshares", "You", "Instant"),
            wire(4, "Chaos Warp", "You", "Instant"),
            wire(5, "Fireball", "You", "Sorcery", { cost: "X {R}" }),
            wire(6, "Arcane Signet", "You", "Artifact"),
          ],
        },
      },
    });
    const hand = m.zone("You" as never, "hand").map((id) => m.cards.get(id)!);
    expect(hand.map(manaValue)).toEqual([5, 0, 1, 3, 1, 2]);
    expect([...hand].sort(handOrder).map((c) => c.name)).toEqual(["Forest", "Fireball", "Swords to Plowshares", "Arcane Signet", "Chaos Warp", "Sunfall"]);
  });
});
