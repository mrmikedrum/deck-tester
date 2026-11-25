// The client log sender: structured reports to POST api/clientlog, batched, bounded and inside the bridge's limits
// (protocol/clientlog.ts): entries are cut to fit, at most 50 go per request and per minute, and a full queue drops
// its oldest entries, saying how many in the next batch. Never reports its own failures (that would loop).
import { CLIENT_LOG_LIMITS } from "../protocol";
import type { ClientLogEntry } from "../protocol";
import { after, now } from "../platform";
import type { Cancel, Ms } from "../platform";
import { browserFetch, postJson, request } from "./http";
import type { Fetch } from "./http";

export interface ClientLog {
  report(entry: ClientLogEntry): void;
  /** Sends what is queued now, as far as the budget allows. */
  flush(): void;
  dispose(): void;
}

export interface ClientLogOptions {
  readonly fetch?: Fetch;
  /** How long entries gather before a batch goes. */
  readonly batchMs?: number;
  /** Entries kept waiting at most; older ones are dropped and counted. */
  readonly queueMax?: number;
}

const L = CLIENT_LOG_LIMITS;
const MINUTE = 60_000;

/** `s` within `max` UTF-8 bytes: cut on a character boundary and ended with "…" when it was too long. */
export function fitBytes(s: string, max: number): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  const room = max - 3; // "…" is three bytes
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (enc.encode(s.slice(0, mid)).length <= room) lo = mid;
    else hi = mid - 1;
  }
  const cut = s.slice(0, lo);
  return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut) + "…";
}

const whole = (n: number | null): number | null => (n !== null && Number.isInteger(n) && n >= 0 ? n : null);

/** An entry the bridge will accept. */
export function fit(e: ClientLogEntry): ClientLogEntry {
  const code = e.code.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, L.codeLength) || "unknown";
  return {
    level: e.level,
    code,
    build: e.build === null ? null : e.build.slice(0, L.buildLength),
    rev: whole(e.rev),
    stop: whole(e.stop),
    message: fitBytes(e.message, L.messageBytes),
  };
}

export function clientLogSender(opts: ClientLogOptions = {}): ClientLog {
  const fetch = opts.fetch ?? browserFetch;
  const batchMs = opts.batchMs ?? 2000;
  const queueMax = opts.queueMax ?? 200;
  let queue: ClientLogEntry[] = [];
  let dropped = 0;
  let sent: Ms[] = []; // when each kept entry went, for the per-minute budget
  let timer: Cancel | null = null;
  let busy = false;
  let failures = 0;
  let disposed = false;

  const schedule = (ms: number): void => {
    if (timer || disposed) return;
    timer = after(ms, () => {
      timer = null;
      flush();
    });
  };

  function flush(): void {
    if (busy || disposed || (!queue.length && !dropped)) return;
    const t = now();
    sent = sent.filter((s) => s > t - MINUTE);
    const room = Math.min(L.entriesPerRequest, L.entriesPerMinute - sent.length);
    if (room <= 0) return schedule((sent[0] ?? t) + MINUTE - t);
    const note: ClientLogEntry[] = dropped
      ? [{ level: "warn", code: "clientlog.dropped", build: null, rev: null, stop: null, message: `${dropped} entries dropped` }]
      : [];
    const batch = [...note, ...queue.slice(0, room - note.length)];
    const took = batch.length - note.length;
    const wasDropped = dropped;
    queue = queue.slice(took);
    dropped = 0;
    busy = true;
    const restore = (): void => {
      queue = [...batch.slice(note.length), ...queue];
      dropped += wasDropped;
      trim();
    };
    request(fetch, "api/clientlog", postJson({ entries: batch })).then(
      (reply) => {
        busy = false;
        const j = reply.json as { kept?: unknown } | undefined;
        if (reply.status === 200) {
          failures = 0;
          const kept = typeof j?.kept === "number" ? j.kept : batch.length;
          sent.push(...Array.from({ length: kept }, () => t));
          dropped += Math.max(0, batch.length - kept); // the bridge's own budget cut it: say so in the next batch
        } else if (reply.status === 429) {
          restore();
          sent = Array.from({ length: L.entriesPerMinute }, () => now()); // the bridge's minute is full: wait one out
        } // any other refusal (400, 413) would only repeat: the batch is dropped
        if (queue.length || dropped) schedule(batchMs);
      },
      () => {
        busy = false;
        failures += 1;
        restore();
        schedule(Math.min(MINUTE, batchMs * 2 ** failures));
      },
    );
  }

  const trim = (): void => {
    if (queue.length <= queueMax) return;
    dropped += queue.length - queueMax;
    queue = queue.slice(queue.length - queueMax);
  };

  return {
    report(entry) {
      if (disposed) return;
      queue.push(fit(entry));
      trim();
      schedule(batchMs);
    },
    flush,
    dispose() {
      disposed = true;
      timer?.();
      timer = null;
    },
  };
}
