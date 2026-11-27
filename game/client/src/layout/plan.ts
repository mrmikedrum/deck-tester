import { FLOOR, TAP_PX } from "./board";
import type { SeatBoard } from "./board";
import { pinhole } from "./projector";
import type { Projector } from "./projector";
import { reservations } from "./reservations";
import type { ChromeMode, Reservations } from "./reservations";
import type { LayoutMemory, SeatPlan } from "./seat";
import { fighters } from "./combat";
import type { CombatPairs } from "./combat";
import { CH, CW } from "./geometry";
import { audit, bounds, depthOrder, hitQuad, inQuad, seatShapes, stackShape } from "./shape";
import type { Quad, Shape, TapArea, Violation } from "./shape";
import { tableTemplate } from "./template";
import type { TableTemplate } from "./template";
import type { CardId, Insets, Point, Rect, SeatId, V3, Viewport } from "./types";
import { designUnit } from "./types";
import { planLeaf } from "./arrange/leaves";
import type { EngineInput, LeafPlan } from "./arrange/leaves";
import { arrangedSeat, entrySeat, mineSeat } from "./arrange/adapter";
import { mineFrame, myPlate, planMine } from "./arrange/mine";
import { leafFrame, partShift } from "./arrange/leaf";
import { LEAN, onFrame } from "./arrange/frame";
import { PLATE_S } from "./geometry";
import { S_TABLE } from "./arrange/scale";
import { posed } from "./arrange/solver";
import { DUEL_ROW, combatFormOf, gathering } from "./arrange/gathering";
import type { CombatForm, Gathering } from "./arrange/gathering";

/** The clash's cards are reached over the whole table, the plates' table groups too (the plates themselves are chrome,
 *  over the canvas, and take their own taps first). */
const FOCUS_ORDER = 2e6;

// Planning the table: every seat on the arrangement engine (each opponent's leaf, my side), plates, the stack at rest,
// the combat's gathering, and what a tap can reach.

/** Where a tap can land under these reservations: the safe area, less the chrome that is up. */
function tapArea(reserve: Reservations): TapArea {
  return { safe: reserve.safe, chrome: reserve.items.filter((i) => i.visible).map((i) => i.rect) };
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
  /** The stack is the table's focus (held up over the table, the app's stack layer on top): it floats over the table and
   *  needs no room, so the mats do not part for it, and its place at rest (where it eases back to) is neither audited nor
   *  reached. Absent: the stack rests in the middle, set aside, and the mats part for it. */
  readonly stackHeld?: boolean;
  readonly template?: TableTemplate;
  /** Attacks and blocks (the engine's, or a draft over them): the gathering stands them in the clash or as duels. */
  readonly combat?: CombatPairs | null;
  /** How the combat is shown: the clash, or the table form (the app's, when the clash is set aside). Absent: the form the
   *  combat takes by itself (`combatFormOf`). */
  readonly combatForm?: CombatForm;
  /** Attackers that have had a blocker this combat (the app remembers them): one whose blockers left stays blocked. */
  readonly blocked?: ReadonlySet<CardId>;
  /** The clash's attackers in the order it first stood them: no column jumps during a combat. */
  readonly order?: readonly CardId[];
  /** Every seat as the arrangement engine is given it: each opponent's leaf and my side (`tableInputOf` builds it). */
  readonly engine: EngineInput;
}

export type GroupKind = "card" | "pile" | "well" | "summary" | "plate" | "stack";

export interface HitGroup {
  /** Stable for as long as the group lasts: unit id (kind letter and first card), "plate:<seat>", "stack:<key>". */
  readonly id: string;
  readonly kind: GroupKind;
  readonly seat: SeatId | null;
  /** In order, the card shown first. Empty for a plate. */
  readonly members: readonly CardId[];
  /** Its face on screen at rest, CSS px: what is drawn, and what a tap reaches. */
  readonly quad: Quad;
  /** Draw order among the table's groups: larger is drawn over smaller (plates and the stack are hit first anyway). */
  readonly order: number;
  /** Its top face as drawn, where `quad` is the wider place it owns (an engine unit's slot): a tap on a face reaches that
   *  face's group first; the place takes only taps on the table around it. */
  readonly face?: Quad;
}

export interface HitGroups {
  /** Changes when any group appears, goes, or its members or their order change; not when things merely move. */
  readonly rev: number;
  /** The table at rest, the stack set aside: what `hitTest` reaches and the audit measures. */
  readonly groups: readonly HitGroup[];
  /**
   * The stack as the table's focus, top first: each card shown with a patch of its own, at its `stackUp` quad, drawn
   * over the whole table. While the focus is up these are the stack's groups (a card the open middle had no room for
   * at rest is reached here too).
   */
  readonly up?: readonly HitGroup[];
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
  /** The combat shown, or null. */
  readonly combat: CombatPairs | null;
  /** Attackers blocked at some point this combat (the app's memory): a lane never runs from one to its defender. */
  readonly blocked: ReadonlySet<CardId>;
  /** How it is shown: the clash's columns, wings and area, or the table form's wings (for the plates' tallies). */
  readonly gathering: Gathering | null;
  /** My field row's tops on screen (px), as drawn (a parting slides them toward me): the clash stops above them. */
  readonly fieldTop: number;
  /** The arrangement engine's plan of each opponent's leaf at rest. */
  readonly leaves: ReadonlyMap<SeatId, LeafPlan>;
  /** The arrangement engine's plan of my side at rest. */
  readonly mine?: LeafPlan;
  /**
   * How far the mats are parted, in card heights (0 at rest): every opponent's leaf drawn by the engine slides along its
   * own `away` by this much to open the middle for duels or the stack (§5.3). Its units are the rest plan's.
   */
  readonly part: number;
  /** A fight between opponents whose duels do not fit the middle, however far the mats part: the app raises the clash. */
  readonly crowded: boolean;
  /** The decision up, as the focus sheets read it: what it offers, and whether it is choosing cards (not priority). */
  readonly decision: { readonly offered: ReadonlySet<CardId>; readonly choosing: boolean };
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
  const vp = input.viewport, projector = pinhole(tpl.camera, vp), reserve = reservations(vp, input.mode, input.safe);
  const boardOf = (k: number): SeatBoard => input.seats[k]!.board;
  const combat = input.combat ?? null, fight = fighters(combat);
  // Every opponent's leaf and my side on the engine. A parting draws the same arrangement again where it moves it (`posed`).
  const leaves = new Map<SeatId, LeafPlan>();
  input.seats.forEach((x, i) => {
    const l = i > 0 ? input.engine.leaves.find((y) => y.seat === x.seat) : undefined;
    if (l) leaves.set(x.seat, planLeaf(l, tpl.slots[i]!, tpl.leaf, tpl.part, projector, reserve.safe));
  });
  const drawn = new Set(input.seats.flatMap((x, i) => (leaves.get(x.seat)?.result ? [i] : [])));
  // My side (step 9): one row on the template's field line, drawn as my seat's plan.
  const me = input.engine.mine && input.engine.mine.seat === input.seats[0]?.seat ? planMine(input.engine.mine, { slot: tpl.slots[0]!, tpl, projector, reserve }) : undefined;
  const mineDrawn = !!me?.result;
  const leafSeat = (k: number, part: number): SeatPlan => {
    const l = leaves.get(input.seats[k]!.seat)!, at = part ? posed(l.input!, l.result!, partShift(part)) : l.result!;
    return arrangedSeat({ result: at, far: tpl.leaf.far, shift: part ? partShift(part) : 0, board: boardOf(k), cards: l.input!.cards, projector, reserve });
  };
  // My row parted slides toward me (its frame's `away` points at the middle).
  const mineSeatAt = (part: number): SeatPlan => {
    const r = part ? posed(me!.input!, me!.result!, -partShift(part)) : me!.result!;
    return mineSeat({ result: r, edge: tpl.slots[0]!.z + tpl.slots[0]!.d / 2 - r.fit.frame.anchor.z, facing: me!.input!.container.facing ?? 0, board: boardOf(0), cards: me!.input!.cards, projector, reserve });
  };
  // A seat the engine could not arrange (it threw: `LeafPlan.error` says why) is one entry pile on its frame.
  const fallback = (k: number): SeatPlan => {
    const slot = tpl.slots[k]!;
    if (k === 0) return entrySeat(boardOf(0), mineFrame(slot, tpl, projector, reserve).frame, myPlate(projector, reserve));
    const f = leafFrame(slot, tpl.leaf);
    return entrySeat(boardOf(k), f, { pos: onFrame(f, 0, f.d + 0.25), scale: PLATE_S, posture: "stand" });
  };
  /** How far down my row's tops go on screen (px) when the mats part this far. */
  const myDrop = (part: number): number => {
    const fit = mineDrawn && part ? me!.result!.fit : null, row = fit?.rows.find((r) => r.posture === "stand");
    if (!fit || !row) return 0;
    const top = (shift: number) => projector.project(onFrame({ ...fit.frame, anchor: onFrame(fit.frame, 0, shift) }, 0, row.v + CH * S_TABLE * Math.sin(LEAN), CH * S_TABLE * Math.cos(LEAN))).y;
    return top(-partShift(part)) - top(0);
  };
  const plans: SeatPlan[] = input.seats.map((_, k) => (drawn.has(k) ? leafSeat(k, 0) : k === 0 && mineDrawn ? mineSeatAt(0) : fallback(k)));
  const area = tapArea(reserve);
  const u = designUnit(vp);
  const tapped = new Set(input.seats.flatMap((x) => x.board.cards.filter((c) => c.tapped).map((c) => c.id)));
  // My field row's tops, before anything leaves it: the clash stands above them.
  const fieldTop = openMiddle(tpl, projector, plans, u).b * u + 10 * u;
  const cards = new Map(input.seats.flatMap((x) => x.board.cards.map((c) => [c.id, c] as const)));
  const seatOf = (id: CardId) => input.seats.find((x) => x.board.cards.some((c) => c.id === id))?.seat;
  let form = input.combatForm ?? combatFormOf(combat, input.seats[0]!.seat, seatOf, input.blocked);
  const gatherIn = (ps: readonly SeatPlan[], f: typeof form, duels: { foot: number; mid: number } | undefined) =>
    gathering({
      combat: combat!,
      plans: ps,
      perspective: input.seats[0]!.seat,
      projector,
      reserve,
      u: u,
      form: f,
      fieldTop,
      power: (id) => cards.get(id)?.power ?? null,
      twin: (id) => cards.get(id)?.sig ?? String(id),
      ...(input.blocked ? { blocked: input.blocked } : {}),
      ...(input.order ? { order: input.order } : {}),
      tapped: (id) => tapped.has(id),
      ...(duels ? { duels } : {}),
    });
  // The parting (§5.3): what rests on the middle at table size (duels, the stack) asks for a card standing there, clear
  // of my field row's tops and of every opponent's feet above it; the leaves part by the least step that opens it.
  const row = { foot: fieldTop - DUEL_ROW.foot * u, mid: vp.w / 2 };
  const room = partRoom(input, tpl, projector, plans, leaves, drawn, reserve.safe);
  let part = 0, duels: typeof row | undefined, crowded = false;
  // Duels are fights between opponents: my cards in the middle at table size are under my floor, so a fight I am in,
  // its clash set aside, stays home.
  const mineFight = [...fight].some((id) => seatOf(id) === input.seats[0]!.seat);
  if (combat && fight.size && form === "table" && combat.blocks.length && !mineFight) {
    const g0 = gatherIn(plans, "table", row);
    if (g0.duels) {
      const away = new Set(g0.plans.flatMap((p) => p.units.filter((un) => un.fighting).flatMap((un) => [...un.members, ...un.dressing])));
      const d = room.row(g0.duels.r - g0.duels.l, row.mid, g0.duels.t - DUEL_ROW.clear * u, away, myDrop);
      // (the duels stand over my row's tops where the parting has slid them)
      if (d !== null) [part, duels] = [d.part, { ...row, foot: row.foot + myDrop(d.part), mid: d.mid }];
      else {
        crowded = true;
        // All or nothing: duels that do not fit raise the clash, unless the app has set it aside (everyone home, lit).
        if (!input.combatForm) form = "clash";
      }
    }
  }
  // The stack set aside rests in the open middle, sized by the room it has: the mats part all the way for it. Held up as
  // the focus it floats over the table and needs no room: nothing moves for it.
  const held = !!input.stackHeld && input.stack.length > 0;
  if (input.stack.length && drawn.size && !held) part = tpl.part.most;
  if (part) for (const k of drawn) plans[k] = leafSeat(k, part);
  if (part && mineDrawn) plans[0] = mineSeatAt(part);
  // The composed table, as the scene draws it: every seat (cards acting where they stand), the stack set aside in the
  // open middle the pages leave (so it moves when they do), and the fight: the clash over it all, or at home.
  const compose = () => {
    const gathered = combat && fight.size ? gatherIn(plans, form, form === "table" ? duels : undefined) : null;
    // (the duels' row is the fight's, in the middle too: the stack rests beside it, never over it)
    const stack = stackAtRest(input, tpl, projector, plans, reserve.safe, gathered && !gathered.focus ? gathered.duels : null);
    const placed = gathered ? gathered.plans : plans;
    const only = (x: Shape): boolean => x.kind !== "stack" || stack.some((s) => s.shape === x && s.onScreen && !s.spilled);
    // (held up as the focus, the stack's place at rest is only where it eases back to: not on the table, so not audited)
    const audited = (xs: readonly Shape[]): Shape[] => (held ? xs.filter((x) => x.kind !== "stack") : [...xs]);
    let shapes = [...placed.flatMap((p, i) => seatShapes(projector, p, boardOf(i).mine)), ...stack.map((s) => s.shape)];
    let v: Violation[];
    // The clash's units: what the gathering placed (a fighter past its columns waits on its page, audited there).
    const row = new Set(placed.flatMap((p) => p.units.filter((un) => un.fighting).map((un) => un.id)));
    if (gathered?.focus) {
      // A focus is audited apart: the table under it with it set aside, and its own cards among themselves. It is drawn
      // and reached over the whole table, and never over my field row's faces or the chrome (`clash-covers`).
      const fighting = (x: Shape) => row.has(x.group);
      v = [...audit(audited(shapes.filter((x) => !fighting(x))), vp, { area, only }), ...audit(shapes.filter(fighting), vp, { area })];
      v = [...v, ...clashCovers(shapes.filter(fighting), shapes.filter((x) => !fighting(x) && x.seat === input.seats[0]!.seat && x.kind !== "plate"), reserve)];
      shapes = shapes.map((x) => (fighting(x) ? { ...x, order: x.order + FOCUS_ORDER } : x));
    } else v = audit(audited(shapes), vp, { area, only });
    return { stack, gathered, shapes, v, placed, row };
  };
  const c = compose();
  const final = c.placed;
  const seats = new Map(final.map((p) => [p.seat, p]));
  const shapes = c.shapes;
  let v = c.v;
  // A stack card the middle has no room for, one off the safe area, or one the audit finds without a patch of its own,
  // has no hit group: a sheet offers it.
  const broken = new Set(v.filter((x) => x.rule === "tap-patch").map((x) => x.group));
  const stack: StackAtRest[] = c.stack.map((s) => ({ key: s.key, card: s.card, quad: s.shape.face, reachable: s.onScreen && !s.spilled && !broken.has(s.shape.group) }));
  for (const s of held ? [] : c.stack)
    if (s.spilled) v = [...v, { rule: "no-room", group: s.shape.group, seat: null, measured: 0, limit: 1 }];
    else if (!s.onScreen) v = [...v, { rule: "off-screen", group: s.shape.group, seat: null, measured: 0, limit: 1 }];
  const focus = stackFocus(input, projector, final, shapes, reserve, reserve.safe), stackUp = focus.up;
  if (focus.covers && stackUp[0]) v = [...v, { rule: "focus-covers", group: `stack:${stackUp[0].key}`, seat: null, measured: 0, limit: 1 }];
  const hits = hitGroups(final, shapes, stack, stackUp, c.gathered);
  const memory = new Map(final.map((p) => [p.seat, p.memory]));
  // The rev covers everything drawn or reached: every unit's place, frame and turn, the fixtures, every group's quad and
  // face, the stack at rest and as the focus, the gathering, and the parting.
  // (rounded to 10^-d as an integer: as exact as `toFixed` for a key, and much cheaper)
  const n = (x: number, d = 4) => String(Math.round(x * 10 ** d));
  const v3s = (a: V3) => `${n(a.x)},${n(a.y)},${n(a.z)}`;
  const quads = (qs: readonly Quad[]) => qs.map((q) => q.map((p) => `${n(p.x, 1)},${n(p.y, 1)}`).join(" ")).join(";");
  const placement = final
    .map((p) =>
      [
        p.seat,
        // (how many of its cards are tapped too: a well's sign says so)
        p.units.map((u) => [u.id, v3s(u.placement.pos), n(u.placement.scale), u.placement.posture, u.placement.frame ? `${v3s(u.placement.frame.right)}/${v3s(u.placement.frame.up)}` : "", u.turn ?? "", u.tapped ? 1 : 0, u.members.reduce((t, id) => t + (tapped.has(id) ? 1 : 0), 0), u.light ?? "", u.cue ?? ""].join(",")).join(";"),
        v3s(p.fixtures.page.pos), n(p.fixtures.page.w, 3), n(p.fixtures.page.d, 3),
      ].join("|"),
    )
    .join("\n");
  const screen = `${quads(hits.groups.map((g) => g.quad))}\n${quads(hits.groups.flatMap((g) => (g.face ? [g.face] : [])))}\n${quads(stack.map((x) => x.quad))}\n${quads(stackUp.map((x) => x.quad))}`;
  const gathered = c.gathered ? JSON.stringify([c.gathered.form, c.gathered.step, c.gathered.extent, c.gathered.duels, c.gathered.moreAt, c.gathered.wings.map((w) => [w.attacker, w.defender, w.plaque, w.w, w.unblocked, w.walker, w.tallyAt, w.columns.map((col) => [col.unit, col.attackers, col.blockers, col.x, col.w, col.clasp, col.slot, col.power, col.blocked])]), c.gathered.more]) : "";
  return { rev: fnv(`${placement}\n${hits.rev}\n${screen}\n${gathered}\n${part}`), viewport: vp, projector, reserve, seats, memory, hits, stack, stackUp, violations: v, combat, blocked: input.blocked ?? new Set(), gathering: c.gathered, fieldTop: fieldTop + myDrop(part), leaves, ...(me ? { mine: me } : {}), part, crowded, decision: decisionOf(input) };
}

/** What the decision up offers, and whether it is choosing cards: priority's plays are usable, not chosen. */
function decisionOf(input: TableInput): TablePlan["decision"] {
  const d = input.engine.mine ?? input.engine.leaves[0];
  return { offered: d?.offered ?? new Set(), choosing: !!d?.decision && d.decision !== "play" };
}

/** A clash shape over a face of my field row or over the chrome: the clash must leave both uncovered. */
function clashCovers(fight: readonly Shape[], mine: readonly Shape[], reserve: Reservations): Violation[] {
  const box = (q: Quad) => bounds(q);
  const meet = (a: ReturnType<typeof box>, b: { l: number; r: number; t: number; b: number }) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;
  const chrome = reserve.items.filter((i) => i.visible).map((i) => ({ l: i.rect.left, r: i.rect.right, t: i.rect.top, b: i.rect.bottom }));
  const out: Violation[] = [];
  for (const f of fight) {
    const b = box(f.face);
    if (mine.some((m) => meet(b, box(m.face))) || chrome.some((c) => meet(b, c))) out.push({ rule: "clash-covers", group: f.group, seat: f.seat, measured: 0, limit: 0 });
  }
  return out;
}

/** Something on an opponent's leaf, as the parting measures it: its box on screen and the cards it holds. */
interface Low {
  readonly l: number;
  readonly r: number;
  readonly b: number;
  readonly cards: readonly CardId[];
}

/**
 * Where the parting finds room for a row `w` wide on the middle at table size (§5.3): the least parting (card heights, a
 * multiple of the template's step, at most its most) at which nothing on an opponent's leaf under the row reaches lower
 * than `top` (feet, a stack's dice), the row slid across the table to where it needs least, nearest `mid` among equals;
 * null when no parting opens it. Only the engine's leaves part (a seat it could not arrange holds still); cards in `away`
 * are leaving their places (for the duels).
 */
function partRoom(input: TableInput, tpl: TableTemplate, proj: Projector, plans: readonly SeatPlan[], leaves: ReadonlyMap<SeatId, LeafPlan>, drawn: ReadonlySet<number>, safe: Rect) {
  const boxOf = (q: Quad, cards: readonly CardId[]): Low => {
    const b = bounds(q);
    return { l: b.l, r: b.r, b: b.b, cards };
  };
  const still: Low[] = [];
  plans.forEach((p, i) => {
    if (i === 0 || drawn.has(i)) return;
    for (const sh of seatShapes(proj, p, false)) if (sh.kind !== "plate") still.push(boxOf(sh.face, p.units.find((un) => un.id === sh.group)?.members ?? []));
  });
  const steps = Math.round(tpl.part.most / tpl.part.step);
  const parted: Low[][] = [];
  const lowAt = (k: number): readonly Low[] => {
    if (parted[k]) return parted[k];
    const part = k * tpl.part.step, out: Low[] = [...still];
    for (const i of drawn) {
      const lp = leaves.get(input.seats[i]!.seat)!, fit = (part ? posed(lp.input!, lp.result!, partShift(part)) : lp.result!).fit;
      for (const t of fit.targets) out.push(boxOf(t.region, t.members));
      for (const un of fit.units) if (un.marker) out.push(boxOf(un.marker.room, un.members));
    }
    return (parted[k] = out);
  };
  const clear = (k: number, l: number, r: number, top: number, away: ReadonlySet<CardId>): boolean =>
    lowAt(k).every((x) => x.b <= top || x.r <= l || x.l >= r || x.cards.some((id) => away.has(id)));
  /** `drop`: how far the row itself moves down at a parting (it stands on my row, which parts toward me). */
  const row = (w: number, mid: number, top0: number, away: ReadonlySet<CardId>, drop: (part: number) => number = () => 0): { mid: number; part: number } | null => {
    const lo = safe.left + 16 + w / 2, hi = safe.right - 16 - w / 2;
    if (lo > hi) return null;
    const xs = [Math.min(hi, Math.max(lo, mid))];
    for (let d = 8; mid - d >= lo || mid + d <= hi; d += 8) xs.push(...[mid - d, mid + d].filter((x) => x >= lo && x <= hi));
    for (let k = 0; k <= steps; k++) {
      const top = top0 + drop(k * tpl.part.step);
      for (const x of xs) if (clear(k, x - w / 2, x + w / 2, top, away)) return { mid: x, part: k * tpl.part.step };
    }
    return null;
  };
  return { row };
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
// as the table's focus is `stackFocus`, below; duels in the middle keep clear of it (`keep`).
/**
 * The stack at rest in the open middle, top first. `keep` (screen px): what else rests there (the duels' row), which it
 * never covers: it takes the part of the middle beside or above it that gives its cards the most room, and a card that
 * still meets it spills (no room: a sheet offers it).
 */
function stackAtRest(input: TableInput, tpl: TableTemplate, proj: Projector, plans: readonly SeatPlan[], safe: Rect, keep: { l: number; r: number; t: number; b: number } | null = null): StackCard[] {
  const items = [...input.stack].reverse();
  if (!items.length) return [];
  const u = designUnit(input.viewport);
  const step = items.some((s) => s.answers) ? 1.12 : 0.9;
  const fitOf = (m: { l: number; r: number }) => (m.r - m.l - 16) / (CW * (step * items.length + 0.1));
  const M0 = openMiddle(tpl, proj, plans, u);
  let M = M0;
  if (keep) {
    const k = { l: keep.l / u - 8, r: keep.r / u + 8, t: keep.t / u - 8 };
    const parts = [{ ...M0, b: Math.min(M0.b, k.t) }, { ...M0, r: Math.min(M0.r, k.l) }, { ...M0, l: Math.max(M0.l, k.r) }].filter((m) => m.r > m.l && m.b > m.t);
    const room = (m: typeof M0) => Math.min(240, m.b - m.t, fitOf(m));
    M = parts.sort((a, b) => room(b) - room(a))[0] ?? M0;
  }
  const meetsKeep = (b: { l: number; r: number; t: number; b: number }): boolean => !!keep && Math.min(b.r, keep.r) - Math.max(b.l, keep.l) > 0.5 && Math.min(b.b, keep.b) - Math.max(b.t, keep.t) > 0.5;
  const fitW = fitOf(M);
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
    if ((prev && (b.r > right || b.b > foot)) || meetsKeep(b)) {
      spill = true;
      return card(prev?.quad ?? quad, true);
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
 * size so its rules read. Shingled, each card under the top shows this share of its width, and never less than a
 * finger's patch (`TAP_PX`, with room for the grid). */
export const STACK_FOCUS = { share: 0.52, floor: 360, shingle: 0.3, top: 46, margin: 8, clear: 10 } as const;

interface FocusAt {
  readonly h: number;
  readonly row: boolean;
  /** Each card under the top shows this share of its width (shingled), or stands a step apart (a row). */
  readonly share: number;
  /** The cards shown, top first; any past them lie under the last one shown. */
  readonly shown: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The stack as the table's focus: the printed card held up large (0.52 of the screen's height, never under 360), centred
 * between the hand's right edge and the prompt's left edge with its middle at 46% of the height. It may cover pages and
 * cards it does not involve, never a target, a plaque it targets, the prompt or the hand: where one is in the way it
 * moves first (centre, right, left, up) and shrinks only after, to its floor. Several items stand in a row while all
 * fit at the floor or more; past that the top stands at full size and the ones under it shingle to the side they step
 * toward (what they aim at, else whose they are), each showing a strip. Where nothing is clear at the floor so, the top
 * stays at the floor and the rest overlap further (each strip down to a finger's patch), then it looks anywhere on the
 * open screen nearest the middle; still crowded, the deepest lie under the last one shown (not reachable here, as set
 * aside past the open middle's room). Only if the top alone has no clear place does it stand where it covers least, and
 * that is a broken limit (`focus-covers`). Top first, each square to the camera at the focus height.
 */
function stackFocus(input: TableInput, proj: Projector, plans: readonly SeatPlan[], shapes: readonly Shape[], reserve: Reservations, safe: Rect): { up: StackAtRest[]; covers: boolean } {
  const items = [...input.stack].reverse();
  if (!items.length) return { up: [], covers: false };
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
  const shape = (f: Pick<FocusAt, "h" | "row" | "share" | "shown">) => {
    const w = CW * f.h, k = (i: number) => (i === 0 ? 1 : f.row ? 0.8 : 1);
    const at = items.map((_, i) => Math.min(i, f.shown - 1) * (f.row ? step : f.share) * dir);
    const ls = at.map((o, i) => o * w - (k(i) * w) / 2), rs = at.map((o, i) => o * w + (k(i) * w) / 2);
    return { at, k, l: Math.min(...ls), r: Math.max(...rs), w };
  };
  const boxAt = (f: Omit<FocusAt, "x" | "y">, x: number, y: number): Box => {
    const g = shape(f), mid = (g.l + g.r) / 2;
    return { l: x - mid + g.l, r: x - mid + g.r, t: y - f.h / 2, b: y + f.h / 2 + below };
  };
  const inside = (b: Box): boolean => b.l >= sl && b.r <= sr && b.t >= st && b.b <= sb;
  const clear = (b: Box): boolean => !aimed.some((a) => meets(a, b)) && !chrome.some((a) => meets(a, b));
  const fits = (b: Box): boolean => inside(b) && clear(b);
  /** Where a group h tall may stand: the middle, then to the right, the left, then up. */
  const ways = (f: Omit<FocusAt, "x" | "y">): [number, number][] => {
    const b = boxAt(f, 0, 0), w = b.r - b.l, out: [number, number][] = [[xm, ym]];
    for (const k of [0.5, 1, 1.5]) out.push([xm + w * k, ym]);
    for (const k of [0.5, 1, 1.5]) out.push([xm - w * k, ym]);
    for (const k of [0.15, 0.3]) out.push([xm, ym - f.h * k]);
    return out;
  };
  /** Anywhere it lies wholly on the safe area, nearest the middle first. */
  const anywhere = (f: Omit<FocusAt, "x" | "y">): [number, number][] => {
    const b = boxAt(f, 0, 0), out: [number, number][] = [];
    for (let x = sl - b.l; x + b.r <= sr; x += 12) for (let y = st - b.t; y + b.b <= sb; y += 12) out.push([x, y]);
    return out.sort((p, q) => Math.hypot(p[0] - xm, p[1] - ym) - Math.hypot(q[0] - xm, q[1] - ym));
  };
  const first = (f: Omit<FocusAt, "x" | "y">, at: [number, number][]): FocusAt | null => {
    for (const [x, y] of at) if (fits(boxAt(f, x, y))) return { ...f, x, y };
    return null;
  };
  /** `first(f, anywhere(f))` in one pass: the nearest place to the middle where it fits (the earliest on a tie), its box
   *  computed once and slid (a box at (x, y) is the box at the origin moved by x, y). */
  const nearest = (f: Omit<FocusAt, "x" | "y">): FocusAt | null => {
    const b = boxAt(f, 0, 0);
    let best: [number, number] | null = null, bestD = Infinity;
    for (let x = sl - b.l; x + b.r <= sr; x += 12)
      for (let y = st - b.t; y + b.b <= sb; y += 12) {
        const d = Math.hypot(x - xm, y - ym);
        if (d < bestD && fits({ l: b.l + x, r: b.r + x, t: b.t + y, b: b.b + y })) [best, bestD] = [[x, y], d];
      }
    return best ? { ...f, x: best[0], y: best[1] } : null;
  };
  const floor = STACK_FOCUS.floor, most = Math.max(floor, STACK_FOCUS.share * vh);
  // The narrowest strip a card under the top may show at the floor: a finger's patch, with room for the grid.
  const least = Math.min(STACK_FOCUS.shingle, (TAP_PX * 1.12) / u / (CW * floor));
  const narrower: number[] = [];
  for (let k = STACK_FOCUS.shingle; k > least + 0.005; k -= 0.03) narrower.push(k);
  narrower.push(least);
  const search = (): FocusAt | null => {
    // At full size or down to the floor: all in a row, then shingled.
    for (const row of n > 1 ? [true, false] : [true])
      for (let h = most; h >= floor - 0.01; h -= 10) {
        const f = { h, row, share: STACK_FOCUS.shingle, shown: n };
        const got = first(f, ways(f));
        if (got) return got;
      }
    if (n > 1)
      // The top at the floor; the rest overlapping further, nearest the middle, anywhere on the open screen.
      for (const share of narrower) {
        const f = { h: floor, row: false, share, shown: n };
        const got = first(f, ways(f)) ?? nearest(f);
        if (got) return got;
      }
    // Still crowded: the deepest lie under the last one shown.
    for (let shown = n - 1; shown >= 1; shown--) {
      const f = { h: floor, row: false, share: least, shown };
      const got = nearest(f);
      if (got) return got;
    }
    return null;
  };
  let found = search(), covers = false;
  if (!found) {
    // Nowhere clear for the top alone: it stands at the floor where it covers least of what it must not, and says so.
    const f = { h: floor, row: false, share: least, shown: 1 };
    const cost = (b: Box): number =>
      [...aimed, ...chrome].reduce((t, a) => t + Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)), 0);
    const at = anywhere(f);
    const [x, y] = at.length ? at.reduce((best, p) => (cost(boxAt(f, p[0], p[1])) < cost(boxAt(f, best[0], best[1])) ? p : best)) : [xm, ym];
    found = { ...f, x, y };
    covers = true;
  }
  const g = shape(found), box = boxAt(found, found.x, found.y);
  const x0 = box.l - g.l, cy = found.y;
  const along = (p: V3, d: V3, t: number): V3 => ({ x: p.x + d.x * t, y: p.y + d.y * t, z: p.z + d.z * t });
  const at0 = proj.onTable(x0 * u, cy * u, STACK_POSE.up);
  const per = Math.abs(proj.project(along(at0, proj.up, 0.5)).y - proj.project(along(at0, proj.up, -0.5)).y) / u;
  const sc0 = found.h / per;
  const up = items.map((s, i) => {
    const sc = sc0 * g.k(i);
    // Laid out on screen at the top's depth (the scene stands each under it further back along its ray, the same
    // pixels); a smaller one in a row stands on the same foot line.
    const ctr = along(along(at0, proj.right, (g.at[i] ?? 0) * CW * sc0), proj.up, ((sc - sc0) * CH) / 2);
    const pt = (a: number, b: number): Point => proj.project(along(along(ctr, proj.right, a * sc), proj.up, b * sc));
    const quad: Quad = [pt(-CW / 2, -CH / 2), pt(CW / 2, -CH / 2), pt(CW / 2, CH / 2), pt(-CW / 2, CH / 2)];
    const b = bounds(quad);
    return { key: s.key, card: s.card, quad, reachable: i < found.shown && b.l >= safe.left && b.t >= safe.top && b.r <= safe.right && b.b <= safe.bottom };
  });
  return { up, covers };
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
  const across = at("across"), near = at("near");
  // Between the side pages when a page stands across from me; with fewer opponents (their leaves meet in the middle) the
  // whole width, under every page's near edge.
  const left = across ? at("left") : undefined, right = across ? at("right") : undefined;
  const opponents = plans.filter((p) => p !== near);
  let t = across ? Math.max(...pageBox(across).ys) : opponents.length ? Math.max(...opponents.flatMap((p) => pageBox(p).ys)) : 60, b = near ? Math.min(...pageBox(near).ys) : 600;
  for (const un of near?.units ?? [])
    if (!un.fighting && (un.placement.frame ? un.placement.posture === "stand" : un.role === "creature")) {
      // (an arranged card stands on its own axes; one without them stands back by the camera's pitch)
      const p = un.placement, up = p.frame?.up ?? { x: 0, y: Math.cos(proj.pitch), z: -Math.sin(proj.pitch) };
      b = Math.min(b, proj.project({ x: p.pos.x + up.x * CH * p.scale, y: p.pos.y + up.y * CH * p.scale, z: p.pos.z + up.z * CH * p.scale }).y / u);
    }
  t = t || 60;
  return { l: left ? Math.max(...pageBox(left).xs) : 60, r: right ? Math.min(...pageBox(right).xs) : 1120, t: t + 10, b: b - 10 };
}

function hitGroups(plans: readonly SeatPlan[], shapes: readonly Shape[], stack: TablePlan["stack"], stackUp: TablePlan["stackUp"], clash: Gathering | null): HitGroups {
  const groups: HitGroup[] = [];
  const byGroup = new Map(shapes.map((s) => [s.group, s]));
  const shape = (id: string) => byGroup.get(id)!;
  for (const p of plans)
    for (const un of p.units) {
      const sh = shape(un.id);
      groups.push({ id: un.id, kind: un.kind, seat: p.seat, members: un.reach ?? un.members, quad: hitQuad(sh), ...(sh.hit ? { face: sh.face } : {}), order: sh.order });
    }
  for (const p of plans) groups.push({ id: `plate:${p.seat}`, kind: "plate", seat: p.seat, members: [], quad: shape(`plate:${p.seat}`).face, order: shape(`plate:${p.seat}`).order });
  // The clash: each unblocked attacker's empty slot is that attacker (a tap or a drop on its brand), and the "more"
  // column holds the fighters past its columns (a tap opens them).
  if (clash?.focus) {
    for (const w of clash.wings)
      for (const col of w.columns)
        if (col.slot) groups.push({ id: `slot:${col.unit}`, kind: "card", seat: w.attacker, members: [...col.attackers], quad: col.slot, order: FOCUS_ORDER });
    if (clash.moreAt && clash.more.length) {
      const seat = plans.find((p) => p.home.has(clash.more[0]!))?.seat ?? null;
      groups.push({ id: "clash:more", kind: "pile", seat, members: [...clash.more], quad: clash.moreAt, order: FOCUS_ORDER });
    }
  }
  // The stack, top first, by its depth like any card; under the plates.
  for (const s of stack) if (s.reachable) groups.push({ id: `stack:${s.key}`, kind: "stack", seat: null, members: [s.card], quad: s.quad, order: shape(`stack:${s.key}`).order });
  // The stack as the focus stands over the whole table, top nearest, as it is drawn.
  const top = Math.max(0, ...groups.map((g) => g.order)) + stackUp.length + 1;
  const up: HitGroup[] = [];
  stackUp.forEach((s, i) => {
    if (s.reachable) up.push({ id: `stack:${s.key}`, kind: "stack", seat: null, members: [s.card], quad: s.quad, order: top - i });
  });
  const rev = fnv([...groups, ...up.map((x) => ({ ...x, id: `up:${x.id}` }))].map((x) => `${x.id}:${x.members.join(",")}`).join(";"));
  return { rev, groups, up };
}

/** A group by its id: at rest, else one only the stack as the focus reaches (its cards the open middle had no room for). */
export function groupById(hits: HitGroups, id: string): HitGroup | undefined {
  return hits.groups.find((g) => g.id === id) ?? hits.up?.find((g) => g.id === id);
}

/**
 * What a tap at `p` reaches at rest, over the groups' stored quads (what is drawn). Precedence is what draws on top, as
 * the audit measures it: plates first (they draw over everything), then everything else, the stack included, by draw
 * order (a later group wins a tie, as `topAt` does). The top of the stack is nearest, so it wins where the stack's
 * cards meet.
 */
export function hitTest(plan: TablePlan, p: Point): HitGroup | null {
  return topmost(plan.hits.groups, p);
}

/**
 * The group a tap at `p` reaches among `groups`, by draw order (a later group wins a tie): first the topmost whose face
 * is under the point, then, where no face is, the topmost whose place holds it. `quadOf` is where the group is drawn now.
 */
function topmost(groups: readonly HitGroup[], p: Point, quadOf: (g: HitGroup, q: Quad) => Quad = (_g, q) => q): HitGroup | null {
  let face: HitGroup | null = null, place: HitGroup | null = null;
  for (const g of groups) {
    if ((!face || g.order >= face.order) && inQuad(quadOf(g, g.face ?? g.quad), p.x, p.y)) face = g;
    if ((!place || g.order >= place.order) && inQuad(quadOf(g, g.quad), p.x, p.y)) place = g;
  }
  return face ?? place;
}

