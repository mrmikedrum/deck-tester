import {
  cardKey,
  isArtifact,
  isBasic,
  isCreature,
  isEnchantment,
  isLand,
  isLegendary,
  isManaRock,
  isPlaneswalker,
  isSpecialLand,
  isTreasure,
  kin,
  sig,
  typeWord,
} from "../model";
import type { Card, TableModel } from "../model";
import type { CardId, SeatId } from "./types";

// A seat's battlefield as the facts layout needs. `boardOf` builds it from the model; nothing here parses text. Every
// predicate the old h.js derived from oracle text or type lines is a boolean the model computes (listed on `BoardCard`).

/** One permanent. Only layout-relevant facts: no art, no rules text, no counters beyond what changes the look key. */
export interface BoardCard {
  readonly id: CardId;
  /** Display name (the old `P.name(c)`): piles of copies are keyed by it. */
  readonly name: string;
  /** Card identity (the old `c.card`): what makes two cards "the same card" for mixed-pile and well grouping. */
  readonly cardKey: string;
  /**
   * Identical-to-the-eye key (the old `groupKey`): same card, copy-of, transformed, tapped, face-down, summoning sick,
   * goaded, counters, and power/toughness. Copies with equal `sig` and nothing attached stack into one pile.
   */
  readonly sig: string;
  /** `sig` without tapped and summoning sickness: one kind of card for a tray under a die, ready and tapped alike. */
  readonly kin: string;

  // ---- type flags (the old common.js predicates; `isLand` and `isCreature` below follow common.js exactly) ----
  /** `!!c.becameLand || /\bLand\b/.test(typeLine(c))`. */
  readonly land: boolean;
  /** `!isLand(c) && (c.faceDown || /Creature/.test(typeLine(c)))`: a land that is also a creature is a land. */
  readonly creature: boolean;
  /** `/Planeswalker/.test(typeLine(c))`. */
  readonly planeswalker: boolean;
  /** `/Artifact/.test(typeLine(c))`. Not used by `mat`; carried for importance and summaries. */
  readonly artifact: boolean;
  /** `/Enchantment/.test(typeLine(c))`. Not used by `mat`; carried for importance and summaries. */
  readonly enchantment: boolean;
  /**
   * The old `rock(c)`: `isMana(c) && /(^|\n|— )\{T\}[^:\n]*: Add/.test(face(c).text)` where common.js
   * `isMana(c) = !isCreature && !isLand && !isPW && !RULES[c.card] && (DB[c.card].produces || []).length > 0`.
   * An Equipment that grants mana (Paradise Mantle) is not a rock.
   */
  readonly manaRock: boolean;
  /**
   * The old `special(c)`: `isLand(c) && (!!c.copyOf || /\b(Whenever|At the beginning)\b/.test(face(c).text))`.
   * Lands that do more than make mana stand with the other permanents instead of in a well.
   */
  readonly specialLand: boolean;
  /** `c.token && /Treasure/.test(c.card)`: a Treasure token is mana, spent once. */
  readonly treasure: boolean;
  /** `/Basic/.test(typeLine(c))`: a basic land. (Drives which wells fold into "Lands".) */
  readonly basic: boolean;
  /**
   * The old noncreature pile word, singular: `typeLine(c).split("—")[0].replace(/Legendary|Snow|Basic|Token/g, "")
   * .trim().split(" ").pop()` ("Artifact", "Enchantment", "Planeswalker"). Layout adds the "s".
   */
  readonly typeWord: string;
  /** `/Legendary/.test(typeLine(c))`. Legendary and commander cards stay out of piles as long as anything else can fold. */
  readonly legendary: boolean;

  readonly token: boolean;
  readonly commander: boolean;
  readonly tapped: boolean;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly keywords: readonly string[];
  /** The permanent this one is attached to (an Aura, Equipment). A host not on this board makes it a card of its own. */
  readonly attachedTo: CardId | null;
}

/**
 * The cards drawn on a seat: the permanents it controls, minus any attached to another seat's permanent (that is drawn
 * with its host), plus the Auras and Equipment other seats attached to its own. So every card on screen is on exactly
 * one board. (The old code drew an attachment wherever its host stood.)
 */
export interface SeatBoard {
  readonly seat: SeatId;
  /** The viewer's own seat: its creatures meet the 72 px floor, others' 56 (never inferred from the slot). */
  readonly mine: boolean;
  readonly cards: readonly BoardCard[];
  /** Zone counts the back band makes room for. */
  readonly fixtures: {
    readonly graveyard: number;
    readonly exile: number;
    /** The commander is in the command zone (the old `P.card(p.commander[0]).zone === "command"`). */
    readonly commandZone: boolean;
    /** That commander, which stands beside the plaque while it is there (the first, with partners). */
    readonly commander?: CardId;
  };
}

/** The floors (intent.md "Hard limits"), card face width on screen in design px (1180x820). */
export const FLOOR = { mine: 72, theirs: 56, any: 44 } as const;
/**
 * The tappable patch (intent.md "Hard limits": Apple's 44 pt), in CSS px at every viewport: floors scale with the design
 * unit, a finger does not. Below 1180x820 it is larger than the 44 design px floor, so sizing meets both.
 */
export const TAP_PX = 44;

/** A permanent's layout facts, from the model's predicates. */
export function boardCard(c: Card): BoardCard {
  return {
    id: c.id,
    name: c.face.name,
    cardKey: cardKey(c),
    sig: sig(c),
    kin: kin(c),
    land: isLand(c),
    creature: isCreature(c),
    planeswalker: isPlaneswalker(c),
    artifact: isArtifact(c),
    enchantment: isEnchantment(c),
    manaRock: isManaRock(c),
    specialLand: isSpecialLand(c),
    treasure: isTreasure(c),
    basic: isBasic(c),
    typeWord: typeWord(c),
    legendary: isLegendary(c),
    token: c.token,
    commander: c.commander,
    tapped: c.tapped,
    power: c.power,
    toughness: c.toughness,
    keywords: c.keywords,
    attachedTo: c.attachedTo,
  };
}

/**
 * A seat's board: the permanents it controls, minus those attached to another seat's permanent (drawn with their
 * host), plus other seats' Auras and Equipment attached to its own. A host that is not on the battlefield leaves the
 * attachment on its controller's board.
 */
export function boardOf(model: TableModel, seat: SeatId): SeatBoard {
  const onField = (id: CardId | null) => (id === null ? undefined : model.cards.get(id));
  const host = (c: Card) => {
    const h = onField(c.attachedTo);
    return h && h.zone === "battlefield" ? h : undefined;
  };
  const drawnOn = (c: Card): SeatId => host(c)?.controller ?? c.controller;
  const cards: Card[] = [];
  for (const s of model.seats)
    for (const id of model.zone(s.id, "battlefield")) {
      const c = model.cards.get(id);
      if (c && drawnOn(c) === seat) cards.push(c);
    }
  const owned = (zone: "graveyard" | "exile") => model.zone(seat, zone).length;
  const commander = model.zone(seat, "command").find((id) => model.cards.get(id)?.commander);
  return {
    seat,
    mine: seat === model.viewer.perspective,
    cards: cards.map(boardCard),
    fixtures: {
      graveyard: owned("graveyard"),
      exile: owned("exile"),
      commandZone: commander !== undefined,
      ...(commander !== undefined ? { commander } : {}),
    },
  };
}

/** Every seat's board, in the model's seat order (the perspective first). Seats that are out have empty boards. */
export function boards(model: TableModel): { readonly seat: SeatId; readonly board: SeatBoard }[] {
  return model.seats.map((s) => ({ seat: s.id, board: boardOf(model, s.id) }));
}
