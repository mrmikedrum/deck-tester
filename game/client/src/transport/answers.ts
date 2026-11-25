// Reading the bridge's replies to POST /api/answer, /api/new and GET /api/decks into transport events' terms.
import { decodeAnswerReply } from "../protocol";
import type { Reply } from "./http";
import type { AnswerOutcome } from "./types";

/** The bridge's attempt number from an answer reply, when it gave one. */
export function answerAttempt(reply: Reply): number | undefined {
  const r = decodeAnswerReply(reply.json);
  return r.ok ? (r.value.attempt ?? undefined) : undefined;
}

/** An answer's outcome from its reply. A reply that is not the bridge's shape proves nothing: indeterminate. */
export function answerOutcome(reply: Reply): AnswerOutcome {
  const r = decodeAnswerReply(reply.json);
  if (!r.ok) return { t: "indeterminate", why: `HTTP ${reply.status}: not an answer reply` };
  if (r.value.ok) return { t: "queued" };
  const said = (reply.json as { error?: unknown }).error; // decodeAnswerReply defaults a missing error to "refused"
  return { t: "refused", reason: typeof said === "string" ? r.value.error : null };
}

/** /api/new: `{ok: true}` once the bridge has started opening the table (errors come later, in snapshots). */
export function startResult(reply: Reply): { ok: boolean; error: string | null } {
  const j = reply.json as { ok?: unknown; error?: unknown } | undefined;
  if (reply.status === 200 && j?.ok === true) return { ok: true, error: null };
  return { ok: false, error: typeof j?.error === "string" ? j.error : `HTTP ${reply.status}` };
}

/** /api/decks: a list of deck slugs. */
export function deckList(reply: Reply): { decks: readonly string[] | null; error: string | null } {
  const j = reply.json;
  if (reply.status === 200 && Array.isArray(j) && j.every((d) => typeof d === "string"))
    return { decks: j as string[], error: null };
  return { decks: null, error: `HTTP ${reply.status}: not a deck list` };
}
