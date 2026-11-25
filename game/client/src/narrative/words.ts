// The narrative's words, ported from live.js: where a card went, what came into the hand, what was lost. Forge's own
// log lines are the record; these only say what the zones show (where a card went) and what the old client called it.
import type { CardId } from "../protocol";
import type { Card, SeatId, TableModel, Zone } from "../model";
import { abilityText, entersDraw, isIncubateSweep, logText, shortCard } from "../model";
import type { Arrival, Loss } from "./types";

export const listNames = (names: readonly string[]): string => new Intl.ListFormat("en").format(names);

export { shortCard };

export const seatName = (m: TableModel, seat: SeatId | null): string =>
  seat === null ? "" : (m.seat(seat)?.name ?? seat);

/** live.js `whoName`: "Your", "Atraxa's". */
export const whoName = (m: TableModel, seat: SeatId | null): string =>
  seat === m.viewer.perspective ? "Your" : `${seatName(m, seat)}'s`;

const DESTINATION: Readonly<Partial<Record<Zone | "library", string>>> = {
  graveyard: "to the graveyard",
  exile: "to exile",
  hand: "to hand",
  command: "to the command zone",
  library: "to the library",
};
/** live.js `destination`: where a card went, or "away" when out of sight (or on the battlefield or stack). */
export const destination = (c: Card | null | undefined): string => (c ? (DESTINATION[c.zone] ?? "away") : "away");

/** live.js `formerZones`. */
const FORMER: Readonly<Record<string, string>> = {
  battlefield: "the battlefield",
  graveyard: "the graveyard",
  exile: "exile",
  command: "the command zone",
  stack: "the stack",
};

/**
 * live.js `handArrivalHeadline`: cards coming into my hand, by the zone they came from. Named once they are there
 * ("Drew Island", "Rancor returned from the graveyard to your hand", "Into your hand · Island"); unnamed on the way
 * ("Drawing a card", "A card returning from the graveyard to your hand", "Into your hand").
 */
export function handArrivalHeadline(
  arrivals: readonly Arrival[],
  nameOf: (card: CardId) => string,
  named = true,
): string {
  const byZone = new Map<string | null, CardId[]>();
  for (const a of arrivals) {
    const list = byZone.get(a.from);
    if (list) list.push(a.card);
    else byZone.set(a.from, [a.card]);
  }
  return [...byZone]
    .map(([zone, group]) => {
      const count = group.length,
        quantity = count === 1 ? "a card" : `${count} cards`;
      const cards = named && count <= 3 ? listNames(group.map(nameOf)) : quantity;
      if (zone === "library") return `${named ? "Drew" : "Drawing"} ${cards}`;
      if (zone !== null)
        return `${named && count <= 3 ? cards : count === 1 ? "A card" : quantity} ${named ? "returned" : "returning"} from ${FORMER[zone] ?? zone} to your hand`;
      return named ? `Into your hand · ${cards}` : "Into your hand";
    })
    .join(" · ");
}

/** live.js `lossSummary`: "2 to the graveyard · 1 token left play · 1 with unknown destination". */
export function lossSummary(list: readonly Loss[]): string {
  const counts = new Map<string, number>();
  for (const l of list) {
    const where = l.where !== "away" ? l.where : l.token ? "token" : "unknown";
    counts.set(where, (counts.get(where) ?? 0) + 1);
  }
  return [...counts]
    .map(([where, n]) =>
      where === "token"
        ? `${n} token${n === 1 ? "" : "s"} left play`
        : where === "unknown"
          ? `${n} with unknown destination`
          : `${n} ${where}`,
    )
    .join(" · ");
}

/** live.js `lostSheet`'s row: what became of a lost card. */
export const lossFate = (l: Loss): string =>
  l.where === "away" ? (l.token ? "(token) left play" : "left play · destination unknown") : `went ${l.where}`;


/**
 * The Elemental token an ability's text makes, as live.js read it through `effectPreview` ("3/3 Elemental" from "Create
 * a 3/3 Elemental token."); null when its preview is anything else (an X the log never names, another effect).
 */
function elementalToken(text: string): string | null {
  let preview: string;
  const elemental = text.match(/^create an? (X|\d+)\/\1 (?:green )?Elemental\b/i);
  if (entersDraw(text)) return null;
  if (elemental) {
    const x =
      elemental[1] === "X" || elemental[1] === "x" ? (text.match(/\bX\s*=\s*(\d+)\b/i)?.[1] ?? "X") : elemental[1]!;
    preview =
      x === "X" ? "Create an X/X Elemental token. The chosen X is unrecorded." : `Create a ${x}/${x} Elemental token.`;
  } else if (isIncubateSweep(text))
    preview = "Exile creatures on every side. Incubate with a +1/+1 counter per creature exiled.";
  else preview = text.split(/(?<=\.)\s|\n/)[0] ?? "";
  return preview.match(/^Create a (\d+\/\d+ Elemental) token\.$/)?.[1] ?? null;
}

/**
 * live.js `recordLog`'s `feedText`: the strip's words for Forge's line paying for an ability on the stack that makes an
 * Elemental ("Atraxa removed 3 +1/+1 counters from Marath to activate Marath, Will of the Wild" reads "Marath spent 3
 * +1/+1 counters for a 3/3 Elemental"). Null for any other line; the log keeps Forge's.
 */
export function spentFor(text: string, model: TableModel): string | null {
  const line = logText(text);
  // The stack top first, as live.js's `G.stack` was.
  for (const st of [...model.stack].reverse()) {
    if (st.spell) continue;
    const name = st.source === null ? "" : (model.cards.get(st.source)?.face.name ?? "");
    if (!line.endsWith(` to activate ${name}`)) continue;
    const who = st.controller === null ? "Controller unrecorded" : seatName(model, st.controller);
    const prefix = `${who} removed `;
    const cost = line.startsWith(prefix)
      ? line.slice(prefix.length).split(` from ${shortCard(name)} to activate `)
      : null;
    const token = elementalToken(abilityText(st.text, name));
    return cost?.length === 2 && token ? `${shortCard(name)} spent ${cost[0]!} for a ${token}` : null;
  }
  return null;
}
