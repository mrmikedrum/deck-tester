// The animator's math and every tuned number of the table's motion, ported from the old client (h.js `buildBoard`,
// `layout`, `buildStack`; live.js `MOVE`). Pure: no three.js, no clock; time is always an argument.
import type { V3 } from "../../layout";
import { materials, motion as themeMotion } from "../../theme";

// ---- tuned numbers ---------------------------------------------------------------------------------------------------

/** How long each kind of move takes, ms. The values are the old client's; the comment names where each came from. */
export const DURATION = {
  /** live.js `MOVE`: the board's move on a new view (seat.refresh(MOVE)). Everything that just follows the view. */
  move: 520,
  /** live.js `redraw(300)`: a new decision on the same view (marks, lanes). */
  decision: 300,
  /** h.js `focusOn` → buildBoard(500): leaning in on a page, sitting back. */
  focus: 500,
  /** h.js `refitT` → buildBoard(900): the unhurried re-fit after the last card has left. */
  refit: 900,
  /** h.js flights: `Math.max(450, ms)`: no flight between zones is shorter than this. */
  minFlight: 450,
  /** A resolving spell leaves the stack fast (`spell ? 450`). */
  spell: 450,
  /** A spell that stood as the focus, far larger than where it goes, sheds its size over a longer way (`big ? 800`). */
  bigSpell: 800,
  /** A permanent clears its page before it flies (`lift = 80`); one leaving a pile rises clear of it first (160). */
  lift: 80,
  pileLift: 160,
  /** A token that ceases to exist burns out where it stood: a beat, then 450 ms (`wait + 80`, `total = wait + 450`). */
  burnWait: 80,
  burn: 450,
  /** A card joining a pile already on the table (`tween(wait + 520)`). */
  join: 520,
  /** From an ability, once it has mostly drawn in (`src.m.userData.ability ? 250`). */
  joinAfterAbility: 250,
  /** A piece folding into another (`Math.max(300, ms)`). */
  into: 300,
  /** An ability done withdraws to its controller's plate (h.js: `tween(700)`). */
  withdraw: 700,
  /** A pile's cards fanning out of it into a sift (h.js `sift`: `tween(520)`), and the shade coming up with them. */
  sift: 520,
  /** And back into their pile (h.js `unsift`: `tween(380)`). */
  unsift: 380,
  /** The turn's edge passing from page to page: the old one is gone in the first half before the new inks in. */
  turnHandoff: themeMotion.turnHandoff,
  /** A tap turns the card (old: instant, a rebuild; a guess so the turn is seen, see the stage report). */
  tap: 200,
  /** A mark's rim comes up (old: instant; a guess). */
  glow: 150,
} as const;

/** Stagger: cards bound for the same place set off one after another, so each can be followed into it. */
export const STAGGER = {
  /** h.js `trips`: `n * Math.min(140, 700 / ls.length)`: a wipe is many trips, not one clump. */
  tripStep: 140,
  tripSpan: 700,
  /** h.js joins: `each = Math.min(240, 900 / total)`, one queue across every pile gaining cards. */
  joinStep: 240,
  joinSpan: 900,
} as const;

/** Where flights go and how they arc (h.js `buildBoard` flights and joins). */
export const PATH = {
  /** A permanent lifts this far off its page before it flies (`up = from + (0, .15, 0)`). */
  rise: 0.15,
  /** Out of a pile: `0.15 + CH * s0 * 0.4`. */
  pileRise: 0.4,
  /** A standing card arcs over its neighbours' tops (`CH * s0 * 0.7`); anything else a little (`0.6`). */
  standeeArc: 0.7,
  arc: 0.6,
  /** It lies down and takes the pile's size in the first part of its way (`settle = pile ? .55 : big ? .8 : 1`). */
  settlePile: 0.55,
  settleBig: 0.8,
  /** It starts shedding its size a quarter of the way in, unless it lands on a pile or was big (`smooth(.25, settle)`). */
  shrinkFrom: 0.25,
  /** A spell is "big" (the stack's focus) when it stood 1.5x larger than where it goes. */
  bigRatio: 1.5,
  /** The ease exponents: a permanent `1 - (1-r)^2.2`, a spell `1 - (1-r)^3`. */
  permanentOut: 2.2,
  spellOut: 3,
  /** A token burning out rises this far (`l.pile ? CH * s0 * .5 : .25`). */
  burnRise: 0.25,
  burnPileRise: 0.5,
  /** A card to a library, a hidden hand or the command zone goes to its owner's plate at this size (`s: 0.3`). */
  plateSize: 0.3,
  /** The plate a card comes from or goes to: just above it (`plateAt`: `+ (0, 0.6, 0)`). */
  plateUp: 0.6,
  /** A card new to the table comes from its controller's plate at half size (`scale 0.5`). */
  entrySize: 0.5,
  /** Into my hand: at half size (`{ pos: (0, .5, 9), s: .5 }`), at the hand's height. */
  handSize: 0.5,
  handHeight: 0.5,
  /** Cast from my hand: out of its slot at the hand, two units up (`tableAt(..., 2)`). */
  castHeight: 2,
  /** A spell flying onto the stack: from half its size (`sc * 0.5`), arcing up 1.2 (mine) or 0.3 (theirs, along the middle). */
  castFrom: 0.5,
  castArc: 1.2,
  castArcTheirs: 0.3,
  /** Mine onto spells already standing comes up into its place from under it (`to - up * CH * sc * 1.3`). */
  castUnder: 1.3,
  /** Joining a pile: from in front of it toward the table's middle (`2.2 * s`), 0.6 up, from 0.8 of its size. */
  joinVia: 2.2,
  joinViaUp: 0.6,
  joinFrom: 0.8,
  /** A fold travelling past a neighbour hops over the row (`CH * s0 * 1.08` when further than `CW * s0 * 1.5`). */
  intoHop: 1.08,
  intoHopPast: 1.5,
  /** A spell that resolves onto the table is the same card coming down: its permanent starts where it stood. */
  ability: 0.8,
} as const;

/** How the table dims (h.js `targets`): out of focus is dimmer and greyer, never dark. */
export const DIM = {
  /** Another seat while I lean in on one (`0.55`); my own things then (`0.45`). */
  leanOther: 0.55,
  leanMine: 0.45,
  /** The others' things on another player's turn (`soft`: `0.4`). */
  soft: 0.4,
  /** The table itself under a sift (`tableMesh` colour 0.42). */
  table: 0.42,
  /** In a fight, what doesn't fight: creatures (`0.45`), everything else on the pages (`0.7`) (h.js `targets`). */
  fightCreature: 0.45,
  fightOther: 0.7,
  /** A chosen card lifts off its page (`t.lift = 0.1`). */
  selectedLift: 0.1,
} as const;

/**
 * The stack as the focus: one warm near-black scrim over the whole table (the sift's mechanism), in over 250 ms and out
 * over 180. Its alpha is the look's (as a scrim over the finished picture); the host applies it before tone mapping.
 */
export const SCRIM = { alpha: materials.highlight.stack.dim, inMs: 250, outMs: 180 } as const;

/** The bounded backlog (docs: "The backlog is bounded"); ages from the theme's motion timings. */
export const BACKLOG = {
  /** More than this many waiting: the older ones play compressed. */
  compressWaiting: 2,
  compressAge: themeMotion.backlogOld,
  /** More than this many waiting, or the oldest this old: all collapse into a cut to the newest model. */
  cutWaiting: 8,
  cutAge: themeMotion.backlogCut,
  /** Compressed: this much of each duration, no stagger. (A guess: the doc says "shorter".) */
  compress: 0.5,
} as const;

/** Causality's phase gaps (docs "Ordering is one table"). The old director ran them together; these are guesses. */
export const PHASE = {
  /** Battlefield departures wait for the stack's acts to land, but never longer than this after them. */
  afterStackMax: 450,
} as const;

/** Reduced motion: every duration shortened to this share, never longer than `max`; no stagger. (A guess.) */
const REDUCED = { share: 0.4, max: 200 } as const;

/** A flight in flight longer than this settles: its pile counts it (theme `flightLimit`). */
export const FLIGHT_LIMIT = themeMotion.flightLimit;

/** A flight between zones past this share of its way finishes before it takes a newer target. */
export const COMMITTED = 1 / 3;

// ---- eases -----------------------------------------------------------------------------------------------------------

export type EaseName = "linear" | "cubic" | "sine" | "out2" | "out3" | "spell" | "early";

/** h.js `ease`: cubic in-out. */
export const cubic = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
/** h.js `layout`: the sine, gentler at its fastest than the cubic, so a big move glides. */
export const sine = (k: number): number => 0.5 - 0.5 * Math.cos(Math.PI * k);
const outPow =
  (p: number) =>
  (k: number): number =>
    1 - Math.pow(1 - k, p);
/** h.js `smooth`: smoothstep of x between a and b. */
export function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
export const clamp01 = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** h.js `angLerp`: the short way round. */
export function angLerp(a: number, b: number, k: number): number {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * k;
}

export function easeOf(name: EaseName): (k: number) => number {
  switch (name) {
    case "linear":
      return (k) => k;
    case "cubic":
      return cubic;
    case "sine":
      return sine;
    case "out2":
      return outPow(PATH.permanentOut);
    case "out3":
      return outPow(PATH.spellOut);
    case "spell":
      return outPow(2);
    case "early":
      // h.js stack shift: `smooth(0, 0.5, k)`: in its new place in the first half of the newcomer's flight.
      return (k) => smooth(0, 0.5, k);
  }
}

// ---- vectors and curves ------------------------------------------------------------------------------------------------

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scaled = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const lerpV = (a: V3, b: V3, k: number): V3 => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) });
export const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A quadratic Bézier from a through c to b. */
export function quad(a: V3, c: V3, b: V3, k: number): V3 {
  const u = 1 - k;
  return { x: u * u * a.x + 2 * u * k * c.x + k * k * b.x, y: u * u * a.y + 2 * u * k * c.y + k * k * b.y, z: u * u * a.z + 2 * u * k * c.z + k * k * b.z };
}

/** A cubic Bézier (SeatFX.bezier). */
export function cubicBezier(a: V3, b: V3, c: V3, d: V3, k: number): V3 {
  const u = 1 - k,
    w0 = u * u * u,
    w1 = 3 * u * u * k,
    w2 = 3 * u * k * k,
    w3 = k * k * k;
  return { x: w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x, y: w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y, z: w0 * a.z + w1 * b.z + w2 * c.z + w3 * d.z };
}

/**
 * h.js `fightPath`: first straight across its own page's depth, then along the open middle, on one smooth curve. `out`
 * goes from the page to the middle. (The stack's fly-in uses it for an opponent's spell, so it never crosses another seat.)
 */
export function fightPath(from: V3, to: V3, out: boolean, near = 0): (k: number) => V3 {
  const page = out ? from : to,
    mid = out ? to : from;
  const c = v3(page.x, (from.y + to.y) / 2, mid.z + near);
  return (k) => quad(from, c, to, k);
}

/**
 * A critically damped spring toward `target` (closed form, so frame rate does not change it): the rule for a channel a
 * pointer steers. `omega` is its stiffness (rad/s); returns the value and velocity after `dt` ms.
 */
export function spring(x0: number, v0: number, target: number, omega: number, dt: number): { x: number; v: number } {
  const t = Math.max(0, dt) / 1000,
    d = x0 - target,
    c = v0 + omega * d,
    e = Math.exp(-omega * t);
  return { x: target + (d + c * t) * e, v: (c - omega * (d + c * t)) * e };
}

// ---- pace ------------------------------------------------------------------------------------------------------------

/** How a change set is played: normally, compressed (backlog) or under reduced motion. */
export interface Pace {
  readonly compressed: boolean;
  readonly reduced: boolean;
}
export const NORMAL: Pace = { compressed: false, reduced: false };

/** A duration under a pace. */
export function paced(ms: number, pace: Pace): number {
  let d = ms;
  if (pace.compressed) d *= BACKLOG.compress;
  if (pace.reduced) d = Math.min(d * REDUCED.share, REDUCED.max);
  return Math.round(d);
}

/** A stagger step under a pace: none compressed or reduced. */
export function staggered(ms: number, pace: Pace): number {
  return pace.compressed || pace.reduced ? 0 : ms;
}
