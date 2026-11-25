// Presentation predicates over a card: how it looks and where it stands, never what is legal. Each reproduces the old
// client's expression (common.js `isLand`, `isCreature`, `isPW`, `isMana`, `groupKey`; h.js buildBoard's `special`,
// `rock`, the Treasure test and the pile word), on the model's card instead of GAME + DB.
//
// Facts the wire does not carry are absent, as they were in the live client (live.js `conv` never set them):
// `becameLand`, `landName`, `transformed`, `goaded`. The offline fixtures had them; the live game never did.
import type { Card } from "./card";

/** common.js `typeLine`. */
export const typeLine = (c: Card): string => c.face.type;

/** common.js `isLand`: `!!c.becameLand || /\bLand\b/.test(typeLine(c))` (becameLand is never on the wire). */
export const isLand = (c: Card): boolean => /\bLand\b/.test(typeLine(c));

/** common.js `isCreature`: a land that is also a creature is a land. */
export const isCreature = (c: Card): boolean => !isLand(c) && (c.faceDown || /Creature/.test(typeLine(c)));

/** common.js `isPW`. */
export const isPlaneswalker = (c: Card): boolean => /Planeswalker/.test(typeLine(c));

export const isArtifact = (c: Card): boolean => /Artifact/.test(typeLine(c));
export const isEnchantment = (c: Card): boolean => /Enchantment/.test(typeLine(c));
export const isBasic = (c: Card): boolean => /Basic/.test(typeLine(c));
export const isLegendary = (c: Card): boolean => /Legendary/.test(typeLine(c));

/**
 * common.js `RULES`: rule-changing permanents the old fixtures summarised, which `isMana` excluded by name. Kept so a
 * rule card that makes Treasure (Smothering Tithe lists `produces`) is never read as a mana rock.
 */
export const RULE_CARDS: ReadonlySet<string> = new Set([
  "Trinisphere",
  "Thorn of Amethyst",
  "Rule of Law",
  "Deafening Silence",
  "Suppression Field",
  "Cursed Totem",
  "Defense Grid",
  "Smothering Tithe",
  "Paladin Class",
  "Tekuthal, Inquiry Dominus",
  "Unbound Flourishing",
  "Kami of Whispered Hopes",
]);

/** common.js `isMana`: a nonland, noncreature, non-planeswalker permanent that makes mana. */
export const isManaSource = (c: Card): boolean =>
  !isCreature(c) && !isLand(c) && !isPlaneswalker(c) && !RULE_CARDS.has(c.name) && c.face.produces.length > 0;

/**
 * h.js `rock`: a mana source that taps for mana itself, whatever word heads the ability (Mox Opal's "Metalcraft —").
 * An Equipment that grants mana (Paradise Mantle) is not a rock.
 */
export const isManaRock = (c: Card): boolean => isManaSource(c) && /(^|\n|— )\{T\}[^:\n]*: Add/.test(c.face.text);

/**
 * h.js `special`: a land that does more than make mana (a Moon keeping abilities, a copy) stands with the other
 * permanents; a land whose only clause is how it enters (Mystic Sanctuary) is still a land.
 */
export const isSpecialLand = (c: Card): boolean =>
  isLand(c) && (c.copy || /\b(Whenever|At the beginning)\b/.test(c.face.text));

/** h.js: `c.token && /Treasure/.test(c.card)`: a Treasure token is mana, spent once. */
export const isTreasure = (c: Card): boolean => c.token && /Treasure/.test(c.name);

/** h.js `isMana` (the board's, not common.js's): what stands in a mana well. */
export const inWell = (c: Card): boolean => !isSpecialLand(c) && (isLand(c) || isManaRock(c) || isTreasure(c));

/**
 * h.js's noncreature pile word, singular ("Artifact", "Enchantment", "Land"): the last word of the type line's
 * supertypes and types, without Legendary, Snow, Basic or Token.
 */
export const typeWord = (c: Card): string =>
  typeLine(c)
    .split("—")[0]!
    .replace(/Legendary|Snow|Basic|Token/g, "")
    .trim()
    .split(" ")
    .pop()!;

/** The old `c.card`: what makes two cards the same card (mixed piles, wells). */
export const cardKey = (c: Card): string => c.name;

/** live.js `conv`'s counters, as common.js `groupKey` stringified them: loyalty folded in as LOYALTY. */
function lookCounters(c: Card): Record<string, number> {
  const out: Record<string, number> = { ...c.counters };
  if (c.loyalty !== null) out["LOYALTY"] = c.loyalty;
  return out;
}

/**
 * common.js `groupKey`: cards identical to the eye (same card, copy-of, tapped, face down, summoning sick, counters,
 * power and toughness). `transformed` and `goaded` are empty, as in the live client.
 */
export const sig = (c: Card): string =>
  [c.name, c.copy ? c.name : "", "", c.tapped, c.faceDown, c.sick, "", JSON.stringify(lookCounters(c)), c.power ?? "", c.toughness ?? ""].join(
    "|",
  );

/** A card's role on its seat's page, as h.js named its pieces: what sweeps read their reach by. */
export type Role = "creature" | "walker" | "mana" | "support";
export const roleOf = (c: Card): Role =>
  isCreature(c) ? "creature" : isPlaneswalker(c) ? "walker" : inWell(c) ? "mana" : "support";

/**
 * live.js `remember`'s `abilities`, which lit h.js's ability gem on a card face: rules text with an activated ability
 * (a cost before a colon) that is not just "{T}: Add".
 */
export const hasAbilities = (c: Card): boolean =>
  /^[^:\n(]*\{[^}]+\}[^:\n]*:|^[^:\n]*(Sacrifice|Remove|Exile|Discard|Pay|Tap)[^:\n]*:/m.test(c.face.text) && !/^\{T\}: Add/m.test(c.face.text);

/** live.js `manaValue`: the braced cost's mana value, X counting 0 and every other symbol 1. */
export function manaValue(c: Card): number {
  let n = 0;
  for (const t of c.face.cost.match(/\{([^}]+)\}/g) ?? []) {
    const x = t.slice(1, -1);
    n += /^\d+$/.test(x) ? +x : x === "X" ? 0 : 1;
  }
  return n;
}

/** live.js `handOrder`: my hand reads left to right, lands (not land creatures) first, then by mana value, then name. */
export function handOrder(a: Card, b: Card): number {
  const land = (c: Card) => Number(/Land/.test(c.face.type) && !/Creature/.test(c.face.type));
  return land(b) - land(a) || manaValue(a) - manaValue(b) || a.name.localeCompare(b.name, "en");
}

/**
 * Whether a permanent's text reaches other players ("table": Rule of Law, Thorn of Amethyst, Smothering Tithe) or only
 * its controller's own game ("self"). A presentation heuristic over its rules text, reminder text left out: it ranks and
 * sorts a card, never decides what is legal. (From the by-relevance exploration.)
 */
export function tableReach(c: Card): "table" | "self" {
  const text = c.face.text.replace(/\([^)]*\)/g, "");
  return /\beach player\b|\beach spell\b|\bopponents?\b|\bspells?\s[^.]*\bcosts?\s+\{|\bcosts? \{[^}]+\} more\b|\bcan't\b/i.test(text) ? "table" : "self";
}
