import { FLOOR } from "../board";
import type { BoardCard } from "../board";
import type { Fixtures, LayoutMemory, Placement, ReadPlace, SeatInput, SeatLayout, SeatPlan, Unit, UnitLook } from "../seat";
import type { CardId, V3 } from "../types";
import { Ledger } from "../ledger";
import { REST, aimWide, readOf, regimentScore, restScore, stanceOf, tagOf } from "../relevance";
import type { Question, Stance, TagFacts } from "../relevance";
import { mat } from "./mat";
import { CH, CW, EDGE, PLATE_IN, PLATE_S, SIDE, TAP_LEAN, clearBehind, floorScale, makeGeo, zoneSide } from "./geometry";
import { TAP_PX } from "../board";
import { bounds, unitShape, zoneShape } from "../shape";
import type { Geo, Region } from "./geometry";

// `ranks`: an opponent's page dealt in the order a player would describe it (docs: the by-relevance direction). From the
// page's front edge, toward the table's middle and me: the read (one or two lines on the margin), the line (the few
// creatures that matter, large), the ranks behind it (regiments of identical cards under a die, a card that just missed
// the line, and one tail of everything small), the shelf (walkers, a column of what binds everyone, a column of their
// own engines, the well), then the plaque. The question changes how cards stand (forward, at ease, down) and what the
// read and the tags say; a card's place changes only when it arrives or leaves, and when its owner tidies at their own
// untap step. My own page is still `mat`'s.

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The line's places, the line's size on screen (design px: side pages, across), the ranks' most places. */
export const RANKS = {
  line: 3,
  linePx: { side: 62, across: 58 },
  ranks: { most: 4, least: 3 },
  /** A line card steps this far toward the front edge when it stands forward (world units); forward is this much larger. */
  step: 0.32,
  forward: 1.15,
  /** A ranks card takes a line place at tidy only if it outscores the incumbent by this much; a newcomer between tidies too. */
  margin: 1.25,
  /** A tail shows at most this many cards; each one under the top shows this share of a card's width (its right-hand sliver). */
  tailShown: 3,
  sliver: 0.3,
  /** A column shows at most this many cards; each under the top shows this share of a card's height (its name strip). */
  columnShown: 3,
  strip: 0.2,
  /** What binds everyone is drawn this much larger than the engines. */
  binds: 1.15,
  /** The read: its first line's height on screen (design px, two lines and the slip), how far it is propped up. */
  readPx: 46,
  /** How the shelf lies: propped a little (it does not fight), so the plaque can stand close behind it. */
  shelf: "lean" as "lean" | "prop" | "flat",
  readTilt: 1.0,
} as const;

/** One thing that could stand on its own: a card, or a regiment of identical cards (members, the shown one first). */
interface Cand {
  readonly key: string;
  readonly ids: CardId[];
  readonly score: number;
  readonly commander: boolean;
  /** Its cards act now (in combat, aimed at): it never folds. */
  readonly acting: boolean;
  /** A card stepped out of the fold `home` (it acts alone). */
  readonly from?: string;
}

/** What the next plan remembers: where each thing lives, and when the page was last tidied. Plain JSON. */
interface Mem {
  line: (string | null)[];
  ranks: string[];
  turn: number;
  /** The turn the last plan saw: a jump of more than one means turns went by unseen (a seat's untap step among them). */
  seen?: number;
  /** The tail's cards: one not in it before lies on top. */
  tail?: CardId[];
  /** The second row as dealt: its own places (keys) and how far its shelf folded, held while a fight is on. */
  own?: string[];
  stage?: number;
  /** Their well lies in the plaque's band (else at the second row's outer end). */
  wellBack?: boolean;
  /** The back band keeps room for the zones and the commander once they have come, so the plaque never slides. */
  nz: number;
  cmd: boolean;
}

const KEYWORDS = (c: BoardCard): string => [...c.keywords].map((k) => k.toLowerCase()).sort().join(",");
/** Identical to the eye for a regiment: name, body, keywords, token. Tapped copies stay in it (they lie turned behind). */
const likeKey = (c: BoardCard): string => `${c.name}|${c.power ?? ""}/${c.toughness ?? ""}|${KEYWORDS(c)}|${c.token ? "t" : ""}`;

function plan(input: SeatInput): SeatPlan {
  if (input.board.mine) return mine(input);
  // The well in the plaque's band where it stands wholly on the page and the screen; else in the second row.
  const p = deal(input, { wellBack: true });
  const well = p.units.find((u) => u.role === "mana" && u.placement.posture === "prop");
  if (!well) return p;
  const sh = unitShape(input.projector, input.seat, well, false), b = bounds(sh.face), f = bounds(sh.foot);
  const page = p.fixtures.page, back = input.projector.project({ x: page.pos.x - Math.sin(page.yaw) * (page.d / 2), y: 0, z: page.pos.z - Math.cos(page.yaw) * (page.d / 2) }).y;
  // (And nothing in front of it reaches its foot.)
  const met = p.units.some((u) => {
    if (u === well) return false;
    const o = bounds(unitShape(input.projector, input.seat, u, false).face);
    return u.placement.pos.z > well.placement.pos.z && o.l < f.r && o.r > f.l && o.t < f.b && o.b > f.t;
  });
  return !met && b.t >= Math.max(back - 2, input.reserve.safe.top + 4) ? p : deal(input, { wellBack: false });
}

function deal(input: SeatInput, opts: { readonly wellBack: boolean }): SeatPlan {
  const { board, region, projector, reserve, involved, pressure } = input;
  const q: Question = input.question ?? REST;
  const r: Region = region;
  const g = makeGeo(projector, reserve, FLOOR.theirs);
  const seat = board.seat;
  const by = new Map(board.cards.map((c) => [c.id, c]));
  const need = (id: CardId): BoardCard => by.get(id)!;
  const prev = input.memory && input.memory.paradigm === "ranks" && input.memory.v === 1 ? (clone(input.memory.fit) as Mem) : null;

  // Attached cards ride on their host; a host stands alone (never in a regiment), as on `mat`.
  const onSeat = new Set(board.cards.map((c) => c.id));
  const dressedBy = new Map<CardId, CardId[]>();
  for (const c of board.cards) if (c.attachedTo !== null && onSeat.has(c.attachedTo)) dressedBy.set(c.attachedTo, [...(dressedBy.get(c.attachedTo) ?? []), c.id]);
  const attached = new Set([...dressedBy.values()].flat());
  const arrived = (a: BoardCard, b: BoardCard) => Number(b.commander) - Number(a.commander) || a.id - b.id;
  const bf = board.cards.filter((c) => !attached.has(c.id)).sort(arrived);
  // (Anything that makes mana is the well's, a rock or not: Lion's Eye Diamond too. Rule cards are not: model `isManaSource`.)
  const isMana = (c: BoardCard) => !c.creature && !c.planeswalker && !c.specialLand && (c.land || c.manaRock || c.treasure || c.manaSource);
  const creatures = bf.filter((c) => c.creature);
  const walkers = bf.filter((c) => c.planeswalker && !c.creature);
  const mana = bf.filter(isMana);
  const support = bf.filter((c) => !c.creature && !c.planeswalker && !isMana(c));

  // ---- candidates: regiments and cards, scored -------------------------------------------------------------------------
  const groups = new Map<string, BoardCard[]>();
  for (const c of creatures) {
    const k = dressedBy.has(c.id) || c.commander ? `#${c.id}` : likeKey(c);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const cands: Cand[] = [];
  for (const [k, cs0] of groups) {
    // A regiment's shown card is a ready one where any is: its tapped copies lie turned behind it.
    const cs = [...cs0.filter((c) => !c.tapped), ...cs0.filter((c) => c.tapped)];
    // A lone card is known by its id (it keeps its home as it grows); a regiment by its look.
    const key = cs0.length > 1 ? `g:${k}` : `c:${cs0[0]!.id}`;
    // A lone card that acts keeps its own home; a regiment's members that act step out of it.
    const split = cs.length > 1;
    const out = split ? cs.filter((c) => involved.has(c.id)) : [], stay = split ? cs.filter((c) => !involved.has(c.id)) : cs;
    const best = Math.max(...cs.map(restScore));
    if (stay.length) cands.push({ key, ids: stay.map((c) => c.id), score: stay.length > 1 ? regimentScore(best, stay.length) : restScore(stay[0]!), commander: stay.some((c) => c.commander), acting: !split && involved.has(stay[0]!.id) });
    for (const c of out) cands.push({ key: `a:${c.id}`, ids: [c.id], score: restScore(c), commander: c.commander, acting: true, from: key });
  }
  const byKey = new Map(cands.map((c) => [c.key, c]));
  const scoreOf = (k: string | null): number => (k && byKey.get(k)?.score) || 0;

  // ---- the line: kept between tidies; at its owner's untap step, re-dealt with a margin ------------------------------
  // The line is dealt and remembered at its full places; at pressure a line of two is shown (its weakest steps back for
  // this plan only, so the place is still its when the pressure goes).
  const places = RANKS.line;
  // A page tidies at its owner's untap step: when its turn has come since the last tidy, or a whole round has gone by
  // (its untap step passed while the table looked elsewhere).
  const turn = input.clock?.turn ?? prev?.turn ?? 0;
  // While a fight is on (attackers declared, or my attack being drafted) nothing re-deals: every page keeps its line, its
  // ranks, its tail and its shelf as they were, and only loses what steps out to fight.
  const frozen = !!prev?.own && (q.q === "fight" || q.q === "strike" || (input.fighting?.size ?? 0) > 0);
  const tidy = !frozen && (!prev || (!!input.clock?.active && turn !== prev.turn) || turn - (prev.seen ?? prev.turn) >= 2);
  const homeKey = (c: Cand): string => c.from ?? c.key;
  const present = new Set(cands.map(homeKey));
  const line: (string | null)[] = (prev?.line ?? []).slice(0, places).map((k) => (k && present.has(k) ? k : null));
  while (line.length < places) line.push(null);
  const onLine = () => new Set(line.filter((k): k is string => !!k));
  const homes = cands.filter((c) => !c.from);
  const known = new Set([...(prev?.line ?? []), ...(prev?.ranks ?? [])].filter(Boolean));
  const weakest = (): number => {
    let at = -1;
    line.forEach((k, i) => {
      if (k && !byKey.get(k)?.commander && (at < 0 || scoreOf(k) < scoreOf(line[at]!))) at = i;
    });
    return at;
  };
  const best = (exclude: Set<string>) => homes.filter((c) => !exclude.has(c.key)).sort((a, b) => Number(b.commander) - Number(a.commander) || b.score - a.score || a.ids[0]! - b.ids[0]!);
  if (tidy) {
    // Gaps close by promotion; the commander always takes a place; a ranks card takes one only by a clear margin.
    const cmd = homes.find((c) => c.commander);
    if (cmd && !onLine().has(cmd.key)) {
      const gap = line.indexOf(null), w = weakest();
      line[gap >= 0 ? gap : w >= 0 ? w : 0] = cmd.key;
    }
    for (let i = 0; i < places; i++) if (line[i] === null) line[i] = best(onLine())[0]?.key ?? null;
    for (const c of best(onLine())) {
      const w = weakest();
      if (w >= 0 && c.score > RANKS.margin * scoreOf(line[w]!)) line[w] = c.key;
    }
    // A first deal stands the commander in the middle place.
    if (!prev && cmd && line.length >= 3) {
      const i = line.indexOf(cmd.key);
      if (i > 0) [line[0], line[i]] = [line[i]!, line[0]!];
    }
  } else if (!frozen) {
    // Between tidies a newcomer that plainly belongs on the line lands there; the weakest steps back, one move.
    for (const c of best(onLine()).filter((c) => !known.has(c.key))) {
      const gap = line.indexOf(null), w = weakest();
      if (gap >= 0 && c.score > RANKS.margin * Math.min(...line.filter(Boolean).map(scoreOf), Infinity)) line[gap] = c.key;
      else if (w >= 0 && c.score > RANKS.margin * scoreOf(line[w]!)) line[w] = c.key;
    }
    // A place left empty (its card died, or the page was first dealt before the cards' data came) closes at once by
    // promotion: one card hops forward rather than a hole waiting for the next tidy.
    for (let i = 0; i < places; i++) if (line[i] === null) line[i] = best(onLine())[0]?.key ?? null;
  }
  const full = [...line];
  if (pressure >= 2 && !frozen) {
    const w = weakest();
    line.splice(w >= 0 ? w : line.length - 1, 1);
  }
  const lineSet = onLine();
  const shownPlaces = line.length;

  // ---- the ranks: kept in the order they had, newcomers after; what has no place lies in the tail ----------------------
  const width = r.w - 2 * MARGIN;
  const restC = homes.filter((c) => !lineSet.has(c.key));
  const order = [...(prev?.ranks ?? []).filter((k) => restC.some((c) => c.key === k)), ...restC.filter((c) => !(prev?.ranks ?? []).includes(c.key)).sort((a, b) => b.score - a.score).map((c) => c.key)];
  const ranked = order.map((k) => byKey.get(k)!);
  // Who keeps a place of its own: regiments before lone cards (a regiment is the most describable thing on a board), the
  // larger first; then lone cards by score. So a lone card enters the tail first, then the smallest regiment.
  const keepRank = [...ranked].sort((a, b) => Number(b.ids.length > 1) - Number(a.ids.length > 1) || b.ids.length - a.ids.length || b.score - a.score || a.ids[0]! - b.ids[0]!);
  /** At most `n` own places in the ranks, kept in their order; the rest lie in the tail (a tail of one is a card). */
  const placed = (n: number): { own: Cand[]; tail: Cand[] } => {
    if (frozen) {
      const own = ranked.filter((c) => prev!.own!.includes(c.key));
      return { own, tail: ranked.filter((c) => !own.includes(c)) };
    }
    if (ranked.length <= n) return { own: ranked, tail: [] };
    const keep = new Set(keepRank.slice(0, Math.max(0, n - 1)).map((c) => c.key));
    const o = ranked.filter((c) => keep.has(c.key)), t = ranked.filter((c) => !keep.has(c.key));
    return t.length === 1 ? { own: [...o, ...t], tail: [] } : { own: o, tail: t };
  };

  // ---- geometry: depths from the front edge, scales from the floors where each row stands ----------------------------
  const vAt = (a: number) => r.d / 2 - a;
  const at = (u: number, a: number): V3 => g.toWorld(r, u, vAt(a));
  const probe = (a: number, sc: number, posture: Placement["posture"], spread?: Unit["spread"]) =>
    unitShape(projector, seat, { id: "", role: "creature", kind: "card", members: [], dressing: [], top: 0 as CardId, title: null, mixed: false, acting: false, tapped: false, placement: { pos: at(0, a), scale: sc, posture }, ...(spread ? { spread } : {}) }, false);
  // The scale a card standing in `posture` at depth `a` needs to be `px` wide on screen (and, lying back, tall enough for
  // a finger): measured with the audit's own quads, so what is planned is what is measured.
  const scaleAt = (a: number, px: number, posture: Placement["posture"] = "stand"): number => {
    const ok = (sc: number): boolean => {
      const sh = probe(a, sc, posture), b = bounds(sh.face);
      // (A card lying flat on a turned page is a slanted quad on screen: it needs more height for a square patch.)
      return sh.width / g.u >= px * 1.02 && b.b - b.t >= Math.max(TAP_PX, FLOOR.any * g.u) * (posture === "flat" ? 1.32 : 1.12);
    };
    let lo = 0.5, hi = 5;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (ok(m)) hi = m;
      else lo = m;
    }
    return hi;
  };
  /** The depth on the page drawn at screen height `y` (CSS px). */
  const groundAt = (y: number): number => {
    let lo = 0, hi = r.d + 6;
    for (let it = 0; it < 22; it++) {
      const m = (lo + hi) / 2;
      if (g.proj.project(at(0, m)).y > y) lo = m;
      else hi = m;
    }
    return hi;
  };
  const side = region.position === "left" || region.position === "right";
  // The read's box: as deep on the page as its lines need on screen, propped up toward me.
  const readA = EDGE * 0.6;
  const readD = readDepth(g, r, readA, RANKS.readPx, RANKS.readTilt);
  const stepOf = (s: number) => RANKS.step + 0 * s;
  // The line: its size on screen, never under the floor; never wider than its places allow.
  const lineScale = (a: number): number => {
    const want = scaleAt(a, (side ? RANKS.linePx.side : RANKS.linePx.across) / Math.cos(TAP_LEAN));
    const floor = scaleAt(a, FLOOR.theirs / Math.cos(TAP_LEAN));
    return Math.max(floor, Math.min(want, width / (shownPlaces * (CH + 0.06))));
  };
  // The line's forward feet stop where the read's top edge is on screen: a card stepping forward never stands on its words.
  const readTop = groundBehind(g, r, readA, readD, RANKS.readTilt);
  let sL = lineScale(readTop + 0.6);
  const aLine = readTop + 0.06 + stepOf(sL) * RANKS.forward;
  sL = lineScale(aLine);
  const lineTop = (s: number) => Math.max(clearBehind(g, r, aLine, s), clearBehind(g, r, aLine - stepOf(s), s * RANKS.forward));
  // The second row: the ranks toward the page's middle, the shelf (what does not fight) toward its outer end.
  const aRanks = lineTop(sL) + 0.05;
  const sR = scaleAt(aRanks, FLOOR.theirs / Math.cos(TAP_LEAN));
  const sT = scaleAt(aRanks, FLOOR.theirs, "lean");
  // (Leaning back, a card needs a tenth more than its floor for a finger's square patch on screen.)
  const sS = scaleAt(aRanks, FLOOR.any * 1.1, RANKS.shelf);
  const sW = scaleAt(aRanks, FLOOR.any * 1.1, "lean");
  const counted = support.filter((c) => c.counted && !c.tapped);
  const binds = support.filter((c) => c.reach === "table" && !counted.includes(c)), engines = support.filter((c) => c.reach !== "table" && !counted.includes(c));
  type Col = { lead: "walkers" | "binds" | "engines"; ids: CardId[]; s: number; leading: number };
  // The shelf folds first: its columns merge, then the walkers join them. A merged column leads with what matters most
  // (walkers, then what binds everyone) and shows that card on top.
  const colsOf = (stage: number): { cols: Col[]; singles: BoardCard[] } => {
    const w = stage >= 2 ? walkers : [], singles = [...(stage >= 2 ? [] : walkers), ...(stage >= 1 ? [] : counted)];
    if (stage >= 1) {
      const lead = w.length ? "walkers" : binds.length ? "binds" : "engines";
      const ids = [...w, ...binds, ...(stage >= 1 ? counted : []), ...engines].map((c) => c.id);
      const leading = lead === "walkers" ? w.length : lead === "binds" ? binds.length : ids.length;
      return { cols: ids.length ? [{ lead, ids, s: sS * (binds.length ? RANKS.binds : 1), leading }] : [], singles };
    }
    return {
      cols: [
        ...(binds.length ? [{ lead: "binds" as const, ids: binds.map((c) => c.id), s: sS * RANKS.binds, leading: binds.length }] : []),
        ...(engines.length ? [{ lead: "engines" as const, ids: engines.map((c) => c.id), s: sS, leading: engines.length }] : []),
      ],
      singles,
    };
  };
  // A place is as wide as the fold shows: a card, and a turned copy's share past its edge where it holds a tapped one.
  const placeOf = (c: Cand) => (c.ids.some((id) => need(id).tapped) ? (c.ids.length > 1 ? CW + 0.24 : CH) + 0.05 : CW + 0.06) * sR;
  const placeW = (CH + 0.06) * sR;
  const nz = Math.max(Number(board.fixtures.graveyard > 0) + Number(board.fixtures.exile > 0), prev?.nz ?? 0);
  const cmdBack = board.fixtures.commandZone;
  const tailWOf = (n: number) => (n ? CW * sT * (1 + RANKS.sliver * (Math.min(RANKS.tailShown, n) - 1)) + 0.1 : 0);
  const cardW = (id: CardId, sc: number) => (need(id).tapped ? CH : CW) * sc + 0.1;
  // The well lies in the plaque's band where the band has room for it; else at the second row's outer end.
  const zS0 = Math.max(0.8, floorScale(g, at(0, r.d - PLATE_IN - 0.5), FLOOR.any, false, 0.8)), zgap0 = Math.max(1.15, zS0 * CW + 0.4), half0 = 1.6 * PLATE_S, cmdOut0 = (2.2 + 0.32) * PLATE_S;
  const eZ0 = Math.max(half0, cmdBack ? cmdOut0 + 0.05 : 0, nz ? (cmdBack ? cmdOut0 + 0.25 : half0 + 0.2) + nz * zgap0 : 0);
  const wellBack = opts.wellBack && mana.length > 0 && pressure < 4 && eZ0 + half0 + WELL_GAP + CW * zS0 + 0.1 <= width;
  // Cards acting alone (aimed at) step out of their fold: into a free place on the line where their fold stands there,
  // else at the second row's middle end, its own place counted in the row. (A fighter stands in the combat row in the
  // middle: its fold keeps its place, and it needs none of its own.)
  const fights = (c: Cand) => c.ids.some((id) => input.fighting?.has(id));
  const fighters = cands.filter((c) => c.from && fights(c));
  const actors = cands.filter((c) => c.from && !fights(c));
  const lineFree = line.map((k, i) => (k === null ? i : -1)).filter((i) => i >= 0);
  const actorLine = new Map<string, number>();
  for (const c of actors) if (lineSet.has(c.from!) && lineFree.length) actorLine.set(c.key, lineFree.shift()!);
  const actorRow = actors.filter((c) => !actorLine.has(c.key));
  const actorW = actorRow.length * placeW;
  // Fold by width: the shelf first (its columns merge, then the walkers join), then the ranks give places to the tail,
  // a lone card first, the smallest regiment last.
  const most = Math.min(RANKS.ranks.most, ranked.length);
  const LADDER: { own: number; stage: number }[] = [
    { own: most, stage: 0 },
    { own: most, stage: 1 },
    { own: most, stage: 2 },
    ...Array.from({ length: most }, (_, i) => ({ own: most - 1 - i, stage: 2 })),
  ];
  let rung: { ranks: { own: Cand[]; tail: Cand[] }; cols: Col[]; singles: BoardCard[]; stage: number; w: number } | null = null;
  const from = frozen ? Math.max(0, LADDER.findIndex((L) => L.stage === (prev!.stage ?? 0))) : Math.min(pressure, LADDER.length - 1);
  for (let k = from; k < LADDER.length; k++) {
    const L = LADDER[k]!, rk = placed(L.own), { cols, singles } = colsOf(L.stage);
    const w =
      rk.own.reduce((t, c) => t + placeOf(c), 0) +
      tailWOf(rk.tail.reduce((t, c) => t + c.ids.length, 0)) +
      singles.reduce((t, c) => t + cardW(c.id, sS), 0) +
      cols.reduce((t, c) => t + cardW(c.ids[0]!, c.s), 0) +
      // (In the plaque's band, the well still wants the row's outer end free under it.)
      (mana.length ? (wellBack ? CW * zS0 * 0.9 : CW * sW + 0.3) : 0) +
      actorW;
    rung = { ranks: rk, cols, singles, stage: L.stage, w };
    if (w <= width || frozen) break;
  }
  const { ranks, cols: columns, singles } = rung!;
  const tailIds = ranks.tail.flatMap((c) => c.ids);

  // ---- units ---------------------------------------------------------------------------------------------------------
  const out: Unit[] = [];
  const total = board.cards.filter((c) => c.creature).length;
  const wide = aimWide(q, total);
  const stanceOfCard = (c: BoardCard): Stance | null => (wide ? null : stanceOf(c, seat, false, q));
  const answers = (c: BoardCard) => stanceOfCard(c) === "forward";
  // A page the question is not about keeps its rest words: its tags say what they hold, not "0 ready".
  const asked = board.cards.some((c) => stanceOfCard(c) !== null);
  const qTag: Question = asked ? q : REST;
  const foldStance = (ids: readonly CardId[]): Stance => {
    const ss = ids.map((id) => stanceOfCard(need(id)));
    if (ss.includes("forward")) return "forward";
    if (ss.length && ss.every((s) => s === "down")) return "down";
    return "ease";
  };
  const idOf = (key: string) => `${seat}/${key}`;
  const push = (u: Omit<Unit, "dressing" | "mixed" | "acting" | "title"> & Partial<Pick<Unit, "mixed" | "acting" | "title">>): void => {
    const dressing = u.members.flatMap((id) => dressedBy.get(id) ?? []);
    out.push({ title: null, mixed: false, acting: false, ...u, dressing });
  };
  // Only the line steps (and grows); the ranks rise where they stand, so a row never walks into the one in front.
  const standing = (a: number, u: number, s: number, st: Stance, step: boolean, tapped = false): Placement => {
    // (Down lays an untapped card flat; a tapped one stays turned, as it was, and is only shaded.)
    if (st === "down") return { pos: at(u, a), scale: s, posture: tapped ? "stand" : "flat" };
    if (st === "forward" && step) return { pos: at(u, a - stepOf(s)), scale: s * RANKS.forward, posture: "stand" };
    return { pos: at(u, a), scale: s, posture: "stand" };
  };
  const creatureUnit = (c: Cand, a: number, u: number, s: number, step: boolean, pos?: V3): void => {
    const ids = c.ids, top = ids[0]!, look: UnitLook = ids.length > 1 ? "regiment" : "card";
    const st = c.acting ? "ease" : foldStance(ids);
    // A regiment's face says its name and body and its die its count: its tag speaks only to answer ("7 ready").
    const t = look === "regiment" ? tagOf("regiment", ids.map(need), qTag, answers) : undefined;
    const tag: TagFacts | undefined = t && t.t === "regiment" && t.answer && t.answer.n > 0 ? t : undefined;
    push({
      id: idOf(c.key),
      role: "creature",
      kind: ids.length > 1 ? "pile" : "card",
      members: ids,
      top,
      tapped: need(top).tapped,
      acting: c.acting,
      placement: pos ? { pos, scale: s, posture: "stand" } : standing(a, u, s, st, step, need(top).tapped),
      look,
      stance: st,
      ...(tag ? { tag } : {}),
    });
  };
  // The line, centred, left to right in its slot order.
  const per = (CH + 0.06) * sL;
  line.forEach((k, i) => {
    const c = k ? byKey.get(k) : undefined;
    if (!c) return;
    creatureUnit(c, aLine, (i - (shownPlaces - 1) / 2) * per, sL, true);
  });
  // The second row, from the page's middle side outward (`toward`): own places, the tail, walkers, the columns, the well.
  const toward = side ? zoneSide(false, r.x) : 1;
  type Item = { w: number; put: (u: number) => void };
  const row: Item[] = [];
  for (const c of actorRow) row.push({ w: placeW, put: (u) => creatureUnit(c, aRanks, u, sR, false) });
  for (const c of ranks.own) row.push({ w: placeOf(c), put: (u) => creatureUnit(c, aRanks, u, sR, false) });
  // The tail's top card is its best answer to the question; at rest, a card that has just arrived lies on top, whole, as a
  // new card on a pile would; else the one that matters most.
  const wasTail = new Set(prev?.tail ?? []);
  const fresh = (id: CardId) => !!prev?.tail && !wasTail.has(id);
  const tailFan = [...tailIds].sort((x, y) => Number(answers(need(y))) - Number(answers(need(x))) || Number(fresh(y)) - Number(fresh(x)) || restScore(need(y)) - restScore(need(x)) || x - y);
  const shown = tailFan.slice(0, RANKS.tailShown);
  // A tail says what it holds; under a question, its part of the answer, and nothing when that is none (it lies down),
  // nor under a sweep (the read carries the price).
  const tailTag = (): { tag?: TagFacts } => {
    if (q.q === "sweep") return {};
    const t = tagOf("tail", tailIds.map(need), qTag, answers);
    return t.t === "tail" && t.answer && t.answer.n === 0 ? {} : { tag: t };
  };
  if (tailIds.length) {
    const tw = tailWOf(tailIds.length);
    row.push({
      w: tw,
      // A tail lies propped a little, its top card whole at the left and the others under it to the right, each showing
      // its sliver (its power and toughness).
      put: (u) =>
        push({
          id: idOf("tail"),
          role: "creature",
          kind: "pile",
          members: tailFan,
          top: tailFan[0]!,
          tapped: false,
          mixed: true,
          placement: { pos: at(u - tw / 2 + 0.1 + (CW * sT) / 2, aRanks), scale: sT, posture: "lean" },
          look: "tail",
          stance: foldStance(tailIds),
          ...tailTag(),
          fan: shown,
          lit: q.q === "rest" ? [] : tailFan.filter((id) => answers(need(id))),
          spread: { right: RANKS.sliver * (shown.length - 1), back: 0 },
        }),
    });
  }
  // Walkers stand singly while there is room (they are attack targets), and so does a noncreature with counters.
  for (const w of singles)
    row.push({
      w: cardW(w.id, sS),
      put: (u) => push({ id: idOf(`s:${w.id}`), role: w.planeswalker ? "walker" : "support", kind: "card", members: [w.id], top: w.id, tapped: w.tapped, placement: { pos: at(u, aRanks), scale: sS, posture: RANKS.shelf }, look: "card" }),
    });
  for (const col of columns) {
    const ids = col.ids, n = ids.length, sc = col.s, fan = ids.slice(0, RANKS.columnShown);
    row.push({
      w: cardW(ids[0]!, sc),
      put: (u) =>
        push({
          id: idOf(n > 1 ? `col:${col.lead}` : `s:${ids[0]}`),
          role: need(ids[0]!).planeswalker ? "walker" : "support",
          kind: n > 1 ? "pile" : "card",
          members: ids,
          top: ids[0]!,
          tapped: need(ids[0]!).tapped,
          mixed: n > 1,
          placement: { pos: at(u, aRanks), scale: sc, posture: RANKS.shelf },
          look: n > 1 ? "column" : "card",
          ...(n > 1 ? { tag: { t: "column" as const, lead: col.lead, leading: col.leading, more: n - (col.lead === "engines" ? n : col.leading) }, fan, spread: { right: 0, back: RANKS.strip * (fan.length - 1) } } : {}),
        }),
    });
  }
  const wellRep = mana.length ? (mana.find((c) => c.land && !c.tapped) ?? mana.find((c) => c.land) ?? mana[0]!).id : null;
  const wellIds = wellRep === null ? [] : [wellRep, ...mana.map((c) => c.id).filter((id) => id !== wellRep)];
  if (mana.length && !wellBack) {
    const rep = wellRep!, ids = wellIds;
    row.push({
      w: CW * sW + 0.35,
      put: (u) => push({ id: idOf("well"), role: "mana", kind: "well", members: ids, top: rep, tapped: false, placement: { pos: at(u, aRanks), scale: sW, posture: "lean" }, look: "card" }),
    });
  }
  const rowW = row.reduce((t, x) => t + x.w, 0), nLine = out.length;
  // (With the well in the plaque's band at the outer end, the row starts from the middle side and leaves under it free.)
  let su = wellBack ? (toward * width) / 2 : (toward * rowW) / 2;
  for (const it of row) {
    it.put(su - (toward * it.w) / 2);
    su -= toward * it.w;
  }
  for (const [key, i] of actorLine) creatureUnit(byKey.get(key)!, aLine, (i - (shownPlaces - 1) / 2) * per, sL, true);
  for (const c of fighters) {
    const home = out.find((x) => x.id === idOf(c.from!)), slot = line.indexOf(c.from!);
    if (home) creatureUnit(c, 0, 0, home.placement.scale, false, home.placement.pos);
    else if (slot >= 0) creatureUnit(c, aLine, (slot - (shownPlaces - 1) / 2) * per, sL, true);
    else creatureUnit(c, aRanks, (-toward * rowW) / 2, sR, false);
  }

  // ---- the plaque's band, behind the second row's tallest top (and its tags) ------------------------------------------
  // (A creature lying down measures as standing: it stands again with the next question.)
  const second = out.slice(nLine);
  const rowTop = Math.min(
    ...second.map((u) => bounds(unitShape(projector, seat, { ...u, placement: { ...u.placement, posture: u.placement.posture === "flat" && u.role === "creature" ? "stand" : u.placement.posture } }, false).face).t),
    // (Room for a standing card where the row holds creatures; a row of things that do not fight is lower.)
    second.some((u) => u.role === "creature") ? bounds(probe(aRanks, sR, "stand").face).t : Infinity,
  );
  const tagged = second.some((u) => u.tag);
  const plateA = groundAt(rowTop - (tagged ? 22 : 4) * g.u) + 0.1;
  const pf = g.toWorld(r, 0, vAt(plateA));
  const ty = g.proj.project({ x: pf.x, y: pf.y + 0.84 * Math.cos(g.pitch) * PLATE_S, z: pf.z - 0.84 * Math.sin(g.pitch) * PLATE_S }).y;
  const D = Math.min(r.d, Math.max(plateA + PLATE_IN, groundAt(ty) + 0.7, plateA + CH * 0.6));
  const zS = Math.max(0.8, floorScale(g, at(0, Math.min(plateA, r.d - PLATE_IN)), FLOOR.any, false, 0.8));
  const half = 1.6 * PLATE_S, cmdOut = (2.2 + 0.32) * PLATE_S, zs = zoneSide(false, r.x), zgap = Math.max(1.15, zS * CW + 0.4);
  const z0 = cmdBack ? cmdOut + 0.25 + zgap / 2 : half + 0.2 + zgap / 2, zonesU = [...Array(nz).keys()].map((i) => z0 + i * zgap);
  // The band centred on the page: the plaque, its piles (and the commander) toward the middle, the well beyond it.
  const sWell = wellBack ? zS : 0;
  const far = half + (wellBack ? WELL_GAP + CW * sWell : 0);
  const eZ = Math.max(half, cmdBack ? cmdOut + 0.05 : 0, nz ? zonesU[nz - 1]! + zgap / 2 : 0), c0 = (-zs * (eZ - far)) / 2;
  const backW = eZ + far + 2 * SIDE;


  if (wellBack) {
    // Propped as the zone piles are beside it, as large as the floors ask there.
    // (Its foot a little in front of the plaque's, as the zone piles' near edges stand, so its top stays on the page.)
    push({ id: idOf("well"), role: "mana", kind: "well", members: wellIds, top: wellIds[0]!, tapped: false, placement: { pos: at(c0 - zs * (half + WELL_GAP + (CW * sWell) / 2), plateA - (CH / 2) * sWell * WELL_FORWARD), scale: sWell, posture: "prop" }, look: "card" });
  }

  // ---- fixtures: the page, the read, the plaque, the zones, the commander ---------------------------------------------
  const W = Math.min(r.w, Math.max(2 * MARGIN + Math.max(shownPlaces * per, rowW), backW, 6));
  const plate: Placement = { pos: at(c0, plateA), scale: PLATE_S, posture: "stand" };
  const zones: Fixtures["zones"][number][] = [];
  (["graveyard", "exile"] as const)
    .filter((z) => board.fixtures[z] > 0)
    .forEach((zone, i) => {
      const u = zonesU[i];
      if (u === undefined) return;
      // (A pile is propped from its near edge, half a card in front of where it stands: where something of the second row
      // reaches that edge on screen, the pile stands back by that half card.)
      const near = (pa: number) => bounds(zoneShape(projector, seat, zone, { pos: at(c0 + zs * u, pa), scale: zS, posture: "prop" }, false).foot);
      const f = near(plateA);
      const met = second.some((x) => {
        const b = bounds(unitShape(projector, seat, x, false).face);
        return b.l < f.r && b.r > f.l && b.t < f.b && b.b > f.t;
      });
      zones.push({ zone, placement: { pos: at(c0 + zs * u, met ? plateA + (CH / 2) * zS : plateA), scale: zS, posture: "prop" } });
    });
  let commander: Fixtures["commander"];
  if (board.fixtures.commander !== undefined) {
    const pos: V3 = { x: plate.pos.x + zs * 2.2 * PLATE_S, y: plate.pos.y, z: plate.pos.z - 0.06 * PLATE_S };
    commander = { card: board.fixtures.commander, placement: { pos, scale: Math.max(0.9 * PLATE_S, floorScale(g, pos, FLOOR.any, false, 0.9 * PLATE_S)), posture: "stand" } };
  }
  const folded = out.some((u) => u.look === "regiment" || u.look === "tail");
  const facts = readOf(board.cards, seat, false, q, folded);
  const read: ReadPlace | undefined = facts ? { pos: at(0, readA), w: Math.min(W - 2 * SIDE, 6.2), d: readD, yaw: r.yaw, tilt: RANKS.readTilt, facts } : undefined;
  const fixtures: Fixtures = {
    page: { pos: g.toWorld(r, 0, r.d / 2 - D / 2), w: W, d: D, yaw: r.yaw },
    plate,
    zones,
    ...(commander ? { commander } : {}),
    ...(read ? { read } : {}),
  };
  const mem: Mem = {
    line: full.map((k) => (k && byKey.has(k) ? k : null)),
    ranks: order,
    turn: tidy ? turn : prev!.turn,
    seen: turn,
    tail: tailIds,
    own: ranks.own.map((c) => c.key),
    stage: rung!.stage,
    wellBack,
    nz,
    cmd: cmdBack,
  };
  const memory: LayoutMemory = { v: 1, paradigm: "ranks", fit: mem };
  return new Ledger(board.cards.map((c) => c.id)).seal({
    seat,
    units: out,
    fixtures,
    memory,
    report: { folded: Math.max(0, tailIds.length - 1) + out.filter((u) => u.look === "regiment" || u.look === "column").reduce((t, u) => t + u.members.length - 1, 0), held: !tidy, pressure, overflow: plateA + PLATE_IN > r.d, lastResort: false },
  });
}

/** The page's margin at its sides, inside which its rows lie. */
const MARGIN = 0.35;
/** Between the plaque and the well beside it. */
const WELL_GAP = 0.55;
/** How far in front of the plaque's foot the well stands, in half its card's height. */
const WELL_FORWARD = 1.6;

/** How deep on the page (from its near edge at depth `a`) a box propped `tilt` up must be to stand `px` tall on screen. */
function readDepth(g: Geo, r: Region, a: number, px: number, tilt: number): number {
  const v = r.d / 2 - a, base = g.toWorld(r, 0, v);
  const tall = (d: number) => {
    const far = { x: base.x - Math.sin(r.yaw) * d * Math.cos(tilt), y: d * Math.sin(tilt), z: base.z - Math.cos(r.yaw) * d * Math.cos(tilt) };
    return (g.proj.project(base).y - g.proj.project(far).y) / g.u;
  };
  let lo = 0.1, hi = 4;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (tall(m) < px) lo = m;
    else hi = m;
  }
  return hi;
}

/** The depth on the page whose ground point is drawn where the top edge of a box propped `tilt` up (depth `a` to `a + d`) is. */
function groundBehind(g: Geo, r: Region, a: number, d: number, tilt: number): number {
  const base = g.toWorld(r, 0, r.d / 2 - a);
  const top = g.proj.project({ x: base.x - Math.sin(r.yaw) * d * Math.cos(tilt), y: d * Math.sin(tilt), z: base.z - Math.cos(r.yaw) * d * Math.cos(tilt) }).y;
  let lo = a, hi = r.d + 4;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (g.proj.project(g.toWorld(r, 0, r.d / 2 - m)).y > top) lo = m;
    else hi = m;
  }
  return hi;
}

/**
 * My page: `mat`'s places (the by-relevance grammar for my own board is stance alone so far). Under a question my
 * creatures answer it as theirs do: what I can still use stands, what I cannot lies down where it stands.
 */
function mine(input: SeatInput): SeatPlan {
  const p = mat.plan(input), q = input.question ?? REST;
  if (q.q === "rest" || q.q === "stack") return p;
  const by = new Map(input.board.cards.map((c) => [c.id, c]));
  const stance = (u: Unit): Stance | null => {
    if (u.role !== "creature" || u.acting || u.fighting) return null;
    const ss = u.members.map((id) => by.get(id)).map((c) => (c ? (q.q === "threat" || q.q === "fight" ? (c.tapped ? "down" : q.q === "fight" && q.blockers.length && !q.blockers.includes(c.id) ? "down" : "forward") : stanceOf(c, input.seat, true, q)) : null));
    if (ss.includes("forward")) return "forward";
    return ss.length && ss.every((s) => s === "down") ? "down" : null;
  };
  const units = p.units.map((u) => {
    const st = stance(u);
    if (!st) return u;
    return { ...u, stance: st, ...(st === "down" ? { tapped: false, placement: { ...u.placement, posture: "flat" as const } } : {}) };
  });
  return { ...p, units };
}

export const ranks: SeatLayout = { id: "ranks", plan };



