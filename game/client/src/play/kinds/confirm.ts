// confirm: Yes is option 1, No option 2, on the prompt (live.js `status`).
import type { ConfirmDecision } from "../../protocol";
import { promptText } from "../text";
import { base, btn } from "./kind";
import type { Kind } from "./kind";

export const confirm: Kind<ConfirmDecision> = {
  ...base<ConfirmDecision>(),
  words: (c) => ({ headline: promptText(c.d, c.f) }),
  buttons: () => [btn("yes", "Yes", () => ({ answer: { answer: [1] } }), { tone: "primary" }), btn("no", "No", () => ({ answer: { answer: [2] } }))],
};
