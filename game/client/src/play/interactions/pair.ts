// Pairing a creature with what it meets: attackers with defenders, blockers with attackers (live.js `tapDecision`,
// `H.drag` and the attack buttons). Options are 1-based positions in the decision's refs, one per legal pair.
import type { AttackRef, BlockRef, CardId } from "../../protocol";

type Sel = readonly number[];
const without = (sel: Sel, refs: readonly { readonly card: CardId }[], card: CardId): number[] =>
  sel.filter((o) => refs[o - 1]?.card !== card);

// ---- attack -------------------------------------------------------------------------------------------------------

/** The pair for `card` at `to`, else its first pair. */
const pairFor = (refs: readonly AttackRef[], card: CardId, to: string | number | null): number => {
  const j = refs.findIndex((r) => r.card === card && r.to === to);
  return (j >= 0 ? j : refs.findIndex((r) => r.card === card)) + 1;
};

/** live.js `prepare`: new attackers go at the first opponent still in the game the refs name, else the first defender. */
export function defaultDefender(refs: readonly AttackRef[], isIn: (seat: string) => boolean): string | number | null {
  const tos = [...new Set(refs.map((r) => r.to as string | number))];
  return tos.find((t) => typeof t === "string" && isIn(t)) ?? tos[0] ?? null;
}

/** Tap a creature: take it back, or pick it at the current defender. */
export function toggleAttacker(sel: Sel, refs: readonly AttackRef[], card: CardId, to: string | number | null): number[] {
  return sel.some((o) => refs[o - 1]?.card === card) ? without(sel, refs, card) : [...sel, pairFor(refs, card, to)];
}

/** Tap another player's plate: the picks so far turn to them where they can. */
export function retarget(sel: Sel, refs: readonly AttackRef[], to: string): number[] {
  return sel.map((o) => {
    const card = refs[o - 1]?.card;
    const j = refs.findIndex((r) => r.card === card && r.to === to);
    return j >= 0 ? j + 1 : o;
  });
}

/** "Everyone attacks": every creature at the current defender. */
export function everyone(refs: readonly AttackRef[], to: string | number | null): number[] {
  return [...new Set(refs.map((r) => r.card))].map((c) => pairFor(refs, c, to));
}

/** Drag a creature onto a defender: that pair, or null when there is none. */
export function aim(sel: Sel, refs: readonly AttackRef[], card: CardId, to: string | number): number[] | null {
  const j = refs.findIndex((r) => r.card === card && r.to === to);
  return j < 0 ? null : [...without(sel, refs, card), j + 1];
}

// ---- block --------------------------------------------------------------------------------------------------------

export interface BlockDraft {
  readonly sel: number[];
  readonly holding: CardId | null;
}

/** Tap my blocker: take it back; a single legal pairing picks itself; otherwise hold it for its attacker. */
export function tapBlocker(sel: Sel, refs: readonly BlockRef[], card: CardId): BlockDraft {
  if (sel.some((o) => refs[o - 1]?.card === card)) return { sel: without(sel, refs, card), holding: null };
  const can = refs.flatMap((r, i) => (r.card === card ? [i + 1] : []));
  return can.length === 1 ? { sel: [...sel, can[0]!], holding: null } : { sel: [...sel], holding: card };
}

/** The pair (blocker, attacker), or null when it is not legal. */
export function block(sel: Sel, refs: readonly BlockRef[], blocker: CardId, attacker: CardId): number[] | null {
  const j = refs.findIndex((r) => r.card === blocker && r.blocks === attacker);
  return j < 0 ? null : [...without(sel, refs, blocker), j + 1];
}
