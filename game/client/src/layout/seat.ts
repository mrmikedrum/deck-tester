import type { SeatBoard } from "./board";
import type { CombatPairs } from "./combat";
import type { Projector } from "./projector";
import type { Reservations } from "./reservations";
import type { SeatSlot } from "./template";
import type { CardId, SeatId, V3, Viewport } from "./types";

// The seam for the opponent-board exploration: one seat's board in, a plan out. `mat` (seat/mat.ts) is today's page.

export type UnitId = string;
export type UnitRole = "creature" | "walker" | "support" | "mana";
export type UnitKind = "card" | "pile" | "well" | "summary";
/**
 * How the piece stands: a standee leans back to face the camera; a prop stands nearly upright (theirs, far off); a lean is
 * propped up a little (my support); flat lies on the page.
 */
export type Posture = "stand" | "prop" | "lean" | "flat";

/** The region a seat's page may take: its slot, scaled (a lean-in is a bigger, lifted region). */
export interface SeatRegion extends SeatSlot {
  /** Height above the table: 0 at rest. */
  readonly lift: number;
}

export interface Placement {
  /** Where its foot rests, on the table plane (y is 0 at rest). */
  readonly pos: V3;
  readonly scale: number;
  readonly posture: Posture;
  /** Standing: how far it leans back from upright, radians (the `die` layout's brass foot: 25°); the camera's pitch,
   * square to me, when absent. */
  readonly lean?: number;
}

export interface Unit {
  /** Stable for as long as the unit lasts: its kind letter and first card (the old piece key). */
  readonly id: UnitId;
  readonly role: UnitRole;
  readonly kind: UnitKind;
  /** Every card the unit holds, the card it shows first for a standing pile (a tap acts on it). What a sift opens. */
  readonly members: readonly CardId[];
  /** Auras and equipment drawn on this unit's top card; they are in `home` too, but never in a sift of their own. */
  readonly dressing: readonly CardId[];
  /** The card it shows. */
  readonly top: CardId;
  /** A pile's title ("Beast 9", "Tokens 12", "Creatures 31"), or null for a card or a plain stack of copies. */
  readonly title: string | null;
  /** A pile of unlike cards. */
  readonly mixed: boolean;
  /** Its cards act now (attack, block, are aimed at): it stands in its place but the combat row will take it. */
  readonly acting: boolean;
  /** Standing in the combat row in the open middle, away from its page place, which stays free for it (combat.ts). */
  readonly fighting?: boolean;
  /** Whether the card it shows lies turned, tapped (never a well's: its spent state is its stain and its sign). */
  readonly tapped: boolean;
  readonly placement: Placement;
  /** A tray under dice (the `die` layout): its cards lying as one unit, ready ones under a bone die and tapped ones
   * turned behind under an iron die. `members` is `ready` then `tapped`. */
  readonly tray?: Tray;
  /** A fan of real cards lying in one place (the `die` layout's support): one group, its members fanned from the foot. */
  readonly fan?: boolean;
  /** Lying where it is spent (tapped) but measured upright: drawn shaded with a slight turn, never a quarter turn. */
  readonly spent?: boolean;
  /** What it covers lying flat, past its card, in card heights from its foot: a tray's rim and lip, a fan's spread. */
  readonly footprint?: Footprint;
}

/** A lying unit's footprint in its card's frame: its width, and how far in front of its foot and behind it reaches. */
export interface Footprint {
  readonly w: number;
  readonly front: number;
  readonly back: number;
}

/** What a tray's top card is: the real card (a swarm of one kind) or a tally card naming a mixed stack. */
export type TrayTop = "card" | "ranks" | "others" | "mana" | "lands" | "rocks";

export interface Tray {
  readonly ready: readonly CardId[];
  readonly tapped: readonly CardId[];
  readonly top: TrayTop;
  /** The brass lip along its front: "36 power", or null (nothing worth a lip: not creatures, or no power). */
  readonly lip: string | null;
  /** The keywords on the lip, each with how many have it, or null when every member has it. */
  readonly lipIcons: readonly { readonly keyword: string; readonly count: number | null }[];
  /** A tally card's roster and ceiling: what a mixed stack holds, in the terms that matter. */
  readonly summary: Summary | null;
  /** A detachment: the attackers of a swarm that go to the combat row together, under one die. */
  readonly detachment?: boolean;
  /** One stack, ready and tapped together, its bone and iron dice side by side on it (their mana: no band behind). */
  readonly stack?: boolean;
}

/** Everything that is not a card or pile on a page: the page itself, the plate and its zone piles. */
export interface Fixtures {
  /** The page lying on the table, from its fixed edge. */
  readonly page: { readonly pos: V3; readonly w: number; readonly d: number; readonly yaw: number };
  readonly plate: Placement;
  readonly zones: readonly { readonly zone: "graveyard" | "exile"; readonly placement: Placement }[];
  /** The commander standing beside the plaque while it is in the command zone (h.js `banner`). */
  readonly commander?: { readonly card: CardId; readonly placement: Placement };
}

/** A summary: what a folded or last-resort unit holds, in the terms that matter. */
export interface Summary {
  readonly count: number;
  readonly totalPower: number;
  readonly tapped: number;
  readonly keywords: readonly { readonly keyword: string; readonly count: number }[];
  /** The biggest creature (power, then toughness, then lower id), if any. */
  readonly biggest: CardId | null;
}

/** Plain JSON on purpose: serialisable for goldens, diffable in tests. `fit` belongs to the layout that wrote it. */
export interface LayoutMemory {
  readonly v: 1;
  readonly paradigm: string;
  readonly fit: unknown;
}

export interface SeatInput {
  readonly seat: SeatId;
  readonly board: SeatBoard;
  readonly region: SeatRegion;
  readonly projector: Projector;
  readonly reserve: Reservations;
  readonly viewport: Viewport;
  /** Cards acting now (combat, aimed at): they leave their piles while they act. */
  readonly involved: ReadonlySet<CardId>;
  /** True while cards are still flying off the battlefield (the app's virtual clock says so): the page holds its shape. */
  readonly settling: boolean;
  /** The previous plan's memory: kept places, held rows. Ignored when it was written by another paradigm. */
  readonly memory: LayoutMemory | null;
  /** Fold this many notches harder than the layout likes (set by `planSeat`'s retry, 0 to start). */
  readonly pressure: number;
  /** Attacks and blocks, where a layout seats its fighters by what they do (the `die` layout's detachments). */
  readonly combat?: CombatPairs | null;
  /** Cards the decision up offers: a layout may keep them out of its folds, so a tap on the table can reach them. */
  readonly offered?: ReadonlySet<CardId>;
}

export interface SeatPlan {
  readonly seat: SeatId;
  readonly units: readonly Unit[];
  /** Every permanent, attached ones included, maps to exactly one unit. Derived from the units, never trusted. */
  readonly home: ReadonlyMap<CardId, UnitId>;
  readonly fixtures: Fixtures;
  readonly memory: LayoutMemory;
  readonly report: {
    readonly folded: number;
    readonly held: boolean;
    readonly pressure: number;
    /** The page asked for more room than its slot has (crowded); folding makes up for it. */
    readonly overflow: boolean;
    /** Set by `planSeat` when even the hardest fold broke a limit and the whole seat became one summary. */
    readonly lastResort: boolean;
  };
}

export interface SeatLayout {
  readonly id: string;
  plan(input: SeatInput): SeatPlan;
}
