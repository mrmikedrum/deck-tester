// What the renderers are handed from the narrative: the strip at the top left (live.js `feed`), the full log
// ("What happened", `refreshHistorySheet`), the loss notice and report (`recapHTML`, `lostSheet`), and while the table
// moves, the prompt's watching headline (`status`). Pure; only settled lines and losses are told.
import type { CardId, StackId } from "../protocol";
import type { TableModel } from "../model";
import type {
  Arrival,
  Entry,
  LogRow,
  LogSheetView,
  LogStripView,
  LossRow,
  RecapView,
  RestoreView,
  State,
  WatchView,
} from "./types";
import { spoken } from "./read";
import { handArrivalHeadline, lossFate, lossSummary, seatName } from "./words";

const settledEntries = (s: State): Entry[] => s.entries.filter((e) => e.wait === null);
const row = (e: Entry): LogRow => ({ type: e.type, text: e.display ?? e.said });
/** What the strip shows for a line: a result's headline, the client's display, its shorter words, else Forge's. */
const eventText = (e: Entry): string => e.headline ?? e.display ?? e.feed ?? e.said;

/** live.js `feed`: the turn, and what just happened in at most two lines. */
export function logStripView(s: State, model: TableModel | null): LogStripView {
  if (!model) return { heading: s.heading, lines: [], tone: "one" };
  const me = model.viewer.perspective;
  const byId = new Map(s.entries.map((e) => [e.id, e]));
  const settled = s.latest.flatMap((id) => {
    const e = byId.get(id);
    return e && e.wait === null ? [e] : [];
  });
  // A spell still on the stack is told as its cast, without what it targets ("Atraxa cast Doom Blade").
  const casts = [...model.stack].reverse().flatMap((st) => {
    if (!st.spell) return [];
    const name = st.source === null ? "" : (model.cards.get(st.source)?.face.name ?? "");
    const who = st.controller === null ? "Controller unrecorded" : seatName(model, st.controller);
    return [...new Set([who, ...(st.controller === me ? ["You"] : [])])].map((w) => `${w} cast ${name}`);
  });
  const castFor = (e: Entry): string | undefined =>
    casts.find((c) => e.said === c || e.said === c + "." || e.said.startsWith(c + " targeting "));
  const pending = [...new Set(settled.flatMap((e) => castFor(e) ?? []))];
  const distinct = pending.length ? settled.find((e) => !castFor(e)) : undefined;
  const summary = settled[0]?.summary ?? null;
  const line = [...s.notices].reverse().find((n) => n.line !== null)?.line ?? null;
  const one = model.active !== me || model.combat !== null || !!settled[0]?.headline;
  const events = line
    ? [line]
    : summary?.length
      ? summary.slice(0, 2)
      : pending.length
        ? [...pending, ...(distinct ? [eventText(distinct)] : [])].slice(0, 2)
        : settled.slice(0, one ? 1 : 2).map(eventText);
  const myName = seatName(model, me);
  const draw = events.findIndex((t) => /^(?:You drew|Drew)\b/i.test(t) || t.startsWith(myName + " drew "));
  return {
    heading: s.heading,
    lines: events.map((text, i) => ({ text, draw: i === draw })),
    tone: summary?.length && !line ? "summary" : events.length > 1 ? "recent" : "one",
  };
}

/** live.js `refreshHistorySheet`: every settled line, turns newest first, each heading over its lines newest first. */
export function logSheetView(s: State): LogSheetView {
  const groups: Entry[][] = [];
  for (const e of settledEntries(s)) {
    if (e.type === "turn" || !groups.length) groups.push([]);
    groups[groups.length - 1]!.push(e);
  }
  const lost = s.losses.filter((l) => l.wait === null);
  return {
    groups: groups.reverse().map((g) => ({ heading: row(g[0]!), rows: g.slice(1).reverse().map(row) })),
    losses: lost.length ? `Your losses · ${lossSummary(lost)}` : null,
  };
}

/** live.js `recapHTML`: the loss notice beside the decision, once the losses have been seen; null when there is none. */
export function recapView(s: State): RecapView | null {
  const ids = new Set(s.recap);
  const settled = s.losses.filter((l) => ids.has(l.id) && l.wait === null);
  if (!settled.length) return null;
  const one = settled.length === 1 ? settled[0]! : null;
  // One line, and the line is the button: "Lost: Meloku (exile) ›", "Lost 3: Meloku, Thopter, Thopter ›".
  if (one) {
    const where = one.where === "away" ? (one.token ? "token" : "") : one.where.replace(/^to (?:the )?/, "");
    return { title: `Lost: ${one.name}${where ? ` (${where})` : ""} ›`, summary: "" };
  }
  return { title: `Lost ${settled.length}: ${settled.map((l) => l.name).join(", ")} ›`, summary: "" };
}

/** live.js `lostSheet` ("What you lost"): every settled loss this game, newest first. */
export function lossReport(s: State): LossRow[] {
  return s.losses
    .filter((l) => l.wait === null)
    .reverse()
    .map((l) => ({ name: l.name, fate: lossFate(l), why: l.why || null }));
}

/**
 * live.js `status`'s `watching`: while a spell goes on the stack, cards come into my hand or the table moves, the prompt
 * says so instead of asking ("On the way to the stack"; with nothing on the stack, "Drawing a card", "A card returning
 * from the graveyard to your hand", or the motion's headline). Null when nothing is watched; the game over, never.
 * `flying`: cards are still between zones (the app's `settling`). Once Sunfall's exiles have landed and only the
 * survivors' re-fit is left, the headline says so ("Survivors are settling", live.js `settleMotion`).
 */
export function watching(s: State, model: TableModel | null, flying = true): WatchView | null {
  if (!model || model.over || !s.notices.length) return null;
  const me = model.viewer.perspective;
  const onStack = new Set<StackId>(model.stack.map((st) => st.id));
  const arriving = [...new Set(s.notices.flatMap((n) => n.arriving))].filter((id) => onStack.has(id));
  const seen = new Set<CardId>();
  const hand: Arrival[] = [];
  for (const n of s.notices)
    for (const a of n.hand) {
      const c = model.cards.get(a.card);
      if (seen.has(a.card) || c?.zone !== "hand" || c.owner !== me) continue;
      seen.add(a.card);
      hand.push(a);
    }
  const motion = [...s.notices].reverse().find((n) => n.motion)?.motion ?? "";
  const sweeping = s.notices.some((n) => n.sweeping);
  const stackOpen = model.stack.length > 0;
  // On the way to the stack: the prompt says the line it will ask with (play's), unlit until it lands.
  if (stackOpen && arriving.length) return { headline: "", arriving, toStack: true, sweeping };
  if (stackOpen || (!motion && !hand.length)) return null;
  const settling = !flying && !!motion && ([...s.notices].reverse().find((n) => n.motion)?.sweeping ?? false);
  const headline = hand.length ? handArrivalHeadline(hand, () => "", false) : settling ? "" : spoken(motion);
  return { headline, arriving: [], toStack: false, sweeping };
}

/**
 * live.js `status`'s `rewind`: back at an earlier position, the prompt's headline says the decision is mine again
 * ("Your decision · main phase"), with the cue ("Back to your earlier main phase") in its place while it is up. The
 * caller offers it on a play decision only, as the old prompt did. Null when the view has not gone back.
 */
export function restoreView(s: State, model: TableModel | null): RestoreView | null {
  if (!model || s.restore === null) return null;
  return {
    cue: s.restore,
    headline: "",
    restoring: s.restoring,
  };
}
