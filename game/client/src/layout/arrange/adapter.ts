// An opponent's leaf, drawn (§6.1 step 6, §6.2 step 8): an arrangement as the seat plan the rest of the client already
// reads, so the scene, picking, the table's audit, the lean-in and the gathering take it unchanged. A parted table hands
// it the arrangement as the pose draws it (`posed`): its fixtures follow the frame it was drawn on. Each unit carries the engine's
// pose for its top card (the orientation unturned, and how far it is turned: a quarter or a notch) and its target
// region on screen (its place: what a tap at rest reaches); everything else (fixtures, ids, titles) is the seat plan's
// usual shape.
import type { SeatBoard } from "../board";
import { FLOOR, TAP_PX } from "../board";
import { Ledger } from "../ledger";
import { bounds, commanderShape, zoneShape } from "../shape";
import type { Projector } from "../projector";
import type { Reservations } from "../reservations";
import type { Fixtures, LayoutMemory, SeatPlan, Unit, UnitKind, UnitRole } from "../seat";
import { CW, PLATE_S, ZONE_S, floorScale, makeGeo } from "../seat/geometry";
import type { CardId, SeatId, V3 } from "../types";
import type { ArrCard, ArrUnit, ArrangeResult, CardPlace, ContainerMemory } from "./contract";
import { CARD, LEAN, clearBehind, onFrame } from "./frame";
import { PLATE } from "./leaf";
import { LIE_DEPTH } from "./rows";
import { kindOf } from "./policies/kinds";
import { S_TABLE } from "./scale";

/** The seat plan's memory for an arranged leaf: the engine's container memory, carried as layout memory is. */
export const ARRANGED = "arranged";
export const arrangedMemory = (m: LayoutMemory | null | undefined): ContainerMemory | null =>
  m && m.paradigm === ARRANGED && m.v === 1 ? (m.fit as ContainerMemory) : null;

/** The zone piles along the far strip: the first's left edge in from the leaf's edge, and the space between two. */
const ZONE_EDGE = 0.45, ZONE_GAP = 0.3;
/** Half a plaque's width at scale 1 (shape.ts `plateShape`). */
const PLATE_HALF = 1.6;
/** How far into the far strip the zone piles lie: clear of a fan's turned corners in the row in front. */
const ZONE_BACK = 0.15;

const madd = (a: V3, b: V3, k: number): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });

/** How far a card place is turned, as the tap channel draws it (1: a quarter turn). */
const TURN = { none: 0, notch: 1 / 6, quarter: 1 } as const;

/**
 * A card place unturned: the same middle, its top pointing as it would with no turn, and the turn apart (the renderer
 * turns a tapped card in its own plane). Up' = cosθ·up + sinθ·right, so up = cosθ·up' − sinθ·right'.
 */
function unturned(p: CardPlace): { foot: V3; right: V3; up: V3; turn: number } {
  const turn = TURN[p.turn], th = (turn * Math.PI) / 2, c = Math.cos(th), s = Math.sin(th);
  const mid = madd(p.foot, p.up, (CARD.h * S_TABLE) / 2);
  const up = madd({ x: p.up.x * c, y: p.up.y * c, z: p.up.z * c }, p.right, -s);
  const right = madd({ x: p.right.x * c, y: p.right.y * c, z: p.right.z * c }, p.up, s);
  return { foot: madd(mid, up, (-CARD.h * S_TABLE) / 2), right, up, turn };
}

const roleOf = (c: ArrCard | undefined): UnitRole => {
  if (!c) return "support";
  const k = kindOf(c);
  return k === "creature" ? "creature" : k === "planeswalker" ? "walker" : k === "mana" ? "mana" : "support";
};

export interface ArrangedSeatInput {
  /** As drawn: at rest, or as a pose moved it (its frame is the one it was drawn on). */
  readonly result: ArrangeResult;
  /** The far strip's depth (the template's leaf). */
  readonly far: number;
  /** How far the arrangement was drawn slid along its `away` (a parting): the fixtures are measured at rest. */
  readonly shift: number;
  readonly board: SeatBoard;
  readonly cards: readonly ArrCard[];
  readonly projector: Projector;
  readonly reserve: Reservations;
}

/** An opponent's seat plan from its arrangement. */
export function arrangedSeat(a: ArrangedSeatInput): SeatPlan {
  const { result, board } = a, f = result.fit.frame, yaw = Math.atan2(-f.across.z, f.across.x);
  const fit = result.fit, byId = new Map(a.cards.map((c) => [c.id, c]));
  const regionOf = new Map(fit.targets.map((t) => [t.piece, t.region]));
  const units: Unit[] = [];
  for (const u of fit.units) units.push(unitOf(u, board.seat as SeatId, byId, regionOf.get(u.id)));
  // Cards no place could hold (actors past every place) are reached through the entry: one pile by the plate.
  const placed = new Set(units.flatMap((u) => [...u.members, ...u.dressing]));
  const left = board.cards.map((c) => c.id).filter((id) => !placed.has(id));

  // The far strip holds the fixtures side by side (the zone piles, the plate, the commander waiting beside it): at its
  // near edge, or nearer where the rows in use leave room, as deep as keeps them clear under the plates at the top of the
  // screen (further back they slide under the plates and off the screen's top). Measured at rest, so a parting carries
  // them with the leaf.
  const g = makeGeo(a.projector, a.reserve, FLOOR.any);
  const rest = { ...f, anchor: onFrame(f, 0, -a.shift) }, edge = f.w / 2, s = fit.scale;
  const present = (["graveyard", "exile"] as const).filter((z) => (z === "graveyard" ? board.fixtures.graveyard : board.fixtures.exile) > 0);
  const strip = (on: typeof f, v: number) => {
    // Side by side by their widths as drawn: a pile grows past ZONE_S to meet the floor (measured as it is drawn: another's
    // pile is propped up, so it needs far less than one lying flat would), and the next stands clear of it.
    const scaleAt = (at: number): number => {
      const one = zoneShape(a.projector, board.seat, "graveyard", { pos: onFrame(on, at, v + ZONE_BACK), scale: 1, posture: "flat" }, board.mine), b = bounds(one.face);
      return Math.max(ZONE_S, (Math.max(FLOOR.any * g.u, TAP_PX) * 1.09) / one.width, (TAP_PX * 1.09) / (b.b - b.t));
    };
    const zones: Fixtures["zones"][number][] = [];
    let u = -edge + ZONE_EDGE;
    for (const zone of present) {
      let scale = scaleAt(u + (CW * ZONE_S) / 2);
      for (let k = 0; k < 2; k++) scale = scaleAt(u + (CW * scale) / 2);   // at its middle, at the scale it draws at
      zones.push({ zone, placement: { pos: onFrame(on, u + (CW * scale) / 2, v + ZONE_BACK), scale, posture: "flat" } });
      u += CW * scale + ZONE_GAP;
    }
    // The plate after the zone piles (its own width clear of them), the commander after the plate.
    const plateU = Math.max(0.6, u + PLATE_HALF * PLATE_S), plate = { pos: onFrame(on, plateU, v + 0.25), scale: PLATE_S, posture: "stand" as const };
    let commander: Fixtures["commander"];
    if (board.fixtures.commander !== undefined) {
      const pos = onFrame(on, Math.max(edge - 0.8, plateU + PLATE_HALF * PLATE_S + ZONE_GAP + CW / 2), v + 0.2);
      commander = { card: board.fixtures.commander, placement: { pos, scale: Math.max(0.9, floorScale(g, pos, FLOOR.any, false, 0.9)), posture: "stand" } };
    }
    const tops = [...zones.map((z) => bounds(zoneShape(a.projector, board.seat, z.zone, z.placement, board.mine).face).t), ...(commander ? [bounds(commanderShape(a.projector, board.seat, commander).face).t] : [])];
    return { zones, plate, commander, entry: onFrame(on, edge - 0.9, v + ZONE_BACK), top: Math.min(Infinity, ...tops) };
  };
  // Nearest it may come: behind the rows in use (a standing row's tops, a lying row's far edge and proud strip).
  const far = f.d - a.far, under = a.reserve.safe.top + (PLATE.top + PLATE.h + 4) * g.u;
  const behind = fit.rows.reduce((t, r) => Math.max(t, r.posture === "stand" ? clearBehind(a.projector, rest, r.v, s, 2, LEAN) : r.v + LIE_DEPTH * s + 0.3 * CARD.h * s), 0) + 0.1;
  let v = far;
  if (present.length || board.fixtures.commander !== undefined) {
    const lo = Math.min(far, behind);
    if (strip(rest, far).top < under) {
      let a0 = lo, b0 = far;
      for (let k = 0; k < 14; k++) {
        const m = (a0 + b0) / 2;
        if (strip(rest, m).top >= under) a0 = m;
        else b0 = m;
      }
      v = a0;
    }
  }
  const { zones, plate, commander, entry } = strip(f, v);
  if (left.length)
    units.push({ id: `u:entry:${board.seat}`, role: "support", kind: "summary", members: left, dressing: [], top: left[0]!, title: `All ${left.length}`, mixed: true, acting: false, tapped: false, placement: { pos: entry, scale: S_TABLE, posture: "flat" } });
  // The page from its front row's feet back (the strip in front of them, for a stack's dice, is the open table's).
  const v0 = fit.rows[0] ? fit.rows[0].v : 0;
  const fixtures: Fixtures = { page: { pos: onFrame(f, 0, (v0 + f.d) / 2), w: f.w, d: f.d - v0, yaw }, plate, zones, ...(commander ? { commander } : {}) };
  const memory: LayoutMemory = { v: 1, paradigm: ARRANGED, fit: fit.memory };
  const folded = fit.units.reduce((t, u) => t + Math.max(0, u.members.length - 1), 0);
  return new Ledger(board.cards.map((c) => c.id)).seal({
    seat: board.seat as SeatId,
    units,
    fixtures,
    memory,
    report: { folded, held: false, pressure: 0, overflow: result.overflow !== null, lastResort: false },
  });
}

/**
 * A unit's id on the table: the engine's ids are its container's (every leaf has its `u:frest`), so all but a single
 * card's own (`u:c<card>`, unique already) carry their seat.
 */
export const tableUnitId = (id: string, seat: SeatId): string => (/^u:c\d+$/.test(id) ? id : `${id}@${seat}`);

function unitOf(u: ArrUnit, seat: SeatId, byId: ReadonlyMap<CardId, ArrCard>, region: Unit["hit"]): Unit {
  const topId = u.top ?? u.members[0]!;
  const topPlace = u.cards.find((p) => p.card === topId) ?? u.cards.at(-1)!;
  const pose = unturned(topPlace);
  const top = byId.get(topId);
  const kind: UnitKind = u.kind === "card" ? "card" : u.kind === "summary" ? "summary" : u.kind === "stack" && u.tier === "lands" ? "well" : "pile";
  // (A lying place is a notched card wide: its pile says only how many; what they are is its top and its facts.)
  const title = u.kind === "fan" ? `${u.members.length}` : u.kind === "summary" ? `All ${u.members.length}` : u.kind === "stack" && u.tier !== "lands" ? `${top?.name ?? ""} ${u.members.length}` : null;
  return {
    id: tableUnitId(u.id, seat),
    role: roleOf(top),
    kind,
    members: u.members,
    dressing: u.dressing,
    top: topId,
    title,
    mixed: u.kind === "fan" || u.kind === "summary",
    acting: u.acting,
    tapped: topPlace.turn !== "none",
    placement: { pos: pose.foot, scale: S_TABLE, posture: topPlace.posture === "stand" ? "stand" : "flat", frame: { right: pose.right, up: pose.up } },
    turn: pose.turn,
    ...(region ? { hit: region } : {}),
  };
}
