import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_LOG_LIMITS } from "../../src/protocol";
import type { ClientLogEntry } from "../../src/protocol";
import { clientLogSender, fit, fitBytes } from "../../src/transport";
import type { ClientLog } from "../../src/transport";
import { fakeNet, tick } from "./rig";
import type { Net } from "./rig";

const L = CLIENT_LOG_LIMITS;
const entry = (message = "m", over: Partial<ClientLogEntry> = {}): ClientLogEntry => ({
  level: "error",
  code: "decode",
  build: "b1",
  rev: 3,
  stop: 1,
  message,
  ...over,
});
const bytes = (s: string) => new TextEncoder().encode(s).length;
const sentEntries = (c: { body: unknown }) => (c.body as { entries: ClientLogEntry[] }).entries;

describe("fitBytes", () => {
  it("leaves short text alone", () => expect(fitBytes("hello", 10)).toBe("hello"));
  it("keeps text of exactly the limit", () => expect(fitBytes("abcde", 5)).toBe("abcde"));
  it("cuts to the limit including the ellipsis", () => {
    const out = fitBytes("a".repeat(100), 20);
    expect(bytes(out)).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toBe("a".repeat(17) + "…");
  });
  it("counts UTF-8 bytes, not characters", () => {
    const out = fitBytes("é".repeat(100), 21);
    expect(bytes(out)).toBeLessThanOrEqual(21);
    expect(out).toBe("é".repeat(9) + "…");
  });
  it("never splits a surrogate pair", () => {
    const out = fitBytes("😀".repeat(50), 22);
    expect(bytes(out)).toBeLessThanOrEqual(22);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(out))).not.toThrow();
    expect(out).toBe([...out].join(""));
    expect(out.includes("\uFFFD")).toBe(false);
    expect(out).toBe("😀".repeat(4) + "…");
  });
  it("handles the empty string", () => expect(fitBytes("", 5)).toBe(""));
});

describe("fit", () => {
  it("passes a valid entry through", () => expect(fit(entry())).toEqual(entry()));
  it("makes the code the bridge's alphabet and length", () => {
    expect(fit(entry("m", { code: "a b/c:d" })).code).toBe("a_b_c_d");
    expect(fit(entry("m", { code: "x".repeat(100) })).code).toHaveLength(L.codeLength);
    expect(fit(entry("m", { code: "" })).code).toBe("unknown");
  });
  it("cuts the build and keeps null", () => {
    expect(fit(entry("m", { build: "b".repeat(100) })).build).toHaveLength(L.buildLength);
    expect(fit(entry("m", { build: null })).build).toBeNull();
  });
  it("turns a bad rev or stop into null", () => {
    const f = fit(entry("m", { rev: -1, stop: 1.5 }));
    expect([f.rev, f.stop]).toEqual([null, null]);
    expect(fit(entry("m", { rev: 0, stop: 0 }))).toMatchObject({ rev: 0, stop: 0 });
    expect(fit(entry("m", { rev: NaN })).rev).toBeNull();
  });
  it("bounds the message at the bridge's bytes", () => {
    expect(bytes(fit(entry("é".repeat(5000))).message)).toBeLessThanOrEqual(L.messageBytes);
  });
});

describe("clientLogSender", () => {
  let net: Net;
  let log: ClientLog;
  beforeEach(() => {
    vi.useFakeTimers();
    net = fakeNet();
    log = clientLogSender({ fetch: net.fetch, batchMs: 1000, queueMax: 5 });
  });
  afterEach(() => {
    log.dispose();
    vi.useRealTimers();
  });
  const posts = () => net.to("api/clientlog");

  it("sends nothing until the batch window ends, then one request with everything gathered", async () => {
    log.report(entry("a"));
    await tick(500);
    log.report(entry("b"));
    await tick(499);
    expect(posts()).toHaveLength(0);
    await tick(1);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.init.method).toBe("POST");
    expect(sentEntries(posts()[0]!).map((e) => e.message)).toEqual(["a", "b"]);
  });

  it("fits entries to the bridge's limits before sending", async () => {
    log.report(entry("é".repeat(5000), { code: "bad code!" }));
    await tick(1000);
    const [e] = sentEntries(posts()[0]!);
    expect(e?.code).toBe("bad_code_");
    expect(bytes(e?.message ?? "")).toBeLessThanOrEqual(L.messageBytes);
  });

  it("flush sends at once", async () => {
    log.report(entry("a"));
    log.flush();
    expect(posts()).toHaveLength(1);
  });

  it("flush with nothing queued sends nothing", () => {
    log.flush();
    expect(posts()).toHaveLength(0);
  });

  it("sends at most 50 entries a request and the rest in the next one", async () => {
    log = clientLogSender({ fetch: net.fetch, batchMs: 1000, queueMax: 500 });
    for (let i = 0; i < 120; i++) log.report(entry(`m${i}`));
    log.flush();
    expect(sentEntries(posts()[0]!)).toHaveLength(50);
    await posts()[0]?.reply({ ok: true, kept: 50, dropped: 0 });
    await tick(1000);
    expect(posts()).toHaveLength(1); // the bridge's minute budget is spent: the rest waits it out
    await tick(60_000);
    expect(posts()).toHaveLength(2);
    expect(sentEntries(posts()[1]!)[0]?.message).toBe("m50");
  });

  it("over the queue bound drops the oldest and says how many in the next batch", async () => {
    for (let i = 0; i < 8; i++) log.report(entry(`m${i}`));
    await tick(1000);
    const sent = sentEntries(posts()[0]!);
    expect(sent[0]).toMatchObject({ level: "warn", code: "clientlog.dropped", message: "3 entries dropped" });
    expect(sent.slice(1).map((e) => e.message)).toEqual(["m3", "m4", "m5", "m6", "m7"]);
  });

  it("the drop note fits within the 50-entry request cap", async () => {
    log = clientLogSender({ fetch: net.fetch, batchMs: 1000, queueMax: 60 });
    for (let i = 0; i < 70; i++) log.report(entry(`m${i}`));
    log.flush();
    const sent = sentEntries(posts()[0]!);
    expect(sent).toHaveLength(50);
    expect(sent[0]?.code).toBe("clientlog.dropped");
  });

  it("a failed POST never throws, keeps the entries and retries later with backoff", async () => {
    log.report(entry("a"));
    await tick(1000);
    await expect(posts()[0]?.fail("offline")).resolves.toBeUndefined();
    await tick(1999);
    expect(posts()).toHaveLength(1);
    await tick(1);
    expect(posts()).toHaveLength(2);
    expect(sentEntries(posts()[1]!).map((e) => e.message)).toEqual(["a"]);
    await posts()[1]?.fail();
    await tick(3999);
    expect(posts()).toHaveLength(2);
    await tick(1);
    expect(posts()).toHaveLength(3);
    await posts()[2]?.reply({ ok: true, kept: 1, dropped: 0 });
    await tick(120_000);
    expect(posts()).toHaveLength(3);
  });

  it("a failed POST keeps the dropped count for the retry", async () => {
    for (let i = 0; i < 8; i++) log.report(entry(`m${i}`));
    await tick(1000);
    await posts()[0]?.fail();
    await tick(2000);
    expect(sentEntries(posts()[1]!)[0]).toMatchObject({ code: "clientlog.dropped", message: "3 entries dropped" });
  });

  it("entries reported while a request is in flight wait for it", async () => {
    log.report(entry("a"));
    log.flush();
    log.report(entry("b"));
    log.flush();
    expect(posts()).toHaveLength(1);
    await posts()[0]?.reply({ ok: true, kept: 1, dropped: 0 });
    await tick(1000);
    expect(posts()).toHaveLength(2);
    expect(sentEntries(posts()[1]!).map((e) => e.message)).toEqual(["b"]);
  });

  it("a 429 puts the batch back and waits out the minute", async () => {
    log.report(entry("a"));
    await tick(1000);
    await posts()[0]?.reply({ ok: false, error: "slow down" }, 429);
    await tick(59_000);
    expect(posts()).toHaveLength(1);
    await tick(1500);
    expect(posts()).toHaveLength(2);
    expect(sentEntries(posts()[1]!).map((e) => e.message)).toEqual(["a"]);
  });

  it("a 400 or 413 drops the batch rather than repeating it forever", async () => {
    log.report(entry("a"));
    await tick(1000);
    await posts()[0]?.reply({ ok: false, error: "bad" }, 400);
    await tick(120_000);
    expect(posts()).toHaveLength(1);
  });

  it("when the bridge keeps fewer than sent, the loss is counted in the next batch", async () => {
    for (let i = 0; i < 3; i++) log.report(entry(`m${i}`));
    await tick(1000);
    await posts()[0]?.reply({ ok: true, kept: 1, dropped: 2 });
    await tick(1000);
    expect(sentEntries(posts()[1]!)[0]).toMatchObject({ code: "clientlog.dropped", message: "2 entries dropped" });
  });

  it("dispose stops timers and ignores later reports", async () => {
    log.report(entry("a"));
    log.dispose();
    log.report(entry("b"));
    await tick(10_000);
    log.flush();
    expect(posts()).toHaveLength(0);
  });
});
