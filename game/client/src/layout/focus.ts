// Where the table's focus layers put things (docs "layout"; intent.md "Focus"): a lean-in, which lifts one seat's page
// off the table and brings it over the middle, squared to me; and a sift, which fans a pile's cards out in front of the
// camera. Both are computed from the committed plan, so the scene draws them without a new plan; the stack as the focus
// is the plan's own `stackUp`. Pure.
import { CH, CW } from "./seat/geometry";
import { bounds, cardMiddle, commanderShape, plateShape, unitShape, zoneShape } from "./shape";
import type { At, Quad } from "./shape";
import type { Projector } from "./projector";
import type { Unit } from "./seat";
import type { TablePlan } from "./plan";
import type { Point, Rect, SeatId, V3, Viewport } from "./types";
import { designUnit } from "./types";

// ---- leaning in ------------------------------------------------------------------------------------------------------

/** How high a leaned-in page is held over the table: above everything standing on it, so it covers what lies under it. */
export const LEAN_LIFT = 3.2;
/** Where a leaned-in page may be, design units: under the top bar and its notes, inside the screen's gutters. */
const LEAN_BOX = { l: 20, r: 1160, t: 66, b: 690 } as const;
/** How far a page may grow or shrink to fit. */
const LEAN_SCALE = { lo: 0.75, hi: 2.6 } as const;
/** How much more its cards may grow where they stand, and the gap (design units) they keep from each other. */
const LEAN_GROW = 1.35;
const LEAN_GAP = 6;

/** A seat's page held up over the middle: every pose of that seat is carried (`carry`), and the page across may slide. */
export interface Lean {
  readonly seat: SeatId;
  /** The page's middle on the table, and its turn. */
  readonly from: V3;
  readonly yaw: number;
  /** Where that middle is held, and the scale everything on the page grows by. */
  readonly to: V3;
  readonly scale: number;
  /** The page across makes room for a side page by sliding, whole, toward the far side (world x), or null. */
  readonly slide: { readonly seat: SeatId; readonly dx: number } | null;
  /**
   * How much more its cards (not its plaque, commander or zone piles) grow where they stand, about their foot, once the
   * page is up: as far as the room between them allows, up to LEAN_GROW (h.js `lean`).
   */
  readonly grow: number;
}

/** A point of the leaning seat carried with its page: turned square to me, scaled about the page's middle, held up. */
export function carry(l: Lean, p: V3): V3 {
  const c = Math.cos(l.yaw), s = Math.sin(l.yaw), dx = p.x - l.from.x, dz = p.z - l.from.z;
  const u = (dx * c - dz * s) * l.scale, v = (dx * s + dz * c) * l.scale;
  return { x: l.to.x + u, y: l.to.y + p.y * l.scale, z: l.to.z + v };
}

/**
 * Where a lean-in draws a thing posed by the point `c` (scene describe `leaned`): `c` carried with the page, and the
 * thing about it scaled with the page but turned as it was (a card stays square to me; only the page itself turns).
 */
export function carriedAbout(l: Lean, c: V3): At {
  const to = carry(l, c);
  return (v) => ({ x: to.x + (v.x - c.x) * l.scale, y: to.y + (v.y - c.y) * l.scale, z: to.z + (v.z - c.z) * l.scale });
}

/** A leaning seat's unit as drawn, grown `g` where it stands (about its foot) first. */
export function leanedUnitAt(proj: Projector, l: Lean, u: Unit, g: number): At {
  const f = u.placement.pos, about = carriedAbout(l, cardMiddle(proj, { ...u.placement, scale: u.placement.scale * g }, u.tapped));
  return (v) => about({ x: f.x + (v.x - f.x) * g, y: f.y + (v.y - f.y) * g, z: f.z + (v.z - f.z) * g });
}

const seatsOf = (plan: TablePlan): SeatId[] => [...plan.seats.keys()];
/** A seat's place by its order in the plan (the perspective first, then clockwise), as the template's slots. */
const placeOf = (plan: TablePlan, seat: SeatId): "near" | "left" | "across" | "right" => {
  const i = seatsOf(plan).indexOf(seat), n = plan.seats.size;
  if (i <= 0) return "near";
  if (n === 4) return (["near", "left", "across", "right"] as const)[i]!;
  return i * 2 === n ? "across" : i * 2 < n ? "left" : "right";
};

/**
 * Leaning in on `seat` (old h.js `lean`): the camera never moves; the page comes off the table toward me, held over the
 * middle and squared to me, as large as fits between the top bar and the tops of my own creatures (so my creatures and
 * hand stay in view), as near its own seat as that allows. A side page keeps beside the page across, never over it: that
 * page slides toward the far side into the open table, whole and unscaled, and the leaned page may cover only its bare
 * vellum. Null for my own seat or one the plan does not have.
 */
export function leanOf(plan: TablePlan, seat: SeatId): Lean | null {
  const sp = plan.seats.get(seat), proj = plan.projector;
  if (!sp || placeOf(plan, seat) === "near") return null;
  const u = designUnit(plan.viewport), page = sp.fixtures.page;
  const from: V3 = { x: page.pos.x, y: 0, z: page.pos.z };
  const toU = (p: Point): Point => ({ x: p.x / u, y: p.y / u });
  const pageBox = (s: SeatId) => {
    const f = plan.seats.get(s)!.fixtures.page, c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const lu = a! * (f.w / 2), lv = b! * (f.d / 2);
      return toU(proj.project({ x: f.pos.x + lu * c + lv * sn, y: 0, z: f.pos.z - lu * sn + lv * c }));
    });
    return { l: Math.min(...pts.map((p) => p.x)), r: Math.max(...pts.map((p) => p.x)), t: Math.min(...pts.map((p) => p.y)), b: Math.max(...pts.map((p) => p.y)) };
  };
  const groups = (s: SeatId) => plan.hits.groups.filter((g) => g.seat === s);
  const me = seatsOf(plan)[0]!;
  // Its foot: above my page's far edge and my creatures' tops.
  let bot: number = Math.min(LEAN_BOX.b, pageBox(me).t - 10);
  for (const un of plan.seats.get(me)?.units ?? []) {
    if (un.role !== "creature") continue;
    const g = plan.hits.groups.find((x) => x.id === un.id);
    if (g) bot = Math.min(bot, bounds(g.quad).t / u - 10);
  }
  const cy = (LEAN_BOX.t + bot) / 2, home = proj.project(from).x / u;
  const side = placeOf(plan, seat) !== "across";
  let L: number = LEAN_BOX.l, R: number = LEAN_BOX.r, slide: Lean["slide"] = null;
  const across = seatsOf(plan).find((s) => placeOf(plan, s) === "across");
  if (side && across) {
    const right = page.pos.x > 0, far = seatsOf(plan).find((s) => s !== seat && s !== me && placeOf(plan, s) !== "across");
    const ab = pageBox(across), fb = far ? pageBox(far) : null;
    const room = fb ? Math.max(0, right ? ab.l - fb.r - 10 : fb.l - ab.r - 10) : 0, shift = right ? -room : room;
    const ap = plan.seats.get(across)!.fixtures.page.pos;
    const per = (proj.project({ x: ap.x + 1, y: 0, z: ap.z }).x - proj.project(ap).x) / u;
    if (room > 0) slide = { seat: across, dx: shift / per };
    const cards = groups(across).map((g) => bounds(g.quad));
    if (right) L = Math.max(ab.l + shift, ...cards.map((b) => b.r / u + shift)) + 8;
    else R = Math.min(ab.r + shift, ...cards.map((b) => b.l / u + shift)) - 8;
  } else if (side) {
    const m = (LEAN_BOX.l + LEAN_BOX.r) / 2;
    if (page.pos.x > 0) L = m + 10;
    else R = m - 10;
  }
  const corners = (to: V3, S: number): Point[] =>
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toU(proj.project({ x: to.x + (a! * page.w * S) / 2, y: LEAN_LIFT, z: to.z + (b! * page.d * S) / 2 })));
  // Centred in that box as it looks (its near edge looks larger than its far one), across from its own seat, shifted in
  // only as far as it must be to fit.
  const place = (S: number): { to: V3; fits: boolean } => {
    let to = proj.onTable(home * u, cy * u, LEAN_LIFT);
    for (let it = 0; it < 3; it++) {
      const q = corners(to, S), xs = q.map((p) => p.x), ys = q.map((p) => p.y);
      const off = cy - (Math.min(...ys) + Math.max(...ys)) / 2;
      const dx = Math.max(0, L - Math.min(...xs)) - Math.max(0, Math.max(...xs) - R);
      const at = toU(proj.project(to));
      to = proj.onTable((at.x + dx) * u, (at.y + off) * u, LEAN_LIFT);
    }
    const fits = corners(to, S).every((p) => p.x >= L - 1 && p.x <= R + 1 && p.y >= LEAN_BOX.t - 1 && p.y <= bot + 1);
    return { to, fits };
  };
  let lo: number = LEAN_SCALE.lo, hi: number = LEAN_SCALE.hi, best = place(lo);
  for (let it = 0; it < 14; it++) {
    const S = (lo + hi) / 2, p = place(S);
    if (p.fits) {
      lo = S;
      best = p;
    } else hi = S;
  }
  const held: Lean = { seat, from, yaw: page.yaw, to: { x: best.to.x, y: LEAN_LIFT, z: best.to.z }, scale: lo, slide, grow: 1 };
  // Its cards then grow where they stand, as far as the room between them allows, so leaning in brings them closer even
  // where the page itself can't grow: none moves, none comes nearer than LEAN_GAP to another or to the plaque and zones
  // (which keep their size), and none passes the page's far edge or the box (the page across, my row, the gutters).
  const top = corners(held.to, lo)[0]!.y;
  return { ...held, grow: leanGrow(plan, held, { l: L, r: R, t: Math.max(LEAN_BOX.t, top), b: bot }) };
}

interface Box {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}

/** How much a leaned page's cards may grow (h.js `lean`'s second step), searched between 1 and LEAN_GROW. */
function leanGrow(plan: TablePlan, l: Lean, room: Box): number {
  const sp = plan.seats.get(l.seat)!, proj = plan.projector, u = designUnit(plan.viewport);
  const box = (q: Quad): Box => {
    const b = bounds(q);
    return { l: b.l / u, r: b.r / u, t: b.t / u, b: b.b / u };
  };
  interface Item {
    readonly fixed: boolean;
    readonly at: (g: number) => Box;
    readonly now: Box;
  }
  const items: Item[] = [];
  for (const un of sp.units) {
    if (un.fighting) continue;
    const at = (g: number): Box => box(unitShape(proj, l.seat, un, false, leanedUnitAt(proj, l, un, g)).face);
    items.push({ fixed: false, at, now: at(1) });
  }
  const fixed = (q: Quad): void => {
    const b = box(q);
    items.push({ fixed: true, at: () => b, now: b });
  };
  // Each as the scene poses it (describe `leaned`): the plaque by its foot just off the page, a zone pile by its place,
  // the commander by its card's middle.
  const pl = sp.fixtures.plate.pos;
  fixed(plateShape(proj, l.seat, sp.fixtures.plate, carriedAbout(l, { x: pl.x, y: pl.y + 0.02, z: pl.z })).face);
  for (const z of sp.fixtures.zones) fixed(zoneShape(proj, l.seat, z.zone, z.placement, z.placement.posture === "flat", carriedAbout(l, z.placement.pos)).face);
  const cmd = sp.fixtures.commander;
  if (cmd) fixed(commanderShape(proj, l.seat, cmd, carriedAbout(l, cardMiddle(proj, cmd.placement, false))).face);
  const gap = (a: Box, b: Box): number => Math.max(b.l - a.r, a.l - b.r, b.t - a.b, a.t - b.b);
  // What is clear of each other now stays clear, by LEAN_GAP or by what it has now if that is less.
  const pairs: [Item, Item, number][] = [];
  items.forEach((a, i) =>
    items.slice(i + 1).forEach((b) => {
      const d = gap(a.now, b.now);
      if (d >= 0) pairs.push([a, b, Math.min(LEAN_GAP, d)]);
    }),
  );
  const inside = (x: Item, e: Box): boolean =>
    e.l >= Math.min(room.l, x.now.l) && e.r <= Math.max(room.r, x.now.r) && e.t >= Math.min(room.t, x.now.t) && e.b <= Math.max(room.b, x.now.b);
  const ok = (g: number): boolean => items.every((x) => x.fixed || inside(x, x.at(g))) && pairs.every(([a, b, m]) => gap(a.at(g), b.at(g)) >= m);
  let g0 = 1, g1 = LEAN_GROW;
  for (let it = 0; it < 10; it++) {
    const g = (g0 + g1) / 2;
    if (ok(g)) g0 = g;
    else g1 = g;
  }
  return g0;
}

// ---- sifting a pile --------------------------------------------------------------------------------------------------

/** A sifted card's place on screen: its upright rectangle (CSS px) and its turn (a tapped card is turned 15°). */
export interface SiftPlace {
  readonly rect: Rect;
  readonly turn: number;
}

/** How a sift lays its cards out (old h.js `sift`): rows by count, the share of the screen they may take, the gaps. */
const SIFT = { width: 0.86, height: 0.7, gapX: 0.08, gapY: 0.1, tappedTurn: Math.PI / 12, tappedSize: 0.86, drop: 0.04 } as const;
/** The largest a sifted card is, as a share of the screen's height: the old 1.25 world units at 6 from the camera. */
const SIFT_MAX = 0.3;
/**
 * The most cards a sift fans at once (three rows of nine, about 100 px wide at 1180×820): a bigger pile is sifted a page
 * at a time, so its cards still read rather than shrinking under the floor.
 */
export const SIFT_PAGE = 27;
/** How many pages a sift of `n` cards has (at least one). */
export const siftPages = (n: number): number => Math.max(1, Math.ceil(n / SIFT_PAGE));

/**
 * A page of a pile's cards (up to `SIFT_PAGE`) fanned out in front of the camera, in rows (one up to 6, two up to 14,
 * else three), as large as the screen allows up to a reading size, centred a little below the middle. A tapped card is turned 15° and a
 * little smaller, so it keeps its gap. The cards are in the order given.
 */
export function siftOf(viewport: Viewport, tapped: readonly boolean[]): SiftPlace[] {
  const n = tapped.length;
  if (!n) return [];
  const rows = n <= 6 ? 1 : n <= 14 ? 2 : 3, cols = Math.ceil(n / rows);
  const { w: W, h: H } = viewport;
  // A card's height on screen, px: as the old world scale (in card heights at the sift's depth).
  const h = Math.min(SIFT_MAX * H, (W * SIFT.width) / (cols * (CW + SIFT.gapX)), (H * SIFT.height) / (rows * (CH + SIFT.gapY)));
  const cx = W / 2, cy = H / 2 + H * SIFT.drop;
  return tapped.map((t, i) => {
    const r = Math.floor(i / cols), k = i % cols, inRow = Math.min(cols, n - r * cols);
    const x = cx + (k - (inRow - 1) / 2) * (CW + SIFT.gapX) * h, y = cy - ((rows - 1) / 2 - r) * (CH + SIFT.gapY) * h;
    const s = t ? SIFT.tappedSize : 1, hw = (CW * h * s) / 2, hh = (CH * h * s) / 2;
    return { rect: { left: x - hw, top: y - hh, right: x + hw, bottom: y + hh }, turn: t ? -SIFT.tappedTurn : 0 };
  });
}

/** A sift card's quad on screen (foot-left, foot-right, top-right, top-left), turned as it lies. */
export function siftQuad(p: SiftPlace): Quad {
  const r = p.rect, cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2, hw = (r.right - r.left) / 2, hh = (r.bottom - r.top) / 2;
  const c = Math.cos(p.turn), s = Math.sin(p.turn);
  // Screen y runs down; a turn is clockwise as the player sees it for a negative angle (the old quaternion about z): the
  // card's right edge goes down.
  const pt = (a: number, b: number): Point => ({ x: cx + a * c - b * s, y: cy - (a * s + b * c) });
  return [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)];
}
