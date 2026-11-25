// targets and choose: on the table when every option is reachable there (reach.ts), else from the chooser. On the
// table a tap picks; one wanted, one tap sends; otherwise Done, disabled below min ("None" with nothing picked), and
// List opens the same choice as a sheet. The mode holds once the player has picked.
import type { ChooseDecision, TargetsDecision } from "../../protocol";
import { seatId } from "../../model";
import { toggle } from "../interactions/pick";
import { onTable } from "../reach";
import { promptText } from "../text";
import { chooserPick, chooserPrompt, chooserSheet } from "./chooser";
import { base, btn } from "./kind";
import type { Ctx, Kind } from "./kind";

type Choice = TargetsDecision | ChooseDecision;

export const modeOf = (c: Ctx<Choice>): "board" | "sheet" => c.draft.mode ?? (onTable(c.d, c.f, c.s.groups) ? "board" : "sheet");

function choiceKind<D extends Choice>(): Kind<D> {
  return {
    ...base<D>(),
    prefetch: true,
    words(c) {
      const { d, draft } = c;
      if (modeOf(c) === "sheet") return { headline: promptText(d, c.f) };
      // targets say their count; Done (n) counts
      return { headline: promptText(d, c.f) + (d.max > 1 && d.kind !== "targets" ? ` (${draft.sel.length}/${d.max})` : "") };
    },
    buttons(c) {
      const { d, draft } = c;
      if (modeOf(c) === "sheet") return chooserPrompt();
      const out = [btn("list", "List", () => ({ sheet: { k: "chooser" } }))];
      if (d.max > 1 || d.min === 0)
        out.push(
          btn("done", draft.sel.length ? `Done (${draft.sel.length})` : "None", () => ({ answer: { answer: [...draft.sel] } }), {
            tone: "primary",
            role: "done",
            enabled: draft.sel.length >= d.min,
          }),
        );
      return out;
    },
    marks(c, m) {
      if (modeOf(c) !== "board") return;
      c.d.refs.forEach((r, i) => {
        const mark = c.draft.sel.includes(i + 1) ? "selected" : "option";
        if (r.card !== null) m.card(r.card, mark);
        else if (r.player !== null) m.seat(seatId(r.player), mark);
      });
    },
    ownSheet: (c) => (modeOf(c) === "sheet" && !c.s.chooserClosed ? chooserSheet(c) : null),
    sheet: (c, open) => (open.k === "chooser" ? chooserSheet(c) : null),
    tap(c, at) {
      if (modeOf(c) !== "board") return null;
      const i = c.d.refs.findIndex((r) => (at.seat !== null ? (r.player as string | null) === (at.seat as string) : r.card !== null && at.ids.includes(r.card)));
      if (i < 0) return null;
      const p = toggle(c.draft.sel, i + 1, c.d);
      const draft = { ...c.draft, sel: p.sel, mode: "board" as const };
      return p.done ? { draft, answer: { answer: [...p.sel] } } : { draft };
    },
    pick: (c, o) => chooserPick(c, o, modeOf(c)),
  };
}

export const targets: Kind<TargetsDecision> = choiceKind<TargetsDecision>();
export const choose: Kind<ChooseDecision> = choiceKind<ChooseDecision>();
