/// <reference types="node" />
// Transport test helpers: corpus envelopes, and a fake fetch whose requests the test answers by hand.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
import type { AnswerRequest } from "../../src/protocol";
import type { Fetch } from "../../src/transport";

const CORPUS = resolve(import.meta.dirname, "../../../../tests/fixtures/protocol");

type Json = Record<string, unknown>;

/** A real bridge envelope from tests/fixtures/protocol, e.g. corpus("009-play-commander-zone"), with fields replaced. */
export function corpus(name: string, patch: Json = {}): Json {
  const json = JSON.parse(readFileSync(resolve(CORPUS, `${name}.json`), "utf8")) as Json;
  return { ...json, ...patch };
}

export const BODY = { id: 69, key: "pay|k", answer: [0] } as unknown as AnswerRequest;

/** Moves virtual time by `ms` and lets promise callbacks run. */
export const tick = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

export interface Call {
  readonly url: string;
  readonly init: RequestInit;
  readonly signal: AbortSignal | undefined;
  readonly aborted: boolean;
  readonly body: unknown;
  /** Answers with a JSON body (or raw text). */
  reply(json: unknown, status?: number): Promise<void>;
  /** Fails the request as the network would. */
  fail(message?: string): Promise<void>;
}

export interface Net {
  readonly fetch: Fetch;
  readonly calls: readonly Call[];
  /** The calls to urls starting with `prefix`. */
  to(prefix: string): Call[];
  /** The newest call. */
  last(): Call;
}

export function fakeNet(): Net {
  const calls: Call[] = [];
  const fetch: Fetch = (url, init = {}) =>
    new Promise<Response>((res, rej) => {
      const signal = init.signal ?? undefined;
      const call: Call = {
        url,
        init,
        signal,
        get aborted() {
          return signal?.aborted === true;
        },
        body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
        async reply(json, status = 200) {
          res(new Response(typeof json === "string" ? json : JSON.stringify(json), { status }));
          await tick();
        },
        async fail(message = "network down") {
          rej(new TypeError(message));
          await tick();
        },
      };
      signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      calls.push(call);
    });
  return {
    fetch,
    calls,
    to: (prefix) => calls.filter((c) => c.url.startsWith(prefix)),
    last: () => {
      const c = calls[calls.length - 1];
      if (!c) throw new Error("no request made");
      return c;
    },
  };
}
