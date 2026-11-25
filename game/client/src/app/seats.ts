// The seats as the chrome tells them: each seat's nameplate with its summary as icons, and the nameplate focus with the
// same summary in words and the seat's zones picked up as printed cards. Figures are facts the engine sent, never a
// verdict. The client's words name a seat by its name, never by a pronoun. Pure.
import type { TablePlan } from "../layout";
import { isLand, isManaSource } from "../model";
import type { Card, SeatId, TableModel } from "../model";
import type { Mark } from "../play";
import { placeOf } from "../scene/stage/faces";
import type { IconView, PickedCard, PlateView, SeatFocusView } from "../chrome/view";

/** Where the plates sit, CSS px at 1180 x 820 (the design unit scales them): the top row under the safe area, clear of
 * the Game button on the left (the left seat's plate hangs from its left edge, the right seat's from its right edge,
 * each half a plate out from its leaf's middle); mine at the bottom where my plaque was. */
const PLATE = { top: 6, bottom: 8, half: 130, clearLeft: 112, edge: 12 } as const;

/** What a seat has on the table, counted. */
interface Tally {
  readonly creatures: readonly Card[];
  readonly power: number;
  readonly untappedPower: number;
  readonly untapped: number;
  readonly biggest: Card | null;
  readonly fliers: number;
  readonly reach: number;
  readonly sources: readonly Card[];
  readonly open: number;
}

const isBody = (c: Card): boolean => c.faceDown || /\bCreature\b/.test(c.face.type);
const pw = (c: Card): number => c.power ?? c.face.basePower;
const tg = (c: Card): number => c.toughness ?? c.face.baseToughness;
const has = (c: Card, k: string): boolean => c.keywords.some((w) => w.toLowerCase() === k);

function tally(model: TableModel, seat: SeatId): Tally {
  const cards = model.zone(seat, "battlefield").map((id) => model.cards.get(id)).filter((c): c is Card => !!c);
  const creatures = cards.filter(isBody);
  const sources = cards.filter((c) => (isLand(c) && !isBody(c)) || isManaSource(c));
  const biggest = creatures.reduce<Card | null>((b, c) => (!b || pw(c) > pw(b) || (pw(c) === pw(b) && tg(c) > tg(b)) ? c : b), null);
  return {
    creatures,
    power: creatures.reduce((n, c) => n + Math.max(0, pw(c)), 0),
    untappedPower: creatures.filter((c) => !c.tapped).reduce((n, c) => n + Math.max(0, pw(c)), 0),
    untapped: creatures.filter((c) => !c.tapped).length,
    biggest,
    fliers: creatures.filter((c) => has(c, "flying")).length,
    reach: creatures.filter((c) => has(c, "reach")).length,
    sources,
    open: sources.filter((c) => !c.tapped).length,
  };
}

/** The icons at rest: power on the table once there is any, open mana once there is a source, cards in hand always. */
function restIcons(model: TableModel, seat: SeatId, t: Tally): IconView[] {
  const s = model.seat(seat);
  return [
    ...(t.creatures.length ? [{ kind: "power" as const, figure: String(t.power) }] : []),
    ...(t.sources.length ? [{ kind: "mana" as const, figure: String(t.open) }] : []),
    { kind: "hand" as const, figure: String(s?.hand ?? 0) },
  ];
}

const centre = (plan: TablePlan, seat: SeatId): { x: number; bottom: number } | null => {
  const g = plan.hits.groups.find((x) => x.kind === "plate" && x.seat === seat);
  if (!g) return null;
  const xs = g.quad.map((p) => p.x), ys = g.quad.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, bottom: Math.max(...ys) };
};

/** Every seat's nameplate: opponents' along the top over their leaves, in their order around the table; mine at the
 * bottom where my plate stands. */
export function platesOf(model: TableModel, plan: TablePlan | null, marks: ReadonlyMap<SeatId, Mark>, safeTop: number, h: number): PlateView[] {
  const me = model.viewer.perspective;
  const w = plan?.viewport.w ?? 1180;
  const u = Math.min(w / 1180, h / 820);
  const others = model.seats.filter((s) => s.id !== me);
  return model.seats.map((s) => {
    const mine = s.id === me;
    const at = plan ? centre(plan, s.id) : null;
    const i = others.indexOf(s);
    const mid = at?.x ?? (mine ? w / 2 : ((i + 1) * w) / (others.length + 1));
    const place = placeOf(model, s.id);
    const x = mine
      ? (at?.x ?? w / 2)
      : place === "left"
        ? Math.max(PLATE.clearLeft * u, mid - PLATE.half * u)
        : place === "right"
          ? Math.min(w - PLATE.edge * u, mid + PLATE.half * u)
          : mid;
    const mark = marks.get(s.id);
    return {
      seat: String(s.id),
      group: `plate:${s.id}`,
      name: String(s.name),
      life: s.life,
      place,
      mine,
      active: model.active === s.id,
      ring: mark === "option" ? "option" : mark === "selected" ? "selected" : null,
      out: s.out,
      x,
      y: mine ? (at ? at.bottom : h - PLATE.bottom * u) : safeTop + PLATE.top * u,
      // Mine carries no icons at rest: my own table is in front of me (my nameplate focus has the words).
      icons: mine ? [] : restIcons(model, s.id, tally(model, s.id)),
    };
  });
}

const picked = (model: TableModel, ids: readonly number[]): PickedCard[] =>
  ids
    .map((id) => model.cards.get(id as never))
    .filter((c): c is Card => !!c)
    .map((c) => ({ id: c.id, name: c.face.name, image: c.faceDown ? null : c.face.img }));

/** "9 Beasts 4/4, 8 Elementals 3/3 and 10 others": the biggest groups of like creatures. */
function groupsLine(cs: readonly Card[]): string | null {
  const by = new Map<string, Card[]>();
  for (const c of cs) by.set(`${c.face.name}|${pw(c)}/${tg(c)}`, [...(by.get(`${c.face.name}|${pw(c)}/${tg(c)}`) ?? []), c]);
  const groups = [...by.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length).slice(0, 3);
  if (!groups.length) return null;
  const named = groups.map((g) => `${g.length} ${g[0]!.face.name} ${pw(g[0]!)}/${tg(g[0]!)}`);
  const rest = cs.length - groups.reduce((n, g) => n + g.length, 0);
  return rest > 0 ? `${named.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}.` : `${named.join(", ")}.`;
}

/** The nameplate focus: the seat in words, a line per icon (an icon the plate does not show at rest too, its absence
 * spelled out), its zones picked up, and what else a player would ask. */
export function seatFocusOf(model: TableModel, seat: SeatId): SeatFocusView | null {
  const s = model.seat(seat);
  if (!s) return null;
  const me = model.viewer.perspective, mine = seat === me;
  const t = tally(model, seat);
  const big = t.biggest ? `Biggest is a ${pw(t.biggest)}/${tg(t.biggest)} (${t.biggest.face.name}).` : null;
  const landCount = t.sources.filter(isLand).length;
  const others = t.sources.filter((c) => !isLand(c)).map((c) => c.face.name);
  const lines: SeatFocusView["lines"] = [
    t.creatures.length
      ? { icon: "power", head: `${t.power} power on the table`, sub: [`${t.untappedPower} of it untapped.`, big].filter(Boolean).join(" ") }
      : { icon: "power", head: "No power on the table", sub: null, none: true },
    t.creatures.length
      ? { icon: "creatures", head: `${t.creatures.length} creature${t.creatures.length === 1 ? "" : "s"}`, sub: groupsLine(t.creatures) }
      : { icon: "creatures", head: "No creatures", sub: null, none: true },
    t.fliers || t.reach
      ? { icon: "wing", head: [t.fliers ? `${t.fliers} fl${t.fliers === 1 ? "ies" : "y"}` : "Nothing flies", t.reach ? `${t.reach} with reach` : "nothing has reach"].join(", "), sub: null }
      : { icon: "wing", head: "Nothing flies, nothing has reach", sub: null, none: true },
    ...(t.creatures.length ? [{ icon: "shield" as const, head: `${t.untapped} untapped, ${t.creatures.length - t.untapped} tapped`, sub: null }] : []),
    t.sources.length
      ? { icon: "mana", head: `${t.open} of ${t.sources.length} mana open`, sub: [`${landCount} land${landCount === 1 ? "" : "s"}`, ...others.slice(0, 3)].join(", ") + (others.length > 3 ? ` and ${others.length - 3} more.` : ".") }
      : { icon: "mana", head: "No mana on the table", sub: null, none: true },
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
