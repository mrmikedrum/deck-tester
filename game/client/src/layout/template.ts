import type { CameraSpec } from "./projector";

// The table's geometry as data: where each seat's page sits, for a number of seats and a form factor. Seats are keyed
// by where they sit relative to the viewer, never by who they are, so a spectator or a rotated table needs no change.

export type SeatPosition = "near" | "left" | "across" | "right";

/** A page's slot on the table plane: centre, the most it may grow to, and the turn toward the viewer. */
export interface SeatSlot {
  readonly position: SeatPosition;
  readonly x: number;
  readonly z: number;
  /** Width and depth of the slot: a page grows from its fixed edge up to this. */
  readonly w: number;
  readonly d: number;
  readonly yaw: number;
}

export type Form = "landscape" | "portrait";

export interface TableTemplate {
  readonly form: Form;
  readonly seats: number;
  readonly camera: CameraSpec;
  /** In viewer-relative order: near first, then clockwise. */
  readonly slots: readonly SeatSlot[];
  /** On their turn a page comes forward this much in place, from its fixed edge (slots never overlap even so). */
  readonly growOnTurn: number;
  /**
   * Focus-first: the opponents' slots are leaves of fixed size in a band across the far side, and the open middle below
   * them is the floor, from their slips' near edge to my creatures' tops.
   */
  readonly leaves?: boolean;
}

export type Paradigm = "mat" | "front";

export class NotTunedError extends Error {
  constructor(seats: number, form: Form) {
    super(`No table template is tuned for ${seats} seats in ${form}: only 4 seats in landscape so far.`);
    this.name = "NotTunedError";
  }
}

// The camera never moves. (Old CAM; the old code created the camera at fov 34 and `resize` set it to 38 or wider.)
const CAMERA: CameraSpec = { pos: { x: 0, y: 18, z: 14 }, at: { x: 0, y: 0, z: -1.6 }, fovDeg: 38, keepWidth: 1.44 };

// A page's fixed edge is its back for me (by my hand) and its front for the others, at v = d/2; it grows from there to
// fit its rows up to the slot's w x d, and slots never overlap one another on screen, even grown 1.1x on their turn.
// Together they fill the open book: across high in the middle, the sides beside it, mine below. (Old BASE, verbatim.)
const LANDSCAPE_4: readonly SeatSlot[] = [
  // its back edge inside the screen's foot (about 803u), its border showing between hand and prompt
  { position: "near", x: 0, z: 2.7, w: 22, d: 7.6, yaw: 0 },
  { position: "left", x: -8.68, z: -7.42, w: 7.8, d: 11.4, yaw: 0.16 },
  // its back edge, at its deepest, just inside the top of the screen
  { position: "across", x: 0, z: -10.5, w: 8.4, d: 12.2, yaw: 0 },
  { position: "right", x: 8.68, z: -7.42, w: 7.8, d: 11.4, yaw: -0.16 },
];

// Focus-first's leaves: three pages of one fixed size in a band across the far side, their near edges in a line (about
// 300u down the screen), so the floor below them is open; mine as today.
const LEAF_W = { side: 7.9, across: 8.3 } as const;
const LEAF_D = 9.7;
const LEAF_Z = -4.95 - LEAF_D / 2;
const LEAVES_4: readonly SeatSlot[] = [
  LANDSCAPE_4[0]!,
  { position: "left", x: -8.62, z: LEAF_Z, w: LEAF_W.side, d: LEAF_D, yaw: 0.1 },
  { position: "across", x: 0, z: LEAF_Z, w: LEAF_W.across, d: LEAF_D, yaw: 0 },
  { position: "right", x: 8.62, z: LEAF_Z, w: LEAF_W.side, d: LEAF_D, yaw: -0.1 },
];

/** The template for `seats` seats in `form`, or a `NotTunedError`: other counts and portrait are not tuned yet. */
export function tableTemplate(seats: number, form: Form = "landscape", paradigm: Paradigm = "mat"): TableTemplate {
  if (seats === 4 && form === "landscape") {
    if (paradigm === "front") return { form, seats, camera: CAMERA, slots: LEAVES_4, growOnTurn: 1, leaves: true };
    return { form, seats, camera: CAMERA, slots: LANDSCAPE_4, growOnTurn: 1.1 };
  }
  throw new NotTunedError(seats, form);
}
