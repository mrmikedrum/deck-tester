// The chooser: a choice made in a sheet (live.js `chooser`), shared by mode, order, an unknown kind, and targets or
// choose when the table cannot show every option. Cards as cards where the table holds them, else by name; tap to
// pick (one wanted: sent at once), Done when enough, Clear to start over.
import type { Decision } from "../../protocol";
import { badge, choose, doneLabel } from "../interactions/pick";
import { cardName, promptText } from "../text";
import type { SheetItem, SheetView } from "../types";
import { btn } from "./kind";
import type { Btn, Ctx, Kind, Reaction } from "./kind";

type Choice = Exclude<Decision, { kind: "number" }>;

/** The option's ref as a card or a name, for kinds whose refs are choice refs. */
function refOf(d: Decision, i: number): { card: number | null; name: string | null } {
  if (d.kind !== "targets" && d.kind !== "choose" && d.kind !== "pay") return { card: null, name: null };
  const r = d.refs[i];
  return { card: r?.card ?? null, name: r?.name ?? null };
}

const ordered = (d: Decision): boolean => d.kind === "order";

export function chooserSheet(c: Ctx<Choice>): SheetView & { readonly buttons: readonly Btn[] } {
  const { d, f, draft } = c;
  const items: SheetItem[] = d.options.map((label, i) => {
    const r = refOf(d, i), card = r.card === null ? undefined : f.cards[r.card];
    const detail = d.details?.[i];
    return {
      option: i + 1,
      label,
      cost: null,
      detail: detail && detail !== label ? detail : null,
      card: card ? (r.card as SheetItem["card"]) : null,
      name: card ? card.display : r.name || cardName(label),
      picked: draft.sel.includes(i + 1),
      badge: badge(draft.sel, i + 1, ordered(d), d.repeat),
    };
  });
  const buttons: Btn[] = [];
  if (draft.sel.length) buttons.push(btn("sheet-clear", "Clear", () => ({ draft: { ...draft, sel: [] } }), { role: "clear" }));
  buttons.push(
    btn("sheet-done", doneLabel(draft.sel, d), () => ({ answer: { answer: [...draft.sel] } }), {
      tone: "primary",
      role: "done",
      enabled: draft.sel.length >= d.min,
    }),
  );
  const pick = { min: d.min, max: d.max, ordered: ordered(d), repeat: d.repeat };
  return { kind: "chooser", title: promptText(d, f), wide: d.options.length > 6, items, stepper: null, buttons, carried: null, pick };
}

/** A sheet pick: picked, and sent when that completes a single-option choice. `mode` is the draft's mode to keep. */
export function chooserPick(c: Ctx<Choice>, o: number, mode: "board" | "sheet"): Reaction | null {
  const { d, draft } = c;
  if (!Number.isInteger(o) || o < 1 || o > d.options.length) return null;
  const p = choose(draft.sel, o, d, ordered(d));
  const next = { ...draft, sel: p.sel, mode };
  return p.done ? { draft: next, answer: { answer: [...p.sel] } } : { draft: next };
}

/** The prompt of a choice made in a sheet: its words and "Choose…", which brings the chooser back. */
export function chooserPrompt(): Btn[] {
  return [btn("chooser", "Choose…", () => ({ sheet: null, chooserClosed: false }), { tone: "primary" })];
}

/** A kind answered only from the chooser. */
export function chooserKind<D extends Choice>(): Partial<Kind<D>> {
  return {
    prefetch: true,
    words: (c) => ({ headline: promptText(c.d, c.f) }),
    buttons: () => chooserPrompt(),
    ownSheet: (c) => (c.s.chooserClosed ? null : chooserSheet(c)),
    sheet: (c, open) => (open.k === "chooser" ? chooserSheet(c) : null),
    pick: (c, o) => chooserPick(c, o, "sheet"),
  };
}
