// What a leaf's slip says (focus-first): at most two lines of ink about one opponent's board. Line 1 is the force once
// anything is folded ("33 creatures · 92 power · 7 tapped"); line 2 is the one thing worth saying now, chosen by what I
// am doing. Every figure is a count of facts the engine sent (power, tapped, keywords); none of it decides what is legal.
// Pure.
import { entryText, isCreature, sweepHarms, sweeps } from "../model";
import type { Card, SeatId, TableModel } from "../model";

/** What I am doing, which chooses line 2: at rest; choosing my attackers (their defence); their turn before combat. */
export type ReadingContext = "rest" | "attackers" | "offence";

export interface SlipLine {
  readonly text: string;
  /** Line 1 is ink; line 2 italic; a sweep's count red. */
  readonly tone: "ink" | "italic" | "red";
}

const has = (c: Card, k: string): boolean => c.keywords.some((x) => x.toLowerCase() === k);
const power = (cs: readonly Card[]): number => cs.reduce((t, c) => t + Math.max(0, c.power ?? 0), 0);
/** The keywords worth naming on line 2, in the engine's order. */
const ORDER = ["flying", "reach", "trample", "vigilance", "deathtouch", "lifelink", "first strike", "double strike", "menace", "hexproof", "indestructible"];
const NAMED = new Set(ORDER);
const BEFORE_COMBAT = new Set(["UNTAP", "UPKEEP", "DRAW", "MAIN1", "COMBAT_BEGIN"]);

/** A seat's creatures on the battlefield. */
function creaturesOf(model: TableModel, seat: SeatId): Card[] {
  return model.zone(seat, "battlefield").map((id) => model.cards.get(id)).filter((c): c is Card => !!c && isCreature(c));
}

/** Line 1, the force: `N creatures · P power`, `· T tapped` when any are, `· F fliers (their power)` when any fly. */
export function forceLine(cs: readonly Card[]): string {
  if (!cs.length) return "no creatures";
  const tapped = cs.filter((c) => c.tapped).length, fliers = cs.filter((c) => has(c, "flying"));
  return [
    `${cs.length} creature${cs.length > 1 ? "s" : ""}`,
    `${power(cs)} power`,
    ...(tapped ? [`${tapped} tapped`] : []),
    ...(fliers.length ? [`${fliers.length} flier${fliers.length > 1 ? "s" : ""} (${power(fliers)})`] : []),
  ].join(" · ");
}

/** The heaviest creature (power, doubled by a keyword that changes combat; the commander, then the older, on a tie). */
function heaviest(cs: readonly Card[]): Card | undefined {
  const w = (c: Card) => Math.max(0, c.power ?? 0) * (c.keywords.some((k) => NAMED.has(k.toLowerCase()) && k.toLowerCase() !== "vigilance") ? 2 : 1);
  return cs.slice().sort((a, b) => w(b) - w(a) || Number(b.commander) - Number(a.commander) || a.id - b.id)[0];
}

/**
 * A seat's slip: line 1 once its leaf folds anything (`folded`), or when it has no creatures left on a board that had
 * grown (`developed`); line 2 by `context`. Empty when there is nothing to say.
 */
export function seatReading(model: TableModel, seat: SeatId, folded: boolean, context: ReadingContext): SlipLine[] {
  const cs = creaturesOf(model, seat);
  const developed = model.zone(seat, "battlefield").length >= 12;
  const out: SlipLine[] = [];
  if (folded || (developed && !cs.length)) out.push({ text: forceLine(cs), tone: "ink" });

  // A sweep on the stack: what it takes from them.
  const sweep = [...model.stack].reverse().find((it) => sweepHarms(entryText(it, model), it.controller) !== null);
  if (sweep) {
    const n = cs.filter((c) => sweeps(sweep, model, c)).length;
    const name = (sweep.source !== null ? model.cards.get(sweep.source)?.face.name : null) ?? "The sweep";
    if (n) out.push({ text: `${name}: ${n}`, tone: "red" });
    return out;
  }
  const ready = cs.filter((c) => !c.tapped);
  if (context === "attackers" && cs.length) {
    // Their defence: what can block, and what in the air.
    const fly = ready.filter((c) => has(c, "flying") || has(c, "reach")).length;
    const dt = heaviest(ready.filter((c) => has(c, "deathtouch")));
    const air = fly ? `${fly} fly` : cs.some((c) => has(c, "flying") || has(c, "reach")) ? "fliers tapped" : "no flying, no reach";
    out.push({ text: [`${ready.length} untapped`, air, ...(dt ? [`deathtouch on ${dt.face.name.split(",")[0]}`] : [])].join(" · "), tone: "italic" });
    return out;
  }
  if (context === "offence" && model.active === seat && BEFORE_COMBAT.has(model.phase) && ready.length) {
    const fliers = ready.filter((c) => has(c, "flying"));
    out.push({ text: `${power(ready)} power untapped · ${fliers.length ? `${power(fliers)} flying` : "none flying"}`, tone: "italic" });
    return out;
  }
  // At rest: what is exceptional. The biggest threat with the keywords that make it so, or the absence that matters.
  const top = heaviest(cs);
  const kws = top ? top.keywords.filter((k) => NAMED.has(k.toLowerCase())).map((k) => k.toLowerCase()).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)) : [];
  if (top && kws.length >= 2) out.push({ text: `${top.face.name.split(",")[0]} ${top.power ?? 0}/${top.toughness ?? 0}: ${kws.join(", ")}`, tone: "italic" });
  else if (cs.length >= 5 && !cs.some((c) => has(c, "flying") || has(c, "reach"))) out.push({ text: "no flying, no reach", tone: "italic" });
  return out;
}

/** The context line 2 is chosen by, from the decision up and whose turn it is. */
export function readingContext(model: TableModel, decisionKind: string | null): ReadingContext {
  if (decisionKind === "attack") return "attackers";
  if (model.active !== null && model.active !== model.viewer.perspective) return "offence";
  return "rest";
}
