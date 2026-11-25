import { FLOOR } from "../board";
import type { CardId } from "../types";
import { clearBehind, clearOfHand, bandSpan, floorScale, rowPlace, zoneSide, BACK, CH, CW, EDGE, GAP, PLATE_IN, PLATE_S, SIDE, STAGGER, TAB_H, TAP_LEAN } from "./geometry";
import type { BandKey, BandSpec, Geo, Region, Span } from "./geometry";
import { fold, holding, kindsOf, kindWord, topOf } from "./fold";
import type { Cards, Draft, Keep, Like } from "./fold";

// A seat's fit: the old `fitSeat`, ported. For each band its scale, places per row and rows, and its units folded to fit;
// and the page's size. Rows and scales come first, from the floors at the rows' places on screen; then each band folds
// into what it holds. The result is also the layout memory (plain JSON): the next fit consults it.

export interface Band extends BandSpec {
  k: BandKey;
  s: number;
  n: number;
  rows: number;
  perRow: number;
  a0: number;
  a1: number;
  cap: number;
  span?: Span | undefined;
  units?: Draft[] | undefined;
  // their well:
  w?: number | undefined;
  u?: number | undefined;
}

export interface Back0 {
  nz: number;
  cmd: boolean;
  zS: number;
}

export interface Fit {
  C: Band;
  S: Band;
  L: Band;
  host: boolean;
  W: number;
  D: number;
  /** How deep it asks to be, past its slot when crowded. */
  deep: number;
  over: boolean;
  /** How many units there were before folding. */
  fed: number;
  back: number;
  back0: Back0;
  place: { plate: number; zones: number[]; zS: number } | null;
  plateA: number;
  zoneBack: number;
  held?: boolean | undefined;
}

export interface FitArgs {
  C: Draft[];
  S: Draft[];
  L: Draft[];
  /** Zones with cards (graveyard, exile) and whether the commander waits in the command zone. */
  nz: number;
  cmd: boolean;
  settling: boolean;
  /** Fold this many notches harder. */
  pressure: number;
}

export interface FitCtx {
  readonly g: Geo;
  readonly cards: Cards;
  readonly region: Region;
  readonly me: boolean;
  /** Seat identity for the plaque side. */
  readonly keepOf: Keep;
  readonly prev: Fit | null;
  /**
   * A layout's own creature fold (the `die` layout's Ranks tray), in place of piling like creatures and then one mixed
   * pile. Its folds never send creatures to the support row or fold lone noncreatures after them.
   */
  readonly foldC?: (units: Draft[], cap: number, perRow: number) => Draft[];
  /** Piles wear title tabs (the mat's); false where nothing does (the `die` layout's trays say it on their dice). */
  readonly tabs?: boolean;
  /** Their graveyard and exile lie flat just behind the plaque's line (the `die` layout), sized lying. */
  readonly flatZones?: boolean;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** Behind a band that lies flat, the plaque's piles keep clear of it: propped from half a card in front of the plaque, or
 * lying behind its line. */
const LYING_CLEAR = { propped: 0.5, flat: 0.15 } as const;

const stats = (c: { name: string; power: number | null; toughness: number | null }): string => `${c.name}|${c.power}/${c.toughness}`;

// Places in a row, centre out (seatPlaces et al.): where place i of a band stands across (region u): rows centred on the
// band's span, odd rows staggered.
export const rowCentre = (B: Band, row: number): number => (B.span?.uc ?? 0) + (B.rows > 1 ? (row % 2 ? 0.5 : -0.5) * STAGGER * B.s : 0);
/** A support row's place beside one card lying turned: CH/2 + CW/2 - CH/6 * 0.2, and a little to spare. */
const TURNED_PER = 0.86;

export const rowU = (B: Band, i: number): number => rowCentre(B, Math.floor(i / B.perRow)) + rowPlace(i % B.perRow, B.perRow) * B.s * B.per;

// Seat a band's units in its places (`at`). A unit keeps the place it had (`had`, from the last fit, its row and its
// place from the middle out while the rows hold as many places): one that goes leaves a gap rather than its neighbours
// sliding in after the exchange is over. A newcomer takes the first free place, centre out, so a row fills its gaps,
// then grows at its ends. Without `had`, places go by arrival.
export function seatPlaces(cards: Cards, units: Draft[], per: number, cap: number, had: Map<string, number> | null): Draft[] {
  const fresh: Draft[] = [], taken = new Set<number>();
  units.forEach((u) => {
    const i = had?.get(u.key);
    if (i === undefined || i >= cap || taken.has(i)) fresh.push(u);
    else {
      u.at = i;
      taken.add(i);
    }
  });
  let i = 0;
  fresh.forEach((u) => {
    while (taken.has(i)) i++;
    u.at = i;
    taken.add(i);
  });
  // A newcomer with a copy of itself on the row stands beside it, in the nearest free place or one another newcomer
  // takes (they trade): so when the row grows past its places and the copies pile, one steps over, never the length of
  // the row (centre out, places in a row alternate sides).
  const gap = (a: number, b: number) => Math.abs(Math.floor(a / per) - Math.floor(b / per)) * per + Math.abs(rowPlace(a % per, per) - rowPlace(b % per, per));
  const name = (u: Draft) => cards.need(u.rep).name;
  fresh.forEach((u) => {
    const like = units.find((v) => v !== u && name(v) === name(u) && (!fresh.includes(v) || fresh.indexOf(v) < fresh.indexOf(u)));
    if (!like || gap(u.at!, like.at!) <= 1) return;
    let best: number | null = null, d = gap(u.at!, like.at!);
    for (let j = 0; j < cap; j++) {
      const w = units.find((v) => v.at === j);
      if (w && (!fresh.includes(w) || units.some((v) => v !== w && name(v) === name(w)))) continue;
      if (gap(j, like.at!) < d) {
        d = gap(j, like.at!);
        best = j;
      }
    }
    if (best === null) return;
    const w = units.find((v) => v.at === best);
    if (w) w.at = u.at;
    u.at = best;
  });
  return units;
}

// A card arriving on a page that holds its shape while others leave it stands in the first free place, centre out, of its
// own band, or else of another band the leavers emptied, until the page re-fits. False if none is free.
export function seatGuest(plan: Fit, u: Draft, me: boolean): boolean {
  const own = ({ creature: "C", walker: "S", support: "S", mana: "L" } as const)[u.role];
  const order: BandKey[] = [own, "C", "S", ...(me ? (["L"] as const) : [])];
  for (const k of order) {
    const B = plan[k];
    if (!B.cap || !B.units || (k === "L" && !me)) continue;
    const taken = new Set(B.units.map((x) => x.at));
    for (let i = 0; i < B.cap; i++)
      if (!taken.has(i)) {
        B.units.push({ ...u, at: i });
        plan.fed++;
        return true;
      }
  }
  return false;
}

// The last fit held while cards leave its page: each unit keeps its key and place, holding only its cards still on the
// board (`now`). A card new to the board joins the unit a copy of it stands in, or else stands in a free place
// (seatGuest). Null unless every card on the page (`cur`) is held exactly once and each fighter stands on its own.
export function holdFit(cards: Cards, prev0: Fit, plan: Fit, cur: Draft[], now: Set<CardId>, me: boolean): Fit | null {
  const holdingFn = (u: Draft, ids: CardId[]) => holding(cards, u, ids);
  const prev = clone(prev0);
  // (Its back band is the new fit's, which a new pile may widen: the page widens with it, so the pile lies on it.)
  const kept: Fit = { ...prev, place: plan.place, back0: plan.back0, W: Math.max(prev.W, plan.W), held: true };
  const at = new Map<CardId, Draft>();
  (["C", "S", "L"] as const).forEach((k) => {
    kept[k] = {
      ...prev[k],
      units: (prev[k].units ?? [])
        .map((u) => {
          const ids = u.ids.filter((id) => now.has(id));
          const v = !ids.length ? null : ids.length === u.ids.length ? { ...u } : holdingFn(u, ids);
          if (v) ids.forEach((id) => at.set(id, v));
          return v;
        })
        .filter((v): v is Draft => !!v),
    };
  });
  for (const u of cur) {
    const out = u.ids.filter((id) => !at.has(id)), host = u.ids.map((id) => at.get(id)).find(Boolean);
    if (!out.length) continue;
    if (host) {
      Object.assign(host, holdingFn(host, host.ids.concat(out)));
      out.forEach((id) => at.set(id, host));
    } else if (seatGuest(kept, { ...u, ids: out }, me)) out.forEach((id) => at.set(id, u));
    else return null;
  }
  const all = (["C", "S", "L"] as const).flatMap((k) => kept[k].units!.flatMap((u) => u.ids));
  if (all.length !== new Set(all).size || all.length !== now.size) return null;
  if (cur.some((u) => u.fight && !kept.C.units!.some((v) => v.ids.length === u.ids.length && u.ids.every((id) => v.ids.includes(id))))) return null;
  const count = (q: Fit) => (["C", "S", "L"] as const).reduce((t, k) => t + (q[k].units ?? []).length, 0);
  kept.fed = prev.fed - count(prev) + count(kept); // (what was folded away stays folded)
  return kept;
}

export function fitSeat(ctx: FitCtx, args: FitArgs, hold = true): Fit {
  const { g, cards, region: r, me } = ctx;
  const { settling, pressure } = args;
  const prev = ctx.prev;
  let { C, S } = args;
  const { L } = args;
  const squeeze = (cap: number) => Math.max(1, cap - pressure);
  const holdingFn = (u: Draft, ids: CardId[]) => holding(cards, u, ids);

  // A pile of like cards stays one while its page holds: opened as soon as a place comes free, it would send an idle
  // copy the length of its row. (Only like cards: a mixed pile opens as soon as it can.)
  if (hold && prev && !ctx.foldC) {
    [C, S] = [C, S].map((us0, i) =>
      (prev[i ? "S" : "C"].units ?? [])
        .filter((p) => p.title && !p.mixed)
        .reduce((us, p) => {
          // (Creatures stay together only while they still match as a fold would pile them, name and stats: one grown or
          // shrunk since leaves the pile.)
          const stat = (id: CardId): string => {
            const c = cards.get(id);
            return i || !c ? "" : stats(c);
          };
          const rc = cards.get(p.rep);
          const same = !i ? (rc ? stats(rc) : (p.look ?? null)) : null;
          const mine = us.filter((u) => !u.fight && u.ids.every((id) => p.ids.includes(id)) && (same === null || u.ids.every((id) => stat(id) === same)));
          if (mine.length < 2) return us;
          // (It shows the face it showed while that card is still in it, else the one a fresh fold would; first in its ids, so
          // a tap on it acts on the card it shows.)
          const all = mine.flatMap((u) => u.ids), rest = us.filter((u) => !mine.includes(u));
          const rep = all.includes(p.rep) ? p.rep : (kindsOf(cards, all)[0]?.id ?? mine[0]!.rep);
          const ids = i ? all : [rep, ...all.filter((id) => id !== rep)];
          rest.splice(us.indexOf(mine[0]!), 0, { key: mine[0]!.key, ids, rep, role: mine[0]!.role, title: p.title!.replace(/\d+$/, String(ids.length)), top: undefined, look: p.look });
          return rest;
        }, us0),
    ) as [Draft[], Draft[]];
  }
  // Their lands are one well lying flat at the outer end of their first support row (away from the plaque's piles). There
  // it is near enough to meet the floors lying down, and on screen it stays within the support row's height, so it costs
  // the page width, not depth.
  const order: BandKey[] = me ? ["L", "S", "C"] : ["C", "S"];
  const n = { C: C.length, S: S.length, L: L.length };
  const back = me ? BACK.me : BACK.them;
  const b = {} as { C: Band; S: Band; L: Band } & { plateA: number; zoneBack: number };
  b.plateA = 0;
  b.zoneBack = 0;
  // Cards leaving never move the cards that stay: each band holds the rows it had (even emptied by a wipe), and the page
  // its size (`hold`). A fit without holds starts afresh, keeping only each unit's place. Whether the holds cost room
  // (`over`: deeper than the page was; or more folding than a fresh fit) is the planner's to weigh.
  const held: Record<string, number> = {};
  order.forEach((k) => (held[k] = hold && prev && prev[k] ? prev[k].rows : 0));
  // Their creatures that outgrow the creature band stand in the support row (`host`) before any of them share a pile:
  // there its places are as wide as a creature's, and its cards as large as a creature's floor asks. (Mine can't: a
  // second row of my creatures at their floor is deeper than my page can be.) While cards are still leaving (`settling`)
  // that holds, so a page losing its creatures doesn't shrink its support row and move the piles they fly to; once
  // they have landed the row is the support's again, its places as wide as theirs, so what survives can lie on its own.
  let host = !!(hold && settling && prev && prev.host);
  const cPx = g.creaturePx;
  // A support that lies turned (its top card tapped) is as wide as a card is tall, and its place a little narrower: where
  // one does, its row's places widen just enough for an upright neighbour to keep off its name and foot (half a turned
  // card and half an upright one, less the fifth of a name strip the limits allow), and where two may meet, as wide as
  // a creature's.
  // (A pile with tapped and ready cards draws its tapped ones turned behind the ready, about as wide as a turned card.)
  const turned = (): number =>
    S.filter((u) => cards.need(u.top ?? topOf(u, me)).tapped || (u.ids.length > 1 && u.ids.some((id) => cards.need(id).tapped))).length;
  const band = (k: BandKey): BandSpec => {
    if (host && k === "S") return { ...g.band("S", me, cPx), px: FLOOR.theirs, per: g.band("C", me, cPx).per };
    const B = g.band(k, me, cPx), n = k === "S" ? turned() : 0;
    return n ? { ...B, per: Math.max(B.per, n > 1 ? g.band("C", me, cPx).per : TURNED_PER) } : B;
  };
  const lay = (rows: Record<string, number>): number => {
    // depths from the fixed edge, with rows per band
    let a = me ? back + GAP : EDGE;
    if (!me) b.L = { ...g.band("L", false, cPx), k: "L", n: 0, rows: 0, perRow: 0, cap: 0, s: 1, a0: 0, a1: 0 };
    for (const k of order) {
      const B = band(k), cnt = n[k], lands = !me && k === "S" && !!n.L;
      if (!cnt && !lands && !held[k]) {
        b[k] = { ...B, k, s: B.pref, n: 0, rows: 0, perRow: 0, a0: a, a1: a, cap: 0 };
        continue;
      }
      if (me && k === "C") a = Math.max(a, clearOfHand(g, r)); // my creatures stand above the hand, across the whole page
      let s = B.pref;
      for (let it = 0; it < 3; it++) {
        // the floor where its farthest row stands (mine: the front row)
        const foot = me ? a + s * (B.first + (rows[k]! - 1) * B.step - B.lead) : a + s * (B.lead + (rows[k]! - 1) * B.step);
        // (A creature tapped turns and leans further back, TAP_LEAN: then its narrow side runs up the screen, foreshortened.
        // A back row that lies is measured lying, and where nothing lies turned, upright.)
        const back = !me && !!B.backLying && rows[k]! > 1;
        s = Math.max(B.pref, floorScale(g, g.toWorld(r, 0, r.d / 2 - foot), (k === "C" && !B.upright) || (host && k === "S") ? B.px / Math.cos(TAP_LEAN) : B.px, B.flat || back, s, !B.upright));
      }
      let step = B.step, d = s * (B.first + (rows[k]! - 1) * B.step);
      if (!me && B.lying) {
        // theirs lying flat: each row as deep as it lies, nothing to see over
        d = s * (B.first + (rows[k]! - 1) * step);
      } else if (!me) {
        // theirs stand: each row, and the band behind, where it shows whole
        const tall = B.tall ?? CH + TAB_H; // above a folded pile, its title tab
        for (let i = 0; i < rows[k]! - 1; i++) {
          const f = a + s * (B.lead + i * step);
          step = Math.max(step, (clearBehind(g, r, f, s, tall) - f) / s);
        }
        d = Math.max(s * (B.lead + (rows[k]! - 1) * step), clearBehind(g, r, a + s * (B.lead + (rows[k]! - 1) * step), s, B.tallLast ?? tall) - a);
        // (A back row that lies, behind a row that stands: as deep as what lies there reaches behind its foot.)
        if (B.backLying && rows[k]! > 1) d = s * (B.lead + (rows[k]! - 1) * step + B.backLying);
      }
      let span = bandSpan(g, r, me, me ? a : a + d);
      if (lands) {
        // their well: lying flat, sized to the floors where it lies
        const L0 = g.band("L", false, cPx), foot = a + s * B.lead, zs = zoneSide(me, r.x);
        let sL = L0.pref;
        for (let it = 0; it < 3; it++) sL = Math.max(L0.pref, floorScale(g, g.toWorld(r, 0, r.d / 2 - foot), L0.px, true, sL, !L0.upright));
        const lw = sL * CW + 0.35, lo = zs > 0 ? span.lo + lw : span.lo, hi = zs > 0 ? span.hi : span.hi - lw;
        b.L = { ...L0, k: "L", s: sL, n: n.L, rows: 1, perRow: 1, cap: 1, a0: foot - sL * L0.lead, a1: foot + sL * (L0.lying ? L0.first - L0.lead : CH), w: lw, u: zs > 0 ? span.lo + (sL * CW) / 2 : span.hi - (sL * CW) / 2 };
        span = { lo, hi, w: Math.max(0, hi - lo), uc: (lo + hi) / 2 };
      }
      const perRow = Math.max(1, Math.floor((span.w - (rows[k]! > 1 ? STAGGER * s : 0)) / (s * B.per)));
      b[k] = { ...B, k, s, step, n: cnt, rows: rows[k]!, perRow, a0: a, a1: a + d, cap: perRow * rows[k]!, span };
      a += d + GAP;
    }
    if (me) return a - GAP + EDGE;
    // Their plaque draws over everything, so it stands where it is clear, on screen, of the tops of the row in front of it
    // (their support stands nearly upright: its top reaches well back from its foot as I see it), and the page reaches
    // far enough behind it for the plaque's top to stay inside the border.
    b.plateA = a - GAP + back - PLATE_IN;
    const B = b.S.n ? b.S : b.C.n ? b.C : null;
    // (Lying, its last row ends where it ends; the piles in the plaque's row stand propped from half a card in front.)
    const clear = ctx.flatZones ? LYING_CLEAR.flat : LYING_CLEAR.propped;
    if (B) b.plateA = Math.max(b.plateA, B.lying ? B.a1 + clear : clearBehind(g, r, B.a0 + B.s * (B.lead + (B.rows - 1) * B.step), B.s));
    if (b.L.n) b.plateA = Math.max(b.plateA, b.L.a1 + (b.L.lying ? clear : 0.2)); // and behind the far end of their well
    // The graveyard and exile in the plaque's row are propped from their near edge, half a card in front of it: where a
    // pile in front wears a title tab (a pile of copies, a fold), they stand back far enough that the tab never covers
    // their foot (`zoneBack`).
    const tabbed = B && ctx.tabs !== false && ([...C, ...S].some((u) => u.ids.length > 1) || B.n > B.cap);
    b.zoneBack = tabbed ? Math.max(0, clearBehind(g, r, B.a0 + B.s * (B.lead + (B.rows - 1) * B.step), B.s, CH + TAB_H) + 0.45 - b.plateA) : 0;
    // The page reaches far enough behind the plaque that its top, leaning back, stays inside the fine rule as I see it.
    const pf = g.toWorld(r, 0, r.d / 2 - b.plateA);
    const ty = g.proj.project({ x: pf.x, y: pf.y + 0.84 * Math.cos(g.pitch) * PLATE_S, z: pf.z - 0.84 * Math.sin(g.pitch) * PLATE_S }).y / g.u;
    let lo = b.plateA, hi = r.d + 6;
    for (let it = 0; it < 18; it++) {
      const m = (lo + hi) / 2;
      if (g.proj.project(g.toWorld(r, 0, r.d / 2 - m)).y / g.u > ty) lo = m;
      else hi = m;
    }
    return Math.max(b.plateA + PLATE_IN, hi + 0.7, b.plateA + b.zoneBack + CH * 0.6);
  };
  // As many rows as each band needs, then give rows back while the page is deeper than its slot: support first, then
  // my wells, then creatures.
  const rows: Record<string, number> = {};
  let D = 0;
  const fresh = !prev || !hold;
  const fitRows = (): void => {
    order.forEach((k) => (rows[k] = Math.max(1, held[k]!)));
    D = lay(rows);
    order.forEach((k) => {
      rows[k] = Math.max(held[k]!, Math.min(band2(k).rows, Math.max(1, Math.ceil(n[k] / Math.max(1, b[k].perRow)))));
    });
    D = lay(rows);
    for (const k of ["S", "L", "C"] as const) while (D > r.d && rows[k] !== undefined && rows[k]! > Math.max(1, held[k] ?? 0)) { rows[k] = rows[k]! - 1; D = lay(rows); }
  };
  // (BAND[k](me).rows: the unhosted spec, whichever mode the support row is in.)
  const band2 = (k: BandKey): BandSpec => g.band(k, me, cPx);
  fitRows();
  // Fold each band into what it holds: like cards first; unlike ones share a pile (`mixed`) only as the last resort.
  const keep = ctx.keepOf;
  // (A pile of unlike cards is fronted by what it holds most of: standee fans the next kinds behind it.)
  // (A standing pile's front card leads its ids, so a tap on the pile acts on the card it shows.)
  const named = (u: Draft[], title: string): Draft => {
    const all = u.flatMap((x) => x.ids), rep = kindsOf(cards, all)[0]?.id ?? u[0]!.rep, stands = u[0]!.role === "creature";
    const ids = stands ? [rep, ...all.filter((id) => id !== rep)] : all;
    const rc = cards.get(rep);
    return { key: u[0]!.key, ids, rep, role: u[0]!.role, title, look: stands && rc ? stats(rc) : undefined };
  };
  // (Unlike tokens share "Tokens" only where that alone makes the row fit: where a mixed pile comes anyway, the tokens
  // keep their kinds, "Beast 9" and "Elemental 8", and the mixed pile takes what is fewest.)
  // (Creatures pile by name only where their power and toughness match too: a 2/2 Elemental never hides behind a 3/3's
  // face and count, which would make combat math wrong.)
  const likeC: Like[] = [
    Object.assign((u: Draft) => stats(cards.need(u.rep)), { word: (u: Draft) => cards.need(u.rep).name }),
    Object.assign((u: Draft) => (cards.need(u.rep).token ? "Tokens" : null), { whole: true }),
  ];
  const likeS: Like[] = [(u) => cards.need(u.rep).name, (u) => (cards.need(u.rep).token ? "Tokens" : null), (u) => kindWord(cards.need(u.rep))];
  // Their creatures would share a pile while their support row has room to give: the noncreatures fold first and the
  // creatures take the places that frees, if the page still fits its slot that way.
  // (The noncreatures fold as far as the creatures need, into one pile at most.)
  const hosted = () => {
    const all = b.C.cap + b.S.cap, s = fold(cards, S, Math.min(b.S.cap, Math.max(1, all - C.length)), likeS, keep, named, "Others");
    return { s, c: fold(cards, C, all - s.length, likeC, keep, named, "Creatures") };
  };
  let split: { s: Draft[]; c: Draft[] } | null = null;
  const alone = ctx.foldC ? ctx.foldC(C, squeeze(b.C.cap), b.C.perRow) : fold(cards, C, squeeze(b.C.cap), likeC, keep, named, "Creatures");
  if (!ctx.foldC && !me && S.length && b.C.cap && alone.some((u) => u.mixed)) {
    const rows0 = { ...rows };
    host = true;
    fitRows();
    split = D <= r.d + 1e-6 ? hosted() : null;
    if (!split || split.c.length <= alone.length) {
      host = false;
      split = null;
      Object.assign(rows, rows0);
      D = lay(rows);
    }
  }
  const likeL: Like[] = [(u) => (cards.need(u.rep).manaRock ? "Rocks" : null), (u) => (cards.need(u.rep).land && !cards.need(u.rep).basic ? "Lands" : null), () => "Mana"];
  const over = D > Math.max(r.d, prev ? prev.deep + 1e-6 : 0) && order.some((k) => held[k]);
  const needD = D; // how deep it asks to be, past its slot when crowded
  // Their back band across: the plaque and, toward the table's middle, the commander (while it is in the command zone) and
  // then the piles. The plaque sits off centre so the band is balanced on the page. A pile is as large as the floors ask
  // where it lies (`zS`), so what went to it stays readable. The band keeps room for a commander or pile that has gone,
  // so the plaque doesn't slide when one comes or goes.
  const zS = me ? 0 : Math.max(0.8, floorScale(g, g.toWorld(r, 0, r.d / 2 - Math.min(b.plateA, r.d - PLATE_IN)), FLOOR.any, !!ctx.flatZones, 0.8, !ctx.flatZones)); // propped up (PILE_LEAN): measured across, like a card standing
  const holdBack = !fresh && prev && prev.back0;
  const back0: Back0 = { nz: Math.max(args.nz, holdBack ? prev.back0.nz : 0), cmd: args.cmd || !!(holdBack && prev.back0.cmd), zS: Math.max(zS, holdBack ? prev.back0.zS : 0) };
  const backBand = () => {
    const half = 1.6 * PLATE_S, cmdOut = (2.2 + 0.32) * PLATE_S, zs = zoneSide(me, r.x), gap = Math.max(1.15, back0.zS * CW + 0.4);
    const z0 = back0.cmd ? cmdOut + 0.25 + gap / 2 : half + 0.2 + gap / 2, zones = [...Array(back0.nz).keys()].map((i) => z0 + i * gap);
    const eZ = Math.max(half, back0.cmd ? cmdOut + 0.05 : 0, back0.nz ? zones[back0.nz - 1]! + gap / 2 : 0), c = (-zs * (eZ - half)) / 2;
    return { place: { plate: c, zones: zones.map((u) => c + zs * u), zS: back0.zS }, w: eZ + half + 2 * SIDE };
  };
  if (split) {
    // The first creatures to arrive keep the creature band; the rest stand in the support row after the noncreatures.
    const { s, c } = split;
    b.C.units = c.slice(0, b.C.cap);
    b.S.units = s.concat(c.slice(b.C.cap));
  } else {
    // (Where creatures share a pile anyway, like noncreatures still fan into their named piles first: folding order.)
    b.C.units = alone;
    b.S.units = fold(cards, S, squeeze(b.S.cap), likeS, keep, named, "Others");
    if (!ctx.foldC && alone.some((u) => u.mixed)) b.S.units = fold(cards, b.S.units, 1, likeS.slice(1), keep, named, null);
  }
  b.L.units = fold(cards, L, squeeze(b.L.cap), likeL, keep, named, "Mana");
  // Creatures sharing a pile is the last resort: by then no noncreature lies alone on the page, legendary or not. Lone
  // ones fold into their likes ("Lands" takes a legendary land), and only then into one mixed pile.
  if (!ctx.foldC && b.C.units.some((u) => u.mixed)) {
    const cmdr: Keep = (u) => !!u.lands || cards.need(u.rep).commander;
    const lone = (us: Draft[]) => us.some((u) => u.ids.length === 1 && !cmdr(u));
    const tighten = (us0: Draft[], likes: readonly Like[], mixed: string): Draft[] => {
      let us = us0;
      while (us.length > 1 && lone(us)) {
        const n0 = us.length;
        us = fold(cards, us, n0 - 1, likes, cmdr, named, mixed);
        if (us.length === n0) break;
      }
      return us;
    };
    const non = b.S.units.filter((u) => u.role === "support");
    b.S.units = tighten(non, likeS.slice(1), "Others").concat(b.S.units.filter((u) => u.role !== "support"));
    b.L.units = tighten(b.L.units, likeL, "Mana");
  }
  // In combat, what doesn't fight stays as it was: each pile keeps its key, its place and the rest of its cards while
  // its fighters step out to the middle (targets), and the page folds afresh only when something arrives or the fight
  // is over.
  const fighters = C.filter((u) => u.fight);
  if (fighters.length && !fresh && prev.C.units) {
    const bands = ["C", "S", "L"] as const;
    const was = new Set(bands.flatMap((k) => (prev[k].units ?? []).flatMap((u) => u.ids))), now = new Set([C, S, L].flat().flatMap((u) => u.ids));
    const out = new Set(fighters.flatMap((u) => u.ids));
    if ([...now].every((id) => was.has(id))) {
      if (prev.host && !host) {
        host = true;
        fitRows(); // (its support row still holds creatures, at their size)
      }
      bands.forEach((k) => {
        b[k].units = (prev[k].units ?? [])
          .map((u0): Draft | null => {
            const u = clone(u0); // (a copy: seating it mustn't move the last fit's)
            const ids = u.ids.filter((id) => now.has(id) && !out.has(id));
            if (ids.length === u.ids.length || !ids.length) return ids.length ? u : null;
            return holdingFn(u, ids);
          })
          .filter((u): u is Draft => !!u && !u.fight);
      });
      // A fighter that keyed the pile it left (its first card) steps out under its own key: the pile keeps its own.
      const kept = new Set(bands.flatMap((k) => b[k].units!.map((u) => u.key)));
      b.C.units!.push(...fighters.map((u) => (kept.has(u.key) ? { ...u, key: "f" + u.ids[0] } : u)));
    }
  }
  // Each in its place: where it was at the last fit. Places count from the row's middle out, alternating sides, so the
  // same row and the same place in it keep a card's side and order even when the rows hold more or fewer places.
  order.forEach((k) => {
    const B = b[k], B0 = prev?.[k], had = B0 && B0.units && B0.perRow ? new Map<string, number>() : null;
    if (had && B0) {
      B0.units!.forEach((u) => {
        const j = (u.at ?? 0) % B0.perRow;
        if (j < B.perRow) had.set(u.key, Math.floor((u.at ?? 0) / B0.perRow) * B.perRow + j);
      });
      // A pile that opens leaves the card that showed on top in its place, and the others come out from under it: never
      // another face swapped onto the same spot.
      B0.units!.forEach((u) => {
        // (A fighter stepping out of it isn't the pile opening: it fights in the middle, and the pile keeps its place.)
        const topId = u.top !== undefined ? u.top : u.rep;
        const top = u.ids.length > 1 && had.has(u.key) && B.units!.find((v) => v.ids.includes(topId));
        if (!top || top.key === u.key || top.fight) return;
        const i = had.get(u.key)!;
        had.delete(u.key);
        had.set(top.key, i);
      });
    }
    seatPlaces(cards, B.units!, B.perRow, B.cap, had);
  });
  D = Math.max(me ? 6 : 5.6, D);
  const bk = me ? null : backBand();
  // How far a band's units reach toward `side` (+-1) from the page's centre line, to the outside of their places.
  const reach = (B: Band, side: number, row: number | null = null): number =>
    Math.max(0, ...B.units!.filter((u) => row === null || Math.floor(u.at! / B.perRow) === row).map((u) => side * rowU(B, u.at!) + (B.s * B.per) / 2));
  // Their well lies just past the outer end of their first support row (in its middle while they have none).
  if (b.L.n && !me) {
    const B = b.S, zs = zoneSide(me, r.x), row0 = B.units!.some((u) => u.at! < B.perRow);
    b.L.u = row0 ? -zs * (reach(B, -zs, 0) + 0.3 + (b.L.s * CW) / 2) : 0; // clear of its sign, a little wider than the card
    if (!fresh && row0 && prev.L.n && (prev.L.u ?? 0) * b.L.u > 0) b.L.u = zs * Math.min(zs * b.L.u, zs * (prev.L.u ?? 0)); // and never draws in when one goes
  }
  // The page: as wide as its rows, its well and its back band reach from its centre, as deep as its bands, never past
  // its slot (and, while it holds its rows, never narrower than it was).
  const need = Math.max(
    ...order.map((k) => (b[k].n ? 2 * (Math.max(reach(b[k], 1), reach(b[k], -1)) + SIDE) : 0)),
    !me && b.L.n ? 2 * (Math.abs(b.L.u ?? 0) + (b.L.s * CW) / 2 + SIDE) : 0,
    me ? 12 : (bk?.w ?? 0),
    fresh ? 0 : prev.W,
  );
  return {
    C: b.C,
    S: b.S,
    L: b.L,
    zoneBack: b.zoneBack,
    host,
    W: Math.min(r.w, need),
    D: Math.min(r.d, D),
    deep: needD,
    over,
    fed: C.length + S.length + L.length,
    back,
    back0,
    place: bk?.place ?? null,
    plateA: me ? 0 : Math.min(b.plateA, D - PLATE_IN, r.d - PLATE_IN),
  };
}

