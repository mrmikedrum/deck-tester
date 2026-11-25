// Faults and what the player is told. Ingest faults (a snapshot that fails to decode, or a throw in update), renderer
// faults (a throw in a commit) and effect faults (a throw running an effect) are reported to the client log and
// counted; two ingest faults in a row, or two renderer faults within a few seconds, raise the fault notice (with
// Reload, drawn by the app's own surface: notice.ts). Nothing is dropped silently.
import type { ClientLogEntry } from "../protocol";
import type { Ms } from "../platform";
import type { AppState } from "./state";

export interface FaultState {
  /** Ingest faults since the last snapshot taken cleanly. */
  readonly ingestStreak: number;
  /** The last renderer fault, for the "twice within a few seconds" rule. */
  readonly renderAt: Ms | null;
  /** Commits in a row that faulted: the loop asks for a recovery commit while it is at most RENDER_RETRIES. */
  readonly renderStreak: number;
  /** Shown with Reload; an ingest notice clears when a snapshot is taken cleanly again. */
  readonly notice: "ingest" | "render" | null;
  /** The next commit is a cut, from the latest state (after a renderer fault). */
  readonly cutNext: boolean;
  readonly count: number;
  readonly last: string | null;
}

export const NO_FAULTS: FaultState = { ingestStreak: 0, renderAt: null, renderStreak: 0, notice: null, cutNext: false, count: 0, last: null };

export const RENDER_REPEAT_MS = 5000;
/** Recovery commits asked for after renderer faults in a row; past it, a persistent fault waits for the next input. */
export const RENDER_RETRIES = 3;

export function ingestFault(f: FaultState, message: string): FaultState {
  const streak = f.ingestStreak + 1;
  const notice = f.notice ?? (streak >= 2 ? "ingest" : null);
  return { ...f, ingestStreak: streak, notice, count: f.count + 1, last: message };
}

export function ingestOk(f: FaultState): FaultState {
  if (f.ingestStreak === 0 && f.notice !== "ingest") return f;
  return { ...f, ingestStreak: 0, notice: f.notice === "ingest" ? null : f.notice };
}

export function renderFault(f: FaultState, message: string, at: Ms): FaultState {
  const repeated = f.renderAt !== null && at - f.renderAt < RENDER_REPEAT_MS;
  return {
    ...f,
    renderAt: at,
    renderStreak: f.renderStreak + 1,
    cutNext: true,
    notice: repeated ? "render" : f.notice,
    count: f.count + 1,
    last: message,
  };
}

/** A renderer fault no commit recovers from (the scene could not start): the notice with Reload, at once and for good. */
export const terminalFault = (f: FaultState, message: string): FaultState => ({ ...f, notice: "render", count: f.count + 1, last: message });

/** A commit drew without a fault. */
export const renderOk = (f: FaultState): FaultState => (f.renderStreak === 0 ? f : { ...f, renderStreak: 0 });

/** An effect threw (counted and reported; it raises no notice by itself). */
export const effectFault = (f: FaultState, message: string): FaultState => ({ ...f, count: f.count + 1, last: message });

/** A client log entry stamped with what is on screen: the build, the snapshot's v (as `rev`) and the decision id. */
export function logEntry(s: AppState, level: ClientLogEntry["level"], code: string, message: string): ClientLogEntry {
  return {
    level,
    code,
    build: s.session.clientBuild,
    rev: s.session.v,
    stop: s.session.decision?.id ?? null,
    message,
  };
}

export const errorText = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}${e.stack ? "\n" + e.stack : ""}` : String(e);
