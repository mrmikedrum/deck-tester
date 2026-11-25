// The hand's physics and gestures (live.js `heldDown`/`heldMove`/`heldUp`, `spring`, `renderHeld`): the chrome's only
// state that outlives a view. Gestures arrive between commits and change where things are going; `step` moves them
// there at the commit's time and says what to draw. Nothing here reads a clock or schedules anything.
//
//   tap the open card      -> a `tap` act on it (play opens its plays or the inspector)
//   tap another card       -> turn the fan to it
//   drag sideways          -> the fan gives a little, then turns one card (once per drag, however far); a flick turns one
//   drag up (play mode)    -> the card follows the finger, lifted; let go -> a `release` act with how far it rose and
//                             where it was (play's 90 px rule decides); the card is held there until the next commit
//                             says it is carried (sent, or offered), else it eases back into the fan
//   hold                   -> peek at the whole card until it lifts
//   mouse hover / wheel    -> open the card under the pointer / turn one card per sideways burst
//   cancel (second finger, pointercancel, lost capture) -> nothing is sent; a lifted card eases back
import type { Gesture } from "../../input";
import type { CardId } from "../../protocol";
import { HAND_PLAY_DY } from "../../play";
import type { CommitId, Ms, ScreenPose } from "../../play";
import { CARD_ASPECT, cardSize, fan, labelFit } from "../fan";
import type { FanPose, LabelFit } from "../fan";
import type { HandView } from "../view";
import { clamp01, easeOut, lerp } from "./ease";
import { SPRING_FRAME_MS, stepSpring } from "./spring";

/** A card let go in play mode is drawn this much larger, above everything (live.js: `scale(1.06)`, z-index 200). */
export const PLAY_SCALE = 1.06;
const PLAY_Z = 200;
/** A sideways drag turns one card once it passes this: 30 u + 10 px. */
const TURN_U = 30;
const TURN_PX = 10;
/** Before that the fan gives: at most this much of a card, at a card-and-a-half's drag per card. */
const GIVE = 0.2;
const GIVE_SPAN = 1.5;
/** A turn made by dragging starts the spring with this velocity (cards per frame), against the drag. */
const TURN_KICK = 0.04;
/** The fan settles into a new arrangement over this long (live.js `MOVE`), on CSS ease-out. */
export const SETTLE_MS = 520;
/** Wheel: a sideways burst turns one card; a burst ends after this quiet (ms), and a nudge under this many px is noise. */
const WHEEL_BURST_MS = 280;
const WHEEL_MIN = 4;
/** An opened card shows its rules (on the stand-in face, where its printed image has not loaded) when its strip is at
 * least this share of a card wide. */
const READING_SHARE = 0.8;
/** The peek: the printed card about life size on an 11-inch iPad (at least 260 px, 300 design px wide), centred over
 * the press and this far above it, kept this far from the edges. */
export const PEEK = { w: 260, wu: 300, above: 38, margin: 10 } as const;
/** The peek's width at a design unit. */
export const peekWidth = (u: number): number => Math.max(PEEK.w, PEEK.wu * u);

/** Where a card is drawn, relative to the fan's origin (its element pivots on its bottom middle). */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly scale: number;
}

/** The fan's place on screen for this commit. */
export interface HandLayout {
  readonly u: number;
  /** The fan's origin on screen: the middle of its bottom edge (CSS px). */
  readonly ox: number;
  readonly oy: number;
  readonly vw: number;
  readonly vh: number;
  /** A word's width in the label font. */
  readonly measure: (word: string) => number;
}

export interface CardDraw extends Pose {
  readonly id: CardId;
  readonly z: number;
  readonly label: number;
  /** How its name fits that strip. */
  readonly fit: LabelFit;
  readonly reading: boolean;
  readonly dragging: boolean;
  /** Let go here, it would be offered to play: a card play may play now, dragged up past the play line, over the table. */
  readonly ready: boolean;
}

export interface HandFrame {
  /** The fan, in hand order. */
  readonly cards: readonly CardDraw[];
  /** Released cards held where they were let go (screen poses). */
  readonly loose: readonly { readonly id: CardId; readonly pose: ScreenPose }[];
  readonly peek: { readonly id: CardId; readonly left: number; readonly top: number; readonly width: number } | null;
  /** The card the focus is on (the open card). */
  readonly focus: CardId | null;
  /** Anything moving: keep the frames coming. */
  readonly active: boolean;
}

/** What the hand's gestures send (the renderer stamps them with the stop and commit the gesture started under). */
export interface HandActs {
  tap(card: CardId, at: Ms): void;
  /** `x`, `y`: where the pointer let go (the renderer tells whether that is over the table). */
  release(card: CardId, dy: number, pose: ScreenPose, at: Ms, x: number, y: number): void;
}

interface Drag {
  readonly card: CardId;
  readonly mode: "play" | "page";
  readonly f0: number;
  dx: number;
  dy: number;
  /** Where the pointer is now. */
  x: number;
  y: number;
  turned: boolean;
}

interface Held {
  readonly pose: ScreenPose;
  readonly layout: HandLayout;
  readonly rel: Pose;
}

/** The fan's place is the same (its origin and unit). */
const sameLayout = (a: HandLayout, b: HandLayout): boolean => a.u === b.u && a.ox === b.ox && a.oy === b.oy;

/** Two screen poses are the same. */
export const sameScreen = (a: ScreenPose, b: ScreenPose): boolean =>
  a === b ||
  (a.rotation === b.rotation && a.scale === b.scale && a.rect.left === b.rect.left && a.rect.top === b.rect.top && a.rect.right === b.rect.right && a.rect.bottom === b.rect.bottom);

const samePose = (a: Pose, b: Pose): boolean => a.x === b.x && a.y === b.y && a.rot === b.rot && a.scale === b.scale;

/** A fan-relative pose as a screen pose: the unrotated visual box, rotation (degrees) about its bottom middle. */
export function toScreen(p: Pose, l: HandLayout): ScreenPose {
  const { w, h } = cardSize(l.u);
  const cx = l.ox + p.x, bottom = l.oy + p.y;
  return {
    rect: { left: cx - (w * p.scale) / 2, right: cx + (w * p.scale) / 2, top: bottom - h * p.scale, bottom },
    rotation: p.rot,
    scale: p.scale,
  };
}

export function fromScreen(s: ScreenPose, l: HandLayout): Pose {
  const { w } = cardSize(l.u);
  return {
    x: (s.rect.left + s.rect.right) / 2 - l.ox,
    y: s.rect.bottom - l.oy,
    rot: s.rotation,
    scale: w > 0 ? (s.rect.right - s.rect.left) / w : 1,
  };
}

export class HandMotion {
  private ids: readonly CardId[] = [];
  private focus: CardId | null = null;
  private f = 0;
  private vel = 0;
  private to = 0;
  private springing = false;
  /** The spring was started at rest: its first commit steps one frame (the old spring's first tick). */
  private fresh = false;
  private thumbing = false;
  private drag: Drag | null = null;
  private peek: { id: CardId; x: number; y: number } | null = null;
  private released: { id: CardId; pose: Pose; commit: CommitId } | null = null;
  private settling = new Map<CardId, { from: Pose; since: Ms | null }>();
  private shown = new Map<CardId, Pose>();
  private loosePoses = new Map<CardId, Pose>();
  /** Carried cards, anchored to the fan they were let go from. */
  private held = new Map<CardId, Held>();
  private poses: readonly FanPose[] = [];
  private layout: HandLayout | null = null;
  private lastNow: Ms | null = null;
  private lastCommit: CommitId = -1;
  private lastWheel = -Infinity;

  constructor(
    private readonly acts: HandActs,
    private readonly wake: () => void,
    /** Whether a card let go at (x, y) is over the table: the same test its release is sent with. */
    private readonly overTable: (x: number, y: number) => boolean,
  ) {}

  /** Forget all motion (after a renderer fault, the next commit is a cut). */
  cut(): void {
    this.drag = null;
    this.peek = null;
    this.released = null;
    this.settling.clear();
    this.shown.clear();
    this.loosePoses.clear();
    this.held.clear();
    this.springing = false;
    this.vel = 0;
    this.f = this.to;
  }

  private turnTo(i: number): void {
    if (!this.ids.length) return;
    const k = Math.max(0, Math.min(this.ids.length - 1, i));
    this.thumbing = true;
    this.focus = this.ids[k] ?? null;
    this.to = k;
    if (!this.springing) this.fresh = true;
    this.springing = true;
    this.wake();
  }

  private index(card: CardId | null): number {
    return card === null ? -1 : this.ids.indexOf(card);
  }

  gesture(g: Gesture<CardId>): void {
    switch (g.g) {
      case "tap": {
        const i = this.index(g.on);
        if (i < 0 || g.on === null) return;
        if (g.on === this.focus) this.acts.tap(g.on, g.at);
        else this.turnTo(i);
        return;
      }
      case "hold":
        if (this.index(g.on) >= 0 && g.on !== null) this.peek = { id: g.on, x: g.x, y: g.y };
        this.wake();
        return;
      case "holdEnd":
        this.peek = null;
        this.wake();
        return;
      case "dragStart":
        this.peek = null;
        if (this.index(g.on) < 0 || g.on === null) return;
        this.drag = { card: g.on, mode: g.dir === "up" ? "play" : "page", f0: Math.round(this.to), dx: 0, dy: 0, x: g.x, y: g.y, turned: false };
        this.wake();
        return;
      case "drag": {
        const d = this.drag;
        if (!d) return;
        d.dx = g.dx;
        d.dy = g.dy;
        d.x = g.x;
        d.y = g.y;
        if (d.mode === "page" && !d.turned && this.layout) {
          const u = this.layout.u, w = cardSize(u).w;
          if (Math.abs(g.dx) > TURN_U * u + TURN_PX) {
            d.turned = true;
            this.vel = g.dx > 0 ? -TURN_KICK : TURN_KICK;
            this.turnTo(d.f0 + (g.dx > 0 ? -1 : 1));
          } else {
            this.springing = false;
            this.f = d.f0 - Math.max(-GIVE, Math.min(GIVE, g.dx / (w * GIVE_SPAN)));
          }
        }
        this.wake();
        return;
      }
      case "drop": {
        const d = this.drag;
        this.drag = null;
        if (!d) return;
        if (d.mode === "play") {
          const pose = this.liftedPose(d);
          if (pose && this.layout) {
            this.released = { id: d.card, pose, commit: this.lastCommit };
            this.acts.release(d.card, g.dy, toScreen(pose, this.layout), g.at, g.x, g.y);
          }
        } else if (!d.turned) {
          const flick = g.swipe === "left" ? 1 : g.swipe === "right" ? -1 : 0;
          this.turnTo(d.f0 + flick);
        }
        this.wake();
        return;
      }
      case "cancel": {
        const d = this.drag;
        this.drag = null;
        this.peek = null;
        if (d?.mode === "play") {
          const from = this.shown.get(d.card);
          if (from) this.settling.set(d.card, { from, since: null });
        } else if (d && !d.turned) this.turnTo(d.f0);
        this.wake();
        return;
      }
      case "hover": {
        const i = this.index(g.on);
        if (this.drag || i < 0 || i === Math.round(this.to)) return;
        this.turnTo(i);
        return;
      }
      case "wheel": {
        if (Math.abs(g.dx) <= Math.abs(g.dy)) return;
        const burst = g.at - this.lastWheel > WHEEL_BURST_MS;
        this.lastWheel = g.at;
        if (burst && Math.abs(g.dx) > WHEEL_MIN) this.turnTo(Math.round(this.to) + (g.dx > 0 ? 1 : -1));
        return;
      }
    }
  }

  /** Keyboard on a focused card: Enter or Space taps it, the arrows turn the fan. Returns whether it was used. */
  key(card: CardId, key: string, at: Ms): boolean {
    if (key === "Enter" || key === " ") {
      this.acts.tap(card, at);
      return true;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      this.turnTo(Math.round(this.to) + (key === "ArrowRight" ? 1 : -1));
      return true;
    }
    return false;
  }

  /** The card in play mode, lifted and following the finger. */
  private liftedPose(d: Drag): Pose | null {
    const q = this.poses[this.index(d.card)];
    return q ? { x: q.x + d.dx, y: q.y + d.dy, rot: 0, scale: PLAY_SCALE } : null;
  }

  step(view: HandView, layout: HandLayout, commit: CommitId, now: Ms): HandFrame {
    this.layout = layout;
    // A release resolves on the first commit after it: carried (sent or offered) or back into the fan.
    const carried = new Set(view.carried.map((c) => c.card));
    const r = this.released;
    if (r && commit > r.commit) {
      this.released = null;
      if (!carried.has(r.id)) this.settling.set(r.id, { from: r.pose, since: now });
    }
    const away = (id: CardId): boolean => carried.has(id) || this.released?.id === id;
    const ids = view.cards.map((c) => c.id).filter((id) => !away(id));
    if (ids.length !== this.ids.length || ids.some((id, i) => id !== this.ids[i])) this.regroup(ids, now);

    if (this.springing) {
      const frames = this.fresh || this.lastNow === null ? 1 : (now - this.lastNow) / SPRING_FRAME_MS;
      const s = stepSpring({ at: this.f, vel: this.vel, to: this.to }, frames);
      this.f = s.spring.at;
      this.vel = s.spring.vel;
      this.springing = !s.rest;
      this.fresh = false;
    }
    const byId = new Map(view.cards.map((c) => [c.id, c]));
    const cards = ids.map((id) => byId.get(id)).filter((c) => c !== undefined);
    this.poses = fan({
      names: cards.map((c) => c.name),
      playable: cards.map((c) => c.playable),
      f: this.f,
      vel: this.vel,
      thumbing: this.thumbing,
      respond: view.respond,
      u: layout.u,
    });
    const w = cardSize(layout.u).w;
    const draws: CardDraw[] = cards.map((c, i) => {
      const q = this.poses[i] ?? { x: 0, y: 0, rot: 0, z: 0, label: w };
      const d = this.drag;
      if (d && d.card === c.id && d.mode === "play") {
        const pose = this.liftedPose(d) ?? { x: q.x, y: q.y, rot: 0, scale: PLAY_SCALE };
        this.shown.set(c.id, pose);
        // The gilt rim promises only what the release will do (play's `release`): a card it may play, past the line, over the table.
        const ready = c.playable && d.dy <= HAND_PLAY_DY && this.overTable(d.x, d.y);
        return { id: c.id, ...pose, z: PLAY_Z, label: w, fit: labelFit(c.name, w, layout.u, layout.measure), reading: false, dragging: true, ready };
      }
      const target: Pose = { x: q.x, y: q.y, rot: q.rot, scale: 1 };
      const pose = this.settled(c.id, target, now);
      this.shown.set(c.id, pose);
      const fit = labelFit(c.name, q.label, layout.u, layout.measure);
      return { id: c.id, ...pose, z: q.z, label: q.label, fit, reading: q.label >= w * READING_SHARE && c.rules !== null, dragging: false, ready: false };
    });
    for (const id of [...this.shown.keys()]) if (!ids.includes(id)) this.shown.delete(id);
    // Only a card in the fan eases (drawing it is what ends its settling): one that left the hand stops here.
    for (const id of [...this.settling.keys()]) if (!ids.includes(id)) this.settling.delete(id);

    // A held card keeps its place relative to the fan: a layout change (a resize, a rotation) re-anchors it to the
    // hand's new place; on the layout it was let go under, it is exactly where it was let go.
    const loose = view.carried.map((c) => {
      const h = this.anchor(c.card, c.pose, layout);
      this.loosePoses.set(c.card, h.rel);
      return { id: c.card, pose: sameLayout(h.layout, layout) ? c.pose : toScreen(h.rel, layout) };
    });
    for (const id of [...this.held.keys()]) if (!carried.has(id)) this.held.delete(id);
    const rel = this.released;
    if (rel) loose.push({ id: rel.id, pose: toScreen(rel.pose, layout) });
    for (const id of [...this.loosePoses.keys()]) if (!byId.has(id)) this.loosePoses.delete(id);

    const pk = this.peek && ids.includes(this.peek.id) ? this.peek : null;
    this.peek = pk;
    const pw = peekWidth(layout.u), ph = pw * CARD_ASPECT;
    const peek = pk
      ? {
          id: pk.id,
          left: Math.max(PEEK.margin, Math.min(layout.vw - pw - PEEK.margin, pk.x - pw / 2)),
          top: Math.max(PEEK.margin, pk.y - ph - PEEK.above),
          width: pw,
        }
      : null;
    this.lastNow = now;
    this.lastCommit = commit;
    return {
      cards: draws,
      loose,
      peek,
      focus: this.focus,
      active: this.springing || this.settling.size > 0 || this.drag !== null || this.released !== null,
    };
  }

  /** The fan's members changed: keep the focus (or move it to a new arrival), and ease every card to its new place. */
  private regroup(ids: readonly CardId[], now: Ms): void {
    const prev = this.ids;
    // A card coming back from where it was let go is not an arrival: the focus stays where it was.
    const arrivals = prev.length ? ids.filter((id) => !prev.includes(id) && !this.loosePoses.has(id)) : [];
    if (arrivals.length) this.thumbing = false;
    if (this.drag && !ids.includes(this.drag.card)) this.drag = null;
    let i = this.focus === null ? -1 : ids.indexOf(this.focus);
    const first = arrivals[0];
    if (first !== undefined && (this.focus === null || !arrivals.includes(this.focus))) i = ids.indexOf(first);
    if (i < 0) i = this.focus === null ? ids.length - 1 : Math.min(ids.length - 1, Math.round(this.to));
    i = Math.max(0, i);
    this.focus = ids[i] ?? null;
    this.f = this.to = i;
    this.vel = 0;
    this.springing = false;
    for (const id of ids) {
      const from = this.shown.get(id) ?? this.loosePoses.get(id);
      if (from) this.settling.set(id, { from, since: now });
      this.loosePoses.delete(id);
    }
    this.ids = ids;
  }

  /** A carried card's pose relative to the fan, fixed under the layout it was first carried in (a new pose re-anchors). */
  private anchor(id: CardId, pose: ScreenPose, layout: HandLayout): Held {
    const h = this.held.get(id);
    if (h && sameScreen(h.pose, pose)) return h;
    const next: Held = { pose, layout, rel: fromScreen(pose, layout) };
    this.held.set(id, next);
    return next;
  }

  private settled(id: CardId, target: Pose, now: Ms): Pose {
    const s = this.settling.get(id);
    if (!s) return target;
    const since = s.since ?? now;
    if (s.since === null) this.settling.set(id, { from: s.from, since });
    const k = easeOut(clamp01((now - since) / SETTLE_MS));
    if (k >= 1 || samePose(s.from, target)) {
      this.settling.delete(id);
      return target;
    }
    return {
      x: lerp(s.from.x, target.x, k),
      y: lerp(s.from.y, target.y, k),
      rot: lerp(s.from.rot, target.rot, k),
      scale: lerp(s.from.scale, target.scale, k),
    };
  }
}
