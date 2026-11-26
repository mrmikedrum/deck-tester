// The seats as the chrome tells them: each seat's nameplate with its summary as icons, and the nameplate focus with the
// same summary in words and the seat's zones picked up as printed cards. Figures are facts the engine sent, never a
// verdict. The client's words name a seat by its name, never by a pronoun. Pure.
import { FEED_UNITS, HAND_UNITS, designUnit } from "../layout";
import type { TablePlan } from "../layout";
import { RULE_CARDS, isLand } from "../model";
import type { Card, SeatId, TableModel } from "../model";
import type { Mark } from "../play";
import { placeOf } from "../scene/stage/faces";
import type { IconView, PickedCard, PlateView, SeatFocusView } from "../chrome/view";
import { font } from "../theme";
import type { ViewportState } from "./state";

/** Where the plates sit, CSS px at 1180 x 820 (the design unit scales them): the top row under the safe area, clear of
 * the Game button; mine at the bottom where my plaque was. */
const PLATE = { top: 6, height: 44, bottom: 8, clearLeft: 112, edge: 12, gap: 4 } as const;

/** A box on screen, CSS px. */
export interface Box {
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}

type Measure = (text: string, font: string) => number;
const estimate: Measure = (text, style) => text.length * (style.startsWith("400") ? 10 : 9);

/** A waiting commander's portrait against its plate (chrome.css `.l-plate .cmd`): its width in design units, at least
 *  a finger's 44 CSS px past the bronze that tucks over its last 6 design units. */
export const PORTRAIT = { w: 52, tuck: 6, tap: 44 } as const;

/** How wide `n` portraits make a plate at `unit` (CSS px): each its width, a finger's at least where it shows, the last
 *  tucked under the bronze. */
export const portraitsPx = (n: number, unit: number): number => (n ? n * Math.max(PORTRAIT.tap + PORTRAIT.tuck * unit, PORTRAIT.w * unit) - PORTRAIT.tuck * unit : 0);

/** A plate's width in design units, including the life box's padding and the name's letter spacing (chrome.css); its
 *  portraits are `portraitsPx`'s. */
export function plateWidth(name: string, life: number, icons: readonly IconView[], measure: Measure = estimate, out = false): number {
  const title = measure(name, `400 19px ${font.serif}`) + name.length * 19 * 0.02;
  // Out of the game: the sigil, the name and "Out", nothing else.
  if (out) return 10 + 18 + 8 + title + 8 + measure("Out", `italic 400 15px ${font.serif}`) + 4 + 6 + 2;
  const lifeBox = Math.max(34, measure(String(life), `700 19px ${font.ui}`)) + 12;
  const bronze = 10 + 18 + 8 + title + 8 + lifeBox + 6;
  const tab = icons.length ? 20 + icons.reduce((n, i) => n + 19 + 3 + measure(i.figure, `700 16px ${font.ui}`), 0) + 10 * (icons.length - 1) : 0;
  return bronze + tab + 2; // Leave room for differences in canvas and CSS rounding.
}

const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

/**
 * Where the top row's plates go (each its left edge, CSS px): each as near its leaf (`pref`, its preferred left edge)
 * as it can be without covering a card the table shows (`under`: the boxes of the plan's hit groups) or another plate,
 * in the order given (the seats' order). Keep the whole row on screen and favor the preferred position of the plate across the table.
 */
export function placeTop(
  plates: readonly { readonly seat: string; readonly place: string; readonly w: number; readonly pref: number }[],
  under: readonly Box[],
  row: { readonly t: number; readonly b: number; readonly l: number; readonly r: number },
  gap = 0,
): Map<string, number> {
  const visible = under.filter((box) => box.t < row.b && box.b > row.t);
  const count = 1 << plates.length;
  const widths = Array.from({ length: count }, (_, mask) => plates.reduce((sum, p, j) => sum + (mask & (1 << j) ? p.w + gap : 0), 0));
  const slack = Math.max(0, row.r - row.l - widths[count - 1]! + gap);
  const clamp = (shift: number) => Math.max(0, Math.min(slack, shift));
  const stops = new Set([0, slack]);
  for (const [mask, width] of widths.entries()) {
    for (const [j, p] of plates.entries()) {
      if (mask & (1 << j)) continue;
      const packed = row.l + width;
      stops.add(clamp(p.pref - packed));
      for (const box of visible) {
        stops.add(clamp(box.l - packed - p.w - 0.001));
        stops.add(clamp(box.r - packed + 0.001));
      }
    }
  }
  const shifts = [...stops].sort((a, b) => a - b);
  const best: { cost: number; plate: number }[][] = [shifts.map(() => ({ cost: 0, plate: -1 }))];
  for (let mask = 1; mask < count; mask++) {
    // Plates keep the seats' order, as given (opponents always sit in the same place relative to me, a seat out of the
    // game included): the rightmost of a set is the last of it. Preferred positions only steer how far each drifts.
    const choices = plates.flatMap((p, j) => (mask & (1 << j) && !(mask >> (j + 1)) ? [{ p, j, prev: mask ^ (1 << j) }] : []));
    const scores: typeof best[number] = [];
    best.push(scores);
    for (const [i, shift] of shifts.entries()) {
      let winner = { cost: scores[i - 1]?.cost ?? Infinity, plate: -1 };
      for (const { p, j, prev } of choices) {
        // Each plate starts after the packed widths to its left. Only the remaining slack can move it.
        const x = row.l + widths[prev]! + shift;
        const box = { l: x, t: row.t, r: x + p.w, b: row.b };
        const drift = Math.abs(x - p.pref) * (p.place === "across" ? 3 : 1);
        const cost = best[prev]![i]!.cost + visible.reduce((n, g) => n + overlap(box, g), 0) * 1000 + drift;
        if (cost < winner.cost) winner = { cost, plate: j };
      }
      scores.push(winner);
    }
  }
  const out = new Map<string, number>();
  for (let mask = count - 1, i = shifts.length - 1; mask;) {
    const { plate } = best[mask]![i]!;
    if (plate < 0) {
      i--;
      continue;
    }
    mask ^= 1 << plate;
    out.set(plates[plate]!.seat, row.l + widths[mask]! + shifts[i]!);
  }
  return out;
}

/** The log strip under the Game button (chrome.css `.l-feed`): layout keeps its leaves clear of it at its least. */
const FEED = FEED_UNITS;

/**
 * How wide the log strip may be (CSS px): its widest, or less where a card the table shows (the plan's hit groups) would
 * be under it, as the plates keep clear of them; never under its heading's width. Null: as wide as it likes.
 */
export function feedWidthOf(plan: TablePlan | null, viewport: ViewportState): number | null {
  if (!plan) return null;
  // (kept for the plan and viewport it was found for: views are made every commit, the plan changes far less often)
  const key = `${viewport.w}x${viewport.h}|${viewport.safe.top},${viewport.safe.left}`;
  const kept = FEED_WIDTHS.get(plan);
  if (kept && kept.key === key) return kept.width;
  const width = feedWidth(plan, viewport);
  FEED_WIDTHS.set(plan, { key, width });
  return width;
}

const FEED_WIDTHS = new WeakMap<TablePlan, { readonly key: string; readonly width: number | null }>();

function feedWidth(plan: TablePlan, viewport: ViewportState): number | null {
  const u = designUnit(viewport), l = viewport.safe.left + FEED.left * u, t = viewport.safe.top + FEED.top * u, b = t + Math.max(FEED.height, FEED.height * u);
  let w = FEED.widest * u;
  for (const g of plan.hits.groups) {
    if (g.kind === "plate") continue;
    const xs = g.quad.map((p) => p.x), ys = g.quad.map((p) => p.y), gl = Math.min(...xs);
    if (Math.min(...ys) < b && Math.max(...ys) > t && Math.max(...xs) > l && gl < l + w) w = Math.min(w, gl - l - FEED.gap * u);
  }
  return w >= FEED.widest * u ? null : Math.max(FEED.least * u, w);
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
  readonly commanderDamage: SeatFocusView["commanderDamage"];
}

const isBody = (c: Card): boolean => c.faceDown || /\bCreature\b/.test(c.face.type);
const pw = (c: Card): number => c.power ?? c.face.basePower;
const tg = (c: Card): number => c.toughness ?? c.face.baseToughness;
const has = (c: Card, k: string): boolean => c.keywords.some((w) => w.toLowerCase() === k);
/** It makes mana: a land, or a permanent with a mana ability of its own (taps for it, as a rock, a Treasure or a
 * creature does). A card that only lists what it makes (a rule card that hands out Treasure) is not counted. */
const makesMana = (c: Card): boolean =>
  isLand(c) || (c.face.produces.length > 0 && !RULE_CARDS.has(c.name) && /(^|\n|— )\{T\}[^:\n]*: Add/.test(c.face.text));

function commanderDamageOf(model: TableModel, seat: SeatId): SeatFocusView["commanderDamage"] {
  const damage = model.seat(seat)?.commanderDamage;
  if (!damage?.size) return [];
  const remembered = [...model.commanders.values()].flat();
  return [...damage]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, amount]) => {
      const card = model.cards.get(id) ?? remembered.find((c) => c.id === id);
      const controller = card ? (model.seat(card.controller)?.name ?? card.controller) : null;
      const remaining = 21 - amount;
      return {
        id,
        source: card ? `${card.name} (${controller})` : `Unknown commander #${id}`,
        figure: `${amount} · ${remaining > 0 ? `${remaining} to lethal` : "Lethal"}`,
        danger: amount >= 15,
      };
    });
}

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
  return { creatures, power, untappedPower, untapped, biggest, fliers, reach, sources, lands, openSources, others, groups, commanderDamage: commanderDamageOf(model, seat) };
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

/** My nameplate's icons: my graveyard and exile once anything is there (a commander waiting in the command zone is a
 *  portrait against the plate, as every seat's is). */
function myIcons(model: TableModel, seat: SeatId): IconView[] {
  const n = (zone: "graveyard" | "exile") => model.zone(seat, zone).length;
  return [
    ...(n("graveyard") ? [{ kind: "graveyard" as const, figure: String(n("graveyard")) }] : []),
    ...(n("exile") ? [{ kind: "exile" as const, figure: String(n("exile")) }] : []),
  ];
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

const NONE: ReadonlySet<number> = new Set();

/** Every seat's nameplate: opponents' along the top over their leaves, bent round the cards there (`placeTop`), in
 * their order around the table; mine at the bottom where my plate stands. */
let lastPlates: { readonly key: readonly unknown[]; readonly plates: PlateView[] } | null = null;
export function platesOf(model: TableModel, plan: TablePlan | null, marks: ReadonlyMap<SeatId, Mark>, viewport: ViewportState, measure: Measure = estimate, cast: ReadonlySet<number> = NONE): PlateView[] {
  // The same inputs, the same plates: drawn every frame, made once per model, plan and marks.
  // (Marks by what they say: play presents a new map each frame.)
  const key = [model, plan, [...marks].map(([k, m]) => `${k}:${m}`).join(","), viewport, measure, [...cast].join(",")];
  if (lastPlates && lastPlates.key.every((k, i) => k === key[i])) return lastPlates.plates;
  const plates = makePlates(model, plan, marks, viewport, measure, cast);
  lastPlates = { key, plates };
  return plates;
}

function makePlates(model: TableModel, plan: TablePlan | null, marks: ReadonlyMap<SeatId, Mark>, viewport: ViewportState, measure: Measure, cast: ReadonlySet<number>): PlateView[] {
  const me = model.viewer.perspective;
  const { w, h, safe } = viewport;
  const u = designUnit(viewport);
  const others = model.seats.filter((s) => s.id !== me);
  const rows = model.seats.map((s) => {
    const mine = s.id === me;
    const at = plan ? centre(plan, s.id) : null;
    const i = others.indexOf(s);
    const mark = marks.get(s.id);
    // Mine says what of my game is off the table (my own table is in front of me): my graveyard and exile by count, and
    // a commander waiting in the command zone; the nameplate's focus holds them.
    const icons = s.out ? [] : mine ? myIcons(model, s.id) : restIcons(model, s.id, summaryOf(model, s.id));
    const commanders = s.out ? [] : picked(model, model.zone(s.id, "command"));
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
      icons,
      commanders,
      width: plateWidth(String(s.name), s.life, icons, measure, s.out),
    };
  });
  const top = safe.top + PLATE.top * u;
  const under: Box[] = (plan?.hits.groups ?? [])
    .filter((g) => g.kind !== "plate")
    .map((g) => {
      const xs = g.quad.map((p) => p.x), ys = g.quad.map((p) => p.y);
      return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
    });
  const opponents = rows.filter((r) => !r.mine);
  const left = safe.left + PLATE.clearLeft * u, right = w - safe.right - PLATE.edge * u;
  /** A plate's width at `unit`, CSS px, its portraits included. */
  const px = (r: (typeof rows)[number], unit: number): number => r.width * unit + portraitsPx(r.commanders.length, unit);
  // The largest unit up to the design unit at which the row fits across, its portraits at a finger's width at least.
  const rowPx = (unit: number) => opponents.reduce((sum, r) => sum + px(r, unit), Math.max(0, opponents.length - 1) * PLATE.gap * unit);
  let fullUnit = u;
  if (opponents.length && rowPx(u) > right - left) {
    let lo = 0, hi = u;
    for (let k = 0; k < 20; k++) {
      const m = (lo + hi) / 2;
      if (rowPx(m) <= right - left) lo = m;
      else hi = m;
    }
    fullUnit = lo;
  }
  let unit = fullUnit;
  let lefts: Map<string, number>;
  // If the cards split the available space into narrow gaps, compact the whole row while retaining its tap height.
  for (const scale of [1, 0.95, 0.9, 0.85]) {
    unit = fullUnit * scale;
    const b = top + Math.max(PLATE.height, PLATE.height * unit);
    const widths = opponents.map((r) => ({ seat: r.seat, place: r.place, w: px(r, unit), pref: r.mid - px(r, unit) / 2 }));
    lefts = placeTop(widths, under, { t: top, b, l: left, r: right }, PLATE.gap * unit);
    if (widths.every((p) => {
      const l = lefts.get(p.seat)!;
      return under.every((g) => overlap({ l, r: l + p.w, t: top, b }, g) === 0);
    })) break;
  }
  return rows.map((r) => {
    const plateUnit = r.mine ? Math.min(u, (w - safe.left - safe.right) / (r.width + r.commanders.length * PORTRAIT.w)) : unit;
    const half = px(r, plateUnit) / 2;
    return {
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
      // (each of mine wears the ember only when a play offered now casts that card)
      ...(r.commanders.length ? { commanders: r.commanders.map((c) => (r.mine && c.id !== null && cast.has(c.id) ? { ...c, cast: true } : c)) } : {}),
      unit: plateUnit,
      // (mine: centred on its place, but never over the hand, however wide its icons make it)
      x: r.mine ? Math.min(w - safe.right - half, Math.max(safe.left + half, safe.left + (HAND_UNITS.right + PLATE.gap * 2) * u + half, r.mid)) : lefts!.get(r.seat)!,
      y: r.mine ? Math.min(r.bottom ?? h, h - safe.bottom - PLATE.bottom * u) : top,
    };
  });
}

const picked = (model: TableModel, ids: readonly number[]): PickedCard[] =>
  ids
    .map((id) => model.cards.get(id as never))
    .filter((c): c is Card => !!c)
    .map((c) => ({ id: c.id, name: c.face.name, image: c.faceDown ? null : c.face.img, art: c.faceDown ? null : c.face.art }));

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
    // (my own hand is in front of me: its count is no news)
    ...(mine ? [] : [{ icon: "hand" as const, head: `${s.hand} card${s.hand === 1 ? "" : "s"} in hand`, sub: null }]),
  ];
  const graveyard = picked(model, [...model.zone(seat, "graveyard")].reverse());
  const exile = picked(model, [...model.zone(seat, "exile")].reverse());
  const command = picked(model, model.zone(seat, "command"));
  // An opponent's hand only when it is shown (its count is a line); mine never (it is in front of me).
  const hand = !mine && s.handVisible ? picked(model, model.zone(seat, "hand")) : [];
  const also = [
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
    commanderDamage: t.commanderDamage,
    graveyard,
    exile,
    command,
    board: !s.out,
    hand,
    handCount: s.hand,
    library: s.library,
    also: also.length ? also.join(" · ") : null,
  };
}
