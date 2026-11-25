// A policy's intent is checked before the solver uses it (§2.2). A rejected intent makes the container fall back to
// `ready-tapped` for this plan and report why; nothing malformed reaches the solver.
import type { CardId } from "../types";
import type { ArrCard, Group, Policy, PolicyCtx, TierId } from "./contract";
import { kindOf } from "./policies/kinds";

export interface Intent {
  readonly groups: readonly Group[];
  readonly tier: ReadonlyMap<string, TierId>;
  readonly presented: ReadonlyMap<string, boolean>;
  readonly top: ReadonlyMap<string, CardId>;
  readonly importance: ReadonlyMap<string, number>;
}

/** Null when the groups are a partition of the cards (every card in exactly one, as member or dressing, no group empty,
 *  no key twice); else what is wrong. Checked before a policy is asked anything about a group. */
export function validateGroups(groups: readonly Group[], cards: readonly ArrCard[]): string | null {
  const all = new Set(cards.map((c) => c.id)), seen = new Set<CardId>(), keys = new Set<string>();
  for (const g of groups) {
    if (keys.has(g.key)) return `two groups share the key ${g.key}`;
    keys.add(g.key);
    if (!g.members.length) return `group ${g.key} is empty`;
    for (const id of [...g.members, ...g.dressing]) {
      if (!all.has(id)) return `group ${g.key} holds card ${id}, which is not in the container`;
      if (seen.has(id)) return `card ${id} is in two groups`;
      seen.add(id);
    }
  }
  return seen.size === all.size ? null : `${all.size - seen.size} cards are in no group`;
}

/** Null when the intent is sound; else what is wrong with it (the first problem found). */
export function validateIntent(policy: Policy, cards: readonly ArrCard[], intent: Intent, ctx: PolicyCtx): string | null {
  const tierIx = new Map(policy.tiers.map((t, i) => [t.id, i]));
  if (tierIx.size !== policy.tiers.length) return "two tiers share an id";
  if (!policy.tiers.length) return "no tiers";
  const seen = new Set<CardId>(), all = new Set(cards.map((c) => c.id)), keys = new Set<string>();
  for (const g of intent.groups) {
    if (keys.has(g.key)) return `two groups share the key ${g.key}`;
    keys.add(g.key);
    if (!g.members.length) return `group ${g.key} is empty`;
    for (const id of [...g.members, ...g.dressing]) {
      if (!all.has(id)) return `group ${g.key} holds card ${id}, which is not in the container`;
      if (seen.has(id)) return `card ${id} is in two groups`;
      seen.add(id);
    }
    const t = intent.tier.get(g.key);
    if (t === undefined || !tierIx.has(t)) return `group ${g.key} has an unknown tier ${String(t)}`;
    const top = intent.top.get(g.key);
    if (top === undefined || !g.members.includes(top)) return `group ${g.key}'s top is not a member`;
    const imp = intent.importance.get(g.key);
    if (imp === undefined || !Number.isFinite(imp)) return `group ${g.key} has no finite importance`;
    // The designer's posture constraints.
    const cs = g.members.map((id) => cards.find((c) => c.id === id)!);
    if (intent.presented.get(g.key)) {
      if (cs.some((c) => c.tapped)) return `group ${g.key} is presented with a tapped member`;
      if (cs.some((c) => kindOf(c) === "mana")) return `group ${g.key} presents a land or mana source`;
    } else if (ctx.mine && cs.every((c) => !c.tapped && (c.types.creature || c.types.planeswalker))) {
      return `my untapped creature or planeswalker group ${g.key} is not presented`;
    }
  }
  if (seen.size !== all.size) return `${all.size - seen.size} cards are in no group`;
  for (const s of policy.ladder) {
    if (s.op !== "demote" && s.op !== "split-spent") continue;
    const from = "tier" in s.where ? s.where.tier : undefined;
    const tos = typeof s.to === "string" ? [s.to] : [s.to.creature, s.to.other];
    for (const to of tos) {
      if (!tierIx.has(to)) return `a ${s.op} step goes to an unknown tier ${to}`;
      if (from !== undefined && (!tierIx.has(from) || tierIx.get(to)! <= tierIx.get(from)!)) return `a ${s.op} step goes from ${from} to ${to}, not a later tier`;
    }
  }
  for (const s of policy.ladder) if (s.op === "fan" && !(s.show >= 1)) return "a fan step shows no cards";
  return null;
}
