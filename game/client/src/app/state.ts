// AppState: everything more than one module reads. Renderers keep only private motion state. Focus is app/focus.ts.
import type { CommitId, Continuity, Decision, Snapshot, StopId } from "../protocol";
import type { Insets, Ms } from "../platform";
import { NO_INSETS } from "../platform";
import type { CardCatalog, ChangeSet, SeatId, TableModel, Viewer } from "../model";
import { EMPTY_CATALOG } from "../model";
import type { LayoutMemory, Paradigm, Reservations, TablePlan } from "../layout";
import { reservations } from "../layout";
import * as narrative from "../narrative";
import * as play from "../play";
import type { AnswerLedger } from "./answers";
import { NO_ANSWERS } from "./answers";
import type { Deadlines } from "./deadlines";
import { NO_DEADLINES } from "./deadlines";
import type { FaultState } from "./faults";
import { NO_FAULTS } from "./faults";
import type { MomentsState } from "./moments";
import { NO_MOMENTS } from "./moments";
import type { NewGameRequest } from "../transport";
import { NO_FOCUS_STATE } from "./focus";
import type { FocusState } from "./focus";

export interface SessionState {
  /** The bridge's state, or "connecting" before the first snapshot. */
  readonly bridge: Snapshot["state"] | "connecting";
  readonly gen: number | null;
  readonly v: number | null;
  readonly link: "unknown" | "up" | "down";
  /** The build the bridge serves, and this bundle's. */
  readonly build: string | null;
  readonly clientBuild: string;
  /** The bridge serves another build: this page is stale and should offer Reload. */
  readonly stale: boolean;
  readonly viewer: Viewer | null;
  readonly error: string | null;
  readonly over: string | null;
  readonly continuity: Continuity | null;
  /** The last snapshot taken (the model is made again from it when card data arrives). */
  readonly snap: Snapshot | null;
  /** The pending decision, and the stop play adopted for it (play's `controls.stop`). */
  readonly decision: Decision | null;
  readonly stop: StopId | null;
  /** The last /api/new reply and /api/decks list (null until asked, or after a failure, with the error). */
  readonly started: { readonly ok: boolean; readonly error: string | null } | null;
  readonly decks: { readonly list: readonly string[] | null; readonly error: string | null } | null;
  /** The last game asked for (remembered by the page, best effort): the Game menu starts from it. */
  readonly lastGame: NewGameRequest | null;
}

export interface ViewportState {
  readonly w: number;
  readonly h: number;
  readonly safe: Insets;
}

/** Ordered, revisioned change sets the scene has not consumed yet. */
export interface ChangeQueue {
  readonly sets: readonly ChangeSet[];
  /** The last seq given: never reset in a page's life, so seqs only rise. */
  readonly seq: number;
  /** The next commit cuts the table (a first model, a new game, a rewind, a restart, teardown). */
  readonly cut: boolean;
  /**
   * The pending cut is the queue's own, past its limit: every set that waits is skipped by it, unseen, so the app
   * recaps what must not be missed in each (the scene recaps nothing it cuts). Cleared when the cut is drawn.
   */
  readonly overflow: boolean;
}

export interface AppState {
  readonly session: SessionState;
  readonly model: TableModel | null;
  /** Card data the bridge has served (`/api/cards`), merged into every model. */
  readonly catalog: CardCatalog;
  /** Card data asked of the bridge: requests out (name to the epoch they were made in: a reply from an older epoch is
   * discarded, so its names are asked again) and names answered (asked once a page). */
  readonly cardAsks: CardAsks;
  readonly gate: DecisionGate;
  readonly changes: ChangeQueue;
  readonly plan: TablePlan | null;
  /** The scene's last report said cards are in flight between zones (`flying`): layout holds pages' shape meanwhile. */
  readonly settling: boolean;
  /** What the plan was computed from (null: no plan); a plan whose inputs are unchanged is kept. */
  readonly planKey: string | null;
  readonly layoutMemory: ReadonlyMap<SeatId, LayoutMemory>;
  /** Which table the page lays out (fixed for the page): today's mats or focus-first's leaves. */
  readonly paradigm: Paradigm;
  /** The decision controller: lives for the page (its counters keep stops and tokens unique), never reset. */
  readonly play: play.State;
  /** The log, the notices waiting on the table's motion, my losses, the recaps and the toasts (narrative/). */
  readonly narrative: narrative.State;
  /** The focus layers, top last, and those set aside. */
  readonly focus: FocusState;
  readonly viewport: ViewportState;
  /** The hit group under a mouse pointer on the canvas (a `pick`'s id), or null: paint only, the plan never changes. */
  readonly hover: string | null;
  /** Reduced motion is asked for (`prefers-reduced-motion`): the scene shortens its moves; decision timing never changes. */
  readonly reducedMotion: boolean;
  readonly reserve: Reservations;
  readonly moments: MomentsState;
  readonly answer: AnswerLedger;
  readonly deadlines: Deadlines;
  readonly faults: FaultState;
  readonly commit: CommitId;
  /**
   * What the last commit put on screen that a dismissal acts on: the top focus layer (focus.ts `topKey`) and the stop.
   * An Escape or ✕ takes down only what the player saw, never a layer that came up since (a sheet just arrived).
   */
  readonly drawn: { readonly top: string | null; readonly stop: StopId | null };
  /** Local: moves on with a new game asked for, a newGame or restart continuity, and teardown. */
  readonly epoch: number;
}

/**
 * When a decision becomes actionable: one whose cards' data has not arrived is held back from play (the table still
 * shows; the prompt waits) until it does, or until the cap runs out.
 */
export interface DecisionGate {
  /** The decision held back (its gen, id and key) and since when. */
  readonly held: { readonly id: string; readonly since: Ms } | null;
  /** The last decision offered to play: the same decision in a later snapshot is not held again. */
  readonly offered: string | null;
}

export const NO_GATE: DecisionGate = { held: null, offered: null };

export interface CardAsks {
  readonly out: ReadonlyMap<string, number>;
  readonly done: ReadonlySet<string>;
  /** Names whose request failed: asked again with the next snapshot, never at once (a failing bridge is not hammered). */
  readonly failed: ReadonlySet<string>;
}

export const NO_CHANGES: ChangeQueue = { sets: [], seq: 0, cut: false, overflow: false };
const NO_CARD_ASKS: CardAsks = { out: new Map(), done: new Set(), failed: new Set() };

export function initialSession(clientBuild: string, lastGame: NewGameRequest | null = null): SessionState {
  return {
    bridge: "connecting",
    gen: null,
    v: null,
    link: "unknown",
    build: null,
    clientBuild,
    stale: false,
    viewer: null,
    error: null,
    over: null,
    continuity: null,
    snap: null,
    decision: null,
    stop: null,
    started: null,
    decks: null,
    lastGame,
  };
}

export interface InitialOptions {
  readonly clientBuild: string;
  readonly viewport?: ViewportState;
  readonly epoch?: number;
  /** The game the page last asked for (its saved preference), for the Game menu. */
  readonly lastGame?: NewGameRequest | null;
  /** The page's reduced-motion setting at start. */
  readonly reducedMotion?: boolean;
  /** Which table the page lays out: today's mats (the default) or focus-first's leaves. */
  readonly paradigm?: Paradigm;
}

export function initialState(o: InitialOptions): AppState {
  const viewport = o.viewport ?? { w: 0, h: 0, safe: NO_INSETS };
  return {
    session: initialSession(o.clientBuild, o.lastGame ?? null),
    model: null,
    catalog: EMPTY_CATALOG,
    cardAsks: NO_CARD_ASKS,
    gate: NO_GATE,
    changes: NO_CHANGES,
    plan: null,
    settling: false,
    planKey: null,
    layoutMemory: new Map(),
    play: play.initial,
    narrative: narrative.initial,
    focus: NO_FOCUS_STATE,
    viewport,
    hover: null,
    reducedMotion: o.reducedMotion ?? false,
    reserve: reservations(viewport),
    moments: NO_MOMENTS,
    answer: NO_ANSWERS,
    deadlines: NO_DEADLINES,
    faults: NO_FAULTS,
    commit: 0,
    drawn: { top: null, stop: null },
    epoch: o.epoch ?? 0,
    paradigm: o.paradigm ?? "mat",
  };
}
