// An opponent's leaf as a container (§1.1), shaped by the no-middle template (template.ts `LeafGeometry`): every leaf's
// front row reaches toward my creatures on one front line, and the leaf ends in a far strip (library, graveyard, exile,
// the waiting commander) the builder keeps; how many rows fit between is the engine's to find from the space. Plates are
// chrome at the top of the screen, over their leaf: a screen keepout. The leaf's one pose is the parting at its most
// (§5.3): its rows are laid to hold there, so any lesser parting holds too.
import type { Projector } from "../projector";
import { tableTemplate } from "../template";
import type { LeafGeometry, Parting, SeatSlot } from "../template";
import type { Rect, SeatId } from "../types";
import type { Container, FramePose, SurfaceFrame } from "./contract";
import { CARD, LEAN, onFrame, slotFrame } from "./frame";
import { S_TABLE, SLOT } from "./scale";

const TEMPLATE = tableTemplate(4);
/** Where a leaf's front row stands (world z, at its middle) at rest, in the four-seat template. */
export const FRONT_Z = TEMPLATE.leaf.front;
/** How deep a leaf is from its anchor edge, the far strip included, and the far strip's depth (four seats). */
export const LEAF: LeafGeometry = TEMPLATE.leaf;
/** A plate on the top of the screen, CSS px: the seat's summary as icons (designer §6, §7.2). */
export const PLATE = { top: 6, h: 44, w: 330 } as const;
/** World units a parting of `cards` card heights slides a leaf along its `away`. */
export const partShift = (cards: number): number => cards * CARD.h * S_TABLE;
/** The parting at its most, as a pose: the leaves' rows hold their floors and patches there. */
export const partedPose = (part: Parting): FramePose => ({ id: "parted", shift: partShift(part.most) });
/** The four-seat template's parting at its most. */
export const PARTED: FramePose = partedPose(TEMPLATE.part);

/**
 * The leaf's frame for a slot: square to me (every leaf's rows run straight across, so all their front rows stand on one
 * line), its anchor slid along `away` to the front line. A side slot's turn is `mat`'s: turned, a side leaf's back row
 * reaches under its plate as the mats part.
 */
export function leafFrame(slot: SeatSlot, leaf: LeafGeometry = LEAF): SurfaceFrame {
  const f = slotFrame({ ...slot, yaw: 0 });
  const front = SLOT.margin + SLOT.strip * S_TABLE;
  // Slide the anchor along `away` so the front row's feet are on the front line.
  const now = onFrame(f, 0, front).z, k = (now - leaf.front) / f.away.z;
  return { ...f, anchor: onFrame(f, 0, -k), d: leaf.d };
}

export interface LeafOptions {
  readonly id: string;
  readonly seat: SeatId;
  readonly viewer: SeatId;
  readonly slot: SeatSlot;
  readonly projector: Projector;
  readonly safe: Rect;
  readonly poses?: readonly FramePose[];
  /** Extra screen keepouts (the stack's place, chrome). */
  readonly keepouts?: Container["keepouts"];
  /** The template's leaf (the four-seat one by default). */
  readonly leaf?: LeafGeometry;
}

export function leafContainer(o: LeafOptions): Container {
  const leaf = o.leaf ?? LEAF, frame = leafFrame(o.slot, leaf);
  // The plate sits over the leaf's middle, at the top of the screen.
  const x = o.projector.project(onFrame(frame, 0, frame.d)).x;
  const plate: Rect = { left: x - PLATE.w / 2, right: x + PLATE.w / 2, top: o.safe.top + PLATE.top, bottom: o.safe.top + PLATE.top + PLATE.h };
  return {
    id: `rest:${o.seat}`,
    role: "rest",
    owner: o.seat,
    viewer: o.viewer,
    frame,
    projector: o.projector,
    poses: o.poses ?? [],
    layer: { kind: "table" },
    stand: { lean: LEAN },
    floors: { creature: o.seat === o.viewer ? 72 : 56, any: 44, tapPx: 44 },
    keepouts: [
      { on: "screen", rect: plate, kind: "plate" },
      { on: "frame", u0: -frame.w / 2, u1: frame.w / 2, v0: frame.d - leaf.far, v1: frame.d, kind: "zones" },
      ...(o.keepouts ?? []),
    ],
    safe: o.safe,
    captions: null,
    growth: "fixed",
    entry: `plate:${o.seat}`,
    paging: null,
  };
}
