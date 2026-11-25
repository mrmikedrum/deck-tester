// What the starting policies share: grouping helpers, facts, the seat's summary, what matters if hidden, light, the
// tidy and the promotion margin (§2.4). Policies are data plus these small functions; the solver owns space.
import type { CardId } from "../../types";
import type { ArrCard, AttentionWhy, Clock, DraftUnit, Emphasis, Group, PolicyCtx, PolicyMemory, SeatFacts, UnitFacts } from "../contract";
import type { Moment } from "../moment";
import { stanceOf } from "../moment";
import { blocksFliers, combatKeyword, flies, kindOf, ready, threatens } from "./kinds";


export const need = (ctx: PolicyCtx, id: CardId): ArrCard => {
  const c = ctx.cards.get(id);
  if (!c) throw new Error(`no card ${id} in this container`);
  return c;
};
const cardsOf = (ids: readonly CardId[], ctx: PolicyCtx): ArrCard[] => ids.map((id) => need(ctx, id));

/** Attachments whose host is in the container: host id to the cards dressing it. */
export function dressingOf(cards: readonly ArrCard[]): Map<CardId, CardId[]> {
  const here = new Set(cards.map((c) => c.id)), out = new Map<CardId, CardId[]>();
  for (const c of cards)
    if (c.attachedTo !== null && here.has(c.attachedTo) && c.attachedTo !== c.id) out.set(c.attachedTo, [...(out.get(c.attachedTo) ?? []), c.id]);
  for (const v of out.values()) v.sort((a, b) => a - b);
  return out;
}

/** Untapped first, then by id: a tap on a group reaches one that can act. */
export const memberOrder = (a: ArrCard, b: ArrCard): number => Number(a.tapped) - Number(b.tapped) || a.id - b.id;

/**
 * Collect groups: each card's key decides its group (null: alone); a host takes its dressing along and stands alone.
 * A group may stack when its members share one look and one tapped state (copies).
 */
export function collect(cards: readonly ArrCard[], keyOf: (c: ArrCard) => string): Group[] {
  const dressing = dressingOf(cards), dressed = new Set([...dressing.values()].flat());
  const by = new Map<string, ArrCard[]>();
  for (const c of [...cards].sort((a, b) => a.id - b.id)) {
    if (dressed.has(c.id)) continue;
    const k = dressing.has(c.id) ? `one:${c.id}` : keyOf(c);
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, cs]) => {
      const members = cs.sort(memberOrder);
      const look = members[0]!.lookKey, tapped = members[0]!.tapped;
      return {
        key,
        members: members.map((c) => c.id),
        dressing: members.flatMap((c) => dressing.get(c.id) ?? []),
        stacks: members.every((c) => c.lookKey === look && c.tapped === tapped),
      };
    });
}

const power = (cs: readonly ArrCard[]): number => cs.reduce((t, c) => t + (c.types.creature ? Math.max(0, c.power ?? 0) : 0), 0);

/** A creature group's weight (owner decision 1: most total power), doubled with a combat keyword. */
export const creatureWeight = (cs: readonly ArrCard[]): number => power(cs) * (cs.some(combatKeyword) ? 2 : 1);

/** The commander is pinned, whatever its weight or types. */
export const PINNED = 1e6;

export const allTapped = (g: Group, ctx: PolicyCtx): boolean => g.members.every((id) => need(ctx, id).tapped);
export const anyTapped = (g: Group, ctx: PolicyCtx): boolean => g.members.some((id) => need(ctx, id).tapped);

/** The previous top while still a member; else the group's first (untapped, earliest); a well shows its most numerous basic. */
export function topOf(g: Group, prev: CardId | null, ctx: PolicyCtx): CardId {
  if (prev !== null && g.members.includes(prev)) return prev;
  const cs = cardsOf(g.members, ctx);
  if (cs.length > 1 && cs.every((c) => kindOf(c) === "mana")) {
    const count = new Map<string, number>();
    for (const c of cs) if (c.supertypes.basic) count.set(c.cardKey, (count.get(c.cardKey) ?? 0) + 1);
    const best = [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (best) return cs.find((c) => c.cardKey === best[0] && !c.tapped)?.id ?? cs.find((c) => c.cardKey === best[0])!.id;
  }
  return g.members[0]!;
}

const KINDS = ["creature", "planeswalker", "battle", "artifact", "enchantment", "land"] as const;

/** A unit's facts, in the terms that matter. A unit in `wellTier` is a well. */
export function factsOf(u: DraftUnit, ctx: PolicyCtx, wellTier: string): UnitFacts {
  const cs = cardsOf(u.members, ctx);
  if (u.kind === "summary") return { kind: "summary", count: cs.length, power: power(cs), creatures: cs.filter((c) => c.types.creature).length };
  if (u.tier === wellTier && u.kind !== "card")
    return {
      kind: "well",
      lands: cs.filter((c) => c.types.land).length,
      open: cs.filter((c) => !c.tapped).length,
      produces: [...new Set(cs.flatMap((c) => c.produces))].sort(),
      rocks: cs.filter((c) => !c.types.land).length,
    };
  if (u.kind === "stack") return { kind: "stack", name: cs[0]!.name, count: cs.length, power: power(cs) };
  if (u.kind === "fan") {
    const big = cs.filter((c) => c.types.creature).sort((a, b) => (b.power ?? 0) - (a.power ?? 0) || (b.toughness ?? 0) - (a.toughness ?? 0) || a.id - b.id)[0];
    return {
      kind: "fan",
      count: cs.length,
      power: power(cs),
      keywords: [...new Set(cs.flatMap((c) => c.keywords))].sort(),
      biggest: big ? big.id : null,
      tapped: cs.filter((c) => c.tapped).length,
      kinds: KINDS.filter((k) => cs.some((c) => c.types[k])),
    };
  }
  const c = cs[0]!;
  return { kind: "card", card: c.id, power: c.types.creature ? c.power : null };
}

/** A rest container's summary, from its units. */
export function seatOf(units: readonly DraftUnit[], ctx: PolicyCtx): SeatFacts {
  const cs = units.flatMap((u) => cardsOf(u.members, ctx)), cr = cs.filter((c) => c.types.creature);
  const lands = cs.filter((c) => kindOf(c) === "mana");
  return {
    creatures: cr.length,
    power: power(cr),
    flyingPower: power(cr.filter(flies)),
    keywords: [...new Set(cr.flatMap((c) => c.keywords))].filter((k) => k !== "flying").sort(),
    lands: lands.filter((c) => c.types.land).length,
    open: lands.filter((c) => !c.tapped).length,
    works: cs.filter((c) => kindOf(c) === "works").length,
  };
}

/** What matters if hidden (§2.4): cued, never moved. */
export function mattersOf(c: ArrCard, m: Moment, ctx: PolicyCtx): AttentionWhy | null {
  if (ctx.acting.offered.has(c.id)) return "offered";
  if (m.q === "aim" && m.legal.includes(c.id)) return "aimed";
  if (m.q === "sweep" && m.reaches.includes(c.id)) return "in-danger";
  if (m.q === "strike" && !ctx.mine && c.types.creature && !c.tapped && (!m.airborne || blocksFliers(c))) return "answers";
  if (m.q === "threat" && c.controller === m.seat && ready(c)) return "can-hurt-me";
  if (threatens(c) || c.types.planeswalker) return "threat";
  if (c.reach === "table" && !ctx.mine) return "binds-me";
  return null;
}

/** Light (§2.3): forward where any member answers the moment, down where all are down. */
export function emphasisOf(u: DraftUnit, m: Moment, ctx: PolicyCtx): { emphasis: Emphasis | null; lit: CardId[] } {
  const seat = ctx.owner;
  if (!seat) return { emphasis: null, lit: [] };
  const st = u.members.map((id) => [id, stanceOf(need(ctx, id), seat, ctx.mine, m)] as const);
  const lit = st.filter(([, s]) => s === "forward").map(([id]) => id);
  if (lit.length) return { emphasis: "forward", lit };
  if (st.length && st.every(([, s]) => s === "down")) return { emphasis: "down", lit: [] };
  return { emphasis: st.some(([, s]) => s !== null) ? "ease" : null, lit: [] };
}

/** Forge's combat steps: the front never re-deals between declare attackers and end of combat. */
const IN_COMBAT = /^COMBAT_(DECLARE_ATTACKERS|DECLARE_BLOCKERS|FIRST_STRIKE_DAMAGE|DAMAGE)$/;

/** The owner's re-sort: at the start of every turn; at a phase change if the ranking changed past the margin. */
export function tidyRule(clock: Clock, last: PolicyMemory["tidy"] | null, rankingChanged: boolean): boolean {
  if (clock.settling) return false;
  if (!last) return true;
  if (clock.turn !== last.turn) return true;
  if (IN_COMBAT.test(String(clock.phase).toUpperCase())) return false;
  return clock.phase !== last.phase && rankingChanged;
}

/** A challenger outranks an incumbent past the margin. */
export const promoteRule = (incumbent: number, challenger: number): boolean => challenger >= incumbent + 2 && challenger >= 1.25 * incumbent;

