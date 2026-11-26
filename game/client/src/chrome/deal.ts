// A card sheet's deal: how a choice of cards lies on the sheet. Every card the same size, as large as reads well; never
// more than two rows, all on one page when they fit at a readable size, otherwise pages of as many as fit at that size.
// Copies a library search found lie as one pile with a count. Pure.
import type { SheetItem, SheetView } from "../play";

/** The printed card's proportions (Scryfall's 488 x 680). */
export const CARD_ASPECT = 680 / 488;
/** Card widths, CSS px at the design unit: the most a card is drawn at, and the least it reads at. */
export const CARD_MAX = 250;
export const CARD_MIN = 176;
/** The gap between cards, CSS px at the design unit. */
export const CARD_GAP = 16;
/** The most rows a page holds: a third would push the cards below reading size or the sheet's foot off the screen. */
export const CARD_ROWS = 2;

export interface Deal {
  /** A card's width, CSS px. */
  readonly w: number;
  readonly cols: number;
  readonly rows: number;
  readonly perPage: number;
  readonly pages: number;
}

/**
 * How `n` cards lie in a grid area of `w` x `h` CSS px at design unit `u`. Fewest rows (at most CARD_ROWS) that fit
 * everything on one page with cards at least CARD_MIN wide, the larger cards winning; when nothing fits, pages of the
 * most cards that fit at CARD_MIN or more, in at most CARD_ROWS rows.
 */
export function deal(n: number, w: number, h: number, u = 1): Deal {
  const gap = CARD_GAP * u, max = CARD_MAX * u, min = CARD_MIN * u;
  const count = Math.max(1, n);
  const width = (cols: number, rows: number) => Math.min(max, (w - (cols - 1) * gap) / cols, (h - (rows - 1) * gap) / rows / CARD_ASPECT);
  let best: Deal | null = null;
  for (let rows = 1; rows <= Math.min(count, CARD_ROWS); rows++) {
    const cols = Math.ceil(count / rows), cw = width(cols, rows);
    if (cw >= min && (!best || cw > best.w + 0.5)) best = { w: Math.floor(cw), cols, rows, perPage: cols * rows, pages: 1 };
  }
  if (best) return best;
  // Pages: as many rows as fit at the least width, then as many columns as fit, the cards as wide as those allow.
  const rows = Math.max(1, Math.min(CARD_ROWS, Math.floor((h + gap) / (min * CARD_ASPECT + gap))));
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  const cw = Math.floor(Math.max(Math.min(min, w), width(cols, rows)));
  return { w: cw, cols, rows, perPage: cols * rows, pages: Math.ceil(count / (cols * rows)) };
}

/** One place on a card sheet: a card, copies a search found lying as a pile, or an option with no picture yet, a
 * card-sized placeholder carrying its name. */
export interface Tile {
  readonly key: string;
  /** Its options, in the order offered (copies: the first is the one a pick takes). */
  readonly items: readonly SheetItem[];
  readonly name: string;
  readonly image: string | null;
  /** What the option says that the card does not (a payment's "Arcane Signet (W)": "{W}"), or null. */
  readonly tag: string | null;
  /** What sets it apart from a tile that would otherwise look the same (a payment's "with Wild Growth"), or null. */
  readonly aside: string | null;
  /** The option's words in full, for reading aloud. */
  readonly label: string;
}

/** What an option's label says beyond the card's name: a lone mana letter in brackets as its symbol. */
export function tagOf(label: string, name: string): string | null {
  if (label === name) return null;
  const rest = label.startsWith(name) ? label.slice(name.length).trim() : label;
  const bare = rest.replace(/^\((.*)\)$/, "$1").trim();
  if (!bare) return null;
  return /^[WUBRGC]$/.test(bare) ? `{${bare}}` : bare;
}

type Looks = (item: SheetItem) => { readonly name: string; readonly image: string | null } | null;

/**
 * The tiles of a chooser shown as cards: every option, in the order offered, so one pager pages them all and the
 * sheet's foot stays on screen. An option with no picture (its card data not yet come, or not a card) is a placeholder
 * with its name. Copies lie together only where the engine says they are interchangeable (a library search: `copies`),
 * off the table, with the same words and rules; never in a scry, a surveil or an order, where each card's place counts.
 * Tiles that would look alike but differ in what sets them apart (two Islands for {U}, one enchanted) each say it.
 */
export function tilesOf(sheet: SheetView, looks: Looks): Tile[] {
  const pile = !!sheet.pick?.copies;
  const tiles: Tile[] = [], by = new Map<string, number>();
  for (const item of sheet.items) {
    const look = looks(item);
    const name = look?.name ?? item.name ?? item.label;
    const same = pile && item.card === null ? `${item.label}\u0000${name}\u0000${item.detail ?? ""}` : null;
    const at = same !== null ? by.get(same) : undefined;
    if (at !== undefined) {
      const t = tiles[at]!;
      tiles[at] = { ...t, items: [...t.items, item] };
      continue;
    }
    if (same !== null) by.set(same, tiles.length);
    tiles.push({ key: String(item.option), items: [item], name, image: look?.image ?? null, tag: tagOf(item.label, name), aside: null, label: item.label });
  }
  const alike = new Map<string, number[]>();
  tiles.forEach((t, i) => {
    const k = `${t.name}\u0000${t.tag ?? ""}`;
    alike.set(k, [...(alike.get(k) ?? []), i]);
  });
  for (const group of alike.values()) {
    if (new Set(group.map((i) => tiles[i]!.items[0]!.detail ?? "")).size < 2) continue;
    for (const i of group) tiles[i] = { ...tiles[i]!, aside: tiles[i]!.items[0]!.detail };
  }
  return tiles;
}

/**
 * The option a tap on a tile picks (play's `choose` decides what that does), or null when the tile can take no more.
 * A card: itself. A pile: the next copy while there is room; a copy back when the choice is full; with one wanted, the
 * first copy in place of the card picked elsewhere.
 */
export function tapOf(tile: Tile, picked: number, max: number): number | null {
  if (tile.items.length === 1) return tile.items[0]!.option;
  const free = tile.items.find((i) => !i.picked), mine = tile.items.filter((i) => i.picked);
  if (free && picked < max) return free.option;
  if (mine.length) return mine[mine.length - 1]!.option;
  if (free && max === 1) return free.option;
  return null;
}
