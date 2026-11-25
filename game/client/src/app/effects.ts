// Effects: what update asks the edges to do. Each carries the epoch it was made in; the loop runs them after the fold
// and before the commit, and their results come back as messages through the sources, never as callbacks.
import type { AnswerRequest, ClientLogEntry } from "../protocol";
import type { Ack, AnswerToken, ClientLog, NewGameRequest, Transport } from "../transport";
import { mayGo } from "./answers";
import type { AppState } from "./state";

export type Effect =
  | { readonly kind: "answer"; readonly epoch: number; readonly token: AnswerToken; readonly body: AnswerRequest }
  | { readonly kind: "ack"; readonly epoch: number; readonly v: number; readonly ack: Ack }
  | { readonly kind: "newGame"; readonly epoch: number; readonly req: NewGameRequest }
  | { readonly kind: "decks"; readonly epoch: number }
  /** Keep the game asked for, so the Game menu starts from it next time (best effort). */
  | { readonly kind: "remember"; readonly epoch: number; readonly req: NewGameRequest }
  | { readonly kind: "cards"; readonly epoch: number; readonly names: readonly string[] }
  | { readonly kind: "log"; readonly epoch: number; readonly entry: ClientLogEntry };

export interface EffectPorts {
  readonly transport: Transport;
  readonly log: ClientLog | null;
  /** The page's remembered preferences (best effort); none in tests. */
  readonly prefs?: { save(req: NewGameRequest): void } | null;
}

/**
 * Runs one effect against the state the frame's fold ended in. A request made in an older epoch is not sent; nor is an
 * answer the ledger no longer holds out for the stop on screen (a snapshot later in the same frame superseded it).
 */
export function perform(e: Effect, ports: EffectPorts, s: AppState): void {
  const epoch = s.epoch;
  switch (e.kind) {
    case "answer":
      if (e.epoch === epoch && mayGo(s.answer, e.token, s.session.stop)) ports.transport.answer(e.token, e.epoch, e.body);
      return;
    case "ack":
      ports.transport.ack(e.epoch, e.v, e.ack);
      return;
    case "newGame":
      ports.transport.newGame(e.epoch, e.req);
      return;
    case "decks":
      if (e.epoch === epoch) ports.transport.decks(e.epoch);
      return;
    case "cards":
      if (e.epoch === epoch) ports.transport.cards(e.epoch, e.names);
      return;
    case "log":
      ports.log?.report(e.entry);
      return;
    case "remember":
      ports.prefs?.save(e.req);
      return;
  }
}
