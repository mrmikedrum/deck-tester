// The prompt and the sheet for a state, with each button's `run`: built once here and read twice, by `present` (which
// drops `run`) and by `step` (which finds the pressed button and runs it). What the old `status()` added to every
// kind lives here: Hold while auto-pass counts, "Let Forge decide", "Stack rules", the play kind's pass button moved
// last (and called plain "Pass" beside "Let Forge decide" with a spell up, as the old client did), the sweep
// headline and the red tone, and the stack summary (`stack`, top first), which the chrome shows in the context's place
// while the stack layer is up, as the old prompt did.
import { seatId } from "../model";
import { cardOf, seatName, topItem } from "./facts";
import { kindOf } from "./kinds";
import { btn } from "./kinds/kind";
import type { Btn, Ctx } from "./kinds/kind";
import { playOptions } from "./kinds/play";
import type { S } from "./state";
import { context, lists, modeItem, shortCard, stackRows, where } from "./text";
import type { StackSummaryRow } from "./text";
import type { PromptView, SheetView } from "./types";

export type PromptOf = PromptView & {
  readonly buttons: readonly Btn[];
  /** live.js `stackSummary`: the stack, top first; empty when it is. */
  readonly stack: readonly StackSummaryRow[];
};
export type SheetOf = SheetView & { readonly buttons: readonly Btn[] };

export const ctxOf = (s: S): Ctx | null => (s.decision && s.facts ? { d: s.decision, f: s.facts, s, draft: s.draft } : null);

function stackButton(s: S): Btn | null {
  const f = s.facts;
  const top = f && topItem(f);
  if (!f || !top) return null;
  const lone = f.stack.length === 1 && top.spell && top.source !== null ? top.source : null;
  return btn("stack-rules", "Stack rules", () => (lone !== null ? { inspect: lone } : { sheet: { k: "stack" } }), { tone: "ghost", role: "stack" });
}

export function promptOf(s: S): PromptOf | null {
  const f = s.facts;
  if (!f) return null;
  const stack = stackButton(s);
  const shell: PromptOf = {
    where: where(f),
    headline: "",
    hint: null,
    context: null,
    floating: f.floating ? `Floating mana: ${f.floating}` : null,
    tone: "normal",
    style: "bar",
    buttons: stack && f.mayAnswer ? [stack] : [],
    countdown: null,
    busy: !!s.inflight,
    stack: stackRowsOf(s),
  };
  const c = ctxOf(s);
  if (f.over) return { ...shell, headline: "Game over" };
  if (!c && s.held) return { ...shell, headline: "…", buttons: [] };
  if (!c) return { ...shell, headline: f.active === f.me ? "Moving on…" : f.active === null ? "Waiting…" : `Waiting for ${seatName(f, f.active)}…` };
  if (s.inflight) return { ...shell, headline: "…" };
  const kind = kindOf(c.d);
  const words = kind.words(c);
  const alarm = f.threat || f.sweep;
  const ask = { ...shell, style: kind.style, tone: alarm ? ("threat" as const) : ("normal" as const) };
  if (!f.mayAnswer) return { ...ask, headline: words.headline, buttons: [] };

  const opts = c.d.kind === "play" ? playOptions(c.d) : [];
  const bs: Btn[] = [...kind.buttons(c)];
  if (c.d.kind === "play" && s.auto && !opts.length) {
    const pass = bs.findIndex((b) => b.role === "pass");
    if (pass >= 0) bs[pass] = { ...bs[pass]!, countdown: true };
    bs.unshift(btn("hold", "Hold", () => ({ hold: true }), { role: "hold" }));
  }
  if (kind.defers(c)) bs.push(btn("defer", "Let Forge decide", () => ({ answer: { defer: true } }), { tone: "ghost", role: "defer" }));
  if (stack && c.d.kind !== "mulligan") bs.splice(bs[0]?.role === "choice" ? 1 : 0, 0, stack);
  if (c.d.kind === "play") {
    const at = bs.findIndex((b) => b.role === "pass");
    if (at >= 0) {
      const [pass] = bs.splice(at, 1);
      bs.push(stack && bs.some((b) => b.role === "defer") ? { ...pass!, label: "Pass" } : pass!);
    }
  }
  let headline = words.headline, hint = words.hint ?? null;
  if (f.sweep && c.d.kind === "play") {
    if (opts.length) hint = [headline, hint].filter(Boolean).join(". ");
    headline = "Sunfall threatens every creature";
  }
  return {
    ...ask,
    headline,
    hint,
    context: context(c.d, f) || null, // the chrome shows the stack summary in its place while the stack layer is up
    buttons: bs,
    countdown: s.auto ? { from: s.auto.from, ms: s.auto.ms } : null,
  };
}

export function sheetOf(s: S): SheetOf | null {
  if (s.sheet?.k === "stack" && s.facts)
    return { kind: "stack", title: "Stack rules · first to last", wide: false, items: [], stepper: null, buttons: [], carried: null };
  const c = ctxOf(s);
  if (!c || s.inflight || !c.f.mayAnswer) return null;
  const kind = kindOf(c.d);
  return s.sheet ? kind.sheet(c, s.sheet) : kind.ownSheet(c);
}

/** The names of the targets I have picked so far for my own spell on top of the stack, or null when I am not choosing
 * them (live.js `stackSummary`'s `choosing`). */
function choosingNames(s: S): string[] | null {
  const c = ctxOf(s);
  if (!c || c.d.kind !== "targets") return null;
  const top = topItem(c.f);
  if (!top || top.controller !== c.f.me || top.targets.length) return null;
  const refs = c.d.refs;
  return c.draft.sel.flatMap((o) => {
    const r = refs[o - 1];
    if (!r) return [];
    if (r.player !== null) return [seatId(r.player) === c.f.me ? "you" : seatName(c.f, seatId(r.player))];
    const card = cardOf(c.f, r.card);
    return card ? [(card.controller === c.f.me ? "your " : "") + shortCard(card.display)] : ["unrecorded target"];
  });
}

/** live.js `stackSummary`: the stack's rows, top first, with what I am choosing for my own spell. */
function stackRowsOf(s: S): StackSummaryRow[] {
  const f = s.facts;
  if (!f?.stack.length) return [];
  const mode = s.decision && !s.inflight ? modeItem(s.decision, f) : null;
  return stackRows(f, { choosing: choosingNames(s), mode, actors: s.actors });
}

/** live.js `stackSummary`'s top row while I choose my own spell's targets: "Choosing targets", then the picks. */
export function stackNoteOf(s: S): string | null {
  if (s.inflight) return null;
  const names = choosingNames(s);
  if (names === null) return null;
  return names.length ? `Aimed at ${lists(names)}.` : "Choosing targets";
}
