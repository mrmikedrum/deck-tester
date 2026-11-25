// The viewport as a source: the layout size in CSS px and the safe-area insets, read when the page resizes or
// rotates. Bursts coalesce: a drain returns only the newest reading.
import { now } from "./clock";
import type { Ms } from "./clock";
import { Queue } from "./source";
import type { Source } from "./source";

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface ViewportReading {
  readonly at: Ms;
  readonly w: number;
  readonly h: number;
  readonly safe: Insets;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The viewport source, with a first reading already queued. */
export function viewportSource(): Source<ViewportReading> & { dispose(): void } {
  const q = new Queue<ViewportReading>(true);
  const doc = globalThis.document;
  const probe = doc?.createElement("div");
  if (probe) {
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;inset:0;" +
      "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    doc?.body.appendChild(probe);
  }
  const px = (s: string): number => Number.parseFloat(s) || 0;
  const read = (): void => {
    const cs = probe ? globalThis.getComputedStyle(probe) : null;
    q.push({
      at: now(),
      w: globalThis.innerWidth,
      h: globalThis.innerHeight,
      safe: cs
        ? { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) }
        : NO_INSETS,
    });
  };
  read();
  globalThis.addEventListener("resize", read);
  globalThis.addEventListener("orientationchange", read);
  return Object.assign(q, {
    dispose() {
      globalThis.removeEventListener("resize", read);
      globalThis.removeEventListener("orientationchange", read);
      probe?.remove();
    },
  });
}
