import type { SeatBoard } from "../board";
import type { CombatPairs } from "../combat";
import type { Projector } from "../projector";
import type { InkSlot, SeatPlan } from "../seat";
import type { Quad, Shape } from "../shape";
import type { CardId, Point, SeatId, V3 } from "../types";
import { designUnit } from "../types";
import { blockNotes, slipsOf } from "./answers";
import type { Ask } from "./answers";
import { INK_PX, LETTER_EM, ROW } from "./ink";

// The answers placed on the table at rest. Each page's answer is its heading: one red line in the place kept for it under
// its plaque (`Fixtures.heading`), the same spot on every page, which nothing stands over and the fight never takes. A note
// lies at the foot of an attacker none of mine can block. Both lie flat, foreshortened with the table, lettered tall as
// the accounts are. (Where an attack lands is said on the defender's plaque, beside its life: `TablePlan.landings`.)

export type InkKind = "heading" | "note";

export interface InkAtRest {
  /** "heading:<seat>", "note:<attacker>". */
  readonly id: string;
  readonly kind: InkKind;
  readonly seat: SeatId | null;
  readonly lines: readonly string[];
  /** The cards it speaks of. */
  readonly ids: readonly CardId[];
  /** Its middle on the table, its yaw, its size (world), an em in world depth and the letters' stretch. */
  readonly pos: V3;
  readonly yaw: number;
  readonly w: number;
  readonly d: number;
  readonly em: number;
  readonly stretch: number;
  /** Its words lie left (a heading, as the account's lines do) or centred (a note). */
  readonly align: "left" | "centre";
  /** On screen at rest, for the audit. */
  readonly shape: Shape;
}

interface Frame {
  readonly across: V3;
  readonly back: V3;
}
const frameOf = (yaw: number): Frame => ({ across: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }, back: { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) } });
const at = (p: V3, f: Frame, a: number, b: number): V3 => ({ x: p.x + f.across.x * a + f.back.x * b, y: p.y, z: p.z + f.across.z * a + f.back.z * b });

/** Design px on screen per world unit at `p`, across and into the depth, for a frame. */
function pxPer(proj: Projector, p: V3, f: Frame): { across: number; deep: number } {
  const u = designUnit(proj.viewport), q = proj.project(p), x = proj.project(at(p, f, 0.25, 0)), y = proj.project(at(p, f, 0, 0.25));
  return { across: Math.hypot(x.x - q.x, x.y - q.y) / 0.25 / u, deep: Math.hypot(y.x - q.x, y.y - q.y) / 0.25 / u };
}

/** Ink of `lines` in a w x d block with its middle at `pos`: its place on screen for the audit (its words are all of it). */
function placed(proj: Projector, id: string, kind: InkKind, seat: SeatId | null, lines: readonly string[], ids: readonly CardId[], slot: InkSlot, px: number, align: InkAtRest["align"]): InkAtRest {
  const f = frameOf(slot.yaw), pos = slot.pos;
  const corner = (a: number, b: number): Point => proj.project(at(pos, f, a * slot.w, b * slot.d));
  const face: Quad = [corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5)];
  const shape: Shape = { group: id, kind: "unit", seat, face, name: face, foot: face, order: pos.z - 0.5, floor: 0, width: 0, members: ids, text: { px, floor: px } };
  return { id, kind, seat, lines, ids, pos: { ...pos, y: 0.004 }, yaw: slot.yaw, w: slot.w, d: slot.d, em: slot.em, stretch: slot.stretch, align, shape };
}

/** As many of an answer's clauses, in their order, as one line of the slot holds (the first always). */
export function fitClauses(lines: readonly string[], slot: InkSlot): string {
  // (A line of clauses packs a little closer than the account's measure: "·" and spaces run narrow.)
  const room = Math.floor((slot.w * slot.stretch) / (LETTER_EM * 0.92 * slot.em));
  const clauses = lines.join(" · ").split(" · ");
  let line = clauses[0] ?? "";
  for (const c of clauses.slice(1)) {
    if (`${line} · ${c}`.length > room) break;
    line = `${line} · ${c}`;
  }
  return line;
}

export interface AnswersInput {
  readonly ask: Ask | null;
  readonly combat: CombatPairs | null;
  readonly boards: readonly SeatBoard[];
  readonly plans: readonly SeatPlan[];
  readonly perspective: SeatId;
  readonly projector: Projector;
}

/** Every answer the moment puts on the table, placed. */
export function answersAtRest(o: AnswersInput): InkAtRest[] {
  const out: InkAtRest[] = [];
  const planOf = new Map(o.plans.map((p) => [p.seat, p]));
  for (const s of slipsOf(o.boards, o.ask, o.combat, o.perspective)) {
    const slot = planOf.get(s.seat)?.fixtures.heading;
    if (slot) out.push(placed(o.projector, `heading:${s.seat}`, "heading", s.seat, [fitClauses(s.lines, slot)], s.ids, slot, INK_PX.slip, "left"));
  }
  if (o.ask?.kind === "block" && o.combat) {
    const blocked = new Set(o.combat.blocks.map((b) => b.attacker));
    const unitOf = new Map<CardId, { pos: V3 }>();
    for (const p of o.plans) for (const u of p.units) if (u.fighting) for (const id of u.members) unitOf.set(id, { pos: u.placement.pos });
    for (const n of blockNotes(o.boards, o.combat, o.ask.pairs)) {
      const u = unitOf.get(n.attacker);
      if (!u || blocked.has(n.attacker)) continue;
      // Just in front of its foot, as wide as its words.
      const f = frameOf(0), p0 = { ...u.pos, z: u.pos.z + 0.12 }, k = pxPer(o.projector, p0, f);
      const em = INK_PX.slip / k.deep, stretch = k.across / k.deep, d = ROW.line * em, w = ((n.text.length * LETTER_EM + 0.6) * em) / stretch;
      out.push(placed(o.projector, `note:${n.attacker}`, "note", null, [n.text], [n.attacker], { pos: at(p0, f, 0, -d / 2), w, d, yaw: 0, em, stretch }, INK_PX.slip, "centre"));
    }
  }
  return out;
}
