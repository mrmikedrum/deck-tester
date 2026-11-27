// What each renderer is handed per commit, projected from app state: the scene's frame (model, plan, change sets,
// cues, focus, moments) and the chrome's view (play's controls, the hand, the reserve, the layers, the narrative's log,
// losses and watching headline, the newest toast). Pure.
import type { CardLook, ChromeView, HandCard, HandView } from "../chrome";
import type { CardId } from "../protocol";
import { handOrder, isCreatureSweep, topOf } from "../model";
import * as narrative from "../narrative";
import type { Card, TableModel } from "../model";
import * as play from "../play";
import type { Carried } from "../play";
import type { FocusTop, HighlightRequest, HighlightTone, MomentView, SceneFrame, SceneReport } from "../scene/stage/types";
import { focusTopOf, isOpen, sheetFocusOf, tableTop } from "./focus";
import { feedWidthOf, platesOf, seatFocusOf } from "./seats";
import { chipViewsOf, handSheetOf, inspectorOf, menuOf, mulliganOf, siftViewOf, stackRowsOf } from "./layers";
import { sceneHas } from "./moments";
import { offersNewGame, waitingLine } from "./readout";
import type { AppState } from "./state";
import { clashViewOf, withTallies } from "./clash";
import { settlingOf } from "./update";

/** What the scene is handed of the focus: the top layer and its subject. */
export const focusTop = (s: AppState): FocusTop => focusTopOf(s.focus);

/** The scene's frame, or null while there is nothing to draw (no model, or no plan for it). */
export function sceneFrame(s: AppState): SceneFrame | null {
  if (!s.model || !s.plan) return null;
  const moments: MomentView[] = s.moments.open.map((m) => ({ id: m.id, card: m.key.card, pose: m.from, owner: m.owner }));
  const cues = play.present(s.play).board;
  const highlight = targetsHighlight(s, cues);
  return {
    model: s.model,
    plan: s.plan,
    changes: s.changes.sets,
    mode: s.changes.cut || s.faults.cutNext ? "cut" : "animate",
    cues,
    focus: focusTop(s),
    moments,
    hover: s.hover,
    commit: s.commit,
    reducedMotion: s.reducedMotion,
    ...(highlight ? { highlight } : {}),
    ...(s.narrative.arrived.length ? { news: s.narrative.arrived } : {}),
    ...(s.zoom.on !== null ? { zoom: s.zoom.on } : {}),
  };
}

/**
 * Choosing targets steps the cards I may choose out of the table's light (ember), and the ones chosen so far (gold),
 * over a light dim. Only the look: what may be chosen, and what a tap sends, are play's as before.
 */
function targetsHighlight(s: AppState, cues: play.BoardCues): HighlightRequest | null {
  if (s.session.decision?.kind !== "targets") return null;
  const cards = new Map<CardId, HighlightTone>();
  for (const [id, m] of cues.marks.cards) if (m === "option" || m === "selected") cards.set(id, m === "selected" ? "spell" : "mine");
  return cards.size ? { cards } : null;
}

/** live.js: an instant or sorcery shows its rules on the opened card. */
const spellText = (c: Card): string | null => (/\b(?:Instant|Sorcery)\b/.test(c.face.type) ? c.face.text || null : null);

function handCard(c: Card, playable: boolean): HandCard {
  return {
    id: c.id,
    name: c.face.name,
    cost: c.face.cost || null,
    ...(c.castCost ? { castCost: c.castCost } : {}),
    art: c.face.art,
    image: c.face.img,
    rules: spellText(c),
    playable,
  };
}

/** A chooser of cards up (a library search, a graveyard): the hand slides away, as for a sift, and the cards have the
 * screen. */
function choosingCards(s: AppState, model: TableModel): boolean {
  const sheet = play.present(s.play).controls.sheet;
  if (sheet?.kind !== "chooser" || !isOpen(s.focus, "sheet")) return false;
  return sheet.items.some((i) => (i.card !== null && model.cards.has(i.card)) || (i.name !== null && s.catalog.has(i.name)));
}

function handOf(s: AppState, model: TableModel, scene: SceneReport | null): HandView {
  const { board, controls } = play.present(s.play);
  const me = model.viewer.perspective;
  const cards = model
    .zone(me, "hand")
    .map((id) => model.cards.get(id))
    .filter((c): c is Card => c !== undefined)
    .sort(handOrder);
  const carried: Carried[] = [];
  const sheetCarried = controls.sheet?.carried ?? null;
  if (sheetCarried) carried.push(sheetCarried);
  // A held card the scene has just taken over (this commit's report) is the scene's to draw from now on.
  const consumed = scene?.consumedSeq ?? null;
  for (const m of s.moments.open)
    if (m.owner === "chrome" && !sceneHas(m, consumed) && m.key.card !== sheetCarried?.card) carried.push({ card: m.key.card, pose: m.from });
  const top = model.stack[model.stack.length - 1];
  return {
    cards: cards.map((c) => handCard(c, board.marks.hand.has(c.id))),
    away: board.handAway || isOpen(s.focus, "sift") || isOpen(s.focus, "lean") || isOpen(s.focus, "mulligan") || choosingCards(s, model),
    respond: !!top && top.controller !== me && board.marks.hand.size > 0,
    carried,
    // The cards that last came into my hand (live.js `lastHandArrivals`) glow as they join the fan.
    fresh: s.narrative.fresh.filter((id) => model.cards.get(id)?.zone === "hand"),
  };
}

/**
 * live.js `status`'s `rewind`: back at an earlier position, the prompt on a play decision I may answer now says so
 * (the cue, then "Your decision · <phase>"), unless the table is moving or Sunfall is up, which the old prompt said first.
 */
function restoreOf(s: AppState, model: TableModel, watching: boolean): narrative.RestoreView | null {
  const p = play.present(s.play).controls;
  const d = s.session.decision;
  if (
    !p.mayAnswer ||
    !p.prompt ||
    p.prompt.busy ||
    s.gate.held !== null ||
    d?.kind !== "play" ||
    model.over ||
    s.session.over !== null ||
    watching
  )
    return null;
  const top = topOf(model);
  if (top && isCreatureSweep(top, model)) return null;
  return narrative.restoreView(s.narrative, model);
}

/** Pictures for sheet items the table does not hold (a hidden card a chooser offers by name), from the catalog. */
function namedOf(s: AppState): Map<string, CardLook> {
  const named = new Map<string, CardLook>();
  for (const item of play.present(s.play).controls.sheet?.items ?? []) {
    if (item.card !== null || item.name === null) continue;
    const f = s.catalog.get(item.name)?.faces[0];
    if (f) named.set(item.name, { name: f.name, image: f.img, art: f.art, cost: f.cost || null });
  }
  return named;
}

/** Pictures for what the chrome may show off the hand: sheet items' cards and the cards moments carry. */
function looksOf(s: AppState, model: TableModel | null): Map<CardId, CardLook> {
  const looks = new Map<CardId, CardLook>();
  for (const m of s.moments.open) looks.set(m.key.card, m.look);
  const sheet = play.present(s.play).controls.sheet;
  for (const item of sheet?.items ?? []) {
    const c = item.card === null ? undefined : model?.cards.get(item.card);
    if (c) looks.set(c.id, { name: c.face.name, image: c.face.img, art: c.face.art, cost: c.face.cost || null });
  }
  return looks;
}

/** The chrome's view. `scene` is this commit's scene report, when the scene drew first: a held card it took over in
 * this commit is let go in this same commit. */
export function chromeView(s: AppState, scene: SceneReport | null = null, measure?: (text: string, font: string) => number): ChromeView {
  const model = s.model;
  const { controls, board } = play.present(s.play);
  const n = s.narrative;
  const toast = n.toasts[n.toasts.length - 1] ?? null;
  const f = s.focus;
  const inspected = f.layers.find((e) => e.layer === "inspector")?.card ?? null;
  const seatOpen = f.layers.find((e) => e.layer === "seat")?.seat ?? null;
  // A sheet's caption shows while the table shows the sheet: a spell that took the table since hides it with its cards.
  const sheet = sheetFocusOf(tableTop(f));
  const watch = narrative.watching(n, model, settlingOf(s));
  return {
    commit: s.commit,
    viewport: s.viewport,
    reserve: s.reserve,
    controls,
    hand: model ? handOf(s, model, scene) : { cards: [], away: true, respond: false, carried: [], fresh: [] },
    looks: looksOf(s, model),
    named: namedOf(s),
    toast: toast?.text ?? null,
    waiting: model ? null : waitingLine(s),
    layers: f.layers.map((e) => ({ layer: e.layer, restore: e.restore })),
    chips: chipViewsOf(f, model),
    inspector: model && inspected !== null ? inspectorOf(model, inspected, controls.cardActions.get(inspected) ?? []) : null,
    mulligan: model && isOpen(f, "mulligan") ? mulliganOf(model, controls) : null,
    menu: isOpen(f, "menu") ? menuOf(s) : null,
    handSheet: model && isOpen(f, "hand") ? handSheetOf(model, board.marks.hand, n.fresh) : null,
    stack: model && controls.sheet?.kind === "stack" ? stackRowsOf(model) : [],
    sift: model && s.plan && sheet ? siftViewOf(model, s.plan, sheet.focus, sheet.page, sheet.choosing) : null,
    newGame: offersNewGame(s),
    stackOpen: isOpen(f, "stack"),
    log: narrative.logStripView(n, model),
    logWidth: feedWidthOf(s.plan, s.viewport),
    logSheet: model && isOpen(f, "log") ? narrative.logSheetView(n) : null,
    losses: model && isOpen(f, "losses") ? narrative.lossReport(n) : null,
    recap: model ? narrative.recapView(n) : null,
    watch,
    restore: model ? restoreOf(s, model, watch !== null) : null,
    plates: model ? withTallies(platesOf(model, s.plan, board.marks.seats, s.viewport, measure, castable(model, s.session.decision)), model, s.plan) : [],
    clash: model ? clashViewOf(model, s.plan) : null,
    seatFocus: model && seatOpen ? seatFocusOf(model, seatOpen) : null,
  };
}

/** My cards waiting in the command zone that a play offered now casts (a spell, not an ability activated from there):
 *  each one's portrait wears the ember, and only its. */
export function castable(model: TableModel, d: AppState["session"]["decision"]): ReadonlySet<number> {
  if (d?.kind !== "play") return new Set();
  const waiting = new Set<number>(model.zone(model.viewer.perspective, "command"));
  const out = new Set<number>();
  for (const r of d.refs as readonly { readonly card?: number | null; readonly spell?: boolean }[]) if (r.card != null && r.spell && waiting.has(r.card)) out.add(r.card);
  return out;
}

