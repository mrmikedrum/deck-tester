// chrome/frame: the few primitives that need per-frame work, stepped by the app's commit with its `now` (never by their
// own timers): the hand's physics and gestures, and the auto-pass countdown.
export { HandMotion, PEEK, PLAY_SCALE, SETTLE_MS, fromScreen, sameScreen, toScreen } from "./hand";
export type { CardDraw, HandActs, HandFrame, HandLayout, Pose } from "./hand";
export { progress, running } from "./countdown";
export type { Countdown } from "./countdown";
export { cubicBezier, easeOut } from "./ease";
export { stepSpring } from "./spring";
