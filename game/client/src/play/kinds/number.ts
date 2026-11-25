// number: a value from min to max on a stepper in a sheet; it starts at min, steps stay in range, Choose sends [value]
// (live.js `chooser` with no options).
import type { NumberDecision } from "../../protocol";
import { clampStep } from "../interactions/amount";
import { promptText } from "../text";
import { chooserPrompt } from "./chooser";
import { base, btn } from "./kind";
import type { Btn, Ctx, Kind } from "./kind";
import type { SheetView } from "../types";

function stepper(c: Ctx<NumberDecision>): SheetView & { readonly buttons: readonly Btn[] } {
  const { d, draft } = c;
  return {
    kind: "number",
    title: promptText(d, c.f),
    wide: false,
    items: [],
    stepper: { min: d.min, max: d.max, value: draft.value },
    buttons: [btn("value", "Choose", () => ({ answer: { answer: [draft.value] } }), { tone: "primary", role: "done" })],
    carried: null,
  };
}

export const number: Kind<NumberDecision> = {
  ...base<NumberDecision>(),
  start: (d) => ({ sel: [], holding: null, attackTo: null, value: d.min, mode: "sheet" }),
  words: (c) => ({ headline: promptText(c.d, c.f) }),
  buttons: () => chooserPrompt(),
  ownSheet: (c) => (c.s.chooserClosed ? null : stepper(c)),
  sheet: (c, open) => (open.k === "chooser" ? stepper(c) : null),
  step: (c, by) => (Number.isFinite(by) ? { draft: { ...c.draft, value: clampStep(c.draft.value, Math.trunc(by), c.d.min, c.d.max) } } : null),
};
