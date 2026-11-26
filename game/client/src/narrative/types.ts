// The narrative's state and what it hands the renderers. Plain data (arrays and records only), so it serialises.
import type { CardId, StackId } from "../protocol";
import type { MomentKind, ReadingId, SeatId } from "../model";

/** One line of the log: Forge's own (its words, without its bracketed annotations), a turn's heading, or a result the
 * client read from the zones (live.js `outcomes`). */
export interface Entry {
  readonly id: number;
  /** Forge's type, lower case ("stack_add", "zone_change", "life"...), or "turn" or "result". */
  readonly type: string;
  /** What was recorded: Forge's line (live.js `logText`), the heading, or the result's sentences. */
  readonly said: string;
  /** What the log shows instead of `said`, when the client words it better ("Drew Island"). */
  readonly display: string | null;
  /** What the strip shows for it, when it words it shorter (live.js `feedText`: "Marath spent 3 +1/+1 counters for a
   * 3/3 Elemental"); the log keeps `said`. */
  readonly feed: string | null;
  /** A result's headline: what the strip shows for it ("Serra Angel went to the graveyard"). */
  readonly headline: string | null;
  /** A result's lines, shown by the strip in place of everything else while it is the newest (a counter, Sunfall). */
  readonly summary: readonly string[] | null;
  /** The card Forge's entry is about, if it names one. */
  readonly card: CardId | null;
  /** The notice it waits for: it is shown once that notice is released. */
  readonly wait: number | null;
}

/** A card of mine that left the battlefield on someone else's turn (live.js `noteLosses`). */
export interface Loss {
  readonly id: number;
  readonly card: CardId;
  /** The card's name. */
  readonly name: string;
  /** "to the graveyard", "to exile", "to hand", "to the command zone", or "away" (out of sight). */
  readonly where: string;
  readonly token: boolean;
  /** The last log line that names it, or "". */
  readonly why: string;
  readonly wait: number | null;
}

/** A card coming into my hand, and the zone it came from ("library" for a draw the log reports; null: out of sight). */
export interface Arrival {
  readonly card: CardId;
  readonly from: string | null;
}

/**
 * What waits for a change set's motion on the table: the prompt's watching headline, the strip's line meanwhile, the
 * stack items still on their way, the cards coming into my hand, and (through `Entry.wait` and `Loss.wait`) the log lines
 * and losses that must not be told before they are seen. The app releases it when the scene has played that set, or cut
 * past it (`release`).
 */
export interface Notice {
  readonly id: number;
  /** The change set whose motion it waits for. */
  readonly seq: number;
  /** live.js `moving`: "Cards are leaving the stack", "Atraxa's attackers are moving in"; "" for none. */
  readonly motion: string;
  /** live.js `motionEntry`: the strip's one line meanwhile ("Counterspell is resolving"), or null. */
  readonly line: string | null;
  readonly arriving: readonly StackId[];
  readonly hand: readonly Arrival[];
  /** Sunfall is exiling creatures: the prompt's red tone holds while it does. */
  readonly sweeping: boolean;
}

/**
 * A must-not-miss moment the scene played compressed or collapsed, or one the app's queue cut past unseen (the shape of
 * scene/stage/backlog.ts `mustNotMiss`'s recaps, which the app hands over).
 */
export interface Recap {
  readonly seq: number;
  readonly rev: string;
  readonly how: "compressed" | "collapsed";
  readonly kind: MomentKind;
  readonly reading: ReadingId;
  readonly why: "sweep" | "eliminated" | "lost" | "targeted";
  readonly seats: readonly SeatId[];
  readonly cards: readonly CardId[];
}

/** A short message the app shows for a while (its lifetime is the app's `app/notice:<id>` deadline). */
export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly level: "info" | "warn";
  readonly at: number;
}

export interface State {
  /** The log, oldest first, the turns' headings among the lines; the newest LOG_KEPT. */
  readonly entries: readonly Entry[];
  /** The turn the strip heads its lines with ("Turn 9 · You"); "" before a turn has an active player. */
  readonly heading: string;
  /** The strip's candidates, newest first: this turn's entries (by id), at most LATEST_KEPT. */
  readonly latest: readonly number[];
  /** The keys (live.js `logKey`) of the last model's log: a line not among them is new. */
  readonly seen: readonly string[];
  /** The last model's turn. */
  readonly turn: number | null;
  /** Waiting for their change sets' motion, oldest first; at most NOTICES_KEPT (an older one is released). */
  readonly notices: readonly Notice[];
  /** Every loss this game, for the report: the newest LOSSES_KEPT. */
  readonly losses: readonly Loss[];
  /** The losses in the current recap (by id): replaced by the next ones, cleared on a new turn or dismissed. */
  readonly recap: readonly number[];
  /** Must-not-miss moments the player may not have seen, newest last: the newest RECAPS_KEPT. */
  readonly missed: readonly Recap[];
  /** On screen, oldest first: the newest TOASTS_KEPT. */
  readonly toasts: readonly Toast[];
  /** Ids for entries, losses, notices and toasts: never reset in a page's life. */
  readonly serial: number;
  /**
   * The view went back to an earlier position (live.js `restoreNotice`): "Back to your earlier main phase", until the
   * next change set; null otherwise.
   */
  readonly restore: string | null;
  /** live.js `restoring`: the restore's cue is up, until the app says the cut has been seen (`restored`). */
  readonly restoring: boolean;
  /** The cards that last came into my hand this game (live.js `lastHandArrivals`): the fan's glow, "Last added". */
  readonly fresh: readonly CardId[];
  /** What another player last put onto the battlefield (news on the table), this turn: kept until the next arrive, the
   *  turn or the position changes. */
  readonly arrived: readonly CardId[];
}

// ---- views -------------------------------------------------------------------------------------------------------------

/** The strip at the top left (live.js `feed`): the turn, and at most two lines of what just happened. */
export interface LogStripView {
  /** "Turn 9 · You"; the strip is hidden while it is "". */
  readonly heading: string;
  /** Newest first. `draw`: a line saying I drew (underlined). */
  readonly lines: readonly { readonly text: string; readonly draw: boolean }[];
  /** "summary": a result's lines; "recent": two lines, the newest first; "one": a single line. */
  readonly tone: "summary" | "recent" | "one";
}

export interface LogRow {
  /** Forge's type in lower case, "turn" or "result" (the sheet's row class: `t-<type>`). */
  readonly type: string;
  readonly text: string;
}

/** The full log (live.js `fullLog`, "What happened"): turns newest first, each heading over its lines, newest first. */
export interface LogSheetView {
  readonly groups: readonly { readonly heading: LogRow; readonly rows: readonly LogRow[] }[];
  /** "Your losses · 2 to the graveyard", when I have lost anything this game (it opens the loss report). */
  readonly losses: string | null;
}

/** The loss notice beside the decision (live.js `recapHTML`). */
export interface RecapView {
  /** "Your loss", or "3 of your cards left play". */
  readonly title: string;
  /** "Serra Angel · to the graveyard", or "2 to the graveyard · 1 to exile". */
  readonly summary: string;
}

/** A row of the loss report (live.js `lostSheet`, "What you lost"), newest first. */
export interface LossRow {
  readonly name: string;
  /** "went to the graveyard", "(token) left play", "left play · destination unknown". */
  readonly fate: string;
  /** The log line that names it, or null. */
  readonly why: string | null;
}

/** After going back to an earlier position, on a play decision (live.js `status`'s `rewind`). */
export interface RestoreView {
  /** "Back to your earlier main phase": shown in the headline's place while `restoring`. */
  readonly cue: string;
  /** "Your decision · main phase": the headline once the cue has gone. */
  readonly headline: string;
  /** The cue is up: the context and every button but Hold are hidden, and the prompt is not asking yet. */
  readonly restoring: boolean;
}

/** While the table moves: what the prompt says instead of its question (live.js `status`'s `watching`). */
export interface WatchView {
  /** "On the way to the stack", "A card returning from the graveyard to your hand", "Cards are leaving the stack". */
  readonly headline: string;
  /** Stack items still on their way: the stack summary calls them "Arriving". */
  readonly arriving: readonly StackId[];
  /** On the way to the stack: the play kind's "Choose a play" button is not offered meanwhile. */
  readonly toStack: boolean;
  readonly sweeping: boolean;
}
