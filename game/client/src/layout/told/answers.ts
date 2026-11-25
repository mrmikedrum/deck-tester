import { shortCard } from "../../model";
import type { BoardCard, SeatBoard } from "../board";
import type { CombatPairs } from "../combat";
import type { CardId, SeatId } from "../types";

// Answers: the words a moment puts in red ink, only while it puts a question to me (spec "Told, not shown", section 5).
// The same licence as the account: count, add, take the largest and filter by the engine's facts. It never works out a
// fight: about an opponent's blockers it says what a player would check ("no fliers or reach", "9 fly"), and "can
// block" only where the engine said it (the legal pairs of my own block decision).

/** What the moment asks, as plain ids (layout never imports play): the decision on screen, or a sweep on the stack. */
export type Ask =
  /** I declare attackers: the seats I may attack. My picks so far are the combat draft. */
  | { readonly kind: "attack"; readonly defenders: readonly SeatId[] }
  /** I declare blockers: the engine's legal pairs. My picks so far are the combat draft. */
  | { readonly kind: "block"; readonly pairs: readonly { readonly blocker: CardId; readonly attacker: CardId }[] }
  /** A sweep on the stack: the permanents it would take. */
  | { readonly kind: "sweep"; readonly hits: readonly CardId[] };

/** A slip of red: what it says (two lines at most, three clauses a line) and the cards it speaks of. */
export interface SlipWords {
  readonly seat: SeatId;
  readonly lines: readonly string[];
  readonly ids: readonly CardId[];
  /** It answers what I am doing to this seat now (my picks aim at it; a sweep): worth the prompt's words if the table
   *  has no room for it. */
  readonly aimed?: boolean;
}

/** Where an attack lands on a defender: the power arriving unblocked, and whether a blocked attacker tramples. */
export interface LandingWords {
  readonly seat: SeatId;
  readonly power: number;
  readonly trample: boolean;
  readonly text: string;
  readonly ids: readonly CardId[];
}

/** A note at an attacker's foot while I block: "no block · flies", "only Meloku". */
export interface NoteWords {
  readonly attacker: CardId;
  readonly text: string;
}

const has = (c: BoardCard, k: string): boolean => c.keywords.includes(k);
const flies = (c: BoardCard): boolean => has(c, "Flying");
const blocksFliers = (c: BoardCard): boolean => has(c, "Flying") || has(c, "Reach");
const size = (c: BoardCard): string => (c.power !== null && c.toughness !== null ? `${c.power}/${c.toughness}` : "");
const lines = (clauses: readonly string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < clauses.length && out.length < 2; i += 3) out.push(clauses.slice(i, i + 3).join(" · "));
  return out;
};

/** Deathtouch and first strike among `cs`, by name where one card holds it ("Atraxa 8/8 deathtouch"), else counted. */
function sharp(cs: readonly BoardCard[], sized: boolean): string[] {
  const out: string[] = [];
  for (const [k, word] of [["Deathtouch", "deathtouch"], ["First strike", "first strike"], ["Double strike", "double strike"]] as const) {
    const hs = cs.filter((c) => has(c, k));
    if (hs.length === 1) out.push(`${shortCard(hs[0]!.name)}${sized ? " " + size(hs[0]!) : ""} ${word}`);
    else if (hs.length > 1) out.push(`${hs.length} ${word}`);
  }
  return out;
}

/** The creature biggest by toughness, then power. */
const biggest = (cs: readonly BoardCard[]): BoardCard | undefined =>
  [...cs].sort((a, b) => (b.toughness ?? 0) - (a.toughness ?? 0) || (b.power ?? 0) - (a.power ?? 0) || a.id - b.id)[0];

/**
 * A defender's slip while I declare attackers: its untapped creatures; those with flying or reach; deathtouch or first
 * strike, else the biggest. Narrowed to what my picks at it ask: where every pick flies, only the fly clause.
 */
export function attackSlip(board: SeatBoard, picks: readonly BoardCard[]): SlipWords {
  const ready = board.cards.filter((c) => c.creature && !c.tapped);
  const air = ready.filter(blocksFliers);
  if (picks.length && picks.every(flies)) {
    if (!air.length) return { seat: board.seat, lines: ["No fliers or reach"], ids: [] };
    return { seat: board.seat, lines: lines([`${air.length} fly`, ...sharp(air, true)]), ids: air.map((c) => c.id) };
  }
  const sharpOnes = sharp(ready, false);
  const big = biggest(ready);
  const clauses = [
    `${ready.length} untapped`,
    air.length ? `${air.length} fly` : "no fliers or reach",
    ...(sharpOnes.length ? sharpOnes.slice(0, 1) : big ? [`biggest ${size(big)}`] : []),
  ];
  return { seat: board.seat, lines: lines(clauses), ids: ready.map((c) => c.id) };
}

/** A sweep's slip on a page it hits: "Loses 13 creatures" (or permanents, where it takes more than creatures). */
export function sweepSlip(board: SeatBoard, hits: ReadonlySet<CardId>): SlipWords | null {
  const lost = board.cards.filter((c) => hits.has(c.id));
  if (!lost.length) return null;
  const all = lost.every((c) => c.creature);
  const n = lost.length, word = all ? (n === 1 ? "creature" : "creatures") : n === 1 ? "permanent" : "permanents";
  return { seat: board.seat, lines: [`Loses ${n} ${word}`], ids: lost.map((c) => c.id) };
}

/** Every defender's landing: the power of its unblocked attackers; trample named, never worked out. */
export function landings(boards: readonly SeatBoard[], combat: CombatPairs | null): LandingWords[] {
  if (!combat?.attacks.length) return [];
  const card = new Map(boards.flatMap((b) => b.cards.map((c) => [c.id, c] as const)));
  const blocked = new Set(combat.blocks.map((b) => b.attacker));
  const by = new Map<SeatId, CardId[]>();
  for (const a of combat.attacks) if ("seat" in a.defender) by.set(a.defender.seat, [...(by.get(a.defender.seat) ?? []), a.attacker]);
  return [...by.entries()].map(([seat, ids]) => {
    const open = ids.filter((id) => !blocked.has(id)), power = open.reduce((t, id) => t + Math.max(0, card.get(id)?.power ?? 0), 0);
    const trample = ids.some((id) => blocked.has(id) && card.get(id)?.keywords.includes("Trample"));
    return { seat, power, trample, text: trample ? `${power} + trample` : String(power), ids: open };
  });
}

/** While I block: a note under each attacker no legal pair can stop ("no block", "· flies" where it flies), or one only
 *  one of mine can ("only Meloku"). Where several can, the lit creatures already say so. */
export function blockNotes(boards: readonly SeatBoard[], combat: CombatPairs | null, pairs: Extract<Ask, { kind: "block" }>["pairs"]): NoteWords[] {
  const card = new Map(boards.flatMap((b) => b.cards.map((c) => [c.id, c] as const)));
  const out: NoteWords[] = [];
  for (const a of combat?.attacks ?? []) {
    const can = [...new Set(pairs.filter((p) => p.attacker === a.attacker).map((p) => p.blocker))];
    const c = card.get(a.attacker);
    if (!can.length) out.push({ attacker: a.attacker, text: c && flies(c) ? "no block · flies" : "no block" });
    else if (can.length === 1) {
      const b = card.get(can[0]!);
      if (b) out.push({ attacker: a.attacker, text: `only ${shortCard(b.name)}` });
    }
  }
  return out;
}

/** Every slip this ask puts on the table, one per seat at most (never mine: my sums are the prompt's). */
export function slipsOf(boards: readonly SeatBoard[], ask: Ask | null, combat: CombatPairs | null, me: SeatId): SlipWords[] {
  if (!ask) return [];
  const card = new Map(boards.flatMap((b) => b.cards.map((c) => [c.id, c] as const)));
  if (ask.kind === "attack")
    return boards
      .filter((b) => b.seat !== me && ask.defenders.includes(b.seat))
      .map((b) => {
        const picks = (combat?.attacks ?? []).filter((a) => "seat" in a.defender && a.defender.seat === b.seat).flatMap((a) => card.get(a.attacker) ?? []);
        return { ...attackSlip(b, picks), aimed: picks.length > 0 };
      });
  if (ask.kind === "sweep") {
    const hits = new Set(ask.hits);
    return boards.filter((b) => b.seat !== me).flatMap((b) => {
      const s = sweepSlip(b, hits);
      return s ? [{ ...s, aimed: true }] : [];
    });
  }
  return [];
}
