// The one set of gesture thresholds, for every surface (the hand, the canvas). These are the old client's tuned
// numbers: h.js's board gestures (hold to peek, drag past 10 px) and live.js's hand (play mode when a card rises more
// than it slides). Pinned behaviour: changing one changes what a gesture does.

/** Hold still this long to peek (h.js `holdTimer`, 380 ms). */
export const HOLD_MS = 380;
/** Movement past this many CSS px from the press is a drag, not a tap (h.js `onMove`, live.js `heldMove`: `> 10`). */
export const DRAG_PX = 10;
/** A drag starts "up" (a hand card's play mode) when it rises more than this times its sideways travel (live.js:
 * `dy < 0 && -dy > |dx| * 1.1`). */
export const LIFT_RATIO = 1.1;
/**
 * A release moving faster than this (CSS px per ms, along its main axis) is a swipe. The old hand counted a flick when
 * the last pointermove moved more than 3 px; at 60 Hz pointer events that is 3 / 16.7 = 0.18 px/ms. Measured over a
 * window instead of one event, so it no longer depends on the device's event rate.
 */
export const SWIPE_SPEED = 0.18;
/** How far back from the release the swipe speed is measured (ms). Not in the old client: chosen to span about five
 * events at 60 Hz, so a finger that stops before lifting is not a swipe. */
export const SWIPE_WINDOW_MS = 80;
