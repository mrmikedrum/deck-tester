// A card as the client sees it: the engine's facts (zone, state, stats now) merged with the catalog's (Oracle text,
// art, the mana it makes). Ported from live.js `conv` and `remember` and common.js `face`, `name`, `typeLine`.
import type { Card as WireCard, CardId, CastCost } from "../protocol";
import type { CardCatalog } from "./catalog";
import { seatId } from "./ids";
import type { Keyword, SeatId, Zone } from "./ids";

/** What the card shows now. */
export interface CardFace {
  /** The display name (common.js `name`): "Face-down 2/2" for someone else's face-down card. */
  readonly name: string;
  /**
   * The type line (common.js `typeLine`), with em dashes: the engine's, which is what the card is now (a Saga land, a
   * copy), else the catalog's; "Creature" face down.
   */
  readonly type: string;
  /** Rules text as common.js `face(c).text` read it: the catalog's Oracle text, else the engine's. "" face down. */
  readonly text: string;
  /** The engine's own text for it now: abilities as they are on the battlefield, Oracle text elsewhere. */
  readonly rules: string;
  /** Braced ("{2}{G}{G}"); "" for none. */
  readonly cost: string;
  /** Printed stats as numbers (common.js `basePT`: "*" and missing count 0); 2/2 face down. */
  readonly basePower: number;
  readonly baseToughness: number;
  readonly colors: readonly string[];
  /** Colours of mana it makes (the catalog's `produces`). */
  readonly produces: readonly string[];
  readonly art: string | null;
  readonly img: string | null;
  /** Whether the catalog had an entry; false is a placeholder built from the view alone (no art, no Oracle text). */
  readonly catalogued: boolean;
}

export interface Card {
  readonly id: CardId;
  /**
   * The card's identity (the old `c.card`): its name, "Face-down" when face down. Copies of one card share it; the
   * catalog is keyed by it.
   */
  readonly name: string;
  readonly owner: SeatId;
  readonly controller: SeatId;
  readonly zone: Zone;
  readonly face: CardFace;
  /** Preview for the main spell, with mana symbols braced. */
  readonly castCost?: CastCost;
  readonly tapped: boolean;
  readonly token: boolean;
  readonly commander: boolean;
  readonly faceDown: boolean;
  readonly sick: boolean;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly loyalty: number | null;
  /** By the engine's counter names ("+1/+1", "Loyalty", "Charge"...). */
  readonly counters: Readonly<Record<string, number>>;
  readonly keywords: readonly Keyword[];
  readonly attachedTo: CardId | null;
  /** A copy or a clone (the old `copyOf`): it shows what it copies. */
  readonly copy: boolean;
}

export const FACE_DOWN = "Face-down";

/** live.js `typeOf`: the engine writes " - " where Scryfall writes " — ". */
const typeOf = (t: string): string => t.replace(/ - /g, " — ");
/**
 * The engine's short cost ("1 {G} {G}", "X {R}") as a braced one ("{1}{G}{G}"). (live.js `remember` wrapped the whole
 * string, which doubled the braces of every coloured symbol: "{R}" became "{{R}}".)
 */
const bracedCost = (c: string | null): string =>
  (c ?? "")
    .split(" ")
    .filter(Boolean)
    .map((t) => (t.startsWith("{") ? t : `{${t}}`))
    .join("");
/** common.js `basePT`. */
const statOf = (v: string | null): number => (v == null || isNaN(+v) ? 0 : +v);

function faceOf(c: WireCard, catalog: CardCatalog, mine: boolean): CardFace {
  if (c.faceDown) {
    // common.js `name`: printed(c) of a face-down card is the "Face-down" stand-in live.js `remember` adds to the DB.
    return {
      name: mine ? `${FACE_DOWN} · ${c.name || FACE_DOWN}` : `${FACE_DOWN} 2/2`,
      type: "Creature",
      text: "",
      rules: "",
      cost: "",
      basePower: 2,
      baseToughness: 2,
      colors: [],
      produces: [],
      art: null,
      img: null,
      catalogued: true,
    };
  }
  const entry = catalog.get(c.name);
  const f = entry?.faces[0];
  return {
    name: f?.name || c.name,
    type: typeOf(c.type) || f?.type || "",
    text: f?.text || c.text || "",
    rules: c.text ?? "",
    cost: f?.cost || bracedCost(c.cost),
    basePower: f ? statOf(f.power) : (c.power ?? 0),
    baseToughness: f ? statOf(f.toughness) : (c.toughness ?? 0),
    colors: f?.colors ?? [],
    produces: entry?.produces ?? [],
    art: f?.art ?? null,
    img: f?.img ?? null,
    catalogued: !!entry,
  };
}

/** The model's card for a wire card in `zone`. `perspective` decides whose face-down cards show their name. */
export function cardOf(c: WireCard, zone: Zone, catalog: CardCatalog, perspective: SeatId): Card {
  const controller = seatId(c.controller);
  const castCost = c.castCost && "mana" in c.castCost ? { ...c.castCost, mana: bracedCost(c.castCost.mana) } : c.castCost;
  return {
    id: c.id,
    name: c.faceDown ? FACE_DOWN : c.name,
    owner: seatId(c.owner),
    controller,
    zone,
    face: faceOf(c, catalog, controller === perspective),
    ...(castCost ? { castCost } : {}),
    tapped: c.tapped,
    token: c.token,
    commander: c.commander,
    faceDown: c.faceDown,
    sick: c.sick,
    power: c.power,
    toughness: c.toughness,
    loyalty: c.loyalty,
    counters: c.counters,
    keywords: c.keywords,
    attachedTo: c.attachedTo,
    copy: c.copy,
  };
}
