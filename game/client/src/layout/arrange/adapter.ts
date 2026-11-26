// An opponent's leaf, drawn (§6.1 step 6, §6.2 step 8): an arrangement as the seat plan the rest of the client already
// reads, so the scene, picking, the table's audit, the lean-in and the gathering take it unchanged. A parted table hands
// it the arrangement as the pose draws it (`posed`): its fixtures follow the frame it was drawn on. Each unit carries the
// engine's pose for its top card (the orientation unturned, and how far it is turned: a quarter or a notch) and its target
// region on screen (its place: what a tap at rest reaches); everything else (fixtures, ids, titles) is the seat plan's
// usual shape.
import type { SeatBoard } from "../board";
import { Ledger } from "../ledger";
import { bounds, commanderShape } from "../shape";
import type { Projector } from "../projector";
import { topChrome } from "../reservations";
import type { Reservations } from "../reservations";
import type { Fixtures, LayoutMemory, SeatPlan, Unit, UnitKind, UnitRole } from "../seat";
import { CW, PLATE_S } from "../seat/geometry";
import type { CardId, SeatId, V3 } from "../types";
import type { ArrCard, ArrUnit, ArrangeResult, CardPlace, ContainerMemory, PickTarget } from "./contract";
import { CARD, LEAN, clearBehind, onFrame } from "./frame";
import { LIE_DEPTH } from "./rows";
import { kindOf } from "./policies/kinds";
import { S_TABLE, SLOT } from "./scale";
import { myPlate } from "./mine";
import { MANA_TIERS } from "./policies/mine";

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
  /** As drawn: at rest, or as a pose moved it (its frame is the one it was drawn on). */
  readonly result: ArrangeResult;
  /** The far strip's depth (the template's leaf). */
  readonly far: number;
  /** How far the arrangement was drawn slid along its `away` (a parting): the fixtures are measured at rest. */
  readonly shift: number;
  /** How far a parting may slide it (the template's most): a fixture holds at both ends. */
  readonly reach: number;
  readonly board: SeatBoard;
  readonly cards: readonly ArrCard[];
  readonly projector: Projector;
  readonly reserve: Reservations;
}

/** The far strip's depth found for an arrangement (its rows and frame decide it), by what lies on the strip. */
const STRIP_V = new WeakMap<object, Map<string, number>>();

/** An opponent's seat plan from its arrangement. */
export function arrangedSeat(a: ArrangedSeatInput): SeatPlan {
  const { result, board } = a, f = result.fit.frame, yaw = Math.atan2(-f.across.z, f.across.x);
  const fit = result.fit, byId = new Map(a.cards.map((c) => [c.id, c]));
  const targetOf = new Map(fit.targets.map((t) => [t.piece, t]));
  const units: Unit[] = [];
  for (const u of fit.units) units.push(unitOf(u, board.seat as SeatId, byId, targetOf.get(u.id)));
  // Cards no place could hold (actors past every place) are reached through the entry: one pile by the plate.
  const placed = new Set(units.flatMap((u) => [...u.members, ...u.dressing]));
  const left = board.cards.map((c) => c.id).filter((id) => !placed.has(id));

  // Graveyard and exile are not on the leaf (the nameplate's focus holds them; a card bound there flies to the plate).
  // The commander waiting in the command zone stands at table size behind the rows in use, as deep as keeps its face
  // wholly clear of the chrome along the top (the nameplates' row, the log strip) at rest and parted at the most (a
  // parting carries it with the leaf). Where no depth does, it is not on the leaf: the nameplate's focus shows it.
  const rest = { ...f, anchor: onFrame(f, 0, -a.shift) }, edge = f.w / 2, s = fit.scale;
  const vp = a.projector.viewport, safe = a.reserve.safe;
  const top = topChrome(vp, { left: safe.left, top: safe.top, right: vp.w - safe.right, bottom: vp.h - safe.bottom });
  const commanderAt = (on: typeof f, v: number): Fixtures["commander"] => {
    if (board.fixtures.commander === undefined) return undefined;
    const pos = onFrame(on, edge - (CW * S_TABLE) / 2 - SLOT.margin, v);
    return { card: board.fixtures.commander, placement: { pos, scale: S_TABLE, posture: "stand" } };
  };
  const ends = [rest, { ...rest, anchor: onFrame(rest, 0, a.reach) }];
  const clear = (v: number): boolean =>
    ends.every((on) => {
      const c = commanderAt(on, v);
      if (!c) return true;
      const b = bounds(commanderShape(a.projector, board.seat, c).face);
      return b.t >= safe.top && b.l >= safe.left && b.r <= safe.right && top.every((r) => b.r <= r.left || b.l >= r.right || b.b <= r.top || b.t >= r.bottom);
    });
  // Nearest it may come: behind the rows in use (a standing row's tops, a lying row's far edge and proud strip).
  const behind = fit.rows.reduce((t, r) => Math.max(t, r.posture === "stand" ? clearBehind(a.projector, rest, r.v, s, 2, LEAN) : r.v + LIE_DEPTH * s + 0.3 * CARD.h * s), 0) + 0.1;
  const key = `${board.fixtures.commander ?? ""}|${a.shift}|${a.reach}|${top.map((r) => r.bottom.toFixed(2)).join(",")}`;
  let v = STRIP_V.get(fit)?.get(key);
  if (v === undefined) {
    v = Number.NaN;
    if (board.fixtures.commander !== undefined && clear(behind)) {
      let a0 = behind, b0 = f.d;
      for (let k = 0; k < 14; k++) {
        const m = (a0 + b0) / 2;
        if (clear(m)) a0 = m;
        else b0 = m;
      }
      v = a0;
    }
    if (!STRIP_V.has(fit)) STRIP_V.set(fit, new Map());
    STRIP_V.get(fit)!.set(key, v);
  }
  const commander = Number.isNaN(v) ? undefined : commanderAt(f, v);
  // (The plate's own table group lies past the leaf's far edge, out of the way: the nameplate is chrome.)
  const plate = { pos: onFrame(f, 0, f.d + 0.25), scale: PLATE_S, posture: "stand" as const };
  const zones: Fixtures["zones"] = [];
  if (left.length)
    units.push({ id: `u:entry:${board.seat}`, role: "support", kind: "summary", members: left, dressing: [], top: left[0]!, title: `All ${left.length}`, mixed: true, acting: false, tapped: false, placement: { pos: onFrame(f, 0, behind + 0.2), scale: S_TABLE, posture: "flat" } });
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

export interface MineSeatInput {
  readonly result: ArrangeResult;
  /** How far my edge of the table lies in front of the frame's anchor (world units, along `away`'s opposite). */
  readonly edge: number;
  /** My field's line (the container's `facing`): the page reaches past it whether or not anything stands there. */
  readonly facing: number;
  readonly board: SeatBoard;
  readonly cards: readonly ArrCard[];
  readonly projector: Projector;
  readonly reserve: Reservations;
}

/**
 * My seat plan from my side's arrangement (arrange/mine.ts): its units as an opponent's are drawn; my nameplate at the
 * screen's foot right of the hand. Graveyard, exile and the waiting commander are the nameplate's (a card bound there
 * flies to it), not the table's.
 */
export function mineSeat(a: MineSeatInput): SeatPlan {
  const { result, board } = a, fit = result.fit, f = fit.frame, seat = board.seat as SeatId;
  const byId = new Map(a.cards.map((c) => [c.id, c]));
  const targetOf = new Map(fit.targets.map((t) => [t.piece, t]));
  const units: Unit[] = fit.units.map((u) => unitOf(u, seat, byId, targetOf.get(u.id), true));
  const placed = new Set(units.flatMap((u) => [...u.members, ...u.dressing]));
  const left = board.cards.map((c) => c.id).filter((id) => !placed.has(id));
  // Cards no place could hold are reached through the entry: one pile on the row's anchor.
  if (left.length) units.push({ id: `u:entry:${seat}`, role: "support", kind: "summary", members: left, dressing: [], top: left[0]!, title: `All ${left.length}`, mixed: true, acting: false, tapped: false, placement: { pos: onFrame(f, 0, 0.2), scale: S_TABLE, posture: "flat" } });
  // My page is the mat from my edge of the table (the near slot's) to just behind what lies on my field's line.
  const v0 = Math.min(0, -a.edge), v1 = a.facing + CARD.h * S_TABLE + 0.1;
  const fixtures: Fixtures = { page: { pos: onFrame(f, 0, (v0 + v1) / 2), w: f.w, d: v1 - v0, yaw: 0 }, plate: myPlate(a.projector, a.reserve), zones: [] };
  const folded = fit.units.reduce((t, u) => t + Math.max(0, u.members.length - 1), 0);
  return new Ledger(board.cards.map((c) => c.id)).seal({
    seat,
    units,
    fixtures,
    memory: { v: 1, paradigm: ARRANGED, fit: fit.memory },
    report: { folded, held: false, pressure: 0, overflow: result.overflow !== null, lastResort: false },
  });
}

/**
 * A unit's id on the table: the engine's ids are its container's (every leaf has its `u:frest`), so all but a card's own
 * (`u:c<card>` on a unit that holds that card, unique already) carry their seat.
 */
export const tableUnitId = (id: string, seat: SeatId, members: readonly CardId[] = []): string => {
  // (a pile that inherited a card's id by lineage, that card gone, perhaps to another seat, carries its seat too)
  const m = /^u:c(\d+)$/.exec(id);
  return m && members.includes(Number(m[1]) as CardId) ? id : `${id}@${seat}`;
};

/** My mana's tiers (policies/mine.ts): each pile there is a well. */
const MY_MANA: ReadonlySet<string> = new Set(MANA_TIERS);

function unitOf(u: ArrUnit, seat: SeatId, byId: ReadonlyMap<CardId, ArrCard>, target: PickTarget | undefined, mine = false): Unit {
  const region = target?.region;
  // The solver's target opens a chooser where an attachment on this unit is offered: the tap reaches the attachment too.
  const reach = target && "open" in target.action && u.dressing.length && target.members.length > u.members.length ? target.members : undefined;
  const topId = u.top ?? u.members[0]!;
  const topPlace = u.cards.find((p) => p.card === topId) ?? u.cards.at(-1)!;
  const pose = unturned(topPlace);
  const top = byId.get(topId);
  // A block of their lands is a well; so is any pile of my mana (by kind: basics, rocks, utility lands; or all of it),
  // which the scene signs with its kind, count and how many are tapped.
  const well = u.kind !== "card" && u.kind !== "summary" && (mine ? MY_MANA.has(u.tier) : u.kind === "stack" && u.tier === "lands");
  const kind: UnitKind = u.kind === "card" ? "card" : u.kind === "summary" ? "summary" : well ? "well" : "pile";
  // (A lying place is a notched card wide: its pile says only how many; what they are is its top and its facts.)
  // (a well of one kind of mine says which: "Rocks 5", "Lands 6"; a block of basics and the well of all my mana say
  // their own)
  const title = well
    ? mine && u.kind === "fan" && (u.tier === "rocks" || u.tier === "lands")
      ? `${u.tier === "rocks" ? "Rocks" : "Lands"} ${u.members.length}`
      : null
    : u.kind === "fan" ? `${u.members.length}` : u.kind === "summary" ? `All ${u.members.length}` : u.kind === "stack" ? `${top?.name ?? ""} ${u.members.length}` : null;
  return {
    id: tableUnitId(u.id, seat, u.members),
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
    ...(reach ? { reach } : {}),
  };
}
