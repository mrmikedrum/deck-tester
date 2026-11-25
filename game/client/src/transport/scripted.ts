// The scripted adapter, for Vitest, the workbench and recordings: the script pushes bridge envelopes and replies, and
// every event (answer outcomes included) is delivered inside a drain, never through fetch, so no microtask decides
// what a frame shows. Snapshots go through the same feed as the long poll's (decode, continuity, epochs, acks): one
// is out at a time, and the next is released when the app acks it. Requests are recorded for the script to inspect.
import type { AnswerRequest } from "../protocol";
import { Queue } from "../platform";
import type { Ms } from "../platform";
import { Feed } from "./feed";
import type { Ack, AnswerOutcome, AnswerToken, NewGameRequest, Transport, TransportEvent } from "./types";

export interface SentAnswer {
  readonly token: AnswerToken;
  readonly epoch: number;
  readonly body: AnswerRequest;
  readonly at: Ms;
}

export interface ScriptedTransport extends Transport {
  /** Queues a GET /api/view body (an envelope, as the bridge sends it), released in order as the app acks. */
  push(envelope: unknown): void;
  /** Delivers the outcome of a sent answer. */
  /** `attempt`: the bridge's attempt number, as a reply from a bridge that forwarded the answer carries. */
  reply(token: AnswerToken, outcome: AnswerOutcome, attempt?: number): void;
  link(up: boolean): void;
  art(names: readonly string[]): void;
  started(ok: boolean, error?: string | null): void;
  deckList(decks: readonly string[] | null, error?: string | null): void;
  /** Replies to the card requests made so far with this `/api/cards` body (null: they failed). */
  catalog(json: unknown, error?: string | null): void;
  readonly cardRequests: readonly (readonly string[])[];
  readonly answers: readonly SentAnswer[];
  readonly newGames: readonly NewGameRequest[];
  readonly deckRequests: number;
  readonly acks: readonly { readonly v: number; readonly ack: Ack }[];
  /** Envelopes pushed and not yet released. */
  readonly backlog: number;
}

export interface ScriptedOptions {
  /** The clock events are stamped with (a test's virtual clock). */
  readonly clock: () => Ms;
  /** Answer every sent answer with this at once (the workbench); undefined leaves replies to the script. */
  readonly autoReply?: AnswerOutcome;
  /** Reply to every card request at once from this `/api/cards` body (filtered to the names asked for). */
  readonly catalog?: Readonly<Record<string, unknown>>;
}

export function scriptedTransport(opts: ScriptedOptions): ScriptedTransport {
  const out = new Queue<TransportEvent>();
  const feed = new Feed();
  const pending: unknown[] = [];
  const answers: SentAnswer[] = [];
  const newGames: NewGameRequest[] = [];
  const acks: { v: number; ack: Ack }[] = [];
  const cardRequests: (readonly string[])[] = [];
  let unanswered: { epoch: number; names: readonly string[] }[] = [];
  let running = false;
  let deckRequests = 0;
  let current: unknown = undefined; // the envelope out, re-sent on a re-sync or a stale ack

  const emit = (e: TransportEvent): void => {
    if (running) out.push(e);
  };
  const base = () => ({ at: opts.clock(), epoch: feed.epoch });
  // Release the next envelope, as the bridge would answer the next poll.
  const release = (): void => {
    while (running && !feed.waiting) {
      const resync = feed.takeResync() && current !== undefined;
      if (!resync) {
        if (!pending.length) return;
        current = pending.shift();
      }
      const at = opts.clock();
      const { event, then } = feed.receive(current, at, at);
      emit(event);
      if (then !== "poll") return;
    }
  };

  return {
    out,
    start(epoch) {
      running = true;
      out.clear();
      feed.reset(epoch);
      current = undefined;
      release();
    },
    stop() {
      running = false;
      out.clear();
    },
    ack(epoch, v, ack) {
      acks.push({ v, ack });
      if (!feed.ack(epoch, v, ack)) return;
      release();
    },
    answer(token, epoch, body) {
      feed.note(epoch);
      answers.push({ token, epoch, body, at: opts.clock() });
      if (opts.autoReply) emit({ t: "answered", ...base(), epoch, token, outcome: opts.autoReply });
    },
    newGame(epoch, req) {
      feed.note(epoch);
      newGames.push(req);
    },
    decks(epoch) {
      feed.note(epoch);
      deckRequests += 1;
    },
    cards(epoch, names) {
      feed.note(epoch);
      cardRequests.push(names);
      const known = opts.catalog;
      if (!known) {
        unanswered.push({ epoch, names });
        return;
      }
      const json = Object.fromEntries(names.filter((n) => n in known).map((n) => [n, known[n]]));
      emit({ t: "cards", ...base(), epoch, names, json, error: null });
    },
    catalog(json, error = null) {
      for (const u of unanswered) emit({ t: "cards", ...base(), epoch: u.epoch, names: u.names, json, error });
      unanswered = [];
    },
    push(envelope) {
      pending.push(envelope);
      release();
    },
    reply(token, outcome, attempt) {
      const sent = answers.find((a) => a.token === token);
      emit({ t: "answered", ...base(), epoch: sent ? sent.epoch : feed.epoch, token, outcome, ...(attempt === undefined ? {} : { attempt }) });
      if (outcome.t === "indeterminate") {
        feed.wantResync(); // as the long poll does: the next snapshot comes at once and settles it
        release();
      }
    },
    link(up) {
      emit({ t: "link", ...base(), up });
    },
    art(names) {
      emit({ t: "art", ...base(), names });
    },
    started(ok, error = null) {
      emit({ t: "started", ...base(), ok, error });
    },
    deckList(decks, error = null) {
      emit({ t: "decks", ...base(), decks, error });
    },
    get answers() {
      return answers;
    },
    get newGames() {
      return newGames;
    },
    get deckRequests() {
      return deckRequests;
    },
    get cardRequests() {
      return cardRequests;
    },
    get acks() {
      return acks;
    },
    get backlog() {
      return pending.length;
    },
  };
}
