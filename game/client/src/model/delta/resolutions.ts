// What left the stack between two models: every popped item, and every resolution only the log saw (a spell cast and
// resolved inside one poll interval, which no snapshot shows on the stack). Each carries the cards the log names from
// its resolution up to the next stack event: what the log says it did.
import type { CardId, LogEntry } from "../../protocol";
import type { Card } from "../card";
import type { SeatId } from "../ids";
import { departureIn, entryText, logCards } from "../readings";
import type { StackItem, TableModel } from "../table";
import type { Change, PopKind } from "./changes";

export interface Resolution {
  /** Index of the popped change, or null for a resolution only the log saw. */
  readonly popped: number | null;
  readonly item: StackItem | null;
  /** The card it came from, as last seen. */
  readonly card: Card | null;
  readonly how: PopKind;
  readonly spell: boolean;
  readonly controller: SeatId | null;
  /** h.js `entryText`: its own text, and a spell's rules text. */
  readonly text: string;
  /** Index of its card's move off the stack (or, unseen, out of the hand), when its card moved. */
  readonly move: number | null;
  /** Its STACK_RESOLVE entry's position in the fresh log, and where the next stack event starts. */
  readonly span: { readonly from: number; readonly to: number } | null;
  /** The cards the log names inside its span. */
  readonly named: ReadonlySet<CardId>;
}

const STACK_EVENT = /^(STACK_RESOLVE|STACK_ADD|TURN|LAND)$/i;

function spanOf(fresh: readonly LogEntry[], from: number): { from: number; to: number } {
  let to = from + 1;
  while (to < fresh.length && !STACK_EVENT.test(fresh[to]!.type)) to++;
  return { from, to };
}

function namedIn(fresh: readonly LogEntry[], span: { from: number; to: number } | null): Set<CardId> {
  const out = new Set<CardId>();
  if (span) for (let i = span.from; i < span.to; i++) logCards(fresh[i]!).forEach((id) => out.add(id));
  return out;
}

const isResolve = (e: LogEntry): boolean => /^STACK_RESOLVE$/i.test(e.type);

/**
 * Each popped item (top first, as the changes list them) reads the first resolution entry no earlier item read; the
 * entries left over are resolutions only the log saw, one each, even when one source made several (two triggers of
 * one creature). An entry whose card still has an item on the stack is not one: the view may have been read between
 * that item's resolution and its leaving the stack.
 */
export function resolutionsOf(prev: TableModel, next: TableModel, changes: readonly Change[], fresh: readonly LogEntry[]): Resolution[] {
  const moveOf = new Map<CardId, number>();
  changes.forEach((c, i) => c.t === "moved" && moveOf.set(c.card, i));
  const out: Resolution[] = [];
  const read = new Set<number>();
  const spells = new Set<CardId>(); // a card's move off the stack (or out of the hand) is one spell's, never two
  changes.forEach((c, i) => {
    if (c.t !== "popped") return;
    const src = c.item.source;
    const card = src === null ? null : (prev.cards.get(src) ?? next.cards.get(src) ?? null);
    const m = src === null ? undefined : moveOf.get(src);
    const move = m !== undefined && (changes[m] as Extract<Change, { t: "moved" }>).from === "stack" ? m : null;
    const r = fresh.findIndex((e, k) => !read.has(k) && isResolve(e) && departureIn(e, c.item, card?.name ?? "") !== null);
    if (r >= 0) read.add(r);
    if (move !== null && src !== null) spells.add(src);
    const span = r < 0 ? null : spanOf(fresh, r);
    out.push({ popped: i, item: c.item, card, how: c.how, spell: c.item.spell, controller: c.item.controller, text: entryText(c.item, prev), move, span, named: namedIn(fresh, span) });
  });
  const onStack = new Set(next.stack.map((s) => s.source));
  fresh.forEach((e, r) => {
    if (read.has(r) || !isResolve(e) || e.card === null || onStack.has(e.card)) return;
    const card = next.cards.get(e.card) ?? prev.cards.get(e.card) ?? null;
    const m = moveOf.get(e.card);
    const moved = m === undefined || spells.has(e.card) ? null : (changes[m] as Extract<Change, { t: "moved" }>);
    const spell = !!moved && moved.from !== "battlefield" && moved.to !== null && moved.to !== "hand";
    if (spell) spells.add(e.card);
    const span = spanOf(fresh, r);
    const how: PopKind = /fizzl/i.test(e.text) ? "fizzled" : /countered/i.test(e.text) ? "countered" : "resolved";
    out.push({
      popped: null,
      item: null,
      card,
      how,
      spell,
      controller: card?.controller ?? null,
      text: spell && card && !card.faceDown ? " " + card.face.text : "",
      move: spell ? m! : null,
      span,
      named: namedIn(fresh, span),
    });
  });
  return out;
}
