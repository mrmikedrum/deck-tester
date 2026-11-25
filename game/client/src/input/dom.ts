// The classifier bound to an element: Pointer Events in, gestures out through a callback. Thin on purpose: it reads
// each event into a PointerInput stamped with the platform clock, captures the pressed pointer so its moves keep
// coming, and leaves every decision to `classify`. The hold fires on the caller's frame: call `tick(now)` each commit
// (it is due at `due()`; `active` says a pointer is tracked, so the frames should keep coming).
//
// Presses, moves, hovers and the wheel are read on the element; releases, cancels and lost capture on its document, so
// a pointer let go off the surface (or whose captured target was removed) still ends its gesture.
import { now as clockNow } from "../platform";
import { classify, dueAt, initialClassifier, tracking } from "./classify";
import type { ClassifierState, Gesture, Ms, PointerInput, PointerKind } from "./classify";

export interface BindOptions<K> {
  /** What is under an event's target, in the surface's own keys (null: nothing it cares about). */
  readonly pick: (target: EventTarget | null) => K | null;
  /** Called with the gestures each event (or tick) completes. */
  readonly on: (gestures: readonly Gesture<K>[]) => void;
  /** The clock events are stamped with: the platform clock unless a test gives its own. */
  readonly now?: () => Ms;
  /** Whether to take a wheel event from the page (preventDefault): by default, a mostly sideways one. */
  readonly claimWheel?: (dx: number, dy: number) => boolean;
}

export interface PointerBinding {
  /** Fires a hold that has come due by `now` (the frame's time). */
  tick(now: Ms): void;
  /** When the next tick is needed, or null. */
  due(): Ms | null;
  /** A gesture is in progress. */
  readonly active: boolean;
  /** Abandons any gesture in progress (no gestures are reported) and starts clean. */
  reset(): void;
  dispose(): void;
}

const kindOf = (e: PointerEvent): PointerKind => (e.pointerType === "touch" || e.pointerType === "pen" ? e.pointerType : "mouse");
const sideways = (dx: number, dy: number): boolean => Math.abs(dx) > Math.abs(dy);

export function bindPointer<K>(el: HTMLElement, opts: BindOptions<K>): PointerBinding {
  const now = opts.now ?? clockNow;
  const claimWheel = opts.claimWheel ?? sideways;
  const doc = el.ownerDocument;
  let state: ClassifierState<K> = initialClassifier<K>();

  const feed = (e: PointerInput<K>): void => {
    const r = classify(state, e);
    state = r.state;
    if (r.gestures.length) opts.on(r.gestures);
  };

  const down = (e: PointerEvent): void => {
    const had = state.track;
    feed({ t: "down", id: e.pointerId, kind: kindOf(e), button: e.button, x: e.clientX, y: e.clientY, at: now(), on: opts.pick(e.target) });
    if (!had && state.track?.id === e.pointerId && e.target instanceof Element) {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser no longer knows (or a test's synthetic event): the document listeners still end it.
      }
    }
  };
  const move = (e: PointerEvent): void =>
    feed({ t: "move", id: e.pointerId, kind: kindOf(e), buttons: e.buttons, x: e.clientX, y: e.clientY, at: now(), on: opts.pick(e.target) });
  const up = (e: PointerEvent): void => feed({ t: "up", id: e.pointerId, x: e.clientX, y: e.clientY, at: now() });
  const cancel = (e: PointerEvent): void => feed({ t: "cancel", id: e.pointerId, at: now() });
  const leave = (e: PointerEvent): void => feed({ t: "leave", id: e.pointerId, at: now() });
  const wheel = (e: WheelEvent): void => {
    if (claimWheel(e.deltaX, e.deltaY)) e.preventDefault();
    feed({ t: "wheel", dx: e.deltaX, dy: e.deltaY, x: e.clientX, y: e.clientY, at: now(), on: opts.pick(e.target) });
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerleave", leave);
  el.addEventListener("wheel", wheel, { passive: false });
  doc.addEventListener("pointerup", up, true);
  doc.addEventListener("pointercancel", cancel, true);
  doc.addEventListener("lostpointercapture", cancel, true);

  return {
    tick(at) {
      if (dueAt(state) !== null) feed({ t: "tick", at });
    },
    due: () => dueAt(state),
    get active() {
      return tracking(state);
    },
    reset() {
      state = initialClassifier<K>();
    },
    dispose() {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("wheel", wheel);
      doc.removeEventListener("pointerup", up, true);
      doc.removeEventListener("pointercancel", cancel, true);
      doc.removeEventListener("lostpointercapture", cancel, true);
    },
  };
}
