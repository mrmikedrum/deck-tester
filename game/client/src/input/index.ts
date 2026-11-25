// input: the gesture recognizer. See docs/game-client-architecture.md ("input, focus and access").
//
//   classify(state, pointerInput) -> {state, gestures}   pure: time arrives in the inputs, a `tick` stands in for the
//                                                         hold timer
//   bindPointer(element, {pick, on})                     the classifier on an element's Pointer Events
//
// One set of thresholds (thresholds.ts): tap, hold to peek at 380 ms, drag after 10 px, swipe, and a drag's direction
// ("up" is a hand card's play mode). Tracks pointer ids; a second pointer or a cancelled one ends the gesture with
// `cancel` and nothing else.
export { classify, classifyAll, dirOf, dueAt, initialClassifier, tracking } from "./classify";
export type { Classified, ClassifierState, Dir, Gesture, Ms, PointerInput, PointerKind } from "./classify";
export { bindPointer } from "./dom";
export type { BindOptions, PointerBinding } from "./dom";
export { DRAG_PX, HOLD_MS, LIFT_RATIO, SWIPE_SPEED, SWIPE_WINDOW_MS } from "./thresholds";
