// The card catalog: what GET /api/cards returns (deckmaster/game.py `entry`), keyed by card name, decoded tolerantly.
// It supplies what the engine's view does not: Oracle text, printed stats, colours, the mana a card makes, art.
// A card with no entry still models (card.ts falls back to what the view says); a malformed entry is repaired, never
// thrown on: a missing field takes its default, a wrong type is dropped.

export interface CatalogFace {
  readonly name: string;
  /** Braced Scryfall cost ("{2}{G}"), "" for none. */
  readonly cost: string;
  readonly type: string;
  readonly text: string;
  /** Printed, as Scryfall writes them ("2", "*", "1+*"); null when it has none. */
  readonly power: string | null;
  readonly toughness: string | null;
  readonly loyalty: string | null;
  readonly colors: readonly string[];
  /** Cache paths ("cache/art/<slug>.jpg"); null when the bridge has no image. */
  readonly art: string | null;
  readonly img: string | null;
  readonly keywords: readonly string[];
}

export interface CatalogEntry {
  readonly name: string;
  /** At least one. The bridge sends the face whose name matches the card. */
  readonly faces: readonly [CatalogFace, ...CatalogFace[]];
  /** Colours of mana it can make (Scryfall `produced_mana`): what makes a nonland permanent a mana source. */
  readonly produces: readonly string[];
  readonly identity: readonly string[];
  readonly layout: string;
}

export type CardCatalog = ReadonlyMap<string, CatalogEntry>;

export const EMPTY_CATALOG: CardCatalog = new Map();

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown, d = ""): string => (typeof x === "string" ? x : d);
const optStr = (x: unknown): string | null => (typeof x === "string" ? x : typeof x === "number" ? String(x) : null);
const strs = (x: unknown): readonly string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);

function face(x: unknown, name: string): CatalogFace {
  const f = isObject(x) ? x : {};
  return {
    name: str(f["name"], name),
    cost: str(f["cost"]),
    type: str(f["type"]),
    text: str(f["text"]),
    power: optStr(f["power"]),
    toughness: optStr(f["toughness"]),
    loyalty: optStr(f["loyalty"]),
    colors: strs(f["colors"]),
    art: optStr(f["art"]),
    img: optStr(f["img"]),
    keywords: strs(f["keywords"]),
  };
}

/** One entry, repaired; null only when it is not an object at all. */
export function decodeEntry(name: string, x: unknown): CatalogEntry | null {
  if (!isObject(x)) return null;
  const n = str(x["name"], name);
  const faces = Array.isArray(x["faces"]) ? x["faces"].map((f) => face(f, n)) : [];
  const [first, ...rest] = faces.length ? faces : [face({}, n)];
  return {
    name: n,
    faces: [first!, ...rest],
    produces: strs(x["produces"]),
    identity: strs(x["identity"]),
    layout: str(x["layout"], "normal"),
  };
}

/**
 * A /api/cards reply (`{name: entry}`) merged over what is already known; entries that are not objects are skipped.
 * Never throws.
 */
export function decodeCatalog(json: unknown, base: CardCatalog = EMPTY_CATALOG): CardCatalog {
  const out = new Map(base);
  if (!isObject(json)) return out;
  for (const [name, x] of Object.entries(json)) {
    const e = decodeEntry(name, x);
    if (e) out.set(name, e);
  }
  return out;
}
