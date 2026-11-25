import { FLOOR } from "../board";
import type { BoardCard } from "../board";
import { Ledger } from "../ledger";
import type { Fixtures, LayoutMemory, Placement, SeatInput, SeatLayout, SeatPlan, Unit } from "../seat";
import type { CardId, V3 } from "../types";
import { ACCOUNT_LINES, accountOf, byImportance, kindOf } from "../told/account";
import type { Account } from "../told/account";
import { INK_PX, LETTER_EM, inkLines, inkRows } from "../told/ink";
import type { Fit } from "./fit";
import { CH, CW, EDGE, PLATE_IN, SIDE, bandSpan, clearBehind, floorScale, makeGeo } from "./geometry";
import type { Geo, Region } from "./geometry";
import { mat } from "./mat";

// `told` ("Told, not shown"): a page of a bestiary. While a board is small its page is `mat`'s, card for card. Once it
// outgrows its page, the page stops trying to hold cards and writes them down: the creatures that matter most stand in
// one front row at the floor, planeswalkers prop beside the well, and everything else becomes the page's account, ink in
// the vellum behind the row (told/account.ts): one summary unit that opens a sift of every written card. Mine is always
// `mat`'s: I act with my cards, so they stay cards. Cards acting (in a fight, aimed at) stand as units of their own.

/** A page opens again only once it is this many places clear of the eight it writes at, so it does not flicker. */
const OPEN_AT = { write: 8, open: 6 } as const;
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
  // The places `mat` would need: a unit each (a pile of copies is one), and what it folded.
  const places = open.units.filter((u) => u.role !== "mana").length + open.report.folded;
  const limit = was?.mode === "told" ? OPEN_AT.open : OPEN_AT.write;
  if (places <= limit && !open.units.some((u) => u.mixed) && open.report.folded === 0) return wrap(open, "open");
  const p = written(input, open, was);
  return wrap(p.plan, "told", p.stand);
}

/** A told page: the front row, the well and planeswalkers beside the account, the plaque at the back as `mat` sets it. */
function written(input: SeatInput, open: SeatPlan, was: ToldMemory | null): { plan: SeatPlan; stand: CardId[] } {
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
  // say completely is written first). The row stands at its floor across the page's front edge.
  const sizes = new Map<string, number>();
  for (const c of creatures) sizes.set(kindOf(c), (sizes.get(kindOf(c)) ?? 0) + 1);
  const like = (c: BoardCard): boolean => (sizes.get(kindOf(c)) ?? 0) > 1;
  const first = (c: BoardCard): number => (involved.has(c.id) ? 0 : c.commander ? 1 : like(c) ? 3 : 2);
  const wanted = [...creatures].sort((a, b) => first(a) - first(b) || byImportance(a, b));
  const aF = EDGE + 0.2 * 1.3;
  const span = bandSpan(g, r, false, aF);
  const s = Math.max(1.3, floorScale(g, at(span.uc, aF), FLOOR.theirs, false, 1.3));
  const wide = (c: BoardCard): number => ((c.tapped ? CH : CW) + ROW_GAP) * s;
  const stand: BoardCard[] = [];
  let used = 0;
  for (const c of wanted) {
    const w = wide(c);
    if (used + w - ROW_GAP * s > span.w + 1e-6 && !involved.has(c.id) && !c.commander) continue;
    stand.push(c);
    used += w;
  }
  // Across the row they keep the order they stood in last time; newcomers by when they came (the commander first).
  const before = new Map((was?.stand ?? []).map((id, i) => [id, i]));
  const order = [...stand].sort((a, b) => (before.get(a.id) ?? 1e6) - (before.get(b.id) ?? 1e6) || Number(b.commander) - Number(a.commander) || a.id - b.id);
  const fits = order.reduce((t, c) => t + wide(c), 0) - ROW_GAP * s <= span.w + 1e-6;
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
  let u0 = span.uc - Math.min(span.w, order.reduce((t, c) => t + wide(c), 0) - ROW_GAP * s) / 2;
  for (const c of order) {
    const w = wide(c) - ROW_GAP * s;
    // (More acting than the row holds: the rest wait behind it, at the row's middle; the combat row takes them.)
    const u = fits || u0 + w <= span.hi + 1e-6 ? u0 + w / 2 : span.uc;
    units.push(card(involved.has(c.id) ? "f" : "c", c, { pos: at(u, aF), scale: s, posture: "stand" }, "creature"));
    u0 += wide(c);
  }

  // Behind the row: the well and the planeswalkers in a column at the page's right, the account to its left.
  const behind = clearBehind(g, r, aF, s) + 0.1;
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
  const wellScale = (a: number, u: number): number => Math.max(1.1, floorScale(g, at(u, a), FLOOR.any, true, 1.1));
  const wellFar = (a: number, ws: number, u: number): boolean => a + CH * ws <= Math.min(plateA - 0.5, zoneNear(u - (CW / 2) * ws, u + (CW / 2) * ws)) + 1e-6;
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
    if (!wellFar(aCol, ws, u)) aCol = Math.min(plateA - 0.5, zoneNear(u - (CW / 2) * ws, u + (CW / 2) * ws)) - CH * ws;
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

  // The account: every creature not standing and every work, in ink from just behind the row toward the plaque.
  const standing = new Set(stand.map((c) => c.id));
  const writtenIds = new Set<CardId>([...creatures.filter((c) => !standing.has(c.id)), ...works].map((c) => c.id));
  const lo = -r.w / 2 + SIDE + INK_MARGIN, hi = (mana.length || walkers.length ? colLo : colHi) - 0.2;
  // (It ends short of the plaque, and of the zone piles' near edges: a propped pile reaches half a card toward me.)
  const block = writtenIds.size ? inkBlock(g, r, board, writtenIds, lo, hi, behind, Math.min(plateA - 0.4, zoneNear(lo, hi))) : null;
  if (block) {
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
      placement: { pos: at((lo + hi) / 2, behind), scale: 1, posture: "flat" },
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
  };
  const sealed = new Ledger(board.cards.map((c) => c.id)).seal({
    seat: board.seat,
    units,
    fixtures,
    memory: open.memory,
    report: { folded: writtenIds.size, held: false, pressure: input.pressure, overflow: false, lastResort: false },
  });
  return { plan: sealed, stand: order.map((c) => c.id) };
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
function inkBlock(g: Geo, r: Region, board: SeatInput["board"], written: ReadonlySet<CardId>, lo: number, hi: number, a0: number, a1: number): NonNullable<Unit["account"]> | null {
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
    words = accountOf(board, written, { lines, width: Math.floor((w * stretch) / (LETTER_EM * guess)) });
    const depth = inkRows(inkLines(words)).depth, least = emFor(depth, INK_PX.line);
    if (depth * least <= a1 - a0 || lines === 1) {
      // Larger where the page has room, up to a fifth more.
      const most = emFor(depth, INK_PX.line * 1.2);
      // Packed again for the em it is lettered at: fewer letters a line may take a line more, so keep what fits.
      const packAt = (e: number): Account => accountOf(board, written, { lines, width: Math.floor((w * stretch) / (LETTER_EM * e)) });
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
  return words ? { words, block: { w, d: inkRows(inkLines(words)).depth * em, yaw: r.yaw, em, stretch } } : null;
}

export const told: SeatLayout = { id: "told", plan };
