// The fan's focus spring (live.js `spring`): a damped spring from where the fan is to where it is going, so a turn
// overshoots a touch and settles. Stepped in fixed 60 Hz frames by the commit's time, at most three per commit.

/** The old rAF frame the constants were tuned at (ms). */
export const SPRING_FRAME_MS = 16.7;
/** Pull toward the target and damping, per frame. */
const STIFFNESS = 0.07;
const DAMPING = 0.32;
/** A commit after a long gap steps at most this many frames (no lurch). */
const MAX_FRAMES = 3;
/** At rest when both the distance and the velocity are under this (in cards, cards per frame). */
const REST = 0.002;

export interface Spring {
  readonly at: number;
  readonly vel: number;
  readonly to: number;
}

/** Steps `frames` frames (fractional, capped); returns the spring and whether it came to rest (snapped to its target). */
export function stepSpring(s: Spring, frames: number): { readonly spring: Spring; readonly rest: boolean } {
  let at = s.at, vel = s.vel, left = Math.min(MAX_FRAMES, Math.max(0, frames));
  while (left > 0) {
    const h = Math.min(1, left);
    left -= h;
    vel += (STIFFNESS * (s.to - at) - DAMPING * vel) * h;
    at += vel * h;
  }
  const rest = Math.abs(s.to - at) < REST && Math.abs(vel) < REST;
  return { spring: rest ? { at: s.to, vel: 0, to: s.to } : { at, vel, to: s.to }, rest };
}
