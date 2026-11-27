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
  /** Every opponent's leaf when the arrangement engine lays it out (docs/game-arrangement-engine.md §5.3). */
  readonly leaf: LeafGeometry;
  /** How far the leaves may part for what rests on the middle at table size (duels, the stack). */
  readonly part: Parting;
  /** My side when the arrangement engine lays it out: where my field's feet stand (world z, at its middle). */
  readonly mine: { readonly field: number };
}

/**
 * The no-middle template's leaf: every opponent's front row stands on one front line, its feet at `front` (world z, at
 * the leaf's middle), so at rest the table holds back no middle; the leaf reaches `d` from its anchor edge and ends in a
 * far strip `far` deep (library, graveyard, exile, the waiting commander). How many rows fit between is the engine's.
 */
export interface LeafGeometry {
  readonly front: number;
  readonly d: number;
  readonly far: number;
}

/**
 * The mats part by sliding every opponent's leaf along its own `away`, by the least multiple of `step` card heights that
 * opens the room asked for, never past `most`: the leaves' rows are laid to hold their floors and patches at `most`
 * (guarantee 12), so a parting never refolds a board.
 */
export interface Parting {
  readonly most: number;
  readonly step: number;
}

export class NotTunedError extends Error {
  constructor(seats: number, form: Form) {
    super(`No table template is tuned for ${seats} seats in ${form}: 1 to 4 seats in landscape so far.`);
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

// Every leaf's front row reaches toward my creatures on one line; across, it stands at z ≈ −3.9 (its slice's measure),
// and the side leaves, turned the same as their slots, meet it there.
const LEAF_4: LeafGeometry = { front: -3.9, d: 13, far: 0 };
const PART_4: Parting = { most: 0.15, step: 0.05 };
// My field faces theirs with no middle held back at rest, where the old layout's stood: as near them as keeps my standing faces
// over their floor (72 design px). The parting opens the middle by sliding it toward me as it slides the leaves away.
const MINE_4 = { field: 0.8 } as const;

/**
 * Fewer opponents share the same width (a seat that leaves gives its room back): the span from the left leaf's outer
 * edge to the right's, the gap between two leaves as at four seats, each opponent an equal slot, square to me. Their
 * positions keep their order (left to right, clockwise from me).
 */
function fewer(opponents: number): SeatSlot[] {
  const left = LANDSCAPE_4[1]!, right = LANDSCAPE_4[3]!, across = LANDSCAPE_4[2]!;
  const l = left.x - left.w / 2, r = right.x + right.w / 2, gap = across.x - across.w / 2 - (left.x + left.w / 2);
  const w = (r - l - gap * (opponents - 1)) / opponents;
  const positions: readonly SeatPosition[] = opponents === 1 ? ["across"] : ["left", "right"];
  return positions.map((position, i) => ({ position, x: l + w / 2 + i * (w + gap), z: across.z, w, d: across.d, yaw: 0 }));
}

/**
 * The template for `seats` seats in `form` (1 to 4 in landscape: one seat is the near place alone, the game over), or a
 * `NotTunedError`: portrait is not tuned.
 */
export function tableTemplate(seats: number, form: Form = "landscape"): TableTemplate {
  if (form === "landscape" && seats >= 1 && seats <= 4) {
    const slots = seats === 4 ? LANDSCAPE_4 : [LANDSCAPE_4[0]!, ...(seats > 1 ? fewer(seats - 1) : [])];
    return { form, seats, camera: CAMERA, slots, growOnTurn: 1.1, leaf: LEAF_4, part: PART_4, mine: MINE_4 };
  }
  throw new NotTunedError(seats, form);
}
