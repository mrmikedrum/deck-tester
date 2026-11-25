// The seats as the chrome tells them: each seat's nameplate with its summary as icons, and the nameplate focus with the
// same summary in words and the seat's zones picked up as printed cards. Figures are facts the engine sent, never a
// verdict. The client's words name a seat by its name, never by a pronoun. Pure.
import type { TablePlan } from "../layout";
import { RULE_CARDS, isLand } from "../model";
import type { Card, SeatId, TableModel } from "../model";
import type { Mark } from "../play";
import { placeOf } from "../scene/stage/faces";
import type { IconView, PickedCard, PlateView, SeatFocusView } from "../chrome/view";

/** Where the plates sit, CSS px at 1180 x 820 (the design unit scales them): the top row under the safe area, clear of
 * the Game button; mine at the bottom where my plaque was. */
const PLATE = { top: 6, height: 44, bottom: 8, clearLeft: 112, edge: 12, step: 4 } as const;

/** A box on screen, CSS px. */
export interface Box {
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}

/** A plate's width, CSS px, from what it says (its CSS: sigil, name in the serif, the life box, the icons' tab). */
export function plateWidth(name: string, life: number, icons: readonly IconView[], u: number): number {
  const bronze = 10 + 18 + 8 + name.length * 9.6 + 8 + Math.max(34, String(life).length * 11 + 12) + 6;
  const tab = icons.length ? 20 + icons.reduce((n, i) => n + 18 + 3 + i.figure.length * 9.5, 0) + 10 * (icons.length - 1) : 0;
  return (bronze + tab) * u;
}

const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

/**
 * Where the top row's plates go (each its left edge, CSS px): each as near its leaf (`pref`, its preferred left edge)
 * as it can be without covering a card the table shows (`under`: the boxes of the plan's hit groups) or another plate.
 * The one across first, then the left and the right. The table's cards keep their place and their taps: the row bends
 * round them, never the other way.
 */
export function placeTop(
  plates: readonly { readonly seat: string; readonly place: string; readonly w: number; readonly pref: number }[],
  under: readonly Box[],
  row: { readonly t: number; readonly b: number; readonly l: number; readonly r: number },
  step = PLATE.step,
): Map<string, number> {
  // The one across first (the top of its leaf is the screen's top, where its zones stand), then the sides, which have room.
  const rank = (p: string): number => (p === "across" ? 0 : p === "left" ? 1 : 2);
  const placed: Box[] = [], out = new Map<string, number>();
  for (const p of [...plates].sort((a, b) => rank(a.place) - rank(b.place))) {
    const lo = row.l, hi = Math.max(lo, row.r - p.w);
    let best = Math.min(hi, Math.max(lo, p.pref)), cost = Infinity;
    for (let x = lo; x <= hi + 0.01; x += step) {
      const box = { l: x, t: row.t, r: x + p.w, b: row.b };
      const c = under.reduce((n, g) => n + overlap(box, g), 0) * 1000 + placed.reduce((n, g) => n + overlap(box, g), 0) * 4000 + Math.abs(x - p.pref);
      if (c < cost) {
        cost = c;
        best = x;
      }
    }
    placed.push({ l: best, t: row.t, r: best + p.w, b: row.b });
    out.set(p.seat, best);
  }
  return out;
}

/** What a seat has on the table, counted in one pass. */
interface Tally {
  readonly creatures: number;
  readonly power: number;
  readonly untappedPower: number;
  readonly untapped: number;
  readonly biggest: Card | null;
  readonly fliers: number;
  readonly reach: number;
  /** Its mana sources: lands, and anything else that taps for mana (a rock, a Treasure, a creature that makes mana). */
  readonly sources: number;
  readonly lands: number;
  readonly openSources: number;
  /** The other sources' names, in table order (for the focus's line). */
  readonly others: readonly string[];
  /** Like creatures by name and figures, biggest groups first: "9 Beast 4/4". */
  readonly groups: readonly { readonly name: string; readonly n: number; readonly stats: string }[];
}

const isBody = (c: Card): boolean => c.faceDown || /\bCreature\b/.test(c.face.type);
const pw = (c: Card): number => c.power ?? c.face.basePower;
const tg = (c: Card): number => c.toughness ?? c.face.baseToughness;
const has = (c: Card, k: string): boolean => c.keywords.some((w) => w.toLowerCase() === k);
/** It makes mana: a land, or a permanent with a mana ability of its own (taps for it, as a rock, a Treasure or a
 * creature does). A card that only lists what it makes (a rule card that hands out Treasure) is not counted. */
const makesMana = (c: Card): boolean =>
  isLand(c) || (c.face.produces.length > 0 && !RULE_CARDS.has(c.name) && /(^|\n|— )\{T\}[^:\n]*: Add/.test(c.face.text));

function tally(model: TableModel, seat: SeatId): Tally {
  let creatures = 0, power = 0, untappedPower = 0, untapped = 0, fliers = 0, reach = 0, sources = 0, lands = 0, openSources = 0;
  let biggest: Card | null = null;
  const others: string[] = [], by = new Map<string, { name: string; n: number; stats: string }>();
  for (const id of model.zone(seat, "battlefield")) {
    const c = model.cards.get(id);
    if (!c) continue;
    if (isBody(c)) {
      const p = Math.max(0, pw(c));
      creatures++;
      power += p;
      if (!c.tapped) {
        untapped++;
        untappedPower += p;
      }
      if (has(c, "flying")) fliers++;
      if (has(c, "reach")) reach++;
      if (!biggest || pw(c) > pw(biggest) || (pw(c) === pw(biggest) && tg(c) > tg(biggest))) biggest = c;
      const stats = `${pw(c)}/${tg(c)}`, key = `${c.face.name}|${stats}`, g = by.get(key);
      if (g) g.n++;
      else by.set(key, { name: c.face.name, n: 1, stats });
    }
    if (makesMana(c)) {
      sources++;
      if (!c.tapped) openSources++;
      if (isLand(c)) lands++;
      else others.push(c.face.name);
    }
  }
  const groups = [...by.values()].filter((g) => g.n > 1).sort((a, b) => b.n - a.n);
  return { creatures, power, untappedPower, untapped, biggest, fliers, reach, sources, lands, openSources, others, groups };
}

/** Seat summaries, counted once per model and seat: the plates and the focus read them every frame. */
const SUMMARIES = new WeakMap<TableModel, Map<SeatId, Tally>>();
export function summaryOf(model: TableModel, seat: SeatId): Tally {
  let m = SUMMARIES.get(model);
  if (!m) SUMMARIES.set(model, (m = new Map()));
  let t = m.get(seat);
  if (!t) m.set(seat, (t = tally(model, seat)));
  return t;
}

/** The icons at rest: power on the table once there is any, untapped mana sources once there is one, cards in hand
 * always. */
function restIcons(model: TableModel, seat: SeatId, t: Tally): IconView[] {
  const s = model.seat(seat);
  return [
    ...(t.creatures ? [{ kind: "power" as const, figure: String(t.power) }] : []),
    ...(t.sources ? [{ kind: "mana" as const, figure: String(t.openSources) }] : []),
    { kind: "hand" as const, figure: String(s?.hand ?? 0) },
  ];
}

const centre = (plan: TablePlan, seat: SeatId): { x: number; bottom: number } | null => {
  const g = plan.hits.groups.find((x) => x.kind === "plate" && x.seat === seat);
  if (!g) return null;
  const xs = g.quad.map((p) => p.x), ys = g.quad.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, bottom: Math.max(...ys) };
};

/** Every seat's nameplate: opponents' along the top over their leaves, bent round the cards there (`placeTop`), in
 * their order around the table; mine at the bottom where my plate stands. */
let lastPlates: { readonly key: readonly unknown[]; readonly plates: PlateView[] } | null = null;
export function platesOf(model: TableModel, plan: TablePlan | null, marks: ReadonlyMap<SeatId, Mark>, safeTop: number, h: number): PlateView[] {
  // The same inputs, the same plates: drawn every frame, made once per model, plan and marks.
  // (Marks by what they say: play presents a new map each frame.)
  const key = [model, plan, [...marks].map(([k, m]) => `${k}:${m}`).join(","), safeTop, h];
  if (lastPlates && lastPlates.key.every((k, i) => k === key[i])) return lastPlates.plates;
  const plates = makePlates(model, plan, marks, safeTop, h);
  lastPlates = { key, plates };
  return plates;
}

function makePlates(model: TableModel, plan: TablePlan | null, marks: ReadonlyMap<SeatId, Mark>, safeTop: number, h: number): PlateView[] {
  const me = model.viewer.perspective;
  const w = plan?.viewport.w ?? 1180;
  const u = Math.min(w / 1180, h / 820);
  const others = model.seats.filter((s) => s.id !== me);
  const rows = model.seats.map((s) => {
    const mine = s.id === me;
    const at = plan ? centre(plan, s.id) : null;
    const i = others.indexOf(s);
    const mark = marks.get(s.id);
    const icons = mine ? [] : restIcons(model, s.id, summaryOf(model, s.id));
    return {
      seat: String(s.id),
      group: `plate:${s.id}`,
      name: String(s.name),
      life: s.life,
      place: placeOf(model, s.id),
      mine,
      active: model.active === s.id,
      ring: mark === "option" ? ("option" as const) : mark === "selected" ? ("selected" as const) : null,
      out: s.out,
      mid: at?.x ?? (mine ? w / 2 : ((i + 1) * w) / (others.length + 1)),
      bottom: at?.bottom ?? null,
      // Mine carries no icons at rest: my own table is in front of me (my nameplate focus has the words).
      icons,
      width: plateWidth(String(s.name), s.life, icons, u),
    };
  });
  const top = safeTop + PLATE.top * u;
  const under: Box[] = (plan?.hits.groups ?? [])
    .filter((g) => g.kind !== "plate")
    .map((g) => {
      const xs = g.quad.map((p) => p.x), ys = g.quad.map((p) => p.y);
      return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
    });
  const lefts = placeTop(
    rows.filter((r) => !r.mine).map((r) => ({ seat: r.seat, place: r.place, w: r.width, pref: r.mid - r.width / 2 })),
    under,
    { t: top, b: top + PLATE.height * u, l: PLATE.clearLeft * u, r: w - PLATE.edge * u },
  );
  return rows.map((r) => ({
    seat: r.seat,
    group: r.group,
    name: r.name,
    life: r.life,
    place: r.place,
    mine: r.mine,
    active: r.active,
    ring: r.ring,
    out: r.out,
    icons: r.icons,
    x: r.mine ? r.mid : (lefts.get(r.seat) ?? r.mid),
    y: r.mine ? (r.bottom ?? h - PLATE.bottom * u) : top,
  }));
}

const picked = (model: TableModel, ids: readonly number[]): PickedCard[] =>
  ids
    .map((id) => model.cards.get(id as never))
    .filter((c): c is Card => !!c)
    .map((c) => ({ id: c.id, name: c.face.name, image: c.faceDown ? null : c.face.img }));

/** "9 Beast 4/4, 8 Elemental 3/3 and 10 others": the biggest groups of like creatures. */
function groupsLine(t: Tally): string | null {
  const groups = t.groups.slice(0, 3);
  if (!groups.length) return null;
  const named = groups.map((g) => `${g.n} ${g.name} ${g.stats}`);
  const rest = t.creatures - groups.reduce((n, g) => n + g.n, 0);
  return rest > 0 ? `${named.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}.` : `${named.join(", ")}.`;
}

/** The nameplate focus: the seat in words, a line per icon (an icon the plate does not show at rest too, its absence
 * spelled out), its zones picked up, and what else a player would ask. */
export function seatFocusOf(model: TableModel, seat: SeatId): SeatFocusView | null {
  const s = model.seat(seat);
  if (!s) return null;
  const me = model.viewer.perspective, mine = seat === me;
  const t = summaryOf(model, seat);
  const big = t.biggest ? `Biggest is a ${pw(t.biggest)}/${tg(t.biggest)} (${t.biggest.face.name}).` : null;
  const landCount = t.lands, others = t.others;
  const lines: SeatFocusView["lines"] = [
    t.creatures
      ? { icon: "power", head: `${t.power} power on the table`, sub: [`${t.untappedPower} of it untapped.`, big].filter(Boolean).join(" ") }
      : { icon: "power", head: "No power on the table", sub: null, none: true },
    t.creatures
      ? { icon: "creatures", head: `${t.creatures} creature${t.creatures === 1 ? "" : "s"}`, sub: groupsLine(t) }
      : { icon: "creatures", head: "No creatures", sub: null, none: true },
    t.fliers || t.reach
      ? { icon: "wing", head: [t.fliers ? `${t.fliers} fl${t.fliers === 1 ? "ies" : "y"}` : "Nothing flies", t.reach ? `${t.reach} with reach` : "nothing has reach"].join(", "), sub: null }
      : { icon: "wing", head: "Nothing flies, nothing has reach", sub: null, none: true },
    ...(t.creatures ? [{ icon: "shield" as const, head: `${t.untapped} untapped, ${t.creatures - t.untapped} tapped`, sub: null }] : []),
    t.sources
      ? {
          icon: "mana",
          head: `${t.openSources} of ${t.sources} mana source${t.sources === 1 ? "" : "s"} untapped`,
          sub: [`${landCount} land${landCount === 1 ? "" : "s"}`, ...others.slice(0, 3)].join(", ") + (others.length > 3 ? ` and ${others.length - 3} more.` : "."),
        }
      : { icon: "mana", head: "No mana sources on the table", sub: null, none: true },
    { icon: "hand", head: `${s.hand} card${s.hand === 1 ? "" : "s"} in hand`, sub: null },
  ];
  const graveyard = picked(model, [...model.zone(seat, "graveyard")].reverse());
  const exile = picked(model, [...model.zone(seat, "exile")].reverse());
  const handIds = model.zone(seat, "hand");
  const hand = mine || s.handVisible ? picked(model, handIds) : Array.from({ length: s.hand }, () => ({ id: null, name: "A card in hand", image: null }));
  const cmd = model.commanders.get(seat)?.[0];
  const dealt = cmd && !mine ? (model.seat(me)?.commanderDamage.get(cmd.id) ?? 0) : null;
  const also = [
    dealt !== null ? `Commander damage to you: ${dealt}` : null,
    s.poison ? `Poison ${s.poison}` : null,
    s.monarch ? "The monarch" : null,
    s.out ? "Out of the game" : null,
  ].filter(Boolean);
  return {
    seat: String(seat),
    name: String(s.name),
    life: s.life,
    place: placeOf(model, seat),
    mine,
    lines,
    graveyard,
    exile,
    hand,
    handCount: s.hand,
    library: s.library,
    also: also.length ? also.join(" · ") : null,
  };
}
