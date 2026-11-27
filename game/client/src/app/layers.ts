// What the chrome's layers show, projected from the model and play's controls: the inspector (common.js `inspect`
// with live.js `inspectWith`'s actions), the opening hand (live.js `mulligan`), the hand as a list (`handSheet`), the
// stack's rules (`openStackRules`), the chips of set-aside layers and the Game menu's decks. Pure.
import type { CardAction, Controls } from "../play";
import type { CardId } from "../protocol";
import { abilityTargetNames, abilityText, asides, handOrder, isCreature, stackValues } from "../model";
import type { Card, SeatId, TableModel } from "../model";
import type { ChipView, HandSheetView, InspectorView, MenuView, MulliganView, SiftView, StackRow } from "../chrome";
import { sheetOf } from "../layout";
import type { SheetFocus, TablePlan } from "../layout";
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
  // What it has on the stack: the stack's rules live here, a tap on the card held up away.
  const stack = model.stack
    .filter((it) => it.source === id)
    .map((it) => {
      const who = it.controller === null ? "Controller unrecorded" : seatName(model, it.controller);
      const effect = it.spell ? "" : abilityText(it.text, c.face.name);
      const targets = it.targets.map((t) => ("seat" in t ? seatName(model, t.seat) : model.cards.get(t.card)?.face.name)).filter(Boolean);
      targets.push(...abilityTargetNames(it, model.stack, (id) => model.cards.get(id)?.face.name));
      return [it.spell ? "Spell" : "Ability", who, effect, ...stackValues(it), targets.length ? `Targets ${targets.join(", ")}` : ""].filter(Boolean).join(" · ");
    });
  return {
    card: id,
    // A card in my hand is held up in the hand's focus, the fan live under it.
    ...(c.zone === "hand" && c.owner === model.viewer.perspective ? { held: true } : {}),
    name: c.faceDown && !mine ? "Face-down card" : c.face.name,
    image: c.faceDown ? null : c.face.img,
    faceDown: c.faceDown,
    caption: c.faceDown ? "Face down" : c.copy ? `Copying ${c.face.name}` : null,
    place: placeOf(model, c.controller),
    owner: owner.join(" · "),
    chips: factsOf(c),
    related,
    rules: c.faceDown ? null : c.face.text || null,
    ...(stack.length ? { stack } : {}),
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
    if (e.layer === "stack") return model && model.stack.length ? [{ layer: "stack", label: `Stack ${model.stack.length}` }] : [];
    if (e.layer === "mulligan") return [{ layer: "mulligan", label: "Your opening hand" }];
    if (e.layer === "clash") return model?.combat && focus.combat?.wanted ? [{ layer: "clash", label: "Combat" }] : [];
    return [];
  });
}

/** The Game menu's decks and what it starts from. */
export function menuOf(s: AppState): MenuView {
  const d = s.session.decks;
  const playing = !!s.model && !s.model.over;
  return { decks: d ? (d.list ?? (d.error ? [] : null)) : null, error: d?.error ?? null, last: s.session.lastGame, ...(playing ? { inProgress: true } : {}) };
}

const CAPTION: Readonly<Record<string, string>> = { ready: "Ready", tapped: "Tapped", works: "Works", lands: "Lands" };

/**
 * The caption of a sheet up: a pile (h.js `sift`) by whose graveyard or exile it is, or by its one name or its kind, with
 * how many and how many are tapped; a seat's spread by whose board it is; its pages when its cards do not fit at once,
 * and where the rest of what the decision offers is. Null when there is nothing to show.
 */
export function siftViewOf(model: TableModel, plan: TablePlan, focus: SheetFocus, page: number, chooser: number | null = null): SiftView | null {
  const sh = sheetOf(model, plan, focus, page);
  if (!sh || !sh.places.length) return null;
  const n = sh.cards.length;
  const whose = sh.seat === model.viewer.perspective ? "Your" : `${seatName(model, sh.seat)}'s`;
  const cards = sh.cards.map((id) => model.cards.get(id)).filter((c): c is Card => c !== undefined);
  let title: string;
  if (focus.kind === "spread") title = sh.seat === model.viewer.perspective ? "Your board" : `${whose} board`;
  else {
    const names = new Set(cards.map((c) => c.face.name));
    const kind = cards.every((c) => /\bLand\b/.test(c.face.type)) ? "lands" : cards.every(isCreature) ? "creatures" : "cards";
    const what = sh.zone ? `${whose} ${sh.zone}` : names.size === 1 ? [...names][0]! : `${whose} ${kind}`;
    title = n > 1 ? `${what} ×${n}` : what;
  }
  const shown = sh.places.flatMap((p) => p.cards), first = sh.cards.indexOf(shown[0]!);
  const pages = sh.pages.count, p = sh.pages.current;
  const elsewhere = sh.pages.offeredOn.length ? ` · choices on ${sh.pages.offeredOn.map((k) => k + 1).join(", ")}` : "";
  return {
    group: focus.kind === "pile" ? focus.group : `spread:${focus.seat}`,
    title,
    close: focus.kind === "spread" ? "Back to the table" : "Put back",
    tapped: sh.zone || focus.kind === "spread" ? 0 : cards.filter((c) => c.tapped).length,
    page: p,
    pages,
    range: pages > 1 ? `${first + 1}–${first + shown.length} of ${n}${elsewhere}` : null,
    top: sh.box.top,
    chooser,
    cards: sh.places.flatMap((pl) => {
      const c = model.cards.get(pl.top);
      return c ? [{ id: pl.top, label: [c.face.name + (pl.cards.length > 1 ? ` ×${pl.cards.length}` : ""), ...asides(model, c)].join(", ") }] : [];
    }),
    captions: sh.captions.map((c) => ({ text: c.kind === "lands" && !sh.landsOnly ? "Mana" : CAPTION[c.kind]!, x: c.at.x, y: c.at.y })),
    counts: sh.places.flatMap((pl) => (pl.count ? [{ text: `×${pl.count.n}`, x: pl.count.at.x, y: pl.count.at.y }] : [])),
  };
}
