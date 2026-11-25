import { afterEach, describe, expect, it } from "vitest";
import { after, frame, now } from "../../src/platform/clock";

const g = globalThis as Record<string, unknown>;
const saved = { performance: g["performance"], raf: g["requestAnimationFrame"], caf: g["cancelAnimationFrame"] };

afterEach(() => {
  g["requestAnimationFrame"] = saved.raf;
  g["cancelAnimationFrame"] = saved.caf;
  Object.defineProperty(globalThis.performance, "now", {
    value: saved.performance && (saved.performance as Performance).now,
    configurable: true,
    writable: true,
  });
});

describe("clock reads globals at call time", () => {
  it("now() uses a performance.now swapped after import", () => {
    const real = globalThis.performance.now.bind(globalThis.performance);
    Object.defineProperty(globalThis.performance, "now", { value: () => 1234, configurable: true, writable: true });
    expect(now()).toBe(1234);
    Object.defineProperty(globalThis.performance, "now", { value: real, configurable: true, writable: true });
    expect(now()).not.toBe(1234);
  });

  it("now() uses a replaced performance object", () => {
    const real = globalThis.performance;
    Object.defineProperty(globalThis, "performance", { value: { now: () => 99 }, configurable: true, writable: true });
    try {
      expect(now()).toBe(99);
    } finally {
      Object.defineProperty(globalThis, "performance", { value: real, configurable: true, writable: true });
    }
  });

  it("frame() uses a requestAnimationFrame installed after import, and cancels through cancelAnimationFrame", () => {
    const calls: string[] = [];
    g["requestAnimationFrame"] = (cb: (t: number) => void) => (calls.push("raf"), cb(16), 7);
    g["cancelAnimationFrame"] = (id: number) => calls.push("cancel" + id);
    let at = -1;
    const cancel = frame((t) => (at = t));
    expect(at).toBe(16);
    cancel();
    expect(calls).toEqual(["raf", "cancel7"]);
  });

  it("after() fires once and can be cancelled", async () => {
    let fired = 0;
    after(1, () => fired++);
    const cancel = after(1, () => fired++);
    cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(1);
  });
});
