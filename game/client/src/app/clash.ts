// The clash in words (docs/game-client-architecture.md, "Combat"): from the plan's gathering, the plaque over each wing
// ("Atraxa attacks You · 3 unblocked"), the brand in each unblocked attacker's empty slot, the clasp between each pair,
// and the tally each defender's plate wears. They count what the client can see, the current power of the attackers
// that have had no blocker, and say "unblocked", never "damage": trample, double strike and prevention are Forge's.
// Pure.
import type { ClashWing, CombatPairs, Defender, Gathering, HitGroup, TablePlan } from "../layout";
import { combatFormOf, designUnit, engineCombat, mergeCombat } from "../layout";
import type { CardId } from "../protocol";
import type { SeatId, TableModel } from "../model";
import { shortName } from "../theme";
import type { SeatPlace } from "../theme";
import type { ClashView, PlateTally, PlateView } from "../chrome/view";
import type { CombatSight } from "./focus";

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

/** A defender as a key: "s<seat>" or "c<card>". */
const defenderKey = (d: Defender): string => ("seat" in d ? `s${d.seat}` : `c${d.card}`);


/**
 * The combat damage dealt in this combat to each defender, by defender key: Forge's facts (the engine's
 * `combat.damage`, after prevention, summed over the damage steps), each hit counted for the defender its source was
 * attacking when it landed, to that defender itself (not to a blocker), whatever the attacks are now.
 */
export function combatDamage(model: TableModel): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of model.combat?.damage ?? []) {
    if (d.defender === null || d.amount <= 0 || defenderKey(d.defender) !== defenderKey(d.target)) continue;
    const k = defenderKey(d.defender);
    out.set(k, (out.get(k) ?? 0) + d.amount);
  }
  return out;
}

/** The attackers Forge says are blocked (its verdict holds when the blockers leave, and drops when an effect unblocks);
 *  from an engine that does not say, those with a blocker now. */
export function blockedOf(model: TableModel | null): CardId[] {
  const c = model?.combat;
  if (!c) return [];
  return c.attackers.filter((a) => (a.blocked === null ? c.blockers.some((b) => b.attacker === a.attacker) : a.blocked)).map((a) => a.attacker);
}

/**
 * The plaque's words: "Atraxa attacks You · 3 unblocked", "You attack Marath · 9 unblocked"; once the engine reports
 * combat damage dealt to the wing's defender (a player or a planeswalker) by attackers aimed at it, what was dealt
 * ("· 3 dealt"). Without that fact, what is unblocked.
 */
export function plaqueWords(model: TableModel, w: ClashWing, dealt: ReadonlyMap<string, number> = new Map()): string {
  const who = String(model.seat(w.attacker)?.name ?? w.attacker);
  const head = `${who} ${who === "You" ? "attack" : "attacks"} ${defenderName(model, w)}`;
  const n = dealt.get(defenderKey(w.defender)) ?? 0;
  return n > 0 ? `${head} · ${n} dealt` : `${head} · ${w.unblocked} unblocked`;
}

/**
 * The combat as the focus hears of it (focus.ts `CombatSight`): its identity, a game's turn and Forge's combat ordinal
 * while the engine shows a combat in a combat step (so it ends with the combat, a jump to the main phase included),
 * and whether it raises the clash by itself: it involves me, or the plan found its duels too many for the middle.
 */
export function combatSightOf(model: TableModel | null, draft: CombatPairs | null, plan: TablePlan | null = null): CombatSight {
  if (!model || !model.combat || !/^COMBAT_/.test(model.phase)) return { key: "", wanted: false };
  const combat = mergeCombat(engineCombat(model), draft);
  const seatOf = (id: CardId) => model.cards.get(id)?.controller ?? undefined;
  return {
    key: `${model.gen}|${model.turn}|${model.combat.ordinal ?? 0}`,
    wanted: combatFormOf(combat, model.viewer.perspective, seatOf, new Set(blockedOf(model))) === "clash" || !!plan?.crowded,
  };
}

/** A plaque's width on screen (CSS px): its words at 18 design px in the serif, and its padding. */
const plaqueWidth = (words: string, u: number): number => (words.length * 8.6 + 34) * u;

/**
 * Plaques centred over their wings, then spread so none meets the next (8 px apart) and all stay on the screen: each
 * as near its wing as the others allow.
 */
export function spreadPlaques<T extends { x: number; w: number }>(ps: readonly T[], left: number, right: number, gap: number): T[] {
  const out = ps.map((p) => ({ ...p }));
  for (let k = 0; k < 8; k++) {
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1]!, b = out[i]!, over = a.x + a.w / 2 + gap - (b.x - b.w / 2);
      if (over > 0) {
        a.x -= over / 2;
        b.x += over / 2;
      }
    }
    const first = out[0], last = out.at(-1);
    if (first && first.x - first.w / 2 < left) {
      const d = left - (first.x - first.w / 2);
      for (const p of out) p.x += d;
    }
    if (last && last.x + last.w / 2 > right) {
      const d = last.x + last.w / 2 - right;
      for (const p of out) p.x -= d;
    }
  }
  return out;
}

/** The clash's chrome: null when it is not up. Duels in the middle (the table form) wear only their clasps. */
export function clashViewOf(model: TableModel, plan: TablePlan | null): ClashView | null {
  const g: Gathering | null = plan?.gathering ?? null;
  if (plan && g && !g.focus && g.duels) {
    const clasps = g.wings.flatMap((w) => w.columns.flatMap((c) => (c.clasp ? [{ key: c.unit, x: c.clasp.x, y: c.clasp.y }] : [])));
    return { unit: designUnit(plan.viewport), plaques: [], brands: [], clasps, tallies: [], more: null };
  }
  if (!plan || !g?.focus) return null;
  const me = model.viewer.perspective, u = designUnit(plan.viewport);
  const dealt = combatDamage(model);
  const plaques: ClashView["plaques"][number][] = [], brands: ClashView["brands"][number][] = [], clasps: ClashView["clasps"][number][] = [];
  for (const w of g.wings) {
    const tone = toneOf(w, me), place = placeOf(model, w.attacker);
    const words = plaqueWords(model, w, dealt);
    plaques.push({ key: `${w.attacker}>${"seat" in w.defender ? w.defender.seat : w.defender.card}`, x: w.plaque.x, y: w.plaque.y, w: plaqueWidth(words, u), words, tone, place });
    for (const c of w.columns) {
      if (c.clasp) clasps.push({ key: c.unit, x: c.clasp.x, y: c.clasp.y });
      if (!c.slot) continue;
      const xs = c.slot.map((p) => p.x), ys = c.slot.map((p) => p.y);
      const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), b = Math.max(...ys);
      brands.push({ key: c.unit, x: (l + r) / 2, y: (t + b) / 2, size: Math.min(r - l, b - t) * 0.52, figure: c.power > 0 ? String(c.power) : null, count: c.attackers.length > 1 ? c.attackers.length : null, tone, place, down: w.defenderSeat === me });
    }
  }
  // An attacked planeswalker's tally, by its loyalty (on its top edge); the "more" column's count and power.
  // (A planeswalker whose wing waits whole in "more" keeps its tally there.)
  const tallies = g.wings.flatMap((w) => {
    const at = w.walker ? { key: w.walker.unit, x: w.walker.x, y: w.walker.top } : w.tallyAt && "card" in w.defender ? { key: `c${w.defender.card}`, ...w.tallyAt } : null;
    return at && w.unblocked > 0 ? [{ ...at, figure: `−${w.unblocked}`, tone: toneOf(w, me) }] : [];
  });
  let more: ClashView["more"] = null;
  if (g.moreAt && g.more.length) {
    const attackers = new Set(plan.combat?.attacks.map((a) => a.attacker) ?? []);
    const shown = g.more.filter((id) => attackers.has(id));
    const power = shown.reduce((t, id) => t + Math.max(0, model.cards.get(id)?.power ?? 0), 0);
    const xs = g.moreAt.map((p) => p.x), ys = g.moreAt.map((p) => p.y);
    more = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), words: `${shown.length || g.more.length} more · ${power} power` };
  }
  const safe = plan.reserve.safe;
  return { unit: u, plaques: spreadPlaques(plaques, safe.left + 16 * u, safe.right - 16 * u, 8 * u), brands, clasps, tallies, more };
}

/**
 * The tallies the plates wear: each defending player's summed unblocked power ("−3"), in the wing's tone, while a
 * combat is shown (the clash or the table form); and the attacking player's mark.
 */
export function withTallies(plates: readonly PlateView[], model: TableModel, plan: TablePlan | null): readonly PlateView[] {
  const g = plan?.gathering;
  // (Once damage is dealt the plaque says what was; the tally, which counts what is coming, gives way.)
  if (!g || !g.wings.length || /DAMAGE|COMBAT_END/.test(model.phase)) return plates;
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

/** The clash's "more" column's hit group: the fighters past its columns, opened as a sift. */
export const CLASH_MORE = "clash:more";

/** A hit group of the clash: a fighter standing in it, or an unblocked attacker's slot. */
export function isFighter(plan: TablePlan, g: HitGroup): boolean {
  if (!plan.gathering?.focus) return false;
  if (g.id.startsWith("slot:")) return true;
  return g.seat !== null && !!plan.seats.get(g.seat)?.units.some((u) => u.id === g.id && u.fighting);
}
