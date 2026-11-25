import { shortCard } from "../../model";
import type { BoardCard, SeatBoard } from "../board";
import type { CardId } from "../types";

// The account: what a page writes down instead of standing, as a scribe keeping the book would say it. Card facts in,
// clauses out, each with the cards it counted, so any clause can open its cards and a test can check it. Its whole licence
// is to count, add, take the largest and filter by facts the engine sends (power, toughness, tapped, token, type flags and
// the engine's keywords as the card has them now): it never works out a fight or a ruling, and a missing fact drops its
// clause rather than guess. Its words: digits first, then one game term; no sentences; clauses join with " · ".

/** At most this many lines on a page at rest (a lean-in may write them all). */
export const ACCOUNT_LINES = 7;

/** The keywords an account speaks of, in the order it says them, and the word it says each with. Vigilance, haste, flash
 *  and ward never: they do not change who can block whom. */
export const TRAITS: readonly (readonly [keyword: string, word: string])[] = [
  ["Trample", "trample"],
  ["Flying", "fly"],
  ["Deathtouch", "deathtouch"],
  ["First strike", "first strike"],
  ["Double strike", "double strike"],
  ["Menace", "menace"],
  ["Lifelink", "lifelink"],
  ["Indestructible", "indestructible"],
  ["Hexproof", "hexproof"],
];
const COMBAT = new Set(TRAITS.map(([k]) => k));

/** A clause of the account: its words, and the cards it counted. */
export interface Clause {
  readonly text: string;
  readonly ids: readonly CardId[];
}

/** "92 power · 33 creatures": every creature on the page, standing or written. */
export interface Tally {
  readonly power: number;
  readonly creatures: number;
  readonly ids: readonly CardId[];
}

/** One written line of creatures: a kind of identical ones, the unlike rest, or the one unlike card. */
export interface AccountEntry {
  readonly kind: "kind" | "more" | "one";
  /** "Beast 4/4 ×9", "5 more · 6 power", "Evolution Sage 3/2". */
  readonly text: string;
  /** One mark per card, ready ones first: true for a tapped one (a turned stroke). */
  readonly marks: readonly boolean[];
  /** The combat keywords every card of a kind holds, in words ("fly"); null for none. */
  readonly trait: string | null;
  readonly ids: readonly CardId[];
}

export interface Account {
  readonly tally: Tally | null;
  readonly traits: readonly Clause[];
  readonly entries: readonly AccountEntry[];
  /** The other permanents, by name, a line each; the last may end "+N". */
  readonly works: readonly Clause[];
  /** Every card written, in the account's order. */
  readonly written: readonly CardId[];
  /** Lines it takes. */
  readonly lines: number;
}

export interface AccountOptions {
  /** The most lines it may take (`ACCOUNT_LINES` at rest). */
  readonly lines?: number;
  /** The most characters a line of works may hold. */
  readonly width?: number;
}

/**
 * How much a creature asks to stand (spec "Told, not shown"): its power, 3 more for a legendary and 3 more for a combat
 * keyword, 3 less for a tapped one or a token.
 */
export function standingRank(c: BoardCard): number {
  return (
    (c.power ?? 0) +
    (c.legendary ? 3 : 0) +
    (c.keywords.some((k) => COMBAT.has(k)) ? 3 : 0) -
    (c.tapped ? 3 : 0) -
    (c.token ? 3 : 0)
  );
}

/** Most important first: rank, then toughness, then the oldest. */
export const byImportance = (a: BoardCard, b: BoardCard): number =>
  standingRank(b) - standingRank(a) || (b.toughness ?? 0) - (a.toughness ?? 0) || a.id - b.id;

/** Identical to the eye in an account: the same name and size (tapped is its mark, not its kind). */
export const kindOf = (c: BoardCard): string => `${c.name}|${c.power ?? ""}/${c.toughness ?? ""}|${c.token}`;

const size = (c: BoardCard): string => (c.power !== null && c.toughness !== null ? ` ${c.power}/${c.toughness}` : "");
const marksOf = (cs: readonly BoardCard[]): boolean[] => [...cs.filter((c) => !c.tapped), ...cs.filter((c) => c.tapped)].map((c) => c.tapped);
const ready = (cs: readonly BoardCard[]): BoardCard[] => [...cs.filter((c) => !c.tapped), ...cs.filter((c) => c.tapped)];
const power = (cs: readonly BoardCard[]): number => cs.reduce((t, c) => t + (c.power ?? 0), 0);

/** Every creature's traits, at most two lines: counts first in the keywords' order, then a card's own on a line of its own. */
export function traitsOf(creatures: readonly BoardCard[], lines = 2): Clause[] {
  const counted: Clause[] = [];
  const named = new Map<BoardCard, string[]>();
  for (const [k, word] of TRAITS) {
    const has = creatures.filter((c) => c.keywords.includes(k));
    if (!has.length) continue;
    if (has.length === 1) {
      const c = has[0]!;
      named.set(c, [...(named.get(c) ?? []), word]);
      continue;
    }
    const ids = has.map((c) => c.id);
    // Trample is said as power, fliers as a count with their power, the rest as counts.
    const text = k === "Trample" ? `${power(has)} trample` : k === "Flying" ? `${has.length} fly (${power(has)} power)` : `${has.length} ${word}`;
    counted.push({ text, ids });
  }
  const out: Clause[] = [];
  // Counted clauses share lines, three at most a line.
  for (let i = 0; i < counted.length; i += 3) {
    const part = counted.slice(i, i + 3);
    out.push({ text: part.map((c) => c.text).join(" · "), ids: part.flatMap((c) => c.ids) });
  }
  for (const [c, words] of [...named.entries()].sort(([a], [b]) => byImportance(a, b))) out.push({ text: `${shortCard(c.name)} ${words.join(", ")}`, ids: [c.id] });
  return out.slice(0, lines);
}

/** A kind's combat words, where every one of its cards holds them ("fly"). */
function kindTrait(cs: readonly BoardCard[]): string | null {
  const words = TRAITS.filter(([k]) => cs.every((c) => c.keywords.includes(k))).map(([, w]) => w);
  return words.length ? words.join(", ") : null;
}

/** The works: names in the order they came, identical ones counted ("Incubator ×2"), packed into lines of `width`;
 *  what has no line left is counted on the last, by cards ("+4"). */
function worksOf(cards: readonly BoardCard[], lines: number, width: number): Clause[] {
  if (!cards.length || lines <= 0) return [];
  type Group = { name: string; ids: CardId[] };
  const groups: Group[] = [];
  for (const c of [...cards].sort((a, b) => a.id - b.id)) {
    const g = groups.find((x) => x.name === c.name);
    if (g) g.ids.push(c.id);
    else groups.push({ name: c.name, ids: [c.id] });
  }
  const said = (g: Group): string => (g.ids.length > 1 ? `${g.name} ×${g.ids.length}` : g.name);
  const text = (gs: readonly Group[]): string => gs.map(said).join(" · ");
  const out: Group[][] = [];
  let i = 0;
  while (i < groups.length && out.length < lines) {
    const line: Group[] = [groups[i++]!];
    while (i < groups.length && text([...line, groups[i]!]).length <= width) line.push(groups[i++]!);
    out.push(line);
  }
  const left = (): number => groups.slice(i).reduce((t, g) => t + g.ids.length, 0);
  const last = out[out.length - 1]!;
  if (i < groups.length) while (last.length > 1 && `${text(last)} · +${left()}`.length > width) (last.pop(), i--);
  const tail = groups.slice(i);
  return out.map((l, j) => {
    const more = j === out.length - 1 && tail.length;
    return { text: more ? `${text(l)} · +${left()}` : text(l), ids: [...l, ...(more ? tail : [])].flatMap((g) => g.ids) };
  });
}

/**
 * The account of a page that writes `written` down: the tally and traits of every creature on it, an entry per kind of
 * identical written creature (the most first), one for the unlike rest (named when it is one card), and the written works
 * by name. Past its lines, the smallest kinds join the rest; works take the lines left, then "+N".
 */
export function accountOf(board: SeatBoard, written: ReadonlySet<CardId>, o: AccountOptions = {}): Account {
  const budget = o.lines ?? ACCOUNT_LINES, width = o.width ?? 40;
  const creatures = board.cards.filter((c) => c.creature);
  const out = board.cards.filter((c) => written.has(c.id));
  const wc = out.filter((c) => c.creature), wo = out.filter((c) => !c.creature);
  if (!out.length) return { tally: null, traits: [], entries: [], works: [], written: [], lines: 0 };
  const tally: Tally | null = creatures.length ? { power: power(creatures), creatures: creatures.length, ids: creatures.map((c) => c.id) } : null;
  const traits = traitsOf(creatures);

  // Kinds of identical written creatures, the most first (then the strongest); single cards are the unlike rest.
  const by = new Map<string, BoardCard[]>();
  for (const c of [...wc].sort((a, b) => a.id - b.id)) by.set(kindOf(c), [...(by.get(kindOf(c)) ?? []), c]);
  let kinds = [...by.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length || power(b) - power(a) || a[0]!.id - b[0]!.id);
  let rest = [...by.values()].filter((g) => g.length === 1).flat();
  const fixed = (tally ? 1 : 0) + traits.length;
  // Works keep a line where there are any; the smallest kinds join the rest until the lines hold.
  const lines = (): number => fixed + kinds.length + (rest.length ? 1 : 0) + (wo.length ? 1 : 0);
  while (kinds.length && lines() > budget) {
    rest = [...rest, ...kinds[kinds.length - 1]!];
    kinds = kinds.slice(0, -1);
  }
  const entries: AccountEntry[] = kinds.map((g) => ({
    kind: "kind",
    text: `${g[0]!.name}${size(g[0]!)} ×${g.length}`,
    marks: marksOf(g),
    trait: kindTrait(g),
    ids: ready(g).map((c) => c.id),
  }));
  if (rest.length === 1) {
    const c = rest[0]!;
    entries.push({ kind: "one", text: `${c.name}${size(c)}`, marks: marksOf(rest), trait: kindTrait(rest), ids: [c.id] });
  } else if (rest.length) {
    const sorted = [...rest].sort(byImportance);
    entries.push({ kind: "more", text: `${rest.length} more · ${power(rest)} power`, marks: marksOf(sorted), trait: null, ids: ready(sorted).map((c) => c.id) });
  }
  const works = worksOf(wo, Math.max(wo.length ? 1 : 0, budget - fixed - entries.length), width);
  const order = [...entries.flatMap((e) => e.ids), ...works.flatMap((w) => w.ids)];
  return { tally, traits, entries, works, written: order, lines: fixed + entries.length + works.length };
}
