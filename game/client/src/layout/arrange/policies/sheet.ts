// The focus containers' policy stage (§2.8): which cards form a unit on a sheet, under which caption, in what order.
// The sheet's solver (sheet.ts) only places what this hands it, so a trained model can replace the order here, and the
// row breaks stay a stage of their own (breaks.ts).
import type { CardId } from "../../types";
import { rowClassOf } from "../breaks";
import type { RowClass } from "../breaks";
import type { ArrCard, CaptionKind } from "../contract";
import { dressingOf } from "./common";
import { kindOf } from "./kinds";

/** One unit on a sheet, in the order the policy hands them over. */
export interface SheetUnit {
  /** Stable while its cards last: its top card's. */
  readonly key: string;
  /** Its cards, the top first: more than one only for identical copies (a stack with its count). */
  readonly cards: readonly CardId[];
  readonly tapped: boolean;
  /** The caption it stands under (a spread's tiers); null on a pile. */
  readonly tier: CaptionKind | null;
  /** What it is, for the row breaks. */
  readonly cls: RowClass;
  /** The decision up offers one of its cards. */
  readonly offered: boolean;
}

/** What the policy sees: the cards, what the decision offers, and whether it is choosing cards now. */
export interface SheetCtx {
  readonly offered: ReadonlySet<CardId>;
  readonly choosing: boolean;
}

/** The spread's captions, in the order its tiers stand (designer §7.2: Ready, Tapped, Works, Lands). */
export const SPREAD_TIERS: readonly CaptionKind[] = ["ready", "tapped", "works", "lands"];

/** A card's tier on a spread, from its current types: what fights by whether it is tapped, then works, then mana. */
export function spreadTier(c: ArrCard): CaptionKind {
  const k = kindOf(c);
  if (k === "mana") return "lands";
  if (k === "works") return c.commander ? (c.tapped ? "tapped" : "ready") : "works";
  return c.tapped ? "tapped" : "ready";
}

/** While choosing, what the decision offers comes first (stable otherwise): page 1 holds it. */
const offeredFirst = (xs: readonly SheetUnit[], ctx: SheetCtx): SheetUnit[] =>
  ctx.choosing ? [...xs.filter((x) => x.offered), ...xs.filter((x) => !x.offered)] : [...xs];

/**
 * A seat's spread (§2.8): every permanent, its tiers each under a caption, in the order the seat's leaf shows them
 * (`rank`: front row first, then across; the rest by arrival). Identical cards are one stack with its count; unlike cards
 * are never fanned, so a spread hides nothing. An Aura or Equipment stands right after what it is on. While choosing,
 * an offered card stands alone and first in its tier.
 */
export function spreadUnits(cards: readonly ArrCard[], rank: (id: CardId) => number, ctx: SheetCtx): SheetUnit[] {
  const by = new Map(cards.map((c) => [c.id, c]));
  const dressing = dressingOf(cards), dressed = new Set([...dressing.values()].flat());
  const order = (a: CardId, b: CardId): number => rank(a) - rank(b) || a - b;
  const out: SheetUnit[] = [];
  for (const tier of SPREAD_TIERS) {
    const hosts = cards.filter((c) => !dressed.has(c.id) && spreadTier(c) === tier).map((c) => c.id).sort(order);
    const units: SheetUnit[] = [];
    const stacks = new Map<string, CardId[]>();
    for (const id of hosts) {
      const c = by.get(id)!, alone = dressing.has(id) || (ctx.choosing && ctx.offered.has(id));
      const key = `${c.lookKey}|${c.tapped}`;
      const same = alone ? undefined : stacks.get(key);
      if (same) {
        same.push(id);
        continue;
      }
      const ids = [id];
      if (!alone) stacks.set(key, ids);
      units.push({ key: `c${id}`, cards: ids, tapped: c.tapped, tier, cls: rowClassOf([c]), offered: ctx.offered.has(id) });
      for (const d of dressing.get(id) ?? []) {
        const a = by.get(d)!;
        units.push({ key: `c${d}`, cards: [d], tapped: a.tapped, tier, cls: rowClassOf([a]), offered: ctx.offered.has(d) });
      }
    }
    out.push(...offeredFirst(units, ctx));
  }
  return out;
}

/** A pile (§2.8): its cards singly, in the pile's order; while choosing, what the decision offers first. */
export function pileUnits(cards: readonly ArrCard[], ctx: SheetCtx): SheetUnit[] {
  const units = cards.map((c) => ({ key: `c${c.id}`, cards: [c.id], tapped: c.tapped, tier: null, cls: rowClassOf([c]), offered: ctx.offered.has(c.id) }));
  return offeredFirst(units, ctx);
}
