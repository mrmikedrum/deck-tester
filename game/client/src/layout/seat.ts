import type { CardId, SeatId, V3 } from "./types";
import type { Quad } from "./shape";

// A seat as the table plan draws it: the arrangement engine's units (arrange/adapter.ts), its fixtures and memory.

export type UnitId = string;
export type UnitRole = "creature" | "walker" | "support" | "mana";
export type UnitKind = "card" | "pile" | "well" | "summary";
/**
 * How the piece stands: a standee leans back to face the camera; a prop stands nearly upright (theirs, far off); a lean is
 * propped up a little (my support); flat lies on the page.
 */
export type Posture = "stand" | "prop" | "lean" | "flat";

export interface Placement {
  /** Where its foot rests, on the table plane (y is 0 at rest). */
  readonly pos: V3;
  readonly scale: number;
  readonly posture: Posture;
  /**
   * The card's own axes, untapped (its right and up, unit vectors): set by the arrangement engine, whose cards stand at
   * one lean and lie squared to their leaf; absent, the posture's rule (standing back by the camera's pitch...) holds.
   */
  readonly frame?: { readonly right: V3; readonly up: V3 };
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
  /** Its cards act now (attack, block, are aimed at). */
  readonly acting: boolean;
  /** Gathered into the clash, away from its place, which stays free for it (arrange/gathering.ts). */
  readonly fighting?: boolean;
  /** Whether the card it shows lies turned, tapped (never a well's: its spent state is its stain and its sign). */
  readonly tapped: boolean;
  readonly placement: Placement;
  /** How far its card is turned for tapped (the arrangement engine's: 1 a quarter turn, 1/6 a notch); absent, tapped is a
   *  quarter turn. */
  readonly turn?: number;
  /** What a tap at rest reaches, on screen, when it is not its face (the arrangement engine's place). */
  readonly hit?: Quad;
  /** The cards a tap on it reaches when that is more than its members: an attachment the decision offers rides on its
   *  host, and the host's place opens a chooser of both (the arrangement engine's `open` target). */
  readonly reach?: readonly CardId[];
  /** The moment's light on it (the arrangement engine's emphasis, light only): it stands in a brighter pool, or its
   *  light is out. Absent: as at rest. */
  readonly light?: "forward" | "down";
  /** Something it hides answers the moment: I may act on it (offered, aimed at), it is in danger or can hurt me, or it
   *  answers my attack. Absent: nothing hidden matters now. */
  readonly cue?: "act" | "threat" | "answer";
}

/** Everything that is not a card or pile on a page: the page itself and the plate's place on the table (the nameplate
 *  is chrome; graveyard, exile and a waiting commander are on it, not on the table). */
export interface Fixtures {
  /** The page lying on the table, from its fixed edge. */
  readonly page: { readonly pos: V3; readonly w: number; readonly d: number; readonly yaw: number };
  readonly plate: Placement;
}

/** Plain JSON on purpose: serialisable for goldens, diffable in tests. `fit` belongs to the layout that wrote it. */
export interface LayoutMemory {
  readonly v: 1;
  readonly paradigm: string;
  readonly fit: unknown;
}

export interface SeatPlan {
  readonly seat: SeatId;
  readonly units: readonly Unit[];
  /** Every permanent, attached ones included, maps to exactly one unit. Derived from the units, never trusted. */
  readonly home: ReadonlyMap<CardId, UnitId>;
  readonly fixtures: Fixtures;
  readonly memory: LayoutMemory;
  readonly report: {
    /** Cards no place could hold, reached through the seat's entry pile. */
    readonly overflow: boolean;
  };
}
