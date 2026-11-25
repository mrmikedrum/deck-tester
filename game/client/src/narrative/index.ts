// narrative: the log, the notices that wait for the table, the losses. See docs/game-client-architecture.md
// ("narrative").
//
//   narrate(state, changes, model)  -> state: one change set's story (Forge's lines under the turn's heading, the result
//                                      read from the zones, my losses), with what must be seen first waiting on a notice
//   release(state, upTo | "all")    the scene has played the change sets up to `upTo` (or cut): their notices go
//   recapped(state, recaps, model)  must-not-miss moments compressed or cut past: kept, and their losses noted
//   restored(state)                 the cut back to an earlier position has been seen: its cue goes
//   dismissRecap, toast, expire, restart
//   logStripView, logSheetView, recapView, lossReport, watching, restoreView   what the chrome and the prompt show
//
// Pure: no DOM, no clock; imports protocol and model. Bounded: the log keeps its newest 400 lines (LOG_KEPT), the strip
// 12 candidates, 8 notices wait at most (an older one is released), 60 losses, 20 recaps, 4 toasts; `seen` is the last
// model's log window.
export type * from "./types";
export {
  dismissRecap,
  expire,
  initial,
  LATEST_KEPT,
  LOG_KEPT,
  narrate,
  NOTICES_KEPT,
  recapped,
  RECAPS_KEPT,
  release,
  restart,
  restored,
  toast,
  TOASTS_KEPT,
} from "./narrate";
export { logSheetView, logStripView, lossReport, recapView, restoreView, watching } from "./view";
