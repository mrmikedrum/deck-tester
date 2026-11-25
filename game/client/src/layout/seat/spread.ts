import { FLOOR, TAP_PX } from "../board";
import type { BoardCard } from "../board";
import type { Placement, SeatInput, SeatPlan, Unit, UnitRole } from "../seat";
import type { CardId, V3 } from "../types";
import { Ledger } from "../ledger";
import { bounds, unitShape } from "../shape";
import { CH, CW, floorScale, makeGeo } from "./geometry";
import type { Geo, Region } from "./geometry";

// The spread (focus-first): a seat's leaf unfolded toward me into a sheet over the table, one panel for each row it
// needs. The near panel stands every creature that is one of a kind, at the size of my own (the commander first, then the
// front in its order, then the rest as they arrived); the middle panel the regiments, each one standing group; the far
// panel lays the well and every other permanent singly. A small board opens two panels and leaves my creatures in view;
// a big one comes down to the top of my hand. Nothing on the sheet is folded but a regiment, so nothing is hidden. The
// sheet's units reuse the leaf's ids where they hold the same cards, so a card flies from its place on the leaf to its
// place on the sheet. Pure.

export const SPREAD = {
  /** The sheet's width, world units; its far edge never above this (design px, under the plate rail). */
  w: 19.6,
  top: 108,
  /** How high the sheet lies over the table: a finger's height, so it shadows what it covers. */
  lift: 0.12,
  /** Face widths on screen (design px): the near panel, the regiments, the far panel. */
  px: { near: 96, mid: 76, far: 70 },
  gap: 0.18,
  /** How much of a card each further copy of a fanned regiment shows; the sizes a small board may grow to. */
  fan: 0.3,
  grow: [1.6, 1.45, 1.3, 1.15, 1, 0.92, 0.85, 0.78, 0.7],
} as const;

/** Where the sheet's near edge may come, nearest last (world z): just over my creatures' feet, then down to my hand. */
const NEAR_EDGES = [-1.9, -1.2, -0.4, 0.5, 1.4, 2.3, 3.0] as const;

const lookKey = (c: BoardCard): string => {
  const p = c.sig.split("|");
  return (p.length >= 10 ? p.filter((_, i) => i !== 3 && i !== 5) : p.filter((x) => x !== String(c.tapped))).join("|");
};
const isMana = (c: BoardCard): boolean => !c.creature && !c.planeswalker && !c.specialLand && (c.land || c.manaRock || c.treasure);

interface Item {
  ids: CardId[];
  /** A regiment, fanned. */
  fan?: boolean;
  role: UnitRole;
  well?: boolean;
  title?: string;
  note?: string;
}

/** How deep into region `r` (from its near edge, at `u` across) the table is first above screen height `y`. */
function behind(g: Geo, r: Region, y: number, u = 0): number {
  let lo = -2, hi = 40;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    if (g.proj.project({ ...g.toWorld(r, u, r.d / 2 - m), y: SPREAD.lift }).y > y) lo = m;
    else hi = m;
  }
  return hi;
}

const PROBE: Unit = { id: "probe", role: "support", kind: "card", members: [], dressing: [], top: 0 as CardId, title: null, mixed: false, acting: false, tapped: false, placement: { pos: { x: 0, y: 0, z: 0 }, scale: 1, posture: "stand" } };
const topOf = (g: Geo, pl: Placement): number => bounds(unitShape(g.proj, "", { ...PROBE, placement: pl }, false).face).t;

/** The seat `input` spread over the table, from its plan at rest `rest`. */
export function spreadSeat(input: Omit<SeatInput, "pressure">, rest: SeatPlan): SeatPlan {
  const { board, projector, reserve, involved } = input;
  const g = makeGeo(projector, reserve, FLOOR.theirs);
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  const need = (id: CardId): BoardCard => byId.get(id)!;
  const onSeat = new Set(board.cards.map((c) => c.id));
  const dressedBy = new Map<CardId, CardId[]>();
  const attached = new Set<CardId>();
  for (const c of board.cards)
    if (c.attachedTo !== null && onSeat.has(c.attachedTo)) {
      attached.add(c.id);
      dressedBy.set(c.attachedTo, [...(dressedBy.get(c.attachedTo) ?? []), c.id]);
    }
  const bf = board.cards.filter((c) => !attached.has(c.id)).sort((a, b) => a.id - b.id);

  // Regiments: like creatures, nothing attached, none acting (a card acting is always its own).
  const like = new Map<string, CardId[]>();
  for (const c of bf)
    if (c.creature && !c.commander && !c.legendary && !dressedBy.has(c.id) && !involved.has(c.id)) like.set(lookKey(c), [...(like.get(lookKey(c)) ?? []), c.id]);
  const regiments = [...like.values()].filter((ids) => ids.length > 1);
  const inRegiment = new Set(regiments.flat());
  // The near panel: the commander, the leaf's front in its order, then the rest as they arrived.
  const standing = rest.units.filter((u) => u.placement.posture === "stand").flatMap((u) => u.members);
  const rank = (id: CardId) => (need(id).commander ? -2 : standing.includes(id) ? standing.indexOf(id) - 1 + 1e-3 : id);
  const singles = bf.filter((c) => (c.creature || c.planeswalker) && !inRegiment.has(c.id)).map((c) => c.id).sort((a, b) => rank(a) - rank(b));
  const mana = bf.filter(isMana).map((c) => c.id);
  const works = bf.filter((c) => !c.creature && !c.planeswalker && !isMana(c)).map((c) => c.id);
  const power = (ids: readonly CardId[]) => ids.reduce((t, id) => t + Math.max(0, need(id).power ?? 0), 0);

  const near: Item[] = singles.map((id) => ({ ids: [id], role: need(id).creature ? "creature" : "walker" }));
  // A regiment fans across its panel: every copy's edge and foot showing, its tapped copies turned at the end, its tab in
  // full on its first card ("Beast ×9 · 36 power · 2 tapped"). Each copy is a card of its own: a tap on one reads it.
  const mid: Item[] = regiments
    .sort((a, b) => power(b) - power(a))
    .map((ids) => {
      const t = ids.filter((id) => need(id).tapped).length;
      return { ids: [...ids.filter((id) => !need(id).tapped), ...ids.filter((id) => need(id).tapped)], role: "creature", fan: true, title: `${need(ids[0]!).name} ${ids.length}`, note: `· ${power(ids)} power${t ? ` · ${t} tapped` : ""}` };
    });
  const far: Item[] = [...(mana.length ? [{ ids: mana, role: "mana" as const, well: true }] : []), ...works.map((id) => ({ ids: [id], role: "support" as const }))];

  // Lay the panels from a near edge, as large as they go: the largest size, then the shallowest sheet, whose far edge stays
  // under the plate rail. A small board grows; a big one comes down to the top of my hand.
  const turned = (id: CardId) => need(id).tapped;
  const fanW = (it: Item, s: number) => {
    const n = it.ids.length, last = it.ids[n - 1]!;
    return CW * s * (1 + SPREAD.fan * (n - 1)) + (turned(last) ? (CH - CW) * s : 0);
  };
  const layOut = (zNear: number, k: number) => {
    const span = SPREAD.w - 1;
    const pre = { x: 0, z: zNear - 20, w: SPREAD.w, d: 40, yaw: 0 } as const;
    const r: Region = pre;
    const at = (u: number, a: number): V3 => ({ ...g.toWorld(r, u, r.d / 2 - a), y: SPREAD.lift });
    const placed: { ids: CardId[]; item: Item; head: boolean; peers: number; pl: Placement }[] = [];
    let a = 0.35, widest = 0;
    const row = (items: Item[], px: number, posture: Placement["posture"]) => {
      if (!items.length) return;
      // As many to a row as fit; then the next row behind. Each takes its own width: a card's, its height where it lies
      // turned, a fan's spread.
      const wide = (it: Item, s: number) => (it.fan ? fanW(it, s) : (!it.well && it.ids.every(turned) ? CH : CW) * s);
      let i = 0;
      while (i < items.length) {
        const s = Math.max(posture === "stand" ? floorScale(g, at(0, a), px * k, false, 2) : lean(g, at(0, a), px * k), 0.6);
        let per = 0, used = 0;
        while (i + per < items.length && used + wide(items[i + per]!, s) + SPREAD.gap <= span) used += wide(items[i + per++]!, s) + SPREAD.gap;
        per = Math.max(1, per);
        const take = items.slice(i, i + per), total = take.reduce((t, it) => t + wide(it, s) + SPREAD.gap, 0);
        widest = Math.max(widest, total);
        let x = -total / 2;
        const from = placed.length;
        take.forEach((it) => {
          const w = wide(it, s) + SPREAD.gap;
          if (it.fan) {
            // Each copy a step right and a hair further back: the one before covers its left, so its foot shows.
            it.ids.forEach((id, j) => {
              const cx = x + SPREAD.gap / 2 + (CW * s) / 2 + j * SPREAD.fan * CW * s + (turned(id) ? ((CH - CW) * s) / 2 : 0);
              placed.push({ ids: [id], item: it, head: j === 0, peers: it.ids.length, pl: { pos: at(cx, a + 0.035 * j), scale: s, posture } });
            });
          } else placed.push({ ids: it.ids, item: it, head: true, peers: 1, pl: { pos: at(x + w / 2, a), scale: s, posture } });
          x += w;
        });
        const top = Math.min(...placed.slice(from).map((p) => topOf(g, p.pl)));
        a = Math.max(behind(g, r, top - 4 * g.u, -span / 2), behind(g, r, top - 4 * g.u, span / 2)) + 0.12;
        i += per;
      }
      // (Standing rows keep room behind them for their tabs.)
      a += posture === "stand" ? 0.45 : 0.2;
    };
    row(near, SPREAD.px.near, "stand");
    row(mid, SPREAD.px.mid, "stand");
    row(far, SPREAD.px.far, "lean");
    const D = a + 0.2;
    const farY = g.proj.project({ ...g.toWorld(r, 0, r.d / 2 - D), y: SPREAD.lift }).y / g.u;
    return { placed, D, farY, widest };
  };
  let best = layOut(NEAR_EDGES[NEAR_EDGES.length - 1]!, 0.7), zNear = NEAR_EDGES[NEAR_EDGES.length - 1]!;
  fit: for (const k of SPREAD.grow)
    for (const z of NEAR_EDGES) {
      const l = layOut(z, k);
      if (l.farY >= SPREAD.top) {
        best = l;
        zNear = z;
        break fit;
      }
    }
  // As wide as its rows need, under its own seat as far as the screen allows: it covers no leaf it does not need to.
  const W = Math.min(SPREAD.w, best.widest + 1.2);
  const seatX = rest.fixtures.page.pos.x, room = SPREAD.w / 2 - W / 2;
  const dx = Math.max(-room, Math.min(room, seatX));

  // The leaf's ids where the sheet holds the same cards: they fly from their leaf place to their sheet place.
  const restId = new Map(rest.units.map((u) => [[...u.members].sort((a, b) => a - b).join(","), u.id]));
  const unitOfItem = new Map<Item, string[]>();
  const units0: Unit[] = best.placed.map(({ ids, item, head, peers, pl }) => {
    const order = item.well ? ids : [...ids.filter((id) => !need(id).tapped), ...ids.filter((id) => need(id).tapped)];
    const key = [...ids].sort((a, b) => a - b).join(",");
    const top = order[0]!;
    const id = restId.get(key) ?? (item.well ? `m${board.seat}` : ids.length > 1 ? `r${ids[0]}` : `${involved.has(top) ? "f" : "c"}${top}`);
    const tab = item.fan && head && item.title;
    return {
      id,
      role: item.role,
      kind: item.well ? "well" : order.length > 1 ? "pile" : "card",
      members: order,
      dressing: order.flatMap((x) => dressedBy.get(x) ?? []),
      top,
      title: tab ? item.title! : item.fan ? null : (item.title ?? null),
      mixed: false,
      ...(tab && item.note ? { note: item.note, times: true, span: 1 + SPREAD.fan * (peers - 1) } : {}),
      acting: order.some((x) => involved.has(x)),
      tapped: item.well ? false : need(top).tapped,
      placement: { ...pl, pos: { ...pl.pos, x: pl.pos.x + dx } },
    };
  });
  best.placed.forEach((p, i) => unitOfItem.set(p.item, [...(unitOfItem.get(p.item) ?? []), units0[i]!.id]));
  // A fan's first card knows the rest of its fan: its tab may lie over their tops.
  const units = units0.map((u, i) => {
    const p = best.placed[i]!;
    return p.item.fan && p.head ? { ...u, peers: (unitOfItem.get(p.item) ?? []).filter((x) => x !== u.id) } : u;
  });
  // Its far edge runs up to the plate rail whatever its rows need: it covers the other leaves' cards whole, never halves.
  const rTop: Region = { x: 0, z: zNear - 20, w: SPREAD.w, d: 40, yaw: 0 };
  const D = Math.max(best.D, behind(g, rTop, SPREAD.top * g.u));
  const page = { pos: { x: dx, y: SPREAD.lift - 0.01, z: zNear - D / 2 }, w: W, d: D, yaw: 0 };
  // The plaque stays at its leaf (the plate rail is over every focus); the zone piles wait there under the sheet.
  const { slip: _slip, ...fixtures } = rest.fixtures;
  void _slip;
  return new Ledger(board.cards.map((c) => c.id)).seal({
    seat: board.seat,
    units,
    fixtures: { ...fixtures, page, zones: [] },
    memory: rest.memory,
    report: { folded: units.reduce((t, u) => t + u.members.length - 1, 0), held: false, pressure: 0, overflow: false, lastResort: false },
  });
}

/** The scale of a card leaning on the sheet that is `px` wide and a finger tall on screen. */
function lean(g: Geo, pos: V3, px: number): number {
  const sh = unitShape(g.proj, "", { ...PROBE, placement: { pos, scale: 1, posture: "lean" } }, false), b = bounds(sh.face);
  return Math.max((Math.max(px, TAP_PX / g.u) * 1.1) / (sh.width / g.u), (Math.max(FLOOR.any, TAP_PX / g.u) * 1.2) / ((b.b - b.t) / g.u));
}

