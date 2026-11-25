// The gesture classifier: pointer events in, gestures out. Pure: time arrives in the events (`at`, on the platform
// clock) and a `tick` stands in for the hold timer, so the same events at the same times give the same gestures.
//
// One pointer at a time is a gesture. It is tracked by its id from its press to its release: a second pointer pressed
// while one is tracked cancels the gesture (a pinch, a palm, a second finger sends nothing), and nothing more is
// classified until every pointer is up. A cancelled pointer (pointercancel, lost capture) cancels too.
//
// From a press:
//   held still past HOLD_MS                -> hold (a peek), then holdEnd when it lifts
//   moved past DRAG_PX (also after a hold) -> dragStart (with the direction it set out in), drag..., drop (with swipe)
//   lifted before either                   -> tap
// A mouse also reports hover (the target under it changed while no button is down) and the wheel.
import { DRAG_PX, HOLD_MS, LIFT_RATIO, SWIPE_SPEED, SWIPE_WINDOW_MS } from "./thresholds";

export type Ms = number;
export type PointerKind = "mouse" | "touch" | "pen";
export type Dir = "up" | "down" | "left" | "right";

/** Pointer events as the classifier reads them. `on` is what the surface says is under the press (its own key). */
export type PointerInput<K> =
  | {
      readonly t: "down";
      readonly id: number;
      readonly kind: PointerKind;
      /** The button pressed (0 the primary); a mouse's other buttons start nothing. */
      readonly button: number;
      readonly x: number;
      readonly y: number;
      readonly at: Ms;
      readonly on: K | null;
    }
  | {
      readonly t: "move";
      readonly id: number;
      readonly kind: PointerKind;
      /** Buttons held (0: a mouse hovering). */
      readonly buttons: number;
      readonly x: number;
      readonly y: number;
      readonly at: Ms;
      readonly on: K | null;
    }
  | { readonly t: "up"; readonly id: number; readonly x: number; readonly y: number; readonly at: Ms }
  /** pointercancel, or the capture lost before the pointer lifted. */
  | { readonly t: "cancel"; readonly id: number; readonly at: Ms }
  /** The pointer left the surface: a hover ends. */
  | { readonly t: "leave"; readonly id: number; readonly at: Ms }
  | {
      readonly t: "wheel";
      readonly dx: number;
      readonly dy: number;
      readonly x: number;
      readonly y: number;
      readonly at: Ms;
      readonly on: K | null;
    }
  /** The frame's time: fires a hold that has come due. */
  | { readonly t: "tick"; readonly at: Ms };

export type Gesture<K> =
  | { readonly g: "tap"; readonly on: K | null; readonly kind: PointerKind; readonly x: number; readonly y: number; readonly at: Ms }
  | { readonly g: "hold"; readonly on: K | null; readonly kind: PointerKind; readonly x: number; readonly y: number; readonly at: Ms }
  | { readonly g: "holdEnd"; readonly on: K | null; readonly at: Ms }
  | {
      readonly g: "dragStart";
      readonly on: K | null;
      readonly kind: PointerKind;
      /** Where the press was. */
      readonly x0: number;
      readonly y0: number;
      readonly x: number;
      readonly y: number;
      /** Which way it set out: "up" when it rose more than LIFT_RATIO times its sideways travel. */
      readonly dir: Dir;
      readonly at: Ms;
    }
  | { readonly g: "drag"; readonly on: K | null; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number; readonly at: Ms }
  | {
      readonly g: "drop";
      readonly on: K | null;
      readonly x: number;
      readonly y: number;
      readonly dx: number;
      readonly dy: number;
      /** Velocity over the last SWIPE_WINDOW_MS, px/ms. */
      readonly vx: number;
      readonly vy: number;
      /** Released fast enough to be a swipe, and which way. */
      readonly swipe: Dir | null;
      readonly at: Ms;
    }
  /** The gesture ended with no outcome: a second pointer, pointercancel, lost capture. Undo whatever it started. */
  | { readonly g: "cancel"; readonly on: K | null; readonly at: Ms }
  /** A hovering mouse moved onto another target (`on` null: off every target, or off the surface, where x and y are NaN). */
  | { readonly g: "hover"; readonly on: K | null; readonly x: number; readonly y: number; readonly at: Ms }
  | { readonly g: "wheel"; readonly on: K | null; readonly dx: number; readonly dy: number; readonly x: number; readonly y: number; readonly at: Ms };

interface Sample {
  readonly x: number;
  readonly y: number;
  readonly at: Ms;
}

interface Track<K> {
  readonly id: number;
  readonly kind: PointerKind;
  readonly on: K | null;
  readonly x0: number;
  readonly y0: number;
  readonly at0: Ms;
  readonly x: number;
  readonly y: number;
  readonly phase: "pending" | "held" | "drag";
  /** Recent positions, newest last, for the release's velocity. */
  readonly samples: readonly Sample[];
}

export interface ClassifierState<K> {
  /** Every pointer down on the surface, tracked or not. */
  readonly down: readonly number[];
  readonly track: Track<K> | null;
  /** A gesture was cancelled: nothing is classified until every pointer is up. */
  readonly blocked: boolean;
  /** What a hovering mouse is over (null: nothing, or not hovering). */
  readonly hover: K | null;
}

export interface Classified<K> {
  readonly state: ClassifierState<K>;
  readonly gestures: readonly Gesture<K>[];
}

export function initialClassifier<K>(): ClassifierState<K> {
  return { down: [], track: null, blocked: false, hover: null };
}

/** When a tick is next needed (the pending hold's time), or null. */
export function dueAt<K>(s: ClassifierState<K>): Ms | null {
  return s.track?.phase === "pending" ? s.track.at0 + HOLD_MS : null;
}

/** Whether a gesture is in progress (the surface should keep frames coming). */
export const tracking = <K>(s: ClassifierState<K>): boolean => s.track !== null;

/** The direction a drag set out in. */
export function dirOf(dx: number, dy: number): Dir {
  if (dy < 0 && -dy > Math.abs(dx) * LIFT_RATIO) return "up";
  // Rising, but not steeply enough to lift, counts as sideways (the old hand paged on anything but a clear lift).
  if (dy < 0 || Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return "down";
}

function velocity(samples: readonly Sample[], at: Ms): { vx: number; vy: number } {
  const recent = samples.filter((p) => at - p.at <= SWIPE_WINDOW_MS);
  const first = recent[0], last = recent[recent.length - 1];
  if (!first || !last || last.at <= first.at) return { vx: 0, vy: 0 };
  const dt = last.at - first.at;
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

function swipeOf(vx: number, vy: number): Dir | null {
  if (Math.max(Math.abs(vx), Math.abs(vy)) <= SWIPE_SPEED) return null;
  if (Math.abs(vx) >= Math.abs(vy)) return vx < 0 ? "left" : "right";
  return vy < 0 ? "up" : "down";
}

const withSample = (samples: readonly Sample[], p: Sample): readonly Sample[] =>
  [...samples.filter((q) => p.at - q.at <= SWIPE_WINDOW_MS), p];

/** Fires the pending hold if it is due by `at` (so a late tick, or none, still gives the same gestures). */
function settle<K>(s: ClassifierState<K>, at: Ms, out: Gesture<K>[]): ClassifierState<K> {
  const t = s.track;
  if (!t || t.phase !== "pending" || at < t.at0 + HOLD_MS) return s;
  out.push({ g: "hold", on: t.on, kind: t.kind, x: t.x, y: t.y, at: t.at0 + HOLD_MS });
  return { ...s, track: { ...t, phase: "held" } };
}

function cancelTrack<K>(s: ClassifierState<K>, at: Ms, out: Gesture<K>[], down: readonly number[]): ClassifierState<K> {
  const t = s.track;
  if (t) out.push({ g: "cancel", on: t.on, at });
  return { ...s, down, track: null, blocked: down.length > 0 };
}

/** One input: the next state and the gestures it completes. Total: an input that means nothing is ignored. */
export function classify<K>(s0: ClassifierState<K>, e: PointerInput<K>): Classified<K> {
  const out: Gesture<K>[] = [];
  const s = e.t === "leave" ? s0 : settle(s0, e.at, out);
  const done = (state: ClassifierState<K>): Classified<K> => ({ state, gestures: out });
  switch (e.t) {
    case "tick":
      return done(s);
    case "down": {
      if (e.kind === "mouse" && e.button !== 0) return done(s);
      const down = s.down.includes(e.id) ? s.down : [...s.down, e.id];
      if (s.track || s.blocked) return done(cancelTrack(s, e.at, out, down));
      const p = { x: e.x, y: e.y, at: e.at };
      return done({
        ...s,
        down,
        hover: null,
        track: { id: e.id, kind: e.kind, on: e.on, x0: e.x, y0: e.y, at0: e.at, x: e.x, y: e.y, phase: "pending", samples: [p] },
      });
    }
    case "move": {
      const t = s.track;
      if (!t) {
        if (e.kind !== "mouse" || e.buttons !== 0 || s.blocked || e.on === s.hover) return done(s);
        out.push({ g: "hover", on: e.on, x: e.x, y: e.y, at: e.at });
        return done({ ...s, hover: e.on });
      }
      if (e.id !== t.id) return done(s);
      const moved = { ...t, x: e.x, y: e.y, samples: withSample(t.samples, { x: e.x, y: e.y, at: e.at }) };
      const dx = e.x - t.x0, dy = e.y - t.y0;
      if (t.phase === "drag") {
        out.push({ g: "drag", on: t.on, x: e.x, y: e.y, dx, dy, at: e.at });
        return done({ ...s, track: moved });
      }
      if (Math.hypot(dx, dy) <= DRAG_PX) return done({ ...s, track: moved });
      if (t.phase === "held") out.push({ g: "holdEnd", on: t.on, at: e.at });
      out.push({ g: "dragStart", on: t.on, kind: t.kind, x0: t.x0, y0: t.y0, x: e.x, y: e.y, dir: dirOf(dx, dy), at: e.at });
      out.push({ g: "drag", on: t.on, x: e.x, y: e.y, dx, dy, at: e.at });
      return done({ ...s, track: { ...moved, phase: "drag" } });
    }
    case "up": {
      const down = s.down.filter((id) => id !== e.id);
      let t = s.track;
      if (!t || t.id !== e.id) return done({ ...s, down, blocked: s.blocked && down.length > 0 });
      if (t.phase !== "drag" && Math.hypot(e.x - t.x0, e.y - t.y0) > DRAG_PX) {
        // Let go past the drag threshold with no move reported on the way (a coalesced or dropped pointermove): the
        // release point is where it went, so it is a drag that ends here, not a tap where it started.
        const moved = classify(s, { t: "move", id: e.id, kind: t.kind, buttons: 1, x: e.x, y: e.y, at: e.at, on: t.on });
        out.push(...moved.gestures);
        t = moved.state.track ?? t;
      }
      if (t.phase === "pending") out.push({ g: "tap", on: t.on, kind: t.kind, x: t.x0, y: t.y0, at: e.at });
      else if (t.phase === "held") out.push({ g: "holdEnd", on: t.on, at: e.at });
      else {
        const { vx, vy } = velocity(withSample(t.samples, { x: e.x, y: e.y, at: e.at }), e.at);
        out.push({ g: "drop", on: t.on, x: e.x, y: e.y, dx: e.x - t.x0, dy: e.y - t.y0, vx, vy, swipe: swipeOf(vx, vy), at: e.at });
      }
      return done({ ...s, down, track: null, blocked: false });
    }
    case "cancel": {
      const down = s.down.filter((id) => id !== e.id);
      const t = s.track;
      if (!t || t.id !== e.id) return done({ ...s, down, blocked: s.blocked && down.length > 0 });
      return done(cancelTrack(s, e.at, out, down));
    }
    case "leave": {
      if (s.track || s.hover === null) return done(s);
      out.push({ g: "hover", on: null, x: Number.NaN, y: Number.NaN, at: e.at });
      return done({ ...s, hover: null });
    }
    case "wheel":
      out.push({ g: "wheel", on: e.on, dx: e.dx, dy: e.dy, x: e.x, y: e.y, at: e.at });
      return done(s);
  }
}

/** Feeds several inputs in order. */
export function classifyAll<K>(s: ClassifierState<K>, inputs: readonly PointerInput<K>[]): Classified<K> {
  let state = s;
  const gestures: Gesture<K>[] = [];
  for (const e of inputs) {
    const r = classify(state, e);
    state = r.state;
    gestures.push(...r.gestures);
  }
  return { state, gestures };
}
