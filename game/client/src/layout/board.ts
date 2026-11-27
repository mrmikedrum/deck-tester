import { sig } from "../model";
import type { Card, TableModel } from "../model";
import type { CardId, SeatId } from "./types";

// A seat's battlefield as the table plan takes it: which permanents are drawn on which seat, and the few facts the plan
// reads beside the arrangement engine's own (arrange/card.ts reads each card from the model).

/** One permanent. */
export interface BoardCard {
  readonly id: CardId;
  /**
   * Identical-to-the-eye key (the old `groupKey`): same card, copy-of, transformed, tapped, face-down, summoning sick,
   * goaded, counters, and power/toughness. The clash stands unblocked attackers alike in every fact as one column.
   */
  readonly sig: string;
  readonly tapped: boolean;
  /** The clash's tallies count it. */
  readonly power: number | null;
  /** The permanent this one is attached to (an Aura, Equipment). A host not on this board makes it a card of its own. */
  readonly attachedTo: CardId | null;
}

/**
 * The cards drawn on a seat: the permanents it controls, minus any attached to another seat's permanent (that is drawn
 * with its host), plus the Auras and Equipment other seats attached to its own. So every card on screen is on exactly
 * one board. (The old code drew an attachment wherever its host stood.)
 */
export interface SeatBoard {
  readonly seat: SeatId;
  /** The viewer's own seat: its creatures meet the 72 px floor, others' 56 (never inferred from the slot). */
  readonly mine: boolean;
  readonly cards: readonly BoardCard[];
}

/** The floors (intent.md "Hard limits"), card face width on screen in design px (1180x820). */
export const FLOOR = { mine: 72, theirs: 56, any: 44 } as const;
/**
 * The tappable patch (intent.md "Hard limits": Apple's 44 pt), in CSS px at every viewport: floors scale with the design
 * unit, a finger does not. Below 1180x820 it is larger than the 44 design px floor, so sizing meets both.
 */
export const TAP_PX = 44;
/** A permanent's layout facts, from the model's predicates. */
export function boardCard(c: Card): BoardCard {
  return { id: c.id, sig: sig(c), tapped: c.tapped, power: c.power, attachedTo: c.attachedTo };
}

/**
 * A seat's board: the permanents it controls, minus those attached to another seat's permanent (drawn with their
 * host), plus other seats' Auras and Equipment attached to its own. A host that is not on the battlefield leaves the
 * attachment on its controller's board.
 */
export function boardOf(model: TableModel, seat: SeatId): SeatBoard {
  const onField = (id: CardId | null) => (id === null ? undefined : model.cards.get(id));
  const host = (c: Card) => {
    const h = onField(c.attachedTo);
    return h && h.zone === "battlefield" ? h : undefined;
  };
  const drawnOn = (c: Card): SeatId => host(c)?.controller ?? c.controller;
  const cards: Card[] = [];
  for (const s of model.seats)
    for (const id of model.zone(s.id, "battlefield")) {
      const c = model.cards.get(id);
      if (c && drawnOn(c) === seat) cards.push(c);
    }
  return { seat, mine: seat === model.viewer.perspective, cards: cards.map(boardCard) };
}

/** Every seat's board, in the model's seat order (the perspective first). Seats that are out have empty boards. */
export function boards(model: TableModel): { readonly seat: SeatId; readonly board: SeatBoard }[] {
  return model.seats.map((s) => ({ seat: s.id, board: boardOf(model, s.id) }));
}
