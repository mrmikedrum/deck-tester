// `mine` (§2.6): my own side, one row facing theirs. Every untapped creature and planeswalker stands in it, and the
// noncreatures that earn a place (the commander, a battle, a card that binds the table, one with counters, a legendary
// one), so a deck that barely plays creatures still shows what matters; my works and my mana lie in the same row's places,
// one centred block while the row has room: works at its left, what stands in its middle (dealt by rank at a re-sort),
// mana at its right, by kind. What does not fit folds least important first: copies stack, my works fan, my rocks and my
// utility lands each fan (each a well that names its kind and count), the lightest of what stands goes to a muster, which
// fans; only a row still full gathers all my mana into one well. Nothing shrinks; a pile holding something I can use says
// so (the scene's cue).
import type { ArrCard, Group, Policy, TierSpec } from "../contract";
import { PINNED, anyTapped, collect, creatureWeight, emphasisOf, factsOf, mattersOf, need, promoteRule, seatOf, tidyRule, topOf } from "./common";
import { kindOf } from "./kinds";
import { engine, noncreatureWeight } from "./works";

/**
 * One standing band: what stands, its muster, my works, and my mana by kind (rocks, utility lands, basics; all of it as one
 * well, last). A unit that is not presented lies in its place (a land, a rock, a work, a tapped creature turned a quarter);
 * its tier says what folds with what, and which side of the block it keeps to.
 */
export const MINE_TIERS: readonly TierSpec[] = [
  { id: "field", posture: "stand", markers: true },
  { id: "muster", posture: "stand", markers: true, proud: true },
  { id: "works", posture: "stand", markers: true, proud: true, from: "left" },
  { id: "rocks", posture: "stand", markers: true, from: "right" },
  { id: "lands", posture: "stand", markers: true, from: "right" },
  { id: "basics", posture: "stand", markers: true, from: "right" },
  { id: "mana", posture: "stand", markers: true, from: "right" },
];

/** My mana's tiers by kind, and the one they gather into when the row is still full. */
export const MANA_TIERS = ["rocks", "lands", "basics", "mana"] as const;

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
    if (stands(c)) return "field";
    if (kindOf(c) !== "mana") return "works";
    return !c.types.land ? "rocks" : c.supertypes.basic ? "basics" : "lands";
  },
  presented(g, ctx) {
    return !anyTapped(g, ctx) && g.members.every((id) => stands(need(ctx, id)));
  },
  top: topOf,
  ladder: [
    { op: "stack", where: { tokens: true, stacks: true } },
    { op: "stack", where: { tier: "works", stacks: true } },
    { op: "stack", where: { tier: "rocks", stacks: true } },
    { op: "stack", where: { tier: "lands", stacks: true } },
    { op: "fan", where: { tier: "works" }, show: 6 },
    { op: "fan", where: { tier: "rocks" }, show: 6 },
    { op: "fan", where: { tier: "lands" }, show: 6 },
    { op: "stack", where: { creatures: true, stacks: true } },
    { op: "demote", where: { tier: "field" }, to: "muster" },
    { op: "fan", where: { tier: "muster" }, show: 6 },
    { op: "fan", where: { tier: "mana", gather: ["rocks", "lands", "basics"] }, show: 6 },
    { op: "summary", where: { all: true } },
  ],
  matters: mattersOf,
  facts: (u, ctx) => factsOf(u, ctx, (MANA_TIERS as readonly string[]).includes(u.tier) ? u.tier : "mana"),
  seat: seatOf,
  emphasis: emphasisOf,
  acting: "in-place",
  tidy: tidyRule,
  promote: promoteRule,
};
