// The reduced-motion setting: read from `prefers-reduced-motion`, and followed when the person changes it.
import { describe, expect, it } from "vitest";
import { reducedMotionSource } from "../../src/platform";

/** A window whose `prefers-reduced-motion: reduce` query matches `reduce`, and can be changed. */
function fakeWindow(reduce: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const queries: string[] = [];
  const mql = {
    matches: reduce,
    addEventListener: (_: "change", f: (e: { matches: boolean }) => void) => listeners.add(f),
    removeEventListener: (_: "change", f: (e: { matches: boolean }) => void) => listeners.delete(f),
  };
  const win = {
    matchMedia: (q: string) => {
      queries.push(q);
      return mql;
    },
  };
  const set = (v: boolean): void => {
    mql.matches = v;
    for (const f of listeners) f({ matches: v });
  };
  return { win, set, queries, listeners };
}

describe("reducedMotionSource", () => {
  it("reads the media query", () => {
    const on = fakeWindow(true);
    expect(reducedMotionSource(on.win).read()).toBe(true);
    expect(on.queries).toContain("(prefers-reduced-motion: reduce)");
    expect(reducedMotionSource(fakeWindow(false).win).read()).toBe(false);
  });

  it("tells a subscriber of each change until it unsubscribes", () => {
    const w = fakeWindow(false);
    const src = reducedMotionSource(w.win);
    const seen: boolean[] = [];
    const stop = src.subscribe((r) => seen.push(r));
    w.set(true);
    w.set(false);
    stop();
    w.set(true);
    expect(seen).toEqual([true, false]);
    expect(w.listeners.size).toBe(0);
  });

  it("is off, and never changes, where there is no matchMedia", () => {
    const src = reducedMotionSource(undefined);
    expect(src.read()).toBe(false);
    const stop = src.subscribe(() => {
      throw new Error("no change expected");
    });
    stop();
    expect(reducedMotionSource({}).read()).toBe(false);
  });
});
