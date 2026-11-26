// `works` (§2.5): for a creature-light seat. The same rows as `ready-tapped`, so a swap keeps the leaf's shape; what
// changes is who earns a standing place. Engines (planeswalkers, battles, cards that bind the table, cards with
// counters, legendary noncreatures) stand and compete with bodies by their own weight; other noncreatures lie.
import type { ArrCard, Policy } from "../contract";
import { PINNED, anyTapped, creatureWeight, emphasisOf, factsOf, mattersOf, need, promoteRule, seatOf, tidyRule, topOf } from "./common";
import { kindOf } from "./kinds";
import { LEAF_TIERS, leafGroups } from "./ready-tapped";

/** A noncreature that earns a standing place on a creature-light seat. */
export const engine = (c: ArrCard): boolean => {
  const k = kindOf(c);
  return k === "planeswalker" || k === "battle" || (k === "works" && (c.reach === "table" || c.counters > 0 || c.supertypes.legendary));
};

/** A noncreature's weight on a creature-light seat. */
export const noncreatureWeight = (c: ArrCard): number =>
  (c.reach === "table" ? 4 : 0) + (c.types.planeswalker ? (c.loyalty ?? 0) + 3 : 0) + (c.counters > 0 ? 2 : 0) + (c.supertypes.legendary ? 1 : 0) + (c.token ? 0 : 1) + c.manaValue / 3;

export const works: Policy = {
  id: "works",
  tiers: LEAF_TIERS,
  group: leafGroups,
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
    if (c.commander) return "ready";
    const k = kindOf(c);
    if (k === "mana") return "lands";
    if (k === "creature" || engine(c)) return "ready";
    return "works";
  },
  presented(g, ctx) {
    if (anyTapped(g, ctx)) return false;
    return g.members.every((id) => {
      const c = need(ctx, id);
      return kindOf(c) === "creature" || engine(c) || (c.commander && kindOf(c) !== "mana");
    });
  },
  top: topOf,
  ladder: [
    { op: "split-spent", where: { tier: "ready", spent: true }, to: "rest" },
    { op: "stack", where: { tokens: true, stacks: true } },
    { op: "fan", where: { tier: "works" }, show: 6 },
    { op: "stack", where: { creatures: true, stacks: true } },
    { op: "demote", where: { tier: "ready" }, to: { creature: "rest", other: "works" } },
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
