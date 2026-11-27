// What a change set moves: a departure for every card that left a piece the scene draws (to a pile, to the piece it
// becomes, to my hand, or nowhere with a flare), and an arrival for every card that comes onto the table from out of
// sight or from the hand. Ported from h.js `buildBoard`'s `leaving`, `restOf`, joins and new-piece origins. Pure: the
// stage says where it shows things now; the latest description says where they go.
import type { Card, ChangeSet, SeatId, TableModel, Zone } from "../../model";
import type { CardId } from "../../protocol";
import type { Change } from "../../model";
import { order } from "./causality";
import { faceOfCard } from "./faces";
import { dist } from "./motion";
import type { Description, Dest, FlightPlan, MomentView, Origin, Pose } from "./types";

/** Zones the scene draws a card in: a card that leaves one has a departure. */
export const DRAWN: ReadonlySet<Zone> = new Set<Zone>(["battlefield", "stack", "graveyard", "exile", "command"]);

export interface PlanContext {
  /** The latest model and its description: where things go. */
  readonly model: TableModel;
  readonly desc: Description;
  /** The piece that shows a card now (an actor's id), or null. */
  homeOf(card: CardId): string | null;
  /** Where a piece is now, or null. */
  poseOf(piece: string): Pose | null;
  /** The cards a piece shows now. */
  shownOf(piece: string): readonly CardId[];
  readonly moments: readonly MomentView[];
}

type Moved = Extract<Change, { t: "moved" }>;
type Draft = Omit<FlightPlan, "phase" | "cohort" | "rank" | "distance">;

/** Where a card goes, from where the latest description has it (a later set may have moved it again: it goes there). */
function destOf(ctx: PlanContext, card: CardId, was: Card | null, now: Card | null = null): Dest {
  const me = ctx.desc.perspective;
  const home = ctx.desc.home.get(card);
  const piece = home ? ctx.desc.pieces.get(home) : undefined;
  if (piece) {
    if (piece.kind === "hidden") return piece.seat === me ? { to: "hand" } : { to: "nowhere", how: "plate", seat: piece.seat };
    return { to: "piece", piece: piece.id };
  }
  // Out of sight: a token ceases to exist where it stood; a copy of a spell is done; anything else goes to its owner.
  if (was?.token) return { to: "nowhere", how: was.zone === "stack" ? "fizzle" : "burn", seat: was.owner };
  if (was?.copy && was.zone === "stack") return { to: "nowhere", how: "fizzle", seat: was.owner };
  return { to: "nowhere", how: "plate", seat: was?.owner ?? now?.owner ?? null };
}

const plate = (seat: SeatId): Origin => ({ from: "plate", seat });

/** The flights of one change set, ordered by causality (phase and cohort), ranked within their cohorts. */
export function planFlights(set: ChangeSet, ctx: PlanContext): FlightPlan[] {
  const drafts: Draft[] = [];
  const popped = set.changes.filter((c): c is Extract<Change, { t: "popped" }> => c.t === "popped");
  const moved = set.changes.filter((c): c is Moved => c.t === "moved");
  const movedFromStack = new Set(moved.filter((m) => m.from === "stack").map((m) => m.card));
  // What made the newcomers, when only one thing could have (h.js `maker`): the one entry that left the stack.
  const maker = popped.length === 1 ? popped[0]!.item : null;
  const face = (c: Card | null) => (c ? faceOfCard(ctx.model, c) : null);

  for (const m of moved) {
    const card = m.card;
    const was = m.before,
      now = m.after;
    const look = was ?? now;
    const dest = destOf(ctx, card, was, now);
    if (m.from !== null && DRAWN.has(m.from)) {
      const at = ctx.homeOf(card) ?? (m.from === "command" ? `plate:${was?.owner ?? ""}` : null);
      const origin: Origin = at ? { from: "piece", piece: at } : plate(was?.controller ?? was?.owner ?? ctx.desc.perspective);
      const motion: FlightPlan["motion"] =
        dest.to === "nowhere" && dest.how === "burn"
          ? "burn"
          : dest.to === "nowhere" && dest.how === "fizzle"
            ? "fizzle"
            : m.from === "stack"
              ? "spell"
              : m.from === "battlefield"
                ? "depart"
                : "return";
      drafts.push({ key: `c${card}`, card, departure: true, origin, dest, face: face(look), token: !!look?.token, motion });
      continue;
    }
    // From the hand or out of sight: an arrival, if it lands somewhere the scene draws. A card a moment carries comes
    // from where the chrome let it go, even when it was out of sight in between (Forge takes a spell out of the hand
    // while its targets are chosen, and puts it on the stack after).
    // A card bound for a graveyard or exile off the table (an opponent's: the nameplate's focus holds them), a discard or
    // a mill, is shown on its way to its owner's plate.
    const offTable = dest.to === "nowhere" && dest.how === "plate" && (now?.zone === "graveyard" || now?.zone === "exile");
    if (dest.to !== "piece" && !offTable) continue;
    const moment = ctx.moments.find((x) => x.card === card) ?? null;
    const mine = m.from === "hand" || moment !== null;
    const seat = now?.controller ?? now?.owner ?? ctx.desc.perspective;
    const fromMaker =
      !mine && maker !== null && now?.token && maker.controller === seat && ctx.poseOf(`stack:${maker.id}`) ? `stack:${maker.id}` : null;
    const origin: Origin = mine
      ? { from: "hand", moment: moment?.id ?? null, pose: moment?.pose ?? null }
      : fromMaker
        ? { from: "maker", piece: fromMaker }
        : plate(seat);
    const motion: FlightPlan["motion"] = m.to === "stack" ? "cast" : "join";
    drafts.push({ key: `c${card}`, card, departure: false, origin, dest, face: face(now), token: !!now?.token, motion });
  }
  // An ability preview returns to its source if that permanent is still on the field.
  for (const p of popped) {
    if (p.item.source !== null && movedFromStack.has(p.item.source)) continue;
    const piece = `stack:${p.item.id}`;
    if (!ctx.poseOf(piece)) continue;
    const src = p.item.source === null ? null : (ctx.model.cards.get(p.item.source) ?? null);
    const home = !p.item.spell && src?.zone === "battlefield" ? ctx.desc.home.get(src.id) : undefined;
    drafts.push({
      key: `i${p.item.id}`,
      card: null,
      departure: true,
      origin: { from: "piece", piece },
      dest: home ? { to: "piece", piece: home } : { to: "nowhere", how: "plate", seat: p.item.controller },
      face: face(src),
      token: false,
      motion: "withdraw",
    });
  }

  // Order, then rank inside cohorts: the card a pile going whole shows leaves last; joins by how few join their pile.
  const joinCount = new Map<string, number>();
  for (const d of drafts) if (!d.departure && d.dest.to !== "hand" && d.dest.to !== "nowhere") joinCount.set(d.dest.piece, (joinCount.get(d.dest.piece) ?? 0) + 1);
  return drafts.map((d) => {
    const { phase, cohort } = order({ ...d, distance: 0 });
    const from = d.origin.from === "piece" || d.origin.from === "maker" ? ctx.poseOf(d.origin.piece) : null;
    const to = d.dest.to === "piece" ? ctx.poseOf(d.dest.piece) : null;
    let rank = 0;
    if (d.departure && d.origin.from === "piece") {
      const shown = ctx.shownOf(d.origin.piece);
      const leaving = drafts.filter((x) => x.departure && x.origin.from === "piece" && x.origin.piece === (d.origin as { piece: string }).piece);
      if (shown.length > 1 && leaving.length >= shown.length && d.card === shown[0]) rank = 1;
    } else if (!d.departure && (d.dest.to === "piece")) rank = joinCount.get(d.dest.piece) ?? 0;
    return { ...d, phase, cohort, rank, distance: from && to ? dist(from.pos, to.pos) : 0 };
  });
}

/**
 * The hand-off of cards the chrome held while the sets that bring them were taken without playing them (a collapsed
 * backlog, a cut): each flies from the pose its moment carries to where the latest description has it, as a cast (onto
 * the stack) or a join. A card the description does not draw on the table (back in a hand, out of sight) has none.
 */
export function handOffFlights(held: readonly MomentView[], ctx: PlanContext): FlightPlan[] {
  const out: FlightPlan[] = [];
  for (const m of held) {
    const now = ctx.model.cards.get(m.card) ?? null;
    const dest = destOf(ctx, m.card, null);
    if (!now || (dest.to !== "piece")) continue;
    const draft: Omit<FlightPlan, "phase" | "cohort"> = {
      key: `c${m.card}`,
      card: m.card,
      departure: false,
      origin: { from: "hand", moment: m.id, pose: m.pose },
      dest,
      face: faceOfCard(ctx.model, now),
      token: now.token,
      motion: now.zone === "stack" ? "cast" : "join",
      rank: 0,
      distance: 0,
    };
    out.push({ ...draft, ...order(draft) });
  }
  return out;
}
