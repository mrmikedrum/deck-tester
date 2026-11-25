// The frame scheduler against fake globals: animation frames while the page shows, timers while it is hidden, and a
// frame requested on one side of a visibility change still runs on the other.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { frameScheduler } from "../../src/platform/scheduler";

const g = globalThis as Record<string, unknown>;
const NAMES = ["document", "performance", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"] as const;
const saved = Object.fromEntries(NAMES.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));

let frames: Map<number, (t: number) => void>;
let timers: Map<number, { at: number; cb: () => void }>;
let listeners: Set<() => void>;
let page: { visibilityState: "visible" | "hidden" };
let id: number;
let clock: number;

function set(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

beforeEach(() => {
  frames = new Map();
  timers = new Map();
  listeners = new Set();
  id = 0;
  clock = 1000;
  page = {
    visibilityState: "visible",
    addEventListener: (type: string, fn: () => void) => type === "visibilitychange" && listeners.add(fn),
    removeEventListener: (type: string, fn: () => void) => type === "visibilitychange" && listeners.delete(fn),
  } as never;
  set("document", page);
  set("performance", { now: () => clock });
  set("requestAnimationFrame", (cb: (t: number) => void) => (frames.set(++id, cb), id));
  set("cancelAnimationFrame", (n: number) => frames.delete(n));
  set("setTimeout", (cb: () => void, ms: number) => (timers.set(++id, { at: clock + ms, cb }), id));
  set("clearTimeout", (n: number) => timers.delete(n));
});

afterEach(() => {
  for (const n of NAMES) {
    const d = saved[n];
    if (d) Object.defineProperty(globalThis, n, d);
    else delete g[n];
  }
});

function show(state: "visible" | "hidden"): void {
  page.visibilityState = state;
  for (const fn of [...listeners]) fn();
}
function runFrames(): void {
  const due = [...frames.values()];
  frames.clear();
  due.forEach((cb) => cb(clock));
}
function runTimers(): void {
  const due = [...timers.entries()].filter(([, t]) => t.at <= clock);
  due.forEach(([n]) => timers.delete(n));
  due.forEach(([, t]) => t.cb());
}

describe("frameScheduler", () => {
  it("asks for an animation frame while the page shows, and a timer while it is hidden", () => {
    const ran: number[] = [];
    const s = frameScheduler((at) => ran.push(at));
    s.request();
    s.request();
    expect([frames.size, timers.size]).toEqual([1, 0]);
    runFrames();
    expect(ran.length).toBe(1);
    show("hidden");
    s.request();
    expect([frames.size, timers.size]).toEqual([0, 1]);
    runTimers();
    expect(ran.length).toBe(2);
    s.dispose();
  });

  it("a frame asked for just before the page hides still runs while it is hidden", () => {
    const ran: number[] = [];
    const s = frameScheduler((at) => ran.push(at));
    s.request(); // an animation frame, which a hidden page never gets
    show("hidden");
    expect(frames.size).toBe(0);
    s.request(); // later arrivals are not stranded behind it
    runTimers();
    expect(ran.length).toBe(1);
    s.request();
    runTimers();
    expect(ran.length).toBe(2);
    s.dispose();
  });

  it("a timer asked for while hidden becomes an animation frame when the page shows again", () => {
    const ran: number[] = [];
    const s = frameScheduler((at) => ran.push(at));
    show("hidden");
    s.request();
    show("visible");
    expect([frames.size, timers.size]).toEqual([1, 0]);
    runFrames();
    expect(ran.length).toBe(1);
    s.dispose();
  });

  it("a deadline set before the page hides still fires", () => {
    const ran: number[] = [];
    const s = frameScheduler((at) => ran.push(at));
    s.wakeAt(clock + 50);
    show("hidden");
    clock += 50;
    runTimers(); // the wake asks for a frame, which hidden is a timer
    runTimers();
    expect(ran.length).toBe(1);
    s.dispose();
  });

  it("disposing stops listening and runs nothing", () => {
    const ran: number[] = [];
    const s = frameScheduler((at) => ran.push(at));
    s.request();
    s.dispose();
    expect(listeners.size).toBe(0);
    show("hidden");
    runFrames();
    runTimers();
    expect(ran).toEqual([]);
  });
});
