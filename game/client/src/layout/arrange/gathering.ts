// The gathering (§2.8, `clash`): combat as one picture. In the clash (a focus: I am attacked, my attackers are blocked,
// or a fight between opponents has blocks) every fighter leaves its place and stands upright on a plane carried toward
// the eye, over the shade, between the plaques and my field row (never on it). All attackers stand in one rank across,
// in the order they stood, grouped into wings by what they attack; a blocker stands on its controller's side of its
// attacker (mine below, an opponent's above), toe to toe with it, so a fight at me is attackers over blockers, my attack
// is my attackers under theirs, and an attack on me and an opponent at once is three rows. An unblocked attacker's slot
// (on its defender's side) is empty: the chrome brands it with the attacker's power. One tier: the largest step at which
// every column fits; past that the rest wait in one "more" column. In the table form nothing moves: fighters fight from
// their places, lit (the scene) and laned. Pure.
import type { Reservations } from "../reservations";
import { fightUnits, fighters } from "../combat";
import type { CombatPairs } from "../combat";
import type { Projector } from "../projector";
import type { SeatPlan, Unit, UnitId } from "../seat";
import type { Quad } from "../shape";
import { CH, CW } from "../seat/geometry";
import type { CardId, Point, SeatId, V3 } from "../types";
import { S_TABLE } from "./scale";

/** How the combat is shown: the clash (a focus over the shaded table), or the table form (fighters at home). */
export type CombatForm = "clash" | "table";

/** What a defender is: a player, or a planeswalker (or battle) by its card. */
export type Defender = { readonly seat: SeatId } | { readonly card: CardId };

export interface GatherInput {
  readonly combat: CombatPairs;
  readonly plans: readonly SeatPlan[];
  readonly perspective: SeatId;
  readonly projector: Projector;
  readonly reserve: Reservations;
  readonly u: number;
  readonly form: CombatForm;
  /** My field row's tops on screen (px): the clash ends above it. */
  readonly fieldTop: number;
  /** A card's current power (null: none known). */
  readonly power: (id: CardId) => number | null;
  /** A card's look key: unblocked attackers alike in every fact share a column (`twins`). */
  readonly twin?: (id: CardId) => string;
  /** Attackers that have had a blocker this combat (one whose blockers left stays blocked). */
  readonly blocked?: ReadonlySet<CardId>;
  /** The attackers' order kept from the combat's first clash (where they stood then); others follow where they stand. */
  readonly order?: readonly CardId[];
  /** Whether a card is tapped (a fighter taken out of a summary). */
  readonly tapped: (id: CardId) => boolean;
}

/** One attacker (or a stack of twins) and its slot. Screen px. */
export interface ClashColumn {
  /** The attacker's unit (the twins' first). */
  readonly unit: UnitId;
  readonly attackers: readonly CardId[];
  readonly blockers: readonly CardId[];
  /** Its x on screen, and its width. */
  readonly x: number;
  readonly w: number;
  /** The empty slot where its blocker would stand (an unblocked attacker's brand), or null when blocked. */
  readonly slot: Quad | null;
  /** Where the attacker and its blockers meet (the clasp), when blocked. */
  readonly clasp: Point | null;
  /** The attackers' current power, summed (an unblocked column's figure). */
  readonly power: number;
  readonly blocked: boolean;
}

export interface ClashWing {
  /** Whose attack. */
  readonly attacker: SeatId;
  readonly defender: Defender;
  /** The player who defends (a planeswalker's controller). */
  readonly defenderSeat: SeatId | null;
  /** The wing's middle and top on screen: the plaque stands centred over it. */
  readonly plaque: Point;
  readonly w: number;
  /** The summed power of its unblocked attackers. */
  readonly unblocked: number;
  readonly columns: readonly ClashColumn[];
  /** An attacked planeswalker standing at the end of its wing: its unit, and its top middle on screen (its tally). */
  readonly walker?: { readonly unit: UnitId; readonly card: CardId; readonly x: number; readonly top: number };
}

export interface Gathering {
  /** The seats with their fighters moved into the clash (`fighting`); in the table form, unchanged. */
  readonly plans: SeatPlan[];
  readonly form: CombatForm;
  /** The clash's area on screen (px), when it is up. */
  readonly area: { readonly l: number; readonly r: number; readonly t: number; readonly b: number } | null;
  /** What the picture covers on screen (px): its columns and slots, from the top row's tops to the bottom row's feet. */
  readonly extent: { readonly l: number; readonly t: number; readonly r: number; readonly b: number } | null;
  /** The step it stands at: how much nearer than the table (1: the table form). */
  readonly step: number;
  /** Every wing, in order (also in the table form: the plates' tallies read them; columns then carry no geometry). */
  readonly wings: readonly ClashWing[];
  /** Fighters with no column (past the one tier): they wait on their pages, counted by the "more" column. */
  readonly more: readonly CardId[];
  /** The "more" column's place on screen, when there is one. */
  readonly moreAt: Quad | null;
  /** It is a focus (the clash is up): drawn over the shaded table. */
  readonly focus: boolean;
  /** Fighters that fight from their pages (the table form, or no room). */
  readonly left: readonly CardId[];
}

/** The steps a clash tries, largest first (one tier at each). */
export const CLASH_STEPS = [1.8, 1.6, 1.5, 1.3, 1.2, 1.1] as const;
/** The clash's area, design px: its top (under the plaques), and how far above my field row it stops. */
export const CLASH = { top: 88, plaqueTop: 58, plaqueH: 22, foot: 8, gap: 10, columnGap: 14, wingGap: 28, maxColumns: 13 } as const;

interface Formation {
  readonly ks: Unit[];
  readonly from: SeatId;
  readonly bs: Unit[];
  readonly defender: Defender;
  readonly defSeat: SeatId | null;
  readonly blocked: boolean;
}

const add = (a: V3, b: V3, k: number): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const defKey = (d: Defender): string => ("seat" in d ? `s${d.seat}` : `c${d.card}`);

/** Which form a combat takes by itself: the clash when I am attacked or anyone is blocked; the table form otherwise. */
export function combatFormOf(combat: CombatPairs | null, perspective: SeatId, seatOf: (card: CardId) => SeatId | undefined): CombatForm {
  if (!combat || !combat.attacks.length) return "table";
  const atMe = combat.attacks.some((a) => ("seat" in a.defender ? a.defender.seat : seatOf(a.defender.card)) === perspective);
  return atMe || combat.blocks.length > 0 ? "clash" : "table";
}

export function gathering(input: GatherInput): Gathering {
  const { combat, plans, projector: proj, perspective, u } = input;
  const want = fighters(combat);
  const units = fightUnits(plans, want);
  const seatOf = (card: CardId) => plans.find((p) => p.units.some((un) => un.members.includes(card) || un.dressing.includes(card)))?.seat;
  const clash = input.form === "clash";
  // A fighter (or an attacked planeswalker) held in a unit of several (a pile, the engine's entry summary) stands in the
  // clash as its own.
  const attacked = new Set(combat.attacks.flatMap((a) => ("card" in a.defender ? [a.defender.card] : [])));
  const walkerUnits = new Map<CardId, { unit: Unit; seat: SeatId }>();
  const carved = new Map<UnitId, { readonly from: UnitId; readonly seat: SeatId }>();
  if (clash)
    for (const id of [...want, ...attacked])
      for (const p of plans) {
        const walker = attacked.has(id) && !want.has(id);
        const own = p.units.find((un) => un.members.length === 1 && un.members[0] === id);
        if (walker && own) walkerUnits.set(id, { unit: own, seat: p.seat });
        const holder = units.has(id) || own ? undefined : p.units.find((un) => un.members.length > 1 && un.members.includes(id));
        if (!holder) continue;
        const unit: Unit = { id: `fight:${id}`, role: walker ? "walker" : "creature", kind: "card", members: [id], dressing: [], top: id, title: null, mixed: false, acting: true, tapped: input.tapped(id), placement: holder.placement };
        if (walker) walkerUnits.set(id, { unit, seat: p.seat });
        else units.set(id, { unit, seat: p.seat });
        carved.set(unit.id, { from: holder.id, seat: p.seat });
      }
  const none: Gathering = { plans: [...plans], form: input.form, area: null, extent: null, step: 1, wings: [], more: [], moreAt: null, focus: false, left: [...want] };
  if (!units.size) return none;
  const powerOf = (un: Unit) => un.members.reduce((t, id) => t + (want.has(id) ? Math.max(0, input.power(id) ?? 0) : 0), 0);

  // Formations: one per attacking unit, its blockers' units with it.
  const forms: Formation[] = [];
  for (const a of combat.attacks) {
    const f = units.get(a.attacker);
    if (!f) continue;
    let fm = forms.find((x) => x.ks.includes(f.unit));
    if (!fm) {
      const defSeat = "seat" in a.defender ? a.defender.seat : (seatOf(a.defender.card) ?? null);
      const blocked = combat.blocks.some((b) => b.attacker === a.attacker) || !!input.blocked?.has(a.attacker);
      forms.push((fm = { ks: [f.unit], from: f.seat, bs: [], defender: a.defender, defSeat, blocked }));
    }
    for (const b of combat.blocks)
      if (b.attacker === a.attacker) {
        const fb = units.get(b.blocker);
        if (fb && !fm.ks.includes(fb.unit) && !forms.some((x) => x.bs.includes(fb.unit)) && !fm.bs.includes(fb.unit)) fm.bs.push(fb.unit);
      }
  }
  if (!forms.length) return none;
  // In the order they stood; wings by defender: mine first, then the defenders' plates left to right (the seats' order),
  // a planeswalker's after its controller's.
  const stood = (un: Unit): number => proj.project(un.placement.pos).x;
  const order = plans.map((p) => p.seat);
  const rank = (f: Formation) => {
    const s = f.defSeat === null ? order.length : (order.indexOf(f.defSeat) + order.length) % order.length;
    return s * 2 + ("card" in f.defender ? 1 : 0);
  };
  const kept0 = (f: Formation): number => {
    const i = input.order?.indexOf(f.ks[0]!.top) ?? -1;
    return i < 0 ? Infinity : i;
  };
  forms.sort((x, y) => rank(x) - rank(y) || defKey(x.defender).localeCompare(defKey(y.defender)) || kept0(x) - kept0(y) || stood(x.ks[0]!) - stood(y.ks[0]!) || (x.ks[0]!.id < y.ks[0]!.id ? -1 : 1));
  // Twins: unblocked attackers alike (the same look, the same defender) share one column, a stack with its count.
  if (input.twin) {
    const twin = input.twin;
    for (let i = 0; i < forms.length; i++) {
      const f = forms[i]!;
      if (f.blocked || f.bs.length || f.ks.length !== 1 || f.ks[0]!.members.length !== 1) continue;
      const key = twin(f.ks[0]!.top);
      for (let j = i + 1; j < forms.length; j++) {
        const g = forms[j]!;
        if (g.blocked || g.bs.length || g.ks.length !== 1 || g.ks[0]!.members.length !== 1 || defKey(g.defender) !== defKey(f.defender)) continue;
        if (twin(g.ks[0]!.top) !== key) continue;
        f.ks.push(g.ks[0]!);
        forms.splice(j--, 1);
      }
    }
  }
  // An attacked planeswalker leaves its page for the end of its wing (when it is a unit of its own).
  const walkers = new Map<string, { unit: Unit; seat: SeatId }>();
  for (const [card, w] of walkerUnits) walkers.set(`c${card}`, w);
  const wingsOf = (fs: readonly Formation[]) => {
    const out: { key: string; fs: Formation[] }[] = [];
    for (const f of fs) {
      const k = `${f.from}>${defKey(f.defender)}`, w = out.at(-1);
      if (w && w.key === k) w.fs.push(f);
      else out.push({ key: k, fs: [f] });
    }
    return out;
  };
  const tableWings = (): ClashWing[] =>
    wingsOf(forms).map((w) => ({
      attacker: w.fs[0]!.from,
      defender: w.fs[0]!.defender,
      defenderSeat: w.fs[0]!.defSeat,
      plaque: { x: 0, y: 0 },
      w: 0,
      unblocked: w.fs.filter((f) => !f.blocked).reduce((t, f) => t + f.ks.reduce((s, k) => s + powerOf(k), 0), 0),
      columns: w.fs.map((f) => ({ unit: f.ks[0]!.id, attackers: f.ks.flatMap((k) => k.members), blockers: f.bs.flatMap((b) => b.members), x: 0, w: 0, slot: null, clasp: null, power: f.ks.reduce((s, k) => s + powerOf(k), 0), blocked: f.blocked })),
    }));
  if (!clash) return { ...none, wings: tableWings() };

  // The area: under the plaques, above my field row, inside the safe area.
  const safe = input.reserve.safe;
  const area = { l: safe.left + 16 * u, r: safe.right - 16 * u, t: safe.top + CLASH.top * u, b: Math.min(input.fieldTop, safe.bottom) - CLASH.foot * u };
  // The rows, top to bottom: an opponent's blockers (far), the attackers, mine (near). A row is there when a wing's
  // defender is on that side (its slot is there, blocked or not).
  const nearRow = forms.some((f) => f.defSeat === perspective) || forms.some((f) => f.bs.some((b) => units.get(b.top)?.seat === perspective));
  const farRow = forms.some((f) => f.defSeat !== perspective) || forms.some((f) => f.bs.some((b) => units.get(b.top)?.seat !== perspective));
  const side = (f: Formation): "near" | "far" => (f.defSeat === perspective ? "near" : "far");
  const blockSide = (b: Unit): "near" | "far" => (units.get(b.top)?.seat === perspective ? "near" : "far");

  const planeAt = (step: number): number => {
    const c = proj.onTable((area.l + area.r) / 2, (area.t + area.b) / 2, 0), e = proj.eye;
    return e.y + (c.y - e.y) / step;
  };
  const cx0 = (area.l + area.r) / 2;
  /** On the plane at height h: a card's width and height on screen with its foot at screen height y (upright). */
  const measure = (h: number) => {
    const wide = (y: number): number => {
      const c = proj.onTable(cx0, y, h);
      return Math.abs(proj.project(add(c, proj.right, (CW * S_TABLE) / 2)).x - proj.project(add(c, proj.right, (-CW * S_TABLE) / 2)).x);
    };
    const tall = (y: number): number => {
      const c = proj.onTable(cx0, y, h), up = { x: 0, y: Math.cos(proj.pitch), z: -Math.sin(proj.pitch) };
      return Math.abs(proj.project(c).y - proj.project(add(c, up, CH * S_TABLE)).y);
    };
    return { wide, tall };
  };
  interface Laid {
    readonly step: number;
    readonly h: number;
    readonly feet: { readonly far: number; readonly atk: number; readonly near: number };
    readonly m: ReturnType<typeof measure>;
  }
  const g = CLASH.gap * u;
  /** The rows' feet at a step, or null when they do not fit the area's height. */
  const rows = (step: number): Laid | null => {
    const h = planeAt(step), m = measure(h);
    let y = area.b;
    const near = y;
    if (nearRow) y = y - m.tall(y) - g;
    const atk = y;
    y = y - m.tall(y);
    const far = y - g;
    if (farRow) y = far - m.tall(far) - 14 * u; // a far row allows one attachment strip over it
    return y >= area.t - 2 * u ? { step, h, feet: { far, atk, near }, m } : null;
  };
  /** A column's width at a layout: its widest row. */
  const span = (l: Laid, f: Formation): number => {
    const { m, feet } = l;
    const atkW = m.wide(feet.atk) * (1 + 0.12 * (f.ks.length > 1 ? 1 : 0));
    const slots = { near: 0, far: 0 };
    for (const b of f.bs) slots[blockSide(b)] += m.wide(feet[blockSide(b)]) + (slots[blockSide(b)] ? g : 0);
    const own = slots[side(f)] || m.wide(feet[side(f)]);
    return Math.max(atkW, own, slots.near, slots.far);
  };
  /** The width a wing's planeswalker adds at its end (on its controller's side). */
  const walkerSpan = (l: Laid, d: Defender): number => {
    const wk = walkers.get(defKey(d));
    return wk ? CLASH.columnGap * u + l.m.wide(l.feet[wk.seat === perspective ? "near" : "far"]) : 0;
  };
  const widthOf = (l: Laid, fs: readonly Formation[], extra = 0): number => {
    const ws = wingsOf(fs);
    return ws.reduce((t, w) => t + w.fs.reduce((s, f) => s + span(l, f), 0) + CLASH.columnGap * u * (w.fs.length - 1) + walkerSpan(l, w.fs[0]!.defender), 0) + CLASH.wingGap * u * (ws.length - 1) + extra;
  };
  let laid: Laid | null = null, kept = forms, more: Formation[] = [];
  for (const step of CLASH_STEPS) {
    const l = rows(step);
    if (l && forms.length <= CLASH.maxColumns && widthOf(l, forms) <= area.r - area.l) {
      laid = l;
      break;
    }
  }
  if (!laid) {
    // Past one tier at the smallest step: as many columns as fit, then one "more" column for the rest.
    const l = rows(CLASH_STEPS.at(-1)!) ?? rows(1);
    if (!l) return { ...none, wings: tableWings() };
    laid = l;
    const extra = l.m.wide(l.feet.atk) + CLASH.wingGap * u;
    let n = Math.min(forms.length - 1, CLASH.maxColumns - 1);
    while (n > 0 && widthOf(l, forms.slice(0, n), extra) > area.r - area.l) n--;
    kept = forms.slice(0, n);
    more = forms.slice(n);
  }
  const { m, feet, h } = laid;
  const at = (sx: number, sy: number) => proj.onTable(sx, sy, h);
  const placed = new Map<string, V3>();
  const quadAt = (x: number, foot: number, w: number, tall: number): Quad => [
    { x: x - w / 2, y: foot - tall },
    { x: x + w / 2, y: foot - tall },
    { x: x + w / 2, y: foot },
    { x: x - w / 2, y: foot },
  ];
  const width = widthOf(laid, kept, more.length ? m.wide(feet.atk) + CLASH.wingGap * u : 0);
  let x = cx0 - width / 2;
  const wings: ClashWing[] = [];
  for (const w of wingsOf(kept)) {
    const x0 = x, columns: ClashColumn[] = [];
    w.fs.forEach((f, i) => {
      if (i) x += CLASH.columnGap * u;
      const sw = span(laid, f), cx = x + sw / 2;
      // twins: a small stack, each a little up and right of the one under it
      f.ks.forEach((k, j) => placed.set(k.id, at(cx + j * 0.06 * m.wide(feet.atk), feet.atk - j * 0.04 * m.tall(feet.atk))));
      const bys = { near: f.bs.filter((b) => blockSide(b) === "near"), far: f.bs.filter((b) => blockSide(b) === "far") };
      for (const s of ["near", "far"] as const) {
        const bw = m.wide(feet[s]), tot = bys[s].length * bw + g * Math.max(0, bys[s].length - 1);
        bys[s].forEach((b, j) => placed.set(b.id, at(cx - tot / 2 + bw / 2 + j * (bw + g), feet[s])));
      }
      const own = side(f), sy = feet[own];
      const slot = !f.blocked ? quadAt(cx, sy, m.wide(sy), m.tall(sy)) : null;
      const clasp = f.blocked ? { x: cx, y: own === "near" ? feet.atk + g / 2 : feet.far + g / 2 } : null;
      columns.push({ unit: f.ks[0]!.id, attackers: f.ks.flatMap((k) => k.members), blockers: f.bs.flatMap((b) => b.members), x: cx, w: sw, slot, clasp, power: f.ks.reduce((s, k) => s + powerOf(k), 0), blocked: f.blocked });
      x += sw;
    });
    const wk = walkers.get(defKey(w.fs[0]!.defender));
    let walker: ClashWing["walker"];
    if (wk) {
      const row = wk.seat === perspective ? "near" : "far", ww = m.wide(feet[row]);
      x += CLASH.columnGap * u;
      placed.set(wk.unit.id, at(x + ww / 2, feet[row]));
      walker = { unit: wk.unit.id, card: wk.unit.top, x: x + ww / 2, top: feet[row] - m.tall(feet[row]) };
      x += ww;
    }
    const top = (farRow ? feet.far - m.tall(feet.far) : feet.atk - m.tall(feet.atk)) - 6 * u;
    wings.push({
      attacker: w.fs[0]!.from,
      defender: w.fs[0]!.defender,
      defenderSeat: w.fs[0]!.defSeat,
      plaque: { x: (x0 + x) / 2, y: Math.min(top, safe.top + (CLASH.plaqueTop + CLASH.plaqueH / 2) * u) },
      w: x - x0,
      unblocked: columns.filter((c) => !c.blocked).reduce((t, c) => t + c.power, 0),
      columns,
      ...(walker ? { walker } : {}),
    });
    x += CLASH.wingGap * u;
  }
  const moreAt = more.length ? quadAt(x + m.wide(feet.atk) / 2, feet.atk, m.wide(feet.atk), m.tall(feet.atk)) : null;
  // The "more" wing still counts in its wing's tally: its attackers are unblocked or not as they are.
  for (const f of more) {
    const w = wings.find((x) => x.attacker === f.from && defKey(x.defender) === defKey(f.defender));
    if (w && !f.blocked) wings[wings.indexOf(w)] = { ...w, unblocked: w.unblocked + f.ks.reduce((s, k) => s + powerOf(k), 0) };
  }

  const standing = (un: Unit): Unit => {
    const { turn: _turn, ...rest } = un;
    void _turn;
    return { ...rest, tapped: false, fighting: true, placement: { pos: placed.get(un.id)!, scale: S_TABLE, posture: "stand" as const } };
  };
  const moved = plans.map((p) => {
    const out = [...units.values(), ...walkerUnits.values()].filter((f) => f.seat === p.seat && carved.has(f.unit.id) && placed.has(f.unit.id)).map((f) => f.unit);
    if (!out.length && !p.units.some((un) => placed.has(un.id))) return p;
    // the carved fighters leave the units that held them (an emptied one is gone)
    const gone = new Map<UnitId, Set<CardId>>();
    for (const un of out) {
      const from = carved.get(un.id)!.from;
      gone.set(from, new Set([...(gone.get(from) ?? []), un.top]));
    }
    const units2: Unit[] = [];
    for (const un of p.units) {
      const gn = gone.get(un.id);
      if (!gn) units2.push(placed.has(un.id) ? standing(un) : un);
      else {
        const members = un.members.filter((id) => !gn.has(id));
        if (members.length) units2.push({ ...un, members, top: gn.has(un.top) ? members[0]! : un.top, title: un.kind === "summary" ? `All ${members.length}` : un.title });
      }
    }
    units2.push(...out.map(standing));
    const home = new Map(p.home);
    for (const un of out) home.set(un.top, un.id);
    return { ...p, units: units2, home };
  });
  const inside = new Set(kept.flatMap((f) => [...f.ks, ...f.bs]).flatMap((un) => un.members));
  const cols = wings.flatMap((w) => w.columns);
  const walkerXs = wings.flatMap((w) => (w.walker ? [w.walker.x - m.wide(feet.near) / 2, w.walker.x + m.wide(feet.near) / 2] : []));
  const extent = {
    l: Math.min(...cols.map((c) => c.x - c.w / 2), ...walkerXs, ...(moreAt ? [moreAt[0].x] : [])),
    r: Math.max(...cols.map((c) => c.x + c.w / 2), ...walkerXs, ...(moreAt ? [moreAt[1].x] : [])),
    t: farRow ? feet.far - m.tall(feet.far) : feet.atk - m.tall(feet.atk),
    b: nearRow ? feet.near : feet.atk,
  };
  return {
    plans: moved,
    form: "clash",
    area,
    extent,
    step: laid.step,
    wings,
    more: more.flatMap((f) => [...f.ks, ...f.bs].flatMap((un) => un.members)),
    moreAt,
    focus: true,
    left: [...want].filter((id) => !inside.has(id)),
  };
}
