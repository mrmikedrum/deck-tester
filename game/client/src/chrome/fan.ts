// The hand's fan: where each held card rests, as a pure function of the cards, the fan's focus (a fractional index,
// sprung) and the design unit. Ported from live.js `poses` with every tuned number named.
//
// The fan is held in the bottom-left corner. The card under the focus opens to show in full while the rest bunch up to
// their name's shoulder (just wide enough to read the longest word of the name); a card being thumbed over lifts; the
// fan leans with the push of a turn. Positions are CSS px relative to the fan's origin (the middle of the fan's
// bottom edge); each card's element sits centred on the origin, pivoting on its bottom middle.

/** A card's width in design units, the fan's span in card widths, the widest gap (an opened card) in card widths. */
export const HELD = { w: 150, span: 1.9, open: 0.94 } as const;
/** A card's height over its width (488 x 680). */
export const CARD_ASPECT = 680 / 488;
/** The fan's origin: this far in from the left of the hand's reserve, plus half the fan, and up from its bottom (u). */
export const HAND_INSET = { left: 18, bottom: 8 } as const;

/** A bunched card shows its name this wide: the longest word plus this padding (px). */
const SHOULDER_PAD = 11;
/** While thumbing, the opened gap takes up to this share of the span. */
const THUMB_SHARE = 0.46;
/** Responding, the playable cards share the room the others give up, plus this much (u). */
const RESPONSE_ROOM = 40;
/** Lean: the spring's velocity times this, clamped to +-1. */
const LEAN_GAIN = 14;
/** At full lean a card shifts this share of a card width, and tilts this many degrees (more near the focus). */
const LEAN_SHIFT = 0.05;
const LEAN_TILT = 3;
/** How much the lean reaches cards away from the focus: base + (1 - base) * e^-distance. */
const LEAN_REACH = 0.4;
/** The fan's arc: the end cards drop this share of a card width and tilt this many degrees. */
const ARC_DROP = 0.025;
const ARC_TILT = 1.5;
/** The card being thumbed over rises this share of a card width and tips this many degrees with the turn. */
const THUMB_LIFT = 0.07;
const THUMB_TIP = 2;
/** A name strip is the gap it has, less this (px). */
const LABEL_INSET = 4;
/** A name strip's padding, left and right together (`.l-hand-label`: 3 px each side). */
const LABEL_PAD = 6;
/** Kept free inside a strip (px): the DOM sets text a hair wider than a canvas measures it. */
const LABEL_SLACK = 0.5;
/** A name shrinks no smaller than this (px); a word that still does not fit is ellipsized. */
export const LABEL_MIN_PX = 8;
/** z-index of the first card; each later card is one higher. */
const Z_BASE = 10;

export interface FanInput {
  /** The cards' names, in hand order (the shoulders are measured from them). */
  readonly names: readonly string[];
  /** Which cards have a play (only read while responding). */
  readonly playable: readonly boolean[];
  /** The focus: a fractional index, where the spring has it. */
  readonly f: number;
  /** The spring's velocity (index per frame): the lean. */
  readonly vel: number;
  /** The player is turning through the fan (an opened gap follows the focus). */
  readonly thumbing: boolean;
  /** Responding with plays on offer: the playable cards open. */
  readonly respond: boolean;
  /** The design unit, CSS px. */
  readonly u: number;
  /** A word's width in the label font (`labelFont(u)`), CSS px. */
  readonly measure: (word: string) => number;
}

export interface FanPose {
  readonly x: number;
  readonly y: number;
  /** Degrees, clockwise. */
  readonly rot: number;
  readonly z: number;
  /** How wide the name strip may be (px). */
  readonly label: number;
}

/** The card's size in CSS px. */
export function cardSize(u: number): { readonly w: number; readonly h: number } {
  const w = HELD.w * u;
  return { w, h: w * CARD_ASPECT };
}

/** The name strip's font size (px) and font (live.css `.l-hand-label`): what the shoulders are measured in. */
export const labelPx = (u: number): number => Math.max(12, 14 * u);
export const labelFont = (u: number): string => `700 ${labelPx(u)}px "Barlow Condensed", sans-serif`;

/** How a name fits its strip: the font's scale (1 at full size) and whether a word is ellipsized even at the floor. */
export interface LabelFit {
  readonly k: number;
  readonly tight: boolean;
}

/**
 * The scale at which a name's longest word fits a strip `width` px wide (padding included), so a name breaks only
 * between words. A bunched hand gives a card less than its name's shoulder; the name shrinks rather than breaking
 * mid-word ("Fore/st"), down to LABEL_MIN_PX, below which the word is ellipsized.
 */
export function labelFit(name: string, width: number, u: number, measure: (word: string) => number): LabelFit {
  const words = name.split(/\s+/).filter(Boolean);
  const longest = words.length ? Math.max(...words.map((word) => measure(word))) : 0;
  const room = Math.ceil(width) - LABEL_PAD - LABEL_SLACK;
  if (longest <= room) return { k: 1, tight: false };
  const floor = Math.min(1, LABEL_MIN_PX / labelPx(u));
  const k = Math.floor((Math.max(0, room) / longest) * 1000) / 1000;
  return k >= floor ? { k, tight: false } : { k: floor, tight: true };
}

/** The fan's origin from the left of the hand's reserve (px). */
export const fanLeft = (u: number): number => HAND_INSET.left * u + (cardSize(u).w * (HELD.span + 1)) / 2;

export function fan(input: FanInput): FanPose[] {
  const { names, f, u } = input;
  const n = names.length;
  if (!n) return [];
  const { w: W } = cardSize(u);
  const span = W * HELD.span, wide = W * HELD.open;
  const gaps = n - 1; // gap i lies between card i and card i + 1
  const open = (i: number): number => Math.max(0, 1 - Math.abs(i - f));
  const weights = Array.from({ length: gaps }, (_, i) => (input.thumbing ? open(i) : 0));
  const shoulders = names.slice(0, gaps).map((name) => {
    const words = name.split(/\s+/).filter(Boolean);
    const longest = words.length ? Math.max(...words.map((word) => input.measure(word))) : 0;
    return Math.min(wide, SHOULDER_PAD + longest);
  });
  const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
  const opened = sum(weights), needed = sum(shoulders);
  const rest = shoulders.map((w) =>
    Math.min(wide, needed > span ? (w * span) / needed : w + (span - needed) / shoulders.length),
  );
  const reserved = Math.min(wide, span * THUMB_SHARE) * opened;
  const response = input.respond && !input.thumbing ? input.playable.slice(0, gaps).map(Boolean) : [];
  const room = sum(rest.map((w, i) => (response[i] ? 0 : Math.max(0, w - (shoulders[i] ?? 0)))));
  const openedResponses = response.filter(Boolean).length;
  const step = rest.map((w, i) => {
    if (openedResponses)
      return response[i] ? Math.min(wide, w + (room + RESPONSE_ROOM * u) / openedResponses) : Math.min(w, shoulders[i] ?? w);
    return Math.min(wide, (w * (span - reserved)) / span + (opened ? (reserved * (weights[i] ?? 0)) / opened : 0));
  });
  const xs = [0];
  for (const w of step) xs.push((xs[xs.length - 1] ?? 0) + w);
  const total = xs[xs.length - 1] ?? 0;
  const mid = total / 2, half = Math.max(1, mid), extra = Math.max(0, total - span) / 2;
  const lean = Math.max(-1, Math.min(1, input.vel * LEAN_GAIN)), dirn = input.vel < 0 ? 1 : -1;
  return xs.map((x0, i) => {
    const k = (x0 - mid) / half, near = LEAN_REACH + (1 - LEAN_REACH) * Math.exp(-Math.abs(i - f));
    const lift = Math.sin(Math.PI * Math.max(0, Math.min(1, 1 - Math.abs(i - f - 0.5) * 2)));
    return {
      x: x0 - mid + extra - lean * W * LEAN_SHIFT * near,
      y: k * k * W * ARC_DROP - lift * W * THUMB_LIFT,
      rot: k * ARC_TILT - lean * LEAN_TILT * near + lift * THUMB_TIP * dirn,
      z: Z_BASE + i,
      label: Math.max(0, (step[i] ?? W) - LABEL_INSET),
    };
  });
}
