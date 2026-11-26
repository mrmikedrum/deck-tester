// The clash in words (docs/game-client-architecture.md, "Combat"): from the plan's gathering, the plaque over each wing
// ("Atraxa attacks You · 3 unblocked"), the brand in each unblocked attacker's empty slot, the clasp between each pair,
// and the tally each defender's plate wears. They count what the client can see, the current power of the attackers
// that have had no blocker, and say "unblocked", never "damage": trample, double strike and prevention are Forge's.
// Pure.
import type { ClashWing, Gathering, TablePlan } from "../layout";
import { designUnit } from "../layout";
import type { SeatId, TableModel } from "../model";
import { shortName } from "../theme";
import type { SeatPlace } from "../theme";
import type { ClashView, PlateTally, PlateView } from "../chrome/view";

const PLACES: readonly SeatPlace[] = ["near", "left", "across", "right"];
const placeOf = (model: TableModel, seat: SeatId): SeatPlace => PLACES[Math.max(0, model.seats.findIndex((s) => s.id === seat)) % PLACES.length] ?? "near";

/** A wing's tone: red at me, gold when the attackers are mine, the attacker's ink between opponents. */
export function toneOf(w: ClashWing, me: SeatId): PlateTally["tone"] {
  return w.defenderSeat === me ? "danger" : w.attacker === me ? "gold" : "ink";
}

/** Who a wing attacks, in words: a player by name, a planeswalker by its short name. */
function defenderName(model: TableModel, w: ClashWing): string {
  if ("seat" in w.defender) return String(model.seat(w.defender.seat)?.name ?? w.defender.seat);
  const c = model.cards.get(w.defender.card);
  return c ? shortName(c.face.name) : "a planeswalker";
}

/** The plaque's words. */
export function plaqueWords(model: TableModel, w: ClashWing): string {
  const who = String(model.seat(w.attacker)?.name ?? w.attacker);
  return `${who} attacks ${defenderName(model, w)} · ${w.unblocked} unblocked`;
}

/** The clash's chrome: null when it is not up. */
export function clashViewOf(model: TableModel, plan: TablePlan | null): ClashView | null {
  const g: Gathering | null = plan?.gathering ?? null;
  if (!plan || !g?.focus) return null;
  const me = model.viewer.perspective, u = designUnit(plan.viewport);
  const plaques: ClashView["plaques"][number][] = [], brands: ClashView["brands"][number][] = [], clasps: ClashView["clasps"][number][] = [];
  for (const w of g.wings) {
    const tone = toneOf(w, me), place = placeOf(model, w.attacker);
    plaques.push({ key: `${w.attacker}>${"seat" in w.defender ? w.defender.seat : w.defender.card}`, x: w.plaque.x, y: w.plaque.y, words: plaqueWords(model, w), tone, place });
    for (const c of w.columns) {
      if (c.clasp) clasps.push({ key: c.unit, x: c.clasp.x, y: c.clasp.y });
      if (!c.slot) continue;
      const xs = c.slot.map((p) => p.x), ys = c.slot.map((p) => p.y);
      const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), b = Math.max(...ys);
      brands.push({ key: c.unit, x: (l + r) / 2, y: (t + b) / 2, size: Math.min(r - l, b - t) * 0.62, figure: c.power > 0 ? String(c.power) : null, count: c.attackers.length > 1 ? c.attackers.length : null, tone, place, down: w.defenderSeat === me });
    }
  }
  return { unit: u, plaques, brands, clasps };
}

/**
 * The tallies the plates wear: each defending player's summed unblocked power ("−3"), in the wing's tone, while a
 * combat is shown (the clash or the table form); and the attacking player's mark.
 */
export function withTallies(plates: readonly PlateView[], model: TableModel, plan: TablePlan | null): readonly PlateView[] {
  const g = plan?.gathering;
  if (!g || !g.wings.length) return plates;
  const me = model.viewer.perspective;
  const by = new Map<string, { sum: number; tone: PlateTally["tone"]; place: SeatPlace }>();
  const attacking = new Set(g.wings.map((w) => String(w.attacker)));
  for (const w of g.wings) {
    if (!("seat" in w.defender)) continue;
    const k = String(w.defender.seat), was = by.get(k);
    by.set(k, { sum: (was?.sum ?? 0) + w.unblocked, tone: toneOf(w, me), place: placeOf(model, w.attacker) });
  }
  return plates.map((p) => {
    const t = by.get(p.seat);
    const tally: PlateTally | null = t && t.sum > 0 ? { figure: `−${t.sum}`, tone: t.tone, place: t.place } : null;
    return tally || attacking.has(p.seat) ? { ...p, tally, attacking: attacking.has(p.seat) } : p;
  });
}
