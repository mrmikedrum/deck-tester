// How a control sends what the player did: an act for play, or an order for the app (the focus stack's moves, the Game
// menu's), stamped by the renderer with the stop and commit the control was drawn for and the control it came from.
// Components get a Send made for their commit and never see the stamp.
import type { Act } from "../play";
import type { Order } from "./view";

export type Send = (what: Act | Order) => void;

/** An order rather than an act: orders carry `t`, acts `a`. */
export const isOrder = (what: Act | Order): what is Order => "t" in what;
