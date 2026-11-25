// The card names a decision is about, so the host can have their data before it shows the decision as a question: the
// cards its options point at (on the table, or only by name, as a library search offers them) and the stack's top and
// what that aims at (what the question is about). Table cards the model already has data for are left out; names a
// sheet shows for options off the table are always listed (the host knows which it has).
import type { CardId, Decision } from "../protocol";
import type { TableModel } from "../model";
import { kindOf } from "./kinds";
import { cardName } from "./text";

/** A choice ref's card and name, for kinds whose refs are choice refs (the chooser's `refOf`). */
function choiceRef(d: Decision, i: number): { card: number | null; name: string | null } {
  if (d.kind !== "targets" && d.kind !== "choose" && d.kind !== "pay") return { card: null, name: null };
  const r = d.refs[i];
  return { card: r?.card ?? null, name: r?.name ?? null };
}

/**
 * The names a chooser sheet shows for options the table does not hold, as its items name them (`SheetItem.name`): the
 * ref's name, else the label's card name. Only for kinds that show their options in a sheet by name.
 */
export function offTableNames(model: TableModel, d: Decision): string[] {
  if (!kindOf(d).prefetch) return [];
  const names = new Set<string>();
  d.options.forEach((label, i) => {
    const r = choiceRef(d, i);
    if (r.card !== null && model.cards.has(r.card as CardId)) return;
    const name = r.name || cardName(label);
    if (/^[A-Z]/.test(name)) names.add(name);
  });
  return [...names];
}

/** Every name the decision needs data for: its options' cards, the stack's top and its targets, and names off the table. */
export function cardsWanted(model: TableModel, d: Decision): string[] {
  const names = new Set<string>();
  const card = (id: unknown): void => {
    if (typeof id !== "number") return;
    const c = model.cards.get(id as CardId);
    if (c && !c.face.catalogued) names.add(c.name);
  };
  const refs: readonly unknown[] = "refs" in d && d.refs ? d.refs : [];
  for (const r of refs) {
    if (typeof r !== "object" || r === null) continue;
    const ref = r as Readonly<Record<string, unknown>>;
    card(ref["card"]);
    card(ref["to"]);
    card(ref["blocks"]);
  }
  const top = model.stack[model.stack.length - 1];
  if (top) {
    card(top.source);
    for (const t of top.targets) if ("card" in t) card(t.card);
  }
  for (const n of offTableNames(model, d)) names.add(n);
  return [...names];
}
