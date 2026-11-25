// Text rules a face applies to what the model gives it: a name short enough to read across the table, the type word
// on a noncreature's foot, and which frame a card wears.
import type { FrameKey } from "./surfaces";

/**
 * A name short enough to read across the table: no leading "The"; a long one loses its epithet ("Otawara, Soaring
 * City", "Meloku the Clouded Mirror", "Jace of the Ages" keep their first word).
 */
export function shortName(full: string): string {
  let n = full.replace(/^The /, "");
  if (n.length > 12) {
    n = n.split(", ")[0] ?? n;
    const m = /^(\S{3,}) (?:of )?the /.exec(n);
    if (m?.[1]) n = m[1];
  }
  return n;
}

/** The type word on a noncreature's foot ("Artifact", "Enchantment", or a subtype such as "Aura" or "Equipment"). */
export function shortType(typeLine: string): string {
  const [head = "", tail = ""] = typeLine.split("—");
  const sub = tail.trim();
  if (/Aura|Equipment|Saga|Class|Vehicle/.test(sub)) return sub.split(" ")[0] ?? sub;
  return head.replace("Legendary ", "").replace("Snow ", "").trim();
}

/** A card's frame: a token's paper, a land's earth, gold for several colours, its colour, else pewter. */
export function frameKeyOf(card: {
  readonly token: boolean;
  readonly land: boolean;
  readonly colours: readonly string[];
}): FrameKey {
  if (card.token) return "T";
  if (card.land) return "L";
  if (card.colours.length > 1) return "M";
  const c = card.colours[0];
  return c === "W" || c === "U" || c === "B" || c === "R" || c === "G" ? c : "C";
}
