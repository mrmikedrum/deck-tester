// The across leaf, drawn (§6.1 step 6): an arrangement as the seat plan the rest of the client already reads, so the
// scene, picking, the table's audit, the lean-in and the combat row take it unchanged. Each unit carries the engine's
// pose for its top card (the orientation unturned, and how far it is turned: a quarter or a notch) and its target
// region on screen (its place: what a tap at rest reaches); everything else (fixtures, ids, titles) is the seat plan's
// usual shape.
import type { SeatBoard } from "../board";
import { FLOOR } from "../board";
import { Ledger } from "../ledger";
import type { Projector } from "../projector";
import type { Reservations } from "../reservations";
import type { Fixtures, LayoutMemory, SeatPlan, Unit, UnitKind, UnitRole } from "../seat";
import { PLATE_S, ZONE_S, floorScale, makeGeo } from "../seat/geometry";
import type { CardId, SeatId, V3 } from "../types";
import type { ArrCard, ArrUnit, ArrangeResult, CardPlace, ContainerMemory, SurfaceFrame } from "./contract";
import { CARD, onFrame } from "./frame";
import { kindOf } from "./policies/kinds";
import { S_TABLE } from "./scale";
import { LEAF } from "./leaf";

/** The seat plan's memory for an arranged leaf: the engine's container memory, carried as layout memory is. */
export const ARRANGED = "arranged";
export const arrangedMemory = (m: LayoutMemory | null | undefined): ContainerMemory | null =>
  m && m.paradigm === ARRANGED && m.v === 1 ? (m.fit as ContainerMemory) : null;

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
  readonly result: ArrangeResult;
  readonly frame: SurfaceFrame;
  readonly yaw: number;
  readonly board: SeatBoard;
  readonly cards: readonly ArrCard[];
  readonly projector: Projector;
  readonly reserve: Reservations;
}

/** The across leaf's seat plan from its arrangement. */
export function arrangedSeat(a: ArrangedSeatInput): SeatPlan {
  const { result, frame: f, board } = a;
  const fit = result.fit, byId = new Map(a.cards.map((c) => [c.id, c]));
  const regionOf = new Map(fit.targets.map((t) => [t.piece, t.region]));
  const units: Unit[] = [];
  for (const u of fit.units) units.push(unitOf(u, byId, regionOf.get(u.id)));
  // Cards no place could hold (actors past every place) are reached through the entry: one pile by the plate.
  const placed = new Set(units.flatMap((u) => [...u.members, ...u.dressing]));
  const left = board.cards.map((c) => c.id).filter((id) => !placed.has(id));

  // The far strip holds the fixtures side by side along its near edge (further back they would leave the screen's top):
  // the zone piles, the plate, the commander waiting beside it.
  const g = makeGeo(a.projector, a.reserve, FLOOR.any);
  const strip = f.d - LEAF.far, edge = f.w / 2;
  const plate = { pos: onFrame(f, 0.6, strip + 0.25), scale: PLATE_S, posture: "stand" as const };
  const zones: Fixtures["zones"][number][] = [];
  const present = (["graveyard", "exile"] as const).filter((z) => (z === "graveyard" ? board.fixtures.graveyard : board.fixtures.exile) > 0);
  present.forEach((zone, i) => {
    const pos = onFrame(f, -edge + 0.9 + i * 1.45, strip + 0.05);
    zones.push({ zone, placement: { pos, scale: Math.max(ZONE_S, floorScale(g, pos, FLOOR.any, true, ZONE_S)), posture: "flat" } });
  });
  if (left.length) {
    const pos = onFrame(f, edge - 0.9, strip + 0.05);
    units.push({ id: `u:entry:${board.seat}`, role: "support", kind: "summary", members: left, dressing: [], top: left[0]!, title: `All ${left.length}`, mixed: true, acting: false, tapped: false, placement: { pos, scale: S_TABLE, posture: "flat" } });
  }
  let commander: Fixtures["commander"];
  if (board.fixtures.commander !== undefined) {
    const pos = onFrame(f, edge - 0.8, strip + 0.2);
    commander = { card: board.fixtures.commander, placement: { pos, scale: Math.max(0.9, floorScale(g, pos, FLOOR.any, false, 0.9)), posture: "stand" } };
  }
  // The page from its front row's feet back (the strip in front of them, for a stack's dice, is the open table's).
  const v0 = fit.rows[0] ? fit.rows[0].v : 0;
  const fixtures: Fixtures = { page: { pos: onFrame(f, 0, (v0 + f.d) / 2), w: f.w, d: f.d - v0, yaw: a.yaw }, plate, zones, ...(commander ? { commander } : {}) };
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

function unitOf(u: ArrUnit, byId: ReadonlyMap<CardId, ArrCard>, region: Unit["hit"]): Unit {
  const topId = u.top ?? u.members[0]!;
  const topPlace = u.cards.find((p) => p.card === topId) ?? u.cards.at(-1)!;
  const pose = unturned(topPlace);
  const top = byId.get(topId);
  const kind: UnitKind = u.kind === "card" ? "card" : u.kind === "summary" ? "summary" : u.kind === "stack" && u.tier === "lands" ? "well" : "pile";
  // (A lying place is a notched card wide: its pile says only how many; what they are is its top and its facts.)
  const title = u.kind === "fan" ? `${u.members.length}` : u.kind === "summary" ? `All ${u.members.length}` : u.kind === "stack" && u.tier !== "lands" ? `${top?.name ?? ""} ${u.members.length}` : null;
  return {
    id: u.id,
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
