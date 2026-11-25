// The production adapter: GET api/view?v=N long polls (the bridge answers when its version passes N, after 20 s with
// the same snapshot, or at once when N is ahead of a restarted bridge), answers and requests over POST. Time comes only
// from platform. The client never resends an answer on its own.
import type { AnswerRequest } from "../protocol";
import { after, now, Queue } from "../platform";
import type { Cancel } from "../platform";
import { answerAttempt, answerOutcome, deckList, startResult } from "./answers";
import { Feed } from "./feed";
import { browserFetch, errorText, postJson, request } from "./http";
import type { Fetch } from "./http";
import type { Ack, AnswerToken, NewGameRequest, Transport, TransportEvent } from "./types";

export interface LongPollOptions {
  readonly fetch?: Fetch;
  /** Waits after consecutive failed polls; the last repeats. The old client retried after 1 s. */
  readonly backoff?: readonly number[];
  /** A poll with no reply for this long is abandoned (the bridge answers within 20 s). */
  readonly watchdogMs?: number;
}

const BACKOFF = [1000, 2000, 4000, 8000] as const;

export function longPollTransport(opts: LongPollOptions = {}): Transport {
  const fetch = opts.fetch ?? browserFetch;
  const backoff = opts.backoff ?? BACKOFF;
  const watchdogMs = opts.watchdogMs ?? 30_000;
  const out = new Queue<TransportEvent>();
  const feed = new Feed();
  let running = false;
  let run = 0; // bumps on start and stop: replies to an older run are dropped
  let poll: { id: number; ctrl: AbortController; watchdog: Cancel } | null = null;
  let pollId = 0;
  let retry: Cancel | null = null;
  let failures = 0;
  let link: boolean | null = null;

  const emit = (r: number, e: TransportEvent): void => {
    if (r === run && running) out.push(e);
  };
  const setLink = (up: boolean): void => {
    if (link === up) return;
    link = up;
    emit(run, { t: "link", at: now(), epoch: feed.epoch, up });
  };
  const cancelPoll = (): void => {
    if (!poll) return;
    poll.watchdog();
    poll.ctrl.abort();
    poll = null;
  };

  const startPoll = (): void => {
    if (!running || poll || retry || feed.waiting) return;
    const id = ++pollId;
    const r = run;
    const ctrl = new AbortController();
    const asked = now();
    const watchdog = after(watchdogMs, () => ctrl.abort());
    poll = { id, ctrl, watchdog };
    request(fetch, `api/view?v=${feed.next()}`, { signal: ctrl.signal })
      .then((reply) => {
        if (reply.status !== 200 || reply.json === undefined) throw new Error(`HTTP ${reply.status}`);
        return reply.json;
      })
      .then(
        (json) => {
          if (r !== run || poll?.id !== id) return;
          watchdog();
          poll = null;
          failures = 0;
          setLink(true);
          const { event, then } = feed.receive(json, asked, now());
          emit(r, event);
          if (then === "poll") startPoll();
          else if (then === "backoff") wait();
        },
        () => {
          if (r !== run || poll?.id !== id) return; // stopped, or abandoned on purpose
          watchdog();
          poll = null;
          failures += 1;
          setLink(false);
          wait();
        },
      );
  };
  const wait = (): void => {
    const ms = backoff[Math.min(Math.max(failures, 1) - 1, backoff.length - 1)] ?? 1000;
    retry = after(ms, () => {
      retry = null;
      startPoll();
    });
  };

  /**
   * Every call from the app carries its epoch. A newer one (a new game asked for) moves the poll on: the one out was
   * asked under the old epoch and its reply would be dropped, so it is abandoned and a poll under the new epoch goes out
   * at once, from the same cursor (the bridge answers it when its new game is published).
   */
  const note = (epoch: number): void => {
    const before = feed.epoch;
    feed.note(epoch);
    if (feed.epoch === before || !poll) return;
    cancelPoll();
    startPoll();
  };

  const stop = (): void => {
    run += 1;
    running = false;
    cancelPoll();
    retry?.();
    retry = null;
    out.clear();
  };

  return {
    out,
    start(epoch) {
      stop();
      running = true;
      feed.reset(epoch);
      failures = 0;
      link = null;
      startPoll();
    },
    stop,
    ack(epoch: number, v: number, ack: Ack) {
      if (feed.ack(epoch, v, ack)) startPoll();
    },
    answer(token: AnswerToken, epoch: number, body: AnswerRequest) {
      note(epoch);
      const r = run;
      request(fetch, "api/answer", postJson(body)).then(
        (reply) => {
          const attempt = answerAttempt(reply);
          emit(r, { t: "answered", at: now(), epoch, token, outcome: answerOutcome(reply), ...(attempt === undefined ? {} : { attempt }) });
        },
        (e: unknown) => {
          emit(r, { t: "answered", at: now(), epoch, token, outcome: { t: "indeterminate", why: errorText(e) } });
          if (r !== run) return; // a stopped run's failure must not disturb the new run's poll
          // The next snapshot settles it: ask for one now rather than at the end of the long poll.
          feed.wantResync();
          if (poll) {
            cancelPoll();
            startPoll();
          }
        },
      );
    },
    newGame(epoch: number, req: NewGameRequest) {
      note(epoch);
      const r = run;
      request(fetch, "api/new", postJson(req)).then(
        (reply) => emit(r, { t: "started", at: now(), epoch, ...startResult(reply) }),
        (e: unknown) => emit(r, { t: "started", at: now(), epoch, ok: false, error: errorText(e) }),
      );
    },
    decks(epoch: number) {
      note(epoch);
      const r = run;
      request(fetch, "api/decks").then(
        (reply) => emit(r, { t: "decks", at: now(), epoch, ...deckList(reply) }),
        (e: unknown) => emit(r, { t: "decks", at: now(), epoch, decks: null, error: errorText(e) }),
      );
    },
    cards(epoch: number, names: readonly string[]) {
      note(epoch);
      const r = run;
      const query = names.map((n) => `n=${encodeURIComponent(wellFormed(n))}`).join("&");
      request(fetch, `api/cards?${query}`).then(
        (reply) =>
          emit(r, { t: "cards", at: now(), epoch, names, json: reply.status === 200 ? reply.json : null, error: reply.status === 200 ? null : `HTTP ${reply.status}` }),
        (e: unknown) => emit(r, { t: "cards", at: now(), epoch, names, json: null, error: errorText(e) }),
      );
    },
  };
}

/** Replaces lone surrogates (which make encodeURIComponent throw) with U+FFFD. */
const wellFormed = (s: string): string => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
