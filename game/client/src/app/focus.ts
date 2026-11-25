// Focus: one ordered stack of typed layers, top last (docs/game-client-architecture.md, "input, focus and access").
// Each entry is a layer with its subject (the inspector's card, a lean-in's seat, a sift's group), whether the player
// may dismiss it, and where keyboard focus returns when it goes. Play keeps owning its choice draft and whether its
// sheet may close: the stack holds a `sheet` entry while play presents a sheet, and dismissing it asks play. Pure.
//
// One rule for every way out, Escape, a tap outside (a sheet's scrim, an unclaimed tap on the table) and the ✕: the top
// layer goes. The stack layer and the mulligan are set aside rather than closed (they stand for something still true
// on the table); a set-aside layer shows a chip that restores it. The table's layers (the stack, a lean-in, a sift)
// always sit under the chrome's (a sheet, the inspector, the mulligan, the menu, the hand's list, the log, the loss
// report): a new layer goes on top of its own tier.
import type { SeatId, TableModel } from "../model";
import type { CardId } from "../protocol";
import type { FocusLayer, FocusTop, TableLayer, TableLayerId } from "../scene/stage/types";

/** The scene's focus layers, and two of the chrome's own the scene sees as a sheet: the log ("What happened") and the
 * loss report ("What you lost"). */
export type LayerId = FocusLayer | "log" | "losses";

export interface FocusEntry {
  readonly layer: LayerId;
  /** The inspector's card. */
  readonly card: CardId | null;
  /** A lean-in's seat. */
  readonly seat: SeatId | null;
  /** A sift's hit group. */
  readonly group: string | null;
  /** A sift's page (layout `SIFT_PAGE` cards each), from 0. */
  readonly page: number;
  /** Escape, a tap outside or ✕ may take it down (a sheet: play says, when asked). */
  readonly dismissible: boolean;
  /** The control keyboard focus returns to when it goes (the chrome's `data-fk`), or null. */
  readonly restore: string | null;
}

export interface FocusState {
  /** Open layers, bottom first: the last is the top. */
  readonly layers: readonly FocusEntry[];
  /** Layers set aside, each shown as a chip that restores it. */
  readonly aside: readonly FocusEntry[];
  /** The stack (its items) the stack layer last came up for: a new item brings it up again, even set aside. */
  readonly stackKey: string;
  /** The combat the clash last came up for (focus-first): a new combat step brings it up again, even set aside. */
  readonly clashKey?: string;
  /** The attackers blocked so far in that combat: still blocked at damage, when their blockers may have died. */
  readonly clashBlocked?: readonly CardId[];
}

export const NO_FOCUS_STATE: FocusState = { layers: [], aside: [], stackKey: "" };

/** The table's own layers: under every chrome layer. */
const TABLE: ReadonlySet<LayerId> = new Set<LayerId>(["clash", "stack", "lean", "sift"]);
/** Dismissed, these are set aside (a chip restores them) rather than closed. */
const SET_ASIDE: ReadonlySet<LayerId> = new Set<LayerId>(["stack", "clash", "mulligan"]);

const tier = (l: LayerId): number => (TABLE.has(l) ? 0 : 1);

export function entry(layer: LayerId, more: Partial<Omit<FocusEntry, "layer">> = {}): FocusEntry {
  return { layer, card: null, seat: null, group: null, page: 0, dismissible: true, restore: null, ...more };
}

export const top = (f: FocusState): FocusEntry | null => f.layers[f.layers.length - 1] ?? null;
/** The top layer with its subject, as a key: what a dismissal would take down. The stack layer's subject is the stack
 * it came up for (a new spell replaces the open layer with one for another stack). */
export const topKey = (f: FocusState): string | null => {
  const t = top(f);
  return t ? `${t.layer}|${t.card}|${t.seat}|${t.group}${t.layer === "stack" ? `|${f.stackKey}` : ""}` : null;
};
/** The topmost table layer open (the stack, a lean-in, a sift): the one the scene draws the table from, whatever chrome
 * layer is over it (scene `tableFocus` of `focusTopOf`). */
export const tableTop = (f: FocusState): FocusEntry | null => f.layers.filter((e) => TABLE.has(e.layer)).at(-1) ?? null;
export const isOpen = (f: FocusState, layer: LayerId): boolean => f.layers.some((e) => e.layer === layer);
export const isAside = (f: FocusState, layer: LayerId): boolean => f.aside.some((e) => e.layer === layer);

/** Opens a layer on top of its tier (one of each layer: an open or set-aside one of the same layer is replaced). */
export function open(f: FocusState, e: FocusEntry): FocusState {
  const rest = f.layers.filter((x) => x.layer !== e.layer);
  const at = rest.findIndex((x) => tier(x.layer) > tier(e.layer));
  const layers = at < 0 ? [...rest, e] : [...rest.slice(0, at), e, ...rest.slice(at)];
  return { ...f, layers, aside: f.aside.filter((x) => x.layer !== e.layer) };
}

/** Closes a layer, open or set aside. */
export function close(f: FocusState, layer: LayerId): FocusState {
  if (!isOpen(f, layer) && !isAside(f, layer)) return f;
  return { ...f, layers: f.layers.filter((x) => x.layer !== layer), aside: f.aside.filter((x) => x.layer !== layer) };
}

/** Sets an open layer aside: it leaves the stack and its chip shows. */
export function setAside(f: FocusState, layer: LayerId): FocusState {
  const e = f.layers.find((x) => x.layer === layer);
  if (!e) return f;
  return { ...f, layers: f.layers.filter((x) => x !== e), aside: [...f.aside.filter((x) => x.layer !== layer), e] };
}

/** A chip was tapped: the layer set aside comes back on top of its tier. */
export function restore(f: FocusState, layer: LayerId): FocusState {
  const e = f.aside.find((x) => x.layer === layer);
  return e ? open(f, e) : f;
}

/** What dismissing does: the focus after it, and whether play is to be asked (the top is play's sheet). */
export interface Dismissal {
  readonly focus: FocusState;
  readonly play: boolean;
}

/** The top-layer rule: the top layer goes (set aside, for the stack and the mulligan); play's sheet asks play. With
 * nothing open, play hears it (it may have something of its own to close). A layer that may not be dismissed stays. */
export function dismiss(f: FocusState): Dismissal {
  const t = top(f);
  if (!t) return { focus: f, play: true };
  if (!t.dismissible) return { focus: f, play: false };
  if (t.layer === "sheet") return { focus: f, play: true };
  return { focus: SET_ASIDE.has(t.layer) ? setAside(f, t.layer) : close(f, t.layer), play: false };
}

/**
 * The combat the clash stands for (focus-first): an attack on me or my planeswalker, or blocks against my attackers, with
 * its step; empty when no combat involves me.
 */
export function clashKeyOf(model: TableModel | null): string {
  const c = model?.combat;
  if (!model || !c) return "";
  const me = model.viewer.perspective;
  const atMe = c.attackers.some((a) => a.defender && ("seat" in a.defender ? a.defender.seat === me : model.cards.get(a.defender.card)?.controller === me));
  const mineBlocked = c.blockers.some((b) => model.cards.get(b.attacker)?.controller === me);
  if (!atMe && !mineBlocked) return "";
  return [model.phase, c.attackers.map((a) => a.attacker).join(","), c.blockers.map((b) => `${b.blocker}>${b.attacker}`).join(",")].join("|");
}

/** The stack's identity: its items, in order. Empty when there is no stack. */
export const stackKeyOf = (model: TableModel | null): string => (model ? model.stack.map((i) => `${i.id}:${i.source ?? ""}`).join(",") : "");

/**
 * Keeps the focus in step with what it stands for. Play's sheet: an entry while play presents one, none when it does
 * not. The mulligan: while one is asked (and not answered). The stack layer comes up for every new stack (live.js
 * `stackOpen`: a new item, even set aside), and goes when the stack empties. A sift goes when its group is no longer on
 * the table (`groups`: whether the plan has a hit group of that id; absent, sifts are left alone), and its page is kept
 * to the pages its pile has (`pages`). `restore` is the control that led here.
 */
export function sync(
  f: FocusState,
  o: { sheet: boolean; mulligan: boolean; stack: string; clash?: string; blocked?: readonly CardId[]; groups?: (id: string) => boolean; pages?: (id: string) => number },
  restore: string | null,
): FocusState {
  let next = f;
  const sift = next.layers.find((e) => e.layer === "sift");
  if (sift && o.groups && !(sift.group !== null && o.groups(sift.group))) next = close(next, "sift");
  else if (sift && o.pages && sift.group !== null) {
    // Its pile shrank under it: the page shown is the last there is, and paging goes on from there.
    const page = Math.max(0, Math.min(o.pages(sift.group) - 1, sift.page));
    if (page !== sift.page) next = { ...next, layers: next.layers.map((e) => (e === sift ? { ...e, page } : e)) };
  }
  if (o.sheet && !isOpen(next, "sheet")) next = open(next, entry("sheet", { restore }));
  else if (!o.sheet && isOpen(next, "sheet")) next = close(next, "sheet");
  if (o.mulligan && !isOpen(next, "mulligan") && !isAside(next, "mulligan")) next = open(next, entry("mulligan"));
  else if (!o.mulligan) next = close(next, "mulligan");
  // The clash (focus-first) comes up for a combat I am in, again at each new step of it, and goes when combat ends. It
  // sits under the stack (a spell cast in combat takes the table; the clash is back when the stack empties).
  const ck = o.clash ?? "";
  const had = next.clashBlocked ?? [];
  const more = ck ? (o.blocked ?? []).filter((id) => !had.includes(id)) : [];
  if (more.length) next = { ...next, clashBlocked: [...had, ...more] };
  if (ck !== (next.clashKey ?? "")) {
    if (!ck) next = { ...close(next, "clash"), clashKey: "", clashBlocked: [] };
    else {
      const e = entry("clash");
      const base = { ...close(next, "clash"), clashKey: ck };
      next = { ...base, layers: [e, ...base.layers] };
    }
  }
  if (o.stack !== next.stackKey) {
    next = o.stack ? open({ ...next, stackKey: o.stack }, entry("stack")) : { ...close(next, "stack"), stackKey: "" };
  }
  return next;
}

/** What the scene is handed: the top entry and its subject (the log and the loss report are sheets to it), and every
 * table layer open, bottom first, whatever chrome layer is over them (the topmost decides how the table looks). */
/** A sift past its first page says which; every other layer has none. */
const siftPage = (e: FocusEntry): { page?: number } => (e.layer === "sift" && e.page > 0 ? { page: e.page } : {});

export function focusTopOf(f: FocusState): FocusTop {
  const table: TableLayer[] = f.layers
    .filter((e) => TABLE.has(e.layer))
    .map((e) => ({ layer: e.layer as TableLayerId, seat: e.seat, group: e.group, ...siftPage(e) }));
  const t = top(f);
  if (!t) return { layer: null, seat: null, group: null, card: null, table };
  const layer = t.layer === "log" || t.layer === "losses" ? "sheet" : t.layer;
  return { layer, seat: t.seat, group: t.group, card: t.card, ...siftPage(t), table };
}
