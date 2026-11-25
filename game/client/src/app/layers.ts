// What the chrome's layers show, projected from the model and play's controls: the inspector (common.js `inspect`
// with live.js `inspectWith`'s actions), the opening hand (live.js `mulligan`), the hand as a list (`handSheet`), the
// stack's rules (`openStackRules`), the chips of set-aside layers and the Game menu's decks. Pure.
import type { CardAction, Controls } from "../play";
import type { CardId } from "../protocol";
import { handOrder, isCreature } from "../model";
import type { Card, SeatId, TableModel } from "../model";
import type { ChipView, HandSheetView, InspectorView, MenuView, MulliganView, SiftView, StackRow } from "../chrome";
import { SIFT_PAGE, siftOf, siftPages } from "../layout";
import type { TablePlan } from "../layout";
import { siftCards } from "../scene/stage/describe";
import type { SeatPlace } from "../theme";
import type { FocusState } from "./focus";
import type { AppState } from "./state";

const PLACES: readonly SeatPlace[] = ["near", "left", "across", "right"];
const placeOf = (model: TableModel, seat: SeatId): SeatPlace => PLACES[Math.max(0, model.seats.findIndex((s) => s.id === seat)) % PLACES.length] ?? "near";
const seatName = (model: TableModel, seat: SeatId | null): string => (seat === null ? "" : (model.seat(seat)?.name ?? String(seat)));

const ZONE_LABEL: Readonly<Record<string, string>> = {
  battlefield: "Battlefield",
  graveyard: "Graveyard",
  exile: "Exile",
  command: "Command zone",
  stack: "On the stack",
  hand: "Hand",
  library: "Library",
};

/** common.js `CTR`: counters by the words a player uses. */
const COUNTER: Readonly<Record<string, string>> = { P1P1: "+1/+1", M1M1: "-1/-1", LOYALTY: "loyalty" };

/** The facts the leaf says in words (common.js `inspect`'s chips). A keyword the rules text already says is not said
 * twice (live.js `inspectWith`). */
function factsOf(c: Card): string[] {
  const chips: string[] = [];
  if (c.commander) chips.push("Commander");
  if (c.token) chips.push("Token");
  if (c.tapped) chips.push("Tapped");
  if (c.sick) chips.push("Summoning sick");
  if (isCreature(c) && c.power !== null && c.toughness !== null) {
    const printed = c.power !== c.face.basePower || c.toughness !== c.face.baseToughness ? ` (printed ${c.face.basePower}/${c.face.baseToughness})` : "";
    chips.push(`${c.power}/${c.toughness}${printed}`);
  }
  for (const [k, v] of Object.entries(c.counters)) chips.push(`${v} ${COUNTER[k] ?? k.toLowerCase()} counter${v > 1 ? "s" : ""}`);
  const said = c.faceDown ? "" : c.face.text;
  for (const k of c.keywords) {
    const plain = /^[A-Z][a-z]+( [a-z]+)?$/.test(k);
    if (plain && new RegExp(`(^|\\n|, )${k}\\b`, "i").test(said)) continue;
    chips.push(k);
  }
  return chips;
}

const tile = (c: Card): { id: CardId; name: string; image: string | null } => ({ id: c.id, name: c.face.name, image: c.faceDown ? null : c.face.img });

/** The inspector's leaf for a card, or null when the table no longer has it. */
export function inspectorOf(model: TableModel, id: CardId, actions: readonly CardAction[]): InspectorView | null {
  const c = model.cards.get(id);
  if (!c) return null;
  const owner = [seatName(model, c.controller)];
  if (c.owner !== c.controller) owner.push(`owned by ${seatName(model, c.owner)}`);
  owner.push(ZONE_LABEL[c.zone] ?? c.zone);
  const related: { label: string; cards: ReturnType<typeof tile>[] }[] = [];
  const attached = model.attachments(id).flatMap((a) => {
    const x = model.cards.get(a);
    return x ? [tile(x)] : [];
  });
  if (attached.length) related.push({ label: "Attached", cards: attached });
  const host = c.attachedTo === null ? undefined : model.cards.get(c.attachedTo);
  if (host) related.push({ label: "Attached to", cards: [tile(host)] });
  const mine = c.controller === model.viewer.perspective;
  return {
    card: id,
    name: c.faceDown && !mine ? "Face-down card" : c.face.name,
    image: c.faceDown ? null : c.face.img,
    faceDown: c.faceDown,
    caption: c.faceDown ? "Face down" : c.copy ? `Copying ${c.face.name}` : null,
    place: placeOf(model, c.controller),
    owner: owner.join(" · "),
    chips: factsOf(c),
    related,
    rules: c.faceDown ? null : c.face.text || null,
    actions,
  };
}

/** The opening hand: the question (play's headline) and the cards, in hand order. */
export function mulliganOf(model: TableModel, controls: Controls): MulliganView | null {
  const p = controls.prompt;
  if (!p || p.style !== "overlay") return null;
  const me = model.viewer.perspective;
  const cards = model
    .zone(me, "hand")
    .map((id) => model.cards.get(id))
    .filter((c): c is Card => c !== undefined)
    .sort(handOrder);
  return { title: p.headline, cards: cards.map(tile) };
}

/** The hand as a list: each card, its cost, whether it has a play now. */
export function handSheetOf(model: TableModel, playable: ReadonlySet<CardId>, fresh: readonly CardId[]): HandSheetView {
  const me = model.viewer.perspective;
  const cards = model
    .zone(me, "hand")
    .map((id) => model.cards.get(id))
    .filter((c): c is Card => c !== undefined)
    .sort(handOrder);
  return { cards: cards.map((c) => ({ id: c.id, name: c.face.name, cost: c.face.cost || null, playable: playable.has(c.id), fresh: fresh.includes(c.id) })) };
}

/** live.js `abilityText`, in full: the engine's words for an ability without its card's name in front. */
const abilityText = (text: string, name: string): string => {
  const t = text.trim(), prefix = `${name} - `;
  return t.startsWith(prefix) ? t.slice(prefix.length) : t;
};

/** The stack, top first: whose each item is, what an ability does, the card's rules. */
export function stackRowsOf(model: TableModel): StackRow[] {
  return [...model.stack].reverse().map((it) => {
    const c = it.source === null ? undefined : model.cards.get(it.source);
    const name = c?.face.name ?? it.text;
    const who = it.controller === null ? "Controller unrecorded" : seatName(model, it.controller);
    const rules = c && !c.faceDown ? c.face.text || null : null;
    const effect = it.spell ? null : abilityText(it.text, name) || null;
    return { id: it.id, title: `${name} · ${who}`, effect, rules: rules !== effect ? rules : null };
  });
}

/** The chips of the layers set aside. */
export function chipViewsOf(focus: FocusState, model: TableModel | null): ChipView[] {
  return focus.aside.flatMap((e): ChipView[] => {
    if (e.layer === "stack") return model && model.stack.length ? [{ layer: "stack", label: `Stack: ${model.stack.length}` }] : [];
    if (e.layer === "mulligan") return [{ layer: "mulligan", label: "Your opening hand" }];
    return [];
  });
}

/** The Game menu's decks and what it starts from. */
export function menuOf(s: AppState): MenuView {
  const d = s.session.decks;
  return { decks: d ? (d.list ?? (d.error ? [] : null)) : null, error: d?.error ?? null, last: s.session.lastGame };
}

/**
 * The caption of a sift up (h.js `sift`): a graveyard or exile by whose it is, a pile by its one name or its kind, with
 * how many and how many are tapped; its pages when it has more than `SIFT_PAGE`. Null when the plan has no such group.
 */
export function siftViewOf(model: TableModel, plan: TablePlan, group: string, page: number): SiftView | null {
  const all = siftCards(model, plan, group);
  if (!all || !all.ids.length) return null;
  const n = all.ids.length;
  const seat = plan.hits.groups.find((g) => g.id === group)?.seat ?? null;
  const whose = seat === model.viewer.perspective ? "Your" : `${seatName(model, seat)}'s`;
  const cards = all.ids.map((id) => model.cards.get(id)).filter((c): c is Card => c !== undefined);
  const names = new Set(cards.map((c) => c.face.name));
  const kind = cards.every((c) => /\bLand\b/.test(c.face.type)) ? "lands" : cards.every(isCreature) ? "creatures" : "cards";
  const what = all.zone ? `${whose} ${all.zone}` : names.size === 1 ? [...names][0]! : `${whose} ${kind}`;
  const title = n > 1 ? `${what} ×${n}` : what;
  const pages = siftPages(n), p = Math.max(0, Math.min(pages - 1, page));
  const from = p * SIFT_PAGE, to = Math.min(n, from + SIFT_PAGE);
  const places = siftOf(plan.viewport, all.tapped.slice(from, to));
  return {
    group,
    title,
    tapped: all.tapped.filter(Boolean).length,
    page: p,
    pages,
    range: pages > 1 ? `${from + 1}–${to} of ${n}` : null,
    top: Math.min(...places.map((q) => q.rect.top)),
  };
}
