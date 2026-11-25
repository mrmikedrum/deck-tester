// The auto-pass countdown: how far the pass button's bar has filled at the commit's time. The countdown itself (when
// it started, how long it runs) is play's; the chrome only draws it.
import type { Ms } from "../../play";
import { clamp01 } from "./ease";

export interface Countdown {
  readonly from: Ms;
  readonly ms: number;
}

/** Filled share in [0, 1]. */
export const progress = (c: Countdown, now: Ms): number => (c.ms > 0 ? clamp01((now - c.from) / c.ms) : 1);

/** Still running at `now`: the frames should keep coming. */
export const running = (c: Countdown | null, now: Ms): boolean => c !== null && progress(c, now) < 1;
