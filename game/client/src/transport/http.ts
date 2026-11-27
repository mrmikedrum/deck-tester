// fetch, read at call time (the behaviour harness routes it; tests replace it), with JSON in and out. Relative URLs
// (`api/...`), so the page works on the bridge and under Vite's proxy.

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const browserFetch: Fetch = (url, init) => globalThis.fetch(url, init);

/** A reply with its status: `json` is undefined when the body was not JSON. */
export interface Reply {
  readonly status: number;
  readonly json: unknown;
}

const parse = (text: string): unknown => {
  try {
    return text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
};

export async function request(fetch: Fetch, url: string, init: RequestInit = {}): Promise<Reply> {
  const r = await fetch(url, { cache: "no-store", ...init });
  return { status: r.status, json: parse(await r.text()) };
}

export const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
