// attack: tap creatures to toggle them at the current defender; tap another player's plate (or a planeswalker) to make
// it the defender, which re-aims the picks so far; drag a creature onto a player or a planeswalker to attack it.
// "All attack" picks every creature at the current defender; Clear; "Attack (n)" or "No attack" sends.
import type { AttackDecision, CardId } from "../../protocol";
import { seatId } from "../../model";
import type { Target as ModelTarget } from "../../model";
import { cardOf, hasSeat } from "../facts";
import { shortCard } from "../text";
import { aim, defaultDefender, everyone, retarget, toggleAttacker } from "../interactions/pair";
import { base, btn } from "./kind";
import type { Btn, Kind } from "./kind";

const defenderOf = (to: string | number): ModelTarget => (typeof to === "number" ? { card: to as CardId } : { seat: seatId(to) });

export const attack: Kind<AttackDecision> = {
  ...base<AttackDecision>(),
  start: (d, f) => ({
    sel: [],
    holding: null,
    attackTo: defaultDefender(d.refs, (s) => f.seats.some((x) => x.id === s && !x.out)),
    value: 0,
    mode: null,
  }),
  // The lit creatures say what may attack; one hint before the first pick, where the drag is not obvious.
  words(c) {
    const to = c.draft.attackTo;
    const name = typeof to === "number" ? shortCard(cardOf(c.f, to as CardId)?.display ?? "") : (to ?? "");
    return { headline: "Declare attackers", ...(c.draft.sel.length ? {} : { hint: `Tap: ${name} · drag: another player` }) };
  },
  buttons(c) {
    const { d, draft } = c, n = draft.sel.length;
    const out: Btn[] = [btn("attack", n ? `Attack (${n})` : "No attack", () => ({ answer: { answer: [...draft.sel] } }), { tone: "primary" })];
    if (n) out.unshift(btn("clear", "Clear", () => ({ draft: { ...draft, sel: [] } })));
    if (new Set(d.refs.map((r) => r.card)).size > n)
      out.unshift(btn("everyone", "All attack", () => ({ draft: { ...draft, sel: everyone(d.refs, draft.attackTo) } })));
    return out;
  },
  marks(c, m) {
    const { d, draft } = c;
    for (const r of d.refs) m.card(r.card, "option");
    for (const o of draft.sel) {
      const r = d.refs[o - 1];
      if (r) m.card(r.card, "selected");
    }
    if (typeof draft.attackTo === "string" && hasSeat(c.f, draft.attackTo)) m.seat(seatId(draft.attackTo), "selected");
  },
  tap(c, at) {
    const { d, f, draft } = c;
    if (at.seat !== null) {
      if (at.seat === f.me || !d.refs.some((r) => (r.to as string | number) === (at.seat as string))) return null;
      return { draft: { ...draft, attackTo: at.seat, sel: retarget(draft.sel, d.refs, at.seat) } };
    }
    const id = at.ids.find((x) => d.refs.some((r) => r.card === x));
    if (id === undefined) {
      const walker = at.ids.find((x) => d.refs.some((r) => r.to === x));
      return walker === undefined ? null : { draft: { ...draft, attackTo: walker } };
    }
    return { draft: { ...draft, sel: toggleAttacker(draft.sel, d.refs, id, draft.attackTo) } };
  },
  drag(c, from, onto) {
    const { d, f, draft } = c;
    const id = from.ids.find((x) => d.refs.some((r) => r.card === x));
    if (id === undefined || (onto.seat === null && !onto.ids.length)) return {};
    const to =
      onto.seat ??
      onto.ids.map((x) => (d.refs.some((r) => r.to === x) ? x : (cardOf(f, x)?.controller ?? null))).find((x) => x !== null) ??
      null;
    const sel = to === null ? null : aim(draft.sel, d.refs, id, to);
    if (sel === null) return { toast: "It can't attack there" };
    return { draft: { ...draft, sel, attackTo: typeof to === "string" ? to : draft.attackTo } };
  },
  combat(c) {
    const { d, draft } = c;
    if (!draft.sel.length) return null;
    return {
      attacks: draft.sel.flatMap((o) => {
        const r = d.refs[o - 1];
        return r ? [{ attacker: r.card, defender: defenderOf(r.to) }] : [];
      }),
      blocks: [],
    };
  },
};
