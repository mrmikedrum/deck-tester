import { FLOOR } from "../board";
import type { BoardCard } from "../board";
import { Ledger } from "../ledger";
import type { Fixtures, InkSlot, LayoutMemory, Placement, SeatInput, SeatLayout, SeatPlan, Unit } from "../seat";
import type { CardId, V3 } from "../types";
import { ACCOUNT_LINES, accountOf, byImportance, kindOf } from "../told/account";
import type { Account } from "../told/account";
import { INK_PX, LETTER_EM, ROW, inkLines, inkRows } from "../told/ink";
import type { Fit } from "./fit";
import { CH, CW, EDGE, PLATE_IN, SIDE, bandSpan, clearBehind, floorScale, makeGeo } from "./geometry";
import type { Geo, Region } from "./geometry";
import { mat } from "./mat";
import { audit, seatShapes } from "../shape";
import { TAP_PX } from "../board";

// `told` ("Told, not shown"): a page of a bestiary. While a board fits its page it is `mat`'s, card for card. Only when a
// creature has no room to stand is anything written: the creatures that matter most stand in one front row at the floor,
// planeswalkers prop beside the well, the works stand behind the row while all of them fit, and the rest is the page's
// account, ink in the vellum (told/account.ts): one summary unit that opens a sift of every written card. Under the plaque
// one line is kept for the moment's answer (`Fixtures.heading`). In a fight the page holds still: who stood stands, and
// what is out leaves a hollow mark in its entry. Mine is always `mat`'s: I act with my cards, so they stay cards.

/** The ink keeps this far inside the page's rules (they lie about SIDE in from its edge). */
const INK_MARGIN = 0.35;
/** The gap between standing cards in the front row, in card heights at their scale. */
const ROW_GAP = 0.1;

interface ToldMemory {
  readonly mode: "open" | "told";
  /** `mat`'s own memory, so an open page keeps its places. */
  readonly mat: unknown;
  /** Who stood, in their order across the row. */
  readonly stand: readonly number[];
}

const isMana = (c: BoardCard): boolean => !c.creature && !c.planeswalker && !c.specialLand && (c.land || c.manaRock || c.treasure);

function plan(input: SeatInput): SeatPlan {
  const was = input.memory?.paradigm === "told" ? (input.memory.fit as ToldMemory) : null;
  const matMemory: LayoutMemory | null = was ? (was.mat ? { v: 1, paradigm: "mat", fit: was.mat } : null) : input.memory;
  const open = mat.plan({ ...input, memory: matMemory });
  const wrap = (p: SeatPlan, mode: ToldMemory["mode"], stand: readonly CardId[] = []): SeatPlan => ({
    ...p,
    memory: { v: 1, paradigm: "told", fit: { mode, mat: mode === "open" ? p.memory.fit : (was?.mat ?? open.memory.fit), stand } satisfies ToldMemory },
  });
  if (input.board.mine) return wrap(open, "open");
  // In a fight, or while cards fly, a written page holds as it is.
  const fighting = input.board.cards.some((c) => input.fighting?.has(c.id));
  const hold = was?.mode === "told" && (fighting || input.settling);
  // Written only where `mat` has no room for every card as a card.
  if (!hold && open.report.folded === 0 && !open.units.some((u) => u.mixed)) return wrap(withHeading(input, open), "open");
  // A second standing row only where the page still holds everything else at its floors with it.
  let p = written(input, open, was, hold && fighting, true);
  if (p.second && audit(seatShapes(input.projector, p.plan, false), input.viewport, { area: { safe: input.reserve.safe, chrome: input.reserve.items.filter((i) => i.visible).map((i) => i.rect) } }).length)
    p = written(input, open, was, hold && fighting, false);
  return wrap(p.plan, "told", p.stand);
}

/** An open page's answer line: across the page just in front of its plaque. */
function withHeading(input: SeatInput, p: SeatPlan): SeatPlan {
  const { region: r, projector, reserve } = input;
  const g = makeGeo(projector, reserve, FLOOR.theirs);
  const plate = p.fixtures.plate.pos;
  const depth = r.d / 2 - ((plate.x - r.x) * Math.sin(r.yaw) + (plate.z - r.z) * Math.cos(r.yaw));
  const lo = -r.w / 2 + SIDE + INK_MARGIN, hi = r.w / 2 - SIDE - INK_MARGIN;
  return { ...p, fixtures: { ...p.fixtures, heading: headingSlot(g, r, lo, hi, depth - 0.12) } };
}

/**
 * A told page: the front row, the well and planeswalkers in a column at its right, the works standing behind the row while
 * all of them fit, the account, and the plaque at the back as `mat` sets it with the answer's line kept under it. `frozen`:
 * a fight is on, so whoever stood stands and the written cards out in it leave hollow marks.
 */
function written(input: SeatInput, open: SeatPlan, was: ToldMemory | null, frozen: boolean, twoRows: boolean): { plan: SeatPlan; stand: CardId[]; second: boolean } {
  const { board, region: r, projector, reserve, involved } = input;
  const g = makeGeo(projector, reserve, FLOOR.theirs);
  const vAt = (a: number): number => r.d / 2 - a;
  const at = (u: number, a: number): V3 => g.toWorld(r, u, vAt(a));

  // Attachments ride their host; one whose host is elsewhere is a card of its own (a work).
  const onSeat = new Set(board.cards.map((c) => c.id));
  const hostOf = new Map<CardId, CardId>();
  for (const c of board.cards) if (c.attachedTo !== null && onSeat.has(c.attachedTo)) hostOf.set(c.id, c.attachedTo);
  const free = board.cards.filter((c) => !hostOf.has(c.id));
  const mana = free.filter(isMana).sort((a, b) => Number(b.land) - Number(a.land) || a.id - b.id);
  const walkers = free.filter((c) => c.planeswalker && !c.creature).sort((a, b) => a.id - b.id);
  const creatures = free.filter((c) => c.creature);
  const works = free.filter((c) => !c.creature && !c.planeswalker && !isMana(c));

  // The front row: the commander and what acts first, then unlike creatures by importance, then identical ones (what words
  // say completely is written first). The row stands at its floor across the page's front edge. In a fight it holds:
  // who stood stands, whatever the ranking says now.
  const sizes = new Map<string, number>();
  for (const c of creatures) sizes.set(kindOf(c), (sizes.get(kindOf(c)) ?? 0) + 1);
  const like = (c: BoardCard): boolean => (sizes.get(kindOf(c)) ?? 0) > 1;
  const first = (c: BoardCard): number => (involved.has(c.id) ? 0 : c.commander ? 1 : like(c) ? 3 : 2);
  const aF = EDGE + 0.2 * 1.3;
  const span = bandSpan(g, r, false, aF);
  const s = Math.max(1.3, floorScale(g, at(span.uc, aF), FLOOR.theirs, false, 1.3));
  const wide = (c: BoardCard): number => ((c.tapped ? CH : CW) + ROW_GAP) * s;
  const stood = new Set(was?.stand ?? []);
  const wanted = frozen ? creatures.filter((c) => stood.has(c.id)) : [...creatures].sort((a, b) => first(a) - first(b) || byImportance(a, b));
  /** As many of `cs` as one row holds, in their order (the commander and what acts always). */
  const rowOf = (cs: readonly BoardCard[]): BoardCard[] => {
    const row: BoardCard[] = [];
    let used = 0;
    for (const c of cs) {
      const w = wide(c);
      if (used + w - ROW_GAP * s > span.w + 1e-6 && !involved.has(c.id) && !c.commander) continue;
      row.push(c);
      used += w;
    }
    return row;
  };
  // One row stands; a second only where it lets every creature stand (nothing written: the page holds them all). In a
  // fight, whoever stood stands, in the rows they stood in.
  const row1 = rowOf(wanted), rest = wanted.filter((c) => !row1.includes(c));
  const second = rowOf(rest);
  const row2 = rest.length && (frozen ? stood.size > row1.length : twoRows && second.length === rest.length) ? second : [];
  const stand = [...row1, ...row2];
  // Across a row they keep the order they stood in last time; newcomers by when they came (the commander first).
  const before = new Map((was?.stand ?? []).map((id, i) => [id, i]));
  const sorted = (row: readonly BoardCard[]) => [...row].sort((a, b) => (before.get(a.id) ?? 1e6) - (before.get(b.id) ?? 1e6) || Number(b.commander) - Number(a.commander) || a.id - b.id);
  const units: Unit[] = [];
  const dressingOf = (ids: readonly CardId[]): CardId[] => board.cards.filter((c) => { const h = hostOf.get(c.id); return h !== undefined && ids.includes(h); }).map((c) => c.id);
  const card = (prefix: string, c: BoardCard, placement: Placement, role: Unit["role"]): Unit => ({
    id: prefix + c.id,
    role,
    kind: "card",
    members: [c.id],
    dressing: dressingOf([c.id]),
    top: c.id,
    title: null,
    mixed: false,
    acting: involved.has(c.id),
    tapped: c.tapped,
    placement,
  });
  const lay = (row: readonly BoardCard[], a: number): void => {
    const total = row.reduce((t, c) => t + wide(c), 0) - ROW_GAP * s, fits = total <= span.w + 1e-6;
    let u0 = span.uc - Math.min(span.w, total) / 2;
    for (const c of row) {
      const w = wide(c) - ROW_GAP * s;
      // (More acting than the row holds: the rest wait behind it, at the row's middle; the combat row takes them.)
      const u = fits || u0 + w <= span.hi + 1e-6 ? u0 + w / 2 : span.uc;
      units.push(card(involved.has(c.id) ? "f" : "c", c, { pos: at(u, a), scale: s, posture: "stand" }, "creature"));
      u0 += wide(c);
    }
  };
  const order = [...sorted(row1), ...sorted(row2)];
  lay(sorted(row1), aF);
  const aR2 = clearBehind(g, r, aF, s) + 0.1;
  if (row2.length) lay(sorted(row2), aR2);
  const standing = new Set(stand.map((c) => c.id));
  const writtenCreatures = creatures.filter((c) => !standing.has(c.id));

  // Behind the row: the well and the planeswalkers in a column at the page's right, the account to its left.
  const behind = row2.length ? clearBehind(g, r, aR2, s) + 0.1 : aR2;
  const plateA = r.d - PLATE_IN;
  const wS = Math.max(1.0, floorScale(g, at(span.hi - 1, behind), FLOOR.any, false, 1.0));
  const colHi = r.w / 2 - SIDE;
  // The well's far edge stays short of the plaque's band, where the zone piles stand.
  // (A propped zone pile reaches half a card toward me from where it stands; mat set it, moved back with the plaque.)
  const fit0 = open.memory.fit as Fit, shift0 = (plateA - fit0.plateA) || 0;
  const depthOf = (p: V3): number => r.d / 2 - ((p.x - r.x) * Math.sin(r.yaw) + (p.z - r.z) * Math.cos(r.yaw));
  const acrossOf = (p: V3): number => (p.x - r.x) * Math.cos(r.yaw) - (p.z - r.z) * Math.sin(r.yaw);
  /** How deep something spanning lo..hi across may reach before a zone pile in its way (none in its way: no limit). */
  const zoneNear = (lo: number, hi: number): number =>
    Math.min(Infinity, ...open.fixtures.zones.filter((z) => {
      const u = acrossOf(z.placement.pos), half = (CW / 2) * z.placement.scale + 0.15;
      return u + half > lo && u - half < hi;
    }).map((z) => depthOf(z.placement.pos) + shift0 - (CH / 2) * z.placement.scale - 0.25));
  // The answer's line under the plaque, across the page, kept free on every told page: nothing below reaches into it.
  const lo = -r.w / 2 + SIDE + INK_MARGIN;
  const top = Math.min(plateA - 0.4, zoneNear(lo, colHi - INK_MARGIN));
  const heading = headingSlot(g, r, lo, colHi - INK_MARGIN, top);
  const roof = top - heading.d - 0.08;
  const wellScale = (a: number, u: number): number => Math.max(1.1, floorScale(g, at(u, a), FLOOR.any, true, 1.1));
  const wellFar = (a: number, ws: number, u: number): boolean => a + CH * ws <= Math.min(plateA - 0.5, roof, zoneNear(u - (CW / 2) * ws, u + (CW / 2) * ws)) + 1e-6;
  const pitch = (CW + 0.12) * wS;
  let colW = walkers.length ? Math.min(2, walkers.length) * pitch : CW * 1.25;
  // The well lies behind the planeswalkers where there is room; else beside them, at their depth.
  const wRows = Math.ceil(walkers.length / 2);
  const aBack = walkers.length ? clearBehind(g, r, behind + (wRows - 1) * 1.1 * wS, wS) + 0.1 : behind;
  const backFits = mana.length > 0 && wellFar(aBack, wellScale(aBack, colHi - colW / 2), colHi - colW / 2);
  const beside = mana.length > 0 && walkers.length > 0 && !backFits;
  if (beside) colW += CW * wellScale(behind, colHi - colW) + 0.2;
  const colLo = colHi - colW;
  walkers.forEach((c, i) => {
    const row = Math.floor(i / 2), u = colHi - pitch * ((i % 2) + 0.5);
    units.push(card("w", c, { pos: at(u, behind + row * 1.1 * wS), scale: wS, posture: "prop" }, "walker"));
  });
  if (mana.length) {
    const u = beside ? colLo + (CW * wellScale(behind, colHi - colW)) / 2 + 0.05 : colHi - colW / 2;
    let aCol = beside ? behind : aBack;
    const ws = wellScale(aCol, u);
    if (!wellFar(aCol, ws, u)) aCol = Math.min(plateA - 0.5, roof, zoneNear(u - (CW / 2) * ws, u + (CW / 2) * ws)) - CH * ws;
    const rep = (mana.find((c) => c.land) ?? mana[0]!).id;
    units.push({
      id: "m" + board.seat,
      role: "mana",
      kind: "well",
      members: mana.map((c) => c.id),
      dressing: dressingOf(mana.map((c) => c.id)),
      top: rep,
      title: null,
      mixed: false,
      acting: false,
      tapped: false,
      placement: { pos: at(u, aCol), scale: ws, posture: "flat" },
    });
  }

  // The account, left of the column, ends short of the answer's line.
  const hi = (mana.length || walkers.length ? colLo : colHi) - 0.2;
  const a1 = Math.min(roof, zoneNear(lo, hi));

  // Written creatures out in a fight keep their entry as hollow marks; each stands as a card of its own (the combat row's).
  const out = new Set(frozen ? writtenCreatures.filter((c) => input.fighting?.has(c.id)).map((c) => c.id) : []);
  for (const c of writtenCreatures) if (out.has(c.id)) units.push(card("c", c, { pos: at((lo + hi) / 2, behind), scale: s, posture: "stand" }, "creature"));

  // The works stand behind the row, one each (like ones a pile), while all of them fit across and the account still holds
  // every entry behind them; else all are written.
  const kinds = new Map<string, BoardCard[]>();
  for (const c of works.sort((a, b) => a.id - b.id)) kinds.set(c.name, [...(kinds.get(c.name) ?? []), c]);
  const wkS = Math.max(1.0, floorScale(g, at((lo + hi) / 2, behind), FLOOR.any, false, 1.0));
  const wkPitch = (CW + 0.12) * wkS;
  const creatureIds = new Set(writtenCreatures.filter((c) => !out.has(c.id)).map((c) => c.id));
  const allIds = new Set<CardId>([...creatureIds, ...works.map((c) => c.id)]);
  const needs = (ids: ReadonlySet<CardId>): number => accountOf(board, ids, { lines: 99, out }).entries.length;
  let block = inkBlock(g, r, board, allIds, out, lo, hi, behind, a1);
  let worksStand = false;
  if (works.length && kinds.size * wkPitch <= hi - lo + 1e-6) {
    const a0 = clearBehind(g, r, behind, wkS) + 0.1;
    const alone = creatureIds.size || out.size ? inkBlock(g, r, board, creatureIds, out, lo, hi, a0, a1) : null;
    if (!creatureIds.size && !out.size ? true : !!alone && alone.words.entries.length >= needs(creatureIds) && alone.block.d <= a1 - a0 + 1e-6) {
      worksStand = true;
      block = alone;
      let k = 0;
      for (const cs of kinds.values()) {
        const u = lo + wkPitch * (k++ + 0.5);
        units.push({ ...card("s", cs[0]!, { pos: at(u, behind), scale: wkS, posture: "prop" }, "support"), kind: cs.length > 1 ? "pile" : "card", members: cs.map((c) => c.id), dressing: dressingOf(cs.map((c) => c.id)) });
      }
    }
  }
  if (block && block.words.written.length) {
    const ids = block.words.written;
    units.push({
      id: "a" + board.seat,
      role: "support",
      kind: "summary",
      members: ids,
      dressing: dressingOf(ids),
      top: ids[0]!,
      title: null,
      mixed: true,
      acting: false,
      tapped: false,
      placement: { pos: at((lo + hi) / 2, worksStand ? clearBehind(g, r, behind, wkS) + 0.1 : behind), scale: 1, posture: "flat" },
      account: block,
    });
  }

  // The plaque, the zones and the commander beside it: as `mat` sets them, moved back to the page's full depth.
  const fit = open.memory.fit as Fit;
  const shift = (plateA - fit.plateA) || 0;
  const back = (p: V3): V3 => ({ x: p.x - shift * Math.sin(r.yaw), y: p.y, z: p.z - shift * Math.cos(r.yaw) });
  const fx = open.fixtures;
  const fixtures: Fixtures = {
    page: { pos: at(0, r.d / 2), w: r.w, d: r.d, yaw: r.yaw },
    plate: { ...fx.plate, pos: back(fx.plate.pos) },
    zones: fx.zones.map((z) => ({ ...z, placement: { ...z.placement, pos: back(z.placement.pos) } })),
    ...(fx.commander ? { commander: { ...fx.commander, placement: { ...fx.commander.placement, pos: back(fx.commander.placement.pos) } } } : {}),
    heading,
  };
  const sealed = new Ledger(board.cards.map((c) => c.id)).seal({
    seat: board.seat,
    units,
    fixtures,
    memory: open.memory,
    report: { folded: block ? block.words.written.length : 0, held: false, pressure: input.pressure, overflow: false, lastResort: false },
  });
  return { plan: sealed, stand: order.map((c) => c.id), second: row2.length > 0 };
}

/** One line of answer, `INK_PX.slip` tall on screen, lying between lo and hi across with its far edge at depth `far`. */
function headingSlot(g: Geo, r: Region, lo: number, hi: number, far: number): InkSlot {
  const uc = (lo + hi) / 2;
  let em = INK_PX.slip / pxPer(g, r, uc, far).deep;
  for (let k = 0; k < 4; k++) em = INK_PX.slip / pxPer(g, r, uc, far - (ROW.line * em) / 2).deep;
  const d = ROW.line * em, k = pxPer(g, r, uc, far - d / 2);
  return { pos: g.toWorld(r, uc, r.d / 2 - (far - d / 2)), w: hi - lo, d, yaw: r.yaw, em, stretch: k.across / k.deep };
}

/** Design px on screen per world unit at a point of the page: across it, and into its depth (foreshortened). */
function pxPer(g: Geo, r: Region, u: number, a: number): { across: number; deep: number } {
  const p = g.toWorld(r, u, r.d / 2 - a), q = g.proj.project(p);
  const x = g.proj.project(g.toWorld(r, u + 0.5, r.d / 2 - a)), y = g.proj.project(g.toWorld(r, u, r.d / 2 - a - 0.5));
  return { across: Math.hypot(x.x - q.x, x.y - q.y) / 0.5 / g.u, deep: Math.hypot(y.x - q.x, y.y - q.y) / 0.5 / g.u };
}

/**
 * The account's block between `lo` and `hi` across, from depth `a0` back at most to `a1`: lettered so its furthest line is
 * at least `INK_PX.line` tall on screen, with as many lines as fit (seven at most, five or fewer only when the page is
 * short), a little larger where there is room.
 */
function inkBlock(g: Geo, r: Region, board: SeatInput["board"], written: ReadonlySet<CardId>, out: ReadonlySet<CardId>, lo: number, hi: number, a0: number, a1: number): NonNullable<Unit["account"]> | null {
  const w = hi - lo, uc = (lo + hi) / 2;
  if (w <= 0 || a1 <= a0) return null;
  const mid = pxPer(g, r, uc, (a0 + a1) / 2);
  const stretch = mid.across / mid.deep;
  // The em whose furthest line, `depth` ems back from the near edge, is `px` tall on screen (a few rounds settle it).
  const emFor = (depth: number, px: number): number => {
    let em = px / pxPer(g, r, uc, a0).deep;
    for (let k = 0; k < 6; k++) em = px / pxPer(g, r, uc, a0 + depth * em - em / 2).deep;
    return em;
  };
  let words: Account | null = null, em = 0;
  for (let lines = ACCOUNT_LINES; lines >= 1; lines--) {
    // (Packed for the floor's em first; the lines it takes decide how deep it is.)
    const guess = emFor(ACCOUNT_LINES * 1.4, INK_PX.line);
    words = accountOf(board, written, { lines, out, width: Math.floor((w * stretch) / (LETTER_EM * guess)) });
    const depth = inkRows(inkLines(words)).depth, least = emFor(depth, INK_PX.line);
    if (depth * least <= a1 - a0 || lines === 1) {
      // Larger where the page has room, up to a fifth more.
      const most = emFor(depth, INK_PX.line * 1.2);
      // Packed again for the em it is lettered at: fewer letters a line may take a line more, so keep what fits.
      const packAt = (e: number): Account => accountOf(board, written, { lines, out, width: Math.floor((w * stretch) / (LETTER_EM * e)) });
      const fits = (x: Account, e: number): boolean => inkRows(inkLines(x)).depth * e <= a1 - a0 + 1e-6;
      em = Math.max(least, Math.min(most, (a1 - a0) / depth));
      let at = packAt(em);
      if (!fits(at, em) && em > least) {
        em = least;
        at = packAt(em);
      }
      if (fits(at, em) || lines === 1) {
        words = at;
        break;
      }
    }
  }
  // (Never less than a finger's patch deep: an account is what a tap opens.)
  const tap = (TAP_PX + 4) / g.u / pxPer(g, r, uc, a0).deep;
  return words ? { words, block: { w, d: Math.max(inkRows(inkLines(words)).depth * em, tap), yaw: r.yaw, em, stretch } } : null;
}

export const told: SeatLayout = { id: "told", plan };
