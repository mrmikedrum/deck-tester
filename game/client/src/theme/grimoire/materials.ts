// Material and light parameters of the table, named: the numbers old h.js and fx.js set inline. The scene's three.js
// host reads these; nothing here imports three.
import { fx, signal } from "../tokens";

/**
 * A card in world units: it is 1 tall (88 mm), so 0.3 mm of card stock is 0.0034. (Layout's CW, CH and TH are the same
 * numbers; a test holds them equal.)
 */
export const card = { w: 0.716, h: 1, thickness: 0.0034, corner: 0.045, curveSegments: 4 } as const;

/**
 * A card as an object on the table: lit card stock at its true thickness, so a pile of 14 lands is 5 mm and a library of
 * 67 about 2 cm. Its faces are lit paper with a faint grain; its cut edges are cream stock; a pile's walls show a fine
 * line per card.
 */
export const slab = {
  /** One card's stock, world units (its true thickness). */
  depth: card.thickness,
  /** The stock's colour where it is cut (a token's a little greyer), and how rough the paper is. */
  stock: 0xe2d3ac,
  tokenStock: 0xcdbf98,
  roughness: 0.85,
  /** A face: how glossy the card stock is, how much of the room it reflects, and its grain (a bump, its tile per card). */
  face: { roughness: 0.52, env: 0.5, grain: 0.0009, grainTiles: [5, 7] as const },
  /** What each card under the top one adds to a block (its true thickness), and the most a block rises. */
  step: card.thickness,
  cap: 0.5,
  /** A mixed pile is a staircase: each card lies on the one under it, turned this much past it. */
  stairTurn: 0.035,
  stairShow: 5,
  /** The contact shade under what touches the vellum: this much larger than it, this dark. */
  contact: { grow: 1.1, opacity: 0.5 },
  /** A standing card's foot: the soft dark where it meets the page, this deep (world units) and this dark. */
  foot: { depth: 0.16, opacity: 0.55 },
  /** A standing card's foot rests on the vellum: its lowest corner this far off it. */
  standOff: 0.004,
} as const;

/** What a card's edge burns with, by signal: the band's width in uv (a fraction of the card). */
export const rim = {
  /** No signal: the rim is dark and thin. */
  idle: 0.028,
  /** What you can act on: a soft ember ring that breathes. */
  option: 0.024,
  /** What a moment brings forward: the lamp's light round its edge, soft and still (just under the hard band). */
  lit: 0.036,
  /** How bright that edge burns: enough to find at a glance across the table, still under the ember's flame. */
  litGain: 1.3,
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

export const tone = { exposure: 0.95, msaaSamples: 2 } as const;

/** The pixel ratio cap for the renderer and composer. */
export const pixelRatio = { renderer: 2 } as const;

/** The camera's clip planes (its fov and place are layout's template). */
export const camera = { near: 1, far: 120 } as const;

/**
 * The light: one warm lamp up and to the left of the table, a little toward me, so standing cards face it and throw their
 * shade back and to the right across the page; its cone and distance make a pool that falls off toward the far corners.
 * The table's texture paints no lamplight of its own (the lamp does it). A warm fill from the room, and a faint
 * reflection of it for the card stock's sheen. Soft shadow maps, drawn again only while something moves.
 */
export const lights = {
  lamp: {
    colour: 0xffcf98,
    intensity: 2800,
    angle: 0.62,
    penumbra: 1,
    decay: 2,
    at: { x: -11, y: 23, z: 6 },
    aim: { x: 0.5, y: 0, z: -3 },
    shadow: { size: 2048, radius: 4, near: 14, far: 48, bias: -0.00008, normalBias: 0.006 },
  },
  fill: { sky: 0xffe4c0, ground: 0x2a1a0e, intensity: 0.32 },
  room: { intensity: 0.08, blur: 0.04 },
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

/**
 * A highlight steps chosen cards out of the table's light: they rise a little toward me, are drawn flat (1 is the face as
 * painted, unlit), and a thin halo in their meaning's colour rings them, while a scrim dims the rest of the table (its
 * alpha). Each moment has its look; `ms` is how long a card takes to step out or back. The tones: ember for mine (what I
 * may choose, what my spell aims at), blood for a threat (a spell aimed at what is mine), gold for a spell.
 */
export const highlight = {
  ms: 200,
  /** The stack as the focus: the spell held up, and what it aims at. The table stays plainly lit under it (the owner:
   *  much lighter than the render study's 0.55). */
  stack: { dim: 0.16, lift: 0.14, flat: 0.85, halo: 1 },
  /** Choosing targets: the cards I may choose. A lighter touch still: the table stays readable round them. */
  target: { dim: 0.12, lift: 0.12, flat: 0.8, halo: 1 },
  tones: { mine: signal.option, threat: signal.dangerRim, spell: signal.giltRim },
} as const;

/**
 * The clash's shade: a light scrim over the table (`clash`, the owner found a deep one far too dark), and under the
 * fighters a calm ground of the page's own tone over the clash's area (`ground`: its colour and how much it covers,
 * `feather` px of soft edge), so no pile or name behind the fight shows through. Tuned on stills: nothing behind the
 * fight competes with it, and nothing reads as a hole in the table. A fighter on the plane takes `fighters` of the lamp
 * it would have on the table beneath: the plane stands over the bright near middle, and its cards come from the leaves.
 */
export const shade = { clash: 0.24, ground: { colour: 0xc9b48a, alpha: 0.86, feather: 26, pad: 14 }, fighters: 0.9 } as const;

/**
 * A camera move onto a card or an area, and back: never free navigation, always a composed view. It comes down lower
 * than the table's camera (`elevation` from the table, radians) and a little from the right (`yaw`), narrower (`fov`,
 * degrees), near enough that its subject fills `fill` of the screen's height, over `ms` (eased in and out; reduced
 * motion cuts).
 */
export const zoom = { ms: 650, fov: 30, elevation: 0.66, yaw: 0.32, fill: 0.46, seatFill: 0.9 } as const;
