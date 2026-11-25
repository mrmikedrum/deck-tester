import type { BoardCard } from "../board";
import { fighters } from "../combat";
import type { CombatPairs } from "../combat";
import type { SeatInput, SeatLayout, Tray, TrayTop, Unit, UnitRole } from "../seat";
import type { CardId } from "../types";
import type { Cards, Draft } from "./fold";
import type { Geo } from "./geometry";
import { bandSpec, floorScale, makeGeo } from "./geometry";
import { FLOOR } from "../board";
import { TRAY_PRINT } from "../shape";
import { planWith } from "./mat";
import type { Classified } from "./mat";

// `die`: two or more identical things doing the same thing are one card under a die; anything doing something different
// steps out. Like cards lie on one bronze tray, ready ones upright under a bone die and tapped ones turned behind under an
// iron die; small unlike creatures share a tray under a "Ranks" tally card; the commander and the standouts stand alone.
// Built on the mat's fit (its bands, rows and places), with its own classification (by kin, ready and tapped together),
// its own creature fold (standouts last), and its own postures: standing is one card ready to act; lying is spent, or
// many.

/** Keywords that change combat: a creature with one stands out (intent.md "Folding by importance"). */
const COMBAT = new Set(["Flying", "Trample", "Deathtouch", "Menace", "Lifelink", "First strike", "Double strike", "Indestructible", "Hexproof", "Reach", "Vigilance"]);

const arrived = (a: BoardCard, b: BoardCard): number => Number(b.commander) - Number(a.commander) || a.id - b.id;
/** Ready first, then tapped, each in the order they came. */
const readyFirst = (cs: readonly BoardCard[]): BoardCard[] => [...cs.filter((c) => !c.tapped), ...cs.filter((c) => c.tapped)];

/** Cards of one kin lie together; hosts (dressed) and commanders stand alone. */
function kinGroups(list: readonly BoardCard[], hosts: ReadonlySet<CardId>): BoardCard[][] {
  const out: BoardCard[][] = [], seen = new Map<string, BoardCard[]>();
  for (const c of list) {
    if (hosts.has(c.id) || c.commander) {
      out.push([c]);
      continue;
    }
    const g = seen.get(c.kin);
    if (g) g.push(c);
    else {
      const ng = [c];
      seen.set(c.kin, ng);
      out.push(ng);
    }
  }
  return out.map(readyFirst);
}

const draft = (prefix: string, cs: readonly BoardCard[], role: UnitRole, fight = false): Draft => ({
  key: prefix + Math.min(...cs.map((c) => c.id)),
  ids: cs.map((c) => c.id),
  rep: cs[0]!.id,
  role,
  ...(fight ? { fight: true } : {}),
});

/**
 * A swarm's fighters by what they do: attackers aimed at one defender that nothing blocks go as one detachment under one
 * die; blocked, blocking or aimed-at cards stand alone.
 */
function fighterDrafts(cs: readonly BoardCard[], combat: CombatPairs | null | undefined): Draft[] {
  const blocked = new Set(combat?.blocks.map((b) => b.attacker) ?? []);
  const to = new Map<CardId, string>();
  for (const a of combat?.attacks ?? []) if (!blocked.has(a.attacker)) to.set(a.attacker, "seat" in a.defender ? `s${a.defender.seat}` : `c${a.defender.card}`);
  const by = new Map<string, BoardCard[]>(), out: Draft[] = [];
  for (const c of cs) {
    const k = to.get(c.id);
    if (k === undefined) out.push(draft("f", [c], "creature", true));
    else by.set(k, [...(by.get(k) ?? []), c]);
  }
  for (const g of by.values()) out.push(g.length > 1 ? draft("d", g, "creature", true) : draft("f", g, "creature", true));
  return out;
}

function classify(bf: readonly BoardCard[], hosts: ReadonlySet<CardId>, me: boolean, seat: string, input: SeatInput): Classified {
  const { involved, combat } = input;
  const isMana = (c: BoardCard) => !c.creature && !c.planeswalker && !c.specialLand && (c.land || c.manaRock || c.treasure);
  const fighting = fighters(combat ?? null);
  const C = kinGroups(bf.filter((c) => c.creature).sort(arrived), hosts).flatMap((g): Draft[] => {
    // A creature in a fight (attacking, blocking) steps out from under the die while it fights; the rest stay. One
    // aimed at by a spell stays under it, and the aim lands on its tray: a side page has three creature places, and
    // one stepping out would cost its swarm its own.
    const acts = (c: BoardCard) => (g.length > 1 ? fighting.has(c.id) : involved.has(c.id));
    const f = g.filter(acts), rest = g.filter((c) => !acts(c));
    if (!f.length) return [draft("c", g, "creature")];
    if (g.length === 1) return [draft("c", g, "creature", true)];
    const home = rest.length ? [{ ...draft("c", rest, "creature"), key: "c" + Math.min(...g.map((c) => c.id)) }] : [];
    return [...home, ...fighterDrafts(f, combat)];
  });

  const S = [
    ...bf.filter((c) => c.planeswalker && !c.creature).sort(arrived).map((c) => draft("w", [c], "walker")),
    ...kinGroups(bf.filter((c) => !c.creature && !c.planeswalker && !isMana(c)).sort(arrived), hosts).map((g) => draft("s", g, "support")),
  ];

  const mana = bf.filter(isMana).sort(arrived), L: Draft[] = [];
  if (me) {
    // Mine: a tray per kind of land or rock (today's wells, each now a tray).
    const by = new Map<string, BoardCard[]>();
    mana.slice().sort((a, b) => Number(b.land) - Number(a.land)).forEach((c) => by.set(c.cardKey, [...(by.get(c.cardKey) ?? []), c]));
    by.forEach((cs) => L.push(draft("m", readyFirst(cs), "mana")));
  } else if (mana.length) {
    // Theirs: one Mana tray at the end of their support row.
    const cs = readyFirst(mana);
    L.push({ key: "m" + seat, ids: cs.map((c) => c.id), rep: (cs.find((c) => c.land) ?? cs[0]!).id, role: "mana", lands: true });
  }
  return { C, S, L };
}

/**
 * How much a single creature is worth keeping on its own, highest first (who stands when a page runs short of places):
 * the commander; anything wearing an Aura or Equipment; legendary creatures; a keyword that changes combat; the biggest
 * bodies; ready before tapped.
 */
function standing(c: BoardCard, hosts: ReadonlySet<CardId>): number {
  return (
    (c.commander ? 1e6 : 0) +
    (hosts.has(c.id) ? 5e5 : 0) +
    (c.legendary ? 2e5 : 0) +
    (c.keywords.some((k) => COMBAT.has(k)) ? 1e5 : 0) +
    (c.power ?? 0) * 100 +
    (c.toughness ?? 0) * 10 +
    (c.tapped ? 0 : 5)
  );
}

/**
 * Fold creatures into `cap` places: trays and fighters keep theirs; the single creatures that stand out least join one
 * Ranks tray (tapped and smallest first), which takes the place of the first of them to arrive. Where trays alone
 * outnumber the places, the smallest trays join it too.
 */
const foldC =
  (cards: Cards, hosts: ReadonlySet<CardId>, me: boolean, offered: ReadonlySet<CardId>) =>
  (units: Draft[], cap: number): Draft[] => {
    const fights = units.filter((u) => u.fight), rest = units.filter((u) => !u.fight);
    const room = Math.max(1, cap - fights.length);
    if (rest.length <= room) return units;
    // (Theirs: the commander first, then the trays, then the standouts. Mine: my own creatures before my token swarms,
    // which I know by their dice; past my front line they lie in my Ranks.)
    const tray = (u: Draft) => (me ? u.ids.length : 1e7 + u.ids.length);
    // (A card a decision offers steps out of the Ranks while it is offered, so a tap on the table reaches it.)
    const worth = (u: Draft): number =>
      cards.need(u.rep).commander ? 1e8 : u.ids.length > 1 ? tray(u) : offered.has(u.rep) ? 5e7 : standing(cards.need(u.rep), hosts);
    const ranked = rest.slice().sort((a, b) => worth(b) - worth(a));
    const kept = new Set(ranked.slice(0, room - 1)), folded = rest.filter((u) => !kept.has(u));
    const cs = readyFirst(folded.flatMap((u) => u.ids).map((id) => cards.need(id)));
    const ranks: Draft = { key: "r" + Math.min(...cs.map((c) => c.id)), ids: cs.map((c) => c.id), rep: cs[0]!.id, role: "creature", title: `Ranks ${cs.length}`, mixed: true };
    const at = units.indexOf(folded[0]!);
    const out = units.filter((u) => u.fight || kept.has(u));
    out.splice(Math.min(at, out.length), 0, ranks);
    return out;
  };

/** What a stack's top card is: the card itself where every member is one kind, else a tally card. */
function topOf(role: UnitRole, cs: readonly BoardCard[], theirWell: boolean): TrayTop {
  if (role === "mana") {
    if (theirWell) return "mana";
    if (new Set(cs.map((c) => c.cardKey)).size === 1) return "card";
    return cs.every((c) => c.manaRock) ? "rocks" : cs.every((c) => c.land) ? "lands" : "mana";
  }
  if (new Set(cs.map((c) => c.kin)).size === 1) return "card";
  return role === "creature" ? "ranks" : "others";
}

/** The lip's words and icons: total power, then each keyword with how many have it (no count when all do). */
function lipOf(cs: readonly BoardCard[], top: TrayTop): Pick<Tray, "lip" | "lipIcons"> {
  const creatures = cs.filter((c) => c.creature);
  if (!creatures.length) return { lip: null, lipIcons: [] };
  const power = creatures.reduce((t, c) => t + Math.max(0, c.power ?? 0), 0);
  const kw = new Map<string, number>();
  for (const c of creatures) for (const k of c.keywords) if (COMBAT.has(k)) kw.set(k, (kw.get(k) ?? 0) + 1);
  const lipIcons = [...kw.entries()].sort((a, b) => b[1] - a[1]).map(([keyword, n]) => ({ keyword, count: n === creatures.length ? null : n }));
  return { lip: power > 0 || top === "ranks" ? `${power} power` : null, lipIcons };
}

/** Each unit's posture and tray: standouts stand ready and lie turned when tapped; stacks, support and mana lie flat. */
function finish(d: Draft, u: Unit, cards: Cards, input: SeatInput): Unit {
  const cs = u.members.map((id) => cards.need(id));
  if (cs.length < 2) {
    const stand = u.role === "creature" && (!u.tapped || u.acting);
    if (stand || u.role !== "creature") return { ...u, placement: { ...u.placement, posture: stand ? "stand" : "flat", ...(stand ? { lean: STAND_LEAN } : {}) } };
    // Tapped, it lies turned in its place where its narrow side, foreshortened, still meets its floor; where it would not,
    // it stands turned in its foot, as a tapped standee does (floors come first: lying larger, it would meet its
    // neighbours).
    const floor = input.board.mine ? FLOOR.mine : FLOOR.theirs, g = makeGeo(input.projector, input.reserve, floor);
    const lies = floorScale(g, u.placement.pos, floor, true, u.placement.scale) <= u.placement.scale + 1e-6;
    return { ...u, placement: { ...u.placement, posture: lies ? "flat" : "stand", ...(lies ? {} : { lean: STAND_LEAN }) } };
  }
  // (A detachment's attackers go together under one bone die, tapped by attacking or not.)
  const detached = !!d.fight && d.key.startsWith("d");
  const ready = detached ? [...cs] : cs.filter((c) => !c.tapped), tapped = detached ? [] : cs.filter((c) => c.tapped);
  const top = topOf(u.role, cs, !!d.lands);
  const members = [...ready, ...tapped].map((c) => c.id);
  const tray: Tray = {
    ready: ready.map((c) => c.id),
    tapped: tapped.map((c) => c.id),
    top,
    ...lipOf(cs, top),
    summary: top === "card" ? null : summarize(cs),
    ...(detached ? { detachment: true } : {}),
  };
  return {
    ...u,
    kind: u.role === "mana" ? "well" : top === "card" ? "pile" : "summary",
    members,
    top: members[0]!,
    title: null,
    mixed: top !== "card",
    tapped: ready.length === 0,
    placement: { ...u.placement, posture: "flat" },
    tray,
  };
}

function summarize(cs: readonly BoardCard[]): Tray["summary"] {
  const kw = new Map<string, number>();
  cs.forEach((c) => c.keywords.forEach((k) => kw.set(k, (kw.get(k) ?? 0) + 1)));
  const big = cs.filter((c) => c.creature).sort((a, b) => (b.power ?? 0) - (a.power ?? 0) || (b.toughness ?? 0) - (a.toughness ?? 0) || a.id - b.id)[0];
  return {
    count: cs.length,
    totalPower: cs.reduce((t, c) => t + (c.creature ? (c.power ?? 0) : 0), 0),
    tapped: cs.filter((c) => c.tapped).length,
    keywords: [...kw.entries()].map(([keyword, count]) => ({ keyword, count })).sort((a, b) => b.count - a.count || (a.keyword < b.keyword ? -1 : 1)),
    biggest: big ? big.id : null,
  };
}

/** A tray's depth from its lip to the back of its tapped band, in card heights (shape.ts `TRAY_PRINT`). */
const TRAY_D = TRAY_PRINT.back - TRAY_PRINT.front;
/** A standee stands in a brass foot at one fixed lean back from upright, for every seat. */
export const STAND_LEAN = (25 * Math.PI) / 180;

/**
 * The bands as things lie in them: creatures stand, or lie on trays a row runs 1.75 deep for; their support lies flat in
 * rows as deep as a card (nothing to see over, no title tabs); mine lies flat where it was propped.
 */
const band =
  (g: Geo): Geo["band"] =>
  (k, me, px) => {
    const b = bandSpec(k, me, g.pitch, px);
    // (Theirs start where a tray's lip lies at a standee's foot: what stands in front of the row keeps clear of it.)
    if (k === "C") return me ? b : { ...b, lead: b.lead - TRAY_PRINT.front, step: Math.max(b.step, TRAY_D), tall: 1.04 };
    if (k === "S") return me ? { ...b, flat: true } : { ...b, flat: true, lying: true, lead: -TRAY_PRINT.front, first: TRAY_D + 0.1, step: TRAY_D + 0.1 };
    // (Their one Mana tray lies at the end of their support row: as deep as a tray from its foot.)
    return me ? { ...b, flat: true } : { ...b, flat: true, lying: true, lead: -TRAY_PRINT.front, first: TRAY_PRINT.back - TRAY_PRINT.front };
  };

export const die: SeatLayout = {
  id: "die",
  plan: (input) => planWith(input, { paradigm: "die", classify, foldC: (cards, hosts, input) => foldC(cards, hosts, input.board.mine, input.offered ?? new Set()), geo: (g) => ({ ...g, lean: STAND_LEAN, band: band(g) }), finish }),
};
