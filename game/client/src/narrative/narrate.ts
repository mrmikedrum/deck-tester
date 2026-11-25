// narrate(state, changes, model): the story of one change set, told as the old client told it in live.js `take` and
// `recordLog`. Forge's fresh log lines go into the log, under the turn's heading; a result read from the zones goes with
// them; what must be seen before it is told (the lines, the losses, the cards coming into the hand) waits on a notice
// for the set's motion, which the app releases when the scene has played it. Pure, and bounded: see the *_KEPT limits.
import type { LogEntry } from "../protocol";
import type { Back, ChangeSet, TableModel } from "../model";
import { logKey, logText, phaseName } from "../model";
import { readSet } from "./read";
import type { Entry, Loss, Notice, Recap, State, Toast } from "./types";
import { destination, handArrivalHeadline, listNames, seatName, shortCard, spentFor, whoName } from "./words";

/** The log keeps its newest 400 lines (headings and results among them); older lines drop off the top. */
export const LOG_KEPT = 400;
/** The strip's candidates: the newest 12 of this turn. */
export const LATEST_KEPT = 12;
/** Notices waiting on motion: past 8, the oldest is released (its lines shown) as a new one comes. */
export const NOTICES_KEPT = 8;
/** Losses this game, for the report: the newest 60. */
const LOSSES_KEPT = 60;
/** Must-not-miss moments kept: the newest 20. */
export const RECAPS_KEPT = 20;
/** Toasts on screen at once: the newest 4. */
export const TOASTS_KEPT = 4;

export const initial: State = {
  entries: [],
  heading: "",
  latest: [],
  seen: [],
  turn: null,
  notices: [],
  losses: [],
  recap: [],
  missed: [],
  toasts: [],
  serial: 0,
  restore: null,
  restoring: false,
  fresh: [],
};

/** A new game, a restart or teardown: everything goes, toasts too (the app cancels their deadlines); ids keep rising. */
export const restart = (s: State): State => ({ ...initial, serial: s.serial });

/** A cut to another position (live.js `clearHistory`): the story starts again; the toasts stay their time. */
const cleared = (s: State): State => ({ ...restart(s), toasts: s.toasts });

type Draft = Omit<Entry, "id"> & { readonly src: LogEntry | null };

const draft = (e: LogEntry, model: TableModel): Draft => ({
  type: e.type.toLowerCase(),
  said: logText(e.text),
  display: null,
  feed: spentFor(e.text, model),
  headline: null,
  summary: null,
  card: e.card,
  wait: null,
  src: e,
});

const said = (type: string, text: string, more: Partial<Draft> = {}): Draft => ({
  type,
  said: text,
  display: null,
  feed: null,
  headline: null,
  summary: null,
  card: null,
  wait: null,
  src: null,
  ...more,
});

/** Releases these notices: what waited on them is told. */
function releaseIds(s: State, ids: ReadonlySet<number>): State {
  if (!ids.size) return s;
  const free = <T extends { readonly wait: number | null }>(x: T): T =>
    x.wait !== null && ids.has(x.wait) ? { ...x, wait: null } : x;
  return {
    ...s,
    notices: s.notices.filter((n) => !ids.has(n.id)),
    entries: s.entries.map(free),
    losses: s.losses.map(free),
  };
}

/**
 * The scene has played the change sets up to `upTo` (or cut past them; "all": a cut, a new game): their notices are
 * released, and what waited on them is shown.
 */
export function release(s: State, upTo: number | "all"): State {
  return releaseIds(s, new Set(s.notices.filter((n) => upTo === "all" || n.seq <= upTo).map((n) => n.id)));
}

/**
 * live.js `take`: a jump back to an earlier position. The notice ("Back to your earlier main phase"), and the log's line
 * for it, with what it set aside ("Set aside Lightning Bolt → Princess"): the strip's summary, or "Position restored".
 */
function restoredLine(back: Back, model: TableModel): { notice: string; draft: Draft } {
  const me = model.viewer.perspective;
  const whose = model.active === null || model.active === me ? "your" : whoName(model, model.active);
  const notice = `Back to ${whose} earlier ${phaseName(model.phase).toLowerCase()}`;
  const aside = back.aside.map((a) => {
    const name = (a.source?.face.name ?? "") + (a.item.spell ? "" : "’s ability");
    const targets = a.targets
      .map((t) => (typeof t === "string" ? (t === me ? "you" : seatName(model, t)) : shortCard(t.face.name)))
      .filter(Boolean);
    return targets.length ? `${name} → ${listNames(targets)}` : name;
  });
  const summary = aside.length
    ? [`Set aside ${aside[0]!}`, ...(aside.length > 2 ? [`and ${aside.length - 1} more plays`] : aside.slice(1))]
    : ["Position restored"];
  const text = [notice + ".", aside.length ? `Set aside ${listNames(aside)}.` : ""].filter(Boolean).join(" ");
  return { notice, draft: said("result", text, { summary }) };
}

/** The app has drawn the cut to the earlier position and let it be seen: the restore's cue goes (the notice stays). */
export const restored = (s: State): State => (s.restoring ? { ...s, restoring: false } : s);

export function narrate(s: State, set: ChangeSet, model: TableModel): State {
  const reset = set.changes.some((c) => c.t === "reset");
  const back = set.changes.flatMap((c) => (c.t === "reset" && c.back ? [c.back] : []))[0] ?? null;
  const restore = back ? restoredLine(back, model) : null;
  const base = reset ? cleared(s) : s;
  const seen = new Set(base.seen);
  const fresh = model.log.filter((e) => !seen.has(logKey(e)));
  const me = model.viewer.perspective;
  let serial = base.serial;
  let recap = base.turn !== model.turn ? [] : base.recap;
  const r = reset ? null : readSet(set, model, fresh);
  const notice: Notice | null =
    r && (r.motion || r.added.length || r.hand.length)
      ? {
          id: ++serial,
          seq: set.seq,
          motion: r.motion,
          line: r.line,
          arriving: r.added.map((st) => st.id),
          hand: r.hand,
          sweeping: r.sweeping,
        }
      : null;
  const wait = notice?.id ?? null;

  // The lines: Forge's (those that say something), the draw named ("Drew Island"), cards returned to my hand.
  const items: Draft[] = fresh.filter((e) => logText(e.text)).map((e) => draft(e, model));
  const reports = new Set<LogEntry>(r?.reports ?? []);
  const handLines: Draft[] = [];
  for (let i = 0; i < items.length; i++) {
    const d = items[i]!;
    if (!d.src || !reports.has(d.src)) continue;
    const display =
      r?.draw?.entry === d.src
        ? handArrivalHeadline(
            r.draw.cards.map((card) => ({ card, from: "library" })),
            (id) => model.cards.get(id)?.face.name ?? "",
          )
        : null;
    items[i] = { ...d, display, wait };
    handLines.push(items[i]!);
  }
  if (r?.returned) {
    const back = said("result", r.returned, { wait });
    items.push(back);
    handLines.push(back);
  }
  if (r?.hold)
    for (let i = 0; i < items.length; i++) {
      const d = items[i]!;
      if (d.src && d.wait === null && !r.onStack(d.src)) items[i] = { ...d, wait };
    }

  // The turn's heading: in place of Forge's own "Turn 9 (You)", or after the batch's last turn line.
  let heading = base.heading,
    latest = base.latest;
  const isTurn = (d: Draft): boolean => d.type === "turn";
  const player = seatName(model, model.active);
  const now = model.active === null ? "" : `Turn ${model.turn} · ${player}`;
  if (now && now !== heading) {
    const at = items.map(isTurn).lastIndexOf(true);
    const h = said("turn", now);
    if (at >= 0 && items[at]!.said === `Turn ${model.turn} (${player})`) items[at] = h;
    else items.splice(at + 1, 0, h);
    heading = now;
    latest = [];
  }

  // The result goes before the first line about my hand, or last.
  const outcome = r?.outcome ?? null;
  const result: Draft | null = outcome
    ? said("result", outcome.text, {
        headline: outcome.headline,
        summary: outcome.summary,
        wait: r?.hold ? wait : null,
      })
    : null;
  if (result) {
    const at = handLines.length ? items.indexOf(handLines[0]!) : -1;
    items.splice(at < 0 ? items.length : at, 0, result);
  }
  // Going back is told last, and is the strip's newest (live.js `recordLog`'s `restored`).
  if (restore) items.push(restore.draft);

  const entries: Entry[] = items.map(({ src, ...d }) => {
    void src;
    return { ...d, id: ++serial };
  });
  const turnStart = items.map(isTurn).lastIndexOf(true);
  const recent = entries
    .filter((e, i) => {
      if (i <= turnStart || e.type === "turn" || items[i] === restore?.draft) return false;
      const src = items[i]!.src;
      if (src && src === r?.summarized) return false;
      return items[i] === result || !outcome?.text.startsWith(e.said);
    })
    .map((e) => e.id)
    .reverse();
  const restoredId = restore ? entries[items.indexOf(restore.draft)]!.id : null;
  latest = [...(restoredId === null ? [] : [restoredId]), ...recent, ...latest].slice(0, LATEST_KEPT);

  // My permanents gone on someone else's turn: the recap beside the decision, and the report (live.js `noteLosses`).
  let losses = base.losses;
  if (r && r.lost.length && model.active !== me) {
    const gone: Loss[] = r.lost.map((c) => {
      const name = c.before?.name ?? r.nameOf(c.card);
      const why = [...fresh].reverse().find((e) => e.card === c.card || logText(e.text).includes(name));
      return {
        id: ++serial,
        card: c.card,
        name,
        where: destination(model.cards.get(c.card)),
        token: !!c.before?.token,
        why: why ? logText(why.text) : "",
        wait: r.motion ? wait : null,
      };
    });
    recap = gone.map((l) => l.id);
    losses = [...losses, ...gone].slice(-LOSSES_KEPT);
  }

  let out: State = {
    ...base,
    entries: [...base.entries, ...entries].slice(-LOG_KEPT),
    heading,
    latest,
    seen: model.log.map(logKey),
    turn: model.turn,
    notices: notice ? [...base.notices, notice] : base.notices,
    losses,
    recap,
    serial,
    restore: restore?.notice ?? null,
    restoring: restore !== null,
    // The cards that last came into my hand: kept until the next arrive, or the game or the position changes.
    fresh: reset ? [] : r?.hand.length ? r.hand.map((a) => a.card) : base.fresh,
  };
  if (out.notices.length > NOTICES_KEPT)
    out = releaseIds(out, new Set(out.notices.slice(0, out.notices.length - NOTICES_KEPT).map((n) => n.id)));
  return out;
}

/**
 * Must-not-miss moments the scene played compressed or collapsed, or the app's queue cut past: their notices are
 * released (the motion they waited for will not be seen), and a card of mine they say was lost that the story has not
 * noted is added to the recap and the report. Call it after narrating the set the recaps are about.
 */
export function recapped(s: State, recaps: readonly Recap[], model: TableModel): State {
  if (!recaps.length) return s;
  const me = model.viewer.perspective;
  const seqs = new Set(recaps.map((r) => r.seq));
  let out = releaseIds(s, new Set(s.notices.filter((n) => seqs.has(n.seq)).map((n) => n.id)));
  let serial = out.serial;
  const known = new Set(out.losses.map((l) => l.card));
  const added: Loss[] = [];
  for (const r of recaps) {
    if (r.why !== "lost" && r.why !== "sweep") continue;
    for (const id of r.cards) {
      const c = model.cards.get(id);
      if (!c || known.has(id) || (r.why === "sweep" && c.owner !== me)) continue;
      known.add(id);
      const why = [...out.entries].reverse().find((e) => e.card === id || e.said.includes(c.name));
      added.push({
        id: ++serial,
        card: id,
        name: c.name,
        where: destination(c),
        token: c.token,
        why: why?.said ?? "",
        wait: null,
      });
    }
  }
  out = {
    ...out,
    losses: [...out.losses, ...added].slice(-LOSSES_KEPT),
    recap: [...out.recap, ...added.map((l) => l.id)],
    missed: [...out.missed, ...recaps].slice(-RECAPS_KEPT),
    serial,
  };
  return out;
}

/** The player closed the loss notice. */
export const dismissRecap = (s: State): State => (s.recap.length ? { ...s, recap: [] } : s);

/** A toast for a while: its id (for the app's deadline), and the older ones pushed off (their deadlines can go). */
export function toast(
  s: State,
  text: string,
  level: Toast["level"],
  at: number,
): { state: State; id: number; expired: readonly number[] } {
  const id = s.serial + 1;
  const all = [...s.toasts, { id, text, level, at }];
  const expired = all.slice(0, Math.max(0, all.length - TOASTS_KEPT)).map((t) => t.id);
  return { state: { ...s, toasts: all.slice(-TOASTS_KEPT), serial: id }, id, expired };
}

/** A toast's time is up. */
export const expire = (s: State, id: number): State =>
  s.toasts.some((t) => t.id === id) ? { ...s, toasts: s.toasts.filter((t) => t.id !== id) } : s;
