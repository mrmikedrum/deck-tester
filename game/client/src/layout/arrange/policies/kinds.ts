// Classification precedence for the starting policies (§2.4), from a card's current types: a card that is a creature,
// planeswalker or battle now ranks as that first; then a noncreature mana source or land is mana; then any other
// nonland permanent is a work. Recomputed every plan; nothing stores it.
import type { ArrCard } from "../contract";

export type Kind = "creature" | "planeswalker" | "battle" | "mana" | "works";

export function kindOf(c: ArrCard): Kind {
  if (c.types.creature) return "creature";
  if (c.types.planeswalker) return "planeswalker";
  if (c.types.battle) return "battle";
  if (c.types.land || c.manaSource) return "mana";
  return "works";
}

const has = (c: ArrCard, k: string): boolean => c.keywords.includes(k);

/** Keywords that change combat (intent.md's "last to go"). */
export const COMBAT_KEYWORDS = ["flying", "deathtouch", "lifelink", "trample", "menace", "first strike", "double strike", "indestructible", "hexproof", "reach", "infect"] as const;
export const combatKeyword = (c: ArrCard): boolean => COMBAT_KEYWORDS.some((k) => has(c, k));

/** A creature that threatens: power 4 or more, or an evasive or deadly keyword. */
export const threatens = (c: ArrCard): boolean =>
  c.types.creature && ((c.power ?? 0) >= 4 || ["flying", "deathtouch", "trample", "menace", "double strike", "infect"].some((k) => has(c, k)));

/** Could attack now: untapped, not summoning sick (or hasty), power above 0, no Defender. */
export const ready = (c: ArrCard): boolean =>
  c.types.creature && !c.tapped && (!c.sick || has(c, "haste")) && (c.power ?? 0) > 0 && !has(c, "defender");

export const blocksFliers = (c: ArrCard): boolean => has(c, "flying") || has(c, "reach");
export const flies = (c: ArrCard): boolean => has(c, "flying");
