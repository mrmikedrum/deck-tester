// The theme's tokens: one TypeScript object that feeds the CSS custom properties (css.ts), the canvas painters
// (grimoire/) and the three.js materials. Every number here is a tuned value carried over from the old h.js THEME,
// common.css and fx.js; its comment says what it does. Nothing else in the client spells a colour.

/** Where a seat sits relative to the viewer (layout's SeatPosition): colours follow the place, never the player. */
export type SeatPlace = "near" | "left" | "across" | "right";

/** Signals say what you can do, and nothing else on the table uses them: fire, gilt and blood. */
export const signal = {
  option: "#ff8a2a", // ember: what you can act on
  selected: "#f1c86a", // gold leaf: what you chose
  danger: "#ff3a3a", // blood: what is aimed at your things
  /** On a card's edge, danger is deep blood laid on. */
  dangerRim: "#c81e1e",
  /** And chosen is gold leaf, deeper than the pale gilt of the halos, so it stands off a card's cream name strip. */
  giltRim: "#e0a62c",
  /** The danger text and ink on parchment. */
  dangerInk: "#9c1f24",
} as const;

/** The Grimoire: the table is the open pages of a tome, each seat an illuminated page bound in oxidised bronze. */
export const colour = {
  table: "#1a110a",
  wood: { base: "#2b1d12", light: "#3b2717", dark: "#130c07" },
  page: { base: "#cdbb92", mine: "#d8c7a0", lit: "#e4d4ae", theirs: "#c2af86", shade: "#8a7554", gutter: "#1a110a" },
  ink: "#1a120a",
  ink2: "#4a4136",
  ink3: "#7c715f",
  bone: "#e9d9b4",
  bone2: "#dccb9f",
  bone3: "#c9b58c",
  boneDim: "#b9a884",
  text: "#f3ece0",
  muted: "#a69c8b",
  panel: "rgba(22, 18, 14, 0.92)",
  line: "rgba(239, 230, 210, 0.12)",
  bronze: "#8a6a3a",
  gold: "#d6b27a",
  commander: "#f1c86a",
  buff: "#72e092",
  hurt: "#ff6f6f",
  /** A card's edge on the table (three.js reads these as hex integers). */
  cardEdge: 0x2a1f14,
  tokenEdge: 0x2a1f14,
  standee: 0x3a2a18,
  /** The shade a sift lays over the table (old h.js `sift`: near-black, a little blue). */
  siftShade: 0x05080c,
  /** The scrim the stack lays over the table while it is the focus: warm near-black. */
  stackScrim: 0x0c0704,
} as const;

/** Seat colours say whose things are whose. */
export const seat: Readonly<Record<SeatPlace, string>> = {
  near: "#4d7a6a",
  left: "#6b2a3a",
  across: "#2f4a7a",
  right: "#8a6a3a",
};

/**
 * The same seats at full strength, for the pages' rules and the lanes. The left seat is wine, never the scarlet of
 * danger; mine is deep teal, which holds on the tan page where a pale mint washes out.
 */
export const seatInk: Readonly<Record<SeatPlace, string>> = {
  near: "#1f8a7a",
  left: "#6b2a3a",
  across: "#1f50b8",
  right: "#a8921a",
};

/** The fonts the painters and the chrome use (the families `platform/fonts` loads). */
export const font = {
  /** Numbers, names, labels. */
  num: '"Barlow Condensed", "Arial Narrow", sans-serif',
  ui: '"Barlow", -apple-system, "Helvetica Neue", Arial, sans-serif',
  serif: '"IM Fell English", Georgia, serif',
} as const;

/** The design unit's scale: sizes in the chrome are multiples of `--u` (1 px at 1180 x 820). */
export const space = { u: 1, s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32, radius: 6, radiusLg: 16 } as const;

/** Motion timings, ms. The values the architecture doc and the old director name; the animator reads them. */
export const motion = {
  /** Hold to peek at a card. */
  hold: 380,
  /** The turn's edge changing hands on a page: out, then in. */
  turnHandoff: 300,
  /** The stack's printed card coming up over its painted face as it rises (and going as it is set aside). */
  stackPrint: 250,
  /** A cut settles at once; a flight to a pile past this is a cut. */
  flightLimit: 2000,
  /** A change set older than this is played compressed. */
  backlogOld: 1500,
  /** Past this wait all but the newest change set collapse into a cut. */
  backlogCut: 3000,
  /** Chrome transitions. */
  fast: 120,
  base: 250,
  slow: 400,
  /** What you can act on breathes: sin(t / optionPeriod), the rim at 0.7 +- 0.3 of its colour. */
  optionPeriod: 420,
  /** Danger beats: a heartbeat on the card's edge, sin(t / dangerPeriod)^4. */
  dangerPeriod: 300,
} as const;

/** Mana as light (fx.js). Black is violet with a dark heart; colourless is cold silver. */
export const mana = {
  W: "#ffe3a0",
  U: "#3fa6ff",
  B: "#9a4cff",
  R: "#ff5a1f",
  G: "#4fe26f",
  C: "#bcd2e8",
} as const;
export const manaDark = {
  W: "#c98a2a",
  U: "#0b3fa8",
  B: "#2a0450",
  R: "#8a0e00",
  G: "#0a5a28",
  C: "#3a4a5a",
} as const;
export type ManaKey = keyof typeof mana;

/** The colours of the table's magic. */
export const fx = {
  /** Linear brightness of the additive sparks and arcs before tone mapping. */
  hdr: 2.6,
  /** Embers under a card you can act on: the warm ember of the signal palette, never a mana colour. */
  embers: ["#ffb347", "#ff7a1a", "#ffd58a"],
  /** The danger sigil's burnt line, its singed edge, and the heat left in it. */
  sigil: { burn: "#170904", singe: "rgba(96,46,14,.55)", singeShadow: "rgba(110,52,14,.9)", heat: "#8e1a10" },
  /** A well's stain under a land: its colour blended toward this. */
  wellStain: "#3a2a1c",
  /** The pool of light under what you chose. */
  pool: "#f1c86a",
  /** The pale pool a presented card stands lifted on; news and answers are this pale light too. */
  pale: "#fff1d2",
  /** The mist at the foot of what is not yet awake (summoning sick). */
  mist: "#b9c4cc",
  /** The low red of something that can hurt me: banked, never a flare. */
  threat: "#c8321e",
  /** Ink ribbon of an attack: the core of a spell's line. */
  spellCore: "#fff0c0",
} as const;

/** Everything as one object, for the CSS generator and anything that wants the whole theme. */
export const tokens = { signal, colour, seat, seatInk, font, space, motion, mana, manaDark, fx } as const;
export type Tokens = typeof tokens;
