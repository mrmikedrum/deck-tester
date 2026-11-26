// The prompt's words, ported from live.js: where we are, Forge's prompts said plainly (`promptText`), what a choice is
// about (`context`), what each item on the stack will do (`stackRows`), and how a play is labelled in a sheet
// (`playLabel`), in the inspector (`actionLabel`) and what it costs (`costOf`). Presentation only: none of it decides
// what may be answered.
import type { Decision, StackId } from "../protocol";
import type { SeatId, Target } from "../model";
import { abilityTargetNames, phaseName, stackValues } from "../model";
import type { Facts, ItemFact } from "./facts";
import { cardOf, seatName, topItem } from "./facts";

export { phaseName };

const listNames = (names: readonly string[]): string => new Intl.ListFormat("en").format(names);

export const whoName = (f: Facts, seat: SeatId | null): string =>
  seat === f.me ? "Your" : seat === null ? "" : `${seatName(f, seat)}'s`;

/** "Turn 9 · Your second main", "Turn 9 · Marath's turn" (blocks: the headline says "Declare blockers"). */
export function where(f: Facts): string {
  const p = phaseName(f.phase);
  const blockers = p === "Blockers";
  const phase = blockers ? "" : " " + p.toLowerCase();
  const whose = blockers ? `${whoName(f, f.active)} turn` : whoName(f, f.active);
  return `Turn ${f.turn} · ${whose}${phase}`;
}

/** An item on the stack in one line, in game terms: "Dack's Swords to Plowshares targets your Meloku" (aimed at me or
 * mine), "Dack casts Swords to Plowshares", "Dack's Marath ability". */
export function itemLine(f: Facts, st: ItemFact): string {
  const name = shortCard(cardOf(f, st.source)?.display ?? "");
  const who = st.controller === f.me ? "You" : seatName(f, st.controller);
  const names = itemTargets(f, st);
  const subject = st.spell ? name : `${name} ability`;
  const line = names.length
    ? `${st.controller === f.me ? subject : `${whoName(f, st.controller)} ${subject}`} targets ${listNames(names)}`
    : st.spell ? `${who} ${st.controller === f.me ? "cast" : "casts"} ${name}` : `${whoName(f, st.controller)} ${subject}`;
  return [line, ...stackValues(st)].join(" · ");
}

export const lists = listNames;

/** live.js `shortCard`: "Meloku the Clouded Mirror" -> "Meloku". */
export const shortCard = (n: string): string => n.split(", ")[0]!.replace(/^(\S{3,}) (?:of )?the .+$/, "$1");

/** live.js `abilityText`: an ability's text without its "<card> - " prefix, shortened unless `full`. */
export function abilityText(t: string, name: string, full = false): string {
  const text = t.trim(), prefix = name + " - ";
  const x = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  return x.length > 90 && !full ? x.slice(0, 88) + "…" : x;
}

/** live.js `cardName`: a choice label without its parenthesised, stat and bracketed tails. */
export const cardName = (label: string): string =>
  label
    .replace(/ \((?:[^()]*)\)$/, "")
    .replace(/ \d+\/\d+$/, "")
    .replace(/ \[[^\]]*\]$/, "")
    .replace(/ \d+\/\d+$/, "");

const sourceOf = (d: Decision): string | null => d.prompt.match(/\(([^()]+)\)\s*$/)?.[1] ?? null;

/** live.js `promptText`. */
export function promptText(d: Decision, f: Facts): string {
  const pr = d.prompt.trim(), src = sourceOf(d);
  const p = pr.replace(/\s*\([^()]*\)\s*$/, "").replace(/^\w/, (ch) => ch.toUpperCase());
  if (d.kind === "pay") {
    const m = pr.match(/mana to pay (.+?) for (.+?), in order/);
    return m ? `Pay ${m[1]!.trim()} for ${m[2]!}` : p;
  }
  if (/its owner may put it into the command zone/.test(pr)) return `Move ${src || "your commander"} to the command zone?`;
  const legend = pr.match(/multiple legendary permanents named "(.+?)"/);
  if (legend) return `Legend rule: which ${legend[1]!} stays?`;
  if (d.kind === "targets") {
    const top = topItem(f);
    const spell = src || (top && top.controller === f.me ? (cardOf(f, top.source)?.display ?? null) : null);
    const of = spell ? ` for ${spell}` : "";
    return (d.max > 1 ? (d.min === d.max ? `${d.max} targets` : `Up to ${d.max} targets`) : "Target") + of;
  }
  if (/^Choose a card$/i.test(p) && src) return `${src}: choose a card`;
  if (/^use /.test(pr)) return `Use ${src || "this"}?`;
  if (/^Select cards to (\w+)/i.test(p)) return p.replace(/^Select cards/i, "Choose cards");
  return p + (src && !p.includes(src) ? ` (${src})` : "");
}

/** live.js `context`: the spell or ability on top of the stack, or the source card's text. */
export function context(d: Decision, f: Facts): string {
  if (["play", "attack", "block", "mulligan"].includes(d.kind)) return "";
  if (/command zone/.test(d.prompt)) return "";
  if (/^target for /.test(d.prompt)) return d.prompt.replace(/^target for /, "");
  if (/^use /.test(d.prompt)) return d.prompt.replace(/^use [^:]+:\s*/, "");
  // (What the stack's top says is on screen: the card itself, held up as the focus.)
  const src = sourceOf(d);
  const t = src ? (Object.values(f.cards).find((c) => c.name === src)?.text ?? "") : "";
  return t ? `${src}: ${t.length > 140 ? t.slice(0, 138) + "…" : t}` : "";
}

const FORMER_ZONES: Readonly<Record<string, string>> = { graveyard: "the graveyard", exile: "exile" };

/** live.js `playLabel`: every play names its card ("Play Island", "Cast Frantic Search (Flashback)"). */
export function playLabel(label: string): string {
  if (/^[^:]+: (.*)$/.test(label)) return label;
  const from = label.match(/^(.*) \(from (graveyard|exile)\)$/);
  if (from) return `Cast ${from[1]!} from ${FORMER_ZONES[from[2]!]!}`;
  const name = label.replace(/\s*\((\w+)\)$/, "");
  if (/\(land\)$/.test(label)) return "Play " + name;
  if (/\(commander\)$/.test(label)) return `Cast ${name} from the command zone`;
  const alt = label.match(/\((\w+)\)$/);
  return alt ? `Cast ${name} (${alt[1]!})` : "Cast " + name;
}

/** live.js `actionLabel`: under the card's own name in the inspector, just the cost and what it does, shortly. */
export function actionLabel(label: string, name: string): string {
  const m = label.match(/^[^:]+: (.*)$/);
  if (!m) return playLabel(label).replace(" " + name, "");
  const body = m[1]!, cut = body.lastIndexOf(": ");
  if (cut < 0) return body;
  let cost = body.slice(0, cut), eff = body.slice(cut + 2).replace(/\.$/, "");
  eff = eff
    .replace(/^Create (?:a|an|one) (\d+\/\d+ )?(?:[a-z]+ )*([A-Z][\w-]*)\b.*$/, "$1$2 token")
    .replace(/^Create (\w+) .*?([A-Z][\w-]*)(?: creature)? tokens.*$/, "$1 $2 tokens");
  if (eff.length > 44) eff = eff.slice(0, 42).replace(/\s+\S*$/, "") + "…";
  cost = cost.replace(/Return a land you control to its owner's hand/i, "return a land");
  return `${cost}: ${eff}`;
}

/**
 * live.js `costOf`: what a cast costs, when the option casts the card by its name; an ability's cost is in its label.
 * (The old test `ref.spell === false` read an absent flag as a spell; the decoder now defaults it to false, so the
 * label alone decides.)
 */
export function costOf(d: Decision, o: number, f: Facts): string | null {
  const label = d.options[o - 1] ?? "";
  const r = d.kind === "play" ? d.refs[o - 1] : undefined;
  if (!r || r.mana) return null;
  const c = cardOf(f, r.card);
  if (!c || (label !== c.name && ![" (commander)", " (from graveyard)", " (from exile)"].some((suffix) => label === c.name + suffix))) return null;
  return c.cost || null;
}

// ---- The stack summary --------------------------------------------------------------------------------------------

/** live.js `targetName(t, true)`: "you", a player's name, "your Meloku", "Meloku"; "" when the card is unseen. */
function targetName(f: Facts, t: Target): string {
  if ("seat" in t) return t.seat === f.me ? "you" : seatName(f, t.seat);
  const c = cardOf(f, t.card);
  return c ? (c.controller === f.me ? "your " : "") + shortCard(c.display) : "";
}

const itemTargets = (f: Facts, st: ItemFact): string[] => [
  ...st.targets.map((t) => targetName(f, t)).filter(Boolean),
  ...abilityTargetNames(st, f.stack, (id) => cardOf(f, id)?.display),
];

/** One row of the stack summary: "1 Arcane Denial → Swords to Plowshares", "2 Swords to Plowshares → your Meloku". */
export interface StackSummaryRow {
  readonly item: StackId;
  /** Its place, top first, from 1. */
  readonly n: number;
  /** The spell's name, or "Marath ability". */
  readonly title: string;
  /** What it aims at ("" for nothing). */
  readonly at: string;
  /** Someone else's aimed at me or mine, or the creature sweep: drawn in the danger ink. */
  readonly aimed: boolean;
}

/** The stack in one line an item, top first, numbered; nothing for a lone item (the card is on screen). What an item
 * does, and what the engine left unrecorded, are the inspector's. */
export function stackRows(f: Facts): StackSummaryRow[] {
  if (f.stack.length < 2) return [];
  return [...f.stack].reverse().map((st, i) => {
    const name = cardOf(f, st.source)?.display ?? "";
    return {
      item: st.id,
      n: i + 1,
      title: [st.spell ? name : `${shortCard(name)} ability`, ...stackValues(st)].join(" · "),
      at: listNames(itemTargets(f, st)),
      aimed: st.sweep || st.threat,
    };
  });
}

/** live.js `modeEntry`: the one ability of mine on the stack whose modes a `mode` decision is choosing. */
export function modeItem(d: Decision, f: Facts): StackId | null {
  const name = d.kind === "mode" ? d.prompt.match(/^modes for (.+?)(?:, a mode may repeat)?$/i)?.[1] : undefined;
  if (!name) return null;
  const matching = f.stack.filter((st) => !st.spell && st.controller !== null && st.controller === f.me && cardOf(f, st.source)?.display === name);
  return matching.length === 1 ? matching[0]!.id : null;
}
