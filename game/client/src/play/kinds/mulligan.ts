// mulligan: the opening hand over a dimmed table, the hand fan away. Keep is option 1, Mulligan option 2; never
// "Let Forge decide" (live.js `mulligan`).
import type { MulliganDecision } from "../../protocol";
import { base, btn } from "./kind";
import type { Kind } from "./kind";

export const mulligan: Kind<MulliganDecision> = {
  ...base<MulliganDecision>(),
  defers: () => false,
  words: (c) => ({ headline: c.d.prompt.replace(/^keep this hand\??/i, "Keep this hand?") || "Opening hand" }),
  buttons: (c) => [
    btn("mulligan", "Mulligan", () => ({ answer: { answer: [2] } })),
    btn("keep", `Keep ${c.f.hand.length}`, () => ({ answer: { answer: [1] } }), { tone: "primary" }),
  ],
  style: "overlay",
  handAway: true,
};
