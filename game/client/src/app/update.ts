// update: a short router. Each message goes to the module that owns it (play, the answer ledger, moments, focus,
// faults) and derived state is recomputed when its inputs change (the model, its change sets, the table plan). No game
// logic here, and no clock: time comes in the message.
//
// Play is the one owner of stops and answer tokens: the app's `session.stop` is play's, an answer goes out under play's
// token, and the ledger decides when it is settled (matching the bridge's status to the answer's attempt); play hears of
// every settlement as a `settled` event, and of an answer the bridge is working on that this page did not send as a
// `working` event. Play never reads the bridge's status itself. Play's state lives for the page: a new game, a restart
// or teardown reaches it as a snapshot event, never as a reset to `initial`.
import { diff, modelOf, playerViewer } from "../model";
import { siftPages } from "../layout";
import type { HitGroup } from "../layout";
import type { ChangeSet, TableModel } from "../model";
import * as narrative from "../narrative";
import * as play from "../play";
import type { Ms } from "../platform";
import type { CardId, ClientLogEntry, Continuity, Decision, Snapshot } from "../protocol";
import { mustNotMiss } from "../scene/stage/backlog";
import { siftCards } from "../scene/stage/describe";
import type { Recap, SceneReport } from "../scene/stage/types";
import type { TransportEvent } from "../transport";
import { answerOutcome, observeAnswer, openAnswer, restartAnswers, settledSince, supersedeAnswer, withdrawAnswer } from "./answers";
import type { Settled } from "./answers";
import { askCards as catalogAsk, CARDS_WAIT, CARDS_WAIT_MS, cardsReplied, gateDecision, retryFailed, takeCards } from "./catalog";
import type { Gated } from "./catalog";
import { cancelDeadline, cancelOwned, isLive, setDeadline } from "./deadlines";
import type { Effect } from "./effects";
import { effectFault, ingestFault, ingestOk, logEntry } from "./faults";
import { clashKeyOf, close, dismiss, entry, isAside, isOpen, NO_FOCUS_STATE, open, restore, setAside, stackKeyOf, sync, tableTop, top, topKey } from "./focus";
import { isDeadlineId } from "./ids";
import { timeOf } from "./msg";
import type { InputMsg, Msg } from "./msg";
import {
  abandonMoments,
  endHeld,
  HELD_LIMIT,
  landMoments,
  momentDeadline,
  MOMENT_LIMIT,
  movedHeld,
  moveHeld,
  newest,
  observeModel,
  openMoment,
  returnFor,
  returnHeld,
  sceneHas,
  takeOver,
} from "./moments";
import { replan } from "./plan";
import { offersNewGame } from "./readout";
import { NOTICE_MS } from "./slots";
import type { RenderReport } from "./slots";
import type { AppState, ChangeQueue } from "./state";
import { initialState, NO_GATE } from "./state";

export interface Step {
  readonly state: AppState;
  readonly effects: readonly Effect[];
}

/** What play is told when the ledger will not let its answer out. */
export const STILL_WAITING = "Still waiting on the last answer";
/** At most this many change sets wait for the scene; past it the oldest go and the next commit cuts (with recaps). */
export const QUEUE_LIMIT = 24;
/** Continuities after which the table cuts rather than animates. */
const CUTS: ReadonlySet<Continuity> = new Set<Continuity>(["first", "newGame", "rewind", "restart"]);

const assertNever = (x: never): never => {
  throw new Error(`unhandled message ${JSON.stringify(x)}`);
};

/** A transaction: the state as it goes, and the effects collected. Local to one update call. `origin`: the control the
 * player's input came from, where keyboard focus returns when a layer it opens goes. */
interface Tx {
  s: AppState;
  readonly fx: Effect[];
  readonly origin?: string | null;
}

const done = (tx: Tx): Step => ({ state: tx.s, effects: tx.fx });

export function update(s: AppState, m: Msg): Step {
  const r = route(s, m);
  const origin = ("origin" in m && m.origin) || null;
  const state = focused(s, r.state.moments === s.moments ? r.state : pruneMoments(r.state), origin);
  if (state.focus === s.focus) return state === r.state ? r : { state, effects: r.effects };
  // The focus changed: a sift opening or going changes the chrome's mode, so the plan may be made again (and the focus
  // kept in step with it).
  const tx: Tx = { s: state, fx: [...r.effects] };
  plan(tx, timeOf(m));
  return { state: focused(state, tx.s, origin), effects: tx.fx };
}

/**
 * The focus stack kept in step with what its layers stand for (focus.ts `sync`): play's sheet, the mulligan asked, the
 * stack on the table, a sift's group on the table. Recomputed only when play, the model, the plan or the focus changed.
 */
function focused(prev: AppState, s: AppState, origin: string | null): AppState {
  if (s.play === prev.play && s.model === prev.model && s.focus === prev.focus && s.plan === prev.plan) return s;
  const c = play.present(s.play).controls;
  const live = c.mayAnswer && s.model !== null;
  const mulligan = live && c.prompt?.style === "overlay" && !c.prompt.busy;
  const groups = s.plan?.hits.groups;
  const has = (id: string): boolean => groups?.some((g) => g.id === id) ?? false;
  const pages = (id: string): number => siftPages(s.model && s.plan ? (siftCards(s.model, s.plan, id)?.ids.length ?? 0) : 0);
  const focus = sync(s.focus, { sheet: live && c.sheet !== null, mulligan, stack: stackKeyOf(s.model), clash: s.paradigm === "front" ? clashKeyOf(s.model) : "", groups: has, pages }, origin);
  return focus === s.focus ? s : { ...s, focus };
}

/** Every moment that ended takes its backstop with it. */
function pruneMoments(s: AppState): AppState {
  const open = new Set(s.moments.open.map((m) => momentDeadline(m.id)));
  return { ...s, deadlines: cancelOwned(s.deadlines, "moments/", (id) => !open.has(id as `moments/${string}`)) };
}

function route(s: AppState, m: Msg): Step {
  switch (m.t) {
    case "snapshot":
      return snapshot(s, m);
    case "answered":
      return answered(s, m);
    case "link": {
      const tx: Tx = { s: { ...s, session: { ...s.session, link: m.up ? "up" : "down" } }, fx: [] };
      toPlay(tx, { t: "link", at: m.at, up: m.up }, m.at);
      return done(tx);
    }
    case "art":
      return { state: s, effects: [] }; // late art redraws faces: the scene's host repaints as art decodes
    case "started":
      return { state: { ...s, session: { ...s.session, started: { ok: m.ok, error: m.error } } }, effects: [] };
    case "decks":
      return { state: { ...s, session: { ...s.session, decks: { list: m.decks, error: m.error } } }, effects: [] };
    case "cards":
      return cards(s, m);
    case "fault":
      return {
        state: { ...s, faults: ingestFault(s.faults, m.message) },
        effects: [{ kind: "log", epoch: s.epoch, entry: logEntry(s, "error", "ingest.decode", m.message) }],
      };
    case "act":
    case "dismiss":
    case "restore":
    case "open":
    case "newGame":
    case "listDecks":
    case "dismissRecap":
    case "siftPage":
    case "hover":
      return input(s, m);
    case "viewport": {
      const tx: Tx = { s: { ...s, viewport: { w: m.w, h: m.h, safe: m.safe } }, fx: [] };
      plan(tx, m.at);
      return done(tx);
    }
    case "motion":
      return { state: s.reducedMotion === m.reduced ? s : { ...s, reducedMotion: m.reduced }, effects: [] };
    case "scene":
      return scene(s, m.report, m.at);
    case "deadline":
      return deadline(s, m);
    default:
      return assertNever(m);
  }
}

// ---- play and its effects ----------------------------------------------------------------------------------------------

const log = (tx: Tx, level: ClientLogEntry["level"], code: string, message: string): void => {
  tx.fx.push({ kind: "log", epoch: tx.s.epoch, entry: logEntry(tx.s, level, code, message) });
};

/** A toast for NOTICE_MS (its `app/notice:<id>` deadline); those it pushes off take their deadlines with them. */
function notice(tx: Tx, text: string, level: "info" | "warn", at: Ms): void {
  const r = narrative.toast(tx.s.narrative, text, level, at);
  let deadlines = setDeadline(tx.s.deadlines, `app/notice:${r.id}`, at + NOTICE_MS);
  for (const id of r.expired) deadlines = cancelDeadline(deadlines, `app/notice:${id}`);
  tx.s = { ...tx.s, narrative: r.state, deadlines };
}

/** Steps play and routes what it asks for. `cause` is the act that led here, for its default when play leaves it. */
function toPlay(tx: Tx, e: play.Event, at: Ms): void {
  const r = play.step(tx.s.play, e);
  const stop = play.present(r.state).controls.stop;
  tx.s = { ...tx.s, play: r.state, session: tx.s.session.stop === stop ? tx.s.session : { ...tx.s.session, stop } };
  for (const fx of r.effects) playEffect(tx, fx, at, e);
}

function playEffect(tx: Tx, fx: play.Effect, at: Ms, cause: play.Event): void {
  switch (fx.kind) {
    case "send": {
      const ledger = openAnswer(tx.s.answer, tx.s.session.stop, fx.token, fx.stop, fx.body, at);
      if (!ledger) {
        // Refused before it left: play hears it as any refusal, through the one settlement route.
        toPlay(tx, { t: "settled", at, token: fx.token, how: "refused", reason: STILL_WAITING }, at);
        return;
      }
      // An answer sent closes the inspector and the hand's list it came from (live.js `closeModals` before `answer`).
      tx.s = { ...tx.s, answer: ledger, focus: close(close(tx.s.focus, "inspector"), "hand") };
      tx.fx.push({ kind: "answer", epoch: tx.s.epoch, token: fx.token, body: fx.body });
      const model = tx.s.model;
      if (fx.carried && model && "answer" in fx.body) {
        const card = model.cards.get(fx.carried.card);
        const look = { name: card?.face.name ?? card?.name ?? "", image: card?.face.img ?? null, art: card?.face.art ?? null, cost: card?.face.cost || null };
        const key = { gen: model.gen, stop: fx.stop, option: fx.body.answer[0] ?? 0, card: fx.carried.card };
        const moments = openMoment(tx.s.moments, key, fx.carried.pose, look, at);
        const held = newest(moments);
        // The held backstop: a card Forge never shows on the table again is not held for ever.
        const deadlines = held ? setDeadline(tx.s.deadlines, momentDeadline(held.id), at + HELD_LIMIT) : tx.s.deadlines;
        tx.s = { ...tx.s, moments, deadlines };
      }
      return;
    }
    case "deadline": {
      if (!isDeadlineId(fx.id) || !fx.id.startsWith("play/")) {
        log(tx, "warn", "play.deadline", `play named a deadline outside play/: ${fx.id}`);
        return;
      }
      const deadlines = fx.ms === null ? cancelDeadline(tx.s.deadlines, fx.id) : setDeadline(tx.s.deadlines, fx.id, at + fx.ms);
      tx.s = { ...tx.s, deadlines };
      return;
    }
    case "toast":
      notice(tx, fx.text, "info", at);
      return;
    case "warn":
      log(tx, "warn", "play.warn", fx.text);
      notice(tx, fx.text, "warn", at);
      return;
    case "cards":
      askCards(tx, fx.names); // card data a sheet will show that the table does not hold
      return;
    case "inspect":
      inspect(tx, fx.card);
      return;
    case "unclaimed":
      // The app's default for a tap play did not use (a drag has none yet; a dismiss went by the focus rule first).
      if (cause.t === "act" && cause.act.a === "tap") tapDefault(tx, cause.act.on);
      return;
    default:
      assertNever(fx);
  }
}

/** Asks the bridge for its decks (the Game menu's list); the reply arrives as `decks`. */
function askDecks(tx: Tx): void {
  tx.s = { ...tx.s, session: { ...tx.s.session, decks: { list: null, error: null } } };
  tx.fx.push({ kind: "decks", epoch: tx.s.epoch });
}

// ---- focus ------------------------------------------------------------------------------------------------------------

/** Opens the inspector on a card, over whatever is open (the hand's list it was picked from goes). */
function inspect(tx: Tx, card: CardId): void {
  const focus = open(close(tx.s.focus, "hand"), entry("inspector", { card, restore: tx.origin ?? null }));
  tx.s = { ...tx.s, focus };
}

const TABLE_LAYERS: ReadonlySet<string> = new Set(["stack", "clash", "lean", "sift"]);

/** A graveyard's or exile's zone group: "zone:<zone>:<seat>". */
const PILE_ZONE = /^zone:(graveyard|exile):/;

/** Whether a tap on this group opens its sift: a pile, well or summary of several cards, or a graveyard or exile with
 * cards in it (h.js: a pile sifts; a zone with cards sifts what it holds). */
function sifts(s: AppState, g: HitGroup): boolean {
  if (g.kind === "pile" || g.kind === "well" || g.kind === "summary") return g.members.length > 1;
  const z = g.kind === "zone" && g.seat !== null ? PILE_ZONE.exec(g.id)?.[1] : undefined;
  return z !== undefined && (s.model?.zone(g.seat!, z as "graveyard" | "exile").length ?? 0) > 0;
}

/**
 * A tap play left: the app's default (live.js `H.tap`, h.js's tap). A card (a hand card, a sifted card) opens the
 * inspector. On the table: a tap on the stack, set aside, brings it back, and held up opens its inspector; a pile (or a graveyard or exile with cards in
 * it) opens its sift, the stack set aside first, unless a sift is on top; another seat's plate leans in on that seat, or
 * sits back from it (not while sifting); with a layer of the table's own on top, any other tap is the tap outside that
 * takes it down; a card alone opens the inspector.
 */
function tapDefault(tx: Tx, on: play.Target): void {
  if ("card" in on) return inspect(tx, on.card);
  const f = tx.s.focus, t = top(f);
  const g = "group" in on ? tx.s.plan?.hits.groups.find((x) => x.id === on.group) : undefined;
  if (g?.kind === "stack" && isAside(f, "stack")) {
    tx.s = { ...tx.s, focus: restore(f, "stack") };
    return;
  }
  // The stack held up as the focus: its card is there to read, and a tap on it opens its inspector.
  const held = g?.kind === "stack" && t?.layer === "stack" ? g.members[0] : undefined;
  if (held !== undefined) return inspect(tx, held);
  const sifting = t?.layer === "sift";
  // Focus-first: an opponent's leaf is read by spreading it. A tap on its piles, well or regiments unfolds that seat's
  // whole board over the table (a look; one replaces another); on the sheet itself a pile sifts as anywhere.
  const me0 = tx.s.model?.viewer.perspective;
  const spreadNow = f.layers.find((e) => e.layer === "lean")?.seat ?? null;
  if (tx.s.paradigm === "front" && g && !sifting && g.seat !== null && g.seat !== me0 && g.seat !== spreadNow && g.kind !== "zone" && g.kind !== "plate" && g.members.length > 1) {
    const under = isOpen(f, "stack") ? setAside(f, "stack") : f;
    tx.s = { ...tx.s, focus: open(under, entry("lean", { seat: g.seat, restore: tx.origin ?? null })) };
    return;
  }
  if (g && !sifting && sifts(tx.s, g)) {
    const under = isOpen(f, "stack") ? setAside(f, "stack") : f;
    tx.s = { ...tx.s, focus: open(under, entry("sift", { group: g.id, restore: tx.origin ?? null })) };
    return;
  }
  const me = tx.s.model?.viewer.perspective;
  if (g?.kind === "plate" && g.seat !== null && g.seat !== me && !isOpen(f, "sift")) {
    const leaning = f.layers.find((e) => e.layer === "lean")?.seat === g.seat;
    tx.s = { ...tx.s, focus: leaning ? close(f, "lean") : open(f, entry("lean", { seat: g.seat, restore: tx.origin ?? null })) };
    return;
  }
  if (t && TABLE_LAYERS.has(t.layer)) {
    tx.s = { ...tx.s, focus: dismiss(f).focus };
    return;
  }
  const one = g && g.kind !== "plate" && g.kind !== "zone" && g.members.length === 1 ? g.members[0] : undefined;
  if (one !== undefined) inspect(tx, one);
}

/** The ledger settled an answer: tell play (the one settlement it follows) and the moments. */
function settle(tx: Tx, settled: Settled | null, at: Ms): void {
  if (!settled) return;
  toPlay(tx, { t: "settled", at, token: settled.token, how: settled.how, reason: settled.reason }, at);
  if (settled.how === "refused" || settled.how === "lost") tx.s = { ...tx.s, moments: returnFor(tx.s.moments, settled.stop, at) };
}

/** The ledger holds an answer the bridge is working on that this page did not send: play's prompt is busy for it. */
function bridgeWorking(tx: Tx, at: Ms): void {
  const p = tx.s.answer.pending;
  if (p && p.token === null && p.stop === tx.s.session.stop) toPlay(tx, { t: "working", at, stop: p.stop }, at);
}

/**
 * Whether cards are in flight between zones, as layout's `settling` takes it: the scene reported some flying, or a
 * change set it has not taken yet moves a card. Pages then keep their shape while cards leave them.
 */
export const settlingOf = (s: AppState): boolean => s.settling || s.changes.sets.some((set) => set.changes.some((c) => c.t === "moved"));

/** Recomputes the plan when its inputs changed and gives play the new hit groups. */
function plan(tx: Tx, at: Ms): void {
  const before = tx.s.plan;
  const r = replan(tx.s, play.present(tx.s.play).board, settlingOf(tx.s));
  tx.s = r.state;
  if (r.error) log(tx, "warn", "layout.plan", r.error);
  const after = tx.s.plan;
  if (after === before) return;
  if (after && after.hits.rev === before?.hits.rev) return;
  toPlay(tx, { t: "hits", at, hits: after ? after.hits : { rev: -1, groups: [] } }, at);
}

// ---- card data ----------------------------------------------------------------------------------------------------------

/** Asks the bridge for card data (catalog.ts decides which names still need asking). */
function askCards(tx: Tx, names: Iterable<string>): void {
  const r = catalogAsk(tx.s, names);
  tx.s = r.state;
  tx.fx.push(...r.effects);
}

/** Whether the snapshot's decision may be offered to play now (catalog.ts: once its cards' data is in, or capped). */
function gate(tx: Tx, model: TableModel | null, d: Decision | null, at: Ms): Gated {
  const g = gateDecision(tx.s, model, d, at);
  tx.s = g.state;
  tx.fx.push(...g.effects);
  if (g.late.length && d) log(tx, "warn", "cards.late", `decision ${d.id} offered after ${CARDS_WAIT_MS} ms without data for ${g.late.join(", ")}`);
  return g;
}

/** Card data arrived: the table is made again from the last snapshot, and play hears it as the same snapshot again
 * (offering a decision that was waiting on it). */
function cards(s: AppState, m: Extract<TransportEvent, { t: "cards" }>): Step {
  const r = takeCards(s, m);
  const tx: Tx = { s: r.state, fx: [] };
  reoffer(tx, m.at, r.model !== null);
  return done(tx);
}

/** The last snapshot again, for play: card data changed how the table reads (`changed`), or a held decision may go. */
function reoffer(tx: Tx, at: Ms, changed: boolean): void {
  const snap = tx.s.session.snap, model = tx.s.model;
  if (!snap || !model) return;
  const waited = tx.s.gate.held !== null;
  const g = gate(tx, model, snap.decision, at);
  const offered = waited && !g.held;
  if (!changed && !offered) return;
  const stopBefore = tx.s.session.stop;
  toPlay(tx, { t: "snapshot", at, model, decision: g.decision, held: g.held, continuity: "same" }, at);
  if (offered) observe(tx, snap, "same", -Infinity, at); // a status of the bridge's own answer now has a stop to hold
  if (tx.s.session.stop !== stopBefore) newStop(tx, model, at);
  plan(tx, at);
}

// ---- snapshots and answers --------------------------------------------------------------------------------------------

/** Everything a game owns, set aside for a new game, a restart or teardown. Play is not reset here: it hears of it as
 * a snapshot. The change seq goes on rising, and the next commit cuts. A restart (a new bridge process) also forgets the
 * bridge's attempt numbers; a new game on the same bridge keeps them. */
function freshGame(s: AppState, epoch: number, at: Ms, restart = false): AppState {
  return {
    ...s,
    epoch,
    model: null,
    changes: { sets: [], seq: s.changes.seq, cut: true, overflow: false },
    plan: null,
    planKey: null,
    settling: false,
    hover: null,
    layoutMemory: new Map(),
    focus: NO_FOCUS_STATE,
    moments: abandonMoments(s.moments, at),
    narrative: narrative.restart(s.narrative),
    answer: restart ? restartAnswers(s.answer, at) : supersedeAnswer(s.answer, at),
    gate: NO_GATE,
    deadlines: cancelDeadline(
      cancelDeadline(
        cancelOwned(cancelOwned(cancelOwned(s.deadlines, "play/"), "moments/"), "app/notice:"),
        CARDS_WAIT,
      ),
      RESTORE,
    ),
  };
}

/** The ledger reads a snapshot against the stop play adopted for it; play hears what it settled. `asked`: when the
 * snapshot's request was made. */
function observe(tx: Tx, snap: Snapshot, continuity: Continuity, asked: Ms, at: Ms): void {
  const before = tx.s.answer;
  tx.s = { ...tx.s, answer: observeAnswer(before, snap, tx.s.session.stop, continuity, asked, at) };
  settle(tx, settledSince(before, tx.s.answer), at);
  bridgeWorking(tx, at);
}

/** A new stop: a card still in the hand was not played; the inspector's actions were for the last stop. */
function newStop(tx: Tx, model: TableModel | null, at: Ms): void {
  tx.s = { ...tx.s, moments: returnHeld(tx.s.moments, model, at), focus: close(tx.s.focus, "inspector") };
}

interface Queued {
  readonly changes: ChangeQueue;
  /** The set just queued. */
  readonly set: ChangeSet;
  /** What must not be missed in sets the queue's own cut will skip (each set recapped once). */
  readonly recaps: readonly Recap[];
}

/**
 * A new change set, queued for the scene. Past QUEUE_LIMIT the oldest go and the next commit cuts; the cut skips every
 * set that waits, and the scene recaps nothing it cuts, so the must-not-miss moments are recapped here: every set
 * waiting when the queue first overflows (those dropped and those kept), then each set queued until the cut is drawn.
 */
function queued(q: ChangeQueue, prev: TableModel | null, next: TableModel, cut: boolean): Queued {
  const seq = q.seq + 1;
  const set: ChangeSet = diff(prev, next, seq);
  const sets = [...q.sets, set];
  const over = sets.length > QUEUE_LIMIT;
  const skipped = q.overflow ? [set] : over ? sets : [];
  const me = next.viewer.perspective;
  const mine = (id: CardId): boolean => next.cards.get(id)?.controller === me;
  return {
    changes: { sets: over ? sets.slice(-QUEUE_LIMIT) : sets, seq, cut: q.cut || cut || over, overflow: q.overflow || over },
    set,
    recaps: skipped.flatMap((c) => mustNotMiss(c, me, mine, "collapsed")),
  };
}

/** Recaps handed to the narrative (it keeps them, bounded, releases their notices and notes my losses in them) and
 * logged: the scene's, and the queue's own. */
function keepRecaps(tx: Tx, recaps: readonly Recap[], code: string): void {
  if (!recaps.length) return;
  const model = tx.s.model;
  if (model) tx.s = { ...tx.s, narrative: narrative.recapped(tx.s.narrative, recaps, model) };
  for (const c of recaps) log(tx, "info", code, `${c.how} ${c.reading} (${c.why}) seq ${c.seq}: cards ${c.cards.join(",")}`);
}

function snapshot(s: AppState, m: Extract<TransportEvent, { t: "snapshot" }>): Step {
  const { snap, continuity, at } = m;
  const epoch = Math.max(s.epoch, m.epoch);
  const reset = continuity === "newGame" || continuity === "restart";
  const tx: Tx = { s: retryFailed(reset ? freshGame(s, epoch, at, continuity === "restart") : { ...s, epoch }), fx: [] };
  const prev = tx.s.model;
  const viewer = playerViewer(snap);
  // The commanders it last saw carry on within a game (a new game or a restart has no model here).
  const known = prev && prev.gen === (snap.gen ?? 0) ? prev.commanders : undefined;
  const next: TableModel | null = viewer ? modelOf(snap, tx.s.catalog, viewer, known) : null;
  const model = next && prev && next.rev === prev.rev && next.gen === prev.gen ? prev : next;
  const stale = snap.build !== null && snap.build !== s.session.clientBuild;
  const cut = CUTS.has(continuity);
  let changes = tx.s.changes;
  let recaps: readonly Recap[] = [];
  let story = tx.s.narrative;
  if (model && model !== prev) {
    const q = queued(changes, prev, model, cut);
    ({ changes, recaps } = q);
    story = narrative.narrate(story, q.set, model); // its notices wait for the scene to play the set
  } else if (!model) changes = { sets: [], seq: changes.seq, cut: true, overflow: false };
  tx.s = {
    ...tx.s,
    session: {
      ...tx.s.session,
      bridge: snap.state,
      gen: snap.gen,
      v: snap.v,
      build: snap.build,
      stale,
      viewer,
      error: snap.error,
      over: snap.over,
      continuity,
      snap,
      decision: snap.decision,
    },
    model,
    changes,
    narrative: story,
    moments: cut && !reset ? abandonMoments(tx.s.moments, at) : tx.s.moments,
    faults: ingestOk(tx.s.faults),
  };
  keepRecaps(tx, recaps, "queue.recap");
  const stopBefore = tx.s.session.stop;
  const g = gate(tx, model, model ? snap.decision : null, at);
  toPlay(tx, { t: "snapshot", at, model, decision: g.decision, held: g.held, continuity }, at);
  observe(tx, snap, continuity, m.asked, at);
  // A held card seen on the table notes the change set that brings it: the scene takes it over once it takes that set.
  if (model) tx.s = { ...tx.s, moments: observeModel(tx.s.moments, model, tx.s.changes.seq) };
  // The game is over (or gone): nothing more will bring a held card to the table.
  if (!model || snap.state === "over" || snap.over !== null) tx.s = { ...tx.s, moments: endHeld(tx.s.moments, model, at) };
  if (tx.s.session.stop !== stopBefore) newStop(tx, model, at);
  plan(tx, at);
  if (model) askCards(tx, [...model.cards.values()].filter((c) => !c.face.catalogued).map((c) => c.name));
  // "New game" is on offer: the deck list is asked for now, so the menu opens with it.
  if (offersNewGame(tx.s) && !tx.s.session.decks) askDecks(tx);
  if (stale && !s.session.stale) log(tx, "info", "build.stale", `page ${s.session.clientBuild}, bridge ${snap.build}`);
  return done(tx);
}

function answered(s: AppState, m: Extract<TransportEvent, { t: "answered" }>): Step {
  const tx: Tx = { s, fx: [] };
  const before = s.answer;
  tx.s = { ...s, answer: answerOutcome(before, m.token, m.outcome, m.at, m.attempt ?? null) };
  settle(tx, settledSince(before, tx.s.answer), m.at);
  return done(tx);
}

// ---- the player's input -----------------------------------------------------------------------------------------------

function input(s: AppState, m: InputMsg): Step {
  const tx: Tx = { s, fx: [], origin: m.origin ?? null };
  const at = "stamp" in m ? m.stamp.at : 0;
  switch (m.t) {
    case "act":
      toPlay(tx, { t: "act", stamp: m.stamp, stop: m.stop, act: m.act }, at);
      plan(tx, at); // a combat draft changes who is involved
      return done(tx);
    case "dismiss": {
      // The top-layer rule (focus.ts): the top layer goes, or is set aside; play's sheet is play's to close. Only what
      // the last commit showed: a layer that came up since (a sheet arriving in the same frame as the Escape) stays, and
      // play hears the dismissal for the stop that was on screen, so a new decision's sheet is not closed by it.
      if (topKey(s.focus) !== s.drawn.top) return done(tx);
      const d = dismiss(s.focus);
      tx.s = { ...s, focus: d.focus };
      if (d.play) toPlay(tx, { t: "act", stamp: m.stamp, stop: s.drawn.stop, act: { a: "dismiss" } }, at);
      return done(tx);
    }
    case "restore":
      return { state: { ...s, focus: restore(s.focus, m.layer) }, effects: [] };
    case "open":
      if (m.layer === "inspector") {
        if (m.card !== null && s.model?.cards.has(m.card)) inspect(tx, m.card);
        return done(tx);
      }
      if ((m.layer === "hand" || m.layer === "log" || m.layer === "losses") && !s.model) return done(tx);
      tx.s = { ...s, focus: open(s.focus, entry(m.layer, { restore: tx.origin ?? null })) };
      // The Game menu lists the decks: asked again unless a list is in (a failure is not cached, and a reply to an ask
      // made in an older epoch is dropped).
      if (m.layer === "menu" && !s.session.decks?.list) askDecks(tx);
      return done(tx);
    case "newGame": {
      const epoch = s.epoch + 1;
      tx.s = freshGame({ ...s, session: { ...s.session, lastGame: m.req } }, epoch, at);
      toPlay(tx, { t: "snapshot", at, model: null, decision: null, continuity: "newGame" }, at);
      plan(tx, at);
      tx.fx.push({ kind: "newGame", epoch, req: m.req }, { kind: "remember", epoch, req: m.req });
      return done(tx);
    }
    case "listDecks":
      return { state: s, effects: [{ kind: "decks", epoch: s.epoch }] };
    case "dismissRecap":
      return { state: { ...s, narrative: narrative.dismissRecap(s.narrative) }, effects: [] };
    case "siftPage": {
      // A big pile is sifted a page at a time (layout `SIFT_PAGE`): the page turns, never past either end. Only the sift
      // the table shows (a spell that took the table since leaves it be), and only the one whose pager was pressed.
      const t = tableTop(s.focus);
      const e = t?.layer === "sift" && t.group === m.group ? t : undefined;
      const cards = e?.group != null && s.model && s.plan ? siftCards(s.model, s.plan, e.group) : null;
      if (!e || !cards) return done(tx);
      const page = Math.max(0, Math.min(siftPages(cards.ids.length) - 1, e.page + m.delta));
      if (page !== e.page) tx.s = { ...s, focus: { ...s.focus, layers: s.focus.layers.map((x) => (x === e ? { ...x, page } : x)) } };
      return done(tx);
    }
    case "hover":
      return { state: s.hover === m.group ? s : { ...s, hover: m.group }, effects: [] }; // paint only: no replan
  }
}

// ---- the scene's report and deadlines ----------------------------------------------------------------------------------

function scene(s: AppState, r: RenderReport, at: Ms): Step {
  // Held cards the chrome re-anchored (a resize): their moments move with them, so a flight sets off from where they are.
  const tx: Tx = { s: r.carried?.length ? { ...s, moments: moveHeld(s.moments, r.carried) } : s, fx: [] };
  const rep = r.scene;
  if (!rep) return done(tx);
  const upTo = rep.consumedSeq;
  if (upTo !== null && s.changes.sets.some((c) => c.seq <= upTo)) {
    tx.s = { ...tx.s, changes: { ...s.changes, sets: s.changes.sets.filter((c) => c.seq > upTo) } };
  }
  const o = takeOver(tx.s.moments, rep.consumedSeq, at);
  if (o.handed.length) {
    let deadlines = tx.s.deadlines;
    for (const h of o.handed) deadlines = setDeadline(deadlines, momentDeadline(h.id), at + MOMENT_LIMIT);
    tx.s = { ...tx.s, moments: o.state, deadlines };
  }
  if (rep.landed.length) {
    let deadlines = tx.s.deadlines;
    for (const id of rep.landed) deadlines = cancelDeadline(deadlines, momentDeadline(id));
    tx.s = { ...tx.s, narrative: releaseLanded(tx.s, rep.landed), moments: landMoments(tx.s.moments, rep.landed, at), deadlines };
  }
  const played = playedSeq(rep);
  if (played !== null) tx.s = { ...tx.s, narrative: narrative.release(tx.s.narrative, played) };
  keepRecaps(tx, rep.recaps, "scene.recap");
  const flying = rep.flying ?? false;
  if (flying !== tx.s.settling) tx.s = { ...tx.s, settling: flying };
  // The cards in flight have landed (or new ones set off): pages re-fit (or hold).
  if (settlingOf(tx.s) !== settlingOf(s)) plan(tx, at);
  return done(tx);
}

/**
 * The newest change set the scene has played through: the newest it has taken, or the one before it while it is still
 * moving (the set it took last is still playing). Null before it has taken any. Notices for sets up to it are released.
 */
function playedSeq(rep: SceneReport): number | null {
  const taken = rep.consumedSeq;
  return taken === null ? null : rep.active ? taken - 1 : taken;
}

/** A cast that landed has been seen: the notices up to the set that brought it are released. */
function releaseLanded(s: AppState, landed: readonly string[]): narrative.State {
  let n = s.narrative;
  for (const m of s.moments.open) if (landed.includes(m.id) && m.arrived !== null) n = narrative.release(n, m.arrived);
  return n;
}

function deadline(s: AppState, m: Extract<Msg, { t: "deadline" }>): Step {
  if (!isLive(s.deadlines, m.id, m.serial)) return { state: s, effects: [] };
  const tx: Tx = { s: { ...s, deadlines: cancelDeadline(s.deadlines, m.id) }, fx: [] };
  if (m.id.startsWith("play/")) {
    toPlay(tx, { t: "deadline", at: m.at, id: m.id }, m.at);
    plan(tx, m.at);
  } else if (m.id === RESTORE) {
    tx.s = { ...tx.s, narrative: narrative.restored(tx.s.narrative) };
  } else if (m.id === CARDS_WAIT) {
    reoffer(tx, m.at, false); // the wait for a decision's card data ran out: it goes with what there is
  } else if (m.id.startsWith("app/notice:")) {
    tx.s = { ...tx.s, narrative: narrative.expire(tx.s.narrative, Number(m.id.slice("app/notice:".length))) };
  } else if (m.id.startsWith("moments/")) {
    // A backstop: a held card ends (back to the hand, or gone); one the scene has ends as landed.
    const id = m.id.slice("moments/".length);
    const held = tx.s.moments.open.some((x) => x.id === id && x.owner === "chrome");
    const moments = held ? endHeld(tx.s.moments, tx.s.model, m.at, new Set([id])) : landMoments(tx.s.moments, [id], m.at);
    tx.s = { ...tx.s, moments };
  }
  return done(tx);
}

// ---- effects that failed ----------------------------------------------------------------------------------------------

/**
 * An effect threw when the loop ran it: the fault is counted and reported, and what it left waiting is released. A card
 * request is asked again with the next snapshot that shows its names; an answer whose request could not be made is
 * settled as lost (the prompt is free; the bridge refuses a duplicate if it did go out).
 */
export function effectFailed(s: AppState, e: Effect, message: string, at: Ms): Step {
  const tx: Tx = { s: { ...s, faults: effectFault(s.faults, `${e.kind}: ${message}`) }, fx: [] };
  if (e.kind !== "log") log(tx, "error", `effect.${e.kind}`, message);
  if (e.kind === "cards") tx.s = cardsReplied(tx.s, e.names, false);
  if (e.kind === "answer") {
    const ledger = withdrawAnswer(tx.s.answer, e.token, "lost", at);
    if (ledger) {
      const before = tx.s.answer;
      tx.s = { ...tx.s, answer: ledger };
      settle(tx, settledSince(before, ledger), at);
    }
  }
  return done(tx);
}

// ---- commits and teardown ------------------------------------------------------------------------------------------------

/** How long the restore's cue stays up once the cut back to an earlier position has been drawn (live.js: 280 ms). */
export const RESTORE_MS = 280;
/** Its deadline: when it falls due, the cue goes and the decision is asked again. */
const RESTORE = "app/restore";

/** After a commit: a cut the scene drew is done (the change queue's, or the one a renderer fault asked for), and every
 * notice waiting on motion it cut past is released. A cut back to an earlier position keeps its cue up RESTORE_MS more
 * (live.js set its timer on the frame that drew the cut). */
export function committed(s: AppState, r: RenderReport, at: Ms): AppState {
  if (r.fault !== null || !r.scene) return s;
  if (!s.changes.cut && !s.faults.cutNext) return s;
  return {
    ...s,
    changes: { ...s.changes, cut: false, overflow: false },
    faults: { ...s.faults, cutNext: false },
    narrative: narrative.release(s.narrative, "all"),
    deadlines: s.narrative.restoring ? setDeadline(s.deadlines, RESTORE, at + RESTORE_MS) : s.deadlines,
  };
}

/** Whether a commit's report has news for update (sets consumed, moments landed, recaps, cards set off or landed, a held
 * card re-anchored): the loop then folds it. */
export function sceneNews(s: AppState, r: RenderReport): boolean {
  if (r.carried?.length && movedHeld(s.moments, r.carried)) return true;
  const rep = r.scene;
  if (!rep) return false;
  const upTo = rep.consumedSeq;
  const played = playedSeq(rep);
  return (
    (rep.flying ?? false) !== s.settling ||
    rep.landed.length > 0 ||
    rep.recaps.length > 0 ||
    (upTo !== null && s.changes.sets.some((c) => c.seq <= upTo)) ||
    s.moments.open.some((m) => sceneHas(m, upTo)) ||
    (played !== null && s.narrative.notices.some((n) => n.seq <= played))
  );
}

/**
 * Teardown: a fresh state in the next epoch (every deadline and moment gone), keeping the viewport, the motion setting
 * and what makes ids unique for the page's life: play (told the game is gone), the change seq and the moment serial.
 */
export function tornDown(s: AppState, at: Ms): AppState {
  const fresh = initialState({ clientBuild: s.session.clientBuild, viewport: s.viewport, epoch: s.epoch + 1, reducedMotion: s.reducedMotion, paradigm: s.paradigm });
  const r = play.step(s.play, { t: "snapshot", at, model: null, decision: null, continuity: "newGame" });
  return {
    ...fresh,
    catalog: s.catalog,
    cardAsks: { out: new Map(), done: s.cardAsks.done, failed: new Set() }, // a request out now will never be answered in this epoch
    play: r.state,
    changes: { sets: [], seq: s.changes.seq, cut: true, overflow: false },
    moments: { ...abandonMoments(s.moments, at), open: [] },
    narrative: narrative.restart(s.narrative),
  };
}
