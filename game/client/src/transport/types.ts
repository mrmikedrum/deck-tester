// The transport's contract: what the app asks of the bridge and the events that come back. Adapters: longpoll.ts
// (production) and scripted.ts (tests, workbench, recordings). See docs/game-client-architecture.md, "protocol and
// transport" and "Continuity, faults and compatibility".
import type { AnswerOutcome, AnswerRequest, AnswerToken, Continuity, Snapshot } from "../protocol";

export type { AnswerOutcome, AnswerToken, Continuity };
import type { Ms, Source } from "../platform";

/** POST /api/new. */
export interface NewGameRequest {
  readonly deck: string;
  readonly opponents: readonly string[];
  readonly mana: "creatures" | "always" | "auto";
}

interface Base {
  /** When it arrived, on the platform clock. */
  readonly at: Ms;
  /** The app epoch it was issued under. The app ignores events from an older epoch. */
  readonly epoch: number;
}

export type TransportEvent =
  | (Base & {
      readonly t: "snapshot";
      readonly snap: Snapshot;
      readonly continuity: Continuity;
      /** When the request that brought it was made: a snapshot asked for after an event can speak for that event. */
      readonly asked: Ms;
    })
  | (Base & {
      readonly t: "answered";
      readonly token: AnswerToken;
      readonly outcome: AnswerOutcome;
      /** The bridge's attempt number for this answer, when it forwarded it (absent from older bridges). */
      readonly attempt?: number;
    })
  | (Base & { readonly t: "link"; readonly up: boolean })
  | (Base & { readonly t: "art"; readonly names: readonly string[] })
  | (Base & { readonly t: "started"; readonly ok: boolean; readonly error: string | null })
  | (Base & { readonly t: "decks"; readonly decks: readonly string[] | null; readonly error: string | null })
  /** A GET /api/cards reply (`{name: entry}`, decoded by model's `decodeCatalog`), or null when it failed. */
  | (Base & { readonly t: "cards"; readonly names: readonly string[]; readonly json: unknown; readonly error: string | null })
  /** A snapshot that failed to decode. The transport re-syncs once by itself; `v` is the envelope's, when readable. */
  | (Base & { readonly t: "fault"; readonly code: "decode"; readonly message: string; readonly v: number | null });

/** How the app dealt with a snapshot event: every snapshot it drains gets exactly one. */
export type Ack =
  | "took" // ingested: poll past it
  | "fault" // update threw on it: re-sync from v=0 once, then skip it
  | "stale"; // from an older epoch: re-sync, so the current snapshot comes again under the current epoch

export interface Transport {
  readonly out: Source<TransportEvent>;
  /** Starts (or, after stop, starts again) under `epoch`: the next snapshot is `first`. */
  start(epoch: number): void;
  /** Teardown: aborts every request, drops queued events, emits nothing more until started again. */
  stop(): void;
  /** Ends the snapshot at `v` (the one it delivered last): the next is released only after this. */
  ack(epoch: number, v: number, ack: Ack): void;
  /** POSTs an answer; its outcome arrives as `answered`. Never resent. */
  answer(token: AnswerToken, epoch: number, body: AnswerRequest): void;
  /** POSTs /api/new; the reply arrives as `started`. */
  newGame(epoch: number, req: NewGameRequest): void;
  /** GETs /api/decks; the list arrives as `decks`. Nothing is cached, so a failure can be retried. */
  decks(epoch: number): void;
  /** GETs /api/cards for these names (card data and art); the reply arrives as `cards`. */
  cards(epoch: number, names: readonly string[]): void;
}
