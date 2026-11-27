// Poses from layout's placements: where a piece's middle is and how it is turned, by the same posture rules layout
// measures its quads with (layout/shape.ts `frameOf`), so what the scene draws at rest is what hit testing reaches.
// Ported from old h.js `layout` (standees lean back by the camera's pitch, a tapped one further; flat cards are propped
// up a little), `zoneLean` (a pile propped from its near edge), `buildStack` (cards facing the camera) and `restOf`/
// `onPile` (where a card lands on a pile). Pure.
import { STACK_POSE, STAND_OFF, TILT } from "../../layout";
import type { Placement, Point, Posture, Projector, Quad, Rect, V3 } from "../../layout";
import { CH, CW, PILE_LEAN, TAP_LEAN, TH } from "../../layout/geometry";
import type { ScreenPose } from "../../play";
import { materials } from "../../theme";
import { PATH, add, scaled, v3 } from "./motion";
import type { Pose } from "./types";

// Layout's posture rules (layout/shape.ts `TILT`, `STAND_OFF`), shared so what is drawn is what a tap reaches.
const { slab } = materials;
/** A stack card's foot stands at least this far over the table. */
const STACK_CLEAR = 0.02;
/**
 * The page lies just over the table (`PAGE_Y`, its ink a hair over it) and what lies on it rests on its top (`PAGE_TOP`):
 * a lying card's back on the page, its face a card's thickness over it.
 */
export const PAGE_Y = 0.0004;
export const PAGE_TOP = 0.0009;
/** A zone pile's block under its top card: its height by its count (a library of 67 the tallest thing on its leaf). */
export const pileHeight = (n: number): number => Math.min(slab.zoneCap, Math.max(0, n - 1) * slab.zoneStep);

/** The pose of a card standing in `posture` with its foot at `pos`: its middle half a card up its face. */
export function unitPose(proj: Projector, p: Placement, tapped: boolean): Pose {
  const s = p.scale;
  if (p.frame) {
    // Its own axes (the arrangement engine's), untapped: Ry·Rx carries the card's right to `right` and up to `up` (the
    // renderer turns a tapped one in its own plane).
    const { right, up } = p.frame;
    const ry = Math.atan2(-right.z, right.x), rx = Math.atan2(up.x * Math.sin(ry) + up.z * Math.cos(ry), up.y);
    const mid = add(p.pos, scaled(up, 0.5 * s));
    if (p.posture === "stand") return { pos: mid, rx, ry, s };
    // Lying, it rests on the page as any flat card does: its stock on the page's top. The engine's layer height is its
    // top card's in the block, and the view lifts what it draws onto the block itself.
    return { pos: v3(mid.x, PAGE_TOP + 0.5 * TH * s, mid.z), rx, ry, s };
  }
  if (p.posture === "stand") {
    // It stands from the vellum: leaning back, the stock behind its face is lowest, and that corner rests on the page.
    const th = proj.pitch + (tapped ? TAP_LEAN : 0);
    const up = v3(0, Math.cos(th), -Math.sin(th));
    return { pos: add(v3(p.pos.x, p.pos.y + STAND_OFF, p.pos.z), scaled(up, 0.5 * s)), rx: -th, ry: 0, s };
  }
  const el = Math.atan2(proj.eye.y - p.pos.y, Math.max(1, proj.eye.z - p.pos.z));
  const delta = (Math.PI / 2 - el) * TILT[p.posture as Exclude<Posture, "stand">];
  const up = v3(0, Math.sin(delta), -Math.cos(delta));
  // (It rests on the page: its middle half its thickness over the page's top, a hair over where layout measured its face.)
  return { pos: add(add(p.pos, v3(0, PAGE_TOP + 0.5 * TH * s, 0)), scaled(up, 0.5 * s)), rx: delta - Math.PI / 2, ry: 0, s };
}

/** A zone pile: the box sits at its placement; the view props an opponent's up from its near edge. */
export function zonePose(p: Placement): Pose {
  return { pos: v3(p.pos.x, p.pos.y + PAGE_TOP, p.pos.z), rx: 0, ry: 0, s: p.scale };
}

/** Where a card lands on a pile of `n` cards (h.js `onPile`): on top, at the pile's size, propped as the pile is. */
export function onPile(pile: Pose, n: number, mine: boolean): Pose {
  const lean = mine ? 0 : PILE_LEAN,
    s = pile.s;
  const h = s * (pileHeight(n + 1) + slab.depth),
    half = (s * CH) / 2,
    c = Math.cos(lean),
    sn = Math.sin(lean);
  return { pos: add(pile.pos, v3(0, h * c + half * sn, half * (1 - c) + h * sn)), rx: -Math.PI / 2 + lean, ry: 0, s };
}

/** The plaque stands at its placement, a little off the page; the view leans it back by the camera's pitch. */
export function platePose(p: Placement): Pose {
  return { pos: v3(p.pos.x, p.pos.y + 0.02, p.pos.z), rx: 0, ry: 0, s: p.scale };
}

/** A page lies on the table, turned by its yaw. */
export function pagePose(page: { readonly pos: V3; readonly yaw: number }): Pose {
  return { pos: v3(page.pos.x, PAGE_Y, page.pos.z), rx: 0, ry: page.yaw, s: 1 };
}

/** Square to the camera: its right and up are the camera's (the camera never yaws, so only its pitch turns the card). */
export function square(proj: Projector): { rx: number; ry: number } {
  return { rx: Math.atan2(proj.up.z, proj.up.y), ry: 0 };
}

/** How tall a card one unit high at `pos` is on screen, px (facing the camera). */
function pxPerUnit(proj: Projector, pos: V3): number {
  const a = proj.project(add(pos, scaled(proj.up, 0.5))),
    b = proj.project(add(pos, scaled(proj.up, -0.5)));
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}

const centre = (q: Quad): Point => ({
  x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
  y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
});

/**
 * A stack card's pose from layout's quad. The stack's cards stand square to the camera (layout lays them on the camera's
 * right and up), so on screen each is an exact rectangle and any depth along its ray with the matching scale draws the
 * same pixels: the top one stands at layout's stack height (`STACK_POSE`), each under it a step lower and so further
 * back. A deep stack's lower cards would stand through the table: each then stands just high enough for its foot to
 * clear it, plus a margin that shrinks with depth, so a card under another is still further back. `up`: the stack as the
 * table's focus (layout's `stackUp` quads), standing higher. (Layout orders the
 * stack's depth by the plain steps; past the clearance, the two can disagree on a deep stack.)
 */
export function stackPose(proj: Projector, q: Quad, index: number, up = false): Pose {
  const c = centre(q);
  const h = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
  const at = (y: number): Pose => {
    const pos = proj.onTable(c.x, c.y, y);
    return { pos, ...square(proj), s: h / (CH * pxPerUnit(proj, pos)) };
  };
  // Higher along its ray is nearer the camera, so smaller: its foot rises with its height.
  const foot = (p: Pose): number => p.pos.y - proj.up.y * 0.5 * CH * p.s;
  // It stands at max(its step, the lowest height that clears + margin): both fall with depth, so each card under
  // another (the same quad, when it spills) stands strictly lower.
  // (As the table's focus it stands higher, over everything on the table: the same pixels, nearer the camera.)
  const margin = STACK_POSE.step / (2 + index);
  const y = (up ? STACK_POSE.up : STACK_POSE.raise) - STACK_POSE.step * index;
  if (foot(at(y - margin)) >= STACK_CLEAR) return at(y);
  let lo = y - margin,
    hi = Math.max(STACK_POSE.raise, lo);
  for (let k = 0; k < 40 && foot(at(hi)) < STACK_CLEAR; k++) hi *= 2;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (foot(at(mid)) >= STACK_CLEAR) hi = mid;
    else lo = mid;
  }
  return at(hi + margin);
}

/** A pose from a rectangle on screen (a hand card, a carried moment) at `height` over the table, facing the camera. */
export function screenPose(proj: Projector, sp: ScreenPose, height: number): Pose {
  const r = sp.rect,
    x = (r.left + r.right) / 2,
    y = (r.top + r.bottom) / 2;
  const pos = proj.onTable(x, y, height);
  const h = Math.max(1, r.bottom - r.top);
  return { pos, ...square(proj), s: h / (CH * pxPerUnit(proj, pos)) };
}

/** My hand on the table: its rectangle's middle, at the hand's height, half size (h.js `restOf` for the hand). */
export function handPose(proj: Projector, hand: Rect | null): Pose {
  const pos = hand ? proj.onTable((hand.left + hand.right) / 2, (hand.top + hand.bottom) / 2, PATH.handHeight) : v3(0, PATH.handHeight, 9);
  return { pos, ...square(proj), s: PATH.handSize };
}

/** Just above a plate (h.js `plateAt`), at the size a card leaves or reaches it. */
export function atPlate(plate: Pose, s: number): Pose {
  return { pos: add(plate.pos, v3(0, PATH.plateUp, 0)), rx: -Math.PI / 2, ry: 0, s };
}

/** A sifted card's turn as drawn: a tapped one turned 15° clockwise, as far as it has risen (its alpha). */
export const siftRoll = (tapped: boolean, alpha: number): number => (tapped ? -(Math.PI / 12) * Math.min(1, alpha) : 0);

/** The four corners of a card at `pose` on screen (foot-left, foot-right, top-right, top-left), for tests and reports. */
export function poseQuad(proj: Projector, pose: Pose, roll = 0): Quad {
  const cy = Math.cos(pose.ry),
    sy = Math.sin(pose.ry),
    cx = Math.cos(pose.rx),
    sx = Math.sin(pose.rx);
  // R = Ry * Rx: the card's right and up axes in the world.
  const r0 = v3(cy, 0, -sy);
  const u0 = v3(sy * sx, cx, cy * sx);
  // Turned in its own plane by `roll` (a sifted tapped card's body.rotation.z: negative is clockwise as I see it).
  const cr = Math.cos(roll),
    sr = Math.sin(roll);
  const right = add(scaled(r0, cr), scaled(u0, sr));
  const up = add(scaled(r0, -sr), scaled(u0, cr));
  const pt = (a: number, b: number): Point =>
    proj.project(add(pose.pos, add(scaled(right, a * pose.s), scaled(up, b * pose.s))));
  return [pt(-CW / 2, -CH / 2), pt(CW / 2, -CH / 2), pt(CW / 2, CH / 2), pt(-CW / 2, CH / 2)];
}

/** A screen pose for a quad: its bounds, upright. */
export function quadScreenPose(q: Quad): ScreenPose {
  const xs = q.map((p) => p.x),
    ys = q.map((p) => p.y);
  return { rect: { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }, rotation: 0, scale: 1 };
}
