// `ready-tapped` (§2.4): the commander and the heaviest groups stand, as many rows of them as the space holds (inside
// the turn horizon a tapped card makes a quarter turn; past it, a notch); behind them lie the rest of their creatures,
// their works and their lands as one block, in that order.
import type { ArrCard, Group, Policy, PolicyCtx, TierSpec } from "../contract";
import { PINNED, anyTapped, collect, creatureWeight, emphasisOf, factsOf, mattersOf, need, promoteRule, seatOf, tidyRule, topOf } from "./common";
import { kindOf } from "./kinds";

/** What is presented stands; behind it lie the rest, the works and the lands, in that order. How many rows each takes
 *  is the space's and the cards' (a leaf at turn 15 holds two standing rows; a deeper one would hold more). */
export const LEAF_TIERS: readonly TierSpec[] = [
  { id: "ready", posture: "stand", markers: true },
  { id: "rest", posture: "lie", markers: true, proud: true },
  { id: "works", posture: "lie", markers: true, proud: true },
  { id: "lands", posture: "lie", markers: true },
];

/** Groups (§2.4): the commander alone; a creature with dressing, a legendary creature, a planeswalker, a battle alone;
 *  other creatures by look, ready and spent apart; works by look and state; lands: theirs one well, mine by card. */
export function leafGroups(cards: readonly ArrCard[], ctx: PolicyCtx): Group[] {
  const groups = collect(cards, (c) => {
    if (c.commander) return `cmd:${c.id}`;
    const k = kindOf(c);
    if (k === "creature") return c.supertypes.legendary ? `one:${c.id}` : `cr:${c.lookKey}:${c.tapped ? "t" : "r"}`;
    if (k === "planeswalker" || k === "battle") return `one:${c.id}`;
    if (k === "mana") return ctx.mine ? `land:${c.cardKey}` : "well";
    return `wk:${c.lookKey}:${c.tapped ? "t" : "r"}`;
  });
  // Their lands are one block from the first land on; mine stack by kind.
  return groups.map((g) => (g.key === "well" || g.key.startsWith("land:") ? { ...g, stacks: true, squared: true } : g));
}

const binds = (c: ArrCard): boolean => c.reach === "table";

export const readyTapped: Policy = {
  id: "ready-tapped",
  tiers: LEAF_TIERS,
  group: leafGroups,
  importance(g, ctx) {
    const cs = g.members.map((id) => need(ctx, id)), c = cs[0]!;
    if (c.commander) return PINNED;
    switch (kindOf(c)) {
      case "creature":
        return creatureWeight(cs);
      case "planeswalker":
        return (c.loyalty ?? 0) + 3;
      case "battle":
        return (c.defense ?? 0) + 2;
      case "mana":
        return 0;
      case "works":
        return (binds(c) ? 3 : 0) + (c.counters > 0 ? 1 : 0) + (c.supertypes.legendary ? 1 : 0);
    }
  },
  tier(g, ctx) {
    const c = need(ctx, g.members[0]!);
    if (c.commander) return "ready";
    const k = kindOf(c);
    if (k === "mana") return "lands";
    if (k === "works") return binds(c) ? "ready" : "works";
    return "ready";
  },
  presented(g, ctx) {
    if (anyTapped(g, ctx)) return false;
    return g.members.every((id) => {
      const c = need(ctx, id), k = kindOf(c);
      return k === "creature" || k === "planeswalker" || k === "battle" || (k === "works" && (binds(c) || c.commander));
    });
  },
  top: topOf,
  ladder: [
    { op: "split-spent", where: { tier: "ready", spent: true }, to: "rest" },
    { op: "stack", where: { tier: "works", stacks: true } },
    { op: "stack", where: { tokens: true, stacks: true } },
    { op: "stack", where: { creatures: true, stacks: true } },
    { op: "demote", where: { tier: "ready" }, to: { creature: "rest", other: "works" } },
    { op: "fan", where: { tier: "works" }, show: 6 },
    { op: "fan", where: { tier: "rest" }, show: 6 },
    { op: "summary", where: { all: true } },
  ],
  matters: mattersOf,
  facts: (u, ctx) => factsOf(u, ctx, "lands"),
  seat: seatOf,
  emphasis: emphasisOf,
  acting: "in-place",
  tidy: tidyRule,
  promote: promoteRule,
};
