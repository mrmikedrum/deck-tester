import { FLOOR } from "../board";
import type { BoardCard } from "../board";
import type { Fixtures, LayoutMemory, Placement, SeatInput, SeatLayout, SeatPlan, Unit, UnitRole } from "../seat";
import type { CardId, V3 } from "../types";
import { Ledger } from "../ledger";
import { cardsOf, topOf } from "./fold";
import type { Cards, Draft } from "./fold";
import { fitSeat, holdFit, rowU, seatGuest } from "./fit";
import type { Band, Fit, FitCtx } from "./fit";
import { CH, CW, PLATE_S, PLATE_S_ME, ZONE_S, makeGeo, floorScale, zoneSide } from "./geometry";
import type { BandKey, Geo, Region } from "./geometry";

// `mat`: today's page, ported (old h.js fitSeat, fold, seatPlaces, holdFit, holding, seatGuest and buildBoard's
// classification, with targets() for the poses). Memory is explicit data: the previous plan's `fit` comes in through
// `input.memory`, the next one leaves in `plan.memory`.
//
// Differences from the old closure, on purpose:
//  - units that fits try (the fresh fit, the loose one, the held one) are copies, never shared, so one attempt can't
//    overwrite another's places (the old code seated the same unit objects in every attempt);
//  - an attached card whose host is not on this seat's board is a card of its own (the old code left it out);
//  - a pile whose showing card has left remembers the stats it formed at, so holding it needs no card that is gone.

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const BANDS: readonly BandKey[] = ["C", "S", "L"];
const count = (f: Fit): number => BANDS.reduce((t, k) => t + (f[k].units ?? []).length, 0);

/** Cards of one look with nothing attached stack into a group; hosts and commanders stand alone (the old `P.groups`).
 * A group's front card is a ready one where any is: its tapped ones are drawn turned behind it. */
function groups(list: readonly BoardCard[], hosts: ReadonlySet<CardId>): { rep: BoardCard; ids: CardId[] }[] {
  const out: { rep: BoardCard; ids: CardId[] }[] = [], seen = new Map<string, { rep: BoardCard; ids: CardId[] }>();
  for (const c of list) {
    if (hosts.has(c.id) || c.commander) {
      out.push({ rep: c, ids: [c.id] });
      continue;
    }
    const s = seen.get(c.sig);
    if (s) {
      s.ids.push(c.id);
      if (s.rep.tapped && !c.tapped) s.rep = c;
    } else {
      const gr = { rep: c, ids: [c.id] };
      seen.set(c.sig, gr);
      out.push(gr);
    }
  }
  return out;
}

interface Classified {
  C: Draft[];
  S: Draft[];
  L: Draft[];
}

// A seat's units, in the order they came to the table (the commander first), so a card that stays keeps its place and a
// new one joins at the end of its row: creatures (C), planeswalkers and other permanents (S), my wells (L).
// (A planeswalker never stands in the creature row: it isn't a blocker, and standing there it reads as one. One that is a
// creature now, Gideon Jura animated, is one: it stands with the creatures, as common.js `category` and its face's P/T
// foot read it, and is a walker again once it stops. The old h.js drew it twice, in both rows. So does an animated
// Treasure or manland: a creature first, never also mana.)
function classify(bf: readonly BoardCard[], hosts: ReadonlySet<CardId>, me: boolean, seat: string, involved: ReadonlySet<CardId>): Classified {
  const arrived = (a: BoardCard, b: BoardCard) => Number(b.commander) - Number(a.commander) || a.id - b.id;
  const unit = (prefix: string, gr: { rep: BoardCard; ids: CardId[] }, role: UnitRole): Draft => ({ key: prefix + gr.ids[0], ids: gr.ids, rep: gr.rep.id, role });
  // A lands that do more than make mana stand with the other permanents; a rock taps for mana itself. The rows are
  // disjoint whatever a card's types: a creature stands with the creatures (an animated Treasure, a land that is a
  // creature now), a planeswalker that is not one stands with the walkers, and only what is neither is mana or support.
  const isMana = (c: BoardCard) => !c.creature && !c.planeswalker && !c.specialLand && (c.land || c.manaRock || c.treasure);
  const C = groups(bf.filter((c) => c.creature).sort(arrived), hosts).flatMap((gr): Draft[] => {
    // A creature in combat leaves its pile while it fights (and stays out of any fold), so a pile never attacks, blocks or
    // dies as a whole; the rest of the pile keeps its place.
    const f = gr.ids.filter((id) => involved.has(id)), rest = gr.ids.filter((id) => !involved.has(id));
    if (!f.length || gr.ids.length === 1) return [{ ...unit("c", gr, "creature"), fight: !!f.length }];
    const byId = new Map(bf.map((c) => [c.id, c]));
    return [
      ...(rest.length ? [{ ...unit("c", { ids: rest, rep: byId.get(rest[0]!)! }, "creature"), key: "c" + gr.ids[0] }] : []),
      ...f.map((id) => ({ ...unit("f", { ids: [id], rep: byId.get(id)! }, "creature"), fight: true })),
    ];
  });
  const S = [
    ...bf.filter((c) => c.planeswalker && !c.creature).sort(arrived).map((c) => unit("w", { ids: [c.id], rep: c }, "walker")),
    ...groups(bf.filter((c) => !c.creature && !c.planeswalker && !isMana(c)).sort(arrived), hosts).map((gr) => unit("s", gr, "support")),
  ];
  const mana = bf.filter(isMana).sort(arrived), L: Draft[] = [];
  if (me) {
    // mine: a well per kind of land
    const by = new Map<string, BoardCard[]>();
    mana.slice().sort((a, b) => Number(b.land) - Number(a.land)).forEach((c) => by.set(c.cardKey, (by.get(c.cardKey) ?? []).concat([c])));
    by.forEach((cs) => {
      cs.sort((a, b) => Number(a.tapped) - Number(b.tapped)); // untapped first: a tap reaches one that can act
      L.push(unit("m", { ids: cs.map((c) => c.id), rep: cs[0]! }, "mana"));
    });
  } else if (mana.length) {
    // theirs: one well, at the end of their support row
    L.push({ key: "m" + seat, ids: mana.map((c) => c.id), rep: (mana.find((c) => c.land) ?? mana[0]!).id, role: "mana", lands: true });
  }
  return { C, S, L };
}

// A pile whose first card has gone is still the same pile: it keeps the key it had (a unit's key is its first card's),
// so it keeps its place and its piece, and its other cards never turn up as a new pile beside the old one.
function rekey(prev: Fit, units: Draft[], onBoard: ReadonlySet<CardId>): void {
  const old = new Map<CardId, string>(), used = new Set(units.map((u) => u.key));
  BANDS.forEach((k) => (prev[k].units ?? []).forEach((u) => u.ids.forEach((id) => old.set(id, u.key))));
  units.forEach((u) => {
    if (u.fight || old.get(u.ids[0]!) === u.key) return;
    const was = u.ids.map((id) => old.get(id)).find((k) => k && k[0] === u.key[0] && !used.has(k) && !onBoard.has(+k.slice(1) as CardId));
    if (was) {
      used.add(was);
      u.key = was;
    }
  });
}

/** The card a unit shows: a standee its rep; a support pile its last shown card (the old `pileOf` shows at most 3 fanned or 8). */

function plan(input: SeatInput): SeatPlan {
  const { board, region, projector, reserve, involved, settling, pressure } = input;
  const me = region.position === "near";
  const cards: Cards = cardsOf(board.cards);
  const g = makeGeo(projector, reserve, board.mine ? FLOOR.mine : FLOOR.theirs);
  const r: Region = region;

  // Attached cards ride on their host's top card; they are permanents on this seat too, but never stand on their own.
  const onSeat = new Set(board.cards.map((c) => c.id));
  const dressedBy = new Map<CardId, CardId[]>();
  const attached = new Set<CardId>();
  for (const c of board.cards) {
    if (c.attachedTo !== null && onSeat.has(c.attachedTo)) {
      attached.add(c.id);
      dressedBy.set(c.attachedTo, (dressedBy.get(c.attachedTo) ?? []).concat([c.id]));
    }
  }
  const bf = board.cards.filter((c) => !attached.has(c.id));
  const { C, S, L } = classify(bf, new Set(dressedBy.keys()), me, board.seat, involved);

  const mem = input.memory && input.memory.paradigm === "mat" && input.memory.v === 1 ? (input.memory.fit as Fit) : null;
  const prev = mem ? clone(mem) : null;
  const now = new Set([...C, ...S, ...L].flatMap((u) => u.ids));
  if (prev) rekey(prev, [...C, ...S, ...L], new Set(bf.map((c) => c.id)));

  const keepOf = (u: Draft): boolean => !!u.lands || cards.need(u.rep).commander || cards.need(u.rep).legendary;
  const ctx = (p: Fit | null): FitCtx => ({ g, cards, region: r, me, keepOf, prev: p });
  const args = {
    nz: Number(board.fixtures.graveyard > 0) + Number(board.fixtures.exile > 0),
    cmd: board.fixtures.commandZone,
    settling,
    pressure,
  };
  const fresh = (us: Draft[]) => clone(us);
  const fitArgs = (c: Draft[], s: Draft[], l: Draft[]) => ({ ...args, C: fresh(c), S: fresh(s), L: fresh(l) });

  // What doesn't fit its page at the floor sizes folds (fitSeat, fold). A page holds its shape while cards leave it
  // (fitSeat). Where holding would cost room (a deeper page, or folding more than it did when a fresh fit wouldn't) it
  // fits afresh, but never while cards are still leaving: then the page holds, what arrives meanwhile stands in a place the
  // leavers left free (seatGuest), and the page re-fits once they have landed, so nothing that stayed moves with the cards
  // going and nothing that came is out of sight.
  const units = (q: Fit): number => count(q), folded = (q: Fit): number => q.fed - units(q);
  let chosen = fitSeat(ctx(prev && clone(prev)), fitArgs(C, S, L));
  // While cards of this page are leaving it, everything that stays keeps its place and its pile, as it was (a pile only
  // loses the cards that went); a newcomer stands in a free place meanwhile, and the page re-fits once they have landed.
  // Its back band makes room for a new pile at once, so what leaves flies to where it will lie.
  // (A rebuild while they are still on their way, held already, holds on.)
  const lost = !!prev && settling && (!!prev.held || BANDS.some((k) => (prev[k].units ?? []).some((u) => u.ids.some((id) => !now.has(id)))));
  const kept = lost && prev ? holdFit(cards, prev, chosen, clone([...C, ...S, ...L]), now, me) : null;
  if (kept) chosen = kept;
  if (!kept && prev && (chosen.over || folded(chosen) > folded(prev))) {
    const loose = fitSeat(ctx(prev && clone(prev)), fitArgs(C, S, L), false);
    if (chosen.over || units(loose) > units(chosen)) {
      const had = new Set(BANDS.flatMap((k) => (prev[k].units ?? []).flatMap((u) => u.ids))), stayed = (u: Draft) => u.ids.some((id) => had.has(id));
      const held = settling ? fitSeat(ctx(clone(prev)), fitArgs(C.filter(stayed), S.filter(stayed), L.filter(stayed))) : null;
      // (A newcomer with no free place anywhere doesn't wait out of sight: then the page fits afresh at once.)
      if (held && [...C, ...S, ...L].filter((u) => !stayed(u)).every((u) => seatGuest(held, clone(u), me))) chosen = held;
      else chosen = loose;
    }
  }
  return poses(input, g, cards, chosen, dressedBy, board.fixtures);
}

// Target poses for every unit and fixture at rest (the old `targets()`, one seat's part).
function poses(input: SeatInput, g: Geo, cards: Cards, fit: Fit, dressedBy: ReadonlyMap<CardId, CardId[]>, fx: SeatInput["board"]["fixtures"]): SeatPlan {
  const { region: r, board } = input;
  const me = r.position === "near";
  // Every page has the same bands in the same order from its fixed edge (fitSeat): theirs from the front, toward the
  // table's middle, back; mine from the back, by my hand, forward. In region terms both fixed edges lie at v = r.d/2, so
  // a depth `a` from it is at v = r.d/2 - a, and the page is W x D from there.
  const { W, D } = fit, vAt = (a: number) => r.d / 2 - a, sP = me ? PLATE_S_ME : PLATE_S;
  const out: Unit[] = [];
  const place = (d: Draft, pos: V3, scale: number): void => {
    const top = d.top ?? topOf(d, me), role = d.role;
    const dress = d.ids.flatMap((id) => dressedBy.get(id) ?? []);
    const topCard = cards.need(top);
    const placement: Placement = { pos, scale, posture: role === "creature" ? "stand" : role === "mana" ? "flat" : me ? "lean" : "prop" };
    out.push({
      id: d.key,
      role,
      kind: role === "mana" ? "well" : d.ids.length > 1 ? "pile" : "card",
      members: d.ids,
      dressing: dress,
      top,
      title: d.title ?? null,
      mixed: !!d.mixed,
      acting: !!d.fight,
      // A well's card lies square however spent it is: a spent well says so by its dark stain, its shaded face and its
      // sign's "n tapped", so it never lies turned over the next well's name (the old client's did).
      tapped: role === "mana" ? false : topCard.tapped,
      placement,
    });
  };
  // A band's rows, each unit in its place (seatPlaces, rowU): theirs march away from the fixed edge from its near side,
  // mine toward me from its far side (a standee leans toward the page's front, so my front row stands its lean back
  // from the band's edge and its top stays inside my border).
  const rowsOf = (B: Band): void =>
    (B.units ?? []).forEach((un) => {
      const row = Math.floor(un.at! / B.perRow), a = me ? B.a1 - B.s * (B.lead + row * B.step) : B.a0 + B.s * (B.lead + row * B.step);
      place(un, g.toWorld(r, rowU(B, un.at!), vAt(a)), B.s);
    });
  rowsOf(fit.C);
  rowsOf(fit.S);
  // Wells: mine are bands of their own; theirs is one well, lying at the outer end of their first support row.
  if (me) rowsOf(fit.L);
  else (fit.L.units ?? []).forEach((un) => place(un, g.toWorld(r, fit.L.u ?? 0, vAt(fit.L.a0 + fit.L.s * fit.L.lead)), fit.L.s));

  // The back band: the plaque, the commander beside it when it is in the command zone, and the piles. The others' plaque
  // and commander lean back toward their page's back edge, so they stand far enough in for their tops to stay inside the
  // border; mine lean toward my field.
  const backV = vAt(me ? fit.back * 0.55 : fit.plateA);
  // my plaque, just right of the hand
  const handRight = g.hand?.right ?? 0, handY = g.proj.viewport.h - 80 * g.u;
  const pu = me ? Math.max(0, g.tableAt(handRight + 12 * g.u, handY).x - r.x + 1.6 * sP) : fit.place!.plate;
  const plate: Placement = { pos: g.toWorld(r, pu, backV), scale: sP, posture: "stand" };
  const zones: { zone: "graveyard" | "exile"; placement: Placement }[] = [];
  const present = (["graveyard", "exile"] as const).filter((z) => fx[z] > 0);
  if (me) {
    // Mine lie in my plaque's row, right of it: the hand holds the left of that row and the prompt its right corner, so
    // nothing covers them. Graveyard then exile, each always in its own place, as large as the floors ask, so a card that
    // goes there makes one trip and stays seen. (Past my commander while it stands beside the plaque, as theirs step past
    // theirs: never its art over their top card.)
    // Where the row would run under the prompt's corner (my commander standing beside the plaque pushes it right), the
    // exile pile lies just above the graveyard instead: still its own place, fixed for the viewport and the commander.
    const zs = Math.max(ZONE_S, floorScale(g, g.toWorld(r, pu + 2.4 * sP, backV), FLOOR.any, true, ZONE_S)), step = zs * CW + 0.25;
    const z0 = fx.commandZone ? (2.2 + (1.15 * CW) / 2) * sP + 0.15 : 1.6 * sP + 0.25;
    const rightPx = (p: V3): number => g.proj.project({ x: p.x + (zs * CW) / 2, y: 0, z: p.z + (zs * CH) / 2 }).x;
    present.forEach((zone) => {
      const i = zone === "exile" ? 1 : 0;
      let pos = g.toWorld(r, pu + z0 + (zs * CW) / 2 + i * step, backV);
      if (i === 1 && g.prompt && rightPx(pos) > g.prompt.left - 8 * g.u) pos = g.toWorld(r, pu + z0 + (zs * CW) / 2, backV - zs * CH - 0.25);
      zones.push({ zone, placement: { pos, scale: zs, posture: "flat" } });
    });
  } else {
    // Theirs: beside the plaque toward the table's middle (so they never leave the screen), past the commander while it
    // is there, as large as the floors ask; their name tags inside the border.
    const pl = fit.place!;
    present.forEach((zone, i) => {
      const u = pl.zones[i];
      if (u !== undefined) zones.push({ zone, placement: { pos: g.toWorld(r, u, vAt(fit.plateA + fit.zoneBack)), scale: pl.zS, posture: "prop" } });
    });
  }
  // The commander leans beside the plaque while it is in the command zone (h.js `banner`), on its piles' side, standing
  // with the plaque: mine a little larger. Never under the any-card floor.
  let commander: Fixtures["commander"];
  if (fx.commander !== undefined) {
    const side = zoneSide(me, r.x), cs = me ? 1.15 : 0.9;
    const pos: V3 = { x: plate.pos.x + side * 2.2 * sP, y: plate.pos.y, z: plate.pos.z - 0.06 * sP };
    commander = { card: fx.commander, placement: { pos, scale: Math.max(cs * sP, floorScale(g, pos, FLOOR.any, false, cs * sP)), posture: "stand" } };
  }
  // The mat is the page, lying from the fixed edge.
  const fixtures: Fixtures = { page: { pos: g.toWorld(r, 0, r.d / 2 - D / 2), w: W, d: D, yaw: r.yaw }, plate, zones, ...(commander ? { commander } : {}) };
  const memory: LayoutMemory = { v: 1, paradigm: "mat", fit: clone(fit) };
  const ledger = new Ledger(board.cards.map((c) => c.id));
  return ledger.seal({
    seat: board.seat,
    units: out,
    fixtures,
    memory,
    report: { folded: fit.fed - count(fit), held: !!fit.held, pressure: input.pressure, overflow: fit.over || fit.deep > r.d, lastResort: false },
  });
}

export const mat: SeatLayout = { id: "mat", plan };
