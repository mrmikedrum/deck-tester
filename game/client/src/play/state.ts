// Play's state, behind the opaque `State`: the current decision and its stop, the player's draft, the open sheet, the
// answer in flight and the auto-pass countdown. Plain data only (no maps, sets or functions), so it serialises.
import type { CardId, Decision, StackId } from "../protocol";
import type { SeatId } from "../model";
import type { Facts } from "./facts";
import type { AnswerToken, Carried, HitGroupId, Ms, State, StopId, Target } from "./types";

/** A hit group as play keeps it: what it holds, not where it is. */
export interface Group {
  readonly id: HitGroupId;
  readonly kind: string;
  readonly seat: SeatId | null;
  readonly members: readonly CardId[];
}

/** The player's picks so far. One shape for every kind; each kind reads what it uses. */
export interface Draft {
  /** Option numbers in the order picked. */
  readonly sel: readonly number[];
  /** block: the blocker waiting for its attacker. */
  readonly holding: CardId | null;
  /** attack: who new attackers go at (a seat, or a planeswalker's card). */
  readonly attackTo: string | number | null;
  /** number: the stepper's value. */
  readonly value: number;
  /** targets, choose: board or sheet, fixed once the player has picked. */
  readonly mode: "board" | "sheet" | null;
}

export type Sheet =
  | { readonly k: "plays"; readonly title: string; readonly options: readonly number[]; readonly carried: Carried | null }
  | { readonly k: "chooser" }
  | { readonly k: "mana"; readonly card: CardId; readonly options: readonly number[] }
  | { readonly k: "stack" };

/** A tap, or a drag from one target onto another: what a gesture landed on, as drawn. */
export type Gesture =
  | { readonly a: "tap"; readonly at: Target }
  | { readonly a: "drag"; readonly from: Target; readonly onto: Target };

/** A gesture that meant one of a group's distinct members, waiting for the player to choose which (in its sift). */
export interface Pending {
  readonly gesture: Gesture;
  /** Which end of it the group was. */
  readonly end: "at" | "from" | "onto";
  readonly group: HitGroupId;
}

export interface S {
  /** Increments with every stop adopted; never reset, so a stop id is never reused in a session. */
  readonly serial: number;
  readonly tokens: number;
  readonly facts: Facts | null;
  readonly decision: Decision | null;
  readonly stop: StopId | null;
  readonly groups: readonly Group[];
  readonly draft: Draft;
  /** A sheet the player opened (or play opened for them). */
  readonly sheet: Sheet | null;
  /** A sheet-mode choice's chooser, set aside by the player. */
  readonly chooserClosed: boolean;
  /** A gesture waiting for the player to choose one of a group's members; it completes with the card chosen. */
  readonly pending: Pending | null;
  /** The answer out for this stop: play's token, or null for the bridge's own (a reload while it worked on one). */
  readonly inflight: { readonly token: AnswerToken | null; readonly stop: StopId } | null;
  readonly auto: { readonly id: string; readonly from: Ms; readonly ms: number } | null;
  /** A decision is parked but the host holds it back until its cards' data arrives: the prompt waits, no buttons. */
  readonly held: boolean;
  /**
   * The play I sent last (live.js `playChoice`): the cards it plays, and who chose it ("Your choice", or "Forge chose"
   * for "Let Forge decide"). The first of my stack items to arrive that plays one of them is labelled so; it goes once
   * used, refused or lost, or when a new play decision comes.
   */
  readonly choice: {
    readonly token: AnswerToken;
    readonly refs: readonly { readonly card: CardId; readonly spell: boolean }[];
    readonly label: string;
  } | null;
  /** Stack items labelled with who chose them (live.js `st.actor`), for the stack summary's `who`. */
  readonly actors: readonly { readonly item: StackId; readonly label: string }[];
}

export const EMPTY_DRAFT: Draft = { sel: [], holding: null, attackTo: null, value: 0, mode: null };

export const INITIAL: S = {
  serial: 0,
  tokens: 0,
  facts: null,
  decision: null,
  stop: null,
  groups: [],
  draft: EMPTY_DRAFT,
  sheet: null,
  chooserClosed: false,
  pending: null,
  inflight: null,
  auto: null,
  held: false,
  choice: null,
  actors: [],
};

export const open = (s: State): S => s as unknown as S;
export const seal = (s: S): State => s as unknown as State;

/** What a game reset keeps: the counters that make stop ids and tokens unique. */
export const reset = (s: S): S => ({ ...INITIAL, serial: s.serial, tokens: s.tokens });
