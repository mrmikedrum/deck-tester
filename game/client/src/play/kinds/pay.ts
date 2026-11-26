// pay: tap mana sources in the order they pay (live.js `tapDecision` for pay, `pickColor`). A well of one land gives its
// next free source per tap (a pile of different sources is opened to choose one first: step.ts, resolve.ts). A source with one mana option (a land, a rock)
// is used once it is picked: tapped again (alone in its pile) it is taken back, and a well whose sources are all used
// gives back its last. A source with several options (a colour choice, a dual land) asks which mana on every tap and
// adds that pick, as live.js `pickColor` did: the engine takes the same option more than once and activates it once
// per pick (Crystalline Crawler's two counters pay two colours); its sheet's Take back gives back that source's picks.
// The only picks refused are those the engine refuses (ManualController's pay decision: at most `max` picks, each an
// option); Undo takes back the last; Pay sends the picks, Auto-pay (nothing picked) sends [] and Forge pays. List shows
// every source's every option, each with what sets its card apart, to pick from without the table.
import type { CardId, PayDecision } from "../../protocol";
import { cardOf } from "../facts";
import { promptText } from "../text";
import type { SheetItem } from "../types";
import { base, btn } from "./kind";
import type { Ctx, Kind, Reaction } from "./kind";

const optsFor = (d: PayDecision, id: CardId): number[] => d.refs.flatMap((r, i) => (r.card === id ? [i + 1] : []));

const item = (o: number, label: string, n: number): SheetItem => ({ option: o, label, cost: null, detail: null, card: null, name: null, picked: n > 0, badge: n > 0 ? n : null });
const times = (sel: readonly number[], o: number): number => sel.filter((x) => x === o).length;

/** One more pick, unless the engine would refuse the answer for it. */
function add(c: Ctx<PayDecision>, o: number): Reaction {
  const { d, draft } = c;
  if (draft.sel.length >= d.max) return { toast: `Pick at most ${d.max}`, sheet: null };
  return { draft: { ...draft, sel: [...draft.sel, o] }, sheet: null };
}

const takeBack = (c: Ctx<PayDecision>, x: CardId): Reaction => {
  const mine = optsFor(c.d, x);
  return { draft: { ...c.draft, sel: c.draft.sel.filter((o) => !mine.includes(o)) }, sheet: null };
};

function tapSources(c: Ctx<PayDecision>, ids: readonly CardId[]): Reaction | null {
  const { d, draft } = c, sel = draft.sel;
  const sources = ids.filter((x) => optsFor(d, x).length);
  const id = sources[0];
  if (id === undefined) return null;
  const used = (x: CardId) => optsFor(d, x).some((o) => sel.includes(o));
  const single = (x: CardId) => optsFor(d, x).length === 1;
  // a land tapped again: take it back
  if (sources.length === 1 && used(id) && single(id)) return takeBack(c, id);
  const free = sources.find((x) => !used(x)) ?? sources.find((x) => !single(x));
  if (free === undefined) {
    // a well whose sources are all picked: the last one picked comes back
    const last = [...sel].reverse().map((o) => d.refs[o - 1]?.card).find((x): x is CardId => x != null && sources.includes(x));
    return last === undefined ? {} : takeBack(c, last);
  }
  const uo = optsFor(d, free);
  if (uo.length === 1) return add(c, uo[0]!);
  if (sel.length >= d.max) return add(c, uo[0]!); // says why nothing more can be picked
  return { sheet: { k: "mana", card: free, options: uo } };
}

export const pay: Kind<PayDecision> = {
  ...base<PayDecision>(),
  words(c) {
    return { headline: promptText(c.d, c.f) };
  },
  buttons(c) {
    const { draft } = c;
    const out = [btn("pay", draft.sel.length ? "Pay" : "Auto-pay", () => ({ answer: { answer: [...draft.sel] } }), { tone: "primary" })];
    if (draft.sel.length) out.unshift(btn("undo", "Undo", () => ({ draft: { ...draft, sel: draft.sel.slice(0, -1) } })));
    out.unshift(btn("list", "List", () => ({ sheet: { k: "sources" } })));
    return out;
  },
  marks(c, m) {
    for (const r of c.d.refs) if (r.card !== null) m.card(r.card, "option");
    for (const o of c.draft.sel) {
      const card = c.d.refs[o - 1]?.card;
      if (card != null) m.card(card, "selected");
    }
  },
  sheet(c, open) {
    const { d, draft } = c;
    if (open.k === "sources") {
      const items = d.refs.map((r, i): SheetItem => {
        const fact = cardOf(c.f, r.card);
        return { ...item(i + 1, d.options[i] ?? "", times(draft.sel, i + 1)), card: fact && r.card !== null ? r.card : null, detail: fact?.asides.join(", ") || null };
      });
      const pay = btn("sheet-done", draft.sel.length ? "Pay" : "Auto-pay", () => ({ answer: { answer: [...draft.sel] } }), { tone: "primary", role: "done" });
      return { kind: "chooser", title: promptText(d, c.f), wide: items.length > 6, items, stepper: null, buttons: draft.sel.length ? [btn("undo", "Undo", () => ({ draft: { ...draft, sel: draft.sel.slice(0, -1) } })), pay] : [pay], carried: null };
    }
    if (open.k === "mana") {
      const items = open.options.map((o) => {
        const label = d.options[o - 1] ?? "";
        return item(o, label.match(/\((\w+)\)$/)?.[1] ?? label, times(draft.sel, o));
      });
      const picked = open.options.some((o) => draft.sel.includes(o));
      const buttons = picked ? [btn("takeBack", "Take back", () => takeBack(c, open.card))] : [];
      return { kind: "mana", title: `${cardOf(c.f, open.card)?.display ?? ""}: which mana?`, wide: false, items, stepper: null, buttons, carried: null };
    }
    return null;
  },
  tap: (c, at) => tapSources(c, at.ids),
  pick(c, o) {
    const open = c.s.sheet;
    if (open?.k === "sources") {
      // the list stays up: a one-option source picked already is taken back, anything else is one more pick
      const card = c.d.refs[o - 1]?.card;
      if (!Number.isInteger(o) || o < 1 || o > c.d.options.length) return null;
      const r = card != null && c.draft.sel.includes(o) && optsFor(c.d, card).length === 1 ? takeBack(c, card) : add(c, o);
      return { ...r, sheet: open };
    }
    if (!open || open.k !== "mana" || !open.options.includes(o)) return null;
    return add(c, o);
  },
};
