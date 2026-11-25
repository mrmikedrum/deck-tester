// Relevance: what the table should answer now. A board is dealt in the order a player would describe it (the line, the
// ranks, the shelf), ranked by a rest score; then the moment asks a question, and the answer changes how cards stand
// and what the page's read says, never where they live. Pure facts: the words are narrative's (`readWords`, `tagWords`).
//
// A sliver of rules sits here: "ready" and the flier narrowing read tapped, summoning sick, Defender, Haste, Flying and
// Reach. They are said as facts and light cards; they never decide what may be chosen (the engine's options do that).
import type { TableModel } from "../model";
import { entryText, sweepHarms, sweeps } from "../model";
import type { BoardCard } from "./board";
import type { CardId, SeatId } from "./types";

// ---- scores -----------------------------------------------------------------------------------------------------------

const has = (c: BoardCard, k: string): boolean => c.keywords.some((x) => x.toLowerCase() === k);
const EVASIVE = ["flying", "menace", "trample", "unblockable", "shadow", "horsemanship"];

/** Starting weights: what a card hits for, what it holds back, a regiment's count. */
export const WEIGHTS = { evasive: 1.5, deathtouch: 2, commander: 3, wallKeyword: 1, regimentLog: 0.25 } as const;

/** How much a creature matters at rest: what it can hit for, and what it can stop. */
export function restScore(c: BoardCard): number {
  const p = Math.max(0, c.power ?? 0), t = Math.max(0, c.toughness ?? 0), dt = has(c, "deathtouch");
  const hit = p * (EVASIVE.some((k) => has(c, k)) ? WEIGHTS.evasive : 1) + (dt ? WEIGHTS.deathtouch : 0) + (has(c, "double strike") ? p : 0) + (c.commander ? WEIGHTS.commander : 0);
  const wall = t / 2 + (dt ? WEIGHTS.deathtouch : 0) + (["first strike", "reach", "indestructible"].some((k) => has(c, k)) ? WEIGHTS.wallKeyword : 0);
  return hit + wall;
}

/** A regiment counts as its best member raised by its count. */
export const regimentScore = (best: number, count: number): number => best * (1 + WEIGHTS.regimentLog * Math.log2(Math.max(1, count)));

// ---- facts a question reads -------------------------------------------------------------------------------------------

export const flies = (c: BoardCard): boolean => has(c, "flying");
const blocksFliers = (c: BoardCard): boolean => has(c, "flying") || has(c, "reach");
/** Could attack now: untapped, not summoning sick (or hasty), power above 0, no Defender. */
export const ready = (c: BoardCard): boolean =>
  c.creature && !c.tapped && (!c.sick || has(c, "haste")) && (c.power ?? 0) > 0 && !has(c, "defender");

// ---- the question -----------------------------------------------------------------------------------------------------

/**
 * What the moment asks. `rest`: nothing in particular. `threat`: what can seat X hit me with (its turn, before attackers).
 * `strike`: what can block my attack (my attack decision; `airborne` once every attacker I picked flies). `fight`: who is
 * hitting whom (attackers declared). `aim`: what can this point at (the engine's legal targets). `sweep`: what a spell on
 * the stack would take.
 */
export type Question =
  | { readonly q: "rest" }
  | { readonly q: "threat"; readonly seat: SeatId }
  | { readonly q: "strike"; readonly draft: readonly CardId[]; readonly airborne: boolean; readonly options: readonly CardId[] }
  | {
      readonly q: "fight";
      readonly attacker: SeatId;
      readonly attackers: readonly CardId[];
      readonly blocked: readonly CardId[];
      /** The defenders' creatures the engine offers as blockers. */
      readonly blockers: readonly CardId[];
    }
  | { readonly q: "aim"; readonly legal: readonly CardId[] }
  /** A spell or ability on the stack aimed at something: its targets are the question, so every read goes quiet. */
  | { readonly q: "stack" }
  | { readonly q: "sweep"; readonly reaches: readonly CardId[]; readonly caster: SeatId | null };

export const REST: Question = { q: "rest" };

/** The decision in hand, as plain facts (play's types never reach layout). */
export interface DecisionFacts {
  readonly kind: string | null;
  /** The cards the decision marks as options (the engine's refs). */
  readonly options: readonly CardId[];
  /** My attack draft's attackers. */
  readonly draft: readonly CardId[];
}

/** Forge's phases from a turn's start until attackers are declared. */
const PRE_ATTACK = /^(UNTAP|UPKEEP|DRAW|MAIN1|COMBAT_BEGIN|COMBAT_DECLARE_ATTACKERS)$/;

/** The question this moment asks, from the model and the decision in hand. One at a time, the most pressing first. */
export function questionOf(model: TableModel, d: DecisionFacts): Question {
  const me = model.viewer.perspective;
  const top = model.stack[model.stack.length - 1];
  if (top && sweepHarms(entryText(top, model), top.controller) !== null) {
    const reaches = [...model.cards.values()].filter((c) => c.zone === "battlefield" && sweeps(top, model, c)).map((c) => c.id);
    if (reaches.length) return { q: "sweep", reaches, caster: top.controller };
  }
  if (d.kind === "targets" && d.options.length) return { q: "aim", legal: d.options };
  if (top && top.targets.length) return { q: "stack" };
  if (d.kind === "attack") {
    const draft = d.draft;
    const airborne = draft.length > 0 && draft.every((id) => model.cards.get(id)?.keywords.some((k) => k.toLowerCase() === "flying"));
    return { q: "strike", draft, airborne, options: d.options };
  }
  const c = model.combat;
  if (c && c.attackers.length) {
    const attacker = model.cards.get(c.attackers[0]!.attacker)?.controller ?? model.active;
    if (attacker)
      return {
        q: "fight",
        attacker,
        attackers: c.attackers.map((a) => a.attacker),
        blocked: c.blockers.map((b) => b.attacker),
        blockers: d.kind === "block" ? d.options : [],
      };
  }
  if (model.active && model.active !== me && !c?.attackers.length && PRE_ATTACK.test(String(model.phase).toUpperCase())) return { q: "threat", seat: model.active };
  return REST;
}

/** A short key: equal questions, equal keys (the plan is kept while it is unchanged). */
export function questionKey(q: Question): string {
  switch (q.q) {
    case "rest":
      return "rest";
    case "threat":
      return `threat:${q.seat}`;
    case "strike":
      return `strike:${q.airborne ? "air" : ""}:${q.draft.join(",")}:${q.options.length}`;
    case "fight":
      return `fight:${q.attacker}:${q.attackers.join(",")}:${q.blocked.join(",")}:${q.blockers.join(",")}`;
    case "aim":
      return `aim:${q.legal.join(",")}`;
    case "stack":
      return "stack";
    case "sweep":
      return `sweep:${q.reaches.length}`;
  }
}

// ---- stance -----------------------------------------------------------------------------------------------------------

/** Forward (upright, larger, lamp-lit; on the line a half step to the page's front), at ease, or down (lying, shaded). */
export type Stance = "forward" | "ease" | "down";

/**
 * How one card on `seat` answers the question: null where it does not take part (its page is not the question's, or it
 * is not a creature where the question is about creatures). A fold answers as a fold: forward if any member is.
 */
export function stanceOf(c: BoardCard, seat: SeatId, mine: boolean, q: Question): Stance | null {
  switch (q.q) {
    case "rest":
      return null;
    case "threat":
      if (seat !== q.seat || !c.creature) return null;
      return ready(c) ? "forward" : "down";
    case "strike":
      if (!c.creature) return null;
      if (mine) return q.options.includes(c.id) || q.draft.includes(c.id) ? "forward" : "down";
      return !c.tapped && (!q.airborne || blocksFliers(c)) ? "forward" : "down";
    case "fight":
      if (!c.creature) return null;
      if (seat === q.attacker) return q.attackers.includes(c.id) ? null : "down";
      return q.blockers.includes(c.id) ? "forward" : q.blockers.length ? "down" : null;
    case "aim":
      return q.legal.includes(c.id) ? "forward" : null;
    case "stack":
      return null;
    case "sweep":
      return q.reaches.includes(c.id) ? "forward" : null;
  }
}

/** Whether a question lights only some of a board (so the rest may lie down), or nobody: most of the table legal. */
export function aimWide(q: Question, total: number): boolean {
  return q.q === "aim" && q.legal.length > total * 0.6;
}

// ---- reads and tags: facts for narrative's words ----------------------------------------------------------------------

export interface Body {
  readonly power: number;
  readonly toughness: number;
  readonly deathtouch: boolean;
}

const bodyOf = (c: BoardCard): Body => ({ power: c.power ?? 0, toughness: c.toughness ?? 0, deathtouch: has(c, "deathtouch") });
const bigger = (a: BoardCard, b: BoardCard): number => (b.power ?? 0) - (a.power ?? 0) || (b.toughness ?? 0) - (a.toughness ?? 0) || a.id - b.id;
export const biggestOf = (cs: readonly BoardCard[]): Body | null => {
  const b = [...cs].sort(bigger)[0];
  return b ? bodyOf(b) : null;
};
const powerOf = (cs: readonly BoardCard[]): number => cs.reduce((t, c) => t + Math.max(0, c.power ?? 0), 0);
const COMBAT_KEYWORDS = ["flying", "deathtouch", "lifelink", "trample", "menace", "first strike", "double strike", "indestructible", "hexproof", "reach"];
const keywordsIn = (cs: readonly BoardCard[]): string[] => COMBAT_KEYWORDS.filter((k) => k !== "flying" && cs.some((c) => has(c, k)));

/** What a page's read says, as facts. Null: the page says nothing (light already says it, or there is nothing to sum). */
export type ReadFacts =
  | {
      readonly q: "rest";
      readonly power: number;
      readonly creatures: number;
      readonly flyingPower: number;
      readonly biggest: Body | null;
      readonly keywords: readonly string[];
    }
  | { readonly q: "threat"; readonly power: number; readonly creatures: number; readonly flyingPower: number; readonly keywords: readonly string[] }
  | { readonly q: "strike"; readonly untapped: number; readonly biggest: Body | null; readonly fliers: number; readonly airborne: boolean; readonly fliersBiggest: Body | null }
  | { readonly q: "tally"; readonly power: number; readonly air: number }
  | {
      readonly q: "fight";
      readonly power: number;
      readonly creatures: number;
      /** -1 before blocks; else how many attackers nobody blocked, and their power. */
      readonly unblocked: number;
      readonly unblockedPower: number;
      readonly who: Body | null;
      readonly whoName: string | null;
      readonly target: "you" | string;
    }
  | { readonly q: "sweep"; readonly loses: number; readonly power: number; readonly mine: boolean };

/**
 * The read of one seat's board under a question. `folded`: the page holds a fold (a regiment or a tail), so the rest
 * read has something to sum. `defender`: who the attack on this page's attacker is aimed at, for a fight.
 */
export function readOf(board: readonly BoardCard[], seat: SeatId, mine: boolean, q: Question, folded: boolean, names?: { readonly defender: string | null }): ReadFacts | null {
  const cs = board.filter((c) => c.creature);
  switch (q.q) {
    case "stack":
      return null;
    case "rest":
    case "aim":
      if (q.q === "aim" || (!folded && cs.length < 6) || !cs.length) return null;
      return { q: "rest", power: powerOf(cs), creatures: cs.length, flyingPower: powerOf(cs.filter(flies)), biggest: biggestOf(cs), keywords: keywordsIn(cs) };
    case "threat": {
      if (seat !== q.seat || !cs.length) return null;
      const r = cs.filter(ready);
      return { q: "threat", power: powerOf(r), creatures: r.length, flyingPower: powerOf(r.filter(flies)), keywords: keywordsIn(r) };
    }
    case "strike": {
      if (mine) {
        const d = cs.filter((c) => q.draft.includes(c.id));
        return d.length ? { q: "tally", power: powerOf(d), air: powerOf(d.filter(flies)) } : null;
      }
      const u = cs.filter((c) => !c.tapped), f = u.filter(blocksFliers);
      return { q: "strike", untapped: u.length, biggest: biggestOf(u), fliers: f.length, airborne: q.airborne, fliersBiggest: biggestOf(f) };
    }
    case "fight": {
      if (seat !== q.attacker) return null;
      const at = cs.filter((c) => q.attackers.includes(c.id));
      const free = at.filter((c) => !q.blocked.includes(c.id));
      const lone = free.length === 1 ? free[0]! : null;
      return { q: "fight", power: powerOf(at), creatures: at.length, unblocked: q.blocked.length ? free.length : -1, unblockedPower: powerOf(free), who: lone ? bodyOf(lone) : null, whoName: lone ? lone.name : null, target: names?.defender ?? "you" };
    }
    case "sweep": {
      const hit = cs.filter((c) => q.reaches.includes(c.id));
      return hit.length ? { q: "sweep", loses: hit.length, power: powerOf(hit), mine } : null;
    }
  }
}

/** What a fold's tag says, as facts. */
export type TagFacts =
  | { readonly t: "regiment"; readonly name: string; readonly body: Body; readonly count: number; readonly answer: { readonly n: number; readonly word: AnswerWord } | null }
  | {
      readonly t: "tail";
      readonly count: number;
      readonly power: number;
      readonly biggest: Body | null;
      readonly fliers: number;
      readonly small: boolean;
      readonly answer: { readonly n: number; readonly word: AnswerWord; readonly biggest: Body | null } | null;
    }
  /** A column says what leads it, then how many more: "2 walkers · 6 more", "Binds everyone 8 · 1 more", "Engines 5". */
  | { readonly t: "column"; readonly lead: "walkers" | "binds" | "engines"; readonly leading: number; readonly more: number };

export type AnswerWord = "ready" | "untapped" | "flying" | "legal";

const answerWord = (q: Question): AnswerWord | null =>
  q.q === "threat" ? "ready" : q.q === "strike" ? (q.airborne ? "flying" : "untapped") : q.q === "aim" ? "legal" : null;

/** A fold's tag facts: its members, the stance each takes under the question. */
export function tagOf(t: "regiment" | "tail", members: readonly BoardCard[], q: Question, answered: (c: BoardCard) => boolean): TagFacts {
  const word = answerWord(q), yes = members.filter(answered);
  if (t === "regiment") {
    const rep = members.find((c) => !c.tapped) ?? members[0]!;
    return { t, name: rep.name, body: bodyOf(rep), count: members.length, answer: word && q.q !== "rest" ? { n: yes.length, word } : null };
  }
  const small = members.every((c) => (c.power ?? 0) <= 2 && !COMBAT_KEYWORDS.some((k) => has(c, k)));
  return {
    t,
    count: members.length,
    power: powerOf(members),
    biggest: biggestOf(members),
    fliers: members.filter(flies).length,
    small,
    answer: word && q.q !== "rest" ? { n: yes.length, word, biggest: biggestOf(yes) } : null,
  };
}
