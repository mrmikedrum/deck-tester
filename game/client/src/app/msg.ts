// Messages: every input to update, stamped with when it happened (and, for the player's input, which commit they
// saw). The loop sorts a frame's messages by time; on a tie the player's input comes first, then snapshots and the
// transport's other events, then deadlines.
import type { Ms } from "../platform";
import type { Insets } from "../platform";
import type { Act } from "../play";
import type { CardId, Stamp, StopId } from "../protocol";
import type { NewGameRequest, TransportEvent } from "../transport";
import type { LayerId } from "./focus";

/** The layers the player opens by a control of their own. */
export type OpenLayer = "inspector" | "menu" | "hand" | "log" | "losses";
import type { DeadlineId } from "./ids";
import type { RenderReport } from "./slots";

/** The player's input, from the renderers, the keyboard and the debug surface. `origin`: the control it came from (its
 * `data-fk`), where keyboard focus returns when a layer it opens goes. */
export type InputMsg = (
  | { readonly t: "act"; readonly stamp: Stamp; readonly stop: StopId | null; readonly act: Act }
  | { readonly t: "dismiss"; readonly stamp: Stamp }
  | { readonly t: "restore"; readonly stamp: Stamp; readonly layer: LayerId }
  /** Open a layer of the app's own: the inspector on a card, the Game menu, the hand as a list, the log, the losses. */
  | { readonly t: "open"; readonly stamp: Stamp; readonly layer: OpenLayer; readonly card: CardId | null }
  /** From a nameplate focus: that seat's board, brought nearer (the nameplate closes, the table leans in on it). */
  | { readonly t: "board"; readonly stamp: Stamp; readonly seat: string }
  /** The player closed the loss notice beside the decision. */
  | { readonly t: "dismissRecap"; readonly stamp: Stamp }
  /** Another page of the sift up: the sift of `group` (the hit group whose pager was pressed). */
  | { readonly t: "siftPage"; readonly stamp: Stamp; readonly group: string; readonly delta: number }
  | { readonly t: "newGame"; readonly stamp: Stamp; readonly req: NewGameRequest }
  | { readonly t: "listDecks"; readonly stamp: Stamp }
  /** A mouse pointer moved onto another hit group on the canvas (null: onto none, off the canvas, or it pressed). */
  | { readonly t: "hover"; readonly stamp: Stamp; readonly group: string | null }
) & { readonly origin?: string | null };

export type Msg =
  | TransportEvent
  | InputMsg
  | { readonly t: "viewport"; readonly at: Ms; readonly w: number; readonly h: number; readonly safe: Insets }
  /** The reduced-motion setting changed. */
  | { readonly t: "motion"; readonly at: Ms; readonly reduced: boolean }
  | { readonly t: "scene"; readonly at: Ms; readonly report: RenderReport }
  | { readonly t: "deadline"; readonly at: Ms; readonly id: DeadlineId; readonly serial: number };

export const timeOf = (m: Msg): Ms => ("stamp" in m ? m.stamp.at : m.at);

/** The tie order: input, then the viewport and the motion setting, then the transport's events, then deadlines, then
 * renderer reports. */
export function rankOf(m: Msg): number {
  switch (m.t) {
    case "act":
    case "dismiss":
    case "restore":
    case "open":
    case "newGame":
    case "listDecks":
    case "dismissRecap":
    case "board":
    case "siftPage":
    case "hover":
      return 0;
    case "viewport":
    case "motion":
      return 1;
    case "snapshot":
    case "answered":
    case "link":
    case "art":
    case "started":
    case "decks":
    case "cards":
    case "fault":
      return 2;
    case "deadline":
      return 3;
    case "scene":
      return 4;
  }
}

/** Time order with the tie rule; the sort is stable, so equal messages keep source order, then arrival order. */
export const byTime = (a: Msg, b: Msg): number => timeOf(a) - timeOf(b) || rankOf(a) - rankOf(b);

/** Whether a message is a transport event (and so carries the epoch it was issued under). */
export const fromTransport = (m: Msg): m is TransportEvent => "epoch" in m;
