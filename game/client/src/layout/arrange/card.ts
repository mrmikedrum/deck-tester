// A card's facts for the arrangement engine, from its CURRENT type line every plan (§1.2): the engine's, which is what
// the card is now (a stationed Spacecraft is a creature, an animated land is both), never the catalog's printed line.
// The flags are non-exclusive; policies decide precedence. Nothing here caches a classification.
import { RULE_CARDS, cardKey, costValue, isTreasure, textReach } from "../../model";
import type { Card, TableModel } from "../../model";
import type { CardId } from "../types";
import type { ArrCard, TypeSet } from "./contract";

type CardType = "Creature" | "Land" | "Artifact" | "Enchantment" | "Planeswalker" | "Battle";

/** Pure functions of a string, kept by it: the same type lines and rules text come back every plan. */
function kept<T>(f: (s: string) => T): (s: string) => T {
  const m = new Map<string, T>();
  return (s) => {
    let v = m.get(s);
    if (v === undefined) {
      if (m.size > 2048) m.clear();
      m.set(s, (v = f(s)));
    }
    return v;
  };
}

/** A type line's parts: card types (non-exclusive flags), supertypes, subtypes. "Creature" alone face down. */
export const typesOf = kept(parseTypes);
function parseTypes(typeLine: string): { types: TypeSet; subtypes: string[]; legendary: boolean; basic: boolean } {
  const [left = "", right = ""] = typeLine.split(/\s+[—-]\s+/, 2);
  const words = new Set(left.split(/\s+/).filter(Boolean));
  const has = (t: CardType): boolean => words.has(t);
  return {
    types: {
      creature: has("Creature"),
      land: has("Land"),
      artifact: has("Artifact"),
      enchantment: has("Enchantment"),
      planeswalker: has("Planeswalker"),
      battle: has("Battle"),
    },
    subtypes: right.split(/\s+/).filter(Boolean),
    legendary: words.has("Legendary"),
    basic: words.has("Basic"),
  };
}

const typeKey = (t: TypeSet): string =>
  (["creature", "land", "artifact", "enchantment", "planeswalker", "battle"] as const).map((k) => (t[k] ? k[0] : "")).join("");

const tapsForMana = kept((text) => /(^|\n|— )\{T\}[^:\n]*: Add/.test(text));
/** It makes mana: the catalog says what it produces, it is a Treasure, or it taps for mana in its text. */
const makesMana = (c: Card): boolean => !RULE_CARDS.has(c.name) && (c.face.produces.length > 0 || isTreasure(c) || tapsForMana(c.face.rules || c.face.text));
const reachOf = kept(textReach);
const valueOf = kept(costValue);

const counterTotal = (c: Card): number => Object.values(c.counters).reduce((t, n) => t + Math.max(0, n), 0);

/** A model card as the engine reads it: every field a fact the model has or a presentation predicate. */
export function arrCardOf(c: Card): ArrCard {
  const t = typesOf(c.face.type);
  const counters = Object.entries(c.counters)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, n]) => `${k}=${n}`)
    .join(",");
  // Identical to the eye but for tapped and summoning sick: the same card shown the same way, with the same types now
  // (a crewed Vehicle never stacks with an uncrewed copy).
  const lookKey = [c.name, c.copy ? "copy" : "", c.faceDown ? "down" : "", typeKey(t.types), t.subtypes.join(" "), counters, c.power ?? "", c.toughness ?? "", c.loyalty ?? "", [...c.keywords].sort().join(",")].join("|");
  return {
    id: c.id,
    controller: c.controller,
    owner: c.owner,
    name: c.face.name,
    cardKey: cardKey(c),
    lookKey,
    types: t.types,
    subtypes: t.subtypes,
    supertypes: { legendary: t.legendary, basic: t.basic },
    token: c.token,
    commander: c.commander,
    copy: c.copy,
    faceDown: c.faceDown,
    manaSource: makesMana(c),
    tapped: c.tapped,
    sick: c.sick,
    power: c.power,
    toughness: c.toughness,
    loyalty: c.loyalty,
    defense: t.types.battle ? (c.counters["Defense"] ?? c.counters["DEFENSE"] ?? null) : null,
    keywords: c.keywords.map((k) => k.toLowerCase()),
    counters: counterTotal(c),
    attachedTo: c.attachedTo,
    reach: reachOf(c.face.text),
    manaValue: valueOf(c.face.cost),
    produces: c.face.produces,
    ...(c.face.catalogued ? {} : { provisional: true }),
  };
}

/** The card `id` of the model, as the engine reads it now; null when the model has no such card. */
export function arrCard(model: TableModel, id: CardId): ArrCard | null {
  const c = model.cards.get(id);
  return c ? arrCardOf(c) : null;
}

/**
 * Each attached card's displayed root: the permanent at the end of its `attachedTo` chain among these cards, so an Aura
 * on an Equipment on a creature rides with the creature. The immediate host stays on the card (`attachedTo`). A cycle
 * is rooted at its lowest id. Cards attached to nothing here are absent.
 */
export function attachmentRoots(cards: readonly ArrCard[]): Map<CardId, CardId> {
  const here = new Map(cards.map((c) => [c.id, c]));
  const host = (id: CardId): CardId | null => {
    const h = here.get(id)?.attachedTo ?? null;
    return h !== null && h !== id && here.has(h) ? h : null;
  };
  const out = new Map<CardId, CardId>();
  for (const c of cards) {
    if (host(c.id) === null) continue;
    const path: CardId[] = [c.id];
    let at = host(c.id)!, root: CardId;
    for (;;) {
      const loop = path.indexOf(at);
      if (loop >= 0) {
        root = Math.min(...path.slice(loop)) as CardId;
        break;
      }
      path.push(at);
      const next = host(at);
      if (next === null) {
        root = at;
        break;
      }
      at = next;
    }
    if (root !== c.id) out.set(c.id, root);
  }
  return out;
}
