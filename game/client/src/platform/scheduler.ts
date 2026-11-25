// The frame scheduler and its wake contract: animation frames while anything moves or waits to be drained, and
// otherwise idle with exactly one timer, set for the earliest deadline. A hidden page gets no animation frames, so
// there a frame request becomes a timer (browsers run those, throttled), and deadlines and the network still advance.
import { after, frame, now } from "./clock";
import type { Cancel, Ms } from "./clock";

export interface FrameScheduler {
  /** Run a frame as soon as possible: the next animation frame. Idempotent until that frame runs. */
  request(): void;
  /** When idle, run one frame at `at` (replacing any earlier wake); null clears it. */
  wakeAt(at: Ms | null): void;
  /** Stops everything; nothing runs afterwards. */
  dispose(): void;
}

const hidden = (): boolean => globalThis.document?.visibilityState === "hidden";

/** The browser's scheduler: `run` gets each frame's time on the platform clock. */
export function frameScheduler(run: (at: Ms) => void): FrameScheduler {
  /** The frame asked for, and how: an animation frame, or a timer while the page is hidden. */
  let pending: { readonly cancel: Cancel; readonly timer: boolean } | null = null;
  let wake: Cancel | null = null;
  let disposed = false;
  const fire = (at: Ms): void => {
    pending = null;
    if (!disposed) run(at);
  };
  const ask = (): void => {
    const timer = hidden();
    pending = { cancel: timer ? after(0, () => fire(now())) : frame(fire), timer };
  };
  const request = (): void => {
    if (pending || disposed) return;
    wake?.();
    wake = null;
    ask();
  };
  // A frame asked for on one side of a visibility change is moved to the other side's scheduler: an animation frame
  // asked for just before the page hid would otherwise never come, and every later request would wait behind it.
  const moved = (): void => {
    if (!pending || disposed || pending.timer === hidden()) return;
    pending.cancel();
    ask();
  };
  const doc = globalThis.document;
  doc?.addEventListener?.("visibilitychange", moved);
  return {
    request,
    wakeAt(at) {
      wake?.();
      wake = null;
      if (at === null || disposed) return;
      wake = after(Math.max(0, at - now()), () => {
        wake = null;
        request();
      });
    },
    dispose() {
      disposed = true;
      doc?.removeEventListener?.("visibilitychange", moved);
      pending?.cancel();
      wake?.();
      pending = wake = null;
    },
  };
}
