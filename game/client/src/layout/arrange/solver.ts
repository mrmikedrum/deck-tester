// `arrange` (§5): one container's cards, a policy's intent and the container's space in; a verified fit or a typed
// overflow out. The policy says what matters and how things may collapse; the solver says how much fits where, and it
// alone enforces the guarantees (§1.4). Pure and deterministic: cards are read in id order, nothing reads a clock.
import { designUnit } from "../types";
import type { CardId } from "../types";
import type {
  ArrCard,
  ArrUnit,
  ArrViolation,
  ArrangeInput,
  ArrangeResult,
  Arrangement,
  Attention,
  AttentionWhy,
  ContainerMemory,
  Cue,
  DraftUnit,
  EditRecord,
  FoldStep,
  Group,
  Overflow,
  PaintItem,
  PickTarget,
  Policy,
  PolicyCtx,
  PolicyMemory,
  Selector,
  SlotRef,
  TierId,
  UnitKey,
  UnitKind,
} from "./contract";
import { auditUnits } from "./audit";
import type { AuditUnit } from "./audit";
import { drawUnit } from "./draw";
import type { Drawn } from "./draw";
import { onFrame } from "./frame";
import { kindOf } from "./policies/kinds";
import { readyTapped } from "./policies/ready-tapped";
import { RowPlanner, bandsOf, placesOf } from "./rows";
import type { Band, RowGeo } from "./rows";
import { S_TABLE, SLOT, fanExtent } from "./scale";
import { validateIntent } from "./validate";

/** Audits after the first, each a band made one place tighter (§5.1 step 3). */
const RETRIES = 4;
const EPS = 1e-9;

// ---- the plan's groups ----------------------------------------------------------------------------------------------

interface G {
  readonly key: string;
  readonly members: readonly CardId[];
  readonly dressing: readonly CardId[];
  readonly stacks: boolean;
  readonly squared: boolean;
  /** Its tier by its current types, before any fold. */
  readonly base: TierId;
  readonly imp: number;
  readonly presented: boolean;
  /** Never folds: the commander, an acting card, a card whose types changed (until the re-sort). */
  readonly pinned: boolean;
  readonly acting: boolean;
  readonly retyped: boolean;
  readonly commander: boolean;
  readonly creature: boolean;
  readonly tokens: boolean;
  readonly allTapped: boolean;
  readonly anyUntapped: boolean;
  readonly name: string;
  readonly arrival: number;
  /** A retyped card's place from the last plan. */
  readonly prefer: { readonly tier: TierId; readonly slot: SlotRef | null } | null;
}

/** What the ladder has done to the groups so far. */
interface State {
  readonly tier: Map<string, TierId>;
  readonly stacked: Set<string>;
  readonly fan: Map<string, TierId>;
  readonly summary: Set<string>;
}

interface U extends DraftUnit {
  readonly imp: number;
  readonly pinned: boolean;
  readonly acting: boolean;
  readonly retyped: boolean;
  readonly stands: boolean;
  readonly width: number;
  readonly arrival: number;
  readonly prefer: G["prefer"];
}

interface Edit {
  readonly id: string;
  readonly index: number;
  readonly step: FoldStep;
  /** The group it takes (fan and summary take a tier's or everything at the time they run). */
  readonly group: string | null;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---- arrange --------------------------------------------------------------------------------------------------------

export function arrange(input: ArrangeInput): ArrangeResult {
  const c = input.container;
  const cards = [...input.cards].sort((a, b) => a.id - b.id);
  const byId = new Map(cards.map((x) => [x.id, x]));
  const mine = c.owner !== null && c.owner === c.viewer;
  const ctx: PolicyCtx = { viewer: c.viewer, owner: c.owner, mine, cards: byId, acting: input.acting, clock: input.clock };
  // One card size (§4): the table's mesh scale on the table and nearer alike.
  const s = S_TABLE;
  const u = designUnit(c.projector.viewport);

  // Arrivals: a card the container first sees arrives now, whatever its id (a permanent that changed controller too).
  const prevSeq = input.memory?.arrivals.seq ?? {};
  let next = input.memory?.arrivals.next ?? 0;
  const seq: Record<string, number> = {};
  for (const x of cards) seq[x.id] = prevSeq[x.id] ?? next++;

  // The policy's intent, validated; a rejected one falls back to ready-tapped for this plan.
  let policy = input.policy;
  let intent = intentOf(policy, cards, ctx, input.memory?.policies[policy.id] ?? null);
  const invalid = validateIntent(policy, cards, intent, ctx);
  if (invalid !== null) {
    if (policy.id === readyTapped.id) throw new Error(`ready-tapped's own intent is invalid: ${invalid}`);
    policy = readyTapped;
    intent = intentOf(policy, cards, ctx, input.memory?.policies[policy.id] ?? null);
  }
  const pm = input.memory?.policies[policy.id] ?? null;
  // Rows come from the space and the cards: bands of tiers, each taking the rows its units need (rows.ts).
  const bands = bandsOf(policy.tiers);
  const planner = new RowPlanner(c, s, u);
  const tierOf = new Map(policy.tiers.map((t) => [t.id, t]));
  const bandOf = new Map(bands.flatMap((b) => b.tiers.map((t) => [t.id, b] as const)));
  const standingTiers = policy.tiers.filter((t) => t.posture === "stand");
  const firstRow = bands.length ? planner.next(null, bands[0]!) : null;

  // Precondition (§1.1): the frame holds a tap patch at its anchor, on the safe area and off the keepouts.
  const at = c.projector.project(onFrame(c.frame, 0, SLOT.margin));
  const blocked = c.keepouts.some((k) => k.on === "screen" && at.x >= k.rect.left && at.x <= k.rect.right && at.y >= k.rect.top && at.y <= k.rect.bottom);
  if (blocked || at.x < c.safe.left || at.x > c.safe.right || at.y < c.safe.top || at.y > c.safe.bottom || !firstRow)
    return containerOverflow(input, policy, cards, seq, next, invalid);

  // ---- groups: the policy's, with acting cards and retyped cards out of theirs ----
  let groups = planGroups(policy, intent, byId, ctx, input, pm, standingTiers.map((t) => t.id), seq, true);

  // ---- the re-sort ----
  const ranking = groups.filter((g) => standingTiers.some((t) => t.id === g.base) && !g.acting).sort((a, b) => b.imp - a.imp || cmp(a.key, b.key));
  const incumbentKeys = new Set(groups.filter((g) => g.members.some((id) => standingTiers.some((t) => t.id === pm?.tiers[pm.held[id] ?? ""]))).map((g) => g.key));
  const front = new Set(ranking.slice(0, firstRow?.grid ? placesOf(firstRow) : 0).map((g) => g.key));
  const changed =
    groups.some((g) => g.retyped) ||
    ranking.some((ch) => !incumbentKeys.has(ch.key) && front.has(ch.key) && ranking.some((inc) => incumbentKeys.has(inc.key) && !front.has(inc.key) && policy.promote(inc.imp, ch.imp)));
  const tidy = policy.tidy(input.clock, pm?.tidy ?? null, changed);
  // A re-sort is when a card whose types changed walks to its new row.
  if (tidy && groups.some((g) => g.retyped)) groups = planGroups(policy, intent, byId, ctx, input, pm, standingTiers.map((t) => t.id), seq, false);
  const gByKey = new Map(groups.map((g) => [g.key, g]));

  // ---- the compiled edit list (§5.1 step 1) ----
  const edits = compile(policy, groups, tidy ? new Set() : incumbentKeys);
  const held = new Set(pm?.folds ?? []);

  // ---- walk, draw, audit; a failing band folds one place tighter, at most RETRIES times ----
  let tight = new Map<number, number>();
  let best: Candidate | null = null, audits = 0, candidates = 0;
  for (let attempt = 0; attempt <= RETRIES + 1; attempt++) {
    const forceSummary = attempt === RETRIES + 1;
    const walked = walk(policy, groups, gByKey, edits, bands, bandOf, planner, tierOf, held, tight, input.clock.settling, s, forceSummary);
    candidates += walked.estimates;
    const cand = place(input, policy, ctx, bands, planner, tight, walked, pm, tidy, s, u);
    audits += 1;
    if (!best || cand.violations.length < best.violations.length) best = cand;
    // Only crowding is folding's to fix: a patch taken or a strip covered. A floor or a stray region is geometry.
    const crowded = cand.violations.filter((v) => v.rule === "tap-patch" || v.rule === "covers-name" || v.rule === "covers-foot");
    if (!crowded.length) break;
    const bad = new Set(crowded.map((v) => cand.bandOfUnit.get(v.unit)).filter((r): r is number => r !== undefined));
    if (!bad.size) break;
    tight = new Map(tight);
    for (const r of bad) tight.set(r, (tight.get(r) ?? 0) + 1);
  }
  const cand = best!;

  // ---- poses: the same arrangement, slid along `away` (nothing changes; the audit says what holds) ----
  const poses = c.poses.map((p) => ({ id: p.id, violations: auditAt(input, cand, s, u, p.shift) }));

  // ---- memory out ----
  const memory: ContainerMemory = {
    v: 2,
    container: c.id,
    selection: input.memory?.selection.policy === policy.id ? input.memory.selection : { policy: policy.id, since: input.clock.turn },
    arrivals: { next, seq },
    policies: { ...(input.memory?.policies ?? {}), [policy.id]: cand.memory(ranking.map((g) => g.key), tidy) },
  };

  // Cards no place could hold are reached through the entry, and said: actors past every place (a focus shows them), or
  // a container whose space ran out.
  const spaceCards = [...new Set([...cand.unplaced.other, ...cand.violations.flatMap((v) => cand.units.find((x) => x.id === v.unit)?.members ?? [])])].sort((a, b) => a - b);
  const overflow: Overflow | null = cand.unplaced.actors.length
    ? { reason: "actors", cards: [...new Set([...cand.unplaced.actors, ...spaceCards])].sort((a, b) => a - b), ask: { kind: "focus", role: "spread" } }
    : spaceCards.length
      ? { reason: "space", cards: spaceCards, ask: { kind: "entry" } }
      : null;

  const fit: Arrangement = {
    container: c.id,
    policy: policy.id,
    frame: c.frame,
    step: 1,
    scale: s,
    rows: cand.rows.map((r) => ({ tiers: r.band.tiers.map((t) => t.id), quarter: r.quarter, v: r.v, posture: r.posture, intervals: r.intervals, places: r.grid ? placesOf(r) : Math.floor(r.intervals.reduce((t, iv) => t + iv.hi - iv.lo, 0) / r.base + EPS) })),
    units: cand.units,
    paint: cand.paint,
    targets: cand.targets,
    home: new Map(cand.units.flatMap((x) => [...x.members, ...x.dressing].map((id) => [id, x.id] as const))),
    pages: null,
    attention: cand.attention,
    seat: policy.seat ? policy.seat(cand.drafts, ctx) : null,
    used: cand.used,
    report: { edits: cand.edits, candidates, audits, policyInvalid: invalid, violations: cand.violations, poses },
    memory,
  };
  return overflow ? { fit, overflow } : { fit, overflow: null };
}

// ---- intent and groups ----------------------------------------------------------------------------------------------

function intentOf(policy: Policy, cards: readonly ArrCard[], ctx: PolicyCtx, pm: PolicyMemory | null) {
  const groups = policy.group(cards, ctx);
  const tier = new Map<string, TierId>(), presented = new Map<string, boolean>(), top = new Map<string, CardId>(), importance = new Map<string, number>();
  for (const g of groups) {
    tier.set(g.key, policy.tier(g, ctx));
    presented.set(g.key, policy.presented(g, ctx));
    top.set(g.key, policy.top(g, pm?.tops[`g:${g.key}`] ?? null, ctx));
    importance.set(g.key, policy.importance(g, ctx));
  }
  return { groups, tier, presented, top, importance };
}

function planGroups(
  policy: Policy,
  intent: ReturnType<typeof intentOf>,
  byId: ReadonlyMap<CardId, ArrCard>,
  ctx: PolicyCtx,
  input: ArrangeInput,
  pm: PolicyMemory | null,
  standing: readonly TierId[],
  seq: Readonly<Record<string, number>>,
  retype: boolean,
): G[] {
  const out: G[] = [];
  const acting = input.acting.involved;
  const firstStanding = standing[0] ?? policy.tiers[0]!.id;
  const make = (g: Group, base: TierId, extra: Partial<G>): G => {
    const cs = g.members.map((id) => byId.get(id)!);
    return {
      key: g.key,
      members: g.members,
      dressing: g.dressing,
      stacks: g.stacks && g.members.length > 1,
      squared: !!g.squared,
      base,
      imp: intent.importance.get(g.key) ?? 0,
      presented: intent.presented.get(g.key) ?? false,
      pinned: false,
      acting: false,
      retyped: false,
      commander: cs.some((x) => x.commander),
      creature: cs.every((x) => kindOf(x) === "creature"),
      tokens: cs.every((x) => x.token),
      allTapped: cs.every((x) => x.tapped),
      anyUntapped: cs.some((x) => !x.tapped),
      name: cs[0]!.cardKey,
      arrival: Math.min(...g.members.map((id) => seq[id] ?? 0)),
      prefer: null,
      ...extra,
    };
  };
  for (const g of intent.groups) {
    const base = intent.tier.get(g.key)!;
    const top = intent.top.get(g.key)!;
    // the members ordered top first
    const members = [top, ...g.members.filter((id) => id !== top)];
    const dressedBy = (id: CardId) => g.dressing.filter((d) => byId.get(d)?.attachedTo === id);
    const out1: CardId[] = [];
    for (const id of members) {
      const x = byId.get(id)!;
      // An acting card leaves its unit and stands, out of any pile (§2.7).
      if (acting.has(id)) {
        const own: Group = { key: `act:${id}`, members: [id], dressing: dressedBy(id), stacks: false };
        const t = intent.tier.get(g.key)!;
        out.push(make(own, standing.includes(t) ? t : firstStanding, { pinned: true, acting: true, presented: true, imp: intent.importance.get(g.key) ?? 0 }));
        continue;
      }
      // A card whose tier changed with its types stays where it was as its own unit, standing or lying by what it is now,
      // until the next re-sort walks it to its new row (designer §5).
      const was = pm?.bases[id];
      const heldKey = pm?.held[id];
      if (retype && was !== undefined && was !== base && heldKey !== undefined) {
        const tierWas = pm!.tiers[heldKey];
        if (tierWas !== undefined && policy.tiers.some((t) => t.id === tierWas)) {
          const own: Group = { key: `re:${id}`, members: [id], dressing: dressedBy(id), stacks: false };
          const now = policy.presented({ ...own, dressing: [] }, ctx) && !x.tapped && kindOf(x) !== "mana";
          out.push(make(own, tierWas, { pinned: true, retyped: true, presented: now, prefer: { tier: tierWas, slot: pm!.slots[heldKey] ?? null } }));
          continue;
        }
      }
      out1.push(id);
    }
    if (out1.length) {
      const dressing = g.dressing.filter((d) => out1.includes(byId.get(d)!.attachedTo as CardId) || !members.includes(byId.get(d)!.attachedTo as CardId));
      const kept: Group = { ...g, members: out1, dressing };
      const cmd = out1.some((id) => byId.get(id)!.commander);
      out.push(make(kept, base, { pinned: cmd }));
    }
  }
  return out.sort((a, b) => cmp(a.key, b.key));
}

// ---- the compiled edit list -----------------------------------------------------------------------------------------

/** Which tiers a group might be in when a step runs: its base, or one a demote or split could send it to. */
function compile(policy: Policy, groups: readonly G[], incumbents: ReadonlySet<string>): Edit[] {
  const out: Edit[] = [];
  const free = groups.filter((g) => !g.pinned);
  policy.ladder.forEach((step, index) => {
    if (step.op === "fan") return void out.push({ id: `${index}:fan:${"tier" in step.where ? step.where.tier : "*"}`, index, step, group: null });
    if (step.op === "summary") return void out.push({ id: `${index}:summary`, index, step, group: null });
    // ascending importance (ties by key); a demote keeps incumbents past the promotion margin
    const asc = [...free].sort((a, b) => a.imp - b.imp || cmp(a.key, b.key));
    const order = step.op === "demote" ? weakestFirst(asc, incumbents, policy) : asc;
    for (const g of order) out.push({ id: `${index}:${step.op}:${g.key}`, index, step, group: g.key });
  });
  return out;
}

/** The order a demote takes groups in: the weakest challenger, unless it outranks the weakest incumbent past the margin. */
function weakestFirst(asc: readonly G[], incumbents: ReadonlySet<string>, policy: Policy): G[] {
  const ch = asc.filter((g) => !incumbents.has(g.key)), inc = asc.filter((g) => incumbents.has(g.key)), out: G[] = [];
  while (ch.length || inc.length) {
    const a = ch[0], b = inc[0];
    if (a && (!b || !policy.promote(b.imp, a.imp))) out.push(ch.shift()!);
    else out.push(inc.shift()!);
  }
  return out;
}

function matches(sel: Selector, g: G, tier: TierId, groups: readonly G[], st: State): boolean {
  if ("all" in sel) return true;
  if (sel.tier !== undefined && tier !== sel.tier) return false;
  if (sel.stacks && !g.stacks) return false;
  if (sel.tokens && !g.tokens) return false;
  if (sel.creatures !== undefined && sel.creatures !== g.creature) return false;
  if (sel.spent) {
    if (!g.allTapped || !g.stacks && g.members.length > 1) return false;
    // a sibling of the same card, with one untapped, in the same tier
    if (!groups.some((o) => o !== g && o.name === g.name && o.anyUntapped && (st.tier.get(o.key) ?? o.base) === tier)) return false;
  }
  return true;
}

interface Walked {
  readonly groups: readonly G[];
  readonly st: State;
  readonly records: EditRecord[];
  readonly ran: string[];
  readonly estimates: number;
}

/**
 * Walk the edit list once, in order (§5.1 step 2): an edit runs only while the band it frees still overflows the rows
 * the space gives it (with a whole place to spare for a fold that ran last plan, so folds do not flicker); each is
 * consumed once.
 */
function walk(
  policy: Policy,
  groups: readonly G[],
  gByKey: ReadonlyMap<string, G>,
  edits: readonly Edit[],
  bands: readonly Band[],
  bandOf: ReadonlyMap<TierId, Band>,
  planner: RowPlanner,
  tierOf: ReadonlyMap<TierId, Policy["tiers"][number]>,
  held: ReadonlySet<string>,
  tight: ReadonlyMap<number, number>,
  settling: boolean,
  s: number,
  forceSummary: boolean,
): Walked {
  const st: State = { tier: new Map(groups.map((g) => [g.key, g.base])), stacked: new Set(groups.filter((g) => g.squared).map((g) => g.key)), fan: new Map(), summary: new Set() };
  const records: EditRecord[] = [], ran: string[] = [];
  let estimates = 0;
  // Which bands overflow, now, with `slack` places held back from the band `held` names.
  const over = (band: Band | null, slack: boolean): boolean => {
    estimates++;
    const laid = lay(bands, planner, draftUnits(policy, groups, st, tierOf, s), tight, slack && band ? band.index : null);
    return band ? laid.over.has(band.index) : laid.over.size > 0;
  };
  for (const e of edits) {
    const step = e.step;
    let target: Band | null = null, groupsHit: string[];
    if (e.group !== null) {
      const g = gByKey.get(e.group)!;
      const tier = st.tier.get(g.key)!;
      if (st.summary.has(g.key) || st.fan.has(g.key)) continue;
      if (!matches(step.where, g, tier, groups, st)) continue;
      if (step.op === "stack" && (st.stacked.has(g.key) || !g.stacks)) continue;
      target = bandOf.get(tier)!;
      groupsHit = [g.key];
    } else if (step.op === "fan") {
      const tier = "tier" in step.where ? step.where.tier : undefined;
      if (tier === undefined) continue;
      groupsHit = groups.filter((g) => !g.pinned && st.tier.get(g.key) === tier && !st.summary.has(g.key) && !st.fan.has(g.key)).map((g) => g.key);
      if (groupsHit.reduce((t, k) => t + gByKey.get(k)!.members.length, 0) < 2) continue;
      target = bandOf.get(tier) ?? null;
      if (!target) continue;
    } else {
      groupsHit = groups.filter((g) => !g.pinned && !st.summary.has(g.key)).map((g) => g.key);
      if (!groupsHit.length) continue;
    }
    const wasHeld = held.has(e.id);
    const need = forceSummary && step.op === "summary" ? true : settling && wasHeld ? true : over(target, wasHeld);
    records.push({ index: e.index, op: step.op, groups: groupsHit, ran: need });
    if (!need) continue;
    ran.push(e.id);
    for (const k of groupsHit) {
      // spent copies leave as a sibling stack, with their own count
      if (step.op === "split-spent") {
        st.tier.set(k, step.to);
        if (gByKey.get(k)!.stacks) st.stacked.add(k);
      }
      else if (step.op === "demote") st.tier.set(k, typeof step.to === "string" ? step.to : gByKey.get(k)!.creature ? step.to.creature : step.to.other);
      else if (step.op === "stack") st.stacked.add(k);
      else if (step.op === "fan") st.fan.set(k, st.tier.get(k)!);
      else st.summary.add(k);
    }
  }
  return { groups, st, records, ran, estimates };
}

// ---- units ----------------------------------------------------------------------------------------------------------

const FAN_SHOW = 6;

function draftUnits(policy: Policy, groups: readonly G[], st: State, tierOf: ReadonlyMap<TierId, Policy["tiers"][number]>, s: number): U[] {
  const out: U[] = [];
  const fans = new Map<TierId, G[]>(), summary: G[] = [];
  const showOf = (t: TierId): number => {
    const f = policy.ladder.find((x) => x.op === "fan" && "tier" in x.where && x.where.tier === t);
    return f && f.op === "fan" ? f.show : FAN_SHOW;
  };
  const lying = (t: TierId) => tierOf.get(t)?.posture === "lie";
  for (const g of groups) {
    if (st.summary.has(g.key)) {
      summary.push(g);
      continue;
    }
    const tier = st.tier.get(g.key)!;
    const f = st.fan.get(g.key);
    if (f !== undefined) {
      fans.set(f, [...(fans.get(f) ?? []), g]);
      continue;
    }
    const common = { tier, imp: g.imp, pinned: g.pinned, acting: g.acting, retyped: g.retyped, arrival: g.arrival, prefer: g.prefer, groups: [g.key] };
    // It stands where its tier stands (or it acts, or its types just changed where it lies); demoted, it lies.
    const stands = g.presented && (!lying(tier) || g.acting || g.retyped);
    if (st.stacked.has(g.key)) {
      const kind: UnitKind = g.members.length > 1 ? "stack" : "card";
      out.push({ ...common, key: `s${g.key}`, kind, members: g.members, dressing: g.dressing, stands, width: SLOT.lie * s });
    } else
      for (const id of g.members)
        out.push({ ...common, key: `c${id}`, kind: "card", members: [id], dressing: g.dressing.filter((d) => dressedOn(g, d, id)), stands, width: SLOT.lie * s });
  }
  for (const [tier, gs] of fans) {
    const sorted = [...gs].sort((a, b) => b.imp - a.imp || cmp(a.key, b.key));
    const members = sorted.flatMap((g) => g.members);
    const n = Math.min(members.length, showOf(tier));
    out.push({
      key: `f${tier}`,
      kind: members.length > 1 ? "fan" : "card",
      tier,
      members,
      dressing: sorted.flatMap((g) => g.dressing),
      groups: sorted.map((g) => g.key),
      imp: Math.max(...sorted.map((g) => g.imp)),
      pinned: false,
      acting: false,
      retyped: false,
      stands: false,
      width: Math.max(SLOT.lie, fanExtent(n)) * s,
      arrival: Math.min(...sorted.map((g) => g.arrival)),
      prefer: null,
    });
  }
  if (summary.length) {
    const sorted = [...summary].sort((a, b) => b.imp - a.imp || cmp(a.key, b.key));
    // The last resort sits at the anchor (designer §7.2): the first tier, whose first row the container always has.
    out.push({
      key: "sum",
      kind: "summary",
      tier: policy.tiers[0]!.id,
      members: sorted.flatMap((g) => g.members),
      dressing: sorted.flatMap((g) => g.dressing),
      groups: sorted.map((g) => g.key),
      imp: Math.max(...sorted.map((g) => g.imp)),
      pinned: false,
      acting: false,
      retyped: false,
      stands: false,
      width: SLOT.lie * s,
      arrival: Math.min(...sorted.map((g) => g.arrival)),
      prefer: null,
    });
  }
  return out.sort((a, b) => cmp(a.key, b.key));
}

/** The dressing of one member of an unstacked group: what is attached to it (a host's card; others' strays to the first). */
const dressedOn = (g: G, d: CardId, id: CardId): boolean => (g.members.length === 1 ? true : g.members[0] === id ? true : false) && d !== id;

/** What the space gives each band for these units: its rows, and whether its units overflow them. */
interface Laid {
  readonly rows: RowGeo[];
  readonly byBand: Map<number, RowGeo[]>;
  readonly over: Set<number>;
}

/**
 * Lay the rows (§5.2): bands in order from the anchor edge, each taking rows while its units do not fit them and the
 * space has another, keeping room for the first row of every later band that holds something. `tight` holds back places
 * from a band an audit found crowded; `slackFor` holds back one more (a fold's deadband).
 */
function lay(bands: readonly Band[], planner: RowPlanner, units: readonly U[], tight: ReadonlyMap<number, number>, slackFor: number | null): Laid {
  const per = bands.map((b) => units.filter((x) => b.tiers.some((t) => t.id === x.tier)));
  const rows: RowGeo[] = [], byBand = new Map<number, RowGeo[]>(), over = new Set<number>();
  let prev: RowGeo | null = null;
  const roomAfter = (row: RowGeo, later: readonly Band[]): boolean => {
    let p: RowGeo | null = row;
    for (const b of later) if (!(p = planner.next(p, b))) return false;
    return true;
  };
  for (const b of bands) {
    const mine = per[b.index]!, got: RowGeo[] = [];
    byBand.set(b.index, got);
    if (!mine.length) continue;
    const later = bands.slice(b.index + 1).filter((x) => per[x.index]!.length);
    const less = (tight.get(b.index) ?? 0) + (slackFor === b.index ? 1 : 0);
    while (!(got.length && fitsBand(b, mine, got, less))) {
      const next: RowGeo | null = planner.next(prev, b);
      if (!next || (got.length && !roomAfter(next, later))) break;
      got.push(next);
      prev = next;
    }
    if (!fitsBand(b, mine, got, less)) over.add(b.index);
    rows.push(...got);
  }
  return { rows, byBand, over };
}

const span = (x: U, row: RowGeo): number => Math.max(1, Math.ceil(x.width / row.base - EPS));

function fitsBand(b: Band, units: readonly U[], rows: readonly RowGeo[], less: number): boolean {
  if (!rows.length) return !units.length;
  if (b.posture === "stand") return units.reduce((t, x) => t + span(x, rows[0]!), 0) <= rows.reduce((t, r) => t + placesOf(r), 0) - less;
  return packBand(rows, ordered(b, units), less * rows[0]!.base) !== null;
}

/** A lying band's units in their tier order, then the heaviest first. */
function ordered(b: Band, units: readonly U[]): U[] {
  const ix = new Map(b.tiers.map((t, i) => [t.id, i]));
  return [...units].sort((a, c) => ix.get(a.tier)! - ix.get(c.tier)! || Number(c.retyped) - Number(a.retyped) || c.imp - a.imp || cmp(a.key, c.key));
}

interface Packed {
  readonly key: string;
  readonly row: RowGeo;
  /** The row within its band. */
  readonly k: number;
  readonly interval: number;
  readonly place: number;
  readonly u: number;
  readonly w: number;
}

/** Pack units left to right across a lying band's rows and their intervals, each run centred; null when they do not
 *  fit. `less` world units of room are held back from the first interval. */
function packBand(rows: readonly RowGeo[], units: readonly U[], less = 0): Packed[] | null {
  const spans = rows.flatMap((row, k) => row.intervals.map((iv, interval) => ({ row, k, interval, lo: iv.lo, hi: iv.hi })));
  const runs: U[][] = spans.map(() => []), used = spans.map(() => 0);
  let i = 0, budget = less;
  for (const x of units) {
    while (i < spans.length && x.width > spans[i]!.hi - spans[i]!.lo - used[i]! - budget + EPS) {
      i++;
      budget = 0;
    }
    if (i >= spans.length) return null;
    runs[i]!.push(x);
    used[i]! += x.width;
  }
  const out: Packed[] = [];
  runs.forEach((run, n) => {
    const sp = spans[n]!;
    let u0 = (sp.lo + sp.hi) / 2 - used[n]! / 2;
    run.forEach((x, p) => {
      out.push({ key: x.key, row: sp.row, k: sp.k, interval: sp.interval, place: p, u: u0 + x.width / 2, w: x.width });
      u0 += x.width;
    });
  });
  return out;
}

// ---- placing, drawing, auditing one candidate -----------------------------------------------------------------------

interface Candidate {
  readonly units: ArrUnit[];
  readonly drafts: DraftUnit[];
  readonly paint: PaintItem[];
  readonly targets: PickTarget[];
  readonly attention: Attention[];
  readonly violations: ArrViolation[];
  /** Cards no place could hold: acting, the commander or a retyped card (past every place), or anything else. */
  readonly unplaced: { readonly actors: CardId[]; readonly other: CardId[] };
  readonly bandOfUnit: ReadonlyMap<string, number>;
  readonly rows: readonly RowGeo[];
  readonly edits: EditRecord[];
  readonly used: Arrangement["used"];
  /** What is drawn, per unit id, for a pose's audit. */
  readonly placed: readonly { readonly unit: ArrUnit; readonly row: RowGeo; readonly u: number; readonly w: number; readonly stands: boolean }[];
  memory(ranking: readonly string[], tidy: boolean): PolicyMemory;
}

function place(input: ArrangeInput, policy: Policy, ctx: PolicyCtx, bands: readonly Band[], planner: RowPlanner, tight: ReadonlyMap<number, number>, walked: Walked, pm: PolicyMemory | null, tidy: boolean, s: number, du: number): Candidate {
  const c = input.container;
  const tierOf = new Map(policy.tiers.map((t) => [t.id, t]));
  const all = draftUnits(policy, walked.groups, walked.st, tierOf, s);
  const laid = lay(bands, planner, all, tight, null);
  const slots = new Map<string, { row: RowGeo; band: Band; ref: SlotRef; u: number; w: number }>();
  const actors: CardId[] = [], other: CardId[] = [];
  for (const b of bands) {
    const rows = laid.byBand.get(b.index)!;
    const here = all.filter((x) => b.tiers.some((t) => t.id === x.tier));
    if (!here.length) continue;
    if (b.posture === "stand") {
      const placed = gridPlace(rows, here, pm, tidy);
      for (const [k, v] of placed.at) slots.set(k, { band: b, ...v });
      for (const x of placed.left) (x.pinned ? actors : other).push(...x.members, ...x.dressing);
    } else {
      const units = ordered(b, here);
      let n = units.length;
      while (n > 0 && packBand(rows, units.slice(0, n)) === null) n--;
      for (const p of packBand(rows, units.slice(0, n)) ?? []) slots.set(p.key, { row: p.row, band: b, ref: { row: p.k, interval: p.interval, place: p.place }, u: p.u, w: p.w });
      for (const x of here) if (!slots.has(x.key)) (x.pinned ? actors : other).push(...x.members, ...x.dressing);
    }
  }

  // ---- lineage: stable ids across splits and merges (§3) ----
  const ids = lineage(all, pm);

  // ---- draw ----
  const cardOf = (id: CardId) => ctx.cards.get(id)!;
  const drawn = new Map<string, Drawn>();
  for (const x of all) {
    const sl = slots.get(x.key);
    if (!sl) continue;
    drawn.set(x.key, drawUnit(c, c.frame, sl.row, { kind: x.kind, members: x.members, dressing: x.dressing, tapped: (id) => cardOf(id).tapped, stands: x.stands, show: FAN_SHOW, u: sl.u, w: sl.w }, s));
  }
  // paint: far first, then each unit's own layers; markers over their unit's cards
  const order = [...all].filter((x) => drawn.has(x.key)).sort((a, b) => drawn.get(b.key)!.depth - drawn.get(a.key)!.depth || cmp(a.key, b.key));
  const paint: PaintItem[] = [];
  const paintIx = new Map<string, number>();
  const facesPainted = new Map<string, { quad: ArrUnit["cards"][number]["quad"]; paint: number }[]>();
  for (const x of order) {
    const d = drawn.get(x.key)!, id = ids.get(x.key)!;
    const fs: { quad: ArrUnit["cards"][number]["quad"]; paint: number }[] = [];
    for (const cp of d.cards) {
      fs.push({ quad: cp.quad, paint: paint.length });
      paint.push({ kind: "card", unit: id, card: cp.card });
    }
    paintIx.set(x.key, paint.length - 1);
    if (d.marker) paint.push({ kind: "marker", unit: id });
    facesPainted.set(x.key, fs);
  }

  // ---- hidden cards, attention, notable ----
  const attention: Attention[] = [];
  const notable = new Map<string, { card: CardId; cue: Cue }[]>();
  const groupImp = new Map<CardId, number>();
  for (const x of all) for (const id of x.members) groupImp.set(id, x.imp);
  for (const x of all) {
    const hidden = hiddenOf(x);
    const why = new Map<AttentionWhy, CardId[]>();
    for (const id of hidden) {
      const card = cardOf(id);
      const w = input.acting.offered.has(id) ? "offered" : x.kind === "stack" ? null : policy.matters(card, input.moment, ctx);
      if (w) why.set(w, [...(why.get(w) ?? []), id]);
    }
    const unitId = drawn.has(x.key) ? ids.get(x.key)! : c.entry;
    for (const [w, cs] of [...why.entries()].sort((a, b) => cmp(a[0], b[0]))) attention.push({ unit: unitId, cards: cs, why: w });
    if (x.kind === "fan" || x.kind === "summary") {
      const ranked = [...why.entries()].flatMap(([w, cs]) => cs.map((id) => ({ id, w }))).sort((a, b) => (groupImp.get(b.id) ?? 0) - (groupImp.get(a.id) ?? 0) || a.id - b.id);
      notable.set(x.key, ranked.slice(0, 2).map((r) => ({ card: r.id, cue: cueOf(r.w) })));
    }
  }
  // cards nobody could place: reached through the entry, and never silently
  const off = [...actors, ...other].filter((id) => input.acting.offered.has(id) || input.acting.involved.has(id));
  if (off.length) attention.push({ unit: c.entry, cards: off, why: input.acting.offered.has(off[0]!) ? "offered" : "aimed" });

  // ---- units out ----
  const units: ArrUnit[] = [];
  const drafts: DraftUnit[] = all.map((x) => ({ key: x.key, kind: x.kind, tier: x.tier, members: x.members, dressing: x.dressing, groups: x.groups }));
  for (const x of order) {
    const d = drawn.get(x.key)!, sl = slots.get(x.key)!, id = ids.get(x.key)!;
    const draft = drafts.find((y) => y.key === x.key)!;
    const em = policy.emphasis(draft, input.moment, ctx);
    units.push({
      id,
      key: x.key,
      lineage: lineageOf(x, pm, ids),
      kind: x.kind,
      tier: x.tier,
      slot: sl.ref,
      members: x.members,
      top: x.members[0] ?? null,
      dressing: x.dressing,
      cards: d.cards,
      marker: d.marker,
      facts: policy.facts(draft, ctx),
      caption: null,
      emphasis: em.emphasis,
      lit: em.lit,
      acting: x.acting,
      notable: notable.get(x.key) ?? [],
      retyped: x.retyped,
    });
  }

  // ---- targets: a card's place is its target (§1.6) ----
  const targets: PickTarget[] = units.map((un) => {
    return { id: un.id, piece: un.id, region: drawn.get(un.key)!.region, order: paintIx.get(un.key)!, members: [...un.members, ...un.dressing], action: actionOf(input, ctx, un) };
  });
  targets.sort((a, b) => b.order - a.order);

  // ---- the audit ----
  const audited: AuditUnit[] = units.map((un) => {
    const d = drawn.get(un.key)!;
    return {
      id: un.id,
      face: d.face,
      scale: s,
      creature: d.face ? cardOf(d.face.card).types.creature : false,
      region: d.region,
      order: paintIx.get(un.key)!,
      faces: facesPainted.get(un.key)!,
      paint: facesPainted.get(un.key)!.at(-1)?.paint ?? 0,
    };
  });
  const violations = auditUnits(c, audited, du);
  const bandOfUnit = new Map(units.map((un) => [un.id, slots.get(un.key)!.band.index]));

  // ---- used bounds ----
  const us = [...slots.values()];
  const frameRect = us.length
    ? { left: Math.min(...us.map((x) => x.u - x.w / 2)), right: Math.max(...us.map((x) => x.u + x.w / 2)), top: Math.min(...us.map((x) => x.row.v - x.row.strip)), bottom: Math.max(...us.map((x) => x.row.v + x.row.depth + x.row.proud)) }
    : { left: 0, right: 0, top: 0, bottom: 0 };
  const pts = targets.flatMap((t) => t.region);
  const screenRect = pts.length
    ? { left: Math.min(...pts.map((p) => p.x)), right: Math.max(...pts.map((p) => p.x)), top: Math.min(...pts.map((p) => p.y)), bottom: Math.max(...pts.map((p) => p.y)) }
    : { left: 0, right: 0, top: 0, bottom: 0 };

  const placedList = order.map((x) => ({ unit: units.find((un) => un.key === x.key)!, row: slots.get(x.key)!.row, u: slots.get(x.key)!.u, w: slots.get(x.key)!.w, stands: x.stands }));

  return {
    units,
    drafts,
    paint,
    targets,
    attention,
    violations,
    unplaced: { actors: [...new Set(actors)].sort((a, b) => a - b), other: [...new Set(other)].sort((a, b) => a - b) },
    bandOfUnit,
    rows: laid.rows,
    edits: walked.records,
    used: { frame: frameRect, screen: screenRect },
    placed: placedList,
    memory(ranking, didTidy) {
      const slotsOut: Record<UnitKey, SlotRef> = {}, lin: Record<UnitKey, string> = {}, tops: Record<string, CardId> = {}, tiers: Record<UnitKey, TierId> = {}, heldOut: Record<string, UnitKey> = {}, bases: Record<string, TierId> = {};
      for (const un of units) {
        slotsOut[un.key] = un.slot;
        lin[un.key] = un.id;
        tiers[un.key] = un.tier;
        if (un.top !== null) tops[un.key] = un.top;
        for (const id of [...un.members, ...un.dressing]) heldOut[id] = un.key;
      }
      for (const g of walked.groups) {
        tops[`g:${g.key.replace(/^(act|re):/, "")}`] ??= g.members[0]!;
        // a retyped card keeps its old seat until it moves; everything else is seated by what it is now
        for (const id of [...g.members, ...g.dressing]) bases[id] = g.retyped ? (pm?.bases[id] ?? g.base) : g.base;
      }
      return {
        step: 1,
        page: 0,
        slots: slotsOut,
        lineage: lin,
        tops,
        tiers,
        bases,
        held: heldOut,
        folds: walked.ran,
        edits: walked.ran.length,
        tidy: didTidy ? { turn: input.clock.turn, phase: input.clock.phase, ranking } : (pm?.tidy ?? null),
      };
    },
  };
}

/**
 * Places in a standing band, its nearest row first, each row's intervals nearest the middle first, each interval's
 * places centre-out. A re-sort deals the band by rank (the commander first); otherwise a unit keeps its place while it
 * lasts, a retyped card takes its old place where free, and a newcomer the first free place.
 */
function gridPlace(rows: readonly RowGeo[], units: readonly U[], pm: PolicyMemory | null, tidy: boolean): { at: Map<string, { row: RowGeo; ref: SlotRef; u: number; w: number }>; left: U[] } {
  const at = new Map<string, { row: RowGeo; ref: SlotRef; u: number; w: number }>();
  const mid = (r: RowGeo, i: number) => Math.abs((r.intervals[i]!.lo + r.intervals[i]!.hi) / 2);
  const free = rows.flatMap((row, k) =>
    row.places
      .flatMap((ps, interval) => ps.map((u, place) => ({ row, k, interval, place, u })))
      .sort((a, b) => mid(row, a.interval) - mid(row, b.interval) || a.interval - b.interval || a.place - b.place),
  );
  const taken = new Set<string>();
  const key = (p: { k: number; interval: number; place: number }) => `${p.k}:${p.interval}:${p.place}`;
  const rank = (a: U, b: U) => Number(b.pinned && !b.acting && !b.retyped) - Number(a.pinned && !a.acting && !a.retyped) || b.imp - a.imp || cmp(a.key, b.key);
  const left: U[] = [];
  const give = (x: U, p: (typeof free)[number]) => {
    taken.add(key(p));
    at.set(x.key, { row: p.row, ref: { row: p.k, interval: p.interval, place: p.place }, u: p.u, w: p.row.base });
  };
  const slotOf = (x: U): SlotRef | null => pm?.slots[x.key] ?? x.prefer?.slot ?? null;
  const stay: U[] = [], fresh: U[] = [];
  for (const x of units) (!tidy && slotOf(x) ? stay : fresh).push(x);
  for (const x of [...stay].sort(rank)) {
    const was = slotOf(x)!;
    const p = free.find((f) => f.k === was.row && f.interval === was.interval && f.place === was.place && !taken.has(key(f)));
    if (p) give(x, p);
    else fresh.push(x);
  }
  const newcomers = tidy ? [...units].sort(rank) : fresh.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.arrival - b.arrival || cmp(a.key, b.key));
  // when the band is short, the heaviest keep places (the walk folded the rest; pinned cards come first)
  const keep = new Set([...newcomers].sort(rank).slice(0, free.length - taken.size).map((x) => x.key));
  for (const x of newcomers) {
    const p = keep.has(x.key) ? free.find((f) => !taken.has(key(f))) : undefined;
    if (p) give(x, p);
    else left.push(x);
  }
  return { at, left };
}

/** Members not drawn as their own face: under a stack's top, under a fan's top (its spines are blank), in a summary. */
function hiddenOf(x: U): CardId[] {
  if (x.kind === "summary") return [...x.members];
  if (x.kind === "fan" || x.kind === "stack") return x.members.slice(1);
  return [];
}

function cueOf(w: AttentionWhy): Cue {
  return w === "offered" || w === "aimed" ? "act" : w === "answers" ? "answer" : "threat";
}

function actionOf(input: ArrangeInput, ctx: PolicyCtx, un: ArrUnit): PickTarget["action"] {
  const offered = un.members.filter((id) => input.acting.offered.has(id));
  const role = ctx.mine ? "pile" : "spread";
  const open = { open: { role, from: un.id, page: 0 } } as const;
  if (un.dressing.some((id) => input.acting.offered.has(id))) return open;
  if (un.kind === "card" && un.top !== null) return input.acting.choosing && offered.length ? { select: un.top } : { inspect: un.top };
  // a stack's members are interchangeable: one target that selects
  if (un.kind === "stack" && input.acting.choosing && offered.length) return { select: offered[0]! };
  return open;
}

// ---- lineage --------------------------------------------------------------------------------------------------------

/**
 * Unit ids (§3): a unit keeps its id while its key lasts. A new key takes the id of a unit gone since the last plan:
 * the part holding that unit's old top keeps it (a split), else the part with most of its members (a merge), ties to
 * the earliest arrival. Otherwise it is new.
 */
function lineage(units: readonly U[], pm: PolicyMemory | null): Map<string, string> {
  const ids = new Map<string, string>(), taken = new Set<string>();
  const present = new Set(units.map((x) => x.key));
  const sorted = [...units].sort((a, b) => cmp(a.key, b.key));
  for (const x of sorted) {
    const id = pm?.lineage[x.key];
    if (id !== undefined && !taken.has(id)) {
      ids.set(x.key, id);
      taken.add(id);
    }
  }
  for (const x of sorted) {
    if (ids.has(x.key)) continue;
    let pick: string | null = null;
    if (pm) {
      const from = new Map<string, CardId[]>();
      for (const id of x.members) {
        const k = pm.held[id];
        if (k !== undefined && !present.has(k)) from.set(k, [...(from.get(k) ?? []), id]);
      }
      const cands = [...from.entries()].filter(([k]) => pm.lineage[k] !== undefined && !taken.has(pm.lineage[k]!));
      cands.sort((a, b) => Number(x.members.includes(pm.tops[b[0]] as CardId)) - Number(x.members.includes(pm.tops[a[0]] as CardId)) || b[1].length - a[1].length || Math.min(...a[1]) - Math.min(...b[1]));
      if (cands[0]) pick = pm.lineage[cands[0][0]]!;
    }
    let id = pick ?? `u:${x.key}`;
    for (let n = 2; taken.has(id); n++) id = `u:${x.key}+${n}`;
    ids.set(x.key, id);
    taken.add(id);
  }
  return ids;
}

function lineageOf(x: U, pm: PolicyMemory | null, ids: ReadonlyMap<string, string>): string[] {
  if (!pm) return [];
  const out = new Set<string>();
  for (const id of x.members) {
    const k = pm.held[id];
    if (k !== undefined && pm.lineage[k] !== undefined && pm.lineage[k] !== ids.get(x.key)) out.add(pm.lineage[k]!);
  }
  return [...out].sort();
}

// ---- poses and the container overflow -------------------------------------------------------------------------------

function auditAt(input: ArrangeInput, cand: Candidate, s: number, du: number, shift: number): ArrViolation[] {
  const c = input.container, f = { ...c.frame, anchor: onFrame(c.frame, 0, shift) };
  const cardOf = (id: CardId) => input.cards.find((x) => x.id === id)!;
  const drawn = cand.placed.map((p) => ({ p, d: drawUnit(c, f, p.row, { kind: p.unit.kind, members: p.unit.members, dressing: p.unit.dressing, tapped: (id) => cardOf(id).tapped, stands: p.stands, show: FAN_SHOW, u: p.u, w: p.w }, s) }));
  let paint = 0;
  const audited: AuditUnit[] = drawn.map(({ p, d }) => {
    const faces = d.cards.map((cp) => ({ quad: cp.quad, paint: paint++ }));
    return { id: p.unit.id, face: d.face, scale: s, creature: d.face ? cardOf(d.face.card).types.creature : false, region: d.region, order: paint, faces, paint: faces.at(-1)?.paint ?? 0 };
  });
  return auditUnits(c, audited, du);
}

function containerOverflow(input: ArrangeInput, policy: Policy, cards: readonly ArrCard[], seq: Record<string, number>, next: number, invalid: string | null): ArrangeResult {
  const c = input.container;
  const fit: Arrangement = {
    container: c.id,
    policy: policy.id,
    frame: c.frame,
    step: 1,
    scale: S_TABLE,
    rows: [],
    units: [],
    paint: [],
    targets: [],
    home: new Map(),
    pages: null,
    attention: cards.some((x) => input.acting.offered.has(x.id)) ? [{ unit: c.entry, cards: cards.filter((x) => input.acting.offered.has(x.id)).map((x) => x.id), why: "offered" }] : [],
    seat: null,
    used: { frame: { left: 0, top: 0, right: 0, bottom: 0 }, screen: { left: 0, top: 0, right: 0, bottom: 0 } },
    report: { edits: [], candidates: 0, audits: 0, policyInvalid: invalid, violations: [], poses: [] },
    memory: { v: 2, container: c.id, selection: input.memory?.selection ?? { policy: policy.id, since: input.clock.turn }, arrivals: { next, seq }, policies: input.memory?.policies ?? {} },
  };
  return { fit, overflow: { reason: "container", cards: cards.map((x) => x.id), ask: { kind: "entry" } } };
}

