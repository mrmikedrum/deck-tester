// The hand's gestures and physics (chrome/frame/hand.ts), stepped by commit times: what each gesture does to the fan,
// which acts it sends, and how a released card is held, carried or eased back.
import { beforeEach, describe, expect, it } from "vitest";
import { HandMotion, PLAY_SCALE, SETTLE_MS, toScreen } from "../../src/chrome/frame";
import type { HandFrame, HandLayout } from "../../src/chrome/frame";
import type { HandView } from "../../src/chrome";
import { HAND } from "../../src/chrome/workbench/samples";
import type { Gesture } from "../../src/input";
import type { ScreenPose } from "../../src/play";
import type { CardId } from "../../src/protocol";

const LAYOUT: HandLayout = { u: 1, ox: 235.5, oy: 812, vw: 1180, vh: 820, measure: (w) => w.length * 7 };
const ids = HAND.map((c) => c.id);
const id = (i: number): CardId => ids[i]!;
const hand = (more: Partial<HandView> = {}): HandView => ({ cards: HAND, away: false, respond: false, carried: [], fresh: [], ...more });

let acts: { a: string; card: CardId; dy?: number; pose?: ScreenPose; at: number }[];
let wakes: number;
let m: HandMotion;
let commit: number;
let t: number;

function step(view = hand(), ms = 16.7): HandFrame {
  t += ms;
  return m.step(view, LAYOUT, ++commit, t);
}
/** Steps until nothing moves (or gives up). */
function settle(view = hand()): HandFrame {
  let f = step(view);
  for (let i = 0; i < 400 && f.active; i++) f = step(view);
  return f;
}
const g = (gesture: Gesture<CardId>): void => m.gesture(gesture);
const tap = (card: CardId): void => g({ g: "tap", on: card, kind: "touch", x: 0, y: 0, at: t });
const dragUp = (card: CardId, dy: number, dx = 0): void => {
  g({ g: "dragStart", on: card, kind: "touch", x0: 0, y0: 0, x: dx, y: dy, dir: "up", at: t });
  g({ g: "drag", on: card, x: dx, y: dy, dx, dy, at: t });
};
const drop = (card: CardId, dy: number, dx = 0): void =>
  g({ g: "drop", on: card, x: dx, y: dy, dx, dy, vx: 0, vy: 0, swipe: null, at: t });

beforeEach(() => {
  acts = [];
  wakes = 0;
  commit = 0;
  t = 1000;
  m = new HandMotion(
    {
      tap: (card, at) => acts.push({ a: "tap", card, at }),
      release: (card, dy, pose, at) => acts.push({ a: "release", card, dy, pose, at }),
    },
    () => wakes++,
  );
  step();
});

describe("the fan at rest", () => {
  it("opens on the last card, nothing moving", () => {
    const f = step();
    expect(f.focus).toBe(id(6));
    expect(f.active).toBe(false);
    expect(f.cards.map((c) => c.id)).toEqual(ids);
  });
  it("an opened instant or sorcery shows its rules when its strip is wide enough", () => {
    const f = step();
    expect(f.cards.at(-1)).toMatchObject({ id: id(6), reading: true });
    expect(f.cards[0]).toMatchObject({ reading: false });
  });
});

describe("taps", () => {
  it("tapping the open card sends a tap act on it; nothing moves", () => {
    tap(id(6));
    expect(acts).toEqual([{ a: "tap", card: id(6), at: t }]);
  });
  it("tapping another card turns the fan to it, sends nothing, and the spring settles there", () => {
    tap(id(2));
    expect(acts).toEqual([]);
    expect(wakes).toBeGreaterThan(0);
    const moving = step();
    expect(moving.active).toBe(true);
    expect(moving.focus).toBe(id(2));
    expect(settle().active).toBe(false);
    tap(id(2));
    expect(acts.map((a) => a.a)).toEqual(["tap"]);
  });
});

describe("play mode", () => {
  it("a card dragged up follows the finger, lifted 1.06, upright, on top", () => {
    dragUp(id(3), -80, 6);
    const f = step();
    const c = f.cards.find((d) => d.id === id(3))!;
    expect(c).toMatchObject({ dragging: true, rot: 0, scale: PLAY_SCALE, z: 200 });
    expect(f.active).toBe(true);
  });
  it("letting go sends a release with how far it rose and where it was", () => {
    const rest = step().cards.find((d) => d.id === id(3))!;
    dragUp(id(3), -120, 10);
    step();
    drop(id(3), -120, 10);
    expect(acts).toHaveLength(1);
    const r = acts[0]!;
    expect(r).toMatchObject({ a: "release", card: id(3), dy: -120 });
    expect(r.pose).toEqual(toScreen({ x: rest.x + 10, y: rest.y - 120, rot: 0, scale: PLAY_SCALE }, LAYOUT));
    expect(r.pose!.rect.bottom).toBeCloseTo(LAYOUT.oy + rest.y - 120);
    expect(r.pose!.rect.right - r.pose!.rect.left).toBeCloseTo(150 * PLAY_SCALE);
  });
  it("a short lift is still a release: the 90 px rule is play's, not the chrome's", () => {
    dragUp(id(3), -40);
    drop(id(3), -40);
    expect(acts.map((a) => [a.a, a.dy])).toEqual([["release", -40]]);
  });
  it("released, the card is held where it was let go until the next commit says what became of it", () => {
    dragUp(id(3), -120);
    drop(id(3), -120);
    const pose = acts[0]!.pose!;
    // the commit that folds the release: it was carried (sent, or offered by a sheet)
    const carried = step(hand({ carried: [{ card: id(3), pose }] }));
    expect(carried.cards.map((c) => c.id)).not.toContain(id(3));
    expect(carried.loose).toEqual([{ id: id(3), pose }]);
  });
  it("a resize while held re-anchors the pose to the hand's new place, even once the card has left the hand", () => {
    dragUp(id(3), -120);
    drop(id(3), -120);
    const pose = acts[0]!.pose!;
    step(hand({ carried: [{ card: id(3), pose }] }));
    const moved: HandLayout = { ...LAYOUT, ox: LAYOUT.ox + 140, oy: LAYOUT.oy - 60, vw: 1320, vh: 760 };
    const rel = { x: (pose.rect.left + pose.rect.right) / 2 - LAYOUT.ox, y: pose.rect.bottom - LAYOUT.oy };
    const at = (f: HandFrame) => f.loose.find((l) => l.id === id(3))!.pose;
    const near = (p: ScreenPose, q: ScreenPose) => {
      expect(p.rotation).toBe(q.rotation);
      expect(p.scale).toBeCloseTo(q.scale, 9);
      for (const k of ["left", "top", "right", "bottom"] as const) expect(p.rect[k]).toBeCloseTo(q.rect[k], 9);
    };
    // Forge takes the card out of the hand while its targets are chosen: it is still held, at the hand's new place.
    const gone = HAND.filter((c) => c.id !== id(3));
    t += 16.7;
    const after = m.step(hand({ cards: gone, carried: [{ card: id(3), pose }] }), moved, ++commit, t);
    near(at(after), toScreen({ x: rel.x, y: rel.y, rot: pose.rotation, scale: pose.scale }, moved));
    // Back to the old layout: exactly the pose it was let go at.
    expect(at(step(hand({ cards: gone, carried: [{ card: id(3), pose }] })))).toEqual(pose);
  });
  it("not carried (no play, or under 90 px), it eases back into the fan over 520 ms", () => {
    dragUp(id(3), -120);
    drop(id(3), -120);
    const back = step();
    const c = back.cards.find((d) => d.id === id(3))!;
    expect(back.loose).toEqual([]);
    expect(c.y).toBeLessThan(-60); // still near where it was let go
    expect(back.active).toBe(true);
    const later = step(hand(), SETTLE_MS);
    expect(later.cards.find((d) => d.id === id(3))!.y).toBeGreaterThan(-1);
    expect(settle().active).toBe(false);
  });
  it("a released card that leaves the hand before the next commit leaves nothing moving behind it", () => {
    dragUp(id(3), -120);
    drop(id(3), -120);
    const gone = hand({ cards: HAND.filter((c) => c.id !== id(3)) });
    expect(settle(gone).active).toBe(false);
  });
  it("a cancelled lift whose card then leaves the hand leaves nothing moving behind it", () => {
    dragUp(id(3), -120);
    step();
    g({ g: "cancel", on: id(3), at: t });
    const gone = hand({ cards: HAND.filter((c) => c.id !== id(3)) });
    expect(settle(gone).active).toBe(false);
  });
  it("the focus stays where it was when a released card comes back", () => {
    tap(id(1));
    settle();
    dragUp(id(4), -120);
    drop(id(4), -120);
    expect(step().focus).toBe(id(1));
  });
  it("a cancelled drag (second finger, pointercancel) sends nothing and the card eases back", () => {
    dragUp(id(3), -150);
    step();
    g({ g: "cancel", on: id(3), at: t });
    expect(acts).toEqual([]);
    const f = step();
    expect(f.cards.find((d) => d.id === id(3))!.dragging).toBe(false);
    expect(f.active).toBe(true);
  });
  it("a card that leaves the hand mid-drag ends the drag; its drop sends nothing", () => {
    dragUp(id(3), -100);
    step(hand({ cards: HAND.filter((c) => c.id !== id(3)) }));
    drop(id(3), -100);
    expect(acts).toEqual([]);
  });
});

describe("paging", () => {
  const side = (card: CardId, dx: number): void => {
    g({ g: "dragStart", on: card, kind: "touch", x0: 0, y0: 0, x: dx, y: 0, dir: dx < 0 ? "left" : "right", at: t });
    g({ g: "drag", on: card, x: dx, y: 0, dx, dy: 0, at: t });
  };
  beforeEach(() => {
    tap(id(3));
    settle();
  });
  it("a sideways drag past 30 u + 10 px turns one card against it, once however far it goes", () => {
    side(id(3), -45);
    g({ g: "drag", on: id(3), x: -300, y: 0, dx: -300, dy: 0, at: t });
    g({ g: "drop", on: id(3), x: -300, y: 0, dx: -300, dy: 0, vx: -1, vy: 0, swipe: "left", at: t });
    expect(settle().focus).toBe(id(4));
    expect(acts).toEqual([]);
  });
  it("a short drag gives a little, then settles back", () => {
    side(id(3), 30);
    const giving = step();
    expect(giving.focus).toBe(id(3));
    g({ g: "drop", on: id(3), x: 30, y: 0, dx: 30, dy: 0, vx: 0, vy: 0, swipe: null, at: t });
    expect(settle().focus).toBe(id(3));
  });
  it("a short flick turns one", () => {
    side(id(3), 20);
    g({ g: "drop", on: id(3), x: 20, y: 0, dx: 20, dy: 0, vx: 0.5, vy: 0, swipe: "right", at: t });
    expect(settle().focus).toBe(id(2));
  });
});

describe("hold, hover and the wheel", () => {
  it("holding a card peeks at it about life size (300 design px wide), above the finger and inside the screen", () => {
    g({ g: "hold", on: id(2), kind: "touch", x: 60, y: 700, at: t });
    expect(step().peek).toEqual({ id: id(2), left: 10, top: 700 - (300 * 680) / 488 - 38, width: 300 });
    g({ g: "holdEnd", on: id(2), at: t });
    expect(step().peek).toBeNull();
  });
  it("a hovering mouse opens the card under it", () => {
    g({ g: "hover", on: id(1), x: 0, y: 0, at: t });
    expect(settle().focus).toBe(id(1));
  });
  it("a sideways wheel turns one card per burst", () => {
    tap(id(3));
    settle();
    const wheel = (dx: number, at: number): void => g({ g: "wheel", on: null, dx, dy: 0, x: 0, y: 0, at });
    wheel(40, 5000);
    wheel(40, 5100); // same burst
    expect(settle().focus).toBe(id(4));
    wheel(-40, 5500);
    expect(settle().focus).toBe(id(3));
    wheel(2, 6000); // too small
    wheel(0, 6400);
    expect(settle().focus).toBe(id(3));
  });
  it("keys: Enter taps, arrows turn", () => {
    expect(m.key(id(6), "Enter", t)).toBe(true);
    expect(acts).toEqual([{ a: "tap", card: id(6), at: t }]);
    expect(m.key(id(6), "ArrowLeft", t)).toBe(true);
    expect(settle().focus).toBe(id(5));
    expect(m.key(id(6), "x", t)).toBe(false);
  });
});

describe("the fan changing", () => {
  it("a new card takes the focus and the others ease to their new places", () => {
    tap(id(1));
    settle();
    const drawn = { ...HAND[0]!, id: 999 as CardId, name: "Brainstorm" };
    const f = step(hand({ cards: [...HAND, drawn] }));
    expect(f.focus).toBe(999);
    expect(f.active).toBe(true);
    expect(settle(hand({ cards: [...HAND, drawn] })).active).toBe(false);
  });
  it("the focus stays on its card when another leaves", () => {
    tap(id(4));
    settle();
    expect(step(hand({ cards: HAND.filter((c) => c.id !== id(0)) })).focus).toBe(id(4));
  });
  it("is deterministic: the same gestures at the same commit times draw the same frames", () => {
    const run = (): HandFrame[] => {
      const out: HandFrame[] = [];
      const mm = new HandMotion({ tap: () => {}, release: () => {} }, () => {});
      let tt = 0, cc = 0;
      out.push(mm.step(hand(), LAYOUT, ++cc, (tt += 16)));
      mm.gesture({ g: "tap", on: id(1), kind: "touch", x: 0, y: 0, at: tt });
      for (let i = 0; i < 20; i++) out.push(mm.step(hand(), LAYOUT, ++cc, (tt += 16)));
      return out;
    };
    expect(run()).toEqual(run());
  });
});
