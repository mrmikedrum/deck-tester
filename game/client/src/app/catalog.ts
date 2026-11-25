// Card data: the catalog the bridge serves (`/api/cards`), what has been asked of it and what has come back, and the
// table made again from the last snapshot when data arrives. Names are asked once a page (a failed request is asked
// again with the next snapshot that shows them), in batches short enough for a URL; a reply from an older epoch is
// discarded by the loop, so its names are asked again.
//
// A failed request's names wait for the next snapshot; asking them again at once would retry a failing bridge as fast
// as it fails.
//
// When a decision becomes actionable: the table shows as soon as a snapshot arrives, but a new decision is offered to
// play only once the data for the cards it is about (play's `cardsWanted`: its options, the stack's top and its targets)
// has come back, or CARDS_WAIT_MS after it arrived, when it goes with what there is (and the router logs what was
// missing). Until then play shows the prompt waiting, with no buttons and no auto-pass. The same decision in later
// snapshots is not held again. Pure: the router (update.ts) tells play and replans.
import { decodeCatalog, FACE_DOWN, modelOf } from "../model";
import type { TableModel } from "../model";
import { cardsWanted } from "../play";
import type { Ms } from "../platform";
import type { Decision } from "../protocol";
import type { TransportEvent } from "../transport";
import { cancelDeadline, setDeadline } from "./deadlines";
import type { Effect } from "./effects";
import type { DeadlineId } from "./ids";
import type { AppState } from "./state";
import { NO_GATE } from "./state";

/** Batches of names per request, so a URL stays short. */
const CARDS_PER_REQUEST = 40;

interface Asked {
  readonly state: AppState;
  readonly effects: readonly Effect[];
}

/** Whether a name's data has come back (the catalog has it, or the bridge answered for it and had none). */
const arrived = (s: AppState, name: string): boolean => name === FACE_DOWN || s.catalog.has(name) || s.cardAsks.done.has(name);

/** Asks the bridge for card data it has not answered, nor been asked for in this epoch. */
export function askCards(s: AppState, names: Iterable<string>): Asked {
  const { out, done, failed } = s.cardAsks, epoch = s.epoch;
  const want = [...new Set(names)].filter((n) => n && n !== FACE_DOWN && !done.has(n) && !failed.has(n) && out.get(n) !== epoch && !s.catalog.has(n));
  if (!want.length) return { state: s, effects: [] };
  const asked = new Map(out);
  for (const n of want) asked.set(n, epoch);
  const effects: Effect[] = [];
  for (let i = 0; i < want.length; i += CARDS_PER_REQUEST) effects.push({ kind: "cards", epoch, names: want.slice(i, i + CARDS_PER_REQUEST) });
  return { state: { ...s, cardAsks: { ...s.cardAsks, out: asked } }, effects };
}

/** These names' request is over: answered (`done`), or failed and to be asked again with the next snapshot. */
export function cardsReplied(s: AppState, names: readonly string[], answered: boolean): AppState {
  const out = new Map(s.cardAsks.out);
  for (const n of names) out.delete(n);
  const { done, failed } = s.cardAsks;
  return {
    ...s,
    cardAsks: answered ? { out, done: new Set([...done, ...names]), failed } : { out, done, failed: new Set([...failed, ...names]) },
  };
}

/** A snapshot arrived: names whose request failed may be asked again. */
export const retryFailed = (s: AppState): AppState => (s.cardAsks.failed.size ? { ...s, cardAsks: { ...s.cardAsks, failed: new Set() } } : s);

interface Taken {
  readonly state: AppState;
  /** The table made again from the last snapshot with the new data; null when it reads the same (or there is none). */
  readonly model: TableModel | null;
}

/** A /api/cards reply: merged into the catalog, and the table made again from the last snapshot (no change set: only how
 * cards look and read changed). A failed one leaves its names to be asked again. */
export function takeCards(s: AppState, m: Extract<TransportEvent, { t: "cards" }>): Taken {
  if (m.json === null) return { state: cardsReplied(s, m.names, false), model: null };
  const state = { ...cardsReplied(s, m.names, true), catalog: decodeCatalog(m.json, s.catalog) };
  const snap = s.session.snap, viewer = s.session.viewer, prev = s.model;
  if (!snap || !viewer || !prev) return { state, model: null };
  const model = modelOf(snap, state.catalog, viewer, prev.commanders);
  if (!model || model.gen !== prev.gen || model.rev === prev.rev) return { state, model: null };
  return { state: { ...state, model }, model };
}

/** How long a decision waits for its cards' data before it is offered with what there is (the old client's 1.2 s). */
export const CARDS_WAIT_MS = 1200;
/** The wait's deadline: when it falls due, the held decision is offered. */
export const CARDS_WAIT: DeadlineId = "app/cards-wait";

export interface Gated extends Asked {
  /** The decision to offer play now; null while it is held, or when there is none. */
  readonly decision: Decision | null;
  /** A decision is held back: play shows the prompt waiting. */
  readonly held: boolean;
  /** Offered at the cap without these names' data. */
  readonly late: readonly string[];
}

/** Whether the snapshot's decision may be offered to play at `at`, asking for the data it waits on. */
export function gateDecision(s: AppState, model: TableModel | null, d: Decision | null, at: Ms): Gated {
  if (!model || !d) return { state: { ...s, gate: NO_GATE, deadlines: cancelDeadline(s.deadlines, CARDS_WAIT) }, effects: [], decision: null, held: false, late: [] };
  const id = `${model.gen}|${d.id}|${d.key}`;
  const g = s.gate;
  if (g.offered === id) return { state: s, effects: [], decision: d, held: false, late: [] };
  const missing = cardsWanted(model, d).filter((n) => !arrived(s, n));
  const waiting = g.held?.id === id;
  const since = waiting ? g.held!.since : at;
  // Compared with the deadline's own time, never as a difference: (since + wait) - since can fall short of the wait.
  const due = since + CARDS_WAIT_MS;
  if (missing.length && at < due) {
    const asked = askCards(s, missing);
    const deadlines = waiting ? asked.state.deadlines : setDeadline(asked.state.deadlines, CARDS_WAIT, due);
    return { state: { ...asked.state, gate: { held: { id, since }, offered: g.offered }, deadlines }, effects: asked.effects, decision: null, held: true, late: [] };
  }
  return { state: { ...s, gate: { held: null, offered: id }, deadlines: cancelDeadline(s.deadlines, CARDS_WAIT) }, effects: [], decision: d, held: false, late: missing };
}
