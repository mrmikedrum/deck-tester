// Ids and small vocabulary the model adds to the wire's: seats, zones, targets.
import type { CardId, PlayerName } from "../protocol";

/**
 * A seat at the table, stable for the session. The bridge names each seat once per game and never reuses a name
 * (game.py dedupes them), and a player keeps the name after losing, so the name is the identity; it is branded so
 * nothing mistakes a display name or an array position for a seat.
 */
export type SeatId = string & { readonly __seat: unique symbol };

export const seatId = (name: PlayerName | string): SeatId => name as SeatId;

/** Where a card is, as the client can see it. The library is never visible; a card that went there is gone. */
export type Zone = "hand" | "battlefield" | "graveyard" | "exile" | "command" | "stack";
export const ZONES: readonly Zone[] = ["battlefield", "command", "graveyard", "exile", "hand", "stack"];

/** Forge's phase name (`MAIN1`, `COMBAT_DAMAGE`...; "setup" before the first turn). Unknown names pass. */
export type Phase = string;

/** A keyword the engine shows ("Flying", "First strike"...). */
export type Keyword = string;

/** What a spell, an ability or an attacker points at: a card or a seat. */
export type Target = { readonly card: CardId } | { readonly seat: SeatId };

export const isCardTarget = (t: Target): t is { readonly card: CardId } => "card" in t;
