// Combat as layout takes it: the engine's attacks and blocks with play's draft over them, the fighters, and the lanes:
// each attack a stroke from its attacker to where it lands, the front edge of the defender's page, the planeswalker it
// attacks, or the foot of the blocker that stopped it (the table form; the clash draws none). Where fighters stand is the
// gathering's (arrange/gathering.ts). Pure, in the plan's terms: units, placements, the projector.
import type { TableModel } from "../model";
import type { SeatPlan, Unit } from "./seat";
import { CH, CW } from "./geometry";
import type { CardId, SeatId, V3 } from "./types";

/** Attacks and blocks as layout takes them: plain ids (play's combat draft has this shape; layout never imports play). */
export interface CombatPairs {
  /** `defending`: the player defending, when the engine says (a battle's protector is not its controller). */
  readonly attacks: readonly { readonly attacker: CardId; readonly defender: { readonly seat: SeatId } | { readonly card: CardId }; readonly defending?: SeatId }[];
  readonly blocks: readonly { readonly blocker: CardId; readonly attacker: CardId }[];
}

/** The engine's combat as pairs (an attack with no defender yet is left out). */
export function engineCombat(model: TableModel): CombatPairs | null {
  const c = model.combat;
  if (!c) return null;
  return {
    attacks: c.attackers.flatMap((a) => (a.defender ? [{ attacker: a.attacker, defender: a.defender, ...(a.defending ? { defending: a.defending } : {}) }] : [])),
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

/** Unit ids in the fight: the attackers' and blockers' own units (the engine gives each fighter a unit of its own). */
export function fightUnits(plans: readonly SeatPlan[], want: ReadonlySet<CardId>): Map<CardId, { unit: Unit; seat: SeatId }> {
  const out = new Map<CardId, { unit: Unit; seat: SeatId }>();
  for (const p of plans)
    for (const u of p.units)
      if (u.role === "creature") for (const id of u.members) if (want.has(id) && !out.has(id)) out.set(id, { unit: u, seat: p.seat });
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
 * aimed at one of them. Lanes from one seat to one page are a trunk: they land on one point and crest together; trunks
 * at one page are spread at least 0.9 apart along its edge; at me the edge lies under my
 * standing row's lean, so they land just past it on the open book, in the nearest gap between my creatures.
 */
export function combatLanes(plans: ReadonlyMap<SeatId, SeatPlan>, perspective: SeatId, combat: CombatPairs | null, blocked: ReadonlySet<CardId> = new Set()): LaneSpec[] {
  if (!combat) return [];
  const where = new Map<CardId, { unit: Unit; seat: SeatId }>();
  for (const [seat, p] of plans) for (const u of p.units) for (const id of u.members) where.set(id, { unit: u, seat });
  interface Edge {
    readonly lane: number;
    readonly seat: SeatId;
    /** Whose attack: its trunk is one per attacking seat and defender. */
    readonly by: SeatId;
    readonly from: V3;
    u: number;
  }
  const out: LaneSpec[] = [];
  const edges = new Map<SeatId, Edge[]>();
  const pending: { spec: Omit<LaneSpec, "to">; edge: Edge | null; to: LaneEnd | null }[] = [];
  combat.attacks.forEach((a, lane) => {
    const atk = where.get(a.attacker);
    if (!atk) return;
    const blockers = combat.blocks.filter((b) => b.attacker === a.attacker);
    // Every blocker standing (one unit each, once): a double block draws a lane to each, so neither reads as alone.
    const stopped = blockers
      .map((b) => where.get(b.blocker))
      .filter((x): x is { unit: Unit; seat: SeatId } => !!x && x.unit.id !== atk.unit.id)
      .filter((x, i, all) => all.findIndex((y) => y.unit.id === x.unit.id) === i);
    // Blocked, its blockers gone (now, or since it was blocked this combat: `blocked`): it stays blocked and aims at no one.
    if (!stopped.length && (blockers.length || blocked.has(a.attacker))) return;
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
    const e: Edge = { lane, seat: defSeat, by: atk.seat, from: pos, u: (pos.x - page.pos.x) * c - (pos.z - page.pos.z) * sn };
    edges.set(defSeat, [...(edges.get(defSeat) ?? []), e]);
    pending.push({ spec, edge: e, to: null });
  });
  for (const [seat, ls] of edges) {
    const page = plans.get(seat)!.fixtures.page, onMe = seat === perspective;
    const c = Math.cos(page.yaw), sn = Math.sin(page.yaw), half = Math.max(0.3, page.w / 2 - 0.6);
    // The front edge, from the page's middle: theirs faces the table's middle at their fixed edge; mine is its far edge.
    const uv = (p: V3): [number, number] => [(p.x - page.pos.x) * c - (p.z - page.pos.z) * sn, (p.x - page.pos.x) * sn + (p.z - page.pos.z) * c];
    // (At me, an attacker standing in the clash is already at my page's edge: its lane runs on into my page a
    // little, past my front row's tops, so it reads as coming at me rather than as a mark at its foot.)
    const v = onMe ? Math.max(-page.d / 2 - 0.6, ...ls.map((l) => uv(l.from)[1] + LAND_ON_ME)) : page.d / 2 + 0.15;
    // One trunk per attacking seat: its lanes land on one point (their mean), so they gather into one stroke rather than
    // fanning out as strands; trunks at one page stand at least 0.9 apart.
    const trunks = [...new Set(ls.map((l) => l.by))].map((by) => {
      const own = ls.filter((l) => l.by === by);
      return { own, u: Math.max(-half, Math.min(half, own.reduce((t, l) => t + l.u, 0) / own.length)), lane: Math.min(...own.map((l) => l.lane)) };
    });
    trunks.sort((a, b) => a.u - b.u || a.lane - b.lane);
    for (let i = 1; i < trunks.length; i++) trunks[i]!.u = Math.max(trunks[i]!.u, trunks[i - 1]!.u + 0.9);
    const over = trunks[trunks.length - 1]!.u - half;
    if (over > 0) for (const t of trunks) t.u -= over;
    if (trunks[0]!.u < -half) trunks.forEach((t, i) => (t.u = trunks.length > 1 ? -half + (i * 2 * half) / (trunks.length - 1) : 0));
    for (const t of trunks) for (const l of t.own) l.u = t.u;
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
        // (A trunk in a gap lands in its middle; trunks sharing one spread evenly across it.)
        for (const gp of gaps.values()) {
          const bys = [...new Set(gp.ls.map((l) => l.by))];
          gp.ls.forEach((l) => (l.u = gp.lo + ((bys.indexOf(l.by) + 1) * (gp.hi - gp.lo)) / (bys.length + 1)));
        }
      }
    }
    for (const l of ls) {
      const p = pending.find((x) => x.edge === l)!;
      p.to = { at: { x: page.pos.x + l.u * c + v * sn, y: 0, z: page.pos.z - l.u * sn + v * c } };
    }
  }
  // Lanes of one trunk crest together (the first's apex), so they run as one.
  const crest = new Map<string, number>();
  for (const p of pending)
    if (p.edge) {
      const k = `${p.edge.by}>${p.edge.seat}`;
      if (!crest.has(k)) crest.set(k, p.spec.apex);
    }
  for (const p of pending) if (p.to) out.push({ ...p.spec, ...(p.edge ? { apex: crest.get(`${p.edge.by}>${p.edge.seat}`)! } : {}), to: p.to });
  return out;
}

