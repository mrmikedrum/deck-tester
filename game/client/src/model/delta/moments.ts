// Moments: the changes of one snapshot grouped by meaning, so the log and the motion tell the same story. The card-
// specific readings of live.js `take` (Sunfall, the counterspell, Marath's Elemental) and the generic ones (a sweep, a
// resolution and what the log says it did, a cast, combat, draws, the turn) are rows of one table, tried in order;
// each change is claimed by the first row that reads it, and whatever no row reads is one `other` moment with an
// unknown cause. A cause the client cannot know (which of two spells killed a creature) is never guessed.
import type { CardId, LogEntry, StackId } from "../../protocol";
import type { SeatId } from "../ids";
import { roleOf } from "../predicates";
import { elementalCreation, isCounterspell, isDamagePhase, logText, makesElemental, sweepHarms } from "../readings";
import type { TableModel } from "../table";
import type { Change } from "./changes";
import type { Resolution } from "./resolutions";

export type MomentKind = "cast" | "resolve" | "sweep" | "assault" | "blocks" | "combat" | "draw" | "turn" | "life" | "other";

/** Which row read the moment: what the narrative words it by. */
export type ReadingId =
  | "reset"
  | "eliminated"
  | "sunfall"
  | "sweep"
  | "counter"
  | "elemental"
  | "resolve"
  | "cast"
  | "land"
  | "combat-damage"
  | "combat-over"
  | "assault"
  | "blocks"
  | "draw"
  | "turn"
  | "life"
  | "unknown";

/** What drove a moment: the stack item and its card, as far as they are known. */
export interface Cause {
  readonly item: StackId | null;
  readonly card: CardId | null;
}

/** live.js `counterResult`: what was countered, by what (null when the log cannot say), and its targets that stayed. */
export interface CounterDetail {
  readonly t: "counter";
  readonly countered: StackId | null;
  readonly by: StackId | null;
  readonly saved: readonly CardId[];
}
export type MomentDetail = CounterDetail;

export interface Claim {
  readonly kind: MomentKind;
  readonly reading: ReadingId;
  /** Indexes into the change list being grouped. */
  readonly changes: readonly number[];
  readonly cause: Cause | null;
  readonly detail: MomentDetail | null;
}

export interface Ctx {
  readonly prev: TableModel;
  readonly next: TableModel;
  readonly changes: readonly Change[];
  readonly fresh: readonly LogEntry[];
  readonly resolutions: readonly Resolution[];
  free(i: number): boolean;
  /** Whether an earlier row has read this resolution. */
  read(r: Resolution): boolean;
}

/** A row's claim, with the resolution it read (so no later row reads it again). */
type RowClaim = Claim & { readonly reads?: Resolution };

interface Row {
  readonly reading: ReadingId;
  claim(ctx: Ctx): RowClaim[];
}

type Moved = Extract<Change, { t: "moved" }>;
const indexes = (ctx: Ctx, pred: (c: Change, i: number) => boolean): number[] =>
  ctx.changes.flatMap((c, i) => (ctx.free(i) && pred(c, i) ? [i] : []));
const own = (r: Resolution): number[] => [r.popped, r.move].filter((i): i is number => i !== null);
const causeOf = (r: Resolution): Cause => ({ item: r.item?.id ?? null, card: r.card?.id ?? null });
const departs = (c: Change): c is Moved => c.t === "moved" && c.from === "battlefield";
const claim = (
  kind: MomentKind,
  reading: ReadingId,
  changes: number[],
  cause: Cause | null = null,
  detail: MomentDetail | null = null,
  reads?: Resolution,
): RowClaim => ({ kind, reading, changes, cause, detail, ...(reads ? { reads } : {}) });
/** The resolutions no earlier row has read. */
const unread = (ctx: Ctx): Resolution[] => ctx.resolutions.filter((r) => !ctx.read(r));

// ---- the rows, in the order they read ------------------------------------------------------------------------------

/** A player lost: their seat goes out and every card of theirs leaves the view. */
const eliminated: Row = {
  reading: "eliminated",
  claim: (ctx) =>
    ctx.changes.flatMap((c, i) => {
      if (c.t !== "eliminated" || !ctx.free(i)) return [];
      const cards = indexes(ctx, (d) => d.t === "moved" && d.to === null && (d.before?.owner === c.seat || d.before?.controller === c.seat));
      return [claim("other", "eliminated", [i, ...cards])];
    }),
};

/**
 * live.js `sunfallResult` and `creatureSweep`: Sunfall resolving exiles every creature and leaves its caster an
 * Incubator (`outcomes`). Kept by name, as it was tuned; the generic sweep below reads the rest.
 */
const sunfall: Row = {
  reading: "sunfall",
  claim: (ctx) =>
    unread(ctx)
      .filter((r) => r.spell && r.card?.name === "Sunfall" && r.how === "resolved")
      .map((r) => {
        const gone = indexes(ctx, departs);
        const incubators = indexes(ctx, (c) => c.t === "moved" && c.from === null && c.to === "battlefield" && !!c.after?.token && c.after.name === "Incubator" && c.after.controller === r.controller);
        return claim("sweep", "sunfall", [...own(r), ...gone, ...incubators], causeOf(r), null, r);
      }),
};

/**
 * h.js `sweepHarms`: a resolved spell or ability that harms all or each of something takes what it reaches off every
 * seat at once, attachments with their hosts: one moment, however many cards and seats.
 */
const sweep: Row = {
  reading: "sweep",
  claim: (ctx) =>
    unread(ctx).flatMap((r) => {
      const harm = r.how === "resolved" ? sweepHarms(r.text, r.controller) : null;
      if (!harm) return [];
      const hit = indexes(ctx, (c) => departs(c) && !!c.before && harm(roleOf(c.before), c.before.controller));
      const hosts = new Set(hit.map((i) => (ctx.changes[i] as Moved).card));
      const riders = indexes(ctx, (c, i) => departs(c) && !hit.includes(i) && c.before?.attachedTo != null && hosts.has(c.before.attachedTo));
      return [claim("sweep", "sweep", [...own(r), ...hit, ...riders], causeOf(r), null, r)];
    }),
};

/**
 * live.js `counterResult`: a spell the log says was countered, and the one spell that left with it whose text counters
 * a target spell and targeted it. Its targets that stayed on the battlefield were saved.
 */
const counter: Row = {
  reading: "counter",
  claim: (ctx) =>
    unread(ctx)
      .filter((r) => r.spell && r.how === "countered")
      .map((r) => {
        const id = r.card?.id;
        const by = unread(ctx).filter(
          (b) => b !== r && b.spell && !!b.card && isCounterspell(b.card.face.text || b.card.face.rules) && !!b.item?.targets.some((t) => "card" in t && t.card === id),
        );
        const one = by.length === 1 ? by[0]! : null;
        const saved = (r.item?.targets ?? []).flatMap((t) =>
          "card" in t && ctx.prev.cards.get(t.card)?.zone === "battlefield" && ctx.next.cards.get(t.card)?.zone === "battlefield" ? [t.card] : [],
        );
        const detail: CounterDetail = { t: "counter", countered: r.item?.id ?? null, by: one?.item?.id ?? null, saved };
        return claim("resolve", "counter", [...(one ? own(one) : []), ...own(r)], causeOf(one ?? r), detail, r);
      }),
};

/** live.js `tokenResult`: Marath's ability makes an X/X Elemental (and the log says Beasts came with it). */
const elemental: Row = {
  reading: "elemental",
  claim: (ctx) =>
    unread(ctx).flatMap((r) => {
      const who = r.controller;
      if (r.spell || !r.item || !who || !makesElemental(r.item.text)) return [];
      if (!ctx.fresh.some((e) => elementalCreation(e.text) !== null && logText(e.text).startsWith(who + " "))) return [];
      const made = indexes(ctx, (c) => c.t === "moved" && c.from === null && c.to === "battlefield" && !!c.after?.token && c.after.controller === who);
      return [claim("resolve", "elemental", [...own(r), ...made], causeOf(r), null, r)];
    }),
};

/**
 * Every other resolution: its own departure, and what it did. A card change belongs to it when the log names the card
 * inside its span, or (with no log naming it) when it is the only resolution that targeted the card; a life change
 * when the seat's LIFE entry is inside its span, or it alone targeted the seat. Anything two resolutions could have
 * done stays unclaimed: its cause is unknown.
 */
const resolve: Row = {
  reading: "resolve",
  claim: (ctx) => {
    const live = unread(ctx).filter((r) => own(r).every((i) => ctx.free(i)));
    const extra = new Map<Resolution, number[]>(live.map((r) => [r, []]));
    const one = <T>(xs: readonly T[]): T | null => (xs.length === 1 ? xs[0]! : null);
    ctx.changes.forEach((c, i) => {
      if (!ctx.free(i) || live.some((r) => own(r).includes(i))) return;
      let by: Resolution | null = null;
      if (c.t === "life" || c.t === "poison") {
        const entry = ctx.fresh.findIndex((e) => /^LIFE$/i.test(e.type) && e.text.startsWith(`Life: ${c.seat} `));
        const spanned = live.filter((r) => r.span && entry >= r.span.from && entry < r.span.to);
        by = entry >= 0 && spanned.length ? one(spanned) : one(live.filter((r) => !!r.item?.targets.some((t) => "seat" in t && t.seat === c.seat)));
      } else if ("card" in c && c.t !== "attacks" && c.t !== "blocked") {
        const spanned = live.filter((r) => r.named.has(c.card));
        by = spanned.length ? one(spanned) : one(live.filter((r) => !!r.item?.targets.some((t) => "card" in t && t.card === c.card)));
      }
      if (by) extra.get(by)!.push(i);
    });
    return live.flatMap((r) => {
      const changes = [...own(r), ...extra.get(r)!];
      return changes.length ? [claim("resolve", "resolve", changes, causeOf(r), null, r)] : [];
    });
  },
};

/** A spell or ability goes on the stack, with its card's move there; a land is played. */
const cast: Row = {
  reading: "cast",
  claim: (ctx) => [
    ...ctx.changes.flatMap((c, i) => {
      if (c.t !== "pushed" || !ctx.free(i)) return [];
      const src = c.item.source;
      const move = indexes(ctx, (d) => d.t === "moved" && d.to === "stack" && d.card === src);
      return [claim("cast", "cast", [i, ...move], { item: c.item.id, card: src })];
    }),
    ...indexes(ctx, (c) => c.t === "moved" && (c.to === "stack" || c.kind === "play")).map((i) => {
      const c = ctx.changes[i] as Moved;
      return claim("cast", c.kind === "play" ? "land" : "cast", [i], { item: null, card: c.card });
    }),
  ],
};

/**
 * live.js `take`: combat damage (`/^COMBAT_(FIRST_STRIKE_)?DAMAGE$/`) or the end of combat. The fighters that left,
 * their counters and stats, and the life and poison combat changed.
 */
const combat: Row = {
  reading: "combat-damage",
  claim: (ctx) => {
    const was = ctx.prev.combat;
    const over = indexes(ctx, (c) => c.t === "combat-over");
    if (!was || (!over.length && !isDamagePhase(ctx.next.phase))) return [];
    const fighters = new Set<CardId>([...was.attackers.map((a) => a.attacker), ...was.blockers.map((b) => b.blocker)]);
    const hurt = indexes(ctx, (c) => (departs(c) || c.t === "counters" || c.t === "stats") && fighters.has(c.card));
    const life = isDamagePhase(ctx.next.phase) || isDamagePhase(ctx.prev.phase) ? indexes(ctx, (c) => c.t === "life" || c.t === "poison") : [];
    const all = [...over, ...hurt, ...life];
    if (!all.length) return [];
    return [claim("combat", hurt.length || life.length ? "combat-damage" : "combat-over", all)];
  },
};

function bySeat(ctx: Ctx, t: "attacks" | "blocked"): Map<SeatId | null, number[]> {
  const groups = new Map<SeatId | null, number[]>();
  ctx.changes.forEach((c, i) => {
    if (c.t !== t || !ctx.free(i)) return;
    const list = groups.get(c.controller);
    if (list) list.push(i);
    else groups.set(c.controller, [i]);
  });
  return groups;
}

/** Attackers declared, one moment per attacking seat, with the attackers tapping as they go. */
const assault: Row = {
  reading: "assault",
  claim: (ctx) =>
    [...bySeat(ctx, "attacks").values()].map((list) => {
      const ids = new Set(list.map((i) => (ctx.changes[i] as Extract<Change, { t: "attacks" }>).card));
      const taps = indexes(ctx, (c) => c.t === "tapped" && ids.has(c.card) && !!c.after?.tapped);
      return claim("assault", "assault", [...list, ...taps]);
    }),
};

/** Blockers declared, one moment per blocking seat. */
const blocks: Row = {
  reading: "blocks",
  claim: (ctx) => [...bySeat(ctx, "blocked").values()].map((list) => claim("blocks", "blocks", list)),
};

/** Cards drawn: my hand's arrivals from out of sight, others' hands growing, and the libraries they came from. */
const draw: Row = {
  reading: "draw",
  claim: (ctx) => {
    const drew = indexes(ctx, (c) => (c.t === "moved" && c.kind === "draw") || (c.t === "count" && c.zone === "hand" && c.to > c.from));
    if (!drew.length) return [];
    const seats = new Set(drew.map((i) => {
      const c = ctx.changes[i]!;
      return c.t === "count" ? c.seat : (c as Moved).after?.owner;
    }));
    const libraries = indexes(ctx, (c) => c.t === "count" && c.zone === "library" && c.to < c.from && seats.has(c.seat));
    return [claim("draw", "draw", [...drew, ...libraries])];
  },
};

/** The turn and phase move, priority passes; on a new turn, the active seat's permanents untap. */
const turn: Row = {
  reading: "turn",
  claim: (ctx) => {
    const list = indexes(ctx, (c) => c.t === "turn" || c.t === "phase" || c.t === "priority");
    const newTurn = ctx.changes.some((c) => c.t === "turn");
    const untap = newTurn ? indexes(ctx, (c) => c.t === "tapped" && !!c.before?.tapped && !!c.after && !c.after.tapped && c.after.controller === ctx.next.active) : [];
    return list.length || untap.length ? [claim("turn", "turn", [...list, ...untap])] : [];
  },
};

/** Life, poison and the monarch, with no cause the rows above could read. */
const life: Row = {
  reading: "life",
  claim: (ctx) => {
    const list = indexes(ctx, (c) => c.t === "life" || c.t === "poison" || c.t === "monarch");
    return list.length ? [claim("life", "life", list)] : [];
  },
};

/** The table, in order: the first row to read a change claims it. */
export const ROWS: readonly Row[] = [eliminated, sunfall, sweep, counter, elemental, resolve, cast, combat, assault, blocks, draw, turn, life];

/** Every change in exactly one moment: the rows' claims, then one `other` moment for what none of them read. */
export function claimAll(base: Omit<Ctx, "free" | "read">): Claim[] {
  const taken = new Set<number>(), used = new Set<Resolution>();
  const ctx: Ctx = { ...base, free: (i) => !taken.has(i), read: (r) => used.has(r) };
  const out: Claim[] = [];
  for (const row of ROWS) {
    for (const { reads, ...c } of row.claim(ctx)) {
      const mine = [...new Set(c.changes)].filter((i) => !taken.has(i));
      if (reads) used.add(reads);
      if (!mine.length) continue;
      mine.forEach((i) => taken.add(i));
      out.push({ ...c, changes: mine });
    }
  }
  const rest = base.changes.flatMap((_, i) => (taken.has(i) ? [] : [i]));
  if (rest.length) out.push(claim("other", "unknown", rest));
  return out;
}
