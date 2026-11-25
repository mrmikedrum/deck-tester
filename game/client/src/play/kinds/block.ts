// block: tap my blocker, then the attacker it blocks (a blocker with one legal pairing picks it at once), or drag the
// blocker onto the attacker; an illegal pair toasts and picks nothing. Tapping a picked blocker takes it back; Clear;
// "Block (n)" or "No blocks" sends.
import type { BlockDecision } from "../../protocol";
import { cardOf } from "../facts";
import { shortCard } from "../text";
import { block as pairBlock, tapBlocker } from "../interactions/pair";
import { base, btn } from "./kind";
import type { Btn, Kind } from "./kind";

/** What reaches me with these blocks: the power of the attackers at me no blocker of mine stops ("Take 11"). */
function takeOf(c: { d: BlockDecision; f: Parameters<typeof cardOf>[0]; draft: { sel: readonly number[] } }): { sum?: string } {
  const at = c.f.attackingMe;
  if (!at.length) return {};
  const stopped = new Set(c.draft.sel.flatMap((o) => { const r = c.d.refs[o - 1]; return r ? [r.blocks] : []; }));
  const take = at.filter((id) => !stopped.has(id)).reduce((t, id) => t + Math.max(0, cardOf(c.f, id)?.power ?? 0), 0);
  return { sum: `Take ${take}` };
}

export const block: Kind<BlockDecision> = {
  ...base<BlockDecision>(),
  // One hint before the first pick; holding a blocker, which one.
  words(c) {
    const { draft } = c;
    if (draft.holding !== null) return { headline: "Declare blockers", hint: `${shortCard(cardOf(c.f, draft.holding)?.display ?? "")}: tap an attacker`, ...takeOf(c) };
    return { headline: "Declare blockers", ...(draft.sel.length ? {} : { hint: "Tap a creature, then its attacker" }), ...takeOf(c) };
  },
  buttons(c) {
    const { draft } = c, n = draft.sel.length;
    const out: Btn[] = [btn("block", n ? `Block (${n})` : "No blocks", () => ({ answer: { answer: [...draft.sel] } }), { tone: "primary" })];
    if (n || draft.holding !== null) out.unshift(btn("clear", "Clear", () => ({ draft: { ...draft, sel: [], holding: null } })));
    return out;
  },
  // The attackers are choices here, not dangers; holding a blocker, only the attackers it can block stay lit, in red.
  marks(c, m) {
    const { d, draft } = c;
    for (const r of d.refs) {
      m.card(r.card, "option");
      if (draft.holding === null) m.card(r.blocks, "option");
      else if (r.card === draft.holding) m.card(r.blocks, "danger");
    }
    for (const o of draft.sel) {
      const r = d.refs[o - 1];
      if (r) m.card(r.card, "selected");
    }
    if (draft.holding !== null) m.card(draft.holding, "selected");
  },
  tap(c, at) {
    const { d, draft } = c;
    const mine = at.ids.find((x) => d.refs.some((r) => r.card === x));
    const theirs = at.ids.find((x) => d.refs.some((r) => r.blocks === x));
    if (mine !== undefined) {
      const next = tapBlocker(draft.sel, d.refs, mine);
      return { draft: { ...draft, sel: next.sel, holding: next.holding } };
    }
    if (theirs !== undefined && draft.holding !== null) {
      const sel = pairBlock(draft.sel, d.refs, draft.holding, theirs);
      return sel === null ? { toast: "That creature can't block that attacker" } : { draft: { ...draft, sel, holding: null } };
    }
    return null;
  },
  drag(c, from, onto) {
    const { d, draft } = c;
    const mine = from.ids.find((x) => d.refs.some((r) => r.card === x));
    const theirs = onto.ids.find((x) => d.refs.some((r) => r.blocks === x));
    const sel = mine === undefined || theirs === undefined ? null : pairBlock(draft.sel, d.refs, mine, theirs);
    if (sel === null) return mine !== undefined ? { toast: "It can't block that" } : {};
    return { draft: { ...draft, sel, holding: null } };
  },
  combat(c) {
    const { d, draft } = c;
    if (!draft.sel.length) return null;
    return {
      attacks: [],
      blocks: draft.sel.flatMap((o) => {
        const r = d.refs[o - 1];
        return r ? [{ blocker: r.card, attacker: r.blocks }] : [];
      }),
    };
  },
};
