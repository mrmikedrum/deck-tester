// What one change set means for the story, read as live.js `take` read a new view: the result of what left the stack
// (`outcomes`, with `tokenResult`, `sunfallResult` and `counterResult`), the motion headline (`moving`), what came into
// my hand (`trackHandArrivals`) and what of mine left the battlefield (`gone`). The change set gives what the old client
// worked out by comparing views; the fresh log lines are Forge's record, and only they say why.
import type { CardId, LogEntry } from "../protocol";
import type { Card, Change, ChangeSet, PopKind, StackItem, TableModel } from "../model";
import {
  departureIn,
  drewCards,
  elementalCreation,
  isCounterspell,
  isDamagePhase,
  logText,
  makesElemental,
} from "../model";
import type { Arrival } from "./types";

/** Motion the prompt does not narrate (the loss notice names what left): a notice still waits on it. */
export const QUIET = { combatOver: "Combatants return", leaving: "Cards leave the battlefield" } as const;
const QUIETS: ReadonlySet<string> = new Set(Object.values(QUIET));
/** A spell gone from the stack, in the game's words for how it went; with no word from Forge, only that it went. */
const LEFT: Readonly<Record<PopKind, string>> = { resolved: "resolves", fizzled: "fizzles", countered: "is countered", unknown: "leaves the stack" };
/** The prompt's words for a motion: none for a quiet one. */
export const spoken = (motion: string): string => (QUIETS.has(motion) ? "" : motion);
import { destination, handArrivalHeadline, listNames, seatName, shortCard, whoName } from "./words";

type Moved = Extract<Change, { t: "moved" }>;

/** A result the client read from the zones (live.js `outcomes`): the log's "result" line. */
interface Outcome {
  readonly headline: string | null;
  readonly summary: readonly string[] | null;
  readonly text: string;
}

export interface Reading {
  readonly outcome: Outcome | null;
  /** The token arrival's own log line: the strip does not repeat it under its summary. */
  readonly summarized: LogEntry | null;
  /** live.js `moving`; "" when nothing moves that the prompt would watch. */
  readonly motion: string;
  /** live.js `motionEntry`: the strip's line while it moves. */
  readonly line: string | null;
  readonly sweeping: boolean;
  /** Stack items new in this set, top first. */
  readonly added: readonly StackItem[];
  /** My permanents that left the battlefield (not for the stack), by card id. */
  readonly lost: readonly Moved[];
  readonly hand: readonly Arrival[];
  /** The draw report the hand's arrivals name ("Drew Island"), and the cards it drew. */
  readonly draw: { readonly entry: LogEntry; readonly cards: readonly CardId[] } | null;
  /** Every line reporting a draw, and the line for cards returned to my hand (null: none): shown once they arrive. */
  readonly reports: readonly LogEntry[];
  readonly returned: string | null;
  /** The fresh lines wait for the motion (live.js `waiting`): it shows them happen first. */
  readonly hold: boolean;
  /** A fresh line that only says something went on the stack: it does not wait. */
  readonly onStack: (e: LogEntry) => boolean;
  /** A card's name, for losses: as it is now, or as it was before it left. */
  readonly nameOf: (id: CardId) => string;
  /** The battlefield as it was. */
  readonly before: ReadonlyMap<CardId, Card>;
}

const SUNFALL_REPORT = /^Sunfall exiled (?:\d+ creatures?|every creature)(?:[.;]|$)/i;

export function readSet(set: ChangeSet, model: TableModel, fresh: readonly LogEntry[]): Reading {
  const me = model.viewer.perspective;
  const moved = new Map<CardId, Moved>();
  for (const c of set.changes) if (c.t === "moved") moved.set(c.card, c);
  const now = (id: CardId | null): Card | undefined => (id === null ? undefined : model.cards.get(id));
  // The battlefield before: what is on it now and did not move, and what left it.
  const before = new Map<CardId, Card>();
  for (const c of model.cards.values()) if (c.zone === "battlefield" && !moved.has(c.id)) before.set(c.id, c);
  for (const c of moved.values()) if (c.from === "battlefield" && c.before) before.set(c.card, c.before);
  const nameOf = (id: CardId): string => now(id)?.name ?? moved.get(id)?.before?.name ?? before.get(id)?.name ?? "";
  const displayOf = (id: CardId | null): string =>
    id === null ? "" : (now(id)?.face.name ?? moved.get(id)?.before?.face.name ?? "");
  const itemName = (st: StackItem): string => (st.source === null ? "" : nameOf(st.source));
  const texts = fresh.map((e) => logText(e.text));

  const departed = set.changes.flatMap((c) => (c.t === "popped" && c.item.source !== null ? [c.item] : []));
  // How each left, as the model read it from Forge's log: only "resolved" is told as resolving.
  const how = new Map(set.changes.flatMap((c) => (c.t === "popped" ? [[c.item, c.how] as const] : [])));
  const pushed = new Set(set.changes.flatMap((c) => (c.t === "pushed" ? [c.item.id] : [])));
  const added = [...model.stack].reverse().filter((st) => pushed.has(st.id));

  /** live.js `departureInLog`: the one departed item a log line says left. */
  const departureInLog = (e: LogEntry): StackItem | undefined => {
    const items = departed.filter((st) => departureIn(e, st, itemName(st)) !== null);
    return items.length === 1 ? items[0] : undefined;
  };

  // live.js `tokenResult`: Marath's Elemental, and the Beasts the log says came with it.
  const token = (() => {
    const maker = departed.find((st) => !st.spell && makesElemental(st.text));
    if (!maker || maker.controller === null) return null;
    const pid = maker.controller,
      who = seatName(model, pid);
    const log = fresh.find(
      (e) =>
        (e.card === null || !model.cards.has(e.card)) &&
        logText(e.text).startsWith(who + " ") &&
        elementalCreation(e.text) !== null,
    );
    if (!log) return null;
    const elements = [...model.cards.values()].filter(
      (c) =>
        c.zone === "battlefield" && c.controller === pid && c.token && !before.has(c.id) && /^Elemental\b/.test(c.name),
    );
    const one = elements.length === 1 ? elements[0]! : null;
    if (!one || one.power === null || one.toughness === null || (log.card !== null && before.has(log.card)))
      return null;
    const beasts = elementalCreation(log.text)!;
    const group = `${one.power}/${one.toughness} Elemental and ${beasts}`;
    return {
      log,
      moving: `${group} enter`,
      summary: [
        `${pid === me ? "You" : who} got a ${one.power}/${one.toughness} Elemental`,
        `${beasts[0]!.toUpperCase() + beasts.slice(1)} · source unrecorded`,
      ],
    };
  })();

  // live.js `sunfallResult`.
  const sunfall = (() => {
    const spell = departed.find((st) => st.spell && itemName(st) === "Sunfall");
    if (!spell) return null;
    const reported = texts.find((t) => SUNFALL_REPORT.test(t));
    if (reported) return { spell, headline: reported.split(/[.;]/)[0]!, reported };
    const resolved = fresh.some(
      (e) => e.card === spell.source && /^STACK_RESOLVE$/i.test(e.type) && !/fizzl|countered/i.test(e.text),
    );
    const exiled = [...moved.values()].some((c) => c.from === "battlefield" && c.after?.zone === "exile");
    return resolved && exiled ? { spell, headline: "Sunfall exiled creatures", reported: null } : null;
  })();

  // live.js `counterResult`: the one spell countered, the one spell that countered it, and its targets that stayed.
  const counter = (() => {
    const countered = new Set<StackItem>();
    for (const e of fresh) {
      const text = logText(e.text).replace(/\.$/, "");
      if (!text.endsWith(" was countered")) continue;
      const st = departureInLog(e);
      if (st?.spell && text === `${itemName(st)} was countered`) countered.add(st);
    }
    if (countered.size !== 1) return null;
    const spell = [...countered][0]!;
    const rules = (id: CardId | null): string => {
      const c = id === null ? undefined : (now(id) ?? moved.get(id)?.before ?? undefined);
      return c ? c.face.text || c.face.rules : "";
    };
    const counters = departed.filter(
      (st) =>
        st !== spell &&
        st.spell &&
        st.targets.some((t) => "card" in t && t.card === spell.source) &&
        isCounterspell(rules(st.source)),
    );
    const saved = spell.targets.flatMap((t) =>
      "card" in t && before.has(t.card) && now(t.card)?.zone === "battlefield"
        ? [shortCard(before.get(t.card)!.name)]
        : [],
    );
    return { spell, by: counters.length === 1 ? counters[0]! : null, saved };
  })();

  // live.js `outcomes`.
  const outcome = ((): Outcome | null => {
    if (!departed.length) return null;
    const evidence = new Map<StackItem, string>();
    for (const e of fresh) {
      const item = departureInLog(e);
      if (item) evidence.set(item, logText(e.text).replace(/\.$/, ""));
    }
    const results = departed.flatMap((st): string[] => {
      const name = itemName(st),
        result = evidence.get(st),
        card = now(st.source);
      const where = destination(card),
        trip = st.spell && where !== "away" ? `${name} went ${where}.` : "";
      if (result && st !== sunfall?.spell)
        return [result + ".", trip && !result.includes(where) ? trip : ""].filter(Boolean);
      if (st === departed[0] && token && departed.length === 1) return [];
      if (st.spell && card?.zone === "battlefield") return [`${name} entered.`];
      if (trip) return [trip];
      return [`${st.spell ? name : shortCard(name) + "'s ability"} left the stack.`];
    });
    for (const created of fresh) {
      const said = logText(created.text);
      if (created === token?.log || said === sunfall?.reported || !/\bcreated\b/i.test(said)) continue;
      let result = said.replace(/\.?$/, ".");
      const source = created.card === null ? undefined : (now(created.card) ?? before.get(created.card));
      if (source) result += ` Source: ${source.name}.`;
      if (!results.includes(result)) results.push(result);
    }
    let summary: readonly string[] | null = token?.summary ?? null;
    if (sunfall) {
      const pid = sunfall.spell.controller,
        caster = seatName(model, pid);
      const incubators = [...model.cards.values()].filter(
        (c) =>
          c.zone === "battlefield" && c.controller === pid && c.token && c.name === "Incubator" && !before.has(c.id),
      );
      const counters = incubators.length === 1 ? incubators[0]!.counters : null;
      const count = counters ? (counters["+1/+1"] ?? counters["P1P1"] ?? null) : null;
      const gain = count === null ? "" : `${whoName(model, pid)} Incubator · ${count} +1/+1 counters`;
      const reported =
        /\bIncubator\b/i.test(sunfall.reported ?? "") ||
        texts.some((t) => t.startsWith(caster + " ") && /\bcreated\b.*\bIncubator\b/i.test(t));
      if (incubators.length === 1 && !reported)
        results.push(gain || `An Incubator arrived on ${whoName(model, pid)} side.`);
      if (gain) summary = [sunfall.headline, gain];
    }
    if (counter)
      summary = [
        `${itemName(counter.spell)} was countered`,
        ...counter.saved.map((n) => `${n} stayed on the battlefield`),
      ];
    const targets = [
      ...new Set(departed.flatMap((st) => st.targets.flatMap((t) => ("card" in t ? [t.card] : [])))),
    ].filter((t) => before.has(t));
    const changes = targets.map((id) => {
      const card = now(id),
        name = shortCard(before.get(id)!.name);
      if (card?.zone === "battlefield") return `${name} stayed on the battlefield.`;
      const where = destination(card);
      return where === "away" ? `${name} left the battlefield.` : `${name} went ${where}.`;
    });
    // When the bridge skips steps, zones can establish where cards ended up; a clear stack can't establish why.
    const headline =
      sunfall?.headline ||
      (!counter && texts.some((t) => / was countered\.?$/.test(t))
        ? "Spells left the stack"
        : (changes[0]?.replace(/\.$/, "") ?? null));
    const lead = sunfall?.reported || (sunfall ? headline : token?.summary.join(". ") || "");
    const text = [lead ? lead.replace(/\.?$/, ".") : "", ...changes, ...results].filter(Boolean).join(" ");
    return { headline, summary, text };
  })();

  // live.js `trackHandArrivals`: what came into my hand, and from where.
  const myName = seatName(model, me);
  const draws = fresh.flatMap((entry) => {
    const count = drewCards(entry.text, myName);
    return count === null ? [] : [{ entry, count }];
  });
  const drawn = draws.reduce((n, d) => n + d.count, 0);
  const arrived = model.zone(me, "hand").filter((id) => moved.get(id)?.to === "hand");
  const unknown = arrived.filter((id) => moved.get(id)!.from === null);
  const hand: Arrival[] = arrived.map((id) => ({
    card: id,
    from: moved.get(id)!.from ?? (drawn > 0 && drawn === unknown.length ? "library" : null),
  }));
  const drewIds = hand.filter((a) => a.from === "library").map((a) => a.card);
  const draw = drewIds.length && draws.length === 1 ? { entry: draws[0]!.entry, cards: drewIds } : null;
  const back = hand.filter((a) => a.from !== "library");
  const handName = (id: CardId): string => displayOf(id);
  const returned = back.length ? handArrivalHeadline(back, handName) : null;

  // live.js `take`: my permanents gone, and what moves.
  const lost = [...moved.values()]
    .filter((c) => c.from === "battlefield" && c.before?.controller === me && c.after?.zone !== "stack")
    .sort((a, b) => a.card - b.card);
  let finalOutcome = outcome;
  if (!finalOutcome && !texts.some(Boolean) && lost.length) {
    const one = lost.length === 1 ? lost[0]! : null;
    const where = one ? destination(now(one.card)) : "";
    finalOutcome = {
      headline: null,
      summary: null,
      text: one
        ? `${one.before!.name} ${where === "away" ? "left the battlefield" : "went " + where}`
        : `${lost.length} of your cards left the battlefield`,
    };
  }
  const damage = isDamagePhase(model.phase);
  const entered = departed.filter((st) => st.spell && now(st.source)?.zone === "battlefield");
  const countered = texts.some((t) => /\bwas countered\b/i.test(t));
  const attacksAtMe = set.changes.some(
    (c) =>
      c.t === "attacks" && c.attack.defender !== null && "seat" in c.attack.defender && c.attack.defender.seat === me,
  );
  // What the table is doing, in the game's words, the same line the prompt will ask with where it asks one.
  let motion = "";
  if (added.length) {
    const st = added[0]!,
      name = displayOf(st.source),
      who = st.controller === me ? "You" : seatName(model, st.controller);
    motion = st.spell ? `${who} ${st.controller === me ? "cast" : "casts"} ${name}` : `${whoName(model, st.controller)} ${shortCard(name)} ability`;
  } else if ((model.phase === "COMBAT_DECLARE_ATTACKERS" || model.phase === "COMBAT_DECLARE_BLOCKERS") && attacksAtMe)
    motion = `${seatName(model, model.active)} attacks`;
  else if (model.phase === "COMBAT_DECLARE_BLOCKERS" && set.changes.some((c) => c.t === "blocked")) motion = "Blockers declared";
  else if (set.changes.some((c) => c.t === "combat-over")) motion = QUIET.combatOver;
  else if (departed.length || lost.length || (damage && set.changes.some((c) => c.t === "phase"))) {
    const spells = departed.filter((st) => st.spell);
    motion = sunfall
      ? "Sunfall resolves"
      : entered.length
        ? `${listNames(entered.map(itemName))} ${entered.length === 1 ? "enters" : "enter"}`
        : token?.moving ||
          (damage
            ? "Combat damage"
            : countered
              ? counter
                ? `${itemName(counter.spell)} is countered`
                : "Countered"
              : spells.length === 1
                ? `${itemName(spells[0]!)} ${LEFT[how.get(spells[0]!) ?? "unknown"]}`
                : spells.length
                  ? spells.every((st) => how.get(st) === "resolved")
                    ? "Resolved"
                    : "Spells left the stack"
                  : QUIET.leaving);
  }
  const onStack = (e: LogEntry): boolean =>
    /^(?:turn|stack_add)$/i.test(e.type) ||
    added.some((st) =>
      ["cast", "activated", "triggered"].some((verb) =>
        logText(e.text).startsWith(`${seatName(model, st.controller)} ${verb} ${displayOf(st.source)}`),
      ),
    );
  return {
    outcome: finalOutcome,
    summarized: token?.log ?? null,
    motion,
    line: motion && counter?.by ? `${itemName(counter.by)} is resolving` : null,
    sweeping: !!motion && !!sunfall,
    added,
    lost,
    hand,
    draw,
    reports: draws.map((d) => d.entry),
    returned,
    hold: !!motion && (!added.length || departed.length > 0 || lost.length > 0),
    onStack,
    nameOf,
    before,
  };
}
