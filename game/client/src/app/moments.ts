// Moments across both renderers (docs/game-client-architecture.md, "Moments across both renderers"): a card released
// from the hand and sent opens a moment with the pose it was let go at. The chrome draws it held there until the scene
// can draw it from that pose: a snapshot shows the card anywhere but the hand (the change set that brings it is noted),
// and the chrome lets it go in the commit whose scene report says that set was taken (the scene's flight sets off
// from the pose then); ownership passes to the scene with it. Each moment ends exactly once:
//   landed     the scene reports its flight ended (or, as a backstop, MOMENT_LIMIT after it took the card over)
//   returned   the answer was refused or lost, or a new decision came with the card still in the hand, or the game
//              ended (or the held backstop fired) with the card in the hand
//   abandoned  the table was cut (a new game, a restart, a rewind, teardown), or the game ended (or HELD_LIMIT passed)
//              with the card never seen on the table
import type { CardId, StopId } from "../protocol";
import type { TableModel } from "../model";
import type { Ms, ScreenPose } from "../play";

export type MomentId = string;
export type MomentEnd = "landed" | "returned" | "abandoned";

/** What was sent: the game, the stop, the option and the card. */
export interface MomentKey {
  readonly gen: number;
  readonly stop: StopId;
  readonly option: number;
  readonly card: CardId;
}

export interface Moment {
  readonly id: MomentId;
  readonly key: MomentKey;
  /** Where the chrome let the card go. */
  readonly from: ScreenPose;
  /** Who draws the card this commit. */
  readonly owner: "chrome" | "scene";
  /** How the chrome draws it while it holds it (the card may already be gone from the model's hand). */
  readonly look: { readonly name: string; readonly image: string | null; readonly art: string | null; readonly cost: string | null };
  /** When it was opened, and when the scene took it over. */
  readonly at: Ms;
  readonly handed: Ms | null;
  /** The change set (seq) that first shows the card off the hand while the chrome holds it; the scene takes the card
   * over once it has taken that set. */
  readonly arrived: number | null;
}

export interface MomentsState {
  readonly open: readonly Moment[];
  /** The last few that ended, newest last (for tests and the debug surface). */
  readonly ended: readonly { readonly id: MomentId; readonly card: CardId; readonly end: MomentEnd; readonly at: Ms }[];
  /** Never reset, so a moment id is never reused in a page's life. */
  readonly serial: number;
}

export const NO_MOMENTS: MomentsState = { open: [], ended: [], serial: 0 };

/** A scene-owned moment whose landing is never reported (a collapsed set, a renderer fault) ends this long after. */
export const MOMENT_LIMIT = 3000;
/** A held moment whose card is never seen on the table (Forge keeps it out of sight; the scene never draws) ends this
 * long after it was opened: long enough for a slow choice of targets while the card is held. */
export const HELD_LIMIT = 120_000;
const ENDED_KEPT = 16;

export const momentDeadline = (id: MomentId): `moments/${string}` => `moments/${id}`;

function finish(s: MomentsState, ids: ReadonlySet<MomentId>, end: MomentEnd, at: Ms): MomentsState {
  if (!s.open.some((m) => ids.has(m.id))) return s;
  const done = s.open.filter((m) => ids.has(m.id)).map((m) => ({ id: m.id, card: m.key.card, end, at }));
  return { ...s, open: s.open.filter((m) => !ids.has(m.id)), ended: [...s.ended, ...done].slice(-ENDED_KEPT) };
}

/** Opens a moment for a released card that was sent. One card is carried by one moment: an older one is returned. */
export function openMoment(s: MomentsState, key: MomentKey, from: ScreenPose, look: Moment["look"], at: Ms): MomentsState {
  const older = new Set(s.open.filter((m) => m.key.card === key.card).map((m) => m.id));
  const base = finish(s, older, "returned", at);
  const serial = base.serial + 1;
  const m: Moment = { id: `m${serial}`, key, from, owner: "chrome", look, at, handed: null, arrived: null };
  return { ...base, open: [...base.open, m], serial };
}

/** The newest moment opened (its id, for its backstop). */
export const newest = (s: MomentsState): Moment | null => s.open[s.open.length - 1] ?? null;

const samePose = (a: ScreenPose, b: ScreenPose): boolean =>
  a.rotation === b.rotation && a.scale === b.scale && a.rect.left === b.rect.left && a.rect.top === b.rect.top && a.rect.right === b.rect.right && a.rect.bottom === b.rect.bottom;

/** The held moments the chrome now draws at another pose than `from` (`drawn`: a resize re-anchored the card). */
export const movedHeld = (s: MomentsState, drawn: readonly { readonly card: CardId; readonly pose: ScreenPose }[]): boolean =>
  drawn.some((d) => s.open.some((m) => m.owner === "chrome" && m.key.card === d.card && !samePose(m.from, d.pose)));

/** The chrome drew held cards at new poses (a resize re-anchored them to the hand's new place): their moments take
 * them, so the scene's flight sets off from where the card is drawn. A card the scene has taken over keeps its pose. */
export function moveHeld(s: MomentsState, drawn: readonly { readonly card: CardId; readonly pose: ScreenPose }[]): MomentsState {
  if (!movedHeld(s, drawn)) return s;
  const open = s.open.map((m) => {
    const d = m.owner === "chrome" ? drawn.find((x) => x.card === m.key.card) : undefined;
    return d && !samePose(m.from, d.pose) ? { ...m, from: d.pose } : m;
  });
  return { ...s, open };
}

/** A snapshot was taken: a held card seen anywhere but the hand notes `seq`, the change set that brings it. */
export function observeModel(s: MomentsState, model: TableModel, seq: number): MomentsState {
  let changed = false;
  const open = s.open.map((m) => {
    if (m.owner !== "chrome" || m.arrived !== null) return m;
    const card = model.cards.get(m.key.card);
    if (!card || card.zone === "hand") return m;
    changed = true;
    return { ...m, arrived: seq };
  });
  return changed ? { ...s, open } : s;
}

/** Whether the scene, having taken change sets up to `consumedSeq`, draws this held card from its pose now. */
export const sceneHas = (m: Moment, consumedSeq: number | null): boolean =>
  m.owner === "chrome" && m.arrived !== null && consumedSeq !== null && consumedSeq >= m.arrived;

/** The scene took the change sets up to `consumedSeq`: the held cards they bring pass to it. Returns those handed. */
export function takeOver(s: MomentsState, consumedSeq: number | null, at: Ms): { state: MomentsState; handed: readonly Moment[] } {
  const handed: Moment[] = [];
  const open = s.open.map((m) => {
    if (!sceneHas(m, consumedSeq)) return m;
    const next: Moment = { ...m, owner: "scene", handed: at };
    handed.push(next);
    return next;
  });
  return handed.length ? { state: { ...s, open }, handed } : { state: s, handed };
}

/** The game ended, or a held moment's backstop fired: what the chrome still holds goes back to the hand if the card is
 * there, and vanishes otherwise (it was never seen on the table). `ids` limits it to those moments. */
export function endHeld(s: MomentsState, model: TableModel | null, at: Ms, ids?: ReadonlySet<MomentId>): MomentsState {
  const held = s.open.filter((m) => m.owner === "chrome" && (!ids || ids.has(m.id)));
  if (!held.length) return s;
  const inHand = (m: Moment) => model?.cards.get(m.key.card)?.zone === "hand";
  const back = finish(s, new Set(held.filter(inHand).map((m) => m.id)), "returned", at);
  return finish(back, new Set(held.filter((m) => !inHand(m)).map((m) => m.id)), "abandoned", at);
}

/** A new decision: a card still in the hand was not played after all. */
export function returnHeld(s: MomentsState, model: TableModel | null, at: Ms): MomentsState {
  const ids = new Set(s.open.filter((m) => m.owner === "chrome" && model?.cards.get(m.key.card)?.zone === "hand").map((m) => m.id));
  return finish(s, ids, "returned", at);
}

/** The answer for `stop` was refused or lost: what the chrome still holds for it goes back to the hand. */
export function returnFor(s: MomentsState, stop: StopId, at: Ms): MomentsState {
  return finish(s, new Set(s.open.filter((m) => m.owner === "chrome" && m.key.stop === stop).map((m) => m.id)), "returned", at);
}

/** The scene reports these flights ended (or their backstop fired). */
export function landMoments(s: MomentsState, ids: readonly MomentId[], at: Ms): MomentsState {
  return finish(s, new Set(ids), "landed", at);
}

/** A cut: everything in progress vanishes with it. */
export function abandonMoments(s: MomentsState, at: Ms): MomentsState {
  return finish(s, new Set(s.open.map((m) => m.id)), "abandoned", at);
}
