// What a commit reports back, and the toast's lifetime. Nothing else should grow here.
import type { Carried } from "../play";
import type { SceneReport } from "../scene/stage/types";

/** How long a toast stays up (live.js `toast`: 2,600 ms): its `app/notice:<id>` deadline. */
export const NOTICE_MS = 2600;

// ---- the renderers ---------------------------------------------------------------------------------------------------

/** What a commit reports: the scene's report merged with the chrome's activity and faults. */
export interface RenderReport {
  /** Anything moving or counting down: keep the loop running. */
  readonly active: boolean;
  readonly fault: string | null;
  /** The fault is one no later commit recovers from (the scene could not start): the notice shows at once and stays,
   * and no recovery commit is asked for. */
  readonly terminal?: boolean;
  /** The scene's report when it drew this commit (consumed change sets, landed moments, recaps); null when it did not. */
  readonly scene: SceneReport | null;
  /** The idle table moves on its own (the scene's ambient effects): the loop keeps a slow cadence, still settled. */
  readonly ambient?: boolean;
  /** Carried cards the chrome drew away from the pose it was given (a resize re-anchored them to the hand's new place). */
  readonly carried?: readonly Carried[];
}
