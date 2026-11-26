// What play shows: board cues for the scene (marks, the combat draft, the hand away) and controls for the chrome (the
// prompt, the sheet, the inspector's actions), memoised per state so the app can ask every commit.
import type { CardId } from "../protocol";
import type { SeatId } from "../model";
import { kindOf } from "./kinds";
import type { MarkSink } from "./kinds/kind";
import { optsFor } from "./kinds/play";
import { ctxOf, promptOf, sheetOf } from "./prompt";
import type { PromptOf, SheetOf } from "./prompt";
import { open } from "./state";
import type { S } from "./state";
import { actionLabel, costOf } from "./text";
import type { Button, CardAction, Mark, Presentation, PromptView, SheetView, State } from "./types";

/** live.js `inspectWith`: a card's plays, as the inspector's buttons. Only for play, and not while an answer is out. */
export function cardActionsOf(s: S): ReadonlyMap<CardId, readonly CardAction[]> {
  const out = new Map<CardId, CardAction[]>();
  const c = ctxOf(s);
  if (!c || c.d.kind !== "play" || s.inflight || !c.f.mayAnswer) return out;
  const d = c.d;
  for (const r of d.refs) {
    if (r.card === null || out.has(r.card)) continue;
    const name = c.f.cards[r.card]?.display ?? "";
    out.set(
      r.card,
      optsFor(d, r.card).map((o) => ({ option: o, label: actionLabel(d.options[o - 1] ?? "", name), cost: costOf(d, o, c.f) })),
    );
  }
  return out;
}

function marksOf(s: S): Presentation["board"]["marks"] {
  const cards = new Map<CardId, Mark>(), seats = new Map<SeatId, Mark>(), hand = new Set<CardId>();
  const sink: MarkSink = { card: (id, m) => cards.set(id, m), seat: (id, m) => seats.set(id, m), hand: (id) => hand.add(id) };
  const c = ctxOf(s);
  if (c && !s.inflight && c.f.mayAnswer) kindOf(c.d).marks(c, sink);
  // whatever of mine the others' spells and abilities aim at glows red, over any other mark
  for (const id of s.facts?.danger ?? []) cards.set(id, "danger");
  return { cards, seats, hand };
}

const plain = (b: Button): Button => ({
  id: b.id,
  label: b.label,
  tone: b.tone,
  role: b.role,
  enabled: b.enabled,
  detail: b.detail,
  cost: b.cost,
  countdown: b.countdown,
});
const promptView = (p: PromptOf | null): PromptView | null => (p ? { ...p, buttons: p.buttons.map(plain) } : null);
const sheetView = (v: SheetOf | null): SheetView | null => (v ? { ...v, buttons: v.buttons.map(plain) } : null);

function build(s: S): Presentation {
  const c = ctxOf(s);
  const busy = !!s.inflight;
  return {
    board: {
      stop: s.stop,
      marks: marksOf(s),
      combat: c && !busy ? kindOf(c.d).combat(c) : null,
      handAway: !!c && kindOf(c.d).handAway,
    },
    controls: {
      stop: s.stop,
      mayAnswer: s.facts?.mayAnswer ?? false,
      prompt: promptView(promptOf(s)),
      sheet: sheetView(sheetOf(s)),
      cardActions: cardActionsOf(s),
      choosing: s.pending ? { group: s.pending.group, rev: s.pending.rev } : null,
    },
  };
}

const memo = new WeakMap<object, Presentation>();

export function present(state: State): Presentation {
  const hit = memo.get(state);
  if (hit) return hit;
  const p = build(open(state));
  memo.set(state, p);
  return p;
}
