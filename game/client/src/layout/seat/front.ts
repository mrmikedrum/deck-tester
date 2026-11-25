import { FLOOR, TAP_PX } from "../board";
import { bounds, unitShape } from "../shape";
import type { BoardCard } from "../board";
import type { Fixtures, LayoutMemory, Placement, SeatInput, SeatLayout, SeatPlan, Unit, UnitRole } from "../seat";
import type { CardId, V3 } from "../types";
import { Ledger } from "../ledger";
import { RULE_CARDS } from "../../model";
import { CH, CW, PLATE_S, ZONE_S, clearBehind, floorScale, makeGeo } from "./geometry";
import type { Geo, Region } from "./geometry";
import { chooseFront, weightOf } from "./rank";
import type { Candidate } from "./rank";

// `front`: the focus-first leaf (docs: the focus-first direction). An opponent's seat at rest is a page of fixed size:
// its near edge holds the commander and the heaviest threats standing (the front), behind them lie the well, the works
// and the muster (every other creature, one shingled pile), and at the back the plaque and the zone piles. Identical
// creatures stand as one regiment. Just off the near edge, on the floor, lies the lip: the card that seat played last,
// and any card acting now (a target, a fighter) that would otherwise be inside a pile. The page never grows or shrinks.
// Seeing every card is the spread's work (a look), not the leaf's.

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The front's places, and the front's face width on screen (design px): its floor and what a small board gets. */
export const LEAF = {
  places: 4,
  frontPx: { lo: 60, hi: 72 },
  side: 0.35,
  /** The slip: a strip of vellum laid square along the leaf's near border, inside it (about 30 px deep). */
  slip: { from: 0.05, d: 0.84 },
  /** The front's feet, in from the near edge: just behind the slip. */
  foot: 1.0,
  /** A card on the lip: floor scale, as my own creatures. */
  lipPx: 72,
  /** Past these, things fold: creatures and walkers standing, other permanents lying singly. */
  compact: { standing: 4, lying: 3 },
} as const;

interface FrontMemory {
  /** The front's places, left to right (a unit key or null). */
  readonly front: (string | null)[];
  /** Each regiment's key (its look) to the unit id it was given, so a regiment keeps its piece when its first card goes. */
  readonly ids: Record<string, string>;
  /** Every card on the board last time: what is new this time. */
  readonly seen: number[];
  /** The card on the lip. */
  readonly lip: number | null;
  /** The turn and whose it was at the last plan: the lip holds only what arrived since this seat's turn began. */
  readonly turn?: number;
  readonly active?: string | null;
}

/** Identical to the eye but for tapped and summoning sickness: the cards one regiment holds (the model's `sig`, those two
 *  fields dropped; a hand-written board's short sig, its tapped field). */
const lookKey = (c: BoardCard): string => {
  const p = c.sig.split("|");
  return (p.length >= 10 ? p.filter((_, i) => i !== 3 && i !== 5) : p.filter((x) => x !== String(c.tapped))).join("|");
};

interface Group {
  key: string;
  role: UnitRole;
  ids: CardId[];
}

const PROBE: Unit = { id: "probe", role: "support", kind: "card", members: [], dressing: [], top: 0 as CardId, title: null, mixed: false, acting: false, tapped: false, placement: { pos: { x: 0, y: 0, z: 0 }, scale: 1, posture: "stand" } };

/** The scale a card needs at `pos` in `posture` to be `px` wide (design px) and a finger's 44 px tall on screen. */
function sizeFor(g: Geo, pos: V3, posture: Placement["posture"], px: number): number {
  const probe: Unit = { ...PROBE, placement: { pos, scale: 1, posture } };
  const sh = unitShape(g.proj, "", probe, false), b = bounds(sh.face);
  const wide = sh.width / g.u, tall = (b.b - b.t) / g.u, tap = Math.max(FLOOR.any, TAP_PX / g.u) * 1.25;
  return Math.max((Math.max(px, TAP_PX / g.u) * 1.15) / wide, tap / tall);
}

/** How deep into the leaf (from its near edge) the table is first above screen height `y`. */
function behind(g: Geo, r: Region, y: number, u = 0): number {
  let lo = 0, hi = r.d * 2;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (g.proj.project(g.toWorld(r, u, r.d / 2 - m)).y > y) lo = m;
    else hi = m;
  }
  return hi;
}

/** A works pile's tab names what acts on play: its planeswalkers, and how many rule-changing cards (`RULE_CARDS`). */
function worksNote(cs: readonly BoardCard[]): string | undefined {
  const walkers = cs.filter((c) => c.planeswalker).map((c) => c.name.split(/[\s,]/)[0]!);
  const rules = cs.filter((c) => RULE_CARDS.has(c.name)).length;
  const parts = [...walkers, ...(rules ? [`${rules} rule${rules > 1 ? "s" : ""}`] : [])];
  return parts.length ? `· ${parts.join(" · ")}` : undefined;
}

const isMana = (c: BoardCard): boolean => !c.creature && !c.planeswalker && !c.specialLand && (c.land || c.manaRock || c.treasure);

function plan(input: SeatInput): SeatPlan {
  const { board, region: r, projector, reserve, involved } = input;
  const g = makeGeo(projector, reserve, FLOOR.theirs);
  const mem = input.memory && input.memory.paradigm === "front" && input.memory.v === 1 ? clone(input.memory.fit as FrontMemory) : null;
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  const need = (id: CardId): BoardCard => byId.get(id)!;

  // Attached cards ride on their host; a host stands alone.
  const onSeat = new Set(board.cards.map((c) => c.id));
  const dressedBy = new Map<CardId, CardId[]>();
  const attached = new Set<CardId>();
  for (const c of board.cards)
    if (c.attachedTo !== null && onSeat.has(c.attachedTo)) {
      attached.add(c.id);
      dressedBy.set(c.attachedTo, [...(dressedBy.get(c.attachedTo) ?? []), c.id]);
    }
  const arrived = (a: BoardCard, b: BoardCard) => Number(b.commander) - Number(a.commander) || a.id - b.id;
  const bf = board.cards.filter((c) => !attached.has(c.id)).sort(arrived);
  const creatures = bf.filter((c) => c.creature);
  const walkers = bf.filter((c) => c.planeswalker && !c.creature);
  const support = bf.filter((c) => !c.creature && !c.planeswalker && !isMana(c));
  const mana = bf.filter(isMana);
  const compact = creatures.length + walkers.length <= LEAF.compact.standing && support.length <= LEAF.compact.lying;

  // Regiments: like creatures with nothing attached, unless the board is small enough for every card to stand alone.
  const ids: Record<string, string> = {};
  const groups: Group[] = [];
  const byLook = new Map<string, Group>();
  for (const c of creatures) {
    const k = lookKey(c);
    const alone = compact || c.commander || dressedBy.has(c.id) || c.legendary;
    const had = alone ? undefined : byLook.get(k);
    if (had) had.ids.push(c.id);
    else {
      const gr: Group = { key: alone ? `c${c.id}` : `r${c.id}`, role: "creature", ids: [c.id] };
      groups.push(gr);
      if (!alone) byLook.set(k, gr);
    }
  }
  // A regiment keeps the id it had while any of its cards is still on the board.
  for (const [k, gr] of byLook) {
    const was = mem?.ids[k];
    if (was && gr.ids.length > 1 && (!mem || gr.ids.some((id) => mem.seen.includes(id)))) gr.key = was;
    else if (gr.ids.length === 1) gr.key = `c${gr.ids[0]}`;
    ids[k] = gr.key;
  }
  for (const w of walkers) groups.push({ key: `w${w.id}`, role: "walker", ids: [w.id] });

  // The front: the commander, then the heaviest (rank.ts).
  const cmd = groups.find((gr) => need(gr.ids[0]!).commander) ?? null;
  const cands: Candidate[] = groups.map((gr) => {
    const cs = gr.ids.map(need);
    return { key: gr.key, weight: weightOf(cs), legendary: cs.some((c) => c.legendary || c.commander), oldest: Math.min(...gr.ids) };
  });
  const places = Math.max(1, LEAF.places - Math.floor(input.pressure / 2));
  const front = chooseFront(cands, mem ? mem.front.slice(0, places) : null, places, cmd?.key ?? null);
  const inFront = new Set(front.filter((k): k is string => k !== null));

  // What is new since the last plan, and so the lip: the newest that does not stand in the front. It lies there until
  // the seat does something else (another arrival), and leaves when it does.
  // Only what was seen to arrive counts: a board I sit down to, or one that jumped turns, has no news on its lips. And the
  // lip empties when this seat's own turn begins.
  const seen = new Set(mem?.seen ?? []);
  const turn = input.turn ?? null, active = input.active ?? null;
  const witnessed = !!mem && turn !== null && mem.turn !== undefined && turn - mem.turn <= 1 && turn >= mem.turn;
  const fresh = witnessed ? bf.filter((c) => !seen.has(c.id) && !isMana(c)) : [];
  const frontCards = new Set(groups.filter((gr) => inFront.has(gr.key)).flatMap((gr) => gr.ids));
  const turnBegan = active === board.seat && mem?.active !== board.seat;
  let lip: CardId | null = null;
  if (fresh.length) lip = fresh.filter((c) => !frontCards.has(c.id)).sort((a, b) => b.id - a.id)[0]?.id ?? null;
  else if (witnessed && !turnBegan && mem?.lip != null && onSeat.has(mem.lip as CardId) && !frontCards.has(mem.lip as CardId) && !attached.has(mem.lip as CardId)) lip = mem.lip as CardId;

  // Cards acting now leave whatever they were in: each is a unit of its own, on the lip (a fighter goes on to the combat
  // row from there).
  const acting = bf.filter((c) => involved.has(c.id) && !isMana(c)).map((c) => c.id);
  const actingSet = new Set(acting);
  if (lip !== null && actingSet.has(lip)) lip = null;
  const out = (gr: Group): CardId[] => gr.ids.filter((id) => !actingSet.has(id) && id !== lip);

  // ---- geometry ----
  const W = r.w, D = r.d, vAt = (a: number) => D / 2 - a;
  const at = (u: number, a: number): V3 => g.toWorld(r, u, vAt(a));
  const span = W - 2 * LEAF.side;
  const placeW = span / places;
  const frontPos = (i: number): V3 => at(-span / 2 + (i + 0.5) * placeW, LEAF.foot);
  const px = compact ? LEAF.frontPx.hi : LEAF.frontPx.lo;
  const sMin = floorScale(g, frontPos(0), LEAF.frontPx.lo, false, 1.8);
  const sWant = Math.max(floorScale(g, frontPos(0), px, false, 1.8), floorScale(g, frontPos(places - 1), px, false, 1.8));
  const sFront = Math.max(sMin, Math.min(sWant, placeW / (CH + 0.04)));
  // The back row starts where the table shows above the front's tops, at either end of the leaf (a turned leaf's ends lie
  // at different depths).
  const frontTop = Math.min(...[0, places - 1].map((i) => bounds(unitShape(g.proj, "", { ...PROBE, placement: { pos: frontPos(i), scale: sFront, posture: "stand" } }, false).face).t));
  const aFlat = Math.max(clearBehind(g, r, LEAF.foot, sFront), behind(g, r, frontTop - 2 * g.u, -span / 2), behind(g, r, frontTop - 2 * g.u, span / 2)) + 0.05;

  const units: Unit[] = [];
  const unit = (key: string, role: UnitRole, members: CardId[], pl: Placement, o: { title?: string | null; mixed?: boolean; acting?: boolean; well?: boolean; note?: string; times?: boolean; countFirst?: boolean; heaviest?: boolean } = {}): void => {
    if (!members.length) return;
    // A pile shows a ready card where it has one (a muster its heaviest): its tapped ones lie turned at its end.
    const w = (id: CardId) => weightOf([need(id)]);
    const ms = o.heaviest ? members.slice().sort((a, b) => w(b) - w(a) || a - b) : members;
    const ready = ms.filter((id) => !need(id).tapped), tapped = ms.filter((id) => need(id).tapped);
    const order = o.well ? members : [...ready, ...tapped];
    const top = order[0]!;
    units.push({
      id: key,
      role,
      kind: o.well ? "well" : order.length > 1 ? "pile" : "card",
      members: order,
      dressing: order.flatMap((id) => dressedBy.get(id) ?? []),
      top,
      title: o.title ?? null,
      mixed: !!o.mixed,
      ...(o.note && order.length > 1 ? { note: o.note } : {}),
      ...(o.times ? { times: true } : {}),
      ...(o.countFirst ? { countFirst: true } : {}),
      acting: !!o.acting,
      tapped: o.well ? false : need(top).tapped,
      placement: pl,
    });
  };

  // The front, standing.
  front.forEach((k, i) => {
    const gr = k === null ? undefined : groups.find((x) => x.key === k);
    if (!gr) return;
    const m = out(gr);
    const c0 = need(gr.ids[0]!);
    // A regiment's tab: its name, how many, and its power, or the keyword that matters more ("Thopter ×8 · fly").
    const cs = m.map(need), fly = cs.every((c) => c.keywords.some((k) => k.toLowerCase() === "flying"));
    const note = fly ? "· fly" : `· ${cs.reduce((t, c) => t + Math.max(0, c.power ?? 0), 0)}`;
    unit(gr.key, gr.role, m, { pos: frontPos(i), scale: sFront, posture: "stand" }, { title: m.length > 1 ? `${c0.name} ${m.length}` : null, note, times: true });
  });

  // The flat row: the well, the works (one pile past three), the muster.
  const backCreatures = groups.filter((gr) => gr.role === "creature" && !inFront.has(gr.key)).flatMap(out);
  const works = [...groups.filter((gr) => gr.role === "walker" && !inFront.has(gr.key)).flatMap(out), ...support.map((c) => c.id).filter((id) => !actingSet.has(id) && id !== lip)];
  const flat: { key: string; role: UnitRole; ids: CardId[]; title?: string; mixed?: boolean; well?: boolean; note?: string; muster?: boolean }[] = [];
  const manaIds = mana.map((c) => c.id);
  if (manaIds.length) flat.push({ key: `m${board.seat}`, role: "mana", ids: manaIds, well: true });
  // At most four things lie in the back row: past that the works are one pile.
  const lying = Number(manaIds.length > 0) + Number(groups.some((gr) => gr.role === "creature" && !inFront.has(gr.key)));
  if (works.length > Math.min(LEAF.compact.lying, 4 - lying)) flat.push({ key: `k${board.seat}`, role: "support", ids: works, title: `Works ${works.length}`, mixed: true, note: worksNote(works.map(need)) ?? "" });
  else for (const id of works) flat.push({ key: `s${id}`, role: need(id).planeswalker ? "walker" : "support", ids: [id] });
  if (backCreatures.length) {
    const cs = backCreatures.map(need), fliers = cs.filter((c) => c.keywords.some((k) => k.toLowerCase() === "flying")).length;
    const note = `· ${cs.reduce((t, c) => t + Math.max(0, c.power ?? 0), 0)} power${fliers ? ` · ${fliers} flier${fliers > 1 ? "s" : ""}` : ""}`;
    // ("8 more · 14 power": the count leads, so it never reads as eight of the card on top.)
    flat.push({ key: `u${board.seat}`, role: "creature", ids: backCreatures, muster: true, ...(backCreatures.length > 1 ? { title: `more ${backCreatures.length}`, mixed: true, note } : {}) });
  }
  // A pile far off lying flat would have to be huge to be 44 px tall from my chair: the back row leans up a little. Each
  // thing takes its own width (a turned one a card's height), and the row is centred.
  // Each takes an equal slot of the row, its card in the middle, so its sign or tab has the slot's width to itself and never
  // lands on a neighbour.
  const slot = span / Math.max(1, flat.length);
  const flatAt = (i: number): V3 => at(-span / 2 + (i + 0.5) * slot, aFlat);
  const sFlat = Math.min(slot / (CH + 0.12), Math.max(sizeFor(g, at(0, aFlat), "lean", FLOOR.any), ...flat.map((_, i) => sizeFor(g, flatAt(i), "lean", FLOOR.any))));
  flat.forEach((f, i) => unit(f.key, f.role, f.ids, { pos: flatAt(i), scale: sFlat, posture: "lean" }, { ...(f.title ? { title: f.title } : {}), mixed: !!f.mixed, well: !!f.well, ...(f.note ? { note: f.note } : {}), ...(f.muster ? { countFirst: true, heaviest: true } : {}) }));
  // Where the back row's tops end on screen: the plaque and the piles behind it stand from there.
  const backTop = Math.min(...units.filter((x) => x.placement.posture === "lean").map((x) => bounds(unitShape(g.proj, "", x, false).face).t), g.proj.project(at(0, aFlat + CH * sFlat)).y);
  const yBack = backTop - 3 * g.u;

  // The lip: the card played last, then whatever acts, shingled toward the table's middle; just off the near edge.
  // (Every lip at its leaf's right end: the across leaf's and the right one's never meet in the gap between them.)
  const inner = 1;
  const lipCards = [...(lip !== null ? [lip] : []), ...acting];
  const sLip = sizeFor(g, at(inner * (W / 2 - 1), -1.6), "lean", LEAF.lipPx);
  const aLip = -(CH * sLip + 0.12);
  lipCards.forEach((id, i) => {
    const c = need(id);
    const role: UnitRole = c.creature ? "creature" : c.planeswalker ? "walker" : "support";
    const u = inner * (W / 2 - (CW * sLip) / 2 - 0.15 - i * (CW * sLip + 0.12));
    unit(actingSet.has(id) ? `f${id}` : `l${id}`, role, [id], { pos: at(u, aLip), scale: sLip, posture: "lean" }, { acting: actingSet.has(id) });
  });

  // The back: the plaque (left), the commander beside it while it is in the command zone, the zone piles (right), all
  // behind the back row's far edge.
  const sP = PLATE_S, uPlate = -W / 2 + LEAF.side + 1.6 * sP;
  // (On a turned leaf one end of the plaque is nearer than the other: the nearer end decides.)
  const aPlate = Math.max(behind(g, r, yBack, uPlate - 1.6 * sP), behind(g, r, yBack, uPlate + 1.6 * sP)) + 0.05;
  const plate: Placement = { pos: at(uPlate, aPlate), scale: sP, posture: "stand" };
  const zones: Fixtures["zones"][number][] = [];
  const present = (["graveyard", "exile"] as const).filter((z) => board.fixtures[z] > 0);
  const zS = Math.max(ZONE_S, floorScale(g, at(W / 2 - 1, aPlate), FLOOR.any, false, ZONE_S));
  present.forEach((zone, i) => {
    const u = W / 2 - LEAF.side - (CW * zS) / 2 - (present.length - 1 - i) * (CW * zS + 0.2);
    const a = Math.max(behind(g, r, yBack, u - (CW * zS) / 2), behind(g, r, yBack, u + (CW * zS) / 2));
    zones.push({ zone, placement: { pos: at(u, a + (CH * zS) / 2 + 0.05), scale: zS, posture: "prop" } });
  });
  let commander: Fixtures["commander"];
  if (board.fixtures.commander !== undefined) {
    const pos: V3 = { x: plate.pos.x + 2.2 * sP, y: plate.pos.y, z: plate.pos.z - 0.06 * sP };
    commander = { card: board.fixtures.commander, placement: { pos, scale: Math.max(0.9 * sP, floorScale(g, pos, FLOOR.any, false, 0.9 * sP)), posture: "stand" } };
  }
  // The slip lies square along the leaf's near border, inside its width: the leaf's last ink.
  const slipW = W - 2 * LEAF.side + 0.2;
  const slipC = at(0, LEAF.slip.from + LEAF.slip.d / 2);
  const fixtures: Fixtures = {
    page: { pos: at(0, D / 2), w: W, d: D, yaw: r.yaw },
    plate,
    zones,
    slip: { pos: slipC, w: slipW, d: LEAF.slip.d, yaw: r.yaw },
    ...(commander ? { commander } : {}),
  };
  const memory: LayoutMemory = {
    v: 1,
    paradigm: "front",
    fit: { front: front.map((k) => (k !== null && groups.some((gr) => gr.key === k) ? k : null)), ids, seen: board.cards.map((c) => c.id), lip, ...(turn !== null ? { turn } : {}), active } satisfies FrontMemory,
  };
  const folded = units.reduce((t, u) => t + u.members.length - 1, 0);
  return new Ledger(board.cards.map((c) => c.id)).seal({
    seat: board.seat,
    units,
    fixtures,
    memory,
    report: { folded, held: false, pressure: input.pressure, overflow: false, lastResort: false },
  });
}

export const front: SeatLayout = { id: "front", plan };

