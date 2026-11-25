// The app's own notice with Reload: a stale page (the bridge serves another build) or repeated faults. It is a tiny DOM
// surface the app owns, outside the chrome's component tree and the scene, so it still shows when the game renderer is
// what keeps failing. The loop draws it every commit, after the renderer, whatever the renderer did.
import type { AppState } from "./state";

export interface NoticeView {
  readonly text: string;
}

/** What the player must be told, with Reload; null when all is well. */
export function noticeView(s: AppState): NoticeView | null {
  if (s.faults.notice === "render") return { text: "Something went wrong drawing the table." };
  if (s.faults.notice === "ingest") return { text: "Something went wrong reading the game." };
  if (s.session.stale) return { text: "This page is out of date." };
  return null;
}

export interface NoticeSurface {
  show(view: NoticeView | null): void;
  dispose(): void;
}

/** The surface, appended to `root`; `reload` is the page's (location.reload). Styled inline: it needs no stylesheet. */
export function noticeSurface(root: HTMLElement, reload: () => void): NoticeSurface {
  const doc = root.ownerDocument;
  const box = doc.createElement("div");
  box.dataset["audit"] = "notice";
  box.setAttribute("role", "alert");
  box.hidden = true;
  Object.assign(box.style, {
    position: "fixed",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    display: "flex",
    gap: "12px",
    alignItems: "center",
    padding: "10px 14px",
    borderRadius: "8px",
    background: "#2a1d14",
    color: "#f4e9d8",
    font: "15px/1.3 system-ui, sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,.5)",
  });
  box.style.display = "none";
  const text = doc.createElement("span");
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = "Reload";
  Object.assign(button.style, { font: "inherit", padding: "6px 12px", cursor: "pointer" });
  button.addEventListener("click", () => reload());
  box.append(text, button);
  root.append(box);
  let shown: string | null = null;
  return {
    show(view) {
      const next = view?.text ?? null;
      if (next === shown) return;
      shown = next;
      text.textContent = next ?? "";
      box.hidden = next === null;
      // `hidden` loses to an inline display: say it here too.
      box.style.display = next === null ? "none" : "flex";
    },
    dispose() {
      box.remove();
    },
  };
}
