import { designUnit, NO_INSETS } from "./types";
import type { Insets, Rect, Viewport } from "./types";

// What the chrome takes of the screen, as rectangles the table keeps clear of. These are the old h.js HAND and PROMPT
// constants (stated for 1180x820, in design units) scaled as the old CSS scaled them: `--u` = min(w/1180, h/820), the
// hand anchored bottom-left and the prompt bottom-right. The safe-area insets move the chrome in from the screen's edges
// (the prompt's CSS adds them to its offsets), so each corner's rectangle grows inward by the insets at its edges: it
// stays anchored at the screen's corner (the strip outside the safe area is no place for a tap either) and its inner
// edges move by the insets. The chrome's own offsets from the corner stay what they were.

export type ChromeMode =
  | "normal" // the hand is up and the prompt asks
  | "mulligan" // the opening hand is its own sheet: the hand is away and the prompt is hidden
  | "sifting"; // a pile is open at full size: the hand is away and the prompt is hidden

export type ReservedKind = "hand" | "prompt";

export interface Reserved {
  readonly kind: ReservedKind;
  /** The resting position, CSS px. A hand that slides away leaves it where it rests: the board never shifts for it. */
  readonly rect: Rect;
  /** Whether the chrome is on screen now (false while it is away); placement ignores this, hit testing may not. */
  readonly visible: boolean;
  /** My front row may sit beside it (the old bandSpan notch). */
  readonly keepClear: "near-row";
}

export interface Reservations {
  readonly items: readonly Reserved[];
  /** The safe area, CSS px: the screen less its insets. A tap reaches only what is inside it. */
  readonly safe: Rect;
}

// The hand holds the bottom-left corner (about x 34-470u, from 605u down) and is up all the time, and the prompt the
// bottom-right (from 838u across, 630u down: 680u, and the one line of what I lost on top of it): nothing of mine goes
// behind either.
export const HAND_UNITS = { right: 470, top: 605 } as const;
export const PROMPT_UNITS = { left: 838, top: 630 } as const;
const SCREEN_UNITS = { w: 1180, h: 820 } as const;

export function reservations(viewport: Viewport, mode: ChromeMode = "normal", safe: Insets = NO_INSETS): Reservations {
  const u = designUnit(viewport), shown = mode === "normal";
  return {
    safe: { left: safe.left, top: safe.top, right: viewport.w - safe.right, bottom: viewport.h - safe.bottom },
    items: [
      {
        kind: "hand",
        rect: { left: 0, top: viewport.h - (SCREEN_UNITS.h - HAND_UNITS.top) * u - safe.bottom, right: HAND_UNITS.right * u + safe.left, bottom: viewport.h },
        visible: shown,
        keepClear: "near-row",
      },
      {
        kind: "prompt",
        rect: {
          left: viewport.w - (SCREEN_UNITS.w - PROMPT_UNITS.left) * u - safe.right,
          top: viewport.h - (SCREEN_UNITS.h - PROMPT_UNITS.top) * u - safe.bottom,
          right: viewport.w,
          bottom: viewport.h,
        },
        visible: shown,
        keepClear: "near-row",
      },
    ],
  };
}

/**
 * The chrome along the top that the opponents' leaves keep clear of (design units at 1180x820): the row of nameplates and
 * a gap under it, and the log strip under the Game button at its least (its turn heading; it narrows to that where a
 * card would be under it at its widest: app/seats.ts `feedWidthOf`).
 */
export const PLATES_UNITS = { top: 6, h: 44, clear: 8 } as const;
export const FEED_UNITS = { left: 12, top: 62, height: 44, widest: 322, least: 128, gap: 8 } as const;

export function topChrome(viewport: Viewport, safe: Insets = NO_INSETS): Rect[] {
  const u = designUnit(viewport);
  return [
    { left: safe.left, top: safe.top, right: viewport.w - safe.right, bottom: safe.top + (PLATES_UNITS.top + PLATES_UNITS.h + PLATES_UNITS.clear) * u },
    { left: safe.left + FEED_UNITS.left * u, top: safe.top + FEED_UNITS.top * u, right: safe.left + (FEED_UNITS.left + FEED_UNITS.least + FEED_UNITS.gap) * u, bottom: safe.top + FEED_UNITS.top * u + Math.max(FEED_UNITS.height, FEED_UNITS.height * u) },
  ];
}

export function reserved(r: Reservations, kind: ReservedKind): Rect | null {
  return r.items.find((i) => i.kind === kind)?.rect ?? null;
}
