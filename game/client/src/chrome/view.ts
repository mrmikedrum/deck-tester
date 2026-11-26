// What the chrome draws (ChromeView, built by the app's `chromeView(state)` once per commit) and what it sends back
// (ChromeIntent, through the ports). The chrome never calls play or the transport: every control it draws carries the
// stop and commit it was drawn for, and an act it emits is stamped with them.
import type { Insets } from "../platform";
import type { Reservations } from "../layout";
import type { CardId } from "../protocol";
import type { Act, CardAction, Carried, CommitId, Controls, Ms, Stamp, StopId } from "../play";
import type { LogSheetView, LogStripView, LossRow, RecapView, RestoreView, WatchView } from "../narrative";
import type { SeatPlace } from "../theme";

/** A card in the hand as the fan draws it. */
export interface HandCard {
  readonly id: CardId;
  readonly name: string;
  /** The printed cost, braced ("{2}{U}"), or null. */
  readonly cost: string | null;
  /** The art crop shown in the fan (a url), or null while it loads. */
  readonly art: string | null;
  /** The whole card's image, for the peek. */
  readonly image: string | null;
  /** Rules text the fan shows on an opened instant or sorcery (the old fan's `handRules`); null for anything else. */
  readonly rules: string | null;
  /** It has a play now (play's `marks.hand`): its edge is lit. */
  readonly playable: boolean;
}

export interface HandView {
  /** In hand order. */
  readonly cards: readonly HandCard[];
  /** Slid away below the screen (the mulligan, a sift): play's `handAway`, or the app's focus. */
  readonly away: boolean;
  /** Responding to an opponent's spell with plays on offer: the playable cards open wider (the old `responseFan`). */
  readonly respond: boolean;
  /**
   * Released cards the chrome keeps drawing where they were let go: an open offer's carried card, and every moment the
   * chrome still owns (`owner: "chrome"`). They leave the fan; the scene takes each over in the commit it drops out.
   */
  readonly carried: readonly Carried[];
  /** Cards just added, for the arrival glow (the newest draws). */
  readonly fresh: readonly CardId[];
}

/** How a card a sheet offers looks, when the table holds it or the catalogue knows it. */
export interface CardLook {
  readonly name: string;
  readonly image: string | null;
  /** The art crop and braced cost, for a card held off the hand (a moment's card the hand no longer lists). */
  readonly art?: string | null;
  readonly cost?: string | null;
}

/** The focus layers (the app's focus stack): the table's own (the stack, a lean-in, a sift) and the chrome's. */
export type ChromeLayer = "stack" | "clash" | "lean" | "sift" | "sheet" | "inspector" | "mulligan" | "menu" | "hand" | "log" | "losses" | "seat";

/** A plate's icons, in a fixed order: total power on the table, open mana, cards in hand (and fliers in a focus). */
export type IconKind = "power" | "creatures" | "wing" | "shield" | "mana" | "hand" | "graveyard" | "exile" | "command";

export interface IconView {
  readonly kind: IconKind;
  /** Its figure ("34", "10"); struck through when the absence is the answer. */
  readonly figure: string;
  readonly none?: boolean;
}

/** A seat's nameplate: chrome, square to the screen, always lit. Opponents' at the top over their leaves, mine at the
 * bottom. A tap on it is the tap on its plate's hit group (a target, or the nameplate focus). */
export interface PlateView {
  readonly seat: string;
  /** Its hit group ("plate:<seat>"): the tap it sends. */
  readonly group: string;
  readonly name: string;
  readonly life: number;
  readonly place: SeatPlace;
  readonly mine: boolean;
  /** Its turn: a gilt edge. */
  readonly active: boolean;
  /** What a decision makes of it: an option (ember), chosen (gold). */
  readonly ring: "option" | "selected" | null;
  readonly out: boolean;
  /** Its anchor, CSS px: an opponent's plate's top left corner (the top row bends round the table's cards: app/seats.ts
   * `placeTop`); the middle of my plate's bottom edge. */
  readonly x: number;
  readonly y: number;
  readonly unit: number;
  readonly icons: readonly IconView[];
  /** In a combat: the unblocked power coming at this seat ("−3"), in its tone; and whether this seat attacks. */
  readonly tally?: PlateTally | null;
  readonly attacking?: boolean;
}

/** A plate's tally: red at me, gold when my attack is at it, the attacker's ink between opponents. */
export interface PlateTally {
  readonly figure: string;
  readonly tone: "danger" | "gold" | "ink";
  /** Whose ink, between opponents: the attacker's place. */
  readonly place: SeatPlace;
}

/** The clash's chrome, at the gathering's screen positions (CSS px): the plaque over each wing, the brand in each
 * unblocked attacker's empty slot (its power; hollow at 0), the clasp between each pair. Nothing here is tapped: the
 * table's hit test reaches what they mark. */
export interface ClashView {
  readonly unit: number;
  readonly plaques: readonly { readonly key: string; readonly x: number; readonly y: number; readonly w: number; readonly words: string; readonly tone: PlateTally["tone"]; readonly place: SeatPlace }[];
  readonly brands: readonly {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly size: number;
    readonly figure: string | null;
    /** Twins: how many attackers share the column. */
    readonly count: number | null;
    readonly tone: PlateTally["tone"];
    readonly place: SeatPlace;
    /** The defender is below (me): the chevron points down; else up. */
    readonly down: boolean;
  }[];
  readonly clasps: readonly { readonly key: string; readonly x: number; readonly y: number }[];
  /** An attacked planeswalker's tally, over its top edge. */
  readonly tallies: readonly { readonly key: string; readonly x: number; readonly y: number; readonly figure: string; readonly tone: PlateTally["tone"] }[];
  /** The column for the fighters past one tier ("8 more · 14 power"); a tap on it opens them. */
  readonly more: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly words: string } | null;
}

/** A card picked up in a nameplate focus: its printed picture, or a back. */
export interface PickedCard {
  readonly id: CardId | null;
  readonly name: string;
  readonly image: string | null;
}

/** The nameplate focus: the seat in words, one line per icon, and its zones picked up. */
export interface SeatFocusView {
  readonly seat: string;
  readonly name: string;
  readonly life: number;
  readonly place: SeatPlace;
  readonly mine: boolean;
  readonly lines: readonly { readonly icon: IconKind; readonly head: string; readonly sub: string | null; readonly none?: boolean }[];
  readonly commanderDamage: readonly { readonly id: CardId; readonly source: string; readonly figure: string; readonly danger: boolean }[];
  readonly graveyard: readonly PickedCard[];
  readonly exile: readonly PickedCard[];
  /** The command zone: a commander waiting there (on the leaf too where it fits wholly clear of the chrome). */
  readonly command: readonly PickedCard[];
  /** It has a board on the table to see (a seat out of the game has none). */
  readonly board: boolean;
  /** An opponent's hand: backs (and any card shown face up); mine: the cards. */
  readonly hand: readonly PickedCard[];
  readonly handCount: number;
  readonly library: number;
  /** "Poison 2 · The monarch". */
  readonly also: string | null;
}

/** An open layer, bottom first: where keyboard focus returns when it goes (a control's `data-fk`). */
export interface LayerView {
  readonly layer: ChromeLayer;
  readonly restore: string | null;
}

/** A layer set aside, shown as a chip that restores it. */
export interface ChipView {
  readonly layer: ChromeLayer;
  readonly label: string;
}

/** A card the inspector or a list shows small (an attachment, a card in the opening hand). */
export interface CardTile {
  readonly id: CardId;
  readonly name: string;
  readonly image: string | null;
}

/** Everything about one card (common.js `inspect`), with what I can do with it now as buttons. */
export interface InspectorView {
  readonly card: CardId;
  /** A card in my hand: the hand's focus, the card held up at reading size beside the fan, the fan live under it. */
  readonly held?: boolean;
  readonly name: string;
  /** The whole card's picture; null face down or while it loads. */
  readonly image: string | null;
  readonly faceDown: boolean;
  /** Under the picture: "Face down", "Copying …". */
  readonly caption: string | null;
  /** The controller's place, for the seat colour beside the owner line. */
  readonly place: SeatPlace;
  /** "Marath · owned by Dack · Battlefield". */
  readonly owner: string;
  /** Facts as words: Commander, Tapped, 3/3, counters, keywords the rules text does not already say. */
  readonly chips: readonly string[];
  readonly related: readonly { readonly label: string; readonly cards: readonly CardTile[] }[];
  readonly rules: string | null;
  /** What it has on the stack, a line each: "Spell · Dack", "Ability · Controller unrecorded: create an X/X Elemental". */
  readonly stack?: readonly string[];
  /** play's `cardActions` for this card: each a pick of its option. */
  readonly actions: readonly CardAction[];
}

/** The opening hand over a dimmed table (live.js `mulligan`): the question, the cards, play's buttons. */
export interface MulliganView {
  readonly title: string;
  readonly cards: readonly CardTile[];
}

/** The Game menu: a new game, with a deck for me and three for the others. */
export interface MenuView {
  /** /api/decks: null while asked; empty when it failed (the error says so). */
  readonly decks: readonly string[] | null;
  readonly error: string | null;
  /** What the last game was started with, preselected. */
  readonly last: GameRequest | null;
  /** A game is in progress: starting one ends it (the start button is enamelled oxblood). */
  readonly inProgress?: boolean;
}

/** A new game as the chrome asks for it (transport's NewGameRequest). */
export interface GameRequest {
  readonly deck: string;
  readonly opponents: readonly string[];
  readonly mana: "creatures" | "always" | "auto";
}

/** A sift up (h.js `sift`'s caption): what the pile is, how many, and its pages when it has more than fit at once. */
export interface SiftView {
  /** The hit group sifted: its pager says which sift it pages. */
  readonly group: string;
  /** "Ana's graveyard ×12", "Forest ×5". */
  readonly title: string;
  readonly tapped: number;
  /** From 0, of `pages`; one page has no pager. */
  readonly page: number;
  readonly pages: number;
  /** "28–54 of 100" when it has pages. */
  readonly range: string | null;
  /** The top of the fanned cards, CSS px: the caption sits just above them. */
  readonly top: number;
  /** The chooser play opened this sift for (its revision), or null: a card chosen here says so. */
  readonly chooser: number | null;
  /** The cards on this page, in the order fanned, each as a control for the keyboard: choosing one is a tap on it. */
  readonly cards: readonly { readonly id: CardId; readonly label: string }[];
}

/** "Your hand" as a list (live.js `handSheet`): every card, what it costs, whether it has a play now. */
export interface HandSheetView {
  readonly cards: readonly { readonly id: CardId; readonly name: string; readonly cost: string | null; readonly playable: boolean; readonly fresh: boolean }[];
}

/** A row of the stack's rules sheet, top first (live.js `openStackRules`). */
export interface StackRow {
  readonly id: number;
  /** "Snap · Dack". */
  readonly title: string;
  /** An ability's effect, as the engine words it; null for a spell. */
  readonly effect: string | null;
  /** The card's rules text. */
  readonly rules: string | null;
}

export interface ChromeView {
  /** The commit this view is drawn for: every act it emits carries it. */
  readonly commit: CommitId;
  /** The layout viewport, CSS px, and the safe-area insets. */
  readonly viewport: { readonly w: number; readonly h: number; readonly safe: Insets };
  /** Where the hand and the prompt sit (layout's reservations): the chrome lays out inside these, never over the scene. */
  readonly reserve: Reservations;
  /** play's controls: the prompt, the sheet, the stop they were drawn for, whether this viewer may answer. */
  readonly controls: Controls;
  readonly hand: HandView;
  /** Card pictures for sheet items (by the item's card). */
  readonly looks: ReadonlyMap<CardId, CardLook>;
  /** Card pictures for sheet items the table does not hold (a library search), by the item's name. */
  readonly named: ReadonlyMap<string, CardLook>;
  /** The toast on screen, or null (its lifetime is the app's deadline). */
  readonly toast: string | null;
  /** Before a game has a model: the line the waiting prompt shows (no prompt, sheet or hand is drawn). */
  readonly waiting: string | null;
  /** The focus stack's open layers, bottom first (the last is the top), and the set-aside ones' chips. */
  readonly layers: readonly LayerView[];
  readonly chips: readonly ChipView[];
  readonly inspector: InspectorView | null;
  readonly mulligan: MulliganView | null;
  readonly menu: MenuView | null;
  readonly handSheet: HandSheetView | null;
  /** The stack, top first, for its rules sheet. */
  readonly stack: readonly StackRow[];
  /** A sift up: its caption, with the way back and its pages; null otherwise. */
  readonly sift: SiftView | null;
  /** Leaning in on a seat: "Ana's side", with the way back; null otherwise. */
  readonly back: string | null;
  /** The stack layer is up (not set aside): the prompt carries the stack summary instead of its context. */
  readonly stackOpen: boolean;
  /** The strip at the top left: the turn and what just happened (hidden before a turn has an active player). */
  readonly log: LogStripView;
  /** The strip's width (CSS px) where a card at the top of a leaf would be under it at its widest; null: its own. */
  readonly logWidth: number | null;
  /** "What happened", while its layer is open. */
  readonly logSheet: LogSheetView | null;
  /** "What you lost", while its layer is open. */
  readonly losses: readonly LossRow[] | null;
  /** The loss notice set into the prompt, or null. */
  readonly recap: RecapView | null;
  /** While the table moves: what the prompt says instead of asking; null otherwise. */
  readonly watch: WatchView | null;
  /** Back at an earlier position, on a play decision: the prompt's cue and headline; null otherwise. */
  readonly restore: RestoreView | null;
  /** Offer "New game" beside the prompt's words: no game yet, it could not start, or it is over. */
  readonly newGame: boolean;
  /** Every seat's nameplate. */
  readonly plates: readonly PlateView[];
  /** The clash up: its plaques, brands and clasps; null otherwise. */
  readonly clash: ClashView | null;
  /** A nameplate opened. */
  readonly seatFocus: SeatFocusView | null;
}

/** What the chrome asks of the app itself rather than of play: the focus stack's moves and the Game menu's. */
export type Order =
  | { readonly t: "dismiss" }
  | { readonly t: "restore"; readonly layer: ChromeLayer }
  | { readonly t: "open"; readonly layer: "inspector" | "menu" | "hand" | "log" | "losses"; readonly card: CardId | null }
  | { readonly t: "dismissRecap" }
  /** From a nameplate focus: that seat's board, brought nearer. */
  | { readonly t: "board"; readonly seat: string }
  /** A seat out of the game: its nameplate focus (its summary and zones), as a tap on its plate opens it in play. */
  | { readonly t: "seat"; readonly seat: string }
  /** From a nameplate focus: one of that seat's zones, opened in full (its sift). */
  | { readonly t: "zone"; readonly seat: string; readonly zone: "graveyard" | "exile" }
  /** Another page of the sift up: `delta` pages on (negative: back). */
  | { readonly t: "siftPage"; readonly group: string; readonly delta: number }
  | { readonly t: "newGame"; readonly req: GameRequest };

/**
 * What the chrome sends the app: an act from a control or a hand gesture, or an order, stamped. `origin` is the control
 * it came from (its `data-fk`), where keyboard focus returns when a layer it opens goes.
 */
export type ChromeIntent =
  | {
      readonly t: "act";
      readonly stamp: Stamp;
      /** The stop the control was drawn for (null: none was up). */
      readonly stop: StopId | null;
      readonly act: Act;
      readonly origin?: string | null;
    }
  | (Order & { readonly stamp: Stamp; readonly origin?: string | null });

export interface ChromePorts {
  /** Every act the player makes; the app queues it as an input message. */
  readonly emit: (intent: ChromeIntent) => void;
  /** Asks for a frame: the chrome's own motion changed between commits (a drag moved, a hold began). */
  readonly wake: () => void;
  /** The clock acts are stamped with (the platform clock unless a test gives its own). */
  readonly now?: () => Ms;
  /** Text width in CSS px for a CSS font (the fan's label widths); a canvas measure unless a test gives its own. */
  readonly measure?: (text: string, font: string) => number;
}

/** What a commit reports: the app's RenderReport. */
export interface ChromeReport {
  /** Something moves or counts down: keep the frames coming. */
  readonly active: boolean;
  readonly fault: string | null;
  /**
   * Carried cards drawn somewhere other than the pose the view gave: a layout change (a resize, a rotation) re-anchored
   * them to the hand's new place. The app moves its moments there, so the scene's flight sets off from where the card is
   * drawn. Absent or empty when every carried card is where the view said.
   */
  readonly carried?: readonly Carried[];
}
