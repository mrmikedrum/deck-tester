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
import { CH } from "./geometry";
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
  void involved;
  const isMana = (c: BoardCard) => !c.creature && !c.planeswalker && !c.specialLand && (c.land || c.manaRock || c.treasure);
  const fighting = fighters(combat ?? null);
  const C = kinGroups(bf.filter((c) => c.creature).sort(arrived), hosts).flatMap((g): Draft[] => {
    // A creature in a fight (attacking, blocking) steps out from under the die while it fights; the rest stay. One a
    // spell aims at keeps its place (the scene slides it half out of its tray, or its Ranks): it takes none of its own,
    // so nothing on its page refits.
    const acts = (c: BoardCard) => fighting.has(c.id);
    const f = g.filter(acts), rest = g.filter((c) => !acts(c));
    if (!f.length) return [draft("c", g, "creature")];
    if (g.length === 1) return [draft("c", g, "creature", true)];
    const home = rest.length ? [{ ...draft("c", rest, "creature"), key: "c" + Math.min(...g.map((c) => c.id)) }] : [];
    return [...home, ...fighterDrafts(f, combat)];
  });

  // Their support is one fan of its real cards in their small band; mine lie by kind.
  const support = bf.filter((c) => !c.creature && !c.planeswalker && !isMana(c)).sort(arrived);
  const S = [
    ...bf.filter((c) => c.planeswalker && !c.creature).sort(arrived).map((c) => draft("w", [c], "walker")),
    ...(me ? kinGroups(support, hosts).map((g) => draft("s", g, "support")) : support.length ? [draft("s", readyFirst(support), "support")] : []),
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
function standingWorth(c: BoardCard, hosts: ReadonlySet<CardId>): number {
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
 * Fold creatures into `cap` places, `perRow` to a row. Theirs: the standouts stand in the front row (at most a row of
 * them) and the trays lie behind; the single creatures that stand out least join one Ranks tray, and where trays alone
 * outnumber the places, the smallest trays join it too. A swarm keeps its tray before a single keeps its place; nothing
 * but creatures ever takes a creature place. Mine fold my token swarms first. Fighters keep their places.
 */
const foldC =
  (cards: Cards, hosts: ReadonlySet<CardId>, me: boolean, offered: ReadonlySet<CardId>) =>
  (units: Draft[], cap: number, perRow: number): Draft[] => {
    const fights = units.filter((u) => u.fight), rest = units.filter((u) => !u.fight);
    const room = Math.max(1, cap - fights.length);
    const single = (u: Draft) => u.ids.length === 1, rows = Math.max(1, Math.round(cap / Math.max(1, perRow)));
    const standing = (us: readonly Draft[]) => us.filter(single).length;
    // (Theirs, in two rows: what stands takes the front row, what lies the back.)
    const order = (us: Draft[]): Draft[] => (me || rows < 2 ? us : [...us.filter((u) => single(u) && !u.fight), ...us.filter((u) => !single(u) || u.fight)]);
    if (rest.length <= room && (me || rows < 2 || standing(rest) <= perRow)) return order(units);
    // (Theirs: the commander first, then the trays, then the standouts. Mine: my own creatures before my token swarms,
    // which I know by their dice; past my front line they lie in my Ranks. A card a decision offers steps out of the
    // Ranks while it is offered, so a tap on the table reaches it.)
    const tray = (u: Draft) => (me ? u.ids.length : 1e7 + u.ids.length);
    const worth = (u: Draft): number =>
      cards.need(u.rep).commander ? 1e8 : u.ids.length > 1 ? tray(u) : offered.has(u.rep) ? 5e7 : standingWorth(cards.need(u.rep), hosts);
    const ranked = rest.slice().sort((a, b) => worth(b) - worth(a));
    const kept = new Set<Draft>();
    let stood = 0;
    for (const u of ranked) {
      if (kept.size >= room - 1) break;
      if (single(u) && !me && rows > 1 && stood >= perRow) continue;
      kept.add(u);
      if (single(u)) stood++;
    }
    const folded = rest.filter((u) => !kept.has(u));
    if (folded.length === 1) return order(units); // (one left over takes the place a Ranks would)
    const cs = readyFirst(folded.flatMap((u) => u.ids).map((id) => cards.need(id)));
    const ranks: Draft = { key: "r" + Math.min(...cs.map((c) => c.id)), ids: cs.map((c) => c.id), rep: cs[0]!.id, role: "creature", title: `Ranks ${cs.length}`, mixed: true };
    const at = units.indexOf(folded[0]!);
    const out = units.filter((u) => u.fight || kept.has(u));
    out.splice(Math.min(at, out.length), 0, ranks);
    return order(out);
  };

/** What a stack's top card is: the card itself where every member is one kind, else a tally card. */
/** What a stack's top card is: a real card (mana shows its commonest), or the Ranks tally where creatures are unlike. */
function topOf(role: UnitRole, cs: readonly BoardCard[]): TrayTop {
  if (role === "mana" || new Set(cs.map((c) => c.kin)).size === 1) return "card";
  return "ranks";
}

/** Mana's ready cards, its commonest kind first (the card it shows on top), then tapped the same way. */
function commonestFirst(cs: readonly BoardCard[]): BoardCard[] {
  const n = new Map<string, number>();
  for (const c of cs) n.set(c.cardKey, (n.get(c.cardKey) ?? 0) + 1);
  return cs.slice().sort((a, b) => (n.get(b.cardKey) ?? 0) - (n.get(a.cardKey) ?? 0) || Number(b.land) - Number(a.land) || a.id - b.id);
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

/** Each unit's posture and what it lies as: standouts stand; a tapped one lies spent (theirs) or turned (mine); a swarm,
 * Ranks or mana lies on a tray; support of several lies as a fan of its real cards. */
function finish(d: Draft, u: Unit, cards: Cards, input: SeatInput): Unit {
  const cs = u.members.map((id) => cards.need(id)), me = input.board.mine;
  const flat = { ...u.placement, posture: "flat" as const };
  if (cs.length < 2) {
    if (u.role === "creature" && (!u.tapped || u.acting)) return { ...u, placement: { ...u.placement, posture: "stand", lean: STAND_LEAN } };
    // Theirs lie spent where they stand, shaded and a little turned: their places are a card wide, not a turned card's.
    if (!me) return { ...u, tapped: false, ...(u.tapped ? { spent: true } : {}), placement: flat };
    if (u.role !== "creature") return { ...u, placement: flat };
    // Mine: tapped, it lies turned in its place where its narrow side, foreshortened, still meets its floor; where it
    // would not, it stands turned in its foot, as a tapped standee does.
    const floor = FLOOR.mine, g = makeGeo(input.projector, input.reserve, floor);
    const lies = floorScale(g, u.placement.pos, floor, true, u.placement.scale) <= u.placement.scale + 1e-6;
    return { ...u, placement: { ...u.placement, posture: lies ? "flat" : "stand", ...(lies ? {} : { lean: STAND_LEAN }) } };
  }
  if (u.role === "support" || u.role === "walker") {
    // A fan of its real cards, ready first: one group, opened by a tap.
    const members = readyFirst(cs).map((c) => c.id);
    return {
      ...u,
      kind: "pile",
      members,
      top: members[0]!,
      title: null,
      mixed: new Set(cs.map((c) => c.cardKey)).size > 1,
      tapped: false,
      fan: true,
      footprint: { w: me ? FAN_W.mine : FAN_W.theirs, front: -0.03, back: CH + 0.05 },
      placement: flat,
    };
  }
  // (A detachment's attackers go together under one bone die, tapped by attacking or not.)
  const detached = !!d.fight && d.key.startsWith("d");
  const order = u.role === "mana" ? commonestFirst : (x: readonly BoardCard[]) => [...x];
  const ready = order(detached ? [...cs] : cs.filter((c) => !c.tapped)), tapped = order(detached ? [] : cs.filter((c) => c.tapped));
  const top = topOf(u.role, cs);
  const members = [...ready, ...tapped].map((c) => c.id);
  // (Their mana is one small stack of real lands, the commonest on top, its dice side by side: no band behind it.)
  const stack = u.role === "mana" && !me;
  const tray: Tray = {
    ready: ready.map((c) => c.id),
    tapped: tapped.map((c) => c.id),
    top,
    ...lipOf(cs, top),
    summary: top === "card" ? null : summarize(cs),
    ...(detached ? { detachment: true } : {}),
    ...(stack ? { stack: true } : {}),
  };
  return {
    ...u,
    kind: u.role === "mana" ? "well" : top === "card" ? "pile" : "summary",
    members,
    top: members[0]!,
    title: null,
    mixed: top !== "card",
    tapped: false,
    placement: flat,
    tray,
    footprint: stack
      ? { w: TRAY_PRINT.w, front: -TRAY_PRINT.rim, back: CH + TRAY_PRINT.rim }
      : { w: TRAY_PRINT.w, front: TRAY_PRINT.front, back: detached ? TRAY_PRINT.detached : TRAY_PRINT.back },
  };
}

/** How wide a fan of support spreads: theirs within its wide place, mine within a card's. */
const FAN_W = { theirs: 1.4, mine: 0.84 } as const;

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
    // (Their places are a tray wide, a card and its rim: what lies tapped there lies spent, never turned.)
    // (Their standouts stand in the front row and their trays lie in the back row: it reaches a tray's depth behind its foot.)
    if (k === "C") return me ? b : { ...b, per: TRAY_PRINT.w + 0.06, lead: b.lead - TRAY_PRINT.front / 2, step: Math.max(b.step, TRAY_D), tall: 1.04, tallLast: 1.14, upright: true, backLying: TRAY_PRINT.back };
    // Their small band behind the creatures: support fanned and walkers lying, at any card's floor, measured upright.
    if (k === "S") return me ? { ...b, flat: true } : { ...b, flat: true, lying: true, upright: true, lead: 0.08, first: 0.08 + CH + 0.05, step: CH + 0.2, per: FAN_W.theirs + 0.12 };
    // (Their mana lies at the end of the small band: one stack of real lands on a tray.)
    return me ? { ...b, flat: true } : { ...b, flat: true, lying: true, upright: true, lead: TRAY_PRINT.rim, first: CH + 2 * TRAY_PRINT.rim };
  };

export const die: SeatLayout = {
  id: "die",
  plan: (input) => planWith(input, { paradigm: "die", flatZones: true, classify, foldC: (cards, hosts, input) => foldC(cards, hosts, input.board.mine, input.offered ?? new Set()), geo: (g) => ({ ...g, lean: STAND_LEAN, band: band(g) }), finish }),
};
