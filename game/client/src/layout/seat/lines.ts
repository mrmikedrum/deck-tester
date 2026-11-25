import { FLOOR } from "../board";
import type { BoardCard } from "../board";
import { Ledger } from "../ledger";
import type { Fixtures, LayoutMemory, Muster, Note, Placement, SeatInput, SeatLayout, SeatPlan, Unit } from "../seat";
import { SLIP_PX, bounds, cardMiddle, plateShape, unitShape, zoneShape } from "../shape";
import type { CardId, V3 } from "../types";
import { cardsOf, fold, kindWord } from "./fold";
import type { Draft, Like } from "./fold";
import { CH, CW, PLATE_IN, PLATE_S, bandSpan, clearBehind, clearOfHand, floorScale, makeGeo, zoneSide } from "./geometry";
import type { Geo, Region } from "./geometry";
import { mat } from "./mat";

// `lines` (battle lines): every seat keeps one ready line, ruled on its page, where its untapped creatures stand. Past
// the line's room creatures file: the lesser ones stand behind a front, each showing only its head over the shoulder of
// the card in front (real standees further back: the camera does the shingling). Identical cards are one card with a
// count coin and its copies' edges behind it. A tapped creature lies down, turned, behind the files (the spent row);
// behind that the support row, and at the back the plaque, its zones and the land heap. The page is the whole slot.
// My own side keeps mat's support and wells; only my creatures take the line.

/** Columns are this many card widths apart (a card and its gap). */
const PITCH = 1.1;
/** How much of a card shows above the one in front of it, as a share of its height on screen: its head. */
const HEAD_SHOW = 0.34;
/** A run's copies show as card edges behind it, each this much of a card higher; at most this many. */
export const EDGE = { step: 0.022, most: 6 } as const;
/** Heads behind each front, before pressure: across, the sides, mine. */
const DEPTH = { across: 2, side: 3, near: 2 } as const;
/** Most columns: mine, theirs. */
const MOST = { me: 13, them: 6 } as const;
/** A front's preferred scale while few (as mat's creatures). */
const PREF = { me: 1.45, them: 1.3 } as const;
/** A shingled spent card shows at least this much of its left end (CSS px at the design unit). */
const SHINGLE_PX = 50;
/** Sharing a row with the support, the heap is compact: each card shows this much of its left end. */
const COMPACT_PX = 24;
/** A support card behind another shows its name strip: this share of it. */
const SUPPORT_SHOW = 0.3;
/** The land heap's scale floor (lying). */
const HEAP_S = 1.0;

const COMBAT = new Set(["flying", "trample", "deathtouch", "menace", "lifelink", "first strike", "double strike", "indestructible", "hexproof"]);
const has = (c: BoardCard, k: string): boolean => c.keywords.some((x) => x.toLowerCase() === k);

/** Cards identical to the eye (mat's groups, less tapped: a run is all ready or all spent). */
interface Run {
  ids: CardId[];
  rep: BoardCard;
  /** Its weight: who stands in front. */
  w: number;
  /** It acts now (aimed at, in a fight): it stands alone. */
  acting: boolean;
}

interface Memory {
  /** Each creature's column, as last planned. */
  col: Record<string, number>;
  /** How many columns there were, and whether each run had its own (few). */
  k: number;
  few: boolean;
  /** Each card's unit id, so a run that loses its first card keeps its id. */
  uid: Record<string, string>;
  /** My support and wells are mat's: its memory. */
  mat: LayoutMemory | null;
}

const readMemory = (m: LayoutMemory | null): Memory | null => (m && m.paradigm === "lines" && m.v === 1 ? (m.fit as Memory) : null);

function weight(r: { rep: BoardCard; ids: readonly CardId[] }, dressed: boolean): number {
  const c = r.rep;
  const notable = c.legendary || dressed || c.keywords.some((k) => COMBAT.has(k.toLowerCase()));
  return (c.commander ? 1e4 : 0) + (notable ? 1e3 : 0) + (c.power ?? 0) * 20 + (c.toughness ?? 0) + Math.min(9, r.ids.length) * 0.1;
}

const arrived = (a: BoardCard, b: BoardCard): number => Number(b.commander) - Number(a.commander) || a.id - b.id;

function runsOf(list: readonly BoardCard[], hosts: ReadonlySet<CardId>, involved: ReadonlySet<CardId>): Run[] {
  const out: Run[] = [], by = new Map<string, Run>();
  for (const c of list.slice().sort(arrived)) {
    const alone = hosts.has(c.id) || c.commander || involved.has(c.id);
    const k = c.sig;
    const run = alone ? undefined : by.get(k);
    if (run) run.ids.push(c.id);
    else {
      const r: Run = { ids: [c.id], rep: c, w: 0, acting: involved.has(c.id) };
      out.push(r);
      if (!alone) by.set(k, r);
    }
  }
  for (const r of out) r.w = weight(r, hosts.has(r.rep.id));
  return out;
}

/** A point of the region: across `u`, `a` deep from its fixed edge. */
const at = (g: Geo, r: Region, u: number, a: number): V3 => g.toWorld(r, u, r.d / 2 - a);
/** Region coordinates of a table point (toWorld undone): across, and depth from the fixed edge. */
function regionOf(r: Region, p: V3): { u: number; a: number } {
  const dx = p.x - r.x, dz = p.z - r.z, c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return { u: dx * c - dz * s, a: r.d / 2 - (dx * s + dz * c) };
}

/** The scale a card needs at `pos` to be `px` wide (two rounds: its size moves where its middle is). */
const scaleAt = (g: Geo, pos: V3, px: number, flat = false, s0 = 1.2): number => {
  let s = s0;
  for (let i = 0; i < 3; i++) s = floorScale(g, pos, px, flat, s);
  return s;
};

/** Screen y (CSS px) of the top of a card standing at `pos`, `tall` card heights tall (its edges included). */
const topY = (g: Geo, pos: V3, s: number, tall = CH, posture: Placement["posture"] = "stand"): number => {
  const p: Placement = { pos, scale: s * tall, posture };
  const m = cardMiddle(g.proj, p, false), base = posture === "stand" ? { ...pos, y: pos.y + 0.02 } : pos;
  return g.proj.project({ x: 2 * m.x - base.x, y: 2 * m.y - base.y, z: 2 * m.z - base.z }).y;
};
const footY = (g: Geo, pos: V3): number => g.proj.project(pos).y;

/** How tall a run stands with its copies' edges above it, in card heights. */
const tallOf = (n: number): number => CH * (1 + EDGE.step * Math.min(EDGE.most, Math.max(0, n - 1)));

interface Placed {
  run: Run;
  a: number;
  s: number;
  y: number;
  rank: number;
  raised: boolean;
}

/**
 * A file: its front at depth `a0` (scale `s0`), each run behind it stepped back until its head shows HEAD_SHOW of a card
 * over the one in front, its scale holding the floor's width there. A run that acts is raised until its foot clears the
 * top of the card in front of it.
 */
function fileOf(g: Geo, r: Region, u: number, a0: number, s0: number, runs: readonly Run[], px: number, posture: "stand" | "lean" = "stand", show = HEAD_SHOW): Placed[] {
  const out: Placed[] = [];
  let a = a0, s = s0;
  runs.forEach((run, i) => {
    if (i > 0) {
      const prev = out[i - 1]!, pp = at(g, r, u, prev.a);
      const top = topY(g, pp, prev.s, tallOf(prev.run.ids.length), posture);
      const h = footY(g, pp) - topY(g, pp, prev.s, CH, posture);
      const want = top - h * show;
      // (want: the top of this card, so `show` of it shows above the edges of the one in front)
      let lo = prev.a, hi = prev.a + 6;
      for (let it = 0; it < 22; it++) {
        const m = (lo + hi) / 2, pm = at(g, r, u, m), sm = scaleAt(g, pm, px, false, prev.s);
        if (topY(g, pm, sm, CH, posture) > want) lo = m;
        else hi = m;
      }
      a = hi;
      s = scaleAt(g, at(g, r, u, a), px, false, prev.s);
    }
    let y = 0;
    if (run.acting && i > 0) {
      const prev = out[i - 1]!, pp = at(g, r, u, prev.a), clear = topY(g, pp, prev.s, tallOf(prev.run.ids.length)) - 4;
      const base = at(g, r, u, a);
      let lo = 0, hi = 4;
      for (let it = 0; it < 22; it++) {
        const m = (lo + hi) / 2;
        if (footY(g, { ...base, y: m }) > clear) lo = m;
        else hi = m;
      }
      y = hi;
    }
    out.push({ run, a, s, y, rank: i, raised: run.acting && i > 0 });
  });
  return out;
}

/** Ids: a run keeps the id most of its cards had (a pile that loses its first card is still the same pile). */
class Ids {
  private used = new Set<string>();
  constructor(private readonly prev: Record<string, string>) {}
  take(prefix: string, ids: readonly CardId[]): string {
    const had = ids.map((id) => this.prev[String(id)]).filter((x): x is string => !!x && x[0] === prefix && !this.used.has(x));
    const own = had.find((x) => ids.includes(+x.slice(1) as CardId)) ?? had[0];
    const id = own ?? (this.used.has(prefix + ids[0]) ? `${prefix}${ids[0]}.${this.used.size}` : prefix + ids[0]);
    this.used.add(id);
    return id;
  }
}

function plan(input: SeatInput): SeatPlan {
  const { board, region: r, projector, reserve, involved } = input;
  const me = board.mine;
  const g = makeGeo(projector, reserve, me ? FLOOR.mine : FLOOR.theirs);
  const mem = readMemory(input.memory);
  const cards = cardsOf(board.cards);

  // Auras and Equipment ride on their host's card, as on mat.
  const onSeat = new Set(board.cards.map((c) => c.id));
  const dressedBy = new Map<CardId, CardId[]>();
  const attached = new Set<CardId>();
  for (const c of board.cards)
    if (c.attachedTo !== null && onSeat.has(c.attachedTo)) {
      attached.add(c.id);
      dressedBy.set(c.attachedTo, (dressedBy.get(c.attachedTo) ?? []).concat([c.id]));
    }
  const bf = board.cards.filter((c) => !attached.has(c.id));
  const hosts = new Set(dressedBy.keys());
  const creatures = bf.filter((c) => c.creature);
  const ready = runsOf(creatures.filter((c) => !c.tapped), hosts, involved);
  const spent = runsOf(creatures.filter((c) => c.tapped), hosts, involved);
  const ids = new Ids(mem?.uid ?? {});
  const units: Unit[] = [];
  const dressOf = (run: Run): CardId[] => run.ids.flatMap((id) => dressedBy.get(id) ?? []);
  const notes: Note[] = [];
  let shingled = false;

  // ---- my side: mat's support and wells, my creatures on the line --------------------------------------------------
  let matPlan: SeatPlan | null = null;
  let aLine: number;
  if (me) {
    // Mat plans my whole side as today; I keep its support and wells (folded as they would be beside my creatures) and
    // stand my line where its creatures' row stood.
    matPlan = mat.plan({ ...input, memory: mem?.mat ?? null });
    const theirs = matPlan.units.filter((u) => u.role === "creature");
    units.push(...matPlan.units.filter((u) => u.role !== "creature"));
    const hi = theirs.length ? Math.min(...theirs.map((u) => regionOf(r, u.placement.pos).a)) : clearOfHand(g, r) + 0.6;
    aLine = Math.max(clearOfHand(g, r) + 0.1, hi);
  } else aLine = 0.45;

  // ---- the ready line and its files ----------------------------------------------------------------------------------
  const px = me ? FLOOR.mine : FLOOR.theirs;
  const whole = bandSpan(g, r, me, aLine);
  // Mine: my page has no depth to spare between my line and my hand, so what I have tapped lies turned at the right end
  // of my own line, pushed aside (shingled when it must), and the line's fronts take the rest.
  let span = whole;
  if (me && spent.length) {
    const sS = scaleAt(g, at(g, r, whole.hi - 1, aLine + 0.5), FLOOR.mine);
    // (Room first for every ready run at the floor; the heap shingles into what is left.)
    const sF = scaleAt(g, at(g, r, whole.uc, aLine), FLOOR.mine);
    const fronts = Math.min(MOST.me, ready.length) * sF * CW * PITCH;
    const wS = Math.max(CH * sS * 1.5, Math.min(spent.length * CH * sS * 1.05, whole.w - fronts - 0.3));
    span = { lo: whole.lo, hi: whole.hi - wS - 0.3, w: whole.w - wS - 0.3, uc: (whole.lo + whole.hi - wS - 0.3) / 2 };
    layoutSpent(aLine - 0.15, sS, { lo: whole.hi - wS, hi: whole.hi, w: wS, uc: whole.hi - wS / 2 });
  }
  const sFloor = scaleAt(g, at(g, r, span.uc, aLine), px);
  const K = Math.max(1, Math.min(me ? MOST.me : MOST.them, Math.floor(span.w / (sFloor * CW * PITCH))));
  const depth0 = me ? DEPTH.near : r.position === "across" ? DEPTH.across : DEPTH.side;
  const few = ready.length <= K;
  const colOf = (run: Run): number | null => {
    if (!mem || mem.few !== few || (!few && mem.k !== K)) return null;
    const votes = run.ids.map((id) => mem.col[String(id)]).filter((x): x is number => x !== undefined);
    if (!votes.length) return null;
    const n = new Map<number, number>();
    votes.forEach((v) => n.set(v, (n.get(v) ?? 0) + 1));
    return [...n.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]![0];
  };
  let cols: Run[][];
  if (few) {
    // Few: every run a front, bigger than the floor, in the order it came (a card that stays keeps its side).
    const order = ready.slice().sort((x, y) => (colOf(x) ?? 1e3) - (colOf(y) ?? 1e3) || arrived(x.rep, y.rep));
    cols = order.map((run) => [run]);
  } else {
    cols = Array.from({ length: K }, () => [] as Run[]);
    const byW = ready.slice().sort((x, y) => y.w - x.w || arrived(x.rep, y.rep));
    const free: Run[] = [];
    for (const run of byW) {
      const c = colOf(run);
      if (c !== null && c < K) cols[c]!.push(run);
      else free.push(run);
    }
    const fresh = !mem || mem.few !== few || mem.k !== K;
    free.forEach((run, i) => {
      if (fresh) return void cols[i % K]!.push(run);
      // A newcomer joins its namesake's file; else an empty column; else the file whose front it outweighs (lightest
      // front first); else the shortest file.
      const name = cols.findIndex((c) => c.some((x) => x.rep.name === run.rep.name));
      if (name >= 0) return void cols[name]!.push(run);
      const empty = cols.findIndex((c) => !c.length);
      if (empty >= 0) return void cols[empty]!.push(run);
      const front = (c: Run[]) => Math.max(...c.map((x) => x.w));
      const lightest = cols.map((c, i) => [i, front(c)] as const).sort((x, y) => x[1] - y[1])[0]!;
      if (run.w > lightest[1]) return void cols[lightest[0]]!.push(run);
      const shortest = cols.map((c, i) => [i, c.length, front(c)] as const).sort((x, y) => x[1] - y[1] || x[2] - y[2])[0]!;
      cols[shortest[0]]!.push(run);
    });
    cols.forEach((c) => c.sort((x, y) => y.w - x.w || arrived(x.rep, y.rep)));
    cols = cols.filter((c) => c.length);
  }
  const n = cols.length;
  const sFront = few ? Math.max(sFloor, Math.min(me ? PREF.me : PREF.them, span.w / Math.max(1, n) / (CW * PITCH))) : sFloor;
  const pitch = Math.max(sFront * CW * PITCH, few ? 0 : span.w / Math.max(1, n));
  const uOf = (i: number): number => span.uc + (i - (n - 1) / 2) * Math.min(pitch, span.w / Math.max(1, n));

  // How deep the files may go: behind them the spent row, the support row, and the slip under the plaque must still fit
  // (theirs), so heads give way first, under the table's pressure and then by depth.
  const back = me ? null : backBand();
  const fits = (S: number) => {
    const placed = cols.map((c, i) => {
      // (Pressed past every head, a file closes up into its front: one pile of what it holds.)
      if (S < 0 && c.length > 1) {
        const all: Run = { ids: c.flatMap((x) => x.ids), rep: c[0]!.rep, w: c[0]!.w, acting: false };
        return { f: fileOf(g, r, uOf(i), aLine, sFront, [all], px), rearguard: null, closed: c };
      }
      const shown = c.slice(0, S + 1), rest = c.slice(S + 1);
      // (Past S heads the lightest fold into one rearguard behind the last; one alone is just a head.)
      const rear: Run | null = rest.length > 1 ? { ids: rest.flatMap((x) => x.ids), rep: rest[0]!.rep, w: 0, acting: false } : (rest[0] ?? null);
      return { f: fileOf(g, r, uOf(i), aLine, sFront, rear ? [...shown, rear] : shown, px), rearguard: rest.length > 1 ? rest : null, closed: null };
    });
    let behind = aLine + 0.5;
    placed.forEach(({ f }) => {
      const last = f[f.length - 1]!;
      behind = Math.max(behind, clearBehind(g, r, last.a, last.s, tallOf(last.run.ids.length)));
    });
    return { placed, back: behind };
  };
  /** The spent row from its near edge: its scale (a lying card as wide as a creature's floor), and its far edge. */
  const spentGeo = (a0: number) => {
    const sS = scaleAt(g, at(g, r, 0, a0 + 0.5), px);
    return { sS, far: a0 + CW * sS + (me ? 0 : 0.38) };
  };
  const supportGeo = (a0: number) => {
    const foot = a0 + 0.1, s = Math.max(0.9, scaleAt(g, at(g, r, 0, foot), FLOOR.any));
    return { foot, s, top: topY(g, at(g, r, 0, foot), s, CH, "lean") };
  };
  const sup = me ? [] : support();
  // Ways to fit, loosest first: the spent heap and the support in rows of their own, or sharing one row (the heap at the
  // outer end, compact), each with as many heads as fit.
  // (The first notch of pressure folds the support's title columns; heads give way from the second.)
  const S0 = Math.max(-1, Math.min(depth0, Math.max(0, ...cols.map((c) => c.length - 1))) - Math.max(0, input.pressure - 1));
  const ways: { S: number; shared: boolean }[] = [];
  for (let k = S0; k >= Math.min(0, S0); k--) ways.push({ S: k, shared: false }, { S: k, shared: true });
  const fitsBack = (w: { S: number; shared: boolean }, f: ReturnType<typeof fits>): boolean => {
    if (!back) return true;
    let a = f.back + 0.1;
    if (spent.length && (!w.shared || !sup.length)) a = spentGeo(a).far + 0.15;
    if (sup.length) return supportGeo(a).top >= back.slipY + 2;
    return footY(g, at(g, r, 0, a)) >= back.slipY + 2;
  };
  let way = ways[0]!, files = fits(way.S);
  if (back)
    for (const w of ways) {
      const f = w.S === way.S ? files : fits(w.S);
      way = w;
      files = f;
      if (fitsBack(w, f)) break;
    }
  const S = way.S;
  void S;

  let folded = 0;
  files.placed.forEach(({ f, rearguard, closed }, ci) => {
    const fileId = `${board.seat}:${ci}`, u = uOf(ci);
    for (const p of f) {
      const run = p.run, rear = !!rearguard && p === f[f.length - 1];
      if (rear) folded += rearguard.length - 1;
      if (closed) {
        folded += closed.length - 1;
        units.push({
          id: ids.take("c", run.ids),
          role: "creature",
          kind: "pile",
          members: run.ids,
          dressing: closed.flatMap(dressOf),
          top: run.rep.id,
          title: `Creatures ${run.ids.length}`,
          mixed: true,
          acting: false,
          tapped: false,
          placement: { pos: at(g, r, u, p.a), scale: p.s, posture: "stand" },
          file: { id: fileId, rank: 0 },
        });
        continue;
      }
      units.push({
        id: ids.take(rear ? "r" : "c", run.ids),
        role: "creature",
        kind: run.ids.length > 1 ? "pile" : "card",
        members: run.ids,
        dressing: rear ? rearguard.flatMap(dressOf) : dressOf(run),
        top: run.rep.id,
        title: null,
        mixed: rear,
        acting: run.acting,
        tapped: false,
        placement: { pos: { ...at(g, r, u, p.a), y: p.y }, scale: p.s, posture: "stand" },
        file: { id: fileId, rank: p.rank },
        ...(p.raised ? { raised: true } : {}),
        ...(p.rank > 0 && !p.raised ? { head: true } : {}),
        ...(run.ids.length > 1 && !rear ? { coin: true } : {}),
        // (A rearguard's head says what it holds, "+6 · 9 power", not its first card's name.)
        ...(rear ? { rearguard: rearOf(rearguard) } : {}),
      });
    }
  });
  const line = { a: at(g, r, span.lo + 0.1, aLine), b: at(g, r, span.hi - 0.1, aLine) };

  // ---- theirs: the spent row, the support row, the back band --------------------------------------------------------
  let fixtures: Fixtures;
  if (!me && back) {
    let a = files.back + 0.1;
    const whole = bandSpan(g, r, false, a + 0.5);
    if (spent.length && way.shared && sup.length) {
      // One row: the spent heap compact at the outer end, the support beside it.
      const sS = spentGeo(a).sS, side = zoneSide(false, r.x);
      const m0 = at(g, r, whole.uc, a + 0.5), pxPer = (g.proj.project({ ...m0, x: m0.x + 0.5 }).x - g.proj.project({ ...m0, x: m0.x - 0.5 }).x) / g.u;
      const wS = Math.min(whole.w * 0.45, CH * sS + (spent.length - 1) * (COMPACT_PX / pxPer));
      const heap = side > 0 ? { lo: whole.lo, hi: whole.lo + wS } : { lo: whole.hi - wS, hi: whole.hi };
      const rest = side > 0 ? { lo: whole.lo + wS + 0.25, hi: whole.hi } : { lo: whole.lo, hi: whole.hi - wS - 0.25 };
      layoutSpent(a, sS, { ...heap, w: wS, uc: (heap.lo + heap.hi) / 2 }, true);
      layoutSupport(supportGeo(a), { ...rest, w: rest.hi - rest.lo, uc: (rest.lo + rest.hi) / 2 }, back.slipY + 2);
    } else {
      if (spent.length) {
        layoutSpent(a, spentGeo(a).sS);
        a = spentGeo(a).far + 0.15;
      }
      if (sup.length) layoutSupport(supportGeo(a), undefined, back.slipY + 2);
    }
    back.heap();
    fixtures = back.fixtures;
  } else fixtures = { ...matPlan!.fixtures };

  // The muster slip: once the board is past a glance (a head, a heap of spent cards).
  const heads = units.some((u) => u.head);
  const muster = heads || (shingled && !me) || (!me && spent.length > 0) ? musterOf(creatures) : null;
  const page: Fixtures["page"] = { pos: at(g, r, 0, r.d / 2), w: r.w, d: r.d, yaw: r.yaw };
  fixtures = { ...fixtures, page, ...(creatures.length || !me ? { line } : {}), ...(notes.length ? { notes } : {}), ...(muster ? { muster } : {}) };

  const col: Record<string, number> = {};
  cols.forEach((c, i) => c.forEach((run) => run.ids.forEach((id) => (col[String(id)] = i))));
  // (A spent creature keeps the column it left, for when it stands back up.)
  for (const run of spent) for (const id of run.ids) if (mem?.col[String(id)] !== undefined && col[String(id)] === undefined) col[String(id)] = mem.col[String(id)]!;
  const uid: Record<string, string> = {};
  for (const u of units) for (const id of u.members) uid[String(id)] = u.id;
  const memory: LayoutMemory = { v: 1, paradigm: "lines", fit: { col, k: K, few, uid, mat: matPlan?.memory ?? null } satisfies Memory };
  return new Ledger(board.cards.map((c) => c.id)).seal({
    seat: board.seat,
    units,
    fixtures,
    memory,
    report: { folded: folded + (matPlan?.report.folded ?? 0), held: false, pressure: input.pressure, overflow: false, lastResort: false },
  });

  // ---- the spent row: tapped creatures lying turned, clear while they fit, else shingled; one heap to a tap ------------
  function layoutSpent(a0: number, sS: number, within?: { lo: number; hi: number; w: number; uc: number }, compact = false): void {
    const order = spent.slice().sort((x, y) => (colOf2(x) ?? 1e3) - (colOf2(y) ?? 1e3) || y.w - x.w);
    const aC = a0 + (CW * sS) / 2; // its middle's depth
    const sp = within ?? bandSpan(g, r, me, me ? a0 : aC);
    const len = CH * sS, clearStep = len * 1.05;
    const m0 = at(g, r, sp.uc, aC);
    const pxPer = (g.proj.project({ ...m0, x: m0.x + 0.5 }).x - g.proj.project({ ...m0, x: m0.x - 0.5 }).x) / g.u;
    const minStep = (compact ? COMPACT_PX : SHINGLE_PX) / pxPer;
    let row: Run[] = order;
    const fit = Math.max(1, Math.floor((sp.w - len) / minStep) + 1);
    if (row.length > fit) {
      // what doesn't fit even shingled lies in one heap at the end
      const keep = row.slice(0, fit - 1), rest = row.slice(fit - 1);
      row = [...keep, { ids: rest.flatMap((x) => x.ids), rep: rest[0]!.rep, w: 0, acting: false }];
    }
    const clear = row.length * clearStep <= sp.w;
    const step = clear ? clearStep : Math.min(clearStep, (sp.w - len) / Math.max(1, row.length - 1));
    shingled = !clear;
    const u0 = sp.uc - ((row.length - 1) * step) / 2;
    const fileId = `${board.seat}:spent`;
    row.forEach((run, i) => {
      const c = at(g, r, u0 + i * step, aC);
      // A lying card's placement is its near edge, its middle half a card behind; each lies a hair over the one before
      // it, so the left end of each, where its numbers are, shows when they shingle.
      const pos: V3 = { x: c.x, y: 0.004 * i, z: c.z + (CH * sS) / 2 + 0.002 * i };
      const mixed = new Set(run.ids.map((id) => cards.need(id).sig)).size > 1;
      units.push({
        id: ids.take("c", run.ids),
        role: "creature",
        kind: run.ids.length > 1 ? "pile" : "card",
        members: run.ids,
        dressing: dressOf(run),
        top: run.rep.id,
        title: mixed ? `Tapped ${run.ids.length}` : null,
        mixed,
        acting: run.acting,
        tapped: true,
        // (One aimed at props up to face me, a tap of its own.)
        placement: { pos: run.acting ? { ...pos, y: 0.15 } : pos, scale: sS, posture: run.acting ? "prop" : "flat" },
        // The heap is one pile to a tap: a lying card is too low on screen to be a target of its own.
        file: { id: fileId, rank: 1 },
        ...(run.acting ? { raised: true } : {}),
        ...(run.ids.length > 1 && !mixed ? { coin: true } : {}),
      });
    });
    if ((shingled || !me) && !compact) {
      const all = spent.flatMap((x) => x.ids.map((id) => cards.need(id)));
      const big = all.slice().sort((x, y) => (y.power ?? 0) - (x.power ?? 0))[0];
      notes.push({
        id: "spent",
        at: at(g, r, sp.uc, me ? a0 + CW * sS + 0.3 : a0 + CW * sS + 0.16),
        facts: {
          kind: "spent",
          count: all.length,
          power: all.reduce((t, c) => t + (c.power ?? 0), 0),
          big: big && (big.power ?? 0) >= 6 ? { name: big.name, p: big.power ?? 0, t: big.toughness ?? 0 } : null,
        },
      });
    }
  }
  function colOf2(run: Run): number | null {
    const v = run.ids.map((id) => mem?.col[String(id)]).find((x) => x !== undefined);
    return v ?? null;
  }

  // ---- the support row: planeswalkers first, then what else they have, folded by kind past its room ------------------
  function support(): BoardCard[] {
    return bf.filter((c) => !c.creature && !isMana(c)).sort((x, y) => Number(y.planeswalker) - Number(x.planeswalker) || arrived(x, y));
  }
  function layoutSupport(geo: { foot: number; s: number }, within?: { lo: number; hi: number; w: number; uc: number }, limitY: number | null = null): void {
    const list = sup, { foot, s } = geo;
    const sp = within ?? bandSpan(g, r, false, foot);
    const per = s * CW * 1.1;
    const cap = Math.max(1, Math.floor(sp.w / per) - Math.max(0, input.pressure - depth0));
    const drafts: Draft[] = [];
    const seen = new Map<string, Draft>();
    for (const c of list) {
      const k = c.planeswalker || hosts.has(c.id) ? null : c.sig;
      const d = k ? seen.get(k) : undefined;
      if (d) d.ids.push(c.id);
      else {
        const nd: Draft = { key: "s" + c.id, ids: [c.id], rep: c.id, role: c.planeswalker ? "walker" : "support" };
        drafts.push(nd);
        if (k) seen.set(k, nd);
      }
    }
    const likeS: Like[] = [(u) => cards.need(u.rep).name, (u) => (cards.need(u.rep).token ? "Tokens" : null), (u) => kindWord(cards.need(u.rep))];
    const named = (us: Draft[], title: string): Draft => ({ key: us[0]!.key, ids: us.flatMap((x) => x.ids), rep: us[0]!.rep, role: us[0]!.role, title });
    const keep = (u: Draft): boolean => cards.need(u.rep).planeswalker || cards.need(u.rep).legendary;
    // Past its room the support stands in columns of title bars (the front whole, the ones behind showing their names),
    // as deep as the page has room under the slip; what is left folds by kind.
    const asRun = (d: Draft): Run => ({ ids: d.ids, rep: cards.need(d.rep), w: 0, acting: false });
    const colsOf = (D: number) => {
      const row = fold(cards, drafts, cap * (1 + D), likeS, keep, named, "Others");
      const k = Math.min(cap, row.length), cs: Draft[][] = Array.from({ length: k }, () => []);
      row.forEach((d, i) => cs[i % k]!.push(d));
      const step = Math.min(per, sp.w / Math.max(1, k)), u0 = sp.uc - ((k - 1) * step) / 2;
      const placed = cs.map((c, i) => ({ u: u0 + i * step, f: fileOf(g, r, u0 + i * step, foot, s, c.map(asRun), FLOOR.any, "lean", SUPPORT_SHOW), c }));
      const top = Math.min(...placed.map(({ u, f }) => { const l = f[f.length - 1]!; return topY(g, at(g, r, u, l.a), l.s, CH, "lean"); }));
      return { placed, top };
    };
    // (Only two deep: one name strip behind a front is too short a tail to tap at the floor's size. Under the table's
    // pressure the columns go first.)
    const D = drafts.length >= 3 * cap && input.pressure === 0 ? 2 : 0;
    let layout = colsOf(D);
    if (D > 0 && limitY !== null && layout.top < limitY) layout = colsOf(0);
    layout.placed.forEach(({ u, f, c }, ci) => f.forEach((p, i) => {
      const d = c[i]!;
      const top = d.ids.length > 1 && d.title ? d.ids[Math.min(d.ids.length, 8) - 1]! : d.rep;
      const fileId = `${board.seat}:sup${ci}`;
      units.push({
        id: ids.take(d.role === "walker" ? "w" : "s", d.ids),
        role: d.role,
        kind: d.ids.length > 1 ? "pile" : "card",
        members: d.ids,
        dressing: d.ids.flatMap((id) => dressedBy.get(id) ?? []),
        top,
        title: d.title ?? null,
        mixed: !!d.title && new Set(d.ids.map((id) => cards.need(id).name)).size > 1,
        acting: false,
        tapped: cards.need(top).tapped,
        // (Propped a little, as my own support is: it lies back out of the way, its name still facing me.)
        placement: { pos: at(g, r, u, p.a), scale: p.s, posture: "lean" },
        ...(c.length > 1 ? { file: { id: fileId, rank: i } } : {}),
      });
    }));
  }

  // ---- their back band: the plaque at the back of the page, its zones on one side and the land heap on the other ------
  function backBand(): { fixtures: Fixtures; slipY: number; heap: () => void } {
    const fx = board.fixtures;
    // The plaque as far back as its top stays inside the page's back edge on screen.
    const edgeY = g.proj.project(at(g, r, 0, r.d)).y;
    let lo = r.d * 0.4, hi = r.d;
    for (let it = 0; it < 22; it++) {
      const m = (lo + hi) / 2, p = at(g, r, 0, m);
      // (Across, the page's back edge is the screen's top: there the plaque may take the screen's top margin.)
      const limit = r.position === "across" ? Math.max(g.proj.project(at(g, r, 0, r.d)).y - 30 * g.u, 6 * g.u) : edgeY + 10 * g.u;
      // (Across, the commander standing beside it stays on screen too.)
      const beside = r.position !== "across" ? true : (!fx.commandZone || topY(g, p, 1.05) > 6 * g.u);
      if (g.proj.project({ x: p.x, y: 0.84 * Math.cos(g.pitch) * PLATE_S, z: p.z - 0.84 * Math.sin(g.pitch) * PLATE_S }).y > limit && beside) lo = m;
      else hi = m;
    }
    // (A side page has open table behind it: there the plaque stands on its back edge, its top over the margin.)
    const aPlate = r.position === "across" ? Math.min(lo, r.d - PLATE_IN * 0.6) : r.d - 0.3;
    const plateFoot = at(g, r, 0, aPlate);
    // What stands in front keeps its top under the slip hanging from the plaque.
    const slipY = footY(g, plateFoot) + SLIP_PX * g.u;
    const nz = Math.max(1, Number(fx.graveyard > 0) + Number(fx.exile > 0));
    const zS = Math.max(0.8, scaleAt(g, plateFoot, FLOOR.any, false, 0.8));
    const half = 1.6 * PLATE_S, cmdOut = (2.2 + 0.32) * PLATE_S, zs = zoneSide(false, r.x), gap = Math.max(1.15, zS * CW + 0.4);
    const z0 = fx.commandZone ? cmdOut + 0.25 + gap / 2 : half + 0.2 + gap / 2;
    const zones = [...Array(nz).keys()].map((i) => z0 + i * gap);
    const eZ = Math.max(half, fx.commandZone ? cmdOut + 0.05 : 0, zones[zones.length - 1]! + gap / 2);
    const mana = bf.filter(isMana);
    // The land heap: propped a little off the page beside the plaque, as large as the floors ask there.
    const sL = Math.max(HEAP_S, scaleAt(g, plateFoot, FLOOR.any, false, HEAP_S));
    const hw = mana.length ? sL * CW + 0.35 : 0;
    // The heap lies on the far side of the plaque from the zones across; on a side page past the zones, toward the table's
    // middle (the plaque's other side is the screen's edge there).
    const across = r.position === "across";
    const zoneExt = across ? eZ : eZ + (hw ? 0.2 + hw : 0), otherExt = across ? half + (hw ? 0.2 + hw : 0) : half;
    const c = (-zs * (zoneExt - otherExt)) / 2;
    const plate: Placement = { pos: at(g, r, c, aPlate), scale: PLATE_S, posture: "stand" };
    const present = (["graveyard", "exile"] as const).filter((z) => fx[z] > 0);
    const zonesOut = present.map((zone, i) => ({ zone, placement: { pos: at(g, r, c + zs * zones[i]!, aPlate), scale: zS, posture: "prop" as const } }));
    let commander: Fixtures["commander"];
    if (fx.commander !== undefined) {
      const pos: V3 = { x: plate.pos.x + zs * 2.2 * PLATE_S, y: plate.pos.y, z: plate.pos.z - 0.06 };
      commander = { card: fx.commander, placement: { pos, scale: Math.max(0.9, floorScale(g, pos, FLOOR.any, false, 0.9)), posture: "stand" } };
    }
    const heap = (): void => {
      if (!mana.length) return;
      const lands = mana.filter((x) => x.land), open = mana.filter((x) => !x.tapped).length, rocks = mana.length - lands.length;
      const dir = across ? -zs : zs;
      let uH = across ? c - zs * (half + 0.2 + hw / 2) : c + zs * (eZ + 0.2 + hw / 2);
      // (As far back as its top stays on screen: across, the plaque is just under the screen's top.)
      let aH = aPlate - 0.1;
      const topOf = (a: number) => topY(g, at(g, r, uH, a), sL, CH, "lean");
      for (let k = 0; k < 40 && aH > 0 && topOf(aH) < 6 * g.u; k++) aH -= 0.1;
      // On screen it keeps clear of the plaque (and its slip) and the zones, sliding outward, never off the screen.
      const cardShapeAt = (pos: V3, sc: number) => cardShapeAtOf(g, pos, sc);
      const fixed = [plateShape(g.proj, board.seat, plate, undefined, SLIP_PX * g.u), ...zonesOut.map((z) => zoneShape(g.proj, board.seat, z.zone, z.placement, false))].map((x) => bounds(x.face));
      const box = (u: number) => bounds(cardShapeAt(at(g, r, u, aH), sL));
      const meets = (b: ReturnType<typeof bounds>) => fixed.some((f) => f.l < b.r + 4 && f.r > b.l - 4 && f.t < b.b && f.b > b.t);
      for (let k = 0; k < 40 && meets(box(uH)); k++) {
        const next = box(uH + dir * 0.1);
        if (next.l < 4 * g.u || next.r > g.proj.viewport.w - 4 * g.u) break;
        uH += dir * 0.1;
      }
      units.push({
        id: ids.take("m", mana.map((x) => x.id)),
        role: "mana",
        kind: "well",
        members: mana.slice().sort((x, y) => Number(y.land) - Number(x.land) || x.id - y.id).map((x) => x.id),
        dressing: [],
        top: (mana.find((x) => x.land) ?? mana[0]!).id,
        title: null,
        mixed: false,
        acting: false,
        tapped: false,
        placement: { pos: at(g, r, uH, aH), scale: sL, posture: "lean" },
        caption: { text: `Lands ${lands.length} · ${open} open`, sub: rocks ? `+ ${rocks} rock${rocks > 1 ? "s" : ""}` : null },
      });
    };
    const page: Fixtures["page"] = { pos: at(g, r, 0, r.d / 2), w: r.w, d: r.d, yaw: r.yaw };
    return { fixtures: { page, plate, zones: zonesOut, ...(commander ? { commander } : {}) }, slipY, heap };
  }
}

/** A lying-back card's face on screen (a land heap's), for keeping it clear of the back band. */
function cardShapeAtOf(g: Geo, pos: V3, s: number) {
  const u: Unit = { id: "probe", role: "mana", kind: "well", members: [], dressing: [], top: 0 as CardId, title: null, mixed: false, acting: false, tapped: false, placement: { pos, scale: s, posture: "lean" } };
  return unitShape(g.proj, "probe", u, false).face;
}

/** What a rearguard holds, as a player would say it: its biggest run by name, how many more, their power. */
function rearOf(runs: readonly Run[]): { count: number; power: number; lead: string; more: number } {
  const big = runs.slice().sort((x, y) => y.ids.length - x.ids.length || y.w - x.w)[0]!;
  const count = runs.reduce((t, x) => t + x.ids.length, 0);
  return { count, power: runs.reduce((t, x) => t + x.ids.length * (x.rep.power ?? 0), 0), lead: big.ids.length > 1 ? `${big.rep.name} ×${big.ids.length}` : big.rep.name, more: count - big.ids.length };
}

function isMana(c: BoardCard): boolean {
  return !c.creature && !c.planeswalker && !c.specialLand && (c.land || c.manaRock || c.treasure);
}

/** What a player would say their ready creatures add up to. */
function musterOf(creatures: readonly BoardCard[]): Muster {
  const rc = creatures.filter((c) => !c.tapped);
  const big = rc.slice().sort((a, b) => (b.power ?? 0) - (a.power ?? 0) || (b.toughness ?? 0) - (a.toughness ?? 0))[0];
  const n = (k: string) => rc.filter((c) => has(c, k)).length;
  return {
    ready: rc.length,
    power: rc.reduce((t, c) => t + (c.power ?? 0), 0),
    fly: n("flying"),
    reach: n("reach"),
    deathtouch: n("deathtouch"),
    trample: n("trample"),
    firstStrike: n("first strike") + n("double strike"),
    biggest: big ? [big.power ?? 0, big.toughness ?? 0] : null,
  };
}

export const lines: SeatLayout = { id: "lines", plan };
