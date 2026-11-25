// Material and light parameters of the table, named: the numbers old h.js and fx.js set inline. The scene's three.js
// host reads these; nothing here imports three.
import { fx } from "../tokens";

/** A card in world units: it is 1 tall. (Layout's CW, CH and TH are the same numbers; a test holds them equal.) */
export const card = { w: 0.716, h: 1, thickness: 0.014, corner: 0.045, curveSegments: 4, faceLift: 0.0008 } as const;

/**
 * A card as a playing piece on the table (the scene's, never layout's: layout's TH stays the card's true thickness). It
 * is drawn as a slab of cream stock, far thicker than a real card, its depth running down from the face, so a card
 * lying on the vellum has a lit near edge and a stack of them is a block whose height is its count.
 */
export const slab = {
  /** The stock under a face, world units (about 3 px at table size). */
  depth: 0.03,
  /** The stock's colour: lit by the lamp, so its near edge catches the light and its sides fall into shade. */
  stock: 0xe2d3ac,
  tokenStock: 0xcdbf98,
  roughness: 0.85,
  /** What each card under the top one adds to a block, and the most a block rises (a quarter of a card). */
  step: 0.018,
  cap: 0.25,
  /** A zone's block (a library, a graveyard): finer, so a library of 67 is the tallest thing on its leaf. */
  zoneStep: 0.0075,
  zoneCap: 0.4,
  /** Strata on a block's walls: one line per card, never closer together than this (world units). */
  strataMin: 0.016,
  /** A mixed pile is a staircase: each card one slab higher than the one under it, turned this much past it. */
  stairTurn: 0.035,
  stairShow: 5,
  /** The contact shadow under a lying card or block: this much larger than it, this dark. */
  contact: { grow: 1.1, opacity: 0.62 },
  /**
   * The cast shadow: the card's soft silhouette projected onto the vellum it rests on (planar, so it is exact for any
   * posture), its shade, how dark, and where the lamp it is cast from stands: on my side, above and to the left, low
   * enough that a standing card's shadow clears its own top and falls back and to the right, away from me.
   */
  cast: { colour: 0x1e1004, opacity: 0.5, from: { x: -8, y: 11, z: 10 } },
  /** A standing card's foot rests on the vellum: its lowest corner this far off it. */
  standOff: 0.004,
  /** The lamp's line along the near edge of a face (a share of the card), and how bright. */
  highlight: { w: 0.012, k: 0.22 },
} as const;

/** What a card's edge burns with, by signal: the band's width in uv (a fraction of the card). */
export const rim = {
  /** No signal: the rim is dark and thin. */
  idle: 0.028,
  /** What you can act on: a soft ember ring that breathes. */
  option: 0.024,
  /** Chosen: a gilt band three embers wide, crisp and unlit, a line of ink round it. */
  selected: 0.072,
  /** Danger: a narrower band of blood, darkening and deepening with a heartbeat but never lit. */
  danger: 0.04,
  /** Where the band switches from soft ember glow to a hard gilt band. */
  hardAbove: 0.039,
  /** The option's breath: its colour scaled by 0.7 + 0.3 sin. The danger's heartbeat: 0.72 + 0.28 sin^4. */
  optionBreath: { base: 0.7, swing: 0.3 },
  dangerBeat: { base: 0.72, swing: 0.28 },
} as const;

/** The face shader's tone for the two looks: tapped keeps its colour but darkens and cools; dim greys out what is in the background. */
export const faceTone = {
  tap: { mix: 0.5, tint: [0.5, 0.5, 0.56] },
  dim: { grey: 0.42, amount: 0.88 },
} as const;

/** The post-processing: light brighter than white blooms (spells and arcs; cards and pages never reach it). */
export const bloom = { strength: 0.75, radius: 0.55, threshold: 1.15 } as const;
export const tone = { exposure: 0.95, msaaSamples: 2 } as const;

/** The pixel-ratio policy: the renderer at most 2, the composer's targets at most 1.5. */
export const pixelRatio = { renderer: 2, composer: 1.5 } as const;

/** The camera's clip planes (its fov and place are layout's template). */
export const camera = { near: 1, far: 120 } as const;

/** One lamp over the table, warm, and a little of the room: pages shade by it, cards never do. */
export const lights = {
  ambient: { colour: 0xffe6c4, intensity: 0.35 },
  lamp: { colour: 0xffc98a, intensity: 260, distance: 70, decay: 1.7, at: { x: 0, y: 17, z: -4 } },
  sun: {
    colour: 0xffe9cc,
    intensity: 0.6,
    at: { x: -4, y: 20, z: 12 },
    shadow: { size: 2048, half: 18, near: 1, far: 60, bias: -0.0004, normalBias: 0.02 },
  },
} as const;

export const surface = {
  edge: { roughness: 0.8 },
  edgeDark: { roughness: 0.7 },
  bronze: { metalness: 0.75, roughness: 0.6 },
  chip: { metalness: 0.6, roughness: 0.5, radius: 0.16, height: 0.06, segments: 28 },
  /** The table plane: the tome's normal map repeats 6 x 5 at 0.6 strength. */
  table: { roughness: 0.95, normalScale: 0.6, normalRepeat: [6, 5] as const },
  /** A stack card's drop shadow, and a standee's cast shade (colour and opacity). */
  drop: { opacity: 0.75 },
  shade: { colour: 0x2a1806, opacity: 0.85, lift: 0.006 },
  /** The halo plane around a card is this many cards wide and tall. */
  halo: { w: 1.62, h: 1.46 },
} as const;

/** The FX palette stays with the tokens; re-exported so a renderer finds light and its colours together. */
export const palette = fx;
