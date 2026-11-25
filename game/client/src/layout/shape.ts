import type { Projector } from "./projector";
import type { Placement, Posture, SeatPlan, Unit } from "./seat";
import type { CardId, Point, Rect, V3, Viewport } from "./types";
import { designUnit } from "./types";
import { FLOOR, TAP_PX } from "./board";
import { CH, CW, PILE_LEAN, TAP_LEAN } from "./seat/geometry";
import { hasSquare } from "./arrange/audit";

/** Audit with the cell grid alone (tests show the geometric first pass changes no verdict). */
export const GRID_ONLY = { on: false };

// Where things are on screen at rest: each card face as a quad, with its name strip (top sixth) and foot (bottom sixth),
// from the same posture rules the scene poses pieces with, and the audit of the hard limits over those quads: the
// composed table (every seat, cards acting included, and the stack), in the order the scene draws it.

export type Quad = readonly [Point, Point, Point, Point];

export type ItemKind = "unit" | "plate" | "zone" | "stack";

export interface Shape {
  /** The group a tap on it reaches: a unit's id, "plate:<seat>", "command:<seat>", "zone:<zone>:<seat>", "stack:<key>". */
  readonly group: string;
  readonly kind: ItemKind;
  readonly seat: string | null;
  readonly face: Quad;
  readonly name: Quad;
  readonly foot: Quad;
  /**
   * Draw order: larger is on top. Plates draw over everything (no depth test); the rest by depth from the camera, as
   * the depth buffer decides: a table z, as `depthOrder` gives it.
   */
  readonly order: number;
  /** The floor its face width must meet, in design px. */
  readonly floor: number;
  /** Face width on screen across its middle, px, upright. */
  readonly width: number;
  readonly members: readonly CardId[];
  /** What a tap reaches when it is not the face: the arrangement engine's place for the unit (its slot). */
  readonly hit?: Quad;
}

/** What a tap reaches on an item: its place where it has one, else its face. */
export const hitQuad = (s: Shape): Quad => s.hit ?? s.face;

const TILT = { prop: 0.85, lean: 0.4, flat: 0 } as const;

/** Plates draw last and without a depth test: over everything. */
const PLATE_ORDER = 1e6;

/**
 * Draw order of what stands at `p`, as a table z: the z of the point on the table as deep from the camera as `p`. A card
 * standing square to the camera is equally deep all over, so its foot's z is its order; one raised (the stack) is nearer.
 */
export function depthOrder(proj: Projector, p: V3): number {
  return p.z + p.y * Math.tan(proj.pitch);
}

interface Frame {
  /** The card's foot (lower middle) in the world. */
  readonly base: V3;
  /** The direction its face runs up, a unit vector. */
  readonly up: V3;
}

const frameOf = (proj: Projector, pos: V3, posture: Posture, tapped: boolean, own?: Placement["frame"]): Frame => {
  if (own) return { base: pos, up: own.up };
  if (posture === "stand") {
    const th = proj.pitch + (tapped ? TAP_LEAN : 0);
    return { base: { x: pos.x, y: pos.y + 0.02, z: pos.z }, up: { x: 0, y: Math.cos(th), z: -Math.sin(th) } };
  }
  const el = Math.atan2(proj.eye.y - pos.y, Math.max(1, proj.eye.z - pos.z));
  const delta = (Math.PI / 2 - el) * TILT[posture];
  return { base: pos, up: { x: 0, y: Math.sin(delta), z: -Math.cos(delta) } };
};

/** Where a point of the table is drawn: itself at rest; a lean-in carries its seat's (layout focus.ts). */
export type At = (v: V3) => V3;
const AT_REST: At = (v) => v;

/** A card's middle at rest (the point the scene poses it by, `unitPose`): where a lean-in carries it from. */
export function cardMiddle(proj: Projector, p: Placement, tapped: boolean): V3 {
  const fr = frameOf(proj, p.pos, p.posture, tapped, p.frame), h = (CH / 2) * p.scale;
  return { x: fr.base.x + fr.up.x * h, y: fr.base.y + fr.up.y * h, z: fr.base.z + fr.up.z * h };
}

// A card of scale s on `frame`, its middle half a card up. Tapped it lies turned: its top points right.
function cardQuads(proj: Projector, fr: Frame, s: number, tapped: boolean, w = CW, h = CH, at: At = AT_REST): { face: Quad; name: Quad; foot: Quad; width: number } {
  const c = { x: fr.base.x + fr.up.x * (h / 2) * s, y: fr.base.y + fr.up.y * (h / 2) * s, z: fr.base.z + fr.up.z * (h / 2) * s };
  const hx = ((tapped ? h : w) / 2) * s, hu = ((tapped ? w : h) / 2) * s;
  // a window of the card's own frame: its up-axis fraction t0..t1 (0 foot, 1 top)
  const win = (t0: number, t1: number): Quad => {
    const lo = (t0 * 2 - 1), hi = (t1 * 2 - 1);
    const pts = tapped
      ? [[lo * hx, -hu], [hi * hx, -hu], [hi * hx, hu], [lo * hx, hu]]
      : [[-hx, lo * hu], [hx, lo * hu], [hx, hi * hu], [-hx, hi * hu]];
    return pts.map(([a, b]) => proj.project(at({ x: c.x + a! + fr.up.x * b!, y: c.y + fr.up.y * b!, z: c.z + fr.up.z * b! }))) as unknown as Quad;
  };
  // Width on screen across the middle of the card, upright: the old floor's measure.
  const mid = { x: fr.base.x, y: fr.base.y + fr.up.y * (h / 2) * s, z: fr.base.z + fr.up.z * (h / 2) * s };
  const a = proj.project({ ...mid, x: mid.x - (w / 2) * s }), b = proj.project({ ...mid, x: mid.x + (w / 2) * s });
  return { face: win(0, 1), name: win(5 / 6, 1), foot: win(0, 1 / 6), width: Math.abs(b.x - a.x) };
}

export function unitShape(proj: Projector, seat: string, u: Unit, mine: boolean, at: At = AT_REST): Shape {
  const p: Placement = u.placement;
  const own = p.frame;
  const q = own ? ownQuads(proj, p, own, u.turn ?? (u.tapped ? 1 : 0), at) : cardQuads(proj, frameOf(proj, p.pos, p.posture, u.tapped), p.scale, u.tapped, CW, CH, at);
  const creature = u.role === "creature";
  return {
    group: u.id,
    kind: "unit",
    seat,
    ...q,
    order: p.pos.z,
    // (An arranged creature lying in a pile meets the any-card floor: only a standing one is a creature on show.)
    floor: creature && (!own || p.posture === "stand") ? (mine ? FLOOR.mine : FLOOR.theirs) : FLOOR.any,
    members: u.members,
    // at rest, a tap reaches its place; carried in a lean-in or fighting in the row, its face
    ...(u.hit && at === AT_REST && !u.fighting ? { hit: u.hit } : {}),
  };
}

/**
 * A card on its own axes (the arrangement engine's), turned `turn` quarter turns clockwise in its own plane about its
 * middle (a tapped card: 1 a quarter turn, 1/6 a notch). Its width is measured unturned, as a floor is.
 */
function ownQuads(proj: Projector, p: Placement, own: NonNullable<Placement["frame"]>, turn: number, at: At): { face: Quad; name: Quad; foot: Quad; width: number } {
  const s = p.scale, th = (turn * Math.PI) / 2, c = Math.cos(th), sn = Math.sin(th);
  const m = (a: V3, b: V3, k: number): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
  const mid = m(p.pos, own.up, (CH / 2) * s);
  const up = m({ x: own.up.x * c, y: own.up.y * c, z: own.up.z * c }, own.right, sn);
  const right = m({ x: own.right.x * c, y: own.right.y * c, z: own.right.z * c }, own.up, -sn);
  const pt = (a: number, b: number): Point => proj.project(at(m(m(mid, right, a * s), up, b * s)));
  const win = (t0: number, t1: number): Quad => [pt(-CW / 2, (t0 - 0.5) * CH), pt(CW / 2, (t0 - 0.5) * CH), pt(CW / 2, (t1 - 0.5) * CH), pt(-CW / 2, (t1 - 0.5) * CH)];
  const a = proj.project(m(mid, own.right, (-CW / 2) * s)), b = proj.project(m(mid, own.right, (CW / 2) * s));
  return { face: win(0, 1), name: win(5 / 6, 1), foot: win(0, 1 / 6), width: Math.hypot(b.x - a.x, b.y - a.y) };
}

/** The plaque stands leaning back by the camera's pitch, 3.2 wide and 0.82 tall at scale 1. */
export function plateShape(proj: Projector, seat: string, p: Placement, at: At = AT_REST): Shape {
  const th = proj.pitch, up = { x: 0, y: Math.cos(th), z: -Math.sin(th) }, s = p.scale;
  const pt = (sx: number, t: number): Point => proj.project(at({ x: p.pos.x + sx * 1.6 * s, y: p.pos.y + up.y * t * 0.82 * s, z: p.pos.z + up.z * t * 0.82 * s }));
  const quad = (t0: number, t1: number): Quad => [pt(-1, t0), pt(1, t0), pt(1, t1), pt(-1, t1)];
  return { group: `plate:${seat}`, kind: "plate", seat, face: quad(0, 1), name: quad(5 / 6, 1), foot: quad(0, 1 / 6), order: PLATE_ORDER, floor: 0, width: 0, members: [] };
}

/** The commander beside the plaque: a card standing square to me, its group "command:<seat>". */
export function commanderShape(proj: Projector, seat: string, c: NonNullable<SeatPlan["fixtures"]["commander"]>, at: At = AT_REST): Shape {
  const q = cardQuads(proj, frameOf(proj, c.placement.pos, "stand", false), c.placement.scale, false, CW, CH, at);
  return { group: `command:${seat}`, kind: "unit", seat, ...q, order: c.placement.pos.z, floor: FLOOR.any, members: [c.card] };
}

/** A zone pile: a card lying on a box, propped from its near edge for opponents (PILE_LEAN). */
export function zoneShape(proj: Projector, seat: string, zone: string, p: Placement, mine: boolean, at: At = AT_REST): Shape {
  const alpha = mine ? 0 : PILE_LEAN;
  const base = { x: p.pos.x, y: p.pos.y, z: p.pos.z + (CH / 2) * p.scale };
  const q = cardQuads(proj, { base, up: { x: 0, y: Math.sin(alpha), z: -Math.cos(alpha) } }, p.scale, false, CW, CH, at);
  return { group: `zone:${zone}:${seat}`, kind: "zone", seat, ...q, order: p.pos.z, floor: FLOOR.any, members: [] };
}

/** A stack card at rest, square to the camera: its face on screen (foot-left, foot-right, top-right, top-left). */
export function stackShape(group: string, face: Quad, order: number, members: readonly CardId[]): Shape {
  const strip = (v0: number, v1: number): Quad => [lerpQuad(face, 0, v0), lerpQuad(face, 1, v0), lerpQuad(face, 1, v1), lerpQuad(face, 0, v1)];
  const width = Math.hypot(face[1].x - face[0].x, face[1].y - face[0].y);
  return { group, kind: "stack", seat: null, face, name: strip(5 / 6, 1), foot: strip(0, 1 / 6), order, floor: FLOOR.any, width, members };
}

export function seatShapes(proj: Projector, plan: SeatPlan, mine: boolean): Shape[] {
  return [
    ...plan.units.map((u) => unitShape(proj, plan.seat, u, mine)),
    ...plan.fixtures.zones.map((z) => zoneShape(proj, plan.seat, z.zone, z.placement, mine)),
    plateShape(proj, plan.seat, plan.fixtures.plate),
    ...(plan.fixtures.commander ? [commanderShape(proj, plan.seat, plan.fixtures.commander)] : []),
  ];
}

// ---- geometry of quads ----------------------------------------------------------------------------------------------

export function inQuad(q: Quad, x: number, y: number): boolean {
  let pos = false, neg = false;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!, b = q[(i + 1) % 4]!;
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c > 0) pos = true;
    else if (c < 0) neg = true;
    if (pos && neg) return false;
  }
  return true;
}

export const bounds = (q: Quad): { l: number; r: number; t: number; b: number } => ({
  l: Math.min(...q.map((p) => p.x)),
  r: Math.max(...q.map((p) => p.x)),
  t: Math.min(...q.map((p) => p.y)),
  b: Math.max(...q.map((p) => p.y)),
});

const lerpQuad = (q: Quad, u: number, v: number): Point => {
  // bilinear over (foot-left, foot-right, top-right, top-left)
  const a = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u };
  const b = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
  return { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v };
};

// ---- the audit ------------------------------------------------------------------------------------------------------

/**
 * off-screen: a stack card at rest not wholly in the safe area; no-room: a stack card the open middle had no room for,
 * lying under the last that fitted. Layout leaves either out of the hit groups (a sheet offers it). focus-covers: the
 * stack as the focus found no place at its floor clear of what it aims at and of the chrome.
 */
export type Rule = "floor" | "tap-patch" | "covers-name" | "covers-foot" | "covers-face" | "off-screen" | "no-room" | "focus-covers";

export interface Violation {
  readonly rule: Rule;
  readonly group: string;
  readonly seat: string | null;
  readonly measured: number;
  readonly limit: number;
}

/** Nothing covers more than this share of a name strip or foot, or of a face (intent.md "Hard limits"). */
export const COVER = { strip: 0.2, face: 1 / 3 } as const;
const CELL = 4;

/** The top item at each screen point: later in draw order wins. */
export function topAt(shapes: readonly Shape[], x: number, y: number, ignore?: string): Shape | null {
  let best: Shape | null = null;
  for (const s of shapes) if ((!best || s.order >= best.order) && s.group !== ignore && inQuad(s.face, x, y)) best = s;
  return best;
}

/** Where a tap can land: inside the safe area, and not on chrome that is up (the hand, the prompt). */
export interface TapArea {
  readonly safe: Rect;
  readonly chrome: readonly Rect[];
}

export interface AuditOptions {
  /** Audit only these (the rest still cover what they draw over). */
  readonly only?: (s: Shape) => boolean;
  /** Where taps land; the whole viewport if absent. */
  readonly area?: TapArea;
}

/**
 * The hard limits over everything drawn, in draw order: a card acting stands where it is drawn (a fighter in the combat
 * row, combat.ts), and the stack is one more thing on the table, nearer the camera than the pages.
 */
export function audit(shapes: readonly Shape[], vp: Viewport, opts: AuditOptions = {}): Violation[] {
  const { only } = opts, area: TapArea = opts.area ?? { safe: { left: 0, top: 0, right: vp.w, bottom: vp.h }, chrome: [] };
  const out: Violation[] = [], u = designUnit(vp), tap = TAP_PX;
  const sorted = shapes.slice().sort((a, b) => b.order - a.order); // top first
  const box = new Map(shapes.map((s) => [s, bounds(s.face)]));
  for (const s of shapes) {
    if (only && !only(s)) continue;
    // floors: card face width on screen at 1180x820, scaled by the design unit
    if (s.floor > 0 && s.width / u < s.floor - 1e-6) out.push({ rule: "floor", group: s.group, seat: s.seat, measured: s.width / u, limit: s.floor });
    const bb = box.get(s)!;
    const near = sorted.filter((o) => o !== s && o.group !== s.group && o.order >= s.order && overlaps(box.get(o)!, bb));
    // what covers it: items on top of it (the same pile never covers itself)
    const covered = (q: Quad, n: number, m: number): number => {
      let hit = 0, all = 0;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < m; j++) {
          const p = lerpQuad(q, (i + 0.5) / n, (j + 0.5) / m);
          all++;
          if (near.some((o) => inQuad(o.face, p.x, p.y))) hit++;
        }
      return hit / all;
    };
    if (s.kind !== "plate") {
      const nm = covered(s.name, 7, 2), ft = covered(s.foot, 7, 2), fc = covered(s.face, 7, 7);
      if (nm > COVER.strip) out.push({ rule: "covers-name", group: s.group, seat: s.seat, measured: nm, limit: COVER.strip });
      if (ft > COVER.strip) out.push({ rule: "covers-foot", group: s.group, seat: s.seat, measured: ft, limit: COVER.strip });
      if (fc > COVER.face) out.push({ rule: "covers-face", group: s.group, seat: s.seat, measured: fc, limit: COVER.face });
    }
    // tappable: a window of tap x tap px that the hit test gives to this group
    // (A plaque is not a card or a pile: intent.md's patch rule is for those. It still draws over what it stands on.)
    // A whole square found geometrically is a patch the cell grid would find too, so the grid runs only to measure a
    // failure (the verdicts are the grid's; arrange/audit.ts `hasSquare`).
    // (On its place where it has one: what hit testing gives it, less what is on top there.)
    const region = hitQuad(s), rb = s.hit ? bounds(region) : bb;
    const atop = s.hit ? sorted.filter((o) => o !== s && o.group !== s.group && o.order >= s.order && overlaps(bounds(hitQuad(o)), rb)) : near;
    const best =
      s.kind === "plate" || (!GRID_ONLY.on && hasSquare(region, rb, atop.map(hitQuad), area.chrome, area.safe, tap)) ? tap : tapPatch({ ...s, face: region }, atop.map((o) => ({ ...o, face: hitQuad(o) })), area, tap);
    if (best < tap - 1e-6) out.push({ rule: "tap-patch", group: s.group, seat: s.seat, measured: best, limit: tap });
  }
  return out;
}

const overlaps = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }): boolean => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/**
 * The side of the largest square (px) wholly inside the item's face, inside the safe area, off the chrome and not under
 * anything on top, on a 4 px grid.
 */
function tapPatch(s: Shape, over: readonly Shape[], area: TapArea, want: number): number {
  const bb = bounds(s.face), sa = area.safe;
  const chrome = area.chrome.filter((c) => c.left < bb.r && c.right > bb.l && c.top < bb.b && c.bottom > bb.t);
  const l = Math.max(Math.ceil(sa.left / CELL), Math.floor(bb.l / CELL)), r = Math.min(Math.floor(sa.right / CELL), Math.ceil(bb.r / CELL));
  const t = Math.max(Math.ceil(sa.top / CELL), Math.floor(bb.t / CELL)), b = Math.min(Math.floor(sa.bottom / CELL), Math.ceil(bb.b / CELL));
  const w = r - l, h = b - t;
  if (w <= 0 || h <= 0) return 0;
  // prefix sums of "this item owns the cell"
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = (l + i + 0.5) * CELL, y = (t + j + 0.5) * CELL;
      const own = inQuad(s.face, x, y) && !chrome.some((c) => x >= c.left && x < c.right && y >= c.top && y < c.bottom) && !over.some((o) => inQuad(o.face, x, y)) ? 1 : 0;
      sum[(j + 1) * (w + 1) + i + 1] = own + sum[j * (w + 1) + i + 1]! + sum[(j + 1) * (w + 1) + i]! - sum[j * (w + 1) + i]!;
    }
  const full = (n: number, i: number, j: number): boolean =>
    sum[(j + n) * (w + 1) + i + n]! - sum[j * (w + 1) + i + n]! - sum[(j + n) * (w + 1) + i]! + sum[j * (w + 1) + i]! === n * n;
  // the largest n such that some n x n window is owned (binary search is valid: owned squares nest)
  let lo = 0, hi = Math.min(w, h);
  while (lo < hi) {
    const n = Math.ceil((lo + hi) / 2);
    let ok = false;
    for (let j = 0; j + n <= h && !ok; j++) for (let i = 0; i + n <= w && !ok; i++) ok = full(n, i, j);
    if (ok) lo = n;
    else hi = n - 1;
  }
  // (cells are CELL px; a patch is "want" px if it holds ceil(want/CELL) cells either way)
  return lo >= Math.ceil(want / CELL) ? Math.max(want, lo * CELL) : lo * CELL;
}
