// The scene's contract (docs/game-client-architecture.md, "scene: the table") and the stage's plain data: what the app
// hands the scene each commit, what it reports back, what `inspect` returns, and the stage's targets, flights and views.
// Pure types: no three.js.
import type { ChangeSet, MomentKind, ReadingId, SeatId, TableModel } from "../../model";
import type { CardId } from "../../protocol";
import type { Point, Quad, Rect, TablePlan, V3 } from "../../layout";
import type { BoardCues, CommitId, Mark, Ms, ScreenPose } from "../../play";
import type { ChipSpec, FaceSpec, PlateSpec, SeatPlace } from "../../theme";
import type { DrawnPiece } from "./pick";

// ---- the frame in, the report out -------------------------------------------------------------------------------------

/** A moment's id (the app's cross-renderer moment, docs "Moments across both renderers"). */
export type MomentId = string;

/** A card a moment carries, with its pose when the chrome let it go and who draws it this commit. */
export interface MomentView {
  readonly id: MomentId;
  readonly card: CardId;
  readonly pose: ScreenPose;
  readonly owner: "chrome" | "scene";
}

/** The app's focus layers (app/focus `LayerId`), the top one with its subject: `seat` for a lean-in, `group` for a sift,
 * `card` for the inspector. The table's own layers are the stack, a lean-in and a sift; the rest are the chrome's
 * (a sheet, the inspector, the mulligan, the Game menu, the hand's list), drawn over the table. */
export type FocusLayer = "stack" | "clash" | "lean" | "sift" | "sheet" | "inspector" | "mulligan" | "menu" | "hand";
/** The table's own layers: always under the chrome's. */
export type TableLayerId = "stack" | "clash" | "lean" | "sift";
/** A table layer open in the focus stack, with its subject. */
export interface TableLayer {
  readonly layer: TableLayerId;
  readonly seat: SeatId | null;
  readonly group: string | null;
  /** A sift's page (layout `SIFT_PAGE` cards each), from 0; absent is the first. */
  readonly page?: number;
}
export interface FocusTop {
  readonly layer: FocusLayer | null;
  readonly seat: SeatId | null;
  readonly group: string | null;
  readonly card: CardId | null;
  /** A sift's page, from 0; absent is the first. */
  readonly page?: number;
  /**
   * Every table layer open, bottom first, whatever chrome layer is over them: the topmost decides how the table looks
   * (the stack stays dimmed under a sheet). Without it only the top entry is known, and the table follows it when it is
   * a table layer.
   */
  readonly table?: readonly TableLayer[];
}
export const NO_FOCUS: FocusTop = { layer: null, seat: null, group: null, card: null };

const TABLE_LAYERS: ReadonlySet<FocusLayer> = new Set<FocusLayer>(["stack", "clash", "lean", "sift"]);

/** The table layer that decides how the table looks: the topmost open, or none. */
export function tableFocus(f: FocusTop): TableLayer | null {
  if (f.table) return f.table[f.table.length - 1] ?? null;
  return f.layer !== null && TABLE_LAYERS.has(f.layer) ? { layer: f.layer as TableLayerId, seat: f.seat, group: f.group, ...(f.page ? { page: f.page } : {}) } : null;
}

/** What of the focus the table is drawn from, as a key. */
export function tableFocusKey(f: FocusTop): string {
  const t = tableFocus(f);
  return t ? `${t.layer}|${t.seat}|${t.group}|${t.page ?? 0}` : "";
}

/** What a highlighted card means, which its halo's colour says: mine (ember), a threat (blood), a spell (gold). */
export type HighlightTone = "mine" | "threat" | "spell";

/** How a highlight looks (theme `materials.highlight`): the scrim's alpha over the rest, the lift (world units), how
 * flat (1 unlit), the halo's strength. */
export interface HighlightLook {
  readonly dim: number;
  readonly lift: number;
  readonly flat: number;
  readonly halo: number;
}

/** A highlight the app asks for: the cards stepped out of the light, each with its meaning, and the look (by default the
 * theme's look for choosing targets). The stack as the focus brings its own (the spell and what it aims at). */
export interface HighlightRequest {
  readonly cards: ReadonlyMap<CardId, HighlightTone>;
  readonly look?: Partial<HighlightLook>;
}

/**
 * A composed camera move the app asks for: onto a hit group (a card, a pile, a zone), where it was last drawn, or onto a
 * seat's page; `ms` overrides the theme's time. Null in the frame: the table's own camera.
 */
export type ZoomRequest = ({ readonly group: string } | { readonly seat: SeatId }) & { readonly ms?: number };

export interface SceneFrame {
  readonly model: TableModel;
  readonly plan: TablePlan;
  /** Every change set the scene has not consumed yet, in order (by seq). Sets it has already taken are skipped. */
  readonly changes: readonly ChangeSet[];
  readonly mode: "animate" | "cut";
  readonly cues: BoardCues;
  readonly focus: FocusTop;
  /** Cards a moment carries, with their poses. */
  readonly moments: readonly MomentView[];
  /** The hit group under a mouse pointer (a `pick`'s id): its piece lifts a little. Null for none, or a touch. */
  readonly hover: string | null;
  readonly commit: CommitId;
  /** Reduced motion (a setting): shorter moves, no stagger; never changes decision timing. */
  readonly reducedMotion?: boolean;
  /** Cards to step out of the table's light (choosing targets), or none. */
  readonly highlight?: HighlightRequest | null;
  /** What another player has just put onto the battlefield: news, cued where it lands (the narrative's `arrived`). */
  readonly news?: readonly CardId[];
  /** The camera composed on a subject (a trial for now), or the table's. */
  readonly zoom?: ZoomRequest | null;
}

/**
 * A must-not-miss moment (a sweep, an elimination, something of the viewer's lost or aimed at) that the backlog played
 * compressed or collapsed into a cut: the app logs it and adds it to the loss notice. Nothing is dropped without a trace.
 */
export interface Recap {
  readonly seq: number;
  readonly rev: string;
  readonly how: "compressed" | "collapsed";
  readonly kind: MomentKind;
  readonly reading: ReadingId;
  /** Why it must not be missed. */
  readonly why: "sweep" | "eliminated" | "lost" | "targeted";
  readonly seats: readonly SeatId[];
  /** The cards it moved or aimed at. */
  readonly cards: readonly CardId[];
}

export interface SceneReport {
  /** Anything moving or waiting: keep the loop running. */
  readonly active: boolean;
  /** The newest change set rev it has taken (started or collapsed). */
  readonly consumed: string | null;
  /** The newest change set seq it has taken (the app drops sets up to it from its queue). */
  readonly consumedSeq: number | null;
  /** Moments whose flight ended this frame. */
  readonly landed: readonly MomentId[];
  /** Where the top stack card rests, on screen. */
  readonly stackLanding: ScreenPose | null;
  readonly fault: string | null;
  /** Must-not-miss moments compressed or collapsed this frame (an addition to the doc's report). */
  readonly recaps: readonly Recap[];
  /**
   * Cards in flight between zones: a card the model has moved that has not yet arrived where the scene draws it (its
   * flight waits its turn or is on its way, or a set not yet taken moves it). Layout's `settling`: pages keep their
   * shape while cards leave them, and re-fit when it turns false. Not reflow, focus or look changes (see `active`).
   */
  readonly flying: boolean;
  /**
   * Ambient effects are showing (embers, wells, an aim's arc, a combat lane, a bolt): they move on their own, so the
   * app's loop wakes now and then though nothing is moving (`active`).
   */
  readonly ambient?: boolean;
  /** The camera drawn was not the table's: zoomed, or on its way in or back (the app keeps the table's input from play
   * until the table's camera is drawn again). */
  readonly composed?: boolean;
}

/** Classified gestures over the canvas (not yet: the gesture recognizer lands with input/). */
export type SceneIntent = { readonly t: "tap"; readonly at: Point; readonly group: string | null };

// ---- poses and looks -------------------------------------------------------------------------------------------------

/** Where a piece is: its middle in the world, turned by `ry` (yaw, applied first) then `rx` (pitch), and its scale. */
export interface Pose {
  readonly pos: V3;
  readonly rx: number;
  readonly ry: number;
  readonly s: number;
}

/** The channels besides the pose: dim (0 bright .. 1 greyed), lift off the table, tap turn, mark glow, opacity. */
export interface Look {
  readonly fade: number;
  readonly lift: number;
  readonly tap: number;
  readonly glow: number;
  readonly alpha: number;
  /** A page's size (0 for anything else). */
  readonly w: number;
  readonly d: number;
}

export type Sample = Pose & Look;

export const LOOK: Look = { fade: 0, lift: 0, tap: 0, glow: 0, alpha: 1, w: 0, d: 0 };

// ---- what describe produces --------------------------------------------------------------------------------------------

/**
 * What a piece is: a layout unit, a plate, a stack entry, a page, a hidden count (a hand), or a card on a sheet
 * (a pile's card fanned out in front of the camera, and the scrim behind them).
 */
export type PieceKind = "unit" | "plate" | "stack" | "page" | "hidden" | "sift";

/** A mana well's sign and light (old h.js `well`): what it says, its colours, and whether every land in it is spent. */
export interface WellLook {
  /** "Mountain ×4", "Lands 6". */
  readonly sign: string;
  /** "1 tapped", "+ 1 mana rock", or null. */
  readonly sub: string | null;
  /** Mana colours its sources make, the strongest one or two (letters). */
  readonly colours: readonly string[];
  /** Every land in it is tapped: the light goes and a stain is left. */
  readonly spent: boolean;
  /** How many cards it shows lying in it (up to 4). */
  readonly shown: number;
  /** Theirs: one well signed "Lands", its sign over the card in the seat's colour. */
  readonly theirs: boolean;
  /** Mine: its sign stands further out, so neighbours' signs alternate and never meet; a little smaller in a long row. */
  readonly alt: boolean;
  readonly small: boolean;
}

/** What the view builds for a piece (descriptions, never three.js objects). */
export type Draw =
  | {
      readonly t: "unit";
      readonly unit: "card" | "pile" | "well" | "summary";
      readonly posture: "stand" | "prop" | "lean" | "flat";
      readonly token: boolean;
      /** "Beast 9": its count follows what has arrived. A pile of copies of a creature is titled by its name. */
      readonly title: string | null;
      /** Its title's second line: what a mixed pile holds, how many of it are tapped (h.js `tabSub`, `kindLine`). */
      readonly sub: string | null;
      /** It holds unlike cards: its tab may reach past its card, over its own fan. */
      readonly mixed: boolean;
      readonly mine: boolean;
      readonly chips: readonly ChipSpec[];
      /**
       * The Auras and Equipment on its top card, peeking out from behind it: members, but not counted in its title. The
       * stage draws only those that have arrived (one still flying to it is not there yet).
       */
      readonly dressed: readonly { readonly card: CardId; readonly face: FaceSpec }[];
      /** Its card's mana colours (letters): a spell's crackle, a well's light. */
      readonly colours: readonly string[];
      /** A mana well's sign and light, or null. */
      readonly well: WellLook | null;
      /**
       * The copies it draws, front (a well: top) first, each standing for members of the pile and wearing their state: a
       * tapped copy shows a tapped member's face; null is the top card's face. Ready copies first.
       */
      readonly copies: readonly { readonly face: FaceSpec | null; readonly tapped: boolean }[];
      /** "↷4": how many are tapped, where the copies cannot show it exactly (more members than copies); null else. */
      readonly tapNote: string | null;
      /** Its title as placed on screen (labels.ts): the name it says, its text size (CSS px) and its slide along the top
       * edge (a share of the card's width); null where it gives way to the count chip, or has no title. */
      readonly label: { readonly name: string; readonly px: number; readonly slide: number } | null;
      /** Its seat's colour (a well's sign notch, a standee's stripe). */
      readonly seatColour: string;
      /** A seed for its effects (its first card's id): the same card, the same ash and embers. */
      readonly seed: number;
      /** Not yet awake on its controller's turn (summoning sick): mist at its foot instead of a clean pool. */
      readonly sick: boolean;
      /**
       * A pile holding something that matters says so with a rising mote: why (I can act on it, it can hurt me, it answers
       * the moment, it is new on the table), or null. A lone card wears only news: what it is, it shows.
       */
      readonly cue: "act" | "threat" | "answer" | "news" | null;
      /** The moment's light on it: a brighter pool where it answers the moment, its light out where it is left out. */
      readonly light: "forward" | "down" | null;
    }
  | { readonly t: "plate"; readonly spec: PlateSpec }
  | {
      readonly t: "stack";
      readonly tag: string;
      readonly colour: string;
      readonly ability: boolean;
      /** Its card's mana colours: the crackle off its rim. */
      readonly colours: readonly string[];
      /** The stack is the table's focus: it draws over the table. */
      readonly up: boolean;
      /** Its owner's tag's scale: 1 set aside; as the focus, the size it was set aside. */
      readonly tagScale: number;
      /** The printed card (its source's, for an ability): shown as the focus, over the painted face. */
      readonly img: string | null;
      /** An ability's effect, on a slip under the card as the focus (the card alone does not say which ability). */
      readonly slip: string | null;
    }
  | { readonly t: "page"; readonly place: SeatPlace; readonly mine: boolean; readonly seed: number; readonly turn: boolean }
  | { readonly t: "hidden" }
  /**
   * A card on a sheet (a pile opened, a seat's spread): `from` is where it rests on the table (it flies out of it and back
   * into it); `members` the cards its place stands for (copies stacked: more than one) and `region` its target on screen
   * as the engine computed it at rest (layout `sheetOf`), which a tap reaches.
   */
  | { readonly t: "sift"; readonly card: CardId; readonly tapped: boolean; readonly from: string; readonly members: readonly CardId[]; readonly region: Quad }
  /** The shade a sift lays over the table, and the vellum behind its cards (a screen rect, CSS px). */
  | { readonly t: "scrim"; readonly back: Rect; readonly screen: { readonly w: number; readonly h: number } };

export interface Piece {
  /** Its hit group's id where it has one: a unit's id, "zone:<zone>:<seat>", "plate:<seat>", "stack:<key>". */
  readonly id: string;
  readonly kind: PieceKind;
  readonly seat: SeatId | null;
  /** Every card it draws or counts, in order (the top/shown card first for a unit). */
  readonly members: readonly CardId[];
  /** The card whose face it shows (a unit's top, a stack entry's source); a zone shows its last arrived member. */
  readonly face: CardId | null;
  readonly pose: Pose;
  readonly look: Look;
  /** Structural: rebuild when it changes. */
  readonly form: string;
  /** Cheap: patched in place (tap, counters, marks, titles). */
  readonly mods: string;
  readonly mark: Mark | null;
  /** Its cards are at the 44 px floor on screen (`SMALL_FACE_PX`): they wear the small face (theme `FaceSpec.small`). */
  readonly small?: boolean;
  readonly draw: Draw;
  /** Shown only while it holds an arrived card (a unit, a spell on the stack). */
  readonly needsMembers: boolean;
  /** It stands in the combat row (layout `Unit.fighting`): it steps out to the fight and home again along the middle. */
  readonly fight?: boolean;
  /**
   * Where the plan put it, when a focus has moved it (the stack as the focus, a lean-in): its hit group's quad was
   * measured there, so a tap reaches it where it is drawn by carrying the quad from this pose (pick.ts).
   */
  readonly base?: Pose;
}

/**
 * An attack's lane (layout `combatLanes`): from its attacker's piece to where it lands, a point on the defender's page
 * edge or a piece (the blocker that stopped it, the planeswalker it attacks); each end an offset from its piece, so the
 * lane follows the pieces as they move.
 */
export interface Lane {
  readonly id: string;
  readonly attacker: CardId;
  readonly from: string;
  readonly fromOffset: V3;
  readonly to: { readonly piece: string; readonly offset: V3 } | { readonly at: V3 };
  /** The crest over the page (lanes to one seat crest higher one after another). */
  readonly apex: number;
  /** The attacker's seat ink. */
  readonly colour: string;
  readonly blocked: boolean;
}

/** A stack item's aim at what it targets: from its stack piece to the target's piece (a card's unit, a plate, a spell). */
export interface Aim {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** What it lands on: a card standing or lying, a plaque, or another spell on the stack. */
  readonly onto: "card" | "plate" | "spell";
  /** The spell's mana colours. */
  readonly colours: readonly string[];
  /** Below the top item: fainter. */
  readonly faint: boolean;
}

export interface Description {
  readonly pieces: ReadonlyMap<string, Piece>;
  /** Every card in the model to the one piece that draws or counts it. */
  readonly home: ReadonlyMap<CardId, string>;
  readonly lanes: readonly Lane[];
  readonly aims: readonly Aim[];
  /** The table's light: 1, or dimmed under a sift. */
  readonly tableTone: number;
  /** The scrim over the table while a focus is up (the stack, the clash: its alpha), 0 for none. */
  readonly scrim: number;
  /** The clash's calm ground on screen (CSS px), under its fighters and over the shaded table, or null. */
  readonly ground: Rect | null;
  /** The clash's fighters, standing on its plane: they throw no shadow on the table below. */
  readonly aloft: ReadonlySet<string>;
  /** The pieces drawn above the scrim, in their own places: the stack's cards and what they aim at. */
  readonly above: ReadonlySet<string>;
  /** The pieces stepped out of the light (the stack's and what they aim at, or what the app asked for), and the look. */
  readonly highlight: ReadonlyMap<string, HighlightTone>;
  readonly highlightLook: HighlightLook | null;
  readonly perspective: SeatId;
}

// ---- flights -----------------------------------------------------------------------------------------------------------

/** Where a card that moved goes: a pile, the piece it becomes, my hand, or nowhere (it burns out, or goes to a plate). */
export type Dest =
  | { readonly to: "piece"; readonly piece: string }
  | { readonly to: "hand" }
  | { readonly to: "nowhere"; readonly how: "burn" | "fizzle" | "plate"; readonly seat: SeatId | null };

/** Where a card comes from: the piece it left, my hand (or the pose a moment carried), a plate, or what made it. */
export type Origin =
  | { readonly from: "piece"; readonly piece: string }
  | { readonly from: "hand"; readonly moment: MomentId | null; readonly pose: ScreenPose | null }
  | { readonly from: "plate"; readonly seat: SeatId }
  | { readonly from: "maker"; readonly piece: string };

export type Phase = 0 | 1 | 2;

/** A card that moved, planned: a departure (it left a drawn piece) or an arrival (from out of sight or the hand). */
export interface FlightPlan {
  /** "c<card>" or "i<stack item>" (an ability has no card). */
  readonly key: string;
  readonly card: CardId | null;
  readonly departure: boolean;
  readonly origin: Origin;
  readonly dest: Dest;
  /** The card as it looked while it flies. */
  readonly face: FaceSpec | null;
  readonly token: boolean;
  /** Which motion: from the change. */
  readonly motion: "depart" | "spell" | "burn" | "fizzle" | "cast" | "join" | "return" | "withdraw";
  readonly phase: Phase;
  readonly cohort: string;
  readonly rank: number;
  /** From the stage's poses at planning: how far it has to go (the nearest leaves first). */
  readonly distance: number;
}

/** A flight scheduled on the clock. */
export interface Scheduled extends FlightPlan {
  readonly start: Ms;
  readonly dur: Ms;
  /** Lift off the page before the flight proper (part of `dur`). */
  readonly lift: Ms;
}

// ---- what the view draws each frame ----------------------------------------------------------------------------------

export interface ActorView {
  readonly id: string;
  readonly kind: PieceKind;
  readonly form: string;
  readonly mods: string;
  readonly draw: Draw;
  readonly mark: Mark | null;
  /** The face it shows now (a zone's last arrived card), or null. */
  readonly face: FaceSpec | null;
  /** What has arrived (a pile's count follows it). */
  readonly shown: number;
  readonly sample: Sample;
  readonly visible: boolean;
  /** Stepped out of the light, as far as it has come (`k`, 0..1): its meaning, how flat it is drawn, its halo's strength. */
  readonly hl: { readonly tone: HighlightTone; readonly k: number; readonly flat: number; readonly halo: number } | null;
}

export interface GhostView {
  readonly id: string;
  readonly face: FaceSpec | null;
  readonly token: boolean;
  readonly sample: Sample;
  /** A flare where it burns out or fizzles: 0..1 through it, null for none. */
  readonly flare: number | null;
  readonly colours: readonly string[];
}

/** A lane as drawn this frame: its stroke's points between where its pieces are now. */
export interface LaneView {
  readonly id: string;
  readonly points: readonly V3[];
  readonly colour: string;
  readonly blocked: boolean;
}

/** A bolt: an unblocked attacker's blow, from it through where its lane landed onto the plaque it strikes. */
export interface BoltView {
  readonly id: string;
  readonly points: readonly V3[];
  readonly colours: readonly string[];
  /** 0..1 through its life. */
  readonly k: number;
}

/** An aim as drawn this frame: the arc's points between where its two pieces are now. */
export interface AimView {
  readonly id: string;
  readonly points: readonly V3[];
  readonly colours: readonly string[];
  readonly faint: boolean;
  readonly flare: boolean;
}

/** A blow landing on a plaque as its life drops (h.js `buildBoard`): a burst of streaks thrown off the plate. */
export interface StrikeView {
  readonly id: string;
  /** The plate's piece id ("plate:<seat>"): the burst rides it. */
  readonly plate: string;
  /** When it went off (ms, the stage's clock) and its seed: the same strike draws the same streaks. */
  readonly t0: Ms;
  readonly seed: number;
}

/** The clash's ground as drawn: a rect on screen (CSS px), its soft edge, tone and alpha. */
export interface FocusGround {
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
  readonly feather: number;
  readonly colour: number;
  readonly alpha: number;
}

export interface StageView {
  readonly actors: readonly ActorView[];
  readonly ghosts: readonly GhostView[];
  readonly lanes: readonly LaneView[];
  readonly bolts: readonly BoltView[];
  /** Plates struck this moment (a life lost): each a burst while it lasts. */
  readonly strikes: readonly StrikeView[];
  readonly aims: readonly AimView[];
  readonly tableTone: number;
  /** The scrim's alpha this frame (it eases in and out), and the pieces drawn above it (with the aims). */
  readonly scrim: number;
  /** The clash's calm ground this frame (eased with the scrim), or null. */
  readonly ground?: FocusGround | null;
  /** Pieces standing on the clash's plane: no shadow on the table. */
  readonly aloft?: ReadonlySet<string>;
  readonly above: ReadonlySet<string>;
  /** The frame's time, ms (the effects' clock), and whether motion is reduced (effects hold still, particles go). */
  readonly now: Ms;
  readonly still: boolean;
  /** Every piece as it was drawn, by id (a hit group's id where it has one): what the scene's `pick` reaches. */
  readonly drawn: ReadonlyMap<string, DrawnPiece>;
}

// ---- inspect -----------------------------------------------------------------------------------------------------------

export interface PieceSnapshot {
  readonly id: string;
  readonly kind: PieceKind;
  readonly seat: SeatId | null;
  readonly members: readonly CardId[];
  /** What it shows (members minus what has not landed, plus what has not left yet). */
  readonly shown: readonly CardId[];
  readonly visible: boolean;
  /** A piece no longer in the description, still showing cards waiting their turn to leave. */
  readonly remnant: boolean;
  readonly form: string;
  readonly mods: string;
  readonly now: Sample;
  readonly target: Pose;
  readonly moving: boolean;
}

export interface FlightSnapshot {
  readonly id: string;
  readonly key: string;
  readonly card: CardId | null;
  readonly departure: boolean;
  readonly origin: Origin;
  readonly dest: Dest;
  readonly phase: Phase;
  readonly cohort: string;
  readonly seq: number;
  readonly start: Ms;
  readonly end: Ms;
  readonly state: "waiting" | "flying";
  readonly progress: number;
}

export interface SceneSnapshot {
  readonly now: Ms;
  readonly pieces: readonly PieceSnapshot[];
  readonly flights: readonly FlightSnapshot[];
  readonly backlog: {
    readonly waiting: readonly { readonly seq: number; readonly rev: string; readonly age: Ms }[];
    readonly consumed: string | null;
    readonly consumedSeq: number | null;
    /** Each set taken, and how it was played. */
    readonly taken: readonly { readonly seq: number; readonly how: "played" | "compressed" | "collapsed" | "cut"; readonly at: Ms }[];
  };
  readonly recaps: readonly Recap[];
  /** The departures planned for the last set taken (the laws read them). */
  readonly departures: readonly FlightPlan[];
  readonly cuts: number;
  /** Faces kept for cards gone from the model (a token, a card to a library) while a flight or a remnant shows them. */
  readonly faces: number;
}

