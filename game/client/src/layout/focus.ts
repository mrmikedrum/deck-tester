// The table's focus layers on the arrangement engine (docs "layout"; engine §2.8): a pile opened (its cards singly, as
// a sheet brought nearer) and a seat's spread ("See X's board": every permanent of that seat under its tier's caption).
// Both are arranged from the committed plan and the model, so opening one never replans the table; the stack as the
// focus is the plan's own `stackUp`. Pure.
import type { TableModel } from "../model";
import { arrCard } from "./arrange/card";
import type { ArrCard, CardPlace } from "./arrange/contract";
import { pileUnits, spreadUnits } from "./arrange/policies/sheet";
import { S_TABLE } from "./arrange/scale";
import { arrangeSheet, referenceHeight } from "./arrange/sheet";
import type { Sheet } from "./arrange/sheet";
import type { TablePlan } from "./plan";
import { bounds } from "./shape";
import { tableTemplate } from "./template";
import type { CardId, Rect, SeatId } from "./types";
import { designUnit } from "./types";
import { CH } from "./geometry";

/** What a focus sheet shows: one pile (a hit group, or a graveyard or exile by its group id), or one seat's spread. */
export type SheetFocus = { readonly kind: "pile"; readonly group: string } | { readonly kind: "spread"; readonly seat: SeatId };

/** The room a sheet keeps, design px: from under the nameplates and the sheet's caption bar, inside the gutters, above
 *  the screen's foot. */
export const SHEET_ROOM = { top: 116, side: 20, foot: 14 } as const;

/** A pile's cards, as its sheet takes them, and whose they are. */
export interface PileCards {
  readonly ids: readonly CardId[];
  /** A graveyard or exile, which keeps its order; else a pile on the battlefield. */
  readonly zone: "graveyard" | "exile" | null;
  /** Whose: the group's seat, or the seat a zone group names (its pile off the table). */
  readonly seat: SeatId | null;
}

const ZONE_GROUP = /^zone:(graveyard|exile):(.+)$/;

/** The seat a zone group names ("zone:<zone>:<seat>"), when the model has it. */
const zoneSeat = (model: TableModel, name: string): SeatId | null => model.seats.find((x) => String(x.id) === name)?.id ?? null;

/**
 * A group's cards in its pile's order: a pile on the battlefield with like cards together (the most first, ready before
 * tapped); a graveyard or exile in its order, whether or not it lies on the table. Null when there is no such group.
 */
export function pileCards(model: TableModel, plan: TablePlan, group: string): PileCards | null {
  const g = plan.hits.groups.find((x) => x.id === group);
  const m = ZONE_GROUP.exec(group);
  const zone = m ? (m[1] as "graveyard" | "exile") : null;
  const seat = g?.seat ?? (m ? zoneSeat(model, m[2]!) : null);
  if (!g && (!zone || !seat)) return null;
  if (zone) return { ids: [...model.zone(seat!, zone)], zone, seat };
  const by = new Map<string, CardId[]>();
  for (const id of g!.members) {
    const k = model.cards.get(id)?.name ?? "";
    by.set(k, [...(by.get(k) ?? []), id]);
  }
  const tapped = (id: CardId): boolean => model.cards.get(id)?.tapped ?? false;
  const ids = [...by.values()].sort((a, b) => b.length - a.length).flatMap((cs) => [...cs.filter((id) => !tapped(id)), ...cs.filter(tapped)]);
  return { ids, zone: null, seat: seat ?? null };
}

/** A sheet with what it was made from: the cards it holds in order, whose they are, and where each card rests now. */
export interface FocusSheet extends Sheet {
  readonly seat: SeatId | null;
  readonly zone: "graveyard" | "exile" | null;
  /** Every card the sheet holds, over all its pages, in order. */
  readonly cards: readonly CardId[];
  /** The hit group each card rests in on the table (it flies out of it and back), when it has one. */
  readonly from: ReadonlyMap<CardId, string>;
}

const kept = new WeakMap<TablePlan, Map<string, FocusSheet | null>>();

/** Where a sheet may lie on screen (under the nameplates and its caption bar, inside the gutters, the hand away) and the
 *  chrome it keeps clear of there: the prompt, which stays up. */
function roomOf(plan: TablePlan): { area: Rect; keepouts: Rect[] } {
  const u = designUnit(plan.viewport), safe = plan.reserve.safe;
  const area = { left: safe.left + SHEET_ROOM.side * u, right: safe.right - SHEET_ROOM.side * u, top: safe.top + SHEET_ROOM.top * u, bottom: safe.bottom - SHEET_ROOM.foot * u };
  return { area, keepouts: plan.reserve.items.filter((i) => i.kind === "prompt").map((i) => i.rect) };
}

/** Where each seat's unit shows a card on its leaf, as an order: its row from the front, then across from the left. */
function leafRank(plan: TablePlan, seat: SeatId): (id: CardId) => number {
  const fit = plan.leaves?.get(seat)?.result?.fit ?? (plan.mine?.seat === seat ? plan.mine.result?.fit : undefined);
  const at = new Map<CardId, number>();
  if (fit) {
    const units = [...fit.units].sort((a, b) => a.slot.row - b.slot.row || mid(a.cards) - mid(b.cards));
    units.forEach((un, i) => [...un.members, ...un.dressing].forEach((id, k) => at.set(id, i * 1000 + k)));
  }
  return (id) => at.get(id) ?? 1e9;
}
const mid = (cards: readonly CardPlace[]): number => {
  const q = cards.at(-1)?.quad;
  if (!q) return 0;
  const b = bounds(q);
  return (b.l + b.r) / 2;
};

/**
 * The sheet a focus shows on `page`: its cards arranged by the engine (sheet.ts), the policy's order (a pile's own; a
 * spread's by tier, as its leaf shows them), offered first while the decision up chooses cards. Null when there is nothing
 * to show (the pile is gone, the seat has no permanents).
 */
export function sheetOf(model: TableModel, plan: TablePlan, focus: SheetFocus, page = 0): FocusSheet | null {
  const key = `${model.gen}|${model.rev}|${focus.kind}|${focus.kind === "pile" ? focus.group : focus.seat}|${page}`;
  let memo = kept.get(plan);
  if (!memo) kept.set(plan, (memo = new Map()));
  if (memo.has(key)) return memo.get(key)!;
  const sheet = make(model, plan, focus, page);
  if (memo.size > 16) memo.clear();
  memo.set(key, sheet);
  return sheet;
}

function make(model: TableModel, plan: TablePlan, focus: SheetFocus, page: number): FocusSheet | null {
  const ctx = { offered: plan.decision.offered, choosing: plan.decision.choosing };
  const card = (id: CardId, zone: boolean): ArrCard | null => {
    const c = arrCard(model, id);
    return c && zone ? { ...c, tapped: false } : c;
  };
  let seat: SeatId | null, zone: PileCards["zone"] = null, id: string, units;
  if (focus.kind === "pile") {
    const pc = pileCards(model, plan, focus.group);
    if (!pc || !pc.ids.length) return null;
    const cs = pc.ids.flatMap((x) => card(x, pc.zone !== null) ?? []);
    [seat, zone, id] = [pc.seat, pc.zone, `pile:${focus.group}`];
    units = pileUnits(cs, ctx);
  } else {
    const sp = plan.seats.get(focus.seat);
    if (!sp) return null;
    const cs = [...sp.home.keys()].flatMap((x) => card(x, false) ?? []);
    if (!cs.length) return null;
    [seat, id] = [focus.seat, `spread:${focus.seat}`];
    units = spreadUnits(cs, leafRank(plan, focus.seat), ctx);
  }
  const cards = units.flatMap((x) => [...x.cards]);
  // Nearer than where its cards came from: my field line for mine, a leaf's front line for anyone else's.
  const tpl = tableTemplate(Math.max(1, Math.min(4, plan.seats.size)));
  const from = seat === model.viewer.perspective ? tpl.mine.field : tpl.leaf.front;
  const ref = referenceHeight(plan.projector, { x: 0, y: (CH * S_TABLE) / 2, z: from });
  const laid = arrangeSheet({ id, role: focus.kind, units, projector: plan.projector, ...roomOf(plan), u: designUnit(plan.viewport), ref, page, choosing: ctx.choosing });
  const rests = new Map<CardId, string>();
  for (const sp of plan.seats.values()) for (const un of sp.units) for (const c of [...un.members, ...un.dressing]) if (!rests.has(c)) rests.set(c, un.id);
  return { ...laid, seat, zone, cards, from: rests };
}
