// An opponent's leaf as a container (§1.1), shaped to the designer's no-middle table: the leaf reaches toward my
// creatures (its front row stands at z ≈ −3.9 across), holds two standing rows and a lying row, and ends in a far strip
// (library, graveyard, exile, the waiting commander) the builder keeps. Plates are chrome at the top of the screen,
// over their leaf: a screen keepout. The template's no-middle variant (a later step) will own these numbers; the slice
// builds the across leaf from today's slot with them.
import type { Projector } from "../projector";
import type { SeatSlot } from "../template";
import type { Rect, SeatId } from "../types";
import type { Container, FramePose, SurfaceFrame } from "./contract";
import { CARD, LEAN, onFrame, slotFrame } from "./frame";
import { S_TABLE, SLOT } from "./scale";

/** Where a leaf's front row stands (world z, across) at rest: its anchor is the count strip and margin nearer. */
export const FRONT_Z = -3.9;
/** How deep a leaf is from its anchor edge, the far strip included, and the far strip's depth. */
export const LEAF = { d: 13, far: 2.2 } as const;
/** A plate on the top of the screen, CSS px: the seat's summary as icons (designer §6, §7.2). */
export const PLATE = { top: 6, h: 44, w: 330 } as const;
/** The mats part for a fight or a set-aside spell: the leaves slide away by about two card heights (designer §1). */
export const PARTED: FramePose = { id: "parted", shift: 2 * CARD.h * S_TABLE };

/** The leaf's frame for a slot: today's slot turned the same way, brought toward me to the no-middle reach. */
export function leafFrame(slot: SeatSlot): SurfaceFrame {
  const f = slotFrame(slot);
  const front = SLOT.margin + SLOT.strip * S_TABLE;
  // Slide the anchor along `away` so the front row's feet are at FRONT_Z (on a turned leaf, at its middle).
  const now = onFrame(f, 0, front).z, k = (now - FRONT_Z) / f.away.z;
  return { ...f, anchor: onFrame(f, 0, -k), d: LEAF.d };
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
}

export function leafContainer(o: LeafOptions): Container {
  const frame = leafFrame(o.slot);
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
      { on: "frame", u0: -frame.w / 2, u1: frame.w / 2, v0: frame.d - LEAF.far, v1: frame.d, kind: "zones" },
      ...(o.keepouts ?? []),
    ],
    safe: o.safe,
    captions: null,
    growth: "fixed",
    entry: `plate:${o.seat}`,
    paging: null,
  };
}
