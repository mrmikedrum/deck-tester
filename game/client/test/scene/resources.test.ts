import { describe, expect, it } from "vitest";
import { ArtCache, ByteCache, textureBytes } from "../../src/scene/resources";

const make = (bytes: number) => () => ({ value: { bytes }, bytes });

describe("ByteCache", () => {
  it("shares one value per key and counts references", () => {
    const freed: unknown[] = [];
    const c = new ByteCache<{ bytes: number }>(1000, (v) => freed.push(v));
    const a = c.acquire("a", make(100)),
      b = c.acquire("a", make(100));
    expect(a).toBe(b);
    expect(c.refs("a")).toBe(2);
    expect(c.stats().bytes).toBe(100);
    c.release("a");
    expect(c.stats().live).toBe(1);
    c.release("a");
    expect(c.stats()).toMatchObject({ live: 0, idle: 1, bytes: 100, idleBytes: 100 });
    expect(freed).toHaveLength(0);
  });
  it("evicts the least recently released idle entries once over budget, and disposes them", () => {
    const freed: number[] = [];
    const c = new ByteCache<{ bytes: number; id: number }>(250, (v) => freed.push(v.id));
    const ids = ["a", "b", "c"];
    ids.forEach((k, i) => {
      c.acquire(k, () => ({ value: { bytes: 100, id: i }, bytes: 100 }));
    });
    // 300 held live: over budget, but nothing idle to give up
    expect(c.stats()).toMatchObject({ bytes: 300, live: 3, disposed: 0 });
    c.release("b");
    expect(freed).toEqual([1]);
    c.release("a");
    c.release("c");
    expect(c.stats()).toMatchObject({ bytes: 200, entries: 2, disposed: 1 });
    // re-acquiring an idle entry makes it live again, not new
    c.acquire("a", () => ({ value: { bytes: 999, id: 9 }, bytes: 999 }));
    expect(c.stats().live).toBe(1);
    expect(c.stats().bytes).toBe(200);
  });
  it("evicts oldest-released first", () => {
    const freed: string[] = [];
    const c = new ByteCache<string>(150, (v) => freed.push(v));
    for (const k of ["a", "b", "c"]) c.acquire(k, () => ({ value: k, bytes: 100 }));
    c.release("c");
    c.release("a");
    expect(freed).toEqual(["c", "a"]); // c went first; a joined when released; b is live, so 100 bytes stay
    expect(c.stats().bytes).toBe(100);
    c.release("b");
    expect(freed).toEqual(["c", "a"]); // b is idle but 100 fits the budget: kept
    expect(c.stats()).toMatchObject({ live: 0, idle: 1 });
  });
  it("clear disposes everything and ignores late releases", () => {
    const freed: string[] = [];
    const c = new ByteCache<string>(1000, (v) => freed.push(v));
    c.acquire("a", () => ({ value: "a", bytes: 10 }));
    c.acquire("b", () => ({ value: "b", bytes: 10 }));
    c.release("b");
    c.clear();
    expect(freed.sort()).toEqual(["a", "b"]);
    expect(c.stats()).toMatchObject({ entries: 0, bytes: 0, disposed: 2 });
    expect(c.release("a")).toBe(false);
  });
  it("estimates texture bytes with mipmaps", () => {
    expect(textureBytes(336, 468)).toBe(Math.round(336 * 468 * 4 * (4 / 3)));
    expect(textureBytes(10, 10, false)).toBe(400);
  });
});

describe("ArtCache", () => {
  it("loads once, reports when ready, and evicts by bytes", async () => {
    const loads: string[] = [],
      ready: string[] = [],
      closed: string[] = [];
    const img = (u: string) => ({ width: 10, height: 10, close: () => void closed.push(u) });
    const art = new ArtCache(
      900,
      (u) => {
        loads.push(u);
        return Promise.resolve(u === "bad" ? null : img(u));
      },
      (u) => ready.push(u),
    );
    expect(art.get("a")).toBeNull();
    expect(art.get("a")).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toEqual(["a"]);
    expect(ready).toEqual(["a"]);
    expect(art.get("a")).not.toBeNull();
    for (const u of ["b", "c", "d"]) {
      art.get(u);
      await Promise.resolve();
      await Promise.resolve();
    }
    // Fresh art is held until a frame has painted it, whatever the budget.
    expect(closed).toEqual([]);
    expect(art.stats()).toMatchObject({ entries: 4, live: 4, requests: 4, decodes: 4, pending: 0 });
    art.releaseFresh();
    // 4 x 400 bytes against 900: the oldest were closed
    expect(closed).toEqual(["a", "b"]);
    art.get("bad");
    await Promise.resolve();
    await Promise.resolve();
    art.get("bad");
    expect(loads.filter((u) => u === "bad")).toHaveLength(1);
    expect(art.stats()).toMatchObject({ failures: 1, requests: 5 });
  });
});

describe("ArtCache after clear", () => {
  it("a load that finishes after clear (teardown, a lost context) is closed, not stored, and not reported", async () => {
    const ready: string[] = [],
      closed: string[] = [];
    let loads = 0;
    const waiting = new Map<string, (img: { width: number; height: number; close: () => void }) => void>();
    const art = new ArtCache(
      10_000,
      (u) => {
        loads++;
        return new Promise((res) => void waiting.set(u, res));
      },
      (u) => ready.push(u),
    );
    expect(art.get("a")).toBeNull();
    art.clear();
    waiting.get("a")!({ width: 10, height: 10, close: () => void closed.push("a") });
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toEqual([]);
    expect(closed).toEqual(["a"]);
    expect(art.stats()).toMatchObject({ entries: 0, bytes: 0 });
    // Asked again after the clear, it loads afresh.
    expect(art.get("a")).toBeNull();
    expect(loads).toBe(2);
  });
});
