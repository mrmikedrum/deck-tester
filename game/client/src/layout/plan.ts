import { FLOOR, TAP_PX } from "./board";
import type { SeatBoard } from "./board";
import { pinhole } from "./projector";
import type { Projector } from "./projector";
import { reservations } from "./reservations";
import type { ChromeMode, Reservations } from "./reservations";
import type { LayoutMemory, SeatInput, SeatLayout, SeatPlan, Summary, Unit } from "./seat";
import { Ledger } from "./ledger";
import { mat } from "./seat/mat";
import { combatRow, fighters, rowUnits } from "./combat";
import type { CombatPairs } from "./combat";
import { CH, CW, EDGE, clearOfHand, floorScale, makeGeo } from "./seat/geometry";
import { audit, bounds, depthOrder, inQuad, seatShapes, stackShape } from "./shape";
import type { Quad, Shape, TapArea, Violation } from "./shape";
import { tableTemplate } from "./template";
import type { TableTemplate } from "./template";
import type { CardId, Insets, Point, Rect, SeatId, V3, Viewport } from "./types";
import { designUnit } from "./types";

// Planning a seat with the hard-limit audit and a fold-harder retry, and planning the table: four seats, plates, the
// stack at rest, and what a tap can reach.

const MAX_PRESSURE = 6;

export interface PlanSeatOptions {
  readonly maxPressure?: number;
  /** Start folding at this notch (the table raises it where seats collide). */
  readonly minPressure?: number;
  /** Cards in a fight: their units go to the combat row, so the seat is audited without them (the table audits them). */
  readonly fighting?: ReadonlySet<CardId>;
}

const mineOf = (input: Omit<SeatInput, "pressure">): boolean => input.board.mine;

/** Where a tap can land under these reservations: the safe area, less the chrome that is up. */
function tapArea(reserve: Reservations): TapArea {
  return { safe: reserve.safe, chrome: reserve.items.filter((i) => i.visible).map((i) => i.rect) };
}

/**
 * Violations of the floors and tappable patches (and covers among this seat's own things) of a seat plan. Units that
 * fight (`fighting`: their cards) stand in the combat row, not here: they are left out.
 */
export function auditSeat(plan: SeatPlan, input: Omit<SeatInput, "pressure">, fighting?: ReadonlySet<CardId>): Violation[] {
  const off = fighting ? rowUnits([plan], fighting) : null;
  const shown = off?.size ? { ...plan, units: plan.units.filter((u) => !off.has(u.id)) } : plan;
  return audit(seatShapes(input.projector, shown, mineOf(input)), input.viewport, { area: tapArea(input.reserve) });
}

export function planSeat(layout: SeatLayout, input: Omit<SeatInput, "pressure">, opts: PlanSeatOptions = {}): SeatPlan {
  const max = opts.maxPressure ?? MAX_PRESSURE;
  let best: { plan: SeatPlan; n: number } | null = null;
  for (let k = opts.minPressure ?? 0; k <= max; k++) {
    const plan = layout.plan({ ...input, pressure: k });
    const n = auditSeat(plan, input, opts.fighting).length;
    if (n === 0) return plan;
    if (!best || n < best.n) best = { plan, n };
  }
  // Asked to start past the last notch: no fold is left to try, so the last resort, from the plan at the last notch.
  return lastResort(input, best ? best.plan : layout.plan({ ...input, pressure: max }), opts.fighting);
}

/** Every permanent of a seat in ONE summary pile at its fixed edge: always reachable, always at its floors. */
export function summarize(board: SeatBoard, ids: readonly CardId[]): Summary {
  const by = new Map(board.cards.map((c) => [c.id, c]));
  const cs = ids.map((id) => by.get(id)).filter((c) => !!c);
  const kw = new Map<string, number>();
  cs.forEach((c) => c.keywords.forEach((k) => kw.set(k, (kw.get(k) ?? 0) + 1)));
  const big = cs
    .filter((c) => c.creature)
    .sort((a, b) => (b.power ?? 0) - (a.power ?? 0) || (b.toughness ?? 0) - (a.toughness ?? 0) || a.id - b.id)[0];
  return {
    count: cs.length,
    totalPower: cs.reduce((t, c) => t + (c.creature ? (c.power ?? 0) : 0), 0),
    tapped: cs.filter((c) => c.tapped).length,
    keywords: [...kw.entries()].map(([keyword, count]) => ({ keyword, count })).sort((a, b) => b.count - a.count || (a.keyword < b.keyword ? -1 : 1)),
    biggest: big ? big.id : null,
  };
}

function lastResort(input: Omit<SeatInput, "pressure">, from: SeatPlan, fighting?: ReadonlySet<CardId>): SeatPlan {
  const { board, region: r, projector, reserve } = input;
  const me = r.position === "near", g = makeGeo(projector, reserve, FLOOR.any);
  // A creature in a fight never folds (a pile never attacks or blocks): it keeps its own unit, for the combat row.
  const off = fighting ? rowUnits([from], fighting) : null;
  const fights = off?.size ? from.units.filter((u) => off.has(u.id)) : [];
  const away = new Set(fights.flatMap((u) => [...u.members, ...u.dressing]));
  const attached = new Set(board.cards.filter((c) => c.attachedTo !== null && board.cards.some((h) => h.id === c.attachedTo)).map((c) => c.id));
  const members = board.cards.filter((c) => !attached.has(c.id) && !away.has(c.id)).map((c) => c.id);
  const dressing = board.cards.filter((c) => attached.has(c.id) && !away.has(c.id)).map((c) => c.id);
  // Where: mine, just above the hand; theirs, at the front edge. As large as a tappable 56 px asks.
  const a = me ? clearOfHand(g, r) + 0.6 : EDGE + 0.2;
  const pos = g.toWorld(r, 0, r.d / 2 - a);
  const scale = Math.max(1.2, floorScale(g, pos, 56, false, 1.2));
  const top = members[0]!;
  const unit: Unit = {
    id: `all:${board.seat}`,
    role: "support",
    kind: "summary",
    members,
    dressing,
    top,
    title: `All ${members.length}`,
    mixed: true,
    acting: false,
    tapped: false,
    placement: { pos, scale, posture: me ? "lean" : "prop" },
  };
  const plan = new Ledger(board.cards.map((c) => c.id)).seal({
    seat: board.seat,
    units: [...(members.length ? [unit] : []), ...fights],
    fixtures: from.fixtures,
    memory: from.memory,
    report: { ...from.report, lastResort: true, folded: Math.max(0, members.length - 1) },
  });
  return plan;
}

// ---- the table ------------------------------------------------------------------------------------------------------

export interface StackEntry {
  readonly key: string;
  readonly card: CardId;
  /** An activated or triggered ability, drawn smaller than a spell. */
  readonly ability: boolean;
  /** It answers a spell under it: the stack steps wider so what it aims at is never under it. */
  readonly answers: boolean;
  /** The cards and seats it aims at: the stack as the table's focus stands clear of them. */
  readonly targets?: readonly CardId[];
  readonly seats?: readonly SeatId[];
  /** Whose it is: the spells under the top lean toward their own seat when they aim at nothing on the table. */
  readonly controller?: SeatId | null;
}

export interface StackAtRest {
  readonly key: string;
  readonly card: CardId;
  readonly quad: Quad;
  /** It has a hit group: wholly in the safe area, with a tappable patch of its own. Otherwise a sheet offers it. */
  readonly reachable: boolean;
}

export interface TableInput {
  readonly viewport: Viewport;
  /** The safe-area insets, CSS px (none if absent): the reservations take them in, and a tap reaches only inside them. */
  readonly safe?: Insets;
  readonly mode: ChromeMode;
  /** The perspective first, then clockwise: near, left, across, right. */
  readonly seats: readonly { readonly seat: SeatId; readonly board: SeatBoard }[];
  readonly involved: ReadonlySet<CardId>;
  readonly settling: boolean;
  readonly memory: ReadonlyMap<SeatId, LayoutMemory> | null;
  /** Bottom first, as the model's stack: the last entry is the top. */
  readonly stack: readonly StackEntry[];
  readonly template?: TableTemplate;
  readonly layout?: SeatLayout;
  /** Attacks and blocks (the engine's, or a draft over them): the fighters stand in the combat row in the open middle. */
  readonly combat?: CombatPairs | null;
}

export type GroupKind = "card" | "pile" | "well" | "summary" | "plate" | "zone" | "stack";

export interface HitGroup {
  /** Stable for as long as the group lasts: unit id (kind letter and first card), "plate:<seat>", "command:<seat>", "zone:<zone>:<seat>", "stack:<key>". */
  readonly id: string;
  readonly kind: GroupKind;
  readonly seat: SeatId | null;
  /** In order, the card shown first. Empty for a plate. */
  readonly members: readonly CardId[];
  /** Its face on screen at rest, CSS px: what is drawn, and what a tap reaches. */
  readonly quad: Quad;
  /** Draw order among the table's groups: larger is drawn over smaller (plates and the stack are hit first anyway). */
  readonly order: number;
}

export interface HitGroups {
  /** Changes when any group appears, goes, or its members or their order change; not when things merely move. */
  readonly rev: number;
  readonly groups: readonly HitGroup[];
}

export interface TablePlan {
  /** Changes when placement or membership changes. */
  readonly rev: number;
  readonly viewport: Viewport;
  readonly projector: Projector;
  readonly reserve: Reservations;
  readonly seats: ReadonlyMap<SeatId, SeatPlan>;
  readonly memory: ReadonlyMap<SeatId, LayoutMemory>;
  readonly hits: HitGroups;
  /**
   * The stack's cards at rest, top first (the reverse of `TableInput.stack`), set aside in the open middle. One not
   * wholly in the safe area (a tall stack runs off it), or without a tappable patch of its own, is not `reachable`: it
   * has no hit group, so a choice of it is made in a sheet, and it is reported as a violation ("off-screen", or the
   * limit it breaks).
   */
  readonly stack: readonly StackAtRest[];
  /**
   * The same stack as the table's focus (the stack layer up), top first: the top spell large in the open middle, the
   * rest beside it a size smaller, clear of what they aim at and of the plaques (old h.js `buildStack`, `big`). It covers
   * and dims the rest of the table, so it is not audited; `reachable` is whether it is wholly on the safe area.
   */
  readonly stackUp: readonly StackAtRest[];
  /** Limits still broken after every retry (a last-resort seat that still breaks one, or a stack card not reachable). */
  readonly violations: readonly Violation[];
  /** The combat it stood in the open middle (`Unit.fighting`), or null. */
  readonly combat: CombatPairs | null;
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function planTable(input: TableInput): TablePlan {
  const tpl = input.template ?? tableTemplate(input.seats.length);
  const layout = input.layout ?? mat;
  const vp = input.viewport, projector = pinhole(tpl.camera, vp), reserve = reservations(vp, input.mode, input.safe);
  const mk = (i: number): Omit<SeatInput, "pressure"> => {
    const { seat, board } = input.seats[i]!, slot = tpl.slots[i]!;
    return { seat, board, region: { ...slot, lift: 0 }, projector, reserve, viewport: vp, involved: input.involved, settling: input.settling, memory: input.memory?.get(seat) ?? null };
  };
  const inputs = input.seats.map((_, i) => mk(i));
  const combat = input.combat ?? null, fight = fighters(combat);
  const plans: SeatPlan[] = inputs.map((i) => planSeat(layout, i, { fighting: fight }));
  const floor = inputs.map(() => 0);
  const area = tapArea(reserve);
  const geo = makeGeo(projector, reserve, FLOOR.mine);
  // The composed table, as the scene draws it: every seat (cards acting where they stand), the stack set aside in the
  // open middle the pages leave (so it moves when they do), and the fight in the open middle's foot, clear of both. A
  // stack card off the safe area is drawn but not audited.
  const compose = () => {
    const stack = stackAtRest(input, tpl, projector, plans, reserve.safe);
    const row = rowUnits(plans, fight);
    const staying = [...plans.flatMap((p, i) => seatShapes(projector, p, inputs[i]!.board.mine).filter((x) => !row.has(x.group))), ...stack.map((s) => s.shape)];
    const options = combat && row.size
      ? combatRow({ combat, plans, perspective: input.seats[0]!.seat, projector, geo, middle: openMiddle(tpl, projector, plans, geo.u), obstacles: staying })
      : [plans];
    const only = (x: Shape): boolean => x.kind !== "stack" || stack.some((s) => s.shape === x && s.onScreen && !s.spilled);
    let best: { shapes: Shape[]; v: Violation[]; placed: SeatPlan[] } | null = null;
    for (const placed of options) {
      const shapes = [...placed.flatMap((p, i) => seatShapes(projector, p, inputs[i]!.board.mine)), ...stack.map((s) => s.shape)];
      const v = audit(shapes, vp, { area, only });
      if (!best || v.length < best.v.length) best = { shapes, v, placed };
      if (!v.length) break;
    }
    return { stack, row, ...best! };
  };
  // Where seats collide, or the stack covers a seat's cards, fold the offending seats harder; down to the last resort,
  // which cannot collide with a neighbour more than a single card does.
  let c = compose();
  for (let round = 0; c.v.length && round < MAX_PRESSURE; round++) {
    // (A fighter's own trouble in the row is not its seat's: folding the seat would not move it.)
    const bad = new Set(c.v.filter((x) => !c.row.has(x.group)).map((x) => x.seat));
    // (A layout other than mat stands things that may reach over a neighbour, battle lines' files: the seat drawn over
    // the card folds too.)
    if (layout !== mat) for (const x of c.v) if (!c.row.has(x.group)) for (const s of x.by ?? []) if (s !== null && s !== x.seat) bad.add(s);
    let moved = false;
    plans.forEach((p, i) => {
      if (!bad.has(p.seat) || p.report.lastResort) return;
      floor[i] = Math.max(floor[i]!, p.report.pressure) + 1;
      // A seat already at the last notch (it passed its own audit there) has nothing harder to fold to but its last resort.
      plans[i] = floor[i]! > MAX_PRESSURE ? lastResort(inputs[i]!, p, fight) : planSeat(layout, inputs[i]!, { minPressure: floor[i]!, fighting: fight });
      moved = true;
    });
    if (!moved) break;
    c = compose();
  }
  const final = c.placed;
  const seats = new Map(final.map((p) => [p.seat, p]));
  const shapes = c.shapes;
  let v = c.v;
  // A stack card the middle has no room for, one off the safe area, or one the audit finds without a patch of its own,
  // has no hit group: a sheet offers it.
  const broken = new Set(v.filter((x) => x.rule === "tap-patch").map((x) => x.group));
  const stack: StackAtRest[] = c.stack.map((s) => ({ key: s.key, card: s.card, quad: s.shape.face, reachable: s.onScreen && !s.spilled && !broken.has(s.shape.group) }));
  for (const s of c.stack)
    if (s.spilled) v = [...v, { rule: "no-room", group: s.shape.group, seat: null, measured: 0, limit: 1 }];
    else if (!s.onScreen) v = [...v, { rule: "off-screen", group: s.shape.group, seat: null, measured: 0, limit: 1 }];
  const hits = hitGroups(final, shapes, stack);
  const stackUp = stackFocus(input, tpl, projector, final, shapes, reserve, reserve.safe);
  const memory = new Map(final.map((p) => [p.seat, p.memory]));
  const placement = final.map((p) => [p.seat, p.units.map((u) => [u.id, u.placement.pos.x.toFixed(4), u.placement.pos.z.toFixed(4), u.placement.scale.toFixed(4)].join(",")).join(";"), p.fixtures.page.w.toFixed(3), p.fixtures.page.d.toFixed(3)].join("|")).join("\n");
  const screen = hits.groups.map((g) => g.quad.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ")).join(";");
  return { rev: fnv(`${placement}\n${hits.rev}\n${screen}`), viewport: vp, projector, reserve, seats, memory, hits, stack, stackUp, violations: v, combat };
}

/** The scene stands stack card i at rest this high over the table, on the ray through its quad's middle
 *  (scene/stage/poses.ts `stackPose`): its depth, so its draw order, follows. */
export const STACK_POSE = { raise: 1.6, step: 0.25, up: 3 } as const;

interface StackCard {
  readonly key: string;
  readonly card: CardId;
  readonly shape: Shape;
  /** Wholly in the safe area. */
  readonly onScreen: boolean;
  /** The open middle had no room for it: it lies under the last card that fitted. */
  readonly spilled: boolean;
}

// The stack set aside, as the old buildStack stands it when it is not the focus: the top spell at the left of the open
// middle, raised off the table, a size smaller than that space allows, each under it a step to the right and back, a
// size smaller; never under the floor or the 44 px a tap needs, wherever it stands (one far back is smaller on screen),
// never over the one before it, and never out of the open middle: a step back that would lift it into the page across
// is cut short, and what has no room left at the right lies under the last card that fitted, offered in a sheet (the
// top always stands). The input is bottom first; what comes out is top first, so the top is drawn nearest. The stack
// as the table's focus is `stackFocus`, below; the combat row stands clear of the stack at rest (combat.ts).
function stackAtRest(input: TableInput, tpl: TableTemplate, proj: Projector, plans: readonly SeatPlan[], safe: Rect): StackCard[] {
  const items = [...input.stack].reverse();
  if (!items.length) return [];
  const u = designUnit(input.viewport);
  const M = openMiddle(tpl, proj, plans, u);
  const step = items.some((s) => s.answers) ? 1.12 : 0.9;
  const fitW = (M.r - M.l - 16) / (CW * (step * items.length + 0.1));
  const mid = Math.max((FLOOR.any * 1.1) / CW, Math.min(240, M.b - M.t, fitW));
  const hPx = Math.max((FLOOR.any * 1.1) / CW, mid * 0.75), cy = (M.t + M.b) / 2, x0 = M.l + 16 + (hPx * CW) / 2, raise = STACK_POSE.raise;
  const at0 = proj.onTable(x0 * u, cy * u, raise);
  const along = (p: V3, d: V3, t: number): V3 => ({ x: p.x + d.x * t, y: p.y + d.y * t, z: p.z + d.z * t });
  const per = Math.abs(proj.project(along(at0, proj.up, 0.5)).y - proj.project(along(at0, proj.up, -0.5)).y) / u;
  const sc0 = hPx / per;
  // The face width each card needs on screen, CSS px: its floor and a finger's patch, with room for the 4 px grid.
  const need = Math.max(FLOOR.any * u, TAP_PX) * 1.12;
  const wide = (c: V3): number => Math.abs(proj.project(along(c, proj.right, 0.5)).x - proj.project(along(c, proj.right, -0.5)).x);
  // Card i stands `off` to the right of the top, and back and up by its share `rise` of its full step (i back, i up).
  const centre = (off: number, i: number, rise: number): V3 => along(along({ ...at0, z: at0.z - 0.5 * i * rise }, proj.right, off), proj.up, i * 0.1 * sc0 * rise);
  const quadOf = (c: V3, sc: number): Quad => {
    const pt = (a: number, b: number): Point => proj.project(along(along(c, proj.right, a * sc), proj.up, b * sc));
    return [pt(-CW / 2, -CH / 2), pt(CW / 2, -CH / 2), pt(CW / 2, CH / 2), pt(-CW / 2, CH / 2)];
  };
  const top = Math.max(M.t * u, safe.top), right = Math.min(M.r * u, safe.right), foot = Math.min(M.b * u, safe.bottom);
  let prev: { off: number; sc: number; quad: Quad } | null = null, spill = false;
  return items.map((s, i) => {
    const card = (quad: Quad, spilled: boolean): StackCard => {
      const b = bounds(quad), m = proj.onTable((b.l + b.r) / 2, (b.t + b.b) / 2, STACK_POSE.raise - STACK_POSE.step * i);
      const onScreen = b.l >= safe.left && b.t >= safe.top && b.r <= safe.right && b.b <= safe.bottom;
      return { key: s.key, card: s.card, shape: stackShape(`stack:${s.key}`, quad, depthOrder(proj, m), [s.card]), onScreen, spilled };
    };
    if (spill && prev) return card(prev.quad, true);
    const want = sc0 * (i === 0 ? 1 : 0.8) * (s.ability ? 0.72 : 1);
    let off = 0, sc = want;
    // Its size depends on how far back it stands, and where it stands on its size: two rounds settle it.
    for (let k = 0; k < 3; k++) {
      if (prev) off = prev.off + Math.max(step * CW * sc0, (CW * (prev.sc + sc)) / 2);
      sc = Math.max(want, need / (CW * wide(centre(off, i, 1))));
    }
    let rise = 1;
    if (bounds(quadOf(centre(off, i, 1), sc)).t < top) {
      let lo = 0, hi = 1;
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) / 2;
        if (bounds(quadOf(centre(off, i, m), sc)).t < top) hi = m;
        else lo = m;
      }
      rise = lo;
    }
    const quad = quadOf(centre(off, i, rise), sc), b = bounds(quad);
    if (prev && (b.r > right || b.b > foot)) {
      spill = true;
      return card(prev.quad, true);
    }
    prev = { off, sc, quad };
    return card(quad, false);
  });
}

/** A box on screen, design units. */
interface Box {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}
const boxOf = (q: Quad, u: number): Box => {
  const b = bounds(q);
  return { l: b.l / u, r: b.r / u, t: b.t / u, b: b.b / u };
};
const meets = (a: Box, b: Box): boolean => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/** The stack as the focus: its card's height as a share of the screen's, and never under this (design px), about life
 * size so its rules read. Shingled, each card under the top shows this share of its width. */
export const STACK_FOCUS = { share: 0.52, floor: 360, shingle: 0.3, top: 46, margin: 8, clear: 10 } as const;

/**
 * The stack as the table's focus: the printed card held up large (0.52 of the screen's height, never under 360), centred
 * between the hand's right edge and the prompt's left edge with its middle at 46% of the height. It may cover pages and
 * cards it does not involve, never a target, a plaque it targets, the prompt or the hand: where one is in the way it
 * moves first (centre, right, left, up) and shrinks only after, to its floor. Several items stand in a row while all
 * fit at the floor or more; past that the top stands at full size and the ones under it shingle to the side they step
 * toward (what they aim at, else whose they are), each showing a strip. Where nothing at the floor is clear (a crowded
 * table), it stands centred in the open middle as large as that gap holds clear of what it touches. Top first, each
 * square to the camera at the focus height.
 */
function stackFocus(input: TableInput, tpl: TableTemplate, proj: Projector, plans: readonly SeatPlan[], shapes: readonly Shape[], reserve: Reservations, safe: Rect): StackAtRest[] {
  const items = [...input.stack].reverse();
  if (!items.length) return [];
  const u = designUnit(input.viewport), n = items.length;
  const vw = input.viewport.w / u, vh = input.viewport.h / u;
  const step = items.some((s) => s.answers) ? 1.12 : 0.9;
  // What it points at, where the board stands (a card's face, a plaque), with a margin; the chrome it keeps off.
  const unitOf = new Map<CardId, Shape>();
  for (const p of plans) for (const un of p.units) for (const id of [...un.members, ...un.dressing]) {
    const sh = shapes.find((x) => x.group === un.id);
    if (sh) unitOf.set(id, sh);
  }
  const plateOf = (seat: SeatId): Shape | undefined => shapes.find((x) => x.group === `plate:${seat}`);
  const aimed: Box[] = [], seen = new Set<string>(), c = STACK_FOCUS.clear;
  for (const s of items)
    for (const sh of [...(s.targets ?? []).map((id) => unitOf.get(id)), ...(s.seats ?? []).map(plateOf)]) {
      if (!sh || seen.has(sh.group)) continue;
      seen.add(sh.group);
      const b = boxOf(sh.face, u);
      aimed.push({ l: b.l - c, r: b.r + c, t: b.t - c, b: b.b + c });
    }
  const chrome = reserve.items.map((i) => ({ l: i.rect.left / u, r: i.rect.right / u, t: i.rect.top / u, b: i.rect.bottom / u }));
  const hand = reserve.items.find((i) => i.kind === "hand")?.rect, prompt = reserve.items.find((i) => i.kind === "prompt")?.rect;
  const xm = ((hand ? hand.right / u : 0) + (prompt ? prompt.left / u : vw)) / 2, ym = vh * 0.46;
  const m = STACK_FOCUS.margin, sl = safe.left / u + m, sr = safe.right / u - m, st = Math.max(safe.top / u, STACK_FOCUS.top), sb = safe.bottom / u - m;
  // The spells under the top step toward what they aim at, else toward whose they are; the top toward whose it is.
  const sx = (sh: Shape | undefined): number | null => (sh ? (bounds(sh.face).l + bounds(sh.face).r) / 2 / u : null);
  const whose = (seat: SeatId | null | undefined): number | null => (seat ? sx(plateOf(seat)) : null);
  const pull = items
    .slice(1)
    .flatMap((s) => {
      const at = (s.targets ?? []).map((id) => sx(unitOf.get(id)));
      return at.some((x) => x !== null) ? at : [whose(s.controller ?? null)];
    })
    .filter((x): x is number => x !== null);
  const own = whose(items[0]!.controller ?? null);
  const dir = pull.length && own !== null && pull.reduce((t, x) => t + x, 0) / pull.length < own ? -1 : 1;
  // A card h tall: its width, and the room under it its tag (or an ability's slip) takes.
  const below = items[0]!.ability ? 92 : 28;
  /** The group's offsets from the top card's middle, per card (in card widths), and its box, for a height. */
  const shape = (h: number, row: boolean) => {
    const w = CW * h, k = (i: number) => (i === 0 ? 1 : row ? 0.8 : 1);
    const at = items.map((_, i) => (row ? i * step : i * STACK_FOCUS.shingle) * dir);
    const ls = at.map((o, i) => (o * w) - (k(i) * w) / 2), rs = at.map((o, i) => o * w + (k(i) * w) / 2);
    return { at, k, l: Math.min(...ls), r: Math.max(...rs), w };
  };
  const boxAt = (h: number, row: boolean, x: number, y: number): Box => {
    const g = shape(h, row), mid = (g.l + g.r) / 2;
    return { l: x - mid + g.l, r: x - mid + g.r, t: y - h / 2, b: y + h / 2 + below };
  };
  const fits = (b: Box): boolean =>
    b.l >= sl && b.r <= sr && b.t >= st && b.b <= sb && !aimed.some((a) => meets(a, b)) && !chrome.some((a) => meets(a, b));
  /** Where a group h tall may stand: the middle, then to the right, the left, then up. */
  const ways = (h: number, row: boolean): [number, number][] => {
    const g = shape(h, row), w = g.r - g.l, out: [number, number][] = [[xm, ym]];
    for (const k of [0.5, 1, 1.5]) out.push([xm + w * k, ym]);
    for (const k of [0.5, 1, 1.5]) out.push([xm - w * k, ym]);
    for (const k of [0.15, 0.3]) out.push([xm, ym - h * k]);
    return out;
  };
  const most = Math.max(STACK_FOCUS.floor, STACK_FOCUS.share * vh);
  let found: { h: number; row: boolean; x: number; y: number } | null = null;
  find: for (const row of n > 1 ? [true, false] : [true])
    for (let h = most; h >= STACK_FOCUS.floor - 0.01; h -= 10)
      for (const [x, y] of ways(h, row))
        if (fits(boxAt(h, row, x, y))) {
          found = { h, row, x, y };
          break find;
        }
  // A crowded table: the open middle, as large as it holds clear of what the stack aims at (the old search's last way).
  if (!found) {
    const M = openMiddle(tpl, proj, plans, u), least = (FLOOR.any * 1.1) / CW;
    let h = Math.min(STACK_FOCUS.floor, M.b - M.t + 12);
    for (; h > least; h -= 4) if (!aimed.some((a) => meets(a, boxAt(h, false, (M.l + M.r) / 2, (M.t + M.b) / 2)))) break;
    found = { h: Math.max(least, h), row: false, x: (M.l + M.r) / 2, y: (M.t + M.b) / 2 };
  }
  const g = shape(found.h, found.row), box = boxAt(found.h, found.row, found.x, found.y);
  const x0 = box.l - g.l, cy = found.y;
  const along = (p: V3, d: V3, t: number): V3 => ({ x: p.x + d.x * t, y: p.y + d.y * t, z: p.z + d.z * t });
  const at0 = proj.onTable(x0 * u, cy * u, STACK_POSE.up);
  const per = Math.abs(proj.project(along(at0, proj.up, 0.5)).y - proj.project(along(at0, proj.up, -0.5)).y) / u;
  const sc0 = found.h / per;
  return items.map((s, i) => {
    const sc = sc0 * g.k(i);
    // Laid out on screen at the top's depth (the scene stands each under it further back along its ray, the same
    // pixels); a smaller one in a row stands on the same foot line.
    const ctr = along(along(at0, proj.right, (g.at[i] ?? 0) * CW * sc0), proj.up, ((sc - sc0) * CH) / 2);
    const pt = (a: number, b: number): Point => proj.project(along(along(ctr, proj.right, a * sc), proj.up, b * sc));
    const quad: Quad = [pt(-CW / 2, -CH / 2), pt(CW / 2, -CH / 2), pt(CW / 2, CH / 2), pt(-CW / 2, CH / 2)];
    const b = bounds(quad);
    return { key: s.key, card: s.card, quad, reachable: b.l >= safe.left && b.t >= safe.top && b.r <= safe.right && b.b <= safe.bottom };
  });
}

/** The open table in the middle, in design units: below the page across, between the side pages, above my creatures' tops. */
function openMiddle(tpl: TableTemplate, proj: Projector, plans: readonly SeatPlan[], u: number): { l: number; r: number; t: number; b: number } {
  const pageBox = (p: SeatPlan) => {
    const f = p.fixtures.page, slot = tpl.slots[plans.indexOf(p)]!;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const lu = a! * (f.w / 2), lv = b! * (f.d / 2);
      return proj.project({ x: f.pos.x + lu * Math.cos(slot.yaw) + lv * Math.sin(slot.yaw), y: 0, z: f.pos.z - lu * Math.sin(slot.yaw) + lv * Math.cos(slot.yaw) });
    });
    return { xs: pts.map((q) => q.x / u), ys: pts.map((q) => q.y / u) };
  };
  const at = (pos: string) => plans.find((_, i) => tpl.slots[i]!.position === pos);
  const across = at("across"), left = at("left"), right = at("right"), near = at("near");
  let t = across ? Math.max(...pageBox(across).ys) : 60, b = near ? Math.min(...pageBox(near).ys) : 600;
  for (const un of near?.units ?? [])
    if (un.role === "creature" && !un.fighting) {
      const p = un.placement;
      b = Math.min(b, proj.project({ x: p.pos.x, y: p.pos.y + Math.cos(proj.pitch) * CH * p.scale, z: p.pos.z - Math.sin(proj.pitch) * CH * p.scale }).y / u);
    }
  t = t || 60;
  return { l: left ? Math.max(...pageBox(left).xs) : 60, r: right ? Math.min(...pageBox(right).xs) : 1120, t: t + 10, b: b - 10 };
}

function hitGroups(plans: readonly SeatPlan[], shapes: readonly Shape[], stack: TablePlan["stack"]): HitGroups {
  const groups: HitGroup[] = [];
  const byGroup = new Map(shapes.map((s) => [s.group, s]));
  const shape = (id: string) => byGroup.get(id)!;
  for (const p of plans)
    for (const un of p.units) {
      // (A head in a file is reached through the file's tail.)
      if (un.file && un.file.rank > 0 && !un.raised && !un.fighting) continue;
      groups.push({ id: un.id, kind: un.kind, seat: p.seat, members: un.members, quad: shape(un.id).face, order: shape(un.id).order });
    }
  // A file's tail: its heads as one pile (a lone head answers as itself: a card, or a pile of its copies).
  for (const s of shapes)
    if (s.kind === "tail") {
      const heads = plans.flatMap((p) => p.units.filter((u) => u.file && `tail:${u.file.id}` === s.group && u.file.rank > 0 && !u.raised && !u.fighting));
      const kind = heads.length === 1 ? heads[0]!.kind : "pile";
      groups.push({ id: s.group, kind, seat: s.seat as SeatId, members: s.members, quad: s.face, order: s.order });
    }
  for (const p of plans) for (const z of p.fixtures.zones) {
    const id = `zone:${z.zone}:${p.seat}`;
    groups.push({ id, kind: "zone", seat: p.seat, members: [], quad: shape(id).face, order: shape(id).order });
  }
  for (const p of plans) groups.push({ id: `plate:${p.seat}`, kind: "plate", seat: p.seat, members: [], quad: shape(`plate:${p.seat}`).face, order: shape(`plate:${p.seat}`).order });
  for (const p of plans) {
    const c = p.fixtures.commander, id = `command:${p.seat}`;
    if (c) groups.push({ id, kind: "card", seat: p.seat, members: [c.card], quad: shape(id).face, order: shape(id).order });
  }
  // The stack, top first, by its depth like any card; under the plates.
  for (const s of stack) if (s.reachable) groups.push({ id: `stack:${s.key}`, kind: "stack", seat: null, members: [s.card], quad: s.quad, order: shape(`stack:${s.key}`).order });
  const rev = fnv(groups.map((x) => `${x.id}:${x.members.join(",")}`).join(";"));
  return { rev, groups };
}

/**
 * What a tap at `p` reaches at rest, over the groups' stored quads (what is drawn). Precedence is what draws on top, as
 * the audit measures it: plates first (they draw over everything), then everything else, the stack included, by draw
 * order (a later group wins a tie, as `topAt` does). The top of the stack is nearest, so it wins where the stack's
 * cards meet.
 */
export function hitTest(plan: TablePlan, p: Point): HitGroup | null {
  const groups = plan.hits.groups;
  let best: HitGroup | null = null;
  for (const g of groups) if ((!best || g.order >= best.order) && inQuad(g.quad, p.x, p.y)) best = g;
  return best;
}

