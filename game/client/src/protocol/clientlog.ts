/** POST /api/clientlog: what the client reports (ingest and renderer faults, refused answers). The bridge validates
 * every field and refuses other shapes with 400; it keeps what fits the per-minute budget and says how many it dropped. */
export interface ClientLogRequest {
  readonly entries: readonly ClientLogEntry[];
}

export interface ClientLogEntry {
  readonly level: "debug" | "info" | "warn" | "error";
  /** A short stable code ("decode", "render", "answer-refused"): letters, digits, ".", "_", "-". */
  readonly code: string;
  /** The running bundle's build id. */
  readonly build: string | null;
  /** The model revision on screen. */
  readonly rev: number | null;
  /** The decision stop on screen. */
  readonly stop: number | null;
  /** Card names may appear; never card text or decklists. */
  readonly message: string;
}

/** The bridge's limits (deckmaster/game.py). */
export const CLIENT_LOG_LIMITS = {
  messageBytes: 2048,
  codeLength: 64,
  buildLength: 64,
  entriesPerRequest: 50,
  entriesPerMinute: 50,
} as const;
