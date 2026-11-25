// How the old client read spells, abilities and log lines: what a sweep reaches, what counters, what threatens the
// viewer, what a log line says happened. Each is the old expression, named; they shape how things look and read, never
// what is legal. The card-specific ones (Sunfall, the Elemental maker, Arcane Denial's wording, Swords' wording) are
// the old hard-codes, kept as they were tuned; delta/moments.ts turns them into moment rows.
import type { CardId, LogEntry } from "../protocol";
import type { Card } from "./card";
import type { SeatId } from "./ids";
import type { Role } from "./predicates";
import { roleOf } from "./predicates";
import type { StackItem, TableModel } from "./table";

// ---- Log lines (live.js) -----------------------------------------------------------------------------------------

/** live.js `logText`: a log line without Forge's bracketed annotations and "(id)" suffixes. */
export const logText = (t: string): string =>
  t
    .replace(/ \[(Card|Zone Changer|Activator):[^\]]*\]/g, "")
    .replace(/ \(\d+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** live.js `logKey`: an entry's identity across snapshots. */
export const logKey = (e: LogEntry): string => `${e.i}|${e.text}`;

/** The cards a log entry names: its `card`, and every "(id)" in its text (Forge writes "Hill Giant (853)"). */
export function logCards(e: LogEntry): CardId[] {
  const ids = new Set<number>();
  if (e.card !== null) ids.add(e.card);
  for (const m of e.text.matchAll(/\((\d+)\)/g)) ids.add(Number(m[1]));
  return [...ids] as CardId[];
}

/** live.js `PHASE`: the phase as the prompt and the log say it. */
const PHASE: Readonly<Record<string, string>> = {
  UNTAP: "Untap",
  UPKEEP: "Upkeep",
  DRAW: "Draw",
  MAIN1: "Main phase",
  COMBAT_BEGIN: "Combat",
  COMBAT_DECLARE_ATTACKERS: "Attackers",
  COMBAT_DECLARE_BLOCKERS: "Blockers",
  COMBAT_FIRST_STRIKE_DAMAGE: "First strike",
  COMBAT_DAMAGE: "Damage",
  COMBAT_END: "End of combat",
  MAIN2: "Second main",
  END_OF_TURN: "End step",
  CLEANUP: "Cleanup",
  setup: "Setup",
};
export const phaseName = (phase: string): string => PHASE[phase] ?? phase;

/** live.js `take`: `/^COMBAT_(FIRST_STRIKE_)?DAMAGE$/`, combat damage is being dealt. */
export const isDamagePhase = (phase: string): boolean => /^COMBAT_(FIRST_STRIKE_)?DAMAGE$/.test(phase);

/** live.js `take`: a log line saying a spell was countered. */
export const saysCountered = (text: string): boolean => /\bwas countered\b/i.test(logText(text));

/** live.js `drawReports`: how many cards a line says `player` drew, or null. */
export function drewCards(text: string, player: string): number | null {
  const t = logText(text);
  const who = [player, "You"].find((name) => t.startsWith(name + " "));
  const count = who ? t.slice(who.length + 1).match(/^drew (a|\d+) cards?\.?$/i)?.[1] : undefined;
  return count === undefined ? null : count.toLowerCase() === "a" ? 1 : Number(count);
}

/**
 * live.js `departureInLog` and `sunfallResult`: how a log entry says a stack item left. A STACK_RESOLVE entry for its
 * card resolved it (or says it fizzled or was countered); "<name> was countered" countered it. Null: the entry says
 * nothing about it.
 */
export function departureIn(
  e: LogEntry,
  item: { readonly source: CardId | null; readonly spell: boolean },
  name: string,
): "resolved" | "countered" | "fizzled" | null {
  const text = logText(e.text).replace(/\.$/, "");
  if (e.card !== null && e.card !== item.source) return null;
  if (item.spell && text === `${name} was countered`) return "countered";
  if (e.card !== null && /^STACK_RESOLVE$/i.test(e.type)) {
    if (/fizzl/i.test(e.text)) return "fizzled";
    if (/countered/i.test(e.text)) return "countered";
    return "resolved";
  }
  return null;
}

// ---- Spell and ability text ----------------------------------------------------------------------------------------

/** live.js `abilityText`: the engine's words for an ability without its card's name in front ("<card> - "). */
export function abilityText(text: string, name: string): string {
  const t = text.trim(),
    prefix = `${name} - `;
  return t.startsWith(prefix) ? t.slice(prefix.length) : t;
}

/** h.js `entryText`: an item's own text, and a spell's rules text too (not a face-down card's). */
export function entryText(item: StackItem, model: TableModel): string {
  const c = item.source === null ? undefined : model.cards.get(item.source);
  return item.text + " " + ((item.spell && c && !c.faceDown && c.face.text) || "");
}

const reach =
  (sweep: RegExpExecArray) =>
  (role: Role): boolean =>
    sweep[1] ? role === "creature" : role !== "mana" || !/nonland/i.test(sweep[0]);

/**
 * h.js `sweepHits`: whether text sweeps ("Exile all creatures", "Destroy each nonland permanent"), as the roles it
 * reaches; null when it sweeps nothing. A sweep's reach stays lit and uncovered while it is on the stack.
 */
export function sweepHits(text: string): ((role: Role) => boolean) | null {
  const sweep = /\b(?:all|each)\s+(?:other\s+)?(?:(creatures?)|(?:nonland\s+)?(permanents?))\b/i.exec(text);
  return sweep ? reach(sweep) : null;
}

/**
 * h.js `sweepHarms`: whether text harms what it sweeps ("Exile all creatures", "deals 2 damage to each creature",
 * "All creatures get -3/-3") and whose ("you control", "your opponents control"), as (role, seat) -> harmed; null when
 * it harms nothing ("each creature you control gets +1/+1" counts or helps). `controller` is the item's.
 */
export function sweepHarms(text: string, controller: SeatId | null): ((role: Role, seat: SeatId) => boolean) | null {
  const sweep =
    /\b(?:destroy|exile|return|deals?\s+\S+\s+damage\s+to)\s+(?:all|each)\s+(?:other\s+)?(?:(creatures?)|(?:nonland\s+)?(permanents?))([^.;]*)/i.exec(
      text,
    ) || /\b(?:all|each)\s+(?:other\s+)?(?:(creatures?)|(?:nonland\s+)?(permanents?))([^.;]*?)\s+gets?\s+-\d+\/-\d+/i.exec(text);
  if (!sweep) return null;
  const tail = sweep[3] ?? "";
  const mine = /\byou control\b/i.test(tail) && !/\b(?:don't|do not)\b/i.test(tail);
  const theirs = /\b(?:opponents? controls?|you (?:don't|do not) control)\b/i.test(tail);
  const hit = reach(sweep);
  return (role, seat) => hit(role) && (theirs ? seat !== controller : mine ? seat === controller : true);
}

/** Whether a card is harmed by a stack item that sweeps (h.js `swept` for one item and one card). */
export function sweeps(item: StackItem, model: TableModel, card: Card): boolean {
  const harm = sweepHarms(entryText(item, model), item.controller);
  return !!harm && harm(roleOf(card), card.controller);
}

/** live.js `creatureSweep`: the one sweep the old prompt turned red for and narrated, by name. */
export const isCreatureSweep = (item: StackItem, model: TableModel): boolean =>
  item.spell && item.source !== null && model.cards.get(item.source)?.name === "Sunfall";

/** live.js `counterResult` and `stackSummary`: rules text that counters a target spell. */
export const isCounterspell = (text: string): boolean => /^Counter target spell\./i.test(text);

/** live.js `denialPreview`: Arcane Denial's exact wording, which the old stack summary shortened. */
export const isArcaneDenial = (text: string): boolean =>
  /^Counter target spell\.\s+Its controller may draw up to two cards at the beginning of the next turn['’]s upkeep\.\s+You draw a card at the beginning of the next turn['’]s upkeep\.$/i.test(
    text.trim(),
  );

/** live.js `stackSummary`: Swords to Plowshares' wording, which the old summary named its target in. */
export const isExileTargetCreature = (text: string): boolean =>
  /^Exile target creature\. Its controller gains life equal to its power\./i.test(text);

/** live.js `tokenResult`: an ability that makes an Elemental token (Marath's third mode). */
export const makesElemental = (text: string): boolean => /create an? (?:X|\d+)\/(?:X|\d+) (?:green )?Elemental/i.test(text);

/** live.js `tokenResult`: the log line for the Elemental and the Beasts made with it; the Beasts' words, or null. */
export function elementalCreation(text: string): string | null {
  return logText(text).match(/ created an? (?:\d+\/\d+ )?Elemental and (\w+ Beasts?)\.?$/i)?.[1] ?? null;
}

/** live.js `effectPreview`: Felidar Retreat's landfall trigger, whose mode the log does not record. */
export const isLandfallModes = (text: string, rules: string): boolean =>
  /^Landfall\.?$/i.test(text) &&
  /Create a 2\/2 white Cat(?: Beast)? creature token/.test(rules) &&
  /Put a \+1\/\+1 counter on each creature/.test(rules);

/** live.js `effectPreview`: an enters-the-battlefield draw, which the old summary shortened to "On entry, draw...". */
export const entersDraw = (text: string): string | null => text.match(/When (?:this creature|[^.]+) enters, draw [^.]+\./i)?.[0] ?? null;

/** live.js `effectPreview`: Sunfall's wording (exile all creatures, incubate X). */
export const isIncubateSweep = (text: string): boolean => /^Exile all creatures\. Incubate X\b/i.test(text);

// ---- Threats (live.js `aimedAtMe`, `threat`) ----------------------------------------------------------------------

/** live.js `aimedAtMe`: the targets of an item that are `seat` or a card `seat` controls. */
export function aimedAt(item: StackItem, model: TableModel, seat: SeatId): StackItem["targets"] {
  return item.targets.filter((t) => ("seat" in t ? t.seat === seat : model.cards.get(t.card)?.controller === seat));
}

/**
 * live.js `threat` for any item: someone else's spell or ability aimed at the perspective seat or its cards. The old
 * client held auto-pass and turned the prompt red for the top item that threatens.
 */
export const threatens = (item: StackItem, model: TableModel): boolean =>
  item.controller !== null && // live.js `apply` read an unnamed controller as the viewer's own
  item.controller !== model.viewer.perspective && aimedAt(item, model, model.viewer.perspective).length > 0;

/** The top of the stack (the model's stack is bottom first). */
export const topOf = (model: TableModel): StackItem | undefined => model.stack[model.stack.length - 1];

/** live.js `status`: the prompt's red reading while the stack is open: the top threatens, or is the creature sweep. */
export function alarming(model: TableModel): boolean {
  const top = topOf(model);
  return !!top && (threatens(top, model) || isCreatureSweep(top, model));
}
