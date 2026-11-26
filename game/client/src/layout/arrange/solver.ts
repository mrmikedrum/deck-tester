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
import { Lru, containerKey, inputKey, memoryHash } from "./memo";
import { attachmentRoots } from "./card";
import type { AuditUnit } from "./audit";
import { drawUnit } from "./draw";
import type { Drawn } from "./draw";
import { onFrame } from "./frame";
import { kindOf } from "./policies/kinds";
import { readyTapped } from "./policies/ready-tapped";
import { RowPlanner, bandsOf, centreOut, placesOf } from "./rows";
import type { Band, RowGeo } from "./rows";
import { S_TABLE, SLOT, fanExtent } from "./scale";
import { validateGroups, validateIntent } from "./validate";
import type { Intent } from "./validate";

/** Rows per container geometry, and audits per drawn arrangement, kept between plans (memo.ts). */
const PLANNERS = new Lru<RowPlanner>(32, true);
const AUDITS = new Lru<ArrViolation[]>(256);
const RESULTS = new Lru<ArrangeResult>(64);
/** What each returned arrangement drew, so a pose can draw it again where the pose moves it (`posed`). */
const PLACED = new WeakMap<Arrangement, { readonly placed: Candidate["placed"]; readonly tapped: (id: CardId) => boolean }>();
const POSED = new WeakMap<Arrangement, Map<number, ArrangeResult>>();
/** The walk's batching of moves out of an overflowing band (tests turn it off to show it changes nothing). */
export const BATCHING = { on: true };

/** Audits after the first, each a band made one place tighter (§5.1 step 3). */
const RETRIES = 4;
const EPS = 1e-9;

// ---- the plan's groups ----------------------------------------------------------------------------------------------

interface G {
  readonly key: string;
  readonly members: readonly CardId[];
  readonly dressing: readonly CardId[];
  /** The member each dressing card is drawn on: the permanent it rides with, or the first member. */
  readonly dressOn: ReadonlyMap<CardId, CardId>;
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
  /** How many fan members show their edges (its fan step's `show`); 1 for anything else. */
  readonly show: number;
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

/**
 * One container's arrangement. Kept by its whole input (memo.ts `inputKey`): a container whose cards, memory, moment
 * and everything else are unchanged since a plan is arranged again only once, so a snapshot that changes one seat
 * arranges one seat.
 */
export function arrange(input: ArrangeInput): ArrangeResult {
  const c = input.container;
  const s = S_TABLE, u = designUnit(c.projector.viewport);
  const key = inputKey(input, containerKey(c, s, u, bandsOf(input.policy.tiers)));
  const hit = RESULTS.get(key);
  if (hit) return hit;
  const r = arrangeNow(input);
  memoryHash(r.fit.memory);
  return RESULTS.set(key, r);
}

function arrangeNow(input: ArrangeInput): ArrangeResult {
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
  let got = intentOf(policy, cards, ctx, input.memory?.policies[policy.id] ?? null);
  const invalid = got.invalid;
  if (invalid !== null) {
    if (policy.id === readyTapped.id) throw new Error(`ready-tapped's own intent is invalid: ${invalid}`);
    policy = readyTapped;
    got = intentOf(policy, cards, ctx, input.memory?.policies[policy.id] ?? null);
    if (got.invalid !== null) throw new Error(`ready-tapped's own intent is invalid: ${got.invalid}`);
  }
  const intent = got.intent!;
  const pm = input.memory?.policies[policy.id] ?? null;
  // Rows come from the space and the cards: bands of tiers, each taking the rows its units need (rows.ts).
  const bands = bandsOf(policy.tiers);
  // A container's rows are its geometry's, not its cards': the planner is kept between plans of the same container.
  const geometry = containerKey(c, s, u, bands);
  const planner = PLANNERS.get(geometry) ?? PLANNERS.set(geometry, new RowPlanner(c, s, u));
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
  const roots = attachmentRoots(cards);
  let groups = planGroups(policy, intent, byId, ctx, input, pm, standingTiers.map((t) => t.id), seq, true, roots);

  // ---- the re-sort ----
  const ranking = groups.filter((g) => standingTiers.some((t) => t.id === g.base) && !g.acting).sort((a, b) => b.imp - a.imp || cmp(a.key, b.key));
  const incumbentKeys = new Set(groups.filter((g) => g.members.some((id) => standingTiers.some((t) => t.id === pm?.tiers[pm.held[id] ?? ""]))).map((g) => g.key));
  const front = new Set(ranking.slice(0, firstRow?.grid ? placesOf(firstRow) : 0).map((g) => g.key));
  const changed =
    groups.some((g) => g.retyped) ||
    ranking.some((ch) => !incumbentKeys.has(ch.key) && front.has(ch.key) && ranking.some((inc) => incumbentKeys.has(inc.key) && !front.has(inc.key) && policy.promote(inc.imp, ch.imp)));
  // Many cards' data has just arrived (a table loading, its data coming in batches: the first plans had only the
  // snapshot's facts, and kept no place for those cards): deal afresh, as at a re-sort. A card or two landing in play (a
  // land fetched from the library) takes a free place instead.
  // (while cards are in flight the deal waits, and nothing that landed is remembered meanwhile: the next plan deals it)
  const landedIds = pm ? cards.filter((x) => !x.provisional && prevSeq[x.id] !== undefined && pm.held[x.id] === undefined).map((x) => x.id) : [];
  const loaded = landedIds.length >= Math.max(3, cards.length / 4);
  const tidy = policy.tidy(input.clock, pm?.seen ?? null, changed) || (loaded && !input.clock.settling);
  const forget: ReadonlySet<CardId> = new Set(loaded && input.clock.settling ? landedIds : []);
  // A re-sort is when a card whose types changed walks to its new row.
  if (tidy && groups.some((g) => g.retyped)) groups = planGroups(policy, intent, byId, ctx, input, pm, standingTiers.map((t) => t.id), seq, false, roots);
  const gByKey = new Map(groups.map((g) => [g.key, g]));

  // ---- the compiled edit list (§5.1 step 1) ----
  const edits = compile(policy, groups, tidy ? new Set() : incumbentKeys);
  const held = new Set(pm?.folds ?? []);

  // ---- walk, draw, audit; a failing band folds one place tighter, at most RETRIES times ----
  let audits = 0, candidates = 0;
  const attempt = (exempt: ReadonlySet<string>): Candidate => {
    let tight = new Map<number, number>();
    let best: Candidate | null = null;
    for (let k = 0; k <= RETRIES + 1; k++) {
      const forceSummary = k === RETRIES + 1;
      const walked = walk(policy, groups, gByKey, edits, bands, bandOf, planner, tierOf, held, tight, input.clock.settling, s, forceSummary, exempt);
      candidates += walked.estimates;
      const cand = place(input, policy, ctx, bands, planner, tight, walked, pm, tidy, s, u, geometry);
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
    return best!;
  };
  // On my side, while I choose, what the decision offers steps out of the piles it would fold into (§2.6: a land to pay
  // with is tapped where it lies, not found in a pile), where the space holds them all; where it does not, they fold
  // as at rest and their pile opens with them lit.
  const offered = ctx.mine && input.acting.choosing ? new Set(groups.filter((g) => !g.pinned && g.members.some((id) => input.acting.offered.has(id))).map((g) => g.key)) : new Set<string>();
  let cand = attempt(offered);
  if (offered.size && (cand.unplaced.other.length || cand.unplaced.actors.length || cand.violations.length || cand.units.some((x) => x.kind === "summary"))) cand = attempt(new Set());

  // ---- poses: the same arrangement, slid along `away` (nothing changes; the audit says what holds) ----
  const poses = (input.auditPoses ? c.poses : []).map((p) => {
    const key = `${geometry}@${p.shift}#${cand.signature}`;
    return { id: p.id, violations: AUDITS.get(key) ?? AUDITS.set(key, auditAt(input, cand, s, u, p.shift)) };
  });

  // ---- memory out ----
  const memory: ContainerMemory = {
    v: 2,
    container: c.id,
    selection:
      input.selection && input.selection.policy === policy.id
        ? input.selection
        : input.memory?.selection.policy === policy.id
          ? input.memory.selection
          : { policy: policy.id, since: input.clock.turn },
    arrivals: { next, seq },
    policies: { ...(input.memory?.policies ?? {}), [policy.id]: cand.memory(ranking.map((g) => g.key), tidy, forget) },
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
  PLACED.set(fit, { placed: cand.placed, tapped: (id) => byId.get(id)!.tapped });
  return overflow ? { fit, overflow } : { fit, overflow: null };
}

// ---- intent and groups ----------------------------------------------------------------------------------------------

/**
 * A policy's intent, or why it is invalid (§2.2): its groups are checked as a partition of the cards before any of its
 * functions is asked about a group, and a policy that throws is as invalid as one that answers wrong.
 */
function intentOf(policy: Policy, cards: readonly ArrCard[], ctx: PolicyCtx, pm: PolicyMemory | null): { intent: Intent | null; invalid: string | null } {
  try {
    const groups = policy.group(cards, ctx);
    const bad = validateGroups(groups, cards);
    if (bad !== null) return { intent: null, invalid: bad };
    const tier = new Map<string, TierId>(), presented = new Map<string, boolean>(), top = new Map<string, CardId>(), importance = new Map<string, number>();
    for (const g of groups) {
      tier.set(g.key, policy.tier(g, ctx));
      presented.set(g.key, policy.presented(g, ctx));
      top.set(g.key, policy.top(g, pm?.tops[`g:${g.key}`] ?? null, ctx));
      importance.set(g.key, policy.importance(g, ctx));
    }
    const intent = { groups, tier, presented, top, importance };
    return { intent, invalid: validateIntent(policy, cards, intent, ctx) };
  } catch (e) {
    return { intent: null, invalid: `the policy threw: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function planGroups(
  policy: Policy,
  intent: Intent,
  byId: ReadonlyMap<CardId, ArrCard>,
  ctx: PolicyCtx,
  input: ArrangeInput,
  pm: PolicyMemory | null,
  standing: readonly TierId[],
  seq: Readonly<Record<string, number>>,
  retype: boolean,
  roots: ReadonlyMap<CardId, CardId>,
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
      dressOn: new Map(g.dressing.map((d) => [d, g.members.includes(roots.get(d)!) ? roots.get(d)! : g.members[0]!] as const)),
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
    // Dressing rides with the member it is (eventually) attached to; an attachment that acts leaves like any card.
    const actingDressing = g.dressing.filter((d) => acting.has(d));
    let rest = g.dressing.filter((d) => !acting.has(d));
    const dressedBy = (id: CardId) => {
      const mine = rest.filter((d) => roots.get(d) === id);
      rest = rest.filter((d) => !mine.includes(d));
      return mine;
    };
    const own: G[] = [];
    const kept: CardId[] = [];
    for (const id of members) {
      const x = byId.get(id)!;
      // An acting card leaves its unit and stands, out of any pile (§2.7).
      if (acting.has(id)) {
        const t = intent.tier.get(g.key)!;
        own.push(make({ key: `act:${id}`, members: [id], dressing: dressedBy(id), stacks: false }, standing.includes(t) ? t : firstStanding, { pinned: true, acting: true, presented: true, imp: intent.importance.get(g.key) ?? 0 }));
        continue;
      }
      // A card whose tier changed with its types stays where it was as its own unit, standing or lying by what it is now,
      // until the next re-sort walks it to its new row (designer §5).
      const was = pm?.bases[id];
      const heldKey = pm?.held[id];
      if (retype && was !== undefined && was !== base && heldKey !== undefined) {
        const tierWas = pm!.tiers[heldKey];
        if (tierWas !== undefined && policy.tiers.some((t) => t.id === tierWas)) {
          const re: Group = { key: `re:${id}`, members: [id], dressing: dressedBy(id), stacks: false };
          const now = policy.presented({ ...re, dressing: [] }, ctx) && !x.tapped && kindOf(x) !== "mana";
          own.push(make(re, tierWas, { pinned: true, retyped: true, presented: now, prefer: { tier: tierWas, slot: pm!.slots[heldKey] ?? null } }));
          continue;
        }
      }
      kept.push(id);
    }
    for (const d of actingDressing) own.push(make({ key: `act:${d}`, members: [d], dressing: [], stacks: false }, firstStanding, { pinned: true, acting: true, presented: true, imp: intent.importance.get(g.key) ?? 0 }));
    if (kept.length) {
      const cmd = kept.some((id) => byId.get(id)!.commander);
      out.push(make({ ...g, members: kept, dressing: rest }, base, { pinned: cmd }));
    } else if (rest.length) {
      // every member left: what dressed them and has no host here rides with the first that left
      const first = own.find((x) => !x.members.some((id) => actingDressing.includes(id))) ?? own[0]!;
      own[own.indexOf(first)] = { ...first, dressing: [...first.dressing, ...rest], dressOn: new Map([...first.dressOn, ...rest.map((d) => [d, first.members[0]!] as const)]) };
    }
    out.push(...own);
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
  exempt: ReadonlySet<string> = new Set(),
): Walked {
  const st: State = { tier: new Map(groups.map((g) => [g.key, g.base])), stacked: new Set(groups.filter((g) => g.squared).map((g) => g.key)), fan: new Map(), summary: new Set() };
  const records: EditRecord[] = [], ran: string[] = [];
  let estimates = 0;
  // Which bands overflow, now, with `slack` places held back from the band `held` names.
  let batch: { step: number; band: Band; held: boolean; budget: number; filled: Set<number> } | null = null;
  // The units and their layout change only when an edit runs: estimates between are answered from the last one.
  let units: U[] | null = null;
  const unitCache: UnitCache = new Map();
  const laid = new Map<string, Laid>();
  const over = (band: Band | null, slack: boolean): boolean => {
    const hold = slack && band ? band.index : null;
    let l = laid.get(String(hold));
    if (!l) {
      estimates++;
      units ??= draftUnits(policy, groups, st, tierOf, s, unitCache);
      l = lay(bands, planner, units, tight, hold);
      laid.set(String(hold), l);
    }
    return band ? l.over.has(band.index) : l.over.size > 0;
  };
  // A demote into a tier of its own band frees no place by itself: what it frees is the room the fan a later step makes of
  // that tier saves (my field's muster). It is judged with that tier fanned, so it runs only until the fan would fit.
  const fannedLater = (to: TierId, from: number): boolean => policy.ladder.some((x, i) => i > from && x.op === "fan" && "tier" in x.where && x.where.tier === to);
  const overFanned = (band: Band, slack: boolean, to: TierId): boolean => {
    const hold = slack ? band.index : null;
    const key = `${String(hold)}|fan:${to}`;
    let l = laid.get(key);
    if (!l) {
      estimates++;
      const fan = new Map(st.fan);
      for (const g of groups) if (st.tier.get(g.key) === to && !st.summary.has(g.key) && !fan.has(g.key)) fan.set(g.key, to);
      l = lay(bands, planner, draftUnits(policy, groups, { ...st, fan }, tierOf, s), tight, hold);
      laid.set(key, l);
    }
    return l.over.has(band.index);
  };
  for (const e of edits) {
    const step = e.step;
    let target: Band | null = null, groupsHit: string[];
    if (e.group !== null) {
      const g = gByKey.get(e.group)!;
      const tier = st.tier.get(g.key)!;
      if (st.summary.has(g.key) || st.fan.has(g.key)) continue;
      if (exempt.has(g.key) && step.op === "demote") continue;
      if (!matches(step.where, g, tier, groups, st)) continue;
      if (step.op === "stack" && (st.stacked.has(g.key) || !g.stacks)) continue;
      target = bandOf.get(tier)!;
      groupsHit = [g.key];
    } else if (step.op === "fan") {
      const tier = "tier" in step.where ? step.where.tier : undefined;
      if (tier === undefined) continue;
      const gather = "gather" in step.where ? (step.where.gather ?? []) : [];
      groupsHit = groups
        .filter((g) => !g.pinned && !exempt.has(g.key) && !st.summary.has(g.key) && (st.tier.get(g.key) === tier ? !st.fan.has(g.key) : gather.includes(st.tier.get(g.key)!)))
        .map((g) => g.key);
      if (groupsHit.reduce((t, k) => t + gByKey.get(k)!.members.length, 0) < 2) continue;
      target = bandOf.get(tier) ?? null;
      if (!target) continue;
    } else {
      groupsHit = groups.filter((g) => !g.pinned && !exempt.has(g.key) && !st.summary.has(g.key)).map((g) => g.key);
      if (!groupsHit.length) continue;
    }
    const wasHeld = held.has(e.id);
    // Moving groups out of a standing band that overflows by a known number of places needs no estimate until that many
    // have gone (its rows stay as they are while it overflows and the band they go to already holds something).
    const moves = (step.op === "demote" || step.op === "split-spent") && e.group !== null;
    const g = e.group !== null ? gByKey.get(e.group)! : null;
    const dest = (k: string): Band | undefined => (step.op === "split-spent" ? bandOf.get(step.to) : step.op === "demote" ? bandOf.get(typeof step.to === "string" ? step.to : gByKey.get(k)!.creature ? step.to.creature : step.to.other) : undefined);
    const ownUnits = (k: string) => (st.stacked.has(k) ? 1 : gByKey.get(k)!.members.length);
    let need: boolean;
    const to = step.op === "demote" && g ? (typeof step.to === "string" ? step.to : g.creature ? step.to.creature : step.to.other) : undefined;
    if (to !== undefined && target && bandOf.get(to) === target && fannedLater(to, e.index)) {
      batch = null;
      need = settling && wasHeld ? true : overFanned(target, wasHeld, to);
    } else if (BATCHING.on && batch && moves && g && batch.step === e.index && target === batch.band && wasHeld === batch.held && batch.filled.has(dest(g.key)?.index ?? -1)) {
      need = true;
      batch.budget -= ownUnits(g.key);
      if (batch.budget <= 0) batch = null;
    } else {
      batch = null;
      need = forceSummary && step.op === "summary" ? true : settling && wasHeld ? true : over(target, wasHeld);
      const l = laid.get(String(wasHeld && target ? target.index : null));
      if (need && moves && g && target && target.posture === "stand" && l) {
        const d = dest(g.key), left: number = (l.excess.get(target.index) ?? 0) - ownUnits(g.key);
        if (d && (l.count.get(d.index) ?? 0) > 0 && left > 0) batch = { step: e.index, band: target, held: wasHeld, budget: left, filled: new Set([...l.count].filter(([, n]) => n > 0).map(([b]) => b)) };
      }
    }
    records.push({ index: e.index, op: step.op, groups: groupsHit, ran: need });
    if (!need) continue;
    ran.push(e.id);
    units = null;
    laid.clear();
    for (const k of groupsHit) {
      // spent copies leave as a sibling stack, with their own count
      if (step.op === "split-spent") {
        st.tier.set(k, step.to);
        if (gByKey.get(k)!.stacks) st.stacked.add(k);
      }
      else if (step.op === "demote") st.tier.set(k, typeof step.to === "string" ? step.to : gByKey.get(k)!.creature ? step.to.creature : step.to.other);
      else if (step.op === "stack") st.stacked.add(k);
      // (a gathering fan takes the others into its own tier's fan)
      else if (step.op === "fan") st.fan.set(k, ("tier" in step.where ? step.where.tier : undefined) ?? st.tier.get(k)!);
      else st.summary.add(k);
    }
  }
  return { groups, st, records, ran, estimates };
}

// ---- units ----------------------------------------------------------------------------------------------------------

const FAN_SHOW = 6;

/** A group's own units by its state (tier and squared), reused across a walk's estimates while that state holds. */
type UnitCache = Map<string, { readonly state: string; readonly units: readonly U[] }>;

function draftUnits(policy: Policy, groups: readonly G[], st: State, tierOf: ReadonlyMap<TierId, Policy["tiers"][number]>, s: number, cache?: UnitCache): U[] {
  const out: U[] = [];
  const fans = new Map<TierId, G[]>(), summary: G[] = [];
  const showOf = (t: TierId): number => fanShow(policy).get(t) ?? FAN_SHOW;
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
    const stacked = st.stacked.has(g.key), state = `${tier}|${stacked}`;
    const hit = cache?.get(g.key);
    if (hit && hit.state === state) {
      out.push(...hit.units);
      continue;
    }
    const common = { tier, imp: g.imp, pinned: g.pinned, acting: g.acting, retyped: g.retyped, arrival: g.arrival, prefer: g.prefer, groups: [g.key], show: 1 };
    // It stands where its tier stands (or it acts, or its types just changed where it lies); demoted, it lies.
    const stands = g.presented && (!lying(tier) || g.acting || g.retyped);
    const mine: U[] = [];
    if (stacked) {
      const kind: UnitKind = g.members.length > 1 ? "stack" : "card";
      mine.push({ ...common, key: `s${g.key}`, kind, members: g.members, dressing: g.dressing, stands, width: SLOT.lie * s });
    } else
      for (const id of g.members)
        mine.push({ ...common, key: `c${id}`, kind: "card", members: [id], dressing: g.dressing.filter((d) => g.dressOn.get(d) === id), stands, width: SLOT.lie * s });
    cache?.set(g.key, { state, units: mine });
    out.push(...mine);
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
      show: n,
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
      show: 1,
    });
  }
  // In the order lying bands pack them (tier, a retyped card first, then the heaviest), so no band sorts again.
  const ix = tierIndex(policy);
  const keyed = out.map((u) => ({ u, t: ix.get(u.tier)!, r: u.retyped ? 0 : 1 }));
  keyed.sort((a, b) => a.t - b.t || a.r - b.r || b.u.imp - a.u.imp || cmp(a.u.key, b.u.key));
  return keyed.map((k) => k.u);
}


/** What the space gives each band for these units: its rows, and whether its units overflow them. */
interface Laid {
  readonly rows: RowGeo[];
  readonly byBand: Map<number, RowGeo[]>;
  readonly over: Set<number>;
  /** Per band, how many units it holds; per standing band, by how many places they overflow its rows. */
  readonly count: Map<number, number>;
  readonly excess: Map<number, number>;
}

/**
 * Lay the rows (§5.2): bands in order from the anchor edge, each taking rows while its units do not fit them and the
 * space has another, keeping room for the first row of every later band that holds something. `tight` holds back places
 * from a band an audit found crowded; `slackFor` holds back one more (a fold's deadband).
 */
function lay(bands: readonly Band[], planner: RowPlanner, units: readonly U[], tight: ReadonlyMap<number, number>, slackFor: number | null): Laid {
  const bandOf = new Map(bands.flatMap((b) => b.tiers.map((t) => [t.id, b.index] as const)));
  const per: U[][] = bands.map(() => []);
  for (const x of units) per[bandOf.get(x.tier)!]!.push(x);
  const rows: RowGeo[] = [], byBand = new Map<number, RowGeo[]>(), over = new Set<number>();
  const count = new Map<number, number>(), excess = new Map<number, number>();
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
    count.set(b.index, mine.length);
    if (b.posture === "stand" && got.length) excess.set(b.index, mine.reduce((t, x) => t + span(x, got[0]!), 0) - (got.reduce((t, r) => t + placesOf(r), 0) - less));
    rows.push(...got);
  }
  return { rows, byBand, over, count, excess };
}

const span = (x: U, row: RowGeo): number => Math.max(1, Math.ceil(x.width / row.base - EPS));

function fitsBand(b: Band, units: readonly U[], rows: readonly RowGeo[], less: number): boolean {
  if (!rows.length) return !units.length;
  if (b.posture === "stand") return units.reduce((t, x) => t + span(x, rows[0]!), 0) <= rows.reduce((t, r) => t + placesOf(r), 0) - less;
  return packBand(rows, ordered(b, units), less * rows[0]!.base) !== null;
}

/** A lying band's units in their tier order, then the heaviest first. */
/** A lying band's units in their tier order, then the heaviest first: as `draftUnits` already gives them. */
function ordered(_b: Band, units: readonly U[]): readonly U[] {
  return units;
}

/** Per policy, kept: each tier's index and each fan step's edges. */
const TIER_INDEX = new WeakMap<Policy, Map<TierId, number>>();
const tierIndex = (p: Policy): Map<TierId, number> => {
  let m = TIER_INDEX.get(p);
  if (!m) TIER_INDEX.set(p, (m = new Map(p.tiers.map((t, i) => [t.id, i]))));
  return m;
};
const FAN_SHOWS = new WeakMap<Policy, Map<TierId, number>>();
const fanShow = (p: Policy): Map<TierId, number> => {
  let m = FAN_SHOWS.get(p);
  if (!m) {
    m = new Map();
    for (const x of p.ladder) if (x.op === "fan" && "tier" in x.where && x.where.tier !== undefined && !m.has(x.where.tier)) m.set(x.where.tier, x.show);
    FAN_SHOWS.set(p, m);
  }
  return m;
};

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
  /** Where each unit is and what it shows: what its drawing, so its audit, follows from. */
  readonly signature: string;
  readonly rows: readonly RowGeo[];
  readonly edits: EditRecord[];
  readonly used: Arrangement["used"];
  /** What is drawn, per unit id, for a pose's audit. */
  readonly placed: readonly { readonly unit: ArrUnit; readonly row: RowGeo; readonly u: number; readonly w: number; readonly stands: boolean; readonly show: number }[];
  /** `forget`: cards no place is kept for (their data has just landed while cards are in flight). */
  memory(ranking: readonly string[], tidy: boolean, forget: ReadonlySet<CardId>): PolicyMemory;
}

function place(input: ArrangeInput, policy: Policy, ctx: PolicyCtx, bands: readonly Band[], planner: RowPlanner, tight: ReadonlyMap<number, number>, walked: Walked, pm: PolicyMemory | null, tidy: boolean, s: number, du: number, geometry: string): Candidate {
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
      const placed = gridPlace(rows, here, pm, tidy, tierOf);
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
    drawn.set(x.key, drawUnit(c, c.frame, sl.row, { kind: x.kind, members: x.members, dressing: x.dressing, tapped: (id) => cardOf(id).tapped, stands: x.stands, show: x.show, u: sl.u, w: sl.w }, s));
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
    // tucked attachments count as hidden when offered or aimed: their strip is no place to choose them
    const hidden = [...hiddenOf(x), ...x.dressing.filter((d) => input.acting.offered.has(d) || input.acting.involved.has(d))];
    const why = new Map<AttentionWhy, CardId[]>();
    for (const id of hidden) {
      const card = cardOf(id);
      // (a card I can use now counts as one I may act on: the pile that hides it says so)
      const w = input.acting.offered.has(id) || input.acting.usable.has(id) ? "offered" : x.kind === "stack" ? null : policy.matters(card, input.moment, ctx);
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
  const draftByKey = new Map(drafts.map((y) => [y.key, y]));
  for (const x of order) {
    const d = drawn.get(x.key)!, sl = slots.get(x.key)!, id = ids.get(x.key)!;
    const draft = draftByKey.get(x.key)!;
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
  // What is drawn follows from where each unit is and what it shows: the same placement is the same audit.
  const signature = order
    .map((x) => {
      const sl = slots.get(x.key)!, top = x.members[0];
      const bits = [...x.members, ...x.dressing].map((id) => (cardOf(id).tapped ? "t" : "r")).join("");
      return `${ids.get(x.key)}:${x.kind}:${sl.row.index}:${sl.row.v.toFixed(6)}:${sl.u.toFixed(6)}:${sl.w.toFixed(6)}:${x.stands ? 1 : 0}:${x.show}:${x.members.join(",")}/${x.dressing.join(",")}:${bits}:${top !== undefined && cardOf(top).types.creature ? 1 : 0}`;
    })
    .join(";");
  const auditKey = `${geometry}#${signature}`;
  const violations = AUDITS.get(auditKey) ?? AUDITS.set(auditKey, auditUnits(c, audited, du));
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

  const unitByKey = new Map(units.map((un) => [un.key, un]));
  const placedList = order.map((x) => ({ unit: unitByKey.get(x.key)!, row: slots.get(x.key)!.row, u: slots.get(x.key)!.u, w: slots.get(x.key)!.w, stands: x.stands, show: x.show }));

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
    signature,
    edits: walked.records,
    used: { frame: frameRect, screen: screenRect },
    placed: placedList,
    memory(ranking, didTidy, forget) {
      const slotsOut: Record<UnitKey, SlotRef> = {}, lin: Record<UnitKey, string> = {}, tops: Record<string, CardId> = {}, tiers: Record<UnitKey, TierId> = {}, heldOut: Record<string, UnitKey> = {}, bases: Record<string, TierId> = {};
      // (a card whose data has not arrived is not remembered: placed again once it has, by what it is)
      const guess = (id: CardId) => !!ctx.cards.get(id)?.provisional || forget.has(id);
      for (const un of units) {
        lin[un.key] = un.id;
        if (un.top !== null) tops[un.key] = un.top;
        const all = [...un.members, ...un.dressing];
        if (all.length && all.every(guess)) continue;
        slotsOut[un.key] = un.slot;
        tiers[un.key] = un.tier;
        for (const id of all) if (!guess(id)) heldOut[id] = un.key;
      }
      for (const g of walked.groups) {
        tops[`g:${g.key.replace(/^(act|re):/, "")}`] ??= g.members[0]!;
        // a retyped card keeps its old seat until it moves; everything else is seated by what it is now
        for (const id of [...g.members, ...g.dressing]) if (!guess(id)) bases[id] = g.retyped ? (pm?.bases[id] ?? g.base) : g.base;
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
        // (a plan while cards are in flight does not count as seeing its phase: the re-sort it held back comes next)
        seen: input.clock.settling ? (pm?.seen ?? null) : { turn: input.clock.turn, phase: input.clock.phase },
      };
    },
  };
}

/**
 * Places in a standing band, its nearest row first, each row's intervals nearest the middle first, each interval's
 * places centre-out (a row whose tiers keep to a side holds one centred block). A re-sort deals the band by rank (the commander first); otherwise a unit keeps its place while it
 * lasts, a retyped card takes its old place where free, and a newcomer the first free place.
 */
function gridPlace(rows: readonly RowGeo[], units: readonly U[], pm: PolicyMemory | null, tidy: boolean, tierOf: ReadonlyMap<TierId, Policy["tiers"][number]>): { at: Map<string, { row: RowGeo; ref: SlotRef; u: number; w: number }>; left: U[] } {
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
  // when the band is short, the heaviest keep places (the walk folded the rest; pinned cards come first)
  const fromOf = (x: U) => tierOf.get(x.tier)?.from ?? "centre";
  const newcomers = tidy ? [...units].sort(rank) : fresh.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.arrival - b.arrival || cmp(a.key, b.key));
  const keep = new Set([...newcomers].sort(rank).slice(0, free.length - taken.size).map((x) => x.key));
  // A row whose tiers keep to a side (my row: works at the left, mana at the right) holds its units as one block, centred
  // while it has room: a re-sort deals the block afresh, what stands in its middle by rank; a newcomer joins the block's
  // side its tier keeps to, or its middle.
  if (rows.length === 1 && units.some((x) => fromOf(x) !== "centre")) {
    const line = [...free].sort((a, b) => a.u - b.u);
    const ix = new Map([...tierOf.keys()].map((t, i) => [t, i] as const));
    if (tidy) {
      const kept = newcomers.filter((x) => keep.has(x.key));
      const side = (f: string) => kept.filter((x) => fromOf(x) === f);
      // lightest outermost: works lightest at the left; mana by kind in tier order, the heaviest of a kind nearest the middle
      const L = side("left").sort((a, b) => -rank(a, b));
      const C = side("centre"), mid: U[] = [];
      C.forEach((x, j) => (mid[Math.round((C.length - 1) / 2 + centreOut(j, C.length))] = x));
      const R = side("right").sort((a, b) => ix.get(a.tier)! - ix.get(b.tier)! || rank(a, b));
      const seq = [...L, ...mid, ...R], c0 = Math.floor((line.length - seq.length) / 2);
      seq.forEach((x, i) => give(x, line[c0 + i]!));
    } else {
      const us = line.filter((f) => taken.has(key(f))).map((f) => f.u);
      const lo = us.length ? Math.min(...us) : 0, hi = us.length ? Math.max(...us) : 0, c = (lo + hi) / 2;
      for (const x of newcomers) {
        if (!keep.has(x.key)) continue;
        const f = fromOf(x), open = line.filter((p) => !taken.has(key(p)));
        const near = (u: number) => (a: (typeof line)[number], b: (typeof line)[number]) => Math.abs(a.u - u) - Math.abs(b.u - u);
        const p =
          f === "left" ? (open.filter((q) => q.u < lo).sort(near(lo))[0] ?? open.sort(near(lo))[0])
          : f === "right" ? (open.filter((q) => q.u > hi).sort(near(hi))[0] ?? open.sort(near(hi))[0])
          : open.sort(near(c))[0];
        if (p) give(x, p);
      }
    }
    for (const x of newcomers) if (!at.has(x.key)) left.push(x);
    return { at, left };
  }
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
  // A block of copies is interchangeable: one target that selects. A block of distinct choices (a well of lands) opens
  // its focus with them offered, so each can be chosen.
  const look = (id: CardId) => {
    const c = ctx.cards.get(id)!;
    return `${c.lookKey}|${c.tapped}`;
  };
  if (un.kind === "stack" && input.acting.choosing && offered.length && offered.every((id) => look(id) === look(offered[0]!))) return { select: offered[0]! };
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
  const give = (x: U, id: string) => {
    ids.set(x.key, id);
    taken.add(id);
  };
  // a unit keeps its id while its key lasts
  for (const x of [...units].sort((a, b) => cmp(a.key, b.key))) {
    const id = pm?.lineage[x.key];
    if (id !== undefined && !taken.has(id)) give(x, id);
  }
  if (pm) {
    const gone = Object.keys(pm.lineage)
      .filter((k) => !present.has(k))
      .sort(cmp);
    // a split: the part holding the old top keeps the id
    for (const k of gone) {
      const id = pm.lineage[k]!, top = pm.tops[k];
      if (taken.has(id) || top === undefined) continue;
      const heir = units.find((x) => !ids.has(x.key) && x.members.includes(top as CardId));
      if (heir) give(heir, id);
    }
    // a merge, or a split whose top left: the part with most of the old members, ties to the earliest arrival
    for (const x of [...units].filter((y) => !ids.has(y.key)).sort((a, b) => a.arrival - b.arrival || cmp(a.key, b.key))) {
      const from = new Map<string, number>();
      for (const id of x.members) {
        const k = pm.held[id];
        if (k !== undefined && !present.has(k) && pm.lineage[k] !== undefined && !taken.has(pm.lineage[k]!)) from.set(k, (from.get(k) ?? 0) + 1);
      }
      const best = [...from.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0];
      if (best) give(x, pm.lineage[best[0]]!);
    }
  }
  for (const x of [...units].filter((y) => !ids.has(y.key)).sort((a, b) => cmp(a.key, b.key))) {
    let id = `u:${x.key}`;
    for (let n = 2; taken.has(id); n++) id = `u:${x.key}+${n}`;
    give(x, id);
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
  const drawn = cand.placed.map((p) => ({ p, d: drawUnit(c, f, p.row, { kind: p.unit.kind, members: p.unit.members, dressing: p.unit.dressing, tapped: (id) => cardOf(id).tapped, stands: p.stands, show: p.show, u: p.u, w: p.w }, s) }));
  let paint = 0;
  const audited: AuditUnit[] = drawn.map(({ p, d }) => {
    const faces = d.cards.map((cp) => ({ quad: cp.quad, paint: paint++ }));
    return { id: p.unit.id, face: d.face, scale: s, creature: d.face ? cardOf(d.face.card).types.creature : false, region: d.region, order: paint, faces, paint: faces.at(-1)?.paint ?? 0 };
  });
  return auditUnits(c, audited, du);
}

/**
 * The same arrangement under a pose (§5.3): the frame slid `shift` along its `away`, every card, marker and target drawn
 * again where the pose moves it. Nothing else changes (units, members, slots, memory, paint order): a pose replans no
 * board. The rows were laid to hold under the container's poses, so a shift up to the deepest of them meets every floor
 * and patch.
 */
export function posed(input: ArrangeInput, r: ArrangeResult, shift: number): ArrangeResult {
  const got = PLACED.get(r.fit);
  if (!shift || !got) return r;
  let kept = POSED.get(r.fit);
  const hit = kept?.get(shift);
  if (hit) return hit;
  const c = input.container, f = { ...c.frame, anchor: onFrame(c.frame, 0, shift) };
  const drawn = new Map(got.placed.map((p) => [p.unit.id, drawUnit(c, f, p.row, { kind: p.unit.kind, members: p.unit.members, dressing: p.unit.dressing, tapped: got.tapped, stands: p.stands, show: p.show, u: p.u, w: p.w }, r.fit.scale)] as const));
  const units = r.fit.units.map((un) => {
    const d = drawn.get(un.id);
    return d ? { ...un, cards: d.cards, marker: d.marker } : un;
  });
  const targets = r.fit.targets.map((t) => {
    const d = drawn.get(t.piece);
    return d ? { ...t, region: d.region } : t;
  });
  const pts = targets.flatMap((t) => t.region);
  const screen = pts.length ? { left: Math.min(...pts.map((p) => p.x)), right: Math.max(...pts.map((p) => p.x)), top: Math.min(...pts.map((p) => p.y)), bottom: Math.max(...pts.map((p) => p.y)) } : r.fit.used.screen;
  const out: ArrangeResult = { fit: { ...r.fit, frame: f, units, targets, used: { ...r.fit.used, screen } }, overflow: r.overflow } as ArrangeResult;
  if (!kept) POSED.set(r.fit, (kept = new Map()));
  kept.set(shift, out);
  return out;
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

