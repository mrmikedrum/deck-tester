// `mine` (§2.6): my own side, one row facing theirs. Every untapped creature and planeswalker stands in it, and the
// noncreatures that earn a place (the commander, a battle, a card that binds the table, one with counters, a legendary
// one), so a deck that barely plays creatures still shows what matters; my mana and my other works lie in the same row's
// places, what stands nearest the middle (a re-sort deals it by rank), my works from the left end, my mana from the right. What
// does not fit folds least important first: copies stack, my works fan, my mana fans, then the lightest of what stands
// (an engine weighs less than most creatures) goes to a muster, which fans. Nothing shrinks; a pile holding something I
// can use says so (the scene's cue).
import type { ArrCard, Group, Policy, TierSpec } from "../contract";
import { PINNED, anyTapped, collect, creatureWeight, emphasisOf, factsOf, mattersOf, need, promoteRule, seatOf, tidyRule, topOf } from "./common";
import { kindOf } from "./kinds";
import { engine, noncreatureWeight } from "./works";

/**
 * One standing band: what stands, its muster, my works and my mana. A unit that is not presented lies in its place (a
 * land, a rock, a work, a tapped creature turned a quarter); its tier only says what folds with what.
 */
export const MINE_TIERS: readonly TierSpec[] = [
  { id: "field", posture: "stand", markers: true },
  { id: "muster", posture: "stand", markers: true, proud: true },
  { id: "works", posture: "stand", markers: true, proud: true, from: "left" },
  { id: "mana", posture: "stand", markers: true, from: "right" },
];

/** It stands in my row while untapped: a creature, a planeswalker, a battle, the commander, an engine (works.ts). */
const stands = (c: ArrCard): boolean => {
  const k = kindOf(c);
  return k !== "mana" && (c.commander || k === "creature" || engine(c));
};

/** Groups: the commander, a legendary or dressed creature, a planeswalker, a battle alone; other creatures, works, other
 *  lands and rocks by look, ready and spent apart; a basic land's kind is one squared block. */
export function mineGroups(cards: readonly ArrCard[]): Group[] {
  const groups = collect(cards, (c) => {
    if (c.commander) return `cmd:${c.id}`;
    const k = kindOf(c), state = c.tapped ? "t" : "r";
    if (k === "creature") return c.supertypes.legendary ? `one:${c.id}` : `cr:${c.lookKey}:${state}`;
    if (k === "planeswalker" || k === "battle") return `one:${c.id}`;
    // (a block of basics lies square while any is open, as the well says how many are spent)
    if (k === "mana") return c.types.land && c.supertypes.basic ? `basic:${c.cardKey}` : `mana:${c.lookKey}:${state}`;
    return `wk:${c.lookKey}:${state}`;
  });
  return groups.map((g) => (g.key.startsWith("basic:") ? { ...g, stacks: true, squared: true } : g));
}

export const mine: Policy = {
  id: "mine",
  tiers: MINE_TIERS,
  group: mineGroups,
  importance(g, ctx) {
    const cs = g.members.map((id) => need(ctx, id)), c = cs[0]!;
    if (c.commander) return PINNED;
    const k = kindOf(c);
    if (k === "creature") return creatureWeight(cs);
    if (k === "mana") return 0;
    return cs.reduce((t, x) => t + noncreatureWeight(x), 0);
  },
  tier(g, ctx) {
    const c = need(ctx, g.members[0]!);
    return stands(c) ? "field" : kindOf(c) === "mana" ? "mana" : "works";
  },
  presented(g, ctx) {
    return !anyTapped(g, ctx) && g.members.every((id) => stands(need(ctx, id)));
  },
  top: topOf,
  ladder: [
    { op: "stack", where: { tokens: true, stacks: true } },
    { op: "stack", where: { tier: "works", stacks: true } },
    { op: "stack", where: { tier: "mana", stacks: true } },
    { op: "fan", where: { tier: "works" }, show: 6 },
    { op: "fan", where: { tier: "mana" }, show: 6 },
    { op: "stack", where: { creatures: true, stacks: true } },
    { op: "demote", where: { tier: "field" }, to: "muster" },
    { op: "fan", where: { tier: "muster" }, show: 6 },
    { op: "summary", where: { all: true } },
  ],
  matters: mattersOf,
  facts: (u, ctx) => factsOf(u, ctx, "mana"),
  seat: seatOf,
  emphasis: emphasisOf,
  acting: "in-place",
  tidy: tidyRule,
  promote: promoteRule,
};
