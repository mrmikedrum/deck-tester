// Auto-pass (live.js `autoContinue`): on someone else's spell or ability, with nothing real to answer it with (mana
// abilities don't count) and nothing aimed at me or mine, play passes by itself after 3,200 ms unless held. It is
// armed only when a stop is adopted, so the same decision again never restarts it; its deadline id names the stop,
// so a deadline left from an older stop never answers a newer one.
import type { Decision } from "../protocol";
import type { Facts } from "./facts";
import { topItem } from "./facts";
import { playOptions } from "./kinds/play";
import type { StopId } from "./types";

export const AUTO_PASS_MS = 3200;

/** Named as the app names deadlines: by their owner ("play/"), then what and for which stop. */
export const autoId = (stop: StopId): string => `play/autopass:${stop}`;

export function autoArms(d: Decision, f: Facts): boolean {
  if (d.kind !== "play" || !f.mayAnswer || f.over) return false;
  const top = topItem(f);
  // live.js read an item with no controller as the viewer's own: no auto-pass on it.
  if (!top || top.controller === null || top.controller === f.me) return false;
  return !f.threat && playOptions(d).length === 0;
}
