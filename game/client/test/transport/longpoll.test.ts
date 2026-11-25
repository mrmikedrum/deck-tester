import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerToken, Transport, TransportEvent } from "../../src/transport";
import { longPollTransport } from "../../src/transport";
import { BODY, corpus, fakeNet, tick } from "./rig";
import type { Net } from "./rig";

const T = 1 as AnswerToken;
const S4 = () => corpus("004-bridge-error-on-a-playing-envelope"); // gen 1, v 4
const S6 = () => corpus("009-play-commander-zone"); // gen 1, v 6
const S7 = () => corpus("010-play-my-planeswalker-commander"); // gen 1, v 7

let net: Net;
let t: Transport;
const kinds = (es: TransportEvent[]): string[] => es.map((e) => (e.t === "link" ? `link:${e.up}` : e.t));
const views = (): string[] => net.to("api/view").map((c) => c.url);

beforeEach(() => {
  vi.useFakeTimers();
  net = fakeNet();
  t = longPollTransport({ fetch: net.fetch });
});
afterEach(() => {
  t.stop();
  vi.useRealTimers();
});

describe("poll loop", () => {
  it("asks for v=0 on start, uncached, and does not poll again while a snapshot is out", async () => {
    t.start(1);
    expect(views()).toEqual(["api/view?v=0"]);
    expect(net.last().init.cache).toBe("no-store");
    await net.last().reply(S4());
    expect(kinds(t.out.drain())).toEqual(["link:true", "snapshot"]);
    await tick(60_000);
    expect(views()).toHaveLength(1);
  });

  it("delivers a first snapshot stamped with epoch, asked time and continuity", async () => {
    t.start(3);
    await tick(250);
    await net.last().reply(S4());
    const snap = t.out.drain().find((e) => e.t === "snapshot");
    expect(snap).toMatchObject({ t: "snapshot", epoch: 3, continuity: "first", asked: 0 });
    expect(snap?.at).toBe(250);
  });

  it("an ack of took polls from that snapshot's v", async () => {
    t.start(1);
    await net.last().reply(S4());
    t.out.drain();
    t.ack(1, 4, "took");
    expect(views()).toEqual(["api/view?v=0", "api/view?v=4"]);
  });

  it("an idle poll returning the same snapshot is classified same", async () => {
    t.start(1);
    await net.last().reply(S4());
    t.ack(1, 4, "took");
    await net.last().reply(S4());
    const evs = t.out.drain().filter((e) => e.t === "snapshot");
    expect(evs.map((e) => e.t === "snapshot" && e.continuity)).toEqual(["first", "same"]);
  });

  it("a v that goes backwards is a restart and moves the epoch on", async () => {
    t.start(1);
    await net.last().reply(S7());
    t.ack(1, 7, "took");
    await net.last().reply(S4());
    const evs = t.out.drain().filter((e) => e.t === "snapshot");
    expect(evs.map((e) => e.t === "snapshot" && [e.continuity, e.epoch])).toEqual([["first", 1], ["restart", 2]]);
  });

  it("a new gen is a newGame with a new epoch", async () => {
    t.start(1);
    await net.last().reply(S4());
    t.ack(1, 4, "took");
    await net.last().reply({ ...S6(), gen: 2 });
    const last = t.out.drain().pop();
    expect(last).toMatchObject({ t: "snapshot", continuity: "newGame", epoch: 2 });
  });

  it("an ack for another v, or with nothing out, is ignored", async () => {
    t.start(1);
    t.ack(1, 4, "took");
    await net.last().reply(S4());
    t.ack(1, 99, "took");
    expect(views()).toHaveLength(1);
  });

  it("a fault ack re-syncs from v=0 once; a second fault on the same v skips it", async () => {
    t.start(1);
    await net.last().reply(S4());
    t.ack(1, 4, "took");
    await net.last().reply(S6());
    t.ack(1, 6, "fault");
    expect(views().at(-1)).toBe("api/view?v=0");
    await net.last().reply(S6());
    t.ack(1, 6, "fault");
    expect(views().at(-1)).toBe("api/view?v=6");
  });

  it("a stale ack re-syncs from v=0", async () => {
    t.start(1);
    await net.last().reply(S4());
    t.ack(1, 4, "stale");
    expect(views().at(-1)).toBe("api/view?v=0");
  });

  it("every real corpus envelope in turn flows through the loop", async () => {
    t.start(1);
    const seen: number[] = [];
    for (const name of ["005-playing-view-empty", "006-playing-empty-hand", "007-mulligan-commander-zone", "008-mulligan-commander-zone"]) {
      await net.last().reply(corpus(name));
      const s = t.out.drain().find((e) => e.t === "snapshot");
      if (s?.t !== "snapshot") throw new Error(`${name} produced no snapshot`);
      seen.push(s.snap.v);
      t.ack(1, s.snap.v, "took");
    }
    expect(seen).toEqual([2, 3, 4, 5]);
  });
});

describe("link, backoff and recovery", () => {
  it("a network error reports the link down once and retries after 1, 2, 4, 8, 8 s", async () => {
    t.start(1);
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = net.calls.length;
      await net.last().fail();
      let waited = 0;
      while (net.calls.length === before) {
        await tick(500);
        waited += 500;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(kinds(t.out.drain())).toEqual(["link:false"]);
  });

  it("an HTTP error and a body that is not JSON back off like a network error", async () => {
    t.start(1);
    await net.last().reply({ error: "boom" }, 500);
    await tick(999);
    expect(views()).toHaveLength(1);
    await tick(1);
    expect(views()).toHaveLength(2);
    await net.last().reply("<html>proxy</html>", 200);
    await tick(1999);
    expect(views()).toHaveLength(2);
    await tick(1);
    expect(views()).toHaveLength(3);
    expect(kinds(t.out.drain())).toEqual(["link:false"]);
  });

  it("recovery reports the link up before the snapshot and restarts the backoff at 1 s", async () => {
    t.start(1);
    await net.last().fail();
    await tick(1000);
    await net.last().fail();
    await tick(2000);
    await net.last().reply(S4());
    expect(kinds(t.out.drain())).toEqual(["link:false", "link:true", "snapshot"]);
    t.ack(1, 4, "took");
    await net.last().fail();
    await tick(1000);
    expect(views()).toHaveLength(5);
  });

  it("an error after an ack keeps the cursor: the retry asks from the same v", async () => {
    t.start(1);
    await net.last().reply(S6());
    t.ack(1, 6, "took");
    await net.last().fail();
    await tick(1000);
    expect(views().at(-1)).toBe("api/view?v=6");
  });

  it("no link event repeats while the state does not change", async () => {
    t.start(1);
    await net.last().fail();
    await tick(1000);
    await net.last().fail();
    await tick(2000);
    await net.last().reply(S4());
    t.ack(1, 4, "took");
    await net.last().reply(S4());
    expect(kinds(t.out.drain())).toEqual(["link:false", "link:true", "snapshot", "snapshot"]);
  });

  it("the watchdog abandons a poll with no reply and retries after backoff", async () => {
    t.start(1);
    const first = net.last();
    await tick(29_999);
    expect(first.aborted).toBe(false);
    await tick(1);
    expect(first.aborted).toBe(true);
    expect(kinds(t.out.drain())).toEqual(["link:false"]);
    await tick(1000);
    expect(views()).toHaveLength(2);
  });

  it("honours custom backoff and watchdog options", async () => {
    t.stop();
    t = longPollTransport({ fetch: net.fetch, backoff: [10, 20], watchdogMs: 100 });
    t.start(1);
    await net.last().fail();
    await tick(10);
    expect(views()).toHaveLength(2);
    await tick(100);
    expect(net.calls[1]?.aborted).toBe(true);
    await tick(20);
    expect(views()).toHaveLength(3);
  });
});

describe("stop", () => {
  it("aborts the pending poll and polls no more", async () => {
    t.start(1);
    const pending = net.last();
    t.stop();
    expect(pending.aborted).toBe(true);
    await tick(120_000);
    expect(views()).toHaveLength(1);
    expect(t.out.drain()).toEqual([]);
  });

  it("a reply that lands after stop emits nothing", async () => {
    t.start(1);
    const pending = net.last();
    t.stop();
    await pending.reply(S4());
    expect(t.out.drain()).toEqual([]);
    expect(views()).toHaveLength(1);
  });

  it("stop during backoff cancels the retry", async () => {
    t.start(1);
    await net.last().fail();
    t.stop();
    await tick(60_000);
    expect(views()).toHaveLength(1);
  });

  it("stop drops events already queued", async () => {
    t.start(1);
    await net.last().reply(S4());
    t.stop();
    expect(t.out.drain()).toEqual([]);
  });

  it("answers, new games and deck lists that land after stop emit nothing", async () => {
    t.start(1);
    t.answer(T, 1, BODY);
    t.newGame(1, { deck: "d", opponents: [], mana: "auto" });
    t.decks(1);
    t.stop();
    await net.to("api/answer")[0]?.reply({ ok: true });
    await net.to("api/new")[0]?.reply({ ok: true });
    await net.to("api/decks")[0]?.reply(["a"]);
    expect(t.out.drain()).toEqual([]);
  });

  it("start after stop begins a fresh run: v=0, first, and an old run's late reply is dropped", async () => {
    t.start(1);
    await net.last().reply(S6());
    t.ack(1, 6, "took");
    t.out.drain();
    const old = net.last();
    t.stop();
    t.start(2);
    expect(net.last().url).toBe("api/view?v=0");
    await old.reply(S7());
    expect(t.out.drain()).toEqual([]);
    await net.last().reply(S4());
    expect(t.out.drain().find((e) => e.t === "snapshot")).toMatchObject({ continuity: "first", epoch: 2 });
  });

  it("start twice does not leave two polls running", async () => {
    t.start(1);
    const first = net.last();
    t.start(2);
    expect(first.aborted).toBe(true);
    expect(views()).toHaveLength(2);
  });
});

describe("decode faults", () => {
  const broken = (patch: Record<string, unknown> = {}) => ({ ...S6(), state: "nonsense", ...patch });

  it("reports a fault with the envelope's v, re-syncs from v=0 once and keeps going", async () => {
    t.start(1);
    await net.last().reply(broken());
    const evs = t.out.drain();
    expect(evs.map((e) => e.t)).toEqual(["link", "fault"]);
    expect(evs[1]).toMatchObject({ t: "fault", code: "decode", v: 6 });
    expect(evs[1] && "message" in evs[1] && evs[1].message).toMatch(/state/);
    expect(views().at(-1)).toBe("api/view?v=0");
    await net.last().reply(S6());
    expect(t.out.drain().map((e) => e.t)).toEqual(["snapshot"]);
  });

  it("the same broken v twice is skipped: the cursor moves past it", async () => {
    t.start(1);
    await net.last().reply(broken());
    await net.last().reply(broken());
    expect(t.out.drain().filter((e) => e.t === "fault")).toHaveLength(2);
    expect(views().at(-1)).toBe("api/view?v=6");
  });

  it("an envelope with no readable v faults with v null and backs off the second time", async () => {
    t.start(1);
    await net.last().reply({ nope: true });
    expect(t.out.drain().find((e) => e.t === "fault")).toMatchObject({ v: null });
    await net.last().reply({ nope: true });
    const before = views().length;
    await tick(999);
    expect(views()).toHaveLength(before);
    await tick(1);
    expect(views()).toHaveLength(before + 1);
  });

  it("a JSON array or null body is a fault, not a crash", async () => {
    t.start(1);
    await net.last().reply([1, 2]);
    expect(t.out.drain().find((e) => e.t === "fault")).toMatchObject({ code: "decode", v: null });
    await net.last().reply("null");
    expect(t.out.drain().find((e) => e.t === "fault")).toBeTruthy();
  });

  it("a decode fault does not report the link down", async () => {
    t.start(1);
    await net.last().reply(broken());
    expect(kinds(t.out.drain())).toEqual(["link:true", "fault"]);
  });

  it("a good snapshot after faults resets the repeat tracking", async () => {
    t.start(1);
    await net.last().reply(broken());
    await net.last().reply(S6());
    t.ack(1, 6, "took");
    await net.last().reply(broken());
    expect(views().at(-1)).toBe("api/view?v=0"); // a first fault again, so a re-sync, not a skip
  });
});

describe("answer", () => {
  it("POSTs the body as JSON to api/answer", async () => {
    t.start(1);
    t.answer(T, 1, BODY);
    const call = net.to("api/answer")[0];
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toEqual({ "Content-Type": "application/json" });
    expect(call?.body).toEqual(BODY);
  });

  it("ok:true is queued", async () => {
    t.start(1);
    t.answer(T, 1, BODY);
    await net.to("api/answer")[0]?.reply({ ok: true });
    expect(t.out.drain().find((e) => e.t === "answered")).toMatchObject({ token: T, epoch: 1, outcome: { t: "queued" } });
  });

  it("carries the bridge's attempt number when the reply has one, and none when it doesn't", async () => {
    t.start(1);
    t.answer(T, 1, BODY);
    await net.to("api/answer")[0]?.reply({ ok: true, attempt: 7 });
    expect(t.out.drain().find((e) => e.t === "answered")).toMatchObject({ outcome: { t: "queued" }, attempt: 7 });
    t.answer(T, 1, BODY);
    await net.to("api/answer")[1]?.reply({ ok: true });
    expect(t.out.drain().find((e) => e.t === "answered")).not.toHaveProperty("attempt");
  });

  it("ok:false is refused with the bridge's reason", async () => {
    t.start(1);
    t.answer(T, 1, BODY);
    await net.to("api/answer")[0]?.reply({ ok: false, error: "that decision has passed" });
    expect(t.out.drain().find((e) => e.t === "answered")).toMatchObject({
      outcome: { t: "refused", reason: "that decision has passed" },
    });
  });

  it("ok:false with no reason is refused with a null reason", async () => {
    t.start(1);
    t.answer(T, 1, BODY);
    await net.to("api/answer")[0]?.reply({ ok: false });
    expect(t.out.drain().find((e) => e.t === "answered")).toMatchObject({ outcome: { t: "refused", reason: null } });
  });

  it("a 500 carrying the bridge's refusal shape is still refused", async () => {
    t.start(1);
    t.answer(T, 1, BODY);
    await net.to("api/answer")[0]?.reply({ ok: false, error: "engine exploded" }, 500);
    expect(t.out.drain().find((e) => e.t === "answered")).toMatchObject({ outcome: { t: "refused", reason: "engine exploded" } });
  });

  it("a reply that is not the bridge's shape (404, proxy page, empty) is indeterminate, never refused", async () => {
    for (const [body, status] of [[{ error: "not found" }, 404], ["<html>", 502], ["", 200], [[], 200]] as const) {
      t.start(1);
      t.answer(T, 1, BODY);
      await net.to("api/answer").at(-1)?.reply(body, status);
      const ev = t.out.drain().find((e) => e.t === "answered");
      expect(ev).toMatchObject({ outcome: { t: "indeterminate" } });
    }
  });

  it("a network failure mid-answer is indeterminate, not refused, and asks for a re-sync at once", async () => {
    t.start(1);
    await net.last().reply(S6());
    t.ack(1, 6, "took");
    t.out.drain();
    const longPoll = net.last();
    t.answer(T, 1, BODY);
    await net.to("api/answer")[0]?.fail("connection reset");
    const ev = t.out.drain().find((e) => e.t === "answered");
    expect(ev).toMatchObject({ outcome: { t: "indeterminate", why: "connection reset" } });
    expect(longPoll.aborted).toBe(true);
    expect(views().at(-1)).toBe("api/view?v=0");
  });

  it("an indeterminate answer while a snapshot is out re-syncs at its ack", async () => {
    t.start(1);
    await net.last().reply(S6());
    t.answer(T, 1, BODY);
    await net.to("api/answer")[0]?.fail();
    expect(views()).toHaveLength(1);
    t.ack(1, 6, "took");
    expect(views().at(-1)).toBe("api/view?v=0");
  });

  it("is never resent by the transport", async () => {
    t.start(1);
    t.answer(T, 1, BODY);
    await net.to("api/answer")[0]?.fail();
    await tick(120_000);
    expect(net.to("api/answer")).toHaveLength(1);
  });

  it("outcomes carry their own token and epoch, in the order the replies land", async () => {
    t.start(1);
    t.answer(1 as AnswerToken, 1, BODY);
    t.answer(2 as AnswerToken, 1, BODY);
    await net.to("api/answer")[1]?.reply({ ok: true });
    await net.to("api/answer")[0]?.reply({ ok: false, error: "no" });
    const got = t.out.drain().filter((e) => e.t === "answered");
    expect(got.map((e) => e.t === "answered" && [e.token, e.outcome.t])).toEqual([[2, "queued"], [1, "refused"]]);
  });

  it("an old run's failing answer does not disturb the new run's poll", async () => {
    t.start(1);
    t.answer(T, 1, BODY);
    t.stop();
    t.start(2);
    const poll = net.last();
    await net.to("api/answer")[0]?.fail();
    expect(poll.aborted).toBe(false);
    expect(views()).toHaveLength(2);
    expect(t.out.drain()).toEqual([]);
  });
});

describe("new game", () => {
  const REQ = { deck: "marath-tokens", opponents: ["atraxa-artifacts"], mana: "creatures" } as const;

  it("POSTs the request and reports ok", async () => {
    t.start(1);
    t.newGame(1, REQ);
    const call = net.to("api/new")[0];
    expect(call?.body).toEqual(REQ);
    await call?.reply({ ok: true });
    expect(t.out.drain().find((e) => e.t === "started")).toMatchObject({ ok: true, error: null, epoch: 1 });
  });

  it("reports the bridge's error, an HTTP status when there is none, and a network failure", async () => {
    t.start(1);
    t.newGame(1, REQ);
    t.newGame(1, REQ);
    t.newGame(1, REQ);
    await net.to("api/new")[0]?.reply({ ok: false, error: "no such deck" }, 500);
    await net.to("api/new")[1]?.reply("oops", 502);
    await net.to("api/new")[2]?.fail("offline");
    const got = t.out.drain().filter((e) => e.t === "started");
    expect(got.map((e) => e.t === "started" && [e.ok, e.error])).toEqual([
      [false, "no such deck"],
      [false, "HTTP 502"],
      [false, "offline"],
    ]);
  });

  it("a 200 without ok:true is not a start", async () => {
    t.start(1);
    t.newGame(1, REQ);
    await net.to("api/new")[0]?.reply({});
    expect(t.out.drain().find((e) => e.t === "started")).toMatchObject({ ok: false });
  });

  it("newGame abandons the poll asked under the old epoch and polls again at once, from the same cursor", async () => {
    t.start(1);
    await net.last().reply(S4());
    t.out.drain();
    t.ack(1, 4, "took");
    const old = net.last();
    expect(old.url).toBe("api/view?v=4");
    t.newGame(2, REQ); // the app cleared the old game's prompt and moved to epoch 2
    expect(old.aborted).toBe(true);
    expect(views()).toEqual(["api/view?v=0", "api/view?v=4", "api/view?v=4"]);
    await old.reply(S6()); // a reply to the abandoned poll, had it come, is nobody's
    expect(t.out.drain().filter((e) => e.t === "snapshot")).toEqual([]);
    // The bridge publishes the new game: it comes under the new epoch, without waiting on another push.
    await net.to("api/view").at(-1)?.reply({ ...S6(), gen: 2 });
    expect(t.out.drain().filter((e) => e.t === "snapshot")).toMatchObject([{ epoch: 3, continuity: "newGame" }]);
  });

  it("a call under the same epoch leaves the poll alone; one under a newer epoch with a snapshot out polls nothing", async () => {
    t.start(1);
    await net.last().reply(S4());
    t.ack(1, 4, "took");
    const poll = net.last();
    t.decks(1);
    t.cards(1, ["Island"]);
    expect(poll.aborted).toBe(false);
    expect(views()).toHaveLength(2);
    await poll.reply(S6());
    t.out.drain();
    t.newGame(2, REQ); // a snapshot is out, waiting for its ack: no poll to move
    expect(views()).toHaveLength(2);
    t.ack(2, 6, "stale");
    expect(views().at(-1)).toBe("api/view?v=0");
  });

});

describe("decks", () => {
  it("delivers the list", async () => {
    t.start(1);
    t.decks(1);
    await net.to("api/decks")[0]?.reply(["marath-tokens", "yue-moon"]);
    expect(t.out.drain().find((e) => e.t === "decks")).toMatchObject({ decks: ["marath-tokens", "yue-moon"], error: null });
  });

  it("a failed list is not cached: asking again fetches again, and a later success delivers", async () => {
    t.start(1);
    t.decks(1);
    await net.to("api/decks")[0]?.fail("offline");
    t.decks(1);
    await net.to("api/decks")[1]?.reply({ nope: 1 }, 500);
    t.decks(1);
    await net.to("api/decks")[2]?.reply(["a"]);
    t.decks(1);
    expect(net.to("api/decks")).toHaveLength(4);
    const got = t.out.drain().filter((e) => e.t === "decks");
    expect(got.map((e) => e.t === "decks" && [e.decks, e.error])).toEqual([
      [null, "offline"],
      [null, "HTTP 500: not a deck list"],
      [["a"], null],
    ]);
  });

  it("an array with a non-string is not a deck list", async () => {
    t.start(1);
    t.decks(1);
    await net.to("api/decks")[0]?.reply(["a", 3]);
    expect(t.out.drain().find((e) => e.t === "decks")).toMatchObject({ decks: null });
  });
});

describe("cards", () => {
  it("asks for every name, and a lone surrogate is sent as U+FFFD instead of throwing", () => {
    t.start(1);
    expect(() => t.cards(1, ["Lightning Bolt", "Bad\uD800Name"])).not.toThrow();
    expect(net.to("api/cards")[0]?.url).toBe("api/cards?n=Lightning%20Bolt&n=Bad%EF%BF%BDName");
  });
});
