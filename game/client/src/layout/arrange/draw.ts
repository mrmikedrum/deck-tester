// Drawing a placed unit (§1.3): every card's face frame, the count marker, and its pick target. The scene poses cards
// from `CardPlace`; nothing here knows how a card is painted.
import type { Projector } from "../projector";
import type { Quad } from "../shape";
import type { CardId, V3 } from "../types";
import type { CardPlace, Container, SurfaceFrame, UnitKind } from "./contract";
import { CARD, LEAN, NOTCH, cardPlace, liePose, onFrame, standPose, surfaceQuad } from "./frame";
import type { Pose } from "./frame";
import type { RowGeo } from "./rows";
import { SLOT } from "./scale";

/** A fan: each card under the top turned this much more, about the top's foot-left corner. */
export const FAN_TURN = (2 * Math.PI) / 180;

export interface Drawn {
  readonly cards: CardPlace[];
  /** The top face as drawn (null for a summary). */
  /** `upright`: the same card at the same place unturned, which a floor measures (a turned card is no smaller). */
  readonly face: { readonly card: CardId; readonly quad: Quad; readonly pose: Pose; readonly upright: Pose; readonly standing: boolean } | null;
  readonly marker: { readonly count: number; readonly at: V3; readonly room: Quad } | null;
  readonly region: Quad;
  /** The eye's distance to the slot's foot: paint order, far first. */
  readonly depth: number;
}

export interface DrawSpec {
  readonly kind: UnitKind;
  /** Top first. */
  readonly members: readonly CardId[];
  readonly dressing: readonly CardId[];
  readonly tapped: (id: CardId) => boolean;
  /** Whether the unit stands (its group is presented and untapped). */
  readonly stands: boolean;
  /** How many fan members show their edges (the top included). */
  readonly show: number;
  /** The slot: its centre across, its width (world units). */
  readonly u: number;
  readonly w: number;
}

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const madd = (a: V3, b: V3, k: number): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });

/** The (u, v) of a world point on the frame. */
const uvOf = (f: SurfaceFrame, p: V3): { u: number; v: number } => ({ u: dot(sub(p, f.anchor), f.across), v: dot(sub(p, f.anchor), f.away) });

/**
 * The slot's reserved envelope on screen (§1.6: a card's place is its target): the box of the slot (its width, from the
 * feet to the far edge of what lies in it, up to a block's height) and, where a card may stand, the standing card's
 * top, as one quad: the feet, the higher of the two tops, its sides widened to hold every corner.
 */
export function regionOf(proj: Projector, f: SurfaceFrame, lo: number, hi: number, v: number, lieDepth: number, s: number, standing: boolean, height = 0): Quad {
  const P = (u: number, vv: number, h: number) => proj.project(onFrame(f, u, vv, h));
  const pts = [P(lo, v, 0), P(hi, v, 0), P(lo, v, height), P(hi, v, height), P(lo, v + lieDepth, 0), P(hi, v + lieDepth, 0), P(lo, v + lieDepth, height), P(hi, v + lieDepth, height)];
  let tl = P(lo, v + lieDepth, height), tr = P(hi, v + lieDepth, height);
  if (standing) {
    const p = standPose(f, (lo + hi) / 2, v, LEAN), top = madd(p.foot, p.up, CARD.h * s), hw = (hi - lo) / 2;
    const sl = proj.project(madd(top, f.across, -hw)), sr = proj.project(madd(top, f.across, hw));
    pts.push(sl, sr);
    if ((sl.y + sr.y) / 2 < (tl.y + tr.y) / 2) [tl, tr] = [sl, sr];
  }
  let bl = P(lo, v, 0), br = P(hi, v, 0);
  // Widen each side to hold every corner (perspective spreads a raised corner past the feet's line).
  const sideX = (a: { x: number; y: number }, b: { x: number; y: number }, y: number) => (b.y === a.y ? a.x : a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y));
  const left = Math.max(0, ...pts.map((q) => sideX(bl, tl, q.y) - q.x)), right = Math.max(0, ...pts.map((q) => q.x - sideX(br, tr, q.y)));
  const top = Math.min(0, ...pts.map((q) => q.y - Math.min(tl.y, tr.y))), bottom = Math.max(0, ...pts.map((q) => q.y - Math.max(bl.y, br.y)));
  bl = { x: bl.x - left - 0.5, y: bl.y + bottom + 0.5 };
  br = { x: br.x + right + 0.5, y: br.y + bottom + 0.5 };
  tl = { x: tl.x - left - 0.5, y: tl.y + top - 0.5 };
  tr = { x: tr.x + right + 0.5, y: tr.y + top - 0.5 };
  return [bl, br, tr, tl];
}

/** A unit's cards, marker and target region at its place in `row`, on frame `f` (a pose may have moved it). */
export function drawUnit(c: Container, f: SurfaceFrame, row: RowGeo, d: DrawSpec, s: number): Drawn {
  const proj = c.projector, v = row.v, quarter = row.tiers.some((t) => t.tapped === "quarter");
  const cards: CardPlace[] = [];
  const top = d.members[0] ?? null;
  // A block turns only when all of it is spent (a well with one open land lies square).
  const tappedTop = top !== null && (d.kind === "stack" ? d.members.every(d.tapped) : d.tapped(top));
  let face: Drawn["face"] = null;
  const lo = d.u - d.w / 2, hi = d.u + d.w / 2;

  // The top's pose, and how a member n layers under it.
  // Lying, centred on what it reaches from the row's feet: a quarter turn a card's width, a notch its turned depth.
  const reach = (turn: number): number => (turn === Math.PI / 2 ? CARD.w : turn === 0 ? CARD.h : CARD.h * Math.cos(turn) + CARD.w * Math.sin(turn)) * s;
  const lie = (turn: number): Pose => liePose(f, d.u, v + reach(turn) / 2, s, turn);
  let base: Pose, posture: CardPlace["posture"], turnName: CardPlace["turn"];
  if (d.kind !== "fan" && d.stands && !tappedTop) {
    base = standPose(f, d.u, v, LEAN);
    posture = "stand";
    turnName = "none";
  } else if (tappedTop && d.kind !== "fan" && row.grid && quarter) {
    base = lie(Math.PI / 2);
    posture = "lie";
    turnName = "quarter";
  } else {
    // a fan's top is whole and level; a single lying card notched when tapped
    const t = tappedTop && d.kind !== "fan" ? NOTCH : 0;
    base = lie(t);
    posture = "lie";
    turnName = tappedTop ? "notch" : "none";
  }
  // A block: every card adds stock, up to a third of a card's height (designer §2). Lying, the top is the highest;
  // standing, the top is in front and the rest stand behind it.
  const n0 = Math.max(1, d.members.length - 1);
  const lift = Math.min(CARD.thick * s, (CARD.h * s) / 3 / n0);
  const topLayer = d.members.length - 1;
  const layered = (p: Pose, k: number): Pose =>
    posture === "stand" ? { ...p, foot: madd(p.foot, f.away, (topLayer - k) * lift) } : { ...p, foot: madd(p.foot, f.normal, k * lift) };

  if (d.kind === "fan") {
    // From the top's foot-left corner, each card under it two degrees further clockwise, a slab lower; the hidden ones
    // lie under the last shown. Centred in its slot by its spread.
    const n = d.members.length, shown = Math.max(1, Math.min(n, d.show));
    const spread = SLOT.fanStep * (shown - 1) * s;
    const topPose = liePose(f, d.u - spread / 2, v + (CARD.h * s) / 2, s, 0);
    const pivot = madd(topPose.foot, topPose.right, (-CARD.w * s) / 2);
    const turned = (i: number): Pose => {
      const a = FAN_TURN * Math.min(i, shown - 1);
      const probe = liePose(f, 0, 0, s, a);
      const centre = madd(madd(pivot, probe.right, (CARD.w * s) / 2), probe.up, (CARD.h * s) / 2);
      const { u, v: vv } = uvOf(f, centre);
      return liePose(f, u, vv, s, a);
    };
    for (let i = n - 1; i >= 0; i--) {
      const id = d.members[i]!;
      const p = layered(i === 0 ? topPose : turned(i), n - 1 - i);
      cards.push(cardPlace(proj, id, p, s, "lie", d.tapped(id) ? "notch" : "none", n - 1 - i));
    }
    face = top === null ? null : { card: top, quad: cards[cards.length - 1]!.quad, pose: topPose, upright: topPose, standing: false };
  } else if (d.kind !== "summary") {
    const n = d.members.length;
    for (let i = n - 1; i >= 0; i--) {
      const id = d.members[i]!;
      cards.push(cardPlace(proj, id, layered(base, n - 1 - i), s, posture, i === 0 ? turnName : d.tapped(id) ? turnName : "none", n - 1 - i));
    }
    if (top !== null) face = { card: top, quad: cards[cards.length - 1]!.quad, pose: base, upright: posture === "stand" ? base : lie(0), standing: posture === "stand" };
  } else {
    // A summary has no face: its cards lie squared, face down, in its place.
    const p = lie(0), n = d.members.length;
    for (let i = n - 1; i >= 0; i--) cards.push(cardPlace(proj, d.members[i]!, layered(p, n - 1 - i), s, "lie", "none", n - 1 - i));
  }
  // Dressing tucks under its host, its top strip showing past the host's top.
  const host = face?.pose ?? base;
  d.dressing.forEach((id, k) => {
    const p: Pose = { ...host, foot: madd(madd(host.foot, host.up, 0.16 * s * (k + 1)), posture === "stand" ? f.away : f.normal, posture === "stand" ? 0.01 * (k + 1) : -lift * (k + 1)) };
    cards.unshift(cardPlace(proj, id, p, s, posture, d.tapped(id) ? turnName : "none", -1 - k));
  });

  const marker =
    d.kind === "stack" && d.members.length > 1 && row.strip > 0
      ? { count: d.members.length, at: onFrame(f, hi - row.strip / 2, v - row.strip / 2), room: surfaceQuad(proj, f, lo, hi, v - row.strip, v) }
      : null;
  const lieDepth = row.depth + (d.kind === "fan" || d.kind === "summary" ? row.proud : 0);
  const region = regionOf(proj, f, lo, hi, v, lieDepth, s, row.grid || posture === "stand", posture === "stand" ? 0 : topLayer * lift);
  const eye = proj.eye, foot = onFrame(f, d.u, v);
  return { cards, face, marker, region, depth: Math.hypot(foot.x - eye.x, foot.y - eye.y, foot.z - eye.z) };
}

