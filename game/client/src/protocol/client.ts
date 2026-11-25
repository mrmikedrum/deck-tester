// The client's own identities, shared by every layer above protocol: play, transport and the app each used to name
// them separately. Not on the wire. See docs/game-client-architecture.md ("Messages carry when and against what").

/** A decision as play adopted it: new when the engine parks a new decision or the view is cut. Issued by play. */
export type StopId = string & { readonly __stop: unique symbol };

/** Increments every commit. */
export type CommitId = number;

/** When an input happened (platform clock, ms) and which commit the player saw when acting. */
export interface Stamp {
  readonly at: number;
  readonly commit: CommitId;
}

/** Names one answer request; its outcome comes back with the same token. Issued by play, unique for the page's life. */
export type AnswerToken = number & { readonly __answerToken: unique symbol };

/** What the transport knows about an answer once its request ends. None of them proves the answer was applied. */
export type AnswerOutcome =
  | { readonly t: "queued" } // the bridge forwarded it; the engine may still be working
  | { readonly t: "refused"; readonly reason: string | null } // refused at once; null when the bridge gave no reason
  | { readonly t: "indeterminate"; readonly why?: string }; // the request failed mid-way: it may or may not have landed

/** How a snapshot follows the last one the app took. The transport classifies it; it owns the poll cursor. */
export type Continuity =
  | "first" // the first snapshot of this transport run
  | "advance" // the same game, moved on
  | "same" // nothing new (an idle long poll, or a re-sync)
  | "newGame" // a new `gen`
  | "rewind" // the same game, but the view cut backwards (a restore, a reload of another position)
  | "restart"; // the bridge's `v` went backwards: it restarted
