// The one place time enters. Every global is read at call time, never cached, so the recorder (which swaps
// performance.now, requestAnimationFrame and setTimeout after the page loads) always sees its replacements.

export type Cancel = () => void;

/** A time on the platform clock, in milliseconds. */
export type Ms = number;

/** Milliseconds on the platform clock. */
export function now(): number {
  return globalThis.performance.now();
}

/** Calls `cb` on the next animation frame with that frame's time. Returns a cancel function. */
export function frame(cb: (at: number) => void): Cancel {
  const id = globalThis.requestAnimationFrame(cb);
  return () => globalThis.cancelAnimationFrame(id);
}

/** Calls `cb` once after `ms`. Returns a cancel function. */
export function after(ms: number, cb: () => void): Cancel {
  const id = globalThis.setTimeout(cb, ms);
  return () => globalThis.clearTimeout(id);
}
