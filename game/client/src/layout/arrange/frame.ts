// Geometry over a `SurfaceFrame` (§5.2): where a point of a container's surface is in the world, how a card stands or
// lies on it, and its face on screen. No level-table assumption: a frame may be tilted or lifted (a spread brought
// nearer), and everything here works in its own axes.
import type { Projector } from "../projector";
import type { Quad } from "../shape";
import type { SeatSlot } from "../template";
import type { Point, V3 } from "../types";
import type { CardPlace, SurfaceFrame } from "./contract";

/** A card is 1 tall and this wide (the scene's card), this thick. */
export const CARD = { w: 0.716, h: 1, thick: 0.014 } as const;
/** A presented card's lean back from the frame's normal (designer §2: 25°). */
export const LEAN = (25 * Math.PI) / 180;
/** A tapped card lying in a lying tier turns a notch clockwise (designer §7.3). */
export const NOTCH = (15 * Math.PI) / 180;
/** A standing card is lifted a finger's width off the surface. */
export const LIFT = 0.02;

export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const madd = (a: V3, b: V3, k: number): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });

/**
 * A seat slot's frame: anchored at the slot's fixed edge (an opponent's front, toward me; my own back, by my hand), rows
 * laid away from it. The table is level: the normal is up.
 */
export function slotFrame(slot: SeatSlot): SurfaceFrame {
  const c = Math.cos(slot.yaw), s = Math.sin(slot.yaw);
  const across = { x: c, y: 0, z: -s }, away = { x: -s, y: 0, z: -c };
  const centre = { x: slot.x, y: 0, z: slot.z };
  return { anchor: madd(centre, away, -slot.d / 2), across, away, normal: { x: 0, y: 1, z: 0 }, w: slot.w, d: slot.d };
}

/** The point at (u across, v away, h above) on the frame. */
export function onFrame(f: SurfaceFrame, u: number, v: number, h = 0): V3 {
  return madd(madd(madd(f.anchor, f.across, u), f.away, v), f.normal, h);
}

/** A face's frame: foot (middle of its foot edge), right and up, unit vectors. */
export interface Pose {
  readonly foot: V3;
  readonly right: V3;
  readonly up: V3;
}

/** A card standing with its foot's middle at (u, v), leaning back `lean` from the normal, square across the frame. */
export function standPose(f: SurfaceFrame, u: number, v: number, lean = LEAN): Pose {
  return { foot: onFrame(f, u, v, LIFT), right: f.across, up: madd(scale(f.normal, Math.cos(lean)), f.away, Math.sin(lean)) };
}

/**
 * A card lying centred at (u, v), turned `turn` radians clockwise as seen from above (0: its top points away; a quarter
 * turn: its top points right, along `across`). `s` is its scale; `h` its height above the surface (a stack's layer).
 */
export function liePose(f: SurfaceFrame, u: number, v: number, s: number, turn = 0, h = 0): Pose {
  const c = Math.cos(turn), sn = Math.sin(turn);
  const up = madd(scale(f.away, c), f.across, sn), right = madd(scale(f.across, c), f.away, -sn);
  return { foot: madd(onFrame(f, u, v, h), up, (-CARD.h * s) / 2), right, up };
}

/** A pose's face as a world quad: foot-left, foot-right, top-right, top-left. */
export function faceCorners(p: Pose, s: number): [V3, V3, V3, V3] {
  const hw = (CARD.w * s) / 2, top = madd(p.foot, p.up, CARD.h * s);
  return [madd(p.foot, p.right, -hw), madd(p.foot, p.right, hw), madd(top, p.right, hw), madd(top, p.right, -hw)];
}

export const projectQuad = (proj: Projector, q: readonly [V3, V3, V3, V3]): Quad =>
  [proj.project(q[0]), proj.project(q[1]), proj.project(q[2]), proj.project(q[3])] as const;

export function cardPlace(proj: Projector, card: CardPlace["card"], p: Pose, s: number, posture: CardPlace["posture"], turn: CardPlace["turn"], layer: number): CardPlace {
  return { card, foot: p.foot, right: p.right, up: p.up, posture, turn, layer, quad: projectQuad(proj, faceCorners(p, s)) };
}

/** A face's width on screen across its middle, CSS px: what a floor measures. */
export function faceWidth(proj: Projector, p: Pose, s: number): number {
  const mid = madd(p.foot, p.up, (CARD.h * s) / 2), hw = (CARD.w * s) / 2;
  const a = proj.project(madd(mid, p.right, -hw)), b = proj.project(madd(mid, p.right, hw));
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** A strip of a quad (foot-left, foot-right, top-right, top-left) between fractions v0 and v1 of its height. */
export function strip(q: Quad, v0: number, v1: number): Quad {
  const at = (u: number, v: number): Point => {
    const a = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u };
    const b = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
    return { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v };
  };
  return [at(0, v0), at(1, v0), at(1, v1), at(0, v1)];
}

/** A rectangle of the surface (u0..u1 across, v0..v1 away) on screen. */
export function surfaceQuad(proj: Projector, f: SurfaceFrame, u0: number, u1: number, v0: number, v1: number, h = 0): Quad {
  return projectQuad(proj, [onFrame(f, u0, v0, h), onFrame(f, u1, v0, h), onFrame(f, u1, v1, h), onFrame(f, u0, v1, h)]);
}

/** A standing slot's envelope on screen: u0..u1 at the foot line, up to a standing card's top. */
export function standQuad(proj: Projector, f: SurfaceFrame, u0: number, u1: number, v: number, s: number, lean = LEAN): Quad {
  const p = standPose(f, (u0 + u1) / 2, v, lean), top = madd(p.foot, p.up, CARD.h * s), hw = (u1 - u0) / 2;
  return projectQuad(proj, [madd(p.foot, p.right, -hw), madd(p.foot, p.right, hw), madd(top, p.right, hw), madd(top, p.right, -hw)]);
}

/** How deep a standing card reaches along `away` from its foot, and how high. */
export const standReach = (s: number, lean = LEAN): { readonly away: number; readonly up: number } => ({
  away: CARD.h * s * Math.sin(lean),
  up: CARD.h * s * Math.cos(lean),
});

/**
 * The first depth past `from` at which the surface shows above the top of a card of scale `s` standing at `foot`, as the
 * eye sees it (occlusion by depth from the eye, not laying order): a row behind starts there, or the card in front covers
 * its foot. `gapPx` of screen is kept between.
 */
export function clearBehind(proj: Projector, f: SurfaceFrame, foot: number, s: number, gapPx = 2, lean = LEAN): number {
  const p = standPose(f, 0, foot, lean), topY = proj.project(madd(p.foot, p.up, CARD.h * s)).y - gapPx;
  let lo = foot, hi = foot + f.d + 4;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (proj.project(onFrame(f, 0, m)).y > topY) lo = m;
    else hi = m;
  }
  return hi;
}
