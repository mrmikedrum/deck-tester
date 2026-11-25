import type { SeatBoard } from "../board";
import { combatLanes } from "../combat";
import type { CombatPairs } from "../combat";
import type { Projector } from "../projector";
import type { SeatPlan } from "../seat";
import { audit } from "../shape";
import type { Quad, Shape } from "../shape";
import type { CardId, Point, SeatId, V3 } from "../types";
import { designUnit } from "../types";
import { TAP_PX } from "../board";
import { blockNotes, landings, slipsOf } from "./answers";
import type { Ask } from "./answers";
import { INK_PX, LETTER_EM, ROW } from "./ink";

// The answers placed on the table at rest: each slip out from under the front edge of the page it speaks of, lying on
// the table; the landing numeral where the attack's lanes end on the defender's edge; a note at the foot of an attacker
// no blocker of mine can stop. All lie flat, foreshortened with the table, lettered tall as the accounts are.

export type InkKind = "slip" | "landing" | "note";

export interface InkAtRest {
  /** "slip:<seat>", "landing:<seat>", "note:<attacker>". */
  readonly id: string;
  readonly kind: InkKind;
  readonly seat: SeatId | null;
  readonly lines: readonly string[];
  /** The cards it speaks of: a tap on a slip opens them. */
  readonly ids: readonly CardId[];
  /** Its middle on the table, its yaw, its size (world), an em in world depth and the letters' stretch. */
  readonly pos: V3;
  readonly yaw: number;
  readonly w: number;
  readonly d: number;
  readonly em: number;
  readonly stretch: number;
  /** On screen at rest, for the audit and a slip's hit group. */
  readonly shape: Shape;
}

/** How far a slip tucks under its page's front edge (world): over the page's margin, short of the front row's feet. */
const TUCK = 0.45;
/** A slip's margin round its words, in ems. */
const PAD = { x: 0.7, y: 0.45 } as const;

interface Frame {
  readonly across: V3;
  readonly back: V3;
}
const frameOf = (yaw: number): Frame => ({ across: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }, back: { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) } });
const at = (p: V3, f: Frame, a: number, b: number): V3 => ({ x: p.x + f.across.x * a + f.back.x * b, y: p.y, z: p.z + f.across.z * a + f.back.z * b });

/** Design px per world unit at `p`, across and into the depth, for a frame. */
function pxPer(proj: Projector, p: V3, f: Frame): { across: number; deep: number } {
  const u = designUnit(proj.viewport), q = proj.project(p), x = proj.project(at(p, f, 0.25, 0)), y = proj.project(at(p, f, 0, 0.25));
  return { across: Math.hypot(x.x - q.x, x.y - q.y) / 0.25 / u, deep: Math.hypot(y.x - q.x, y.y - q.y) / 0.25 / u };
}

/** An ink block lettered at `px` (its em on screen), its near edge's middle at `near` (or its middle, `centred`). */
function block(proj: Projector, id: string, kind: InkKind, seat: SeatId | null, lines: readonly string[], ids: readonly CardId[], p0: V3, yaw: number, px: number, pad: boolean, centred = false, tall = false): InkAtRest {
  const f = frameOf(yaw), k = pxPer(proj, p0, f);
  const em = px / k.deep, stretch = k.across / k.deep;
  const chars = Math.max(...lines.map((l) => l.length));
  const w = (chars * LETTER_EM * em) / stretch + (pad ? 2 * PAD.x * em : 0);
  // A slip is tapped to open its cards: at least a finger's patch deep on screen.
  const d = Math.max(lines.length * ROW.line * em + (pad ? 2 * PAD.y * em : 0), tall ? (TAP_PX + 2) / designUnit(proj.viewport) / k.deep : 0);
  const pos = centred ? p0 : at(p0, f, 0, -d / 2);
  const corner = (a: number, b: number): Point => proj.project(at(pos, f, a * w, b * d));
  const words = lines.length * ROW.line * em, t0 = Math.max(0, (d - words) / 2 / d), t1 = 1 - t0;
  const win = (b0: number, b1: number): Quad => [corner(-0.5, b0 - 0.5), corner(0.5, b0 - 0.5), corner(0.5, b1 - 0.5), corner(-0.5, b1 - 0.5)];
  const shape: Shape = {
    group: id,
    kind: "unit",
    seat,
    face: win(0, 1),
    // Its words' band (a slip's paper margin may lie under a card; its words may not): the first and last sixth of it.
    name: win(t1 - (t1 - t0) / 6, t1),
    foot: win(t0, t0 + (t1 - t0) / 6),
    // (It lies on the table: drawn under whatever stands at its depth.)
    order: pos.z - 0.5,
    floor: 0,
    width: 0,
    members: ids,
    text: { px, floor: px },
  };
  return { id, kind, seat, lines, ids, pos: { ...pos, y: 0.004 }, yaw, w, d, em, stretch, shape };
}

export interface AnswersInput {
  readonly ask: Ask | null;
  readonly combat: CombatPairs | null;
  readonly boards: readonly SeatBoard[];
  readonly plans: readonly SeatPlan[];
  readonly perspective: SeatId;
  readonly projector: Projector;
  /** What stands on the table at rest: a slip is a finger's patch deep only where that covers nothing and nothing covers
   *  it; otherwise it is as deep as its words (and no shortcut to its cards). */
  readonly shapes: readonly Shape[];
}

/** Every answer the moment puts on the table, placed. */
export function answersAtRest(o: AnswersInput): InkAtRest[] {
  const out: InkAtRest[] = [];
  const planOf = new Map(o.plans.map((p) => [p.seat, p]));
  for (const s of slipsOf(o.boards, o.ask, o.combat, o.perspective)) {
    const page = planOf.get(s.seat)?.fixtures.page;
    if (!page) continue;
    // The page's front edge, toward me, at its middle; the slip comes out from under it.
    // A side page's slip slides along its edge toward the table's middle, where its turned edge stands highest.
    const f = frameOf(page.yaw), side = Math.sign(-page.pos.x) * (Math.abs(page.pos.x) > 1 ? 1 : 0);
    const make = (tall: boolean, lines: readonly string[]): InkAtRest => {
      // (It lies square to the table, as a slip dropped on it would: its words level, tucked under the turned edge.)
      const probe = block(o.projector, `slip:${s.seat}`, "slip", s.seat, lines, s.ids, at(page.pos, f, 0, -page.d / 2 + TUCK), 0, INK_PX.slip, true, false, tall);
      const slide = side * Math.max(0, page.w / 2 - probe.w / 2 - 0.5);
      return slide ? block(o.projector, `slip:${s.seat}`, "slip", s.seat, lines, s.ids, at(page.pos, f, slide, -page.d / 2 + TUCK), 0, INK_PX.slip, true, false, tall) : probe;
    };
    const clear = (x: InkAtRest, any = false): boolean => !audit([...o.shapes, x.shape], o.projector.viewport, { only: (y) => y === x.shape }).some((v) => any || v.rule !== "tap-patch");
    // Tall enough to tap where that is clear; else as deep as its words, on one line or, narrower, two clauses a line.
    const clauses = s.lines.join(" · ").split(" · ");
    const narrow = clauses.length > 2 ? [clauses.slice(0, 2).join(" · "), clauses.slice(2).join(" · ")] : s.lines;
    const tries = [make(true, s.lines), make(false, s.lines), make(false, narrow)];
    out.push(tries.find((x, i) => clear(x, i > 0)) ?? tries[1]!);
  }
  if (o.combat?.attacks.length) {
    const lanes = combatLanes(planOf, o.perspective, o.combat);
    for (const l of landings(o.boards, o.combat)) {
      const ends = lanes.filter((x) => x.defending === l.seat && "at" in x.to).map((x) => (x.to as { at: V3 }).at);
      if (!ends.length) continue;
      const c = { x: ends.reduce((t, e) => t + e.x, 0) / ends.length, y: 0, z: ends.reduce((t, e) => t + e.z, 0) / ends.length };
      // Just short of the edge the lanes land on, toward the middle they come from, the numeral at the tally's size.
      out.push(block(o.projector, `landing:${l.seat}`, "landing", l.seat, [l.text], l.ids, { ...c, z: c.z + (l.seat === o.perspective ? -0.75 : 0.6) }, 0, INK_PX.tally, false, true));
    }
  }
  if (o.ask?.kind === "block" && o.combat) {
    const blocked = new Set(o.combat.blocks.map((b) => b.attacker));
    const unitOf = new Map<CardId, { pos: V3; scale: number }>();
    for (const p of o.plans) for (const u of p.units) if (u.fighting) for (const id of u.members) unitOf.set(id, { pos: u.placement.pos, scale: u.placement.scale });
    for (const n of blockNotes(o.boards, o.combat, o.ask.pairs)) {
      const u = unitOf.get(n.attacker);
      if (!u || blocked.has(n.attacker)) continue;
      out.push(block(o.projector, `note:${n.attacker}`, "note", null, [n.text], [n.attacker], { ...u.pos, z: u.pos.z + 0.12 }, 0, INK_PX.slip, false));
    }
  }
  return out;
}
