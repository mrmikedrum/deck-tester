import type { BoardCard } from "../board";
import type { CardId, } from "../types";
import type { UnitRole } from "../seat";

// Folding and naming: the old `fold`, `kindsOf` and `holding`, over card facts instead of live card objects.

/** A unit as the fit builds it (the old `{ key, ids, rep, role, title, mixed, lands, fight, at, top }`), plain JSON. */
export interface Draft {
  key: string;
  ids: CardId[];
  /** The card it shows (the old `rep`), by id. */
  rep: CardId;
  role: UnitRole;
  /** A pile's title: "Beast 9", "Creatures 31". */
  title?: string | undefined;
  /** A pile of unlike cards. */
  mixed?: boolean | undefined;
  /** Theirs: the one well of every land and mana source they have. */
  lands?: boolean | undefined;
  /** In combat: it never folds and fights in the open middle (here: keeps its place for the combat row). */
  fight?: boolean | undefined;
  /** Its place in its band, counted from the row's middle out. */
  at?: number | undefined;
  /** The card that showed on top, so a pile that opens leaves it in its place. */
  top?: CardId | undefined;
  /** A creature pile's name|power/toughness when it formed, for when its showing card has left. */
  look?: string | undefined;
}

export interface Cards {
  get(id: CardId): BoardCard | undefined;
  /** For ids known to be on the board. */
  need(id: CardId): BoardCard;
}

export const cardsOf = (list: readonly BoardCard[]): Cards => {
  const by = new Map(list.map((c) => [c.id, c]));
  return {
    get: (id) => by.get(id),
    need: (id) => {
      const c = by.get(id);
      if (!c) throw new Error(`card ${id} is not on this seat's board`);
      return c;
    },
  };
};

/** A way to find like cards: the group key a unit belongs to, or null. `word` names the pile; `whole` is all-or-nothing. */
export interface Like {
  (u: Draft): string | null | false;
  word?: (u: Draft) => string;
  whole?: boolean;
}

export type Named = (us: Draft[], title: string) => Draft;
export type Keep = (u: Draft) => boolean;

// One card of each name among `ids`, the most numerous first (ties in the order they came), each lying as most of the
// pile does: a pile mostly ready never shows a tapped card in front (the front is the most numerous kind that has one
// lying that way).
export function kindsOf(cards: Cards, ids: readonly CardId[]): BoardCard[] {
  const cs = ids.map((id) => cards.get(id)).filter((c): c is BoardCard => !!c);
  const tapped = cs.filter((x) => x.tapped).length * 2 > cs.length;
  const by = new Map<string, BoardCard[]>();
  cs.forEach((x) => by.set(x.cardKey, (by.get(x.cardKey) ?? []).concat([x])));
  const gs = [...by.values()].sort((a, b) => b.length - a.length);
  const lies = (g: BoardCard[]) => g.find((x) => x.tapped === tapped);
  const f = gs.findIndex((g) => lies(g));
  if (f > 0) gs.unshift(gs.splice(f, 1)[0]!);
  return gs.map((g) => lies(g) ?? g[0]!);
}

/** The noncreature pile word: "Artifacts", "Planeswalkers". */
export const kindWord = (c: BoardCard): string => c.typeWord + "s";

// Fold units into `cap` places, in intent's order: like cards fan into a named pile, the narrowest likeness first (the
// same name, then the same kind), the largest group first and only as many groups as needed; then the row ends in a
// mixed pile titled for what it holds ("Creatures 31"), never one card's name. Legendary and commander cards stay out of
// piles as long as anything else can fold. A pile keeps the place of the first of its cards to arrive.
// A creature in combat (`fight`) is never folded: it fights in the open middle, and the rest fold into the
// places left, its own place kept empty for it to come back to.
export function fold(
  cards: Cards,
  units0: Draft[],
  cap: number,
  likes: readonly Like[],
  keep: Keep,
  named: Named,
  mixed: string | null,
): Draft[] {
  const fight = units0.filter((u) => u.fight);
  if (fight.length) {
    const others = units0.filter((u) => !u.fight);
    const rest = fold(cards, others, Math.max(1, cap - fight.length), likes, keep, named, mixed);
    return rest.length === others.length ? units0 : rest.concat(fight);
  }
  let units = units0.slice();
  for (const like of likes) {
    if (like.whole && units.length > cap && mixed) {
      // (all or nothing: see likeC)
      const all = fold(cards, units, cap, [like], keep, named, null);
      if (all.length <= cap) units = all;
      continue;
    }
    while (units.length > cap) {
      const by = new Map<string, Draft[]>();
      units.forEach((u) => {
        const k = !keep(u) && like(u);
        if (k) by.set(k, (by.get(k) ?? []).concat([u]));
      });
      const best = [...by.entries()].filter(([, us]) => us.length > 1).sort((x, y) => y[1].length - x[1].length)[0];
      if (!best) break;
      const [k, us] = best;
      const at = units.indexOf(us[0]!), ids = us.flatMap((u) => u.ids);
      const pile = named(us, `${like.word ? like.word(us[0]!) : k} ${ids.length}`);
      if (new Set(ids.map((id) => cards.get(id)?.cardKey)).size > 1) pile.mixed = true; // ("Tokens 9": unlike cards all the same)
      units = units.filter((u) => !us.includes(u));
      units.splice(at, 0, pile);
    }
  }
  if (units.length > cap && mixed) {
    // (none: like cards only)
    // What stays out of it says the most: the kept cards, then the largest piles of like creatures ("Beast 9" names nine),
    // then the rest in the order they came. The mixed pile takes what is left, so it hides as few creatures as it can.
    const weight = (u: Draft) => (u.role === "creature" ? u.ids.length : 1);
    const room = Math.max(0, cap - 1);
    const rank = units.filter(keep).concat(units.filter((u) => !keep(u)).sort((x, y) => weight(y) - weight(x)));
    const chosen = new Set(rank.slice(0, room)), shown = units.filter((u) => chosen.has(u));
    const rest = units.filter((u) => !shown.includes(u));
    units = shown.concat([{ ...named(rest, `${mixed} ${rest.reduce((t, u) => t + u.ids.length, 0)}`), mixed: true }]);
  }
  return units;
}

// A unit of the last fit holding only `ids` now, its top card kept while it is still there, and its title said again
// from what it holds: the one name they share, "Tokens", the one kind ("Planeswalkers 2"), or else its own word.
export function holding(cards: Cards, u0: Draft, ids: CardId[]): Draft {
  const cs = ids.map((id) => cards.need(id));
  const rep = ids.includes(u0.rep) ? u0.rep : cs[0]!.id;
  const u: Draft = { ...u0, top: u0.top !== undefined && ids.includes(u0.top) ? u0.top : undefined };
  if (!u.title || ids.length < 2) return { ...u, ids, rep, title: undefined, mixed: false };
  const one = (f: (c: BoardCard) => string): string | null => (new Set(cs.map(f)).size === 1 ? f(cs[0]!) : null);
  const name = one((c) => c.name);
  const word = name || (cs.every((c) => c.token) && "Tokens") || one(kindWord) || u.title.replace(/\s*\d+$/, "");
  return { ...u, ids, rep, title: `${word} ${ids.length}`, mixed: !name };
}

/** The card a unit shows on top: its own for a creature, a well or one card; a pile's last shown (of up to 8, a fan of 3). */
export function topOf(d: Draft, me: boolean): CardId {
  if (d.role === "creature" || d.role === "mana" || d.ids.length < 2) return d.rep;
  const fan = !!d.title && me, show = d.ids.slice(0, Math.min(d.ids.length, fan ? 3 : 8));
  return show[show.length - 1]!;
}
