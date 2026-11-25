// The path of a stack item's arc to what it aims at (old h.js `layout`, the stack's lanes): out from behind its own card
// to a crest over its target, then down onto the target's top edge, so the target itself hides where the arc ends and
// no neighbour's edge is traced. A plaque is struck on its top edge from above; a spell on the stack gets a short arch
// out of the top of the one that answers it. Pure: points in the world from the two pieces' samples as they are now.
import type { Projector, V3 } from "../../layout";
import { CH } from "../../layout/seat/geometry";
import { add, scaled, v3 } from "./motion";
import type { Sample } from "./types";

/** How many points an arc is drawn through. */
const AIM_POINTS = 48;

const sub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: V3): V3 => scaled(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
const lerp = (a: V3, b: V3, k: number): V3 => add(a, scaled(sub(b, a), k));
/** A cubic Bézier through four points (fx.js `bezier`). */
const bezier =
  (a: V3, b: V3, c: V3, d: V3) =>
  (k: number): V3 => {
    const u = 1 - k;
    return add(add(scaled(a, u * u * u), scaled(b, 3 * u * u * k)), add(scaled(c, 3 * u * k * k), scaled(d, k * k * k)));
  };
/** A card's up axis in the world from its pose (pitch only: the cards on the table never yaw). */
const upOf = (s: Sample): V3 => v3(0, Math.cos(s.rx), Math.sin(s.rx));
const lifted = (s: Sample): V3 => v3(s.pos.x, s.pos.y + s.lift, s.pos.z);

/**
 * The arc's points from a stack card at `from` to `to`, a card (`card`), a plaque (`plate`) or a spell on the stack
 * (`spell`). `up`: the stack is the table's focus (it stands high: the arc leaves from lower down its card).
 */
export function aimPath(proj: Projector, from: Sample, to: Sample, onto: "card" | "plate" | "spell", up: boolean): V3[] {
  const camUp = proj.up;
  const U = v3(0, Math.cos(proj.pitch), -Math.sin(proj.pitch)),
    N = v3(0, Math.sin(proj.pitch), Math.cos(proj.pitch));
  const sp = lifted(from),
    toMe = norm(sub(proj.eye, sp));
  let curve: (k: number) => V3;
  if (onto === "spell") {
    // A short arch up out of its own top and over, dropping onto the other's top edge and behind it.
    const top = (s: Sample, u: number): V3 => add(lifted(s), scaled(camUp, (CH / 2) * s.s * u));
    const a = add(top(from, 0.4), scaled(toMe, -0.05)),
      land = add(top(to, 0.75), scaled(toMe, -0.05)),
      rise = (up ? 0.25 : 0.55) * from.s;
    curve = bezier(a, add(top(from, 1), scaled(camUp, rise)), add(top(to, 1), scaled(camUp, rise)), land);
  } else {
    // From just behind its own card, which hides the start.
    const start = add(add(sp, scaled(toMe, -0.25)), scaled(camUp, up ? -0.42 * CH * from.s : 0));
    if (onto === "plate") {
      // Straight up the screen out from behind the spell to a crest level with a point over the plaque, across, and down
      // onto its top edge. (The plaque stands at its foot, 0.82 tall, leaning back by the camera's pitch.)
      const s = to.s,
        base = lifted(to),
        top = 0.82 * s;
      const at = (u: number, n: number): V3 => add(add(base, scaled(U, u)), scaled(N, n));
      const peak = at(top + 0.28, 0.05),
        end = at(top, -0.05),
        dir = norm(sub(U, scaled(toMe, dot(U, toMe))));
      const want = proj.project(at(top + 0.55, 0.05)).y;
      let lo = -12,
        hi = 12;
      for (let it = 0; it < 24; it++) {
        const mid = (lo + hi) / 2;
        if (proj.project(add(start, scaled(dir, mid))).y > want) lo = mid;
        else hi = mid;
      }
      const crest = add(start, scaled(dir, (lo + hi) / 2)),
        turn = lerp(crest, peak, 0.22);
      const climb = bezier(start, lerp(start, crest, 0.5), crest, turn),
        cross = bezier(turn, lerp(turn, peak, 0.4), add(peak, scaled(U, 0.25)), peak),
        fall = bezier(peak, add(peak, scaled(U, 0.1)), add(end, scaled(U, 0.3)), end);
      curve = (k) => (k < 0.4 ? climb(k / 0.4) : k < 0.75 ? cross((k - 0.4) / 0.35) : fall((k - 0.75) / 0.25));
    } else {
      // A card: up from the spell, in level from its side, then plumb down onto the middle of its top edge and on down
      // behind it, so it reads as dropped on this card and never as aimed at one it passes.
      const s = to.s,
        mid = lifted(to),
        ax = upOf(to);
      const topPt = add(mid, scaled(ax, 0.5 * CH * s)),
        standing = ax.y > 0.5;
      const sd = Math.sign(mid.x - sp.x) || 1;
      const crestUp = Math.max(0.6, 2.2 - CH * s),
        crest = add(add(topPt, scaled(U, crestUp)), scaled(N, -0.05 * s));
      const land = add(add(topPt, scaled(U, 0.02)), scaled(N, -0.05 * s));
      const end = standing ? add(add(mid, scaled(ax, 0.1 * CH * s)), scaled(N, -0.45 * s)) : land;
      const wide = v3(-sd * 0.9 * s, 0, 0);
      const climb = bezier(start, add(start, scaled(U, dot(sub(crest, start), U) * 0.75)), add(crest, scaled(wide, 0.7)), crest);
      const fall = bezier(crest, lerp(crest, land, 0.33), lerp(crest, land, 0.67), land);
      const tuck = bezier(land, lerp(land, end, 0.33), lerp(land, end, 0.67), end);
      curve = (k) => (k < 0.55 ? climb(k / 0.55) : k < 0.9 ? fall((k - 0.55) / 0.35) : tuck((k - 0.9) / 0.1));
    }
  }
  return Array.from({ length: AIM_POINTS + 1 }, (_, i) => curve(i / AIM_POINTS));
}
