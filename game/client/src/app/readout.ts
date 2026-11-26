// A plain text reading of app state: what the debug surface and the headless tests read the page as (the bridge, the
// table, the decision, the answer out, faults). Pure.
import * as play from "../play";
import { isBusy } from "./answers";
import type { AppState } from "./state";

/** The waiting prompt's line by the bridge's state (live.js `status` before a view: a game that is playing or over
 * with no view to show reads as no game yet). */
export const WAITING: Record<AppState["session"]["bridge"], string> = {
  connecting: "Connecting…",
  "no game": "No game yet",
  starting: "Shuffling up… (the first game takes about a minute)",
  playing: "No game yet",
  over: "No game yet",
  error: "Game couldn't start",
};

/** The line the waiting prompt shows before a game has a model. */
export function waitingLine(s: AppState): string {
  return WAITING[s.session.bridge];
}

/** Whether "New game" is offered beside the prompt: no game to show (once the bridge has said so, and not while one is
 * starting), or the game is over (live.js `status`). */
export function offersNewGame(s: AppState): boolean {
  const b = s.session.bridge;
  if (!s.model) return b !== "connecting" && b !== "starting";
  return s.model.over || b === "over" || s.session.over !== null;
}

export function readoutLines(s: AppState): string[] {
  const { session: ss, model, answer, faults } = s;
  const lines: string[] = [];
  if (ss.stale) lines.push("This page is out of date: reload to get the current client.");
  if (faults.notice) lines.push("Something went wrong drawing the table: reload.");
  lines.push(`${model ? ss.bridge : waitingLine(s)} · gen ${ss.gen ?? "-"} · v ${ss.v ?? "-"} · link ${ss.link}`);
  if (ss.error) lines.push(`bridge error: ${ss.error}`);
  if (model) {
    lines.push(`${model.label} · ${model.phase} · active ${model.active ?? "-"} · priority ${model.priority ?? "-"}`);
    lines.push(model.seats.map((p) => `${p.name} ${p.life}${p.out ? " (out)" : ""}`).join(" · "));
    if (model.stack.length) lines.push(`stack: ${model.stack.map((i) => i.text).join(" / ")}`);
  }
  const d = ss.decision;
  const prompt = play.present(s.play).controls.prompt;
  if (d) {
    const busy = isBusy(answer, ss.stop) ? ` · busy (${answer.pending?.phase})` : "";
    lines.push(`decision ${d.id}: ${d.kind} ${d.prompt ? `"${d.prompt}" ` : ""}· ${d.options.length} options${busy}`);
  }
  if (prompt) lines.push(`prompt: ${prompt.headline}${prompt.busy ? " (busy)" : ""} [${prompt.buttons.map((b) => b.label).join(" | ")}]`);
  if (answer.last) lines.push(`last answer: ${answer.last.how}${answer.last.reason ? `: ${answer.last.reason}` : ""}`);
  for (const t of s.narrative.toasts) lines.push(`notice: ${t.text}`);
  if (ss.over) lines.push(ss.over);
  if (faults.count) lines.push(`faults: ${faults.count}${faults.last ? ` (${faults.last.split("\n")[0]})` : ""}`);
  return lines;
}
