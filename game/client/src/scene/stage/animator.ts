// The animator: each actor moves its channels (position, yaw, tilt, scale, fade, lift, tap, glow, alpha) toward its
// target by a rule chosen from the cause: eases with known durations for bounded moves, a critically damped spring for
// the lift a pointer steers, paths for flights. Its only time is the `now` it is stepped to. Pure: no three.js.
import type { V3 } from "../../layout";
import {
  COMMITTED,
  PATH,
  angLerp,
  clamp01,
  cubic,
  cubicBezier,
  easeOf,
  fightPath,
  lerp,
  lerpV,
  quad,
  smooth,
  spring,
} from "./motion";
import type { EaseName } from "./motion";
import type { Look, Pose, Sample } from "./types";

/** How a leg moves between its two samples. */
export type PathSpec =
  /** Everything on one ease: reflow, focus, a mark's glow. */
  | { readonly k: "ease"; readonly ease: EaseName }
  /** h.js flights: lift off, then fly (an arc over the row), lying down and taking the pile's size by `settle`. */
  | {
      readonly k: "flight";
      readonly lift: number;
      readonly rise: number;
      readonly arc: number;
      readonly ease: EaseName;
      readonly settle: number;
      readonly shrinkFrom: number;
    }
  /** h.js `buildStack` fly-in: straight with an arc (mine), along the middle (theirs), or up from under (onto others). */
  | { readonly k: "cast"; readonly via: "line" | "middle" | "under"; readonly arc: number; readonly up: V3 }
  /** h.js joins: over the open table in front of the pile, from 0.8 of its size. */
  | { readonly k: "join"; readonly via: V3 }
  /** A token ceasing to exist burns out where it stood, rising a little. */
  | { readonly k: "burn"; readonly wait: number; readonly rise: number }
  /** An ability draws in where it stood. */
  | { readonly k: "fizzle" }
  /** A fold flies into its pile, hopping over the row when it passes a neighbour. */
  | { readonly k: "hop"; readonly hop: number; readonly up: V3 }
  /**
   * A fighter stepping out to the combat row or home from it (h.js `fightPath`): across its own page's depth, then along
   * the open middle, hopping over what it passes; it sets off `wait` (a share of the leg) late, so fighters from one seat
   * go one after another.
   */
  | { readonly k: "fight"; readonly out: boolean; readonly hop: number; readonly up: V3; readonly wait: number };

export interface Leg {
  readonly t0: number;
  readonly dur: number;
  readonly path: PathSpec;
  /** Where it is going; resolved every frame, so a destination that moves is followed. */
  readonly to: () => Sample;
  /** A flight between zones: past a third of its way it finishes before a newer target. */
  readonly commit: boolean;
  /** Captured when it begins. */
  from: Sample | null;
}

const lerpLook = (a: Look, b: Look, k: number): Look => ({
  fade: lerp(a.fade, b.fade, k),
  lift: lerp(a.lift, b.lift, k),
  tap: lerp(a.tap, b.tap, k),
  glow: lerp(a.glow, b.glow, k),
  alpha: lerp(a.alpha, b.alpha, k),
  w: lerp(a.w, b.w, k),
  d: lerp(a.d, b.d, k),
});

const withPose = (s: Sample, p: Pose, look?: Look): Sample => ({ ...(look ?? s), pos: p.pos, rx: p.rx, ry: p.ry, s: p.s });

/** A leg's sample at progress k (0..1). Pure. */
export function sampleLeg(path: PathSpec, a: Sample, b: Sample, k: number, dur: number): Sample {
  const kk = clamp01(k);
  switch (path.k) {
    case "ease": {
      const e = easeOf(path.ease)(kk);
      return withPose(a, { pos: lerpV(a.pos, b.pos, e), rx: angLerp(a.rx, b.rx, e), ry: angLerp(a.ry, b.ry, e), s: lerp(a.s, b.s, e) }, lerpLook(a, b, e));
    }
    case "flight": {
      const t = kk * dur,
        up = { x: a.pos.x, y: a.pos.y + path.rise, z: a.pos.z };
      if (t < path.lift) return withPose(a, { pos: lerpV(a.pos, up, t / Math.max(1, path.lift)), rx: a.rx, ry: a.ry, s: a.s });
      const r = (t - path.lift) / Math.max(1, dur - path.lift),
        q = easeOf(path.ease)(r);
      const pos = lerpV(up, b.pos, q);
      const rot = Math.min(1, q / path.settle);
      return withPose(
        a,
        { pos: { ...pos, y: pos.y + Math.sin(q * Math.PI) * path.arc }, rx: angLerp(a.rx, b.rx, rot), ry: angLerp(a.ry, b.ry, rot), s: lerp(a.s, b.s, smooth(path.shrinkFrom, path.settle, q)) },
        lerpLook(a, b, q),
      );
    }
    case "cast": {
      let pos: V3;
      if (path.via === "middle") {
        const p = fightPath(a.pos, b.pos, true)(kk);
        pos = { ...p, y: p.y + Math.sin(kk * Math.PI) * path.arc };
      } else if (path.via === "under") {
        // Across at the hand's height first, then straight up into its place from under it.
        const c1 = { x: b.pos.x, y: a.pos.y, z: a.pos.z };
        const c2 = { x: b.pos.x - path.up.x * PATH.castUnder * b.s, y: b.pos.y - path.up.y * PATH.castUnder * b.s, z: b.pos.z - path.up.z * PATH.castUnder * b.s };
        pos = cubicBezier(a.pos, c1, c2, b.pos, kk);
      } else {
        const p = lerpV(a.pos, b.pos, kk);
        pos = { ...p, y: p.y + Math.sin(kk * Math.PI) * path.arc };
      }
      return withPose(a, { pos, rx: angLerp(a.rx, b.rx, kk), ry: angLerp(a.ry, b.ry, kk), s: lerp(a.s, b.s, smooth(0, 1, kk)) }, lerpLook(a, b, kk));
    }
    case "join": {
      const qe = cubic(kk);
      return withPose(a, { pos: quad(a.pos, path.via, b.pos, qe), rx: angLerp(a.rx, b.rx, qe), ry: angLerp(a.ry, b.ry, qe), s: lerp(b.s * PATH.joinFrom, b.s, qe) }, lerpLook(a, b, qe));
    }
    case "burn": {
      const t = kk * dur;
      if (t < path.wait) return a;
      const q = (t - path.wait) / Math.max(1, dur - path.wait);
      return withPose(a, { pos: { ...a.pos, y: a.pos.y + Math.sqrt(q) * path.rise }, rx: a.rx, ry: a.ry, s: a.s * (1 - q * q) });
    }
    case "fizzle":
      return withPose(a, { pos: a.pos, rx: a.rx, ry: a.ry, s: a.s * Math.pow(1 - kk, 2) });
    case "fight": {
      const e = cubic(clamp01((kk - path.wait) / Math.max(1e-6, 1 - path.wait)));
      const p = fightPath(a.pos, b.pos, path.out)(e), h = Math.sin(Math.PI * e) * path.hop;
      return withPose(a, { pos: { x: p.x + path.up.x * h, y: p.y + path.up.y * h, z: p.z + path.up.z * h }, rx: angLerp(a.rx, b.rx, e), ry: angLerp(a.ry, b.ry, e), s: lerp(a.s, b.s, e) }, lerpLook(a, b, e));
    }
    case "hop": {
      const e = cubic(kk),
        h = Math.min(1, 2.2 * Math.sin(Math.PI * kk)) * path.hop;
      const p = lerpV(a.pos, b.pos, e);
      return withPose(a, { pos: { x: p.x + path.up.x * h, y: p.y + path.up.y * h, z: p.z + path.up.z * h }, rx: angLerp(a.rx, b.rx, e), ry: angLerp(a.ry, b.ry, e), s: lerp(a.s, b.s, e) }, lerpLook(a, b, e));
    }
  }
}

/** Equal enough that a new leg would be a stutter (h.js `layoutSig`: two decimals). */
export function sameSample(a: Sample, b: Sample): boolean {
  const near = (x: number, y: number, eps = 0.005) => Math.abs(x - y) < eps;
  return (
    near(a.pos.x, b.pos.x) &&
    near(a.pos.y, b.pos.y) &&
    near(a.pos.z, b.pos.z) &&
    near(a.rx, b.rx) &&
    near(a.ry, b.ry) &&
    near(a.s, b.s) &&
    near(a.fade, b.fade) &&
    near(a.tap, b.tap) &&
    near(a.glow, b.glow) &&
    near(a.alpha, b.alpha) &&
    near(a.w, b.w) &&
    near(a.d, b.d)
  );
}

/** The lift spring's stiffness, rad/s: settles in about 150 ms (a guess; nothing in the old client was pointer-steered). */
const LIFT_OMEGA = 28;
const LIFT_EPS = 0.0005;

/**
 * One actor's motion. Legs run one after another; a leg that `replaces` cuts the one before it short at its start, so a
 * reflow or focus move retargets at once from where the piece is. The lift channel is a spring toward the target's lift.
 */
export class Actor {
  private legs: (Leg & { replaces: boolean })[] = [];
  private last: Sample;
  private liftV = 0;
  private lift: number;
  private at: number;

  constructor(start: Sample, now: number) {
    this.last = start;
    this.lift = start.lift;
    this.at = now;
  }

  /** Where it ends up: the last leg's destination, or where it is. */
  target(): Sample {
    const leg = this.legs[this.legs.length - 1];
    return leg ? leg.to() : this.last;
  }

  /** The sample at the last step. */
  get now(): Sample {
    return this.last;
  }

  /** The running leg's progress, or null. */
  progress(now: number): { commit: boolean; k: number; end: number } | null {
    const leg = this.legs[0];
    if (!leg || leg.from === null) return null;
    return { commit: leg.commit, k: clamp01((now - leg.t0) / Math.max(1, leg.dur)), end: leg.t0 + leg.dur };
  }

  /** Moving, or a leg waiting, or the lift still settling. */
  moving(): boolean {
    return this.legs.length > 0 || Math.abs(this.liftV) > LIFT_EPS || Math.abs(this.lift - this.liftTarget()) > LIFT_EPS;
  }

  private liftTarget(): number {
    return this.target().lift;
  }

  /**
   * Move toward `to` from `t0` over `dur`. `replace`: cut what runs short at t0 (and drop anything queued). `after`: let
   * the running leg finish first (a committed flight), then go on.
   */
  go(leg: Omit<Leg, "from">, mode: "replace" | "after"): void {
    if (mode === "replace") this.legs = this.legs.filter((l, i) => i === 0 && l.from !== null && l.t0 < leg.t0);
    const prev = this.legs[this.legs.length - 1];
    const t0 = mode === "after" && prev ? Math.max(leg.t0, prev.t0 + prev.dur) : leg.t0;
    this.legs.push({ ...leg, t0, from: null, replaces: mode === "replace" });
  }

  /** At `to` at once (a cut). */
  snap(to: Sample): void {
    this.legs = [];
    this.last = to;
    this.lift = to.lift;
    this.liftV = 0;
  }

  /** Whether the running leg is a committed flight past a third of its way. */
  committed(now: number): boolean {
    const p = this.progress(now);
    return !!p && p.commit && p.k > COMMITTED;
  }

  step(now: number): Sample {
    const t = Math.max(now, this.at);
    const dt = t - this.at;
    this.at = t;
    for (;;) {
      const cur = this.legs[0];
      if (!cur) break;
      const next = this.legs[1];
      if (next && next.replaces && next.t0 <= t) {
        if (cur.from) this.last = sampleLeg(cur.path, cur.from, cur.to(), (next.t0 - cur.t0) / Math.max(1, cur.dur), cur.dur);
        this.legs.shift();
        continue;
      }
      if (cur.from === null) {
        if (t < cur.t0) break;
        cur.from = this.last;
      }
      const k = cur.dur > 0 ? (t - cur.t0) / cur.dur : 1;
      if (k >= 1) {
        this.last = { ...cur.to(), lift: this.last.lift };
        this.legs.shift();
        continue;
      }
      this.last = sampleLeg(cur.path, cur.from, cur.to(), k, cur.dur);
      break;
    }
    // The lift is a spring toward the target's, whatever the legs did with it.
    const sp = spring(this.lift, this.liftV, this.liftTarget(), LIFT_OMEGA, dt);
    this.lift = sp.x;
    this.liftV = sp.v;
    if (Math.abs(this.lift - this.liftTarget()) < LIFT_EPS && Math.abs(this.liftV) < LIFT_EPS) {
      this.lift = this.liftTarget();
      this.liftV = 0;
    }
    this.last = { ...this.last, lift: this.lift };
    return this.last;
  }
}
