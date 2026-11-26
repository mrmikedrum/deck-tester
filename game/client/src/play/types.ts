// The decision controller's vocabulary: what goes in (events, acts), what comes out (effects) and what it presents
// (board cues for the scene, controls for the chrome). See docs/game-client-architecture.md ("play"). The identities
// it shares with the app and the transport (stops, answer tokens and outcomes, continuity, stamps) live in protocol.
import type { AnswerRequest, AnswerToken, CardId, CommitId, Continuity, Decision, Stamp, StopId } from "../protocol";
import type { SeatId, TableModel, Target as ModelTarget } from "../model";
import type { HitGroups, Rect } from "../layout";
import type { StackSummaryRow } from "./text";

export type { StackSummaryRow };

export type { AnswerToken, CommitId, Continuity, Stamp, StopId };

/** Milliseconds on the platform clock: every event says when it happened; play never reads a clock. */
export type Ms = number;

/** A hit group's id (layout's `HitGroup.id`). */
export type HitGroupId = string;

/** Where a card was on screen when the chrome let it go. */
export interface ScreenPose {
  readonly rect: Rect;
  readonly rotation: number;
  readonly scale: number;
}
/** A released hand card, carried through an offer sheet to the answer that plays it. */
export interface Carried {
  readonly card: CardId;
  readonly pose: ScreenPose;
}

// ---- In ----------------------------------------------------------------------------------------------------------

export type Event =
  | {
      readonly t: "snapshot";
      readonly at: Ms;
      /** Null before a game has a view (no game, starting, an error): play forgets everything. */
      readonly model: TableModel | null;
      readonly decision: Decision | null;
      readonly continuity: Continuity;
      /**
       * A decision is parked that the host is not offering yet (its cards' data is on its way; `decision` is null): the
       * prompt waits with no buttons, and nothing is armed. The host offers it in a later snapshot event.
       */
      readonly held?: boolean;
    }
  | { readonly t: "hits"; readonly at: Ms; readonly hits: HitGroups }
  /** `stop`: the stop the control or cue was drawn for; null when none was (a tap with no decision up). */
  | { readonly t: "act"; readonly stamp: Stamp; readonly stop: StopId | null; readonly act: Act }
  /**
   * The host's answer ledger settled the answer under `token` (null: the bridge's own, adopted by `working`): the
   * prompt is free, with the reason for a refusal and a word for a lost request. Play never frees an answer from the
   * bridge's status itself; the ledger, which matches a status to its attempt, is the one source of settlement.
   */
  | {
      readonly t: "settled";
      readonly at: Ms;
      readonly token: AnswerToken | null;
      readonly how: "applied" | "refused" | "unseen" | "superseded" | "lost";
      readonly reason: string | null;
    }
  /** The bridge is working on an answer to this stop that this page did not send (a reload): busy until `settled`. */
  | { readonly t: "working"; readonly at: Ms; readonly stop: StopId }
  | { readonly t: "link"; readonly at: Ms; readonly up: boolean }
  | { readonly t: "deadline"; readonly at: Ms; readonly id: string };

/** What a gesture landed on. A group carries its members as drawn: if they changed since, the act is dropped. */
export type Target =
  | { readonly card: CardId }
  | { readonly group: HitGroupId; readonly members: readonly CardId[] }
  | { readonly seat: SeatId }
  | { readonly nothing: true };

export type Act =
  | { readonly a: "tap"; readonly on: Target }
  | { readonly a: "drag"; readonly from: Target; readonly onto: Target }
  /**
   * A hand card let go in play mode; `dy` is how far it moved (negative is up); `overTable`: let go over the table (on
   * screen, not over the hand or the prompt), as the chrome, which knows where its own parts are, saw it. The 90 px rule
   * is play's, and it plays only a card let go over the table.
   */
  | { readonly a: "release"; readonly card: CardId; readonly dy: number; readonly pose: ScreenPose; readonly overTable: boolean }
  | { readonly a: "press"; readonly button: ButtonId }
  /** A sheet item by option number; with `card`, the inspector's action on that card (whatever sheet is open). */
  | { readonly a: "pick"; readonly option: number; readonly card?: CardId }
  /** The number stepper. */
  | { readonly a: "step"; readonly by: number }
  | { readonly a: "dismiss" };

// ---- Out ---------------------------------------------------------------------------------------------------------

export type Effect =
  | {
      readonly kind: "send";
      readonly token: AnswerToken;
      readonly stop: StopId;
      readonly body: AnswerRequest;
      readonly carried: Carried | null;
    }
  /** Schedule (ms) or cancel (null) the deadline `id`; it comes back as a `deadline` event. */
  | { readonly kind: "deadline"; readonly id: string; readonly ms: number | null }
  | { readonly kind: "toast"; readonly text: string }
  /** Card data a sheet will show that the table does not hold. */
  | { readonly kind: "cards"; readonly names: readonly string[] }
  /** Something the engine sent that play could only show generically (never hidden). */
  | { readonly kind: "warn"; readonly text: string }
  /** Open the inspector on this card; its actions are `Controls.cardActions`. */
  | { readonly kind: "inspect"; readonly card: CardId }
  /** Play did not use this act: the app applies its default (inspect, sift, lean, dismiss the stack layer). */
  | { readonly kind: "unclaimed" }
  /** Open this group's members (its sift) for the player to choose one: a gesture meant one of several. */
  | { readonly kind: "choose"; readonly group: string };

export interface Step {
  readonly state: State;
  readonly effects: readonly Effect[];
}

/** Opaque, JSON-serialisable. Read it only through `present`. */
export type State = { readonly __play: unique symbol };

// ---- Presented ---------------------------------------------------------------------------------------------------

export type Mark = "option" | "selected" | "danger";
/** What lights up. A pile shows the strongest mark of its members (the scene's call). */
export interface Marks {
  readonly cards: ReadonlyMap<CardId, Mark>;
  readonly seats: ReadonlyMap<SeatId, Mark>;
  /** Hand cards with a play. */
  readonly hand: ReadonlySet<CardId>;
}

/** The attacks and blocks picked so far, drawn as lanes before they are sent. Null: show the engine's combat. */
export interface CombatDraft {
  readonly attacks: readonly { readonly attacker: CardId; readonly defender: ModelTarget }[];
  readonly blocks: readonly { readonly blocker: CardId; readonly attacker: CardId }[];
}

export interface BoardCues {
  readonly stop: StopId | null;
  readonly marks: Marks;
  readonly combat: CombatDraft | null;
  readonly handAway: boolean;
}

/** Issued by `present`, echoed by a `press` act. Never constructed elsewhere. */
export type ButtonId = string;
export type ButtonRole = "pass" | "choice" | "hold" | "defer" | "stack" | "done" | "clear";
export interface Button {
  readonly id: ButtonId;
  readonly label: string;
  readonly tone: "primary" | "secondary";
  readonly role: ButtonRole | null;
  /** Disabled buttons are shown, not hidden ("Done" below the minimum). */
  readonly enabled: boolean;
  /** Small text after the label (a response button's choices). */
  readonly detail: string | null;
  /** A braced mana cost after the label. */
  readonly cost: string | null;
  /** The pass button while auto-pass counts down. */
  readonly countdown: boolean;
}

export interface PromptView {
  /** "Turn 9 · Your second main". */
  readonly where: string;
  readonly headline: string;
  readonly hint: string | null;
  /** What the choice is about: the spell on top, the source's text. */
  readonly context: string | null;
  /** "Floating mana: 2 {G}". */
  readonly floating: string | null;
  readonly tone: "normal" | "threat";
  /** "overlay": the mulligan, over a dimmed table with the hand away. */
  readonly style: "bar" | "overlay";
  readonly buttons: readonly Button[];
  /** Auto-pass running: since when, and for how long (the chrome draws the countdown). */
  readonly countdown: { readonly from: Ms; readonly ms: number } | null;
  readonly busy: boolean;
  /** live.js `stackSummary`: the stack, top first (the next to resolve first); empty when it is. */
  readonly stack: readonly StackSummaryRow[];
}

export interface SheetItem {
  readonly option: number;
  readonly label: string;
  readonly cost: string | null;
  readonly detail: string | null;
  /** The card to show, when the option is one the table holds. */
  readonly card: CardId | null;
  /** Otherwise the card name to show by, when the option names one. */
  readonly name: string | null;
  readonly picked: boolean;
  /** An order number, or how many times a repeatable option is picked. */
  readonly badge: number | null;
}

export interface SheetView {
  /** plays: one card's or every play; chooser: a choice made in a sheet; source/mana: which source, which colour;
   * number: the stepper; stack: the stack's rules (the chrome draws it from the model). */
  readonly kind: "plays" | "chooser" | "source" | "mana" | "number" | "stack";
  readonly title: string;
  readonly wide: boolean;
  readonly items: readonly SheetItem[];
  readonly stepper: { readonly min: number; readonly max: number; readonly value: number } | null;
  readonly buttons: readonly Button[];
  /** Released hand card the sheet holds; the chrome keeps drawing it where it was let go. */
  readonly carried: Carried | null;
}

export interface CardAction {
  readonly option: number;
  readonly label: string;
  readonly cost: string | null;
}

export interface Controls {
  readonly stop: StopId | null;
  readonly mayAnswer: boolean;
  readonly prompt: PromptView | null;
  readonly sheet: SheetView | null;
  /** The inspector's buttons for a card: pressing one is a `pick` of its option. */
  readonly cardActions: ReadonlyMap<CardId, readonly CardAction[]>;
}

export interface Presentation {
  readonly board: BoardCues;
  readonly controls: Controls;
}
