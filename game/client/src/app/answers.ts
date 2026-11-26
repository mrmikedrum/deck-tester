// The answer ledger: the one reader of answer outcomes and of the bridge's answer status, and the one source of
// settlement (play's busy prompt follows it). It lets at most one answer out at a time, for the current stop (so a
// double tap sends one answer), and settles it:
//   applied     its status says the engine took it
//   refused     the bridge refused it at once, or its status says the engine did (with the reason)
//   unseen      a status for a later attempt came first: its own outcome came and went between two polls
//   superseded  a new decision, a new game or a restart arrived first
//   lost        the request failed mid-way (indeterminate) and the next snapshot asked for afterwards shows the bridge
//               never had it, or it could not be made at all
// `queued` and `indeterminate` prove nothing: until one of those, the answer stays out and the prompt stays busy.
// The client never resends on its own.
//
// A status speaks for an answer by the bridge's attempt number (the reply to the POST carries it, unique for the
// bridge's life): a status for an older attempt, or for the attempt already seen when this one was sent, is never this
// answer's, even when it names the same decision. A bridge without attempt numbers is read by decision and by change:
// only a status that differs from the one seen since the answer was sent speaks for it.
//
// An answer this page did not send (a reload while the bridge works on one) is held too, with no token: the prompt stays
// busy until its status settles it or the stop changes, since the bridge would refuse a second answer meanwhile.
// Tokens are play's (one per send, unique for the page's life); the app tells play each settlement.
import type { AnswerOutcome, AnswerRequest, AnswerStatus, AnswerToken, Continuity, DecisionId, DecisionKey, Snapshot, StopId } from "../protocol";
import type { Ms } from "../platform";

export interface PendingAnswer {
  /** Play's token; null for an answer this page did not send (seen working on the bridge). */
  readonly token: AnswerToken | null;
  readonly stop: StopId;
  readonly id: DecisionId | null;
  readonly key: DecisionKey;
  readonly at: Ms;
  /** sending: no word yet; queued: the bridge has it; unknown: the request failed mid-way. */
  readonly phase: "sending" | "queued" | "unknown";
  /** When it became unknown: only a snapshot asked for after this can say the bridge never had it. */
  readonly unknownSince: Ms | null;
  /** The bridge's number for it, once its reply or its status says. */
  readonly attempt: number | null;
  /** The newest attempt number seen when it was sent: a status for that attempt or an older one is not this answer's. */
  readonly floor: number | null;
  /** The status as last seen since it was sent (read when the bridge gives no attempt numbers). */
  readonly since: string | null;
}

export type Settlement = "applied" | "refused" | "unseen" | "superseded" | "lost";

export interface Settled {
  readonly token: AnswerToken | null;
  readonly stop: StopId;
  readonly how: Settlement;
  /** A refusal's reason; null when the bridge gave none. */
  readonly reason: string | null;
  readonly attempt: number | null;
  readonly at: Ms;
}

export interface AnswerLedger {
  readonly pending: PendingAnswer | null;
  /** The last answer settled, for whoever tells the player. */
  readonly last: Settled | null;
  /** The newest attempt number seen, in a reply or a status. */
  readonly seen: number | null;
  /** The bridge's answer status as last seen. */
  readonly status: string | null;
}

export const NO_ANSWERS: AnswerLedger = { pending: null, last: null, seen: null, status: null };

/** Whether the answer for this stop is out (the prompt shows busy). */
export const isBusy = (l: AnswerLedger, stop: StopId | null): boolean => stop !== null && l.pending?.stop === stop;

const statusKey = (a: AnswerStatus | null): string | null =>
  a ? `${a.attempt ?? ""}|${a.id ?? ""}|${a.key}|${a.state}|${a.error ?? ""}` : null;

/** Whether a status names this decision (by id when both have one, else by key). */
const names = (a: AnswerStatus, id: DecisionId | null, key: DecisionKey): boolean =>
  a.id !== null && id !== null ? a.id === id : a.key === key;

const newer = (seen: number | null, attempt: number | null | undefined): number | null =>
  attempt === null || attempt === undefined ? seen : Math.max(seen ?? attempt, attempt);

/** Lets play's answer out under its token, or null when it may not go: one is already out, or it is not for the
 * current stop. */
export function openAnswer(
  l: AnswerLedger,
  current: StopId | null,
  token: AnswerToken,
  stop: StopId,
  body: AnswerRequest,
  at: Ms,
): AnswerLedger | null {
  if (l.pending || stop !== current) return null;
  const pending: PendingAnswer = {
    token,
    stop,
    id: body.id,
    key: body.key,
    at,
    phase: "sending",
    unknownSince: null,
    attempt: null,
    floor: l.seen,
    since: l.status,
  };
  return { ...l, pending };
}

/** The settlement `after` made that `before` had not (null: nothing new settled). */
export const settledSince = (before: AnswerLedger, after: AnswerLedger): Settled | null =>
  after.last !== before.last ? after.last : null;

function settle(l: AnswerLedger, how: Settlement, reason: string | null, at: Ms): AnswerLedger {
  const p = l.pending;
  return p ? { ...l, pending: null, last: { token: p.token, stop: p.stop, how, reason, attempt: p.attempt, at } } : l;
}

/** The transport's word on a sent answer (with the bridge's attempt number when its reply carries one); a reply for
 * any answer but the one out is ignored. */
export function answerOutcome(l: AnswerLedger, token: AnswerToken, o: AnswerOutcome, at: Ms, attempt: number | null = null): AnswerLedger {
  const p = l.pending;
  if (!p || p.token !== token) return l;
  const seen = newer(l.seen, attempt);
  const numbered = attempt !== null && p.attempt === null ? { ...p, attempt } : p;
  switch (o.t) {
    case "refused":
      return settle({ ...l, seen, pending: numbered }, "refused", o.reason, at);
    case "queued":
      return { ...l, seen, pending: p.phase === "sending" ? { ...numbered, phase: "queued" } : numbered };
    case "indeterminate":
      return p.phase === "sending" ? { ...l, pending: { ...p, phase: "unknown", unknownSince: at } } : l;
  }
}

/** What a status says of the answer out: it is this answer's, or a later attempt's (so this one has finished). */
function verdict(p: PendingAnswer, a: AnswerStatus | null, key: string | null): "ours" | "later" | null {
  if (!a) return null;
  if (a.attempt !== undefined) {
    if (p.attempt !== null) return a.attempt === p.attempt ? "ours" : a.attempt > p.attempt ? "later" : null;
    if (p.floor !== null && a.attempt <= p.floor) return null;
    return names(a, p.id, p.key) ? "ours" : null;
  }
  if (!names(a, p.id, p.key)) return null;
  return a.state === "working" || key !== p.since ? "ours" : null;
}

/** With nothing out: a status that says the bridge is working on an answer to the decision on screen holds the prompt
 * (an answer this page did not send, or one it gave up on as lost). */
function adoptWorking(l: AnswerLedger, snap: Snapshot, stop: StopId | null, key: string | null, at: Ms): AnswerLedger {
  const a = snap.answer, d = snap.decision;
  if (!a || a.state !== "working" || !stop || !d || !names(a, d.id, d.key)) return l;
  const settled = l.last?.attempt ?? null;
  if (a.attempt !== undefined && settled !== null && a.attempt <= settled) return l;
  const pending: PendingAnswer = {
    token: null,
    stop,
    id: a.id,
    key: a.key,
    at,
    phase: "queued",
    unknownSince: null,
    attempt: a.attempt ?? null,
    floor: null,
    since: key,
  };
  return { ...l, pending };
}

/** A snapshot: what it says about the answer out, read against the stop play adopted for it. `asked` is when its
 * request was made. */
export function observeAnswer(
  l0: AnswerLedger,
  snap: Snapshot,
  stop: StopId | null,
  continuity: Continuity,
  asked: Ms,
  at: Ms,
): AnswerLedger {
  const a = snap.answer;
  const key = statusKey(a);
  const seen = newer(l0.seen, a?.attempt);
  const l = seen === l0.seen && key === l0.status ? l0 : { ...l0, seen, status: key };
  const p = l.pending;
  if (!p) return adoptWorking(l, snap, stop, key, at);
  if (continuity === "newGame" || continuity === "restart") return settle(l, "superseded", null, at);
  const v = verdict(p, a, key);
  let next: AnswerLedger;
  if (v === "later") next = settle(l, "unseen", null, at);
  else if (v === "ours" && a?.state === "applied") next = settle(numbered(l, p, a), "applied", null, at);
  else if (v === "ours" && a?.state === "refused") next = settle(numbered(l, p, a), "refused", a.error, at);
  else if (stop !== p.stop) {
    if (snap.state === "reconnecting") return l;
    if (v === "ours" && a?.state === "working" && stop && snap.decision && names(a, snap.decision.id, snap.decision.key)) {
      // The recovered decision has a new rendered stop. Its outstanding answer is still owned by the bridge.
      return { ...l, pending: { ...p, token: null, stop, phase: "queued", unknownSince: null, attempt: a.attempt ?? p.attempt, since: key } };
    }
    next = settle(l, "superseded", null, at);
  } else if (v === "ours") {
    const attempt = p.attempt ?? a?.attempt ?? null;
    return { ...l, pending: { ...p, phase: "queued", unknownSince: null, attempt, since: key } };
  } else if (p.phase === "unknown" && p.unknownSince !== null && asked >= p.unknownSince) next = settle(l, "lost", null, at);
  else return key === p.since ? l : { ...l, pending: { ...p, since: key } };
  return next.pending ? next : adoptWorking(next, snap, stop, key, at);
}

const numbered = (l: AnswerLedger, p: PendingAnswer, a: AnswerStatus): AnswerLedger =>
  p.attempt === null && a.attempt !== undefined ? { ...l, pending: { ...p, attempt: a.attempt } } : l;

/** The game was replaced (a new game asked for, teardown): whatever is out no longer matters. */
export const supersedeAnswer = (l: AnswerLedger, at: Ms): AnswerLedger => settle(l, "superseded", null, at);

/**
 * The bridge restarted: whatever is out is superseded, and its attempt numbers are forgotten with it, since a new bridge
 * process numbers its attempts from the start again (its attempt 2 is newer than the old one's 30). Tokens are play's and
 * stay unique for the page; a new game on the same bridge keeps the history (`supersedeAnswer`).
 */
export function restartAnswers(l: AnswerLedger, at: Ms): AnswerLedger {
  const s = supersedeAnswer(l, at);
  return { pending: null, last: s.last && { ...s.last, attempt: null }, seen: null, status: null };
}

/** The request for the answer under `token` could not be made: it is settled (lost) so the prompt is free. Null when it
 * is not the answer out. */
export function withdrawAnswer(l: AnswerLedger, token: AnswerToken, how: "lost", at: Ms): AnswerLedger | null {
  return l.pending?.token === token ? settle(l, how, null, at) : null;
}

/** Whether the answer under `token` may still go: it is the one out, for the stop on screen. */
export const mayGo = (l: AnswerLedger, token: AnswerToken, current: StopId | null): boolean =>
  l.pending?.token === token && l.pending.stop === current;
