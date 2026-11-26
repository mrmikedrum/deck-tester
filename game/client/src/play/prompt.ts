// The prompt and the sheet for a state, with each button's `run`: built once here and read twice, by `present` (which
// drops `run`) and by `step` (which finds the pressed button and runs it). What every kind shares lives here: Hold
// while auto-pass counts, "Auto" (let Forge decide), the play kind's pass button moved last, the red tone, the mana
// floating, and the stack summary (`stack`, top first, only with two or more items), which the chrome shows in the
// context's place while the stack layer is up. (The stack's rules are the card itself, held up; a tap on it inspects.)
import { seatName } from "./facts";
import { kindOf } from "./kinds";
import { btn } from "./kinds/kind";
import type { Btn, Ctx } from "./kinds/kind";
import { playOptions } from "./kinds/play";
import type { S } from "./state";
import { context, stackRows, where } from "./text";
import type { StackSummaryRow } from "./text";
import type { PromptView, SheetView } from "./types";

export type PromptOf = PromptView & {
  readonly buttons: readonly Btn[];
  /** live.js `stackSummary`: the stack, top first; empty when it is. */
  readonly stack: readonly StackSummaryRow[];
};
export type SheetOf = SheetView & { readonly buttons: readonly Btn[] };

export const ctxOf = (s: S): Ctx | null => (s.decision && s.facts ? { d: s.decision, f: s.facts, s, draft: s.draft } : null);

/** "Floating {U}{U}": the pool's symbols, a count beside any held more than four times. */
const floatingOf = (pool: string): string | null =>
  pool ? `${pool.replace(/(\d+) (\{\w+\})\s*/g, (_, n: string, sym: string) => (+n <= 4 ? sym.repeat(+n) : `${n}${sym}`))}` : null;

export function promptOf(s: S): PromptOf | null {
  const f = s.facts;
  if (!f) return null;
  const shell: PromptOf = {
    where: where(f),
    headline: "",
    hint: null,
    context: null,
    floating: floatingOf(f.floating),
    tone: "normal",
    style: "bar",
    buttons: [],
    countdown: null,
    busy: !!s.inflight,
    stack: stackRowsOf(s),
  };
  const c = ctxOf(s);
  if (f.over) return { ...shell, headline: "Game over" };
  if (!c && s.held) return { ...shell, headline: "…", buttons: [] };
  if (!c) return { ...shell, headline: f.active === f.me ? "…" : f.active === null ? "Waiting…" : `Waiting for ${seatName(f, f.active)}…` };
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
  if (kind.defers(c)) bs.push(btn("defer", "Auto", () => ({ answer: { defer: true } }), { role: "defer" }));
  if (c.d.kind === "play") {
    const at = bs.findIndex((b) => b.role === "pass");
    if (at >= 0) bs.push(...bs.splice(at, 1));
  }
  return {
    ...ask,
    headline: words.headline,
    hint: words.hint ?? null,
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

/** The stack's rows, top first, while it holds two or more items. */
function stackRowsOf(s: S): StackSummaryRow[] {
  return s.facts ? stackRows(s.facts) : [];
}


