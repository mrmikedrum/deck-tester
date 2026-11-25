// Combat on the table (old h.js `targets`, its combat part, and `drawLanes`): every creature in a fight leaves its place
// and stands in the open middle, where it covers no page: the attackers in one row across, in the order they stood, each
// blocker straight in front of the attacker it blocks (between it and its defender), so who blocks whom reads without a
// lane. Their places stay empty on their pages, for them to go back to when combat ends. And the lanes: each attack a
// stroke from its attacker to where it lands, the front edge of the defender's page, the planeswalker it attacks, or the
// foot of the blocker that stopped it. Pure, in the plan's terms: units, placements, the projector.
import type { TableModel } from "../model";
import { FLOOR } from "./board";
import type { Projector } from "./projector";
import type { SeatPlan, Unit } from "./seat";
import { CH, CW, STEP, TAP_LEAN, bandSpec, floorScale } from "./seat/geometry";
import type { Geo } from "./seat/geometry";
import { bounds } from "./shape";
import type { Shape } from "./shape";
import type { CardId, SeatId, V3 } from "./types";

/** Attacks and blocks as layout takes them: plain ids (play's combat draft has this shape; layout never imports play). */
export interface CombatPairs {
  readonly attacks: readonly { readonly attacker: CardId; readonly defender: { readonly seat: SeatId } | { readonly card: CardId } }[];
  readonly blocks: readonly { readonly blocker: CardId; readonly attacker: CardId }[];
}

/** The engine's combat as pairs (an attack with no defender yet is left out). */
export function engineCombat(model: TableModel): CombatPairs | null {
  const c = model.combat;
  if (!c) return null;
  return {
    attacks: c.attackers.flatMap((a) => (a.defender ? [{ attacker: a.attacker, defender: a.defender }] : [])),
    blocks: c.blockers.map((b) => ({ blocker: b.blocker, attacker: b.attacker })),
  };
}

/**
 * The combat to show: a draft over the engine's (live.js `prepare`'s G.combat). An attack draft is the attacks picked so
 * far; a block draft keeps the engine's attackers and puts its own blockers in place of the engine's.
 */
export function mergeCombat(engine: CombatPairs | null, draft: CombatPairs | null): CombatPairs | null {
  if (!draft) return engine && (engine.attacks.length || engine.blocks.length) ? engine : null;
  const attacks = draft.attacks.length ? draft.attacks : (engine?.attacks ?? []);
  const blocks = draft.blocks.length || draft.attacks.length ? draft.blocks : (engine?.blocks ?? []);
  return attacks.length || blocks.length ? { attacks, blocks } : null;
}

/** Every card in the fight. */
export const fighters = (c: CombatPairs | null): Set<CardId> =>
  new Set(c ? [...c.attacks.map((a) => a.attacker), ...c.blocks.map((b) => b.blocker)] : []);

/** The open table in the middle, in design units (plan.ts `openMiddle`). */
export interface Middle {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}

export interface RowInput {
  readonly combat: CombatPairs;
  readonly plans: readonly SeatPlan[];
  readonly perspective: SeatId;
  readonly projector: Projector;
  readonly geo: Geo;
  readonly middle: Middle;
  /** What stays where it is and is drawn on screen (the seats' other things, the stack): the row keeps clear of them. */
  readonly obstacles: readonly Shape[];
}

/** Unit ids in the fight: the attackers' and blockers' own units (mat gives each fighter a unit of its own). */
function fightUnits(plans: readonly SeatPlan[], want: ReadonlySet<CardId>): Map<CardId, { unit: Unit; seat: SeatId }> {
  const out = new Map<CardId, { unit: Unit; seat: SeatId }>();
  for (const p of plans)
    for (const u of p.units)
      if (u.role === "creature") for (const id of u.members) if (want.has(id) && !out.has(id)) out.set(id, { unit: u, seat: p.seat });
  return out;
}

/** The ids of the units a combat row would move: what the seats' audit leaves to the composed one. */
export function rowUnits(plans: readonly SeatPlan[], cards: ReadonlySet<CardId>): Set<string> {
  return cards.size ? new Set([...fightUnits(plans, cards).values()].map((f) => f.unit.id)) : new Set();
}

/**
 * The seats with their fighters moved into the open middle (`fighting` set on them), as candidates in order of
 * preference: the table takes the first whose composed audit is clean. A fighter keeps its unit's id, its members and its
 * place in the seat's memory (its page place stays free for it to go back to).
 */
export function combatRow(input: RowInput): SeatPlan[][] {
  const { combat, plans, projector: proj, geo: g, middle: M, perspective } = input;
  const units = fightUnits(plans, fighters(combat));
  if (!units.size) return [[...plans]];
  const u = g.u;
  const project = (p: V3) => proj.project(p);
  const unitOf = (id: CardId) => units.get(id);
  // One group per attacking unit: its attackers, and its blockers' units.
  interface Group {
    readonly k: Unit;
    readonly from: SeatId;
    readonly bs: Unit[];
  }
  const groups: Group[] = [];
  for (const a of combat.attacks) {
    const f = unitOf(a.attacker);
    if (!f) continue;
    let gr = groups.find((x) => x.k.id === f.unit.id);
    if (!gr) groups.push((gr = { k: f.unit, from: f.seat, bs: [] }));
    for (const b of combat.blocks)
      if (b.attacker === a.attacker) {
        const fb = unitOf(b.blocker);
        if (fb && fb.unit.id !== gr.k.id && !groups.some((x) => x.bs.includes(fb.unit)) && !gr.bs.includes(fb.unit)) gr.bs.push(fb.unit);
      }
  }
  if (!groups.length) return [[...plans]];
  // In the order they stood: blockers come to the attackers, never the attackers trading places as I read who blocks whom.
  const seenX = (un: Unit): number => project(un.placement.pos).x;
  groups.sort((x, y) => seenX(x.k) - seenX(y.k) || (x.k.id < y.k.id ? -1 : 1));
  // Each as large as its side's creatures prefer, or the floors ask where it stands.
  const mid = proj.onTable(((M.l + M.r) / 2) * u, M.b * u);
  const mineOf = (un: Unit): boolean => [...units.values()].some((f) => f.unit === un && f.seat === perspective);
  const sz = new Map<Unit, number>();
  for (const gr of groups)
    for (const un of [gr.k, ...gr.bs]) {
      const me = mineOf(un);
      sz.set(un, Math.max(bandSpec("C", me, proj.pitch, me ? FLOOR.mine : FLOOR.theirs).pref, floorScale(g, mid, me ? FLOOR.mine : FLOOR.theirs, false)));
    }
  const s = (un: Unit): number => sz.get(un)!;
  // A tapped standee lies turned: as wide as it is tall. A detachment's tray is a creature place wide.
  const wide = (un: Unit): number => s(un) * (un.tray ? CH + 0.11 : un.tapped ? CH : CW) * 1.06;
  const tall = (un: Unit): number => s(un) * (un.tapped ? CW : CH);
  // The attackers' row is the far one, unless the attackers are mine: either way the blockers stand between them and who
  // they attack, the near row's feet at the open table's foot and the far row a row's step behind. Where the far row would
  // reach over the page behind, it is one row instead, each blocker just beside the attacker it blocks.
  const mineAtk = groups[0]!.from === perspective;
  const upOf = (un: Unit): V3 => {
    const th = proj.pitch + (un.tapped ? TAP_LEAN : 0);
    return { x: 0, y: Math.cos(th), z: -Math.sin(th) };
  };
  const topY = (un: Unit, z: number): number => {
    const up = upOf(un), h = tall(un);
    return project({ x: mid.x, y: up.y * h, z: z + up.z * h }).y / u;
  };
  const sum = (us: readonly Unit[]): number => us.reduce((t, x) => t + wide(x), 0);
  const W = proj.viewport.w / u;
  /** The fight laid out with these groups, in one row or two; null when it is wider than the open table it stands in. */
  const lay = (gs: readonly Group[], rows: boolean, fit: boolean): Map<string, { pos: V3; s: number }> | null => {
    const nearUnits = gs.flatMap((gr) => (mineAtk ? [gr.k] : gr.bs));
    const sNear = Math.max(1, ...nearUnits.map(s));
    const Z = { near: mid.z, far: mid.z - STEP * sNear };
    // The open stretch of table the row stands in: across the open middle's foot, between the nearest things that stay
    // (as they stand on screen), the widest gap, so it covers none of them.
    const all = gs.flatMap((gr) => [gr.k, ...gr.bs]);
    const y0 = Math.min(...all.map((un) => topY(un, rows ? Z.far : Z.near))), y1 = M.b + 8;
    const cut = input.obstacles
      .map((sh) => {
        const b = bounds(sh.face);
        return b.b / u > y0 && b.t / u < y1 ? ([b.l / u - 6, b.r / u + 6] as const) : null;
      })
      .filter((x): x is readonly [number, number] => x !== null)
      .sort((a, b) => a[0] - b[0]);
    let open: [number, number] = [16, 16], at = 16;
    for (const [a, b] of [...cut, [W - 16, W - 16] as const]) {
      if (a - at > open[1] - open[0]) open = [at, Math.min(a, W - 16)];
      at = Math.max(at, b);
    }
    const gl = proj.onTable(open[0] * u, M.b * u).x, gr0 = proj.onTable(open[1] * u, M.b * u).x;
    const span = (gr: Group): number => (rows ? Math.max(wide(gr.k), sum(gr.bs)) : wide(gr.k) + sum(gr.bs));
    const packed = gs.reduce((t, gr) => t + span(gr), 0);
    if (fit && packed + 0.12 * Math.max(0, gs.length - 1) > gr0 - gl) return null;
    const gap = Math.max(0.12, Math.min(CW * 0.8, (gr0 - gl - packed) / Math.max(1, gs.length + 1)));
    const width = packed + gap * Math.max(0, gs.length - 1);
    const placed = new Map<string, { pos: V3; s: number }>();
    const put = (un: Unit, pos: V3) => placed.set(un.id, { pos, s: s(un) });
    let x = (gl + gr0) / 2 - width / 2, tail = false;
    for (const gr of gs) {
      // In one row, each blocker stands on the side of its attacker it comes from, so it steps up without crossing it;
      // but never beside the last pair's blocker, where two blockers between two attackers wouldn't say whose is whose.
      const w = span(gr), cx = project({ x: x + w / 2, y: 0, z: Z.near }).x;
      const before: Unit[] = rows || tail ? [] : gr.bs.filter((b) => seenX(b) < cx);
      const after: Unit[] = gr.bs.filter((b) => !before.includes(b));
      tail = after.length > 0;
      put(gr.k, rows ? { x: x + w / 2, y: 0, z: mineAtk ? Z.near : Z.far } : { x: x + sum(before) + wide(gr.k) / 2, y: 0, z: Z.near });
      let bx = rows ? x + w / 2 - sum(gr.bs) / 2 : x;
      for (const b of [...before, ...(rows ? [] : [gr.k]), ...after]) {
        if (b !== gr.k) put(b, { x: bx + wide(b) / 2, y: 0, z: rows ? (mineAtk ? Z.far : Z.near) : Z.near });
        bx += wide(b);
      }
      x += w + gap;
    }
    return placed;
  };
  const moved = (placed: Map<string, { pos: V3; s: number }>): SeatPlan[] =>
    plans.map((p) =>
      p.units.some((un) => placed.has(un.id))
        ? {
            ...p,
            units: p.units.map((un) => {
              const at = placed.get(un.id);
              // (A detachment lies on its tray in the row; a card fighting alone stands, square to me, as it always has.)
              return at ? { ...un, fighting: true, placement: { pos: at.pos, scale: at.s, posture: un.tray ? ("flat" as const) : ("stand" as const) } } : un;
            }),
          }
        : p,
    );
  // Where the far row would reach over the page behind, it is one row instead, each blocker just beside its attacker.
  const blocked = groups.some((gr) => gr.bs.length > 0);
  const twoFit = (gs: readonly Group[]): boolean => {
    const sNear = Math.max(1, ...gs.flatMap((gr) => (mineAtk ? [gr.k] : gr.bs)).map(s));
    const far = mid.z - STEP * sNear;
    return gs.every((gr) => [gr.k, ...gr.bs].every((un) => topY(un, far) >= M.t - 6));
  };
  const rows = blocked && twoFit(groups);
  // The old client's choice first; then the other form; then, where the whole fight is wider than the open table, the
  // groups that fit (the widest left out first) while the rest fight where they stand on their pages, each on its own.
  const out: SeatPlan[][] = [];
  const first = lay(groups, rows, true);
  if (first) out.push(moved(first));
  if (blocked && !rows) {
    const two = lay(groups, true, true);
    if (two) out.push(moved(two));
  }
  const some = [...groups];
  while (some.length > 1 && !out.length) {
    const widest = some.reduce((a, b) => (sum([b.k, ...b.bs]) > sum([a.k, ...a.bs]) ? b : a));
    some.splice(some.indexOf(widest), 1);
    const fits = lay(some, blocked && twoFit(some) && some.some((gr) => gr.bs.length > 0), true);
    if (fits) out.push(moved(fits));
  }
  // Nothing fits: as the old client stood it, wider than the gap (the audit reports what it covers).
  out.push(moved(lay(groups, rows, false)!));
  return out;
}

// ---- lanes ------------------------------------------------------------------------------------------------------------

/** Where a lane's end is: on a unit (an offset from where it rests, so it follows the unit), or a point on the table. */
export type LaneEnd = UnitEnd | { readonly at: V3 };
export interface UnitEnd {
  readonly unit: string;
  readonly offset: V3;
}

export interface LaneSpec {
  /** "attack:<attacker id>"; a second blocker's lane of the same attack, "attack:<attacker id>:<blocker's unit>". */
  readonly id: string;
  readonly attacker: CardId;
  /** Whose ink: the attacker's controller. */
  readonly seat: SeatId;
  readonly from: UnitEnd;
  readonly to: LaneEnd;
  /** It ends at the blocker that stopped it (or the planeswalker it attacks), not on a page's edge. */
  readonly blocked: boolean;
  /** At the defender's page: the seat under attack. */
  readonly defending: SeatId | null;
  /** How high its crest runs over the page: lanes to one seat crest each 0.15 higher than the last. */
  readonly apex: number;
}

/** How far an attack at me runs on past where its attacker stands, at the least (world units). */
const LAND_ON_ME = 1.4;

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const plus = (a: V3, b: V3, k = 1): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });

/**
 * Each attack's lane, where its units rest in the plan (h.js `targets` and `drawLanes`). It leaves 0.3 in front of the
 * attacker's foot, where the card can't hide its start. It lands on the blocker that stopped it, at its foot; on the
 * planeswalker it attacks; or on the front edge of the defender's page at the point nearest its attacker: never on the
 * plaque, which lies behind their whole field, and never in among their cards, where an unassigned attack would read as
 * aimed at one of them. Lanes at one page are spread at least 0.9 apart along its edge; at me the edge lies under my
 * standing row's lean, so they land just past it on the open book, in the nearest gap between my creatures. Lanes side by
 * side fan out 0.3 apart at the edge, and each crests 0.15 higher than the last, so they read as separate strands.
 */
export function combatLanes(plans: ReadonlyMap<SeatId, SeatPlan>, perspective: SeatId, combat: CombatPairs | null): LaneSpec[] {
  if (!combat) return [];
  const where = new Map<CardId, { unit: Unit; seat: SeatId }>();
  for (const [seat, p] of plans) for (const u of p.units) for (const id of u.members) where.set(id, { unit: u, seat });
  interface Edge {
    readonly lane: number;
    readonly seat: SeatId;
    readonly from: V3;
    u: number;
  }
  const out: LaneSpec[] = [];
  const edges = new Map<SeatId, Edge[]>();
  const pending: { spec: Omit<LaneSpec, "to">; edge: Edge | null; to: LaneEnd | null }[] = [];
  const drawn = new Set<string>();
  combat.attacks.forEach((a, lane) => {
    const atk = where.get(a.attacker);
    if (!atk) return;
    // A detachment (several attackers on one tray, all at one defender) draws one lane.
    if (atk.unit.members.length > 1) {
      const k = `${atk.unit.id}>${"seat" in a.defender ? a.defender.seat : a.defender.card}`;
      if (drawn.has(k)) return;
      drawn.add(k);
    }
    const blockers = combat.blocks.filter((b) => b.attacker === a.attacker);
    // Every blocker standing (one unit each, once): a double block draws a lane to each, so neither reads as alone.
    const stopped = blockers
      .map((b) => where.get(b.blocker))
      .filter((x): x is { unit: Unit; seat: SeatId } => !!x && x.unit.id !== atk.unit.id)
      .filter((x, i, all) => all.findIndex((y) => y.unit.id === x.unit.id) === i);
    // Blocked, its blockers gone: it stays blocked and aims at no one.
    if (!stopped.length && blockers.length) return;
    const defSeat = "seat" in a.defender ? a.defender.seat : (where.get(a.defender.card)?.seat ?? null);
    const page = defSeat ? plans.get(defSeat)?.fixtures.page : undefined;
    const pos = atk.unit.placement.pos;
    const d0 = page ? page.pos : pos;
    const toward = norm({ x: d0.x - pos.x, y: 0, z: d0.z - pos.z });
    const spec = {
      id: `attack:${a.attacker}`,
      attacker: a.attacker,
      seat: atk.seat,
      from: { unit: atk.unit.id, offset: plus({ x: 0, y: 0, z: 0 }, toward, 0.3) },
      blocked: stopped.length > 0 || "card" in a.defender,
      defending: defSeat,
      apex: 0.14 + lane * 0.15,
    };
    if (stopped.length) {
      // At each blocker's ground, just at its foot; the first keeps the attack's own id, the rest are by their blocker.
      stopped.forEach((blocker, k) => {
        const b = blocker.unit.placement.pos, d = len(sub(b, pos));
        const off = d > 1 ? plus({ x: 0, y: 0, z: 0 }, norm(sub(pos, b)), 0.2) : { x: 0, y: 0, z: 0 };
        const id = k === 0 ? spec.id : `${spec.id}:${blocker.unit.id}`;
        pending.push({ spec: { ...spec, id }, edge: null, to: { unit: blocker.unit.id, offset: off } });
      });
      return;
    }
    if ("card" in a.defender) {
      const w = where.get(a.defender.card);
      if (!w) return;
      const b = w.unit.placement.pos, d = len(sub(b, pos));
      pending.push({ spec, edge: null, to: { unit: w.unit.id, offset: d > 1 ? plus({ x: 0, y: 0, z: 0 }, norm(sub(pos, b)), 0.2) : { x: 0, y: 0, z: 0 } } });
      return;
    }
    if (!page || !defSeat) return;
    const c = Math.cos(page.yaw), sn = Math.sin(page.yaw);
    const e: Edge = { lane, seat: defSeat, from: pos, u: (pos.x - page.pos.x) * c - (pos.z - page.pos.z) * sn };
    edges.set(defSeat, [...(edges.get(defSeat) ?? []), e]);
    pending.push({ spec, edge: e, to: null });
  });
  for (const [seat, ls] of edges) {
    const page = plans.get(seat)!.fixtures.page, onMe = seat === perspective;
    const c = Math.cos(page.yaw), sn = Math.sin(page.yaw), half = Math.max(0.3, page.w / 2 - 0.6);
    // The front edge, from the page's middle: theirs faces the table's middle at their fixed edge; mine is its far edge.
    const uv = (p: V3): [number, number] => [(p.x - page.pos.x) * c - (p.z - page.pos.z) * sn, (p.x - page.pos.x) * sn + (p.z - page.pos.z) * c];
    // (At me, an attacker standing in the combat row is already at my page's edge: its lane runs on into my page a
    // little, past my front row's tops, so it reads as coming at me rather than as a mark at its foot.)
    const v = onMe ? Math.max(-page.d / 2 - 0.6, ...ls.map((l) => uv(l.from)[1] + LAND_ON_ME)) : page.d / 2 + 0.15;
    for (const l of ls) l.u = Math.max(-half, Math.min(half, l.u));
    ls.sort((a, b) => a.u - b.u || a.lane - b.lane);
    for (let i = 1; i < ls.length; i++) ls[i]!.u = Math.max(ls[i]!.u, ls[i - 1]!.u + 0.9);
    const over = ls[ls.length - 1]!.u - half;
    if (over > 0) for (const l of ls) l.u -= over;
    if (ls[0]!.u < -half) ls.forEach((l, i) => (l.u = ls.length > 1 ? -half + (i * 2 * half) / (ls.length - 1) : 0));
    if (onMe) {
      // One landing on a creature's top would read as aimed at it (as if blocked by it): it lands in the nearest open
      // gap of my front row instead; lanes that come to one gap share it, spread evenly across it.
      const mine = plans.get(seat)!.units.filter((un) => un.role === "creature" && !un.fighting);
      if (mine.length) {
        const near = Math.min(...mine.map((un) => Math.abs(uv(un.placement.pos)[1] - v)));
        const stand = mine
          .filter((un) => Math.abs(uv(un.placement.pos)[1] - v) < near + 0.5)
          .map((un): [number, number] => {
            const u0 = uv(un.placement.pos)[0], w = un.tapped ? CH : CW;
            return [u0 - (un.placement.scale * w) / 2 - 0.12, u0 + (un.placement.scale * w) / 2 + 0.12];
          });
        const gaps = new Map<string, { lo: number; hi: number; ls: Edge[] }>();
        for (const l of ls) {
          const hit = stand.find(([a, b]) => l.u > a && l.u < b);
          if (!hit) continue;
          const left = l.u - hit[0] < hit[1] - l.u, edgeU = left ? hit[0] : hit[1];
          const next = left
            ? Math.max(edgeU - 0.8, ...stand.map((s) => s[1]).filter((b) => b <= edgeU))
            : Math.min(edgeU + 0.8, ...stand.map((s) => s[0]).filter((a) => a >= edgeU));
          const lo = Math.min(edgeU, next), hi = Math.max(edgeU, next), key = lo.toFixed(2);
          const gp = gaps.get(key) ?? { lo, hi, ls: [] };
          gp.ls.push(l);
          gaps.set(key, gp);
        }
        for (const gp of gaps.values()) gp.ls.forEach((l, i) => (l.u = gp.lo + ((i + 1) * (gp.hi - gp.lo)) / (gp.ls.length + 1)));
      }
    }
    for (const l of ls) {
      const p = pending.find((x) => x.edge === l)!;
      p.to = { at: { x: page.pos.x + l.u * c + v * sn, y: 0, z: page.pos.z - l.u * sn + v * c } };
    }
  }
  for (const p of pending) if (p.to) out.push({ ...p.spec, to: p.to });
  return out;
}

