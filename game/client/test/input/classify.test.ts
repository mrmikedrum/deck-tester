// The gesture classifier: one set of thresholds, pointer ids tracked, a second finger or a cancelled pointer sends
// nothing, and the hold decided by event times alone.
import { describe, expect, it } from "vitest";
import { classify, classifyAll, dirOf, dueAt, initialClassifier, tracking } from "../../src/input";
import type { ClassifierState, Gesture, PointerInput, PointerKind } from "../../src/input";

type K = string;
const down = (at: number, x = 100, y = 500, o: { id?: number; on?: K | null; kind?: PointerKind; button?: number } = {}): PointerInput<K> => ({
  t: "down",
  id: o.id ?? 1,
  kind: o.kind ?? "touch",
  button: o.button ?? 0,
  x,
  y,
  at,
  on: o.on === undefined ? "card" : o.on,
});
const move = (at: number, x: number, y: number, o: { id?: number; on?: K | null; kind?: PointerKind; buttons?: number } = {}): PointerInput<K> => ({
  t: "move",
  id: o.id ?? 1,
  kind: o.kind ?? "touch",
  buttons: o.buttons ?? 1,
  x,
  y,
  at,
  on: o.on === undefined ? "card" : o.on,
});
const up = (at: number, x = 100, y = 500, id = 1): PointerInput<K> => ({ t: "up", id, x, y, at });
const cancel = (at: number, id = 1): PointerInput<K> => ({ t: "cancel", id, at });
const tick = (at: number): PointerInput<K> => ({ t: "tick", at });

function run(inputs: readonly PointerInput<K>[], s: ClassifierState<K> = initialClassifier<K>()) {
  return classifyAll(s, inputs);
}
const kinds = (gs: readonly Gesture<K>[]): string[] => gs.map((g) => g.g);

describe("tap", () => {
  it("a press and release in place is a tap on what was pressed", () => {
    const r = run([down(0), up(120)]);
    expect(r.gestures).toEqual([{ g: "tap", on: "card", kind: "touch", x: 100, y: 500, at: 120 }]);
    expect(tracking(r.state)).toBe(false);
  });
  it("wobbling up to 10 px is still a tap", () => {
    expect(kinds(run([down(0), move(10, 106, 492), move(20, 110, 500), up(40, 110, 500)]).gestures)).toEqual(["tap"]);
  });
  it("a release more than 10 px from the press with no move between is a drag, not a tap at the press", () => {
    const r = run([down(0, 100, 500), up(60, 100, 380)]);
    expect(kinds(r.gestures)).toEqual(["dragStart", "drag", "drop"]);
    expect(r.gestures[0]).toMatchObject({ g: "dragStart", dir: "up", x0: 100, y0: 500, x: 100, y: 380 });
    expect(r.gestures[2]).toMatchObject({ g: "drop", x: 100, y: 380, dx: 0, dy: -120 });
    expect(tracking(r.state)).toBe(false);
  });
  it("a release within 10 px of the press with no move between is still a tap", () => {
    expect(kinds(run([down(0, 100, 500), up(60, 106, 492)]).gestures)).toEqual(["tap"]);
  });
  it("a hold let go far away with no move between ends the hold and drags", () => {
    expect(kinds(run([down(0, 100, 500), tick(400), up(600, 300, 500)]).gestures)).toEqual(["hold", "holdEnd", "dragStart", "drag", "drop"]);
  });
  it("a tap needs no tick and fires no hold before 380 ms", () => {
    expect(kinds(run([down(0), tick(379), up(379)]).gestures)).toEqual(["tap"]);
  });
});

describe("hold to peek", () => {
  it("holding still for 380 ms is a hold, then holdEnd when it lifts; never a tap", () => {
    const r = run([down(0), tick(200), tick(380), up(900)]);
    expect(kinds(r.gestures)).toEqual(["hold", "holdEnd"]);
    expect(r.gestures[0]).toMatchObject({ g: "hold", on: "card", at: 380 });
  });
  it("is due at the press plus 380 ms, and not while dragging", () => {
    const pressed = run([down(1000)]);
    expect(dueAt(pressed.state)).toBe(1380);
    expect(dueAt(run([move(1010, 140, 500)], pressed.state).state)).toBeNull();
    expect(dueAt(initialClassifier())).toBeNull();
  });
  it("a late frame gives the same gestures as a punctual one: the release finds the hold due", () => {
    const late = run([down(0), up(400)]);
    const punctual = run([down(0), tick(380), up(400)]);
    expect(late.gestures).toEqual(punctual.gestures);
  });
  it("moving past 10 px after a hold ends the peek and starts a drag (press, pause, drag up still plays)", () => {
    const r = run([down(0), tick(380), move(500, 100, 480), move(520, 100, 400), up(540, 100, 400)]);
    expect(kinds(r.gestures)).toEqual(["hold", "holdEnd", "dragStart", "drag", "drag", "drop"]);
    expect(r.gestures.find((g) => g.g === "dragStart")).toMatchObject({ dir: "up" });
  });
});

describe("drag", () => {
  it("starts past 10 px, with the press point and the direction it set out in", () => {
    const r = run([down(0), move(10, 100, 490), move(20, 100, 489)]);
    expect(kinds(r.gestures)).toEqual(["dragStart", "drag"]);
    expect(r.gestures[0]).toEqual({ g: "dragStart", on: "card", kind: "touch", x0: 100, y0: 500, x: 100, y: 489, dir: "up", at: 20 });
    expect(r.gestures[1]).toMatchObject({ g: "drag", dx: 0, dy: -11 });
  });
  it("exactly 10 px is not yet a drag", () => {
    expect(run([down(0), move(10, 110, 500)]).gestures).toEqual([]);
  });
  it("reports each move and drops with the travel from the press", () => {
    const r = run([down(0), move(16, 100, 470), move(32, 100, 420), up(48, 100, 410)]);
    expect(kinds(r.gestures)).toEqual(["dragStart", "drag", "drag", "drop"]);
    expect(r.gestures[3]).toMatchObject({ g: "drop", on: "card", x: 100, y: 410, dx: 0, dy: -90 });
  });
  it("up only when it rises more than 1.1 times its sideways travel (a hand card's play mode)", () => {
    expect(dirOf(0, -20)).toBe("up");
    expect(dirOf(10, -11.1)).toBe("up");
    expect(dirOf(10, -11)).toBe("right");
    expect(dirOf(-15, -12)).toBe("left");
    expect(dirOf(3, 20)).toBe("down");
    expect(dirOf(0, -5)).toBe("up");
  });
  it("a hold's peek never fires once a drag began", () => {
    expect(kinds(run([down(0), move(20, 130, 500), tick(400), up(800, 130, 500)]).gestures)).toEqual(["dragStart", "drag", "drop"]);
  });
});

describe("swipe", () => {
  it("a fast release is a swipe its way", () => {
    const r = run([down(0), move(16, 80, 500), move(32, 60, 500), up(40, 50, 500)]);
    const drop = r.gestures.at(-1);
    expect(drop).toMatchObject({ g: "drop", swipe: "left" });
    if (drop?.g === "drop") expect(drop.vx).toBeLessThan(-0.18);
  });
  it("a slow drag is no swipe", () => {
    const r = run([down(0), move(100, 112, 500), move(200, 124, 500), up(300, 130, 500)]);
    expect(r.gestures.at(-1)).toMatchObject({ g: "drop", swipe: null });
  });
  it("a finger that stops before lifting is no swipe", () => {
    const r = run([down(0), move(16, 140, 500), move(32, 180, 500), up(300, 180, 500)]);
    expect(r.gestures.at(-1)).toMatchObject({ g: "drop", swipe: null, vx: 0 });
  });
  it("vertical flicks are swipes up or down", () => {
    expect(run([down(0), move(16, 100, 470), up(30, 100, 440)]).gestures.at(-1)).toMatchObject({ swipe: "up" });
  });
});

describe("pointer ids", () => {
  it("a second finger cancels a pending tap: nothing but cancel, and the first finger's release sends nothing", () => {
    const r = run([down(0), down(30, 300, 500, { id: 2 }), up(60), up(70, 300, 500, 2)]);
    expect(r.gestures).toEqual([{ g: "cancel", on: "card", at: 30 }]);
  });
  it("a second finger during a drag cancels it: no drop", () => {
    const r = run([down(0), move(16, 100, 450), down(30, 300, 500, { id: 2 }), move(40, 100, 300), up(60, 100, 300), up(70, 300, 500, 2)]);
    expect(kinds(r.gestures)).toEqual(["dragStart", "drag", "cancel"]);
  });
  it("after a cancelled gesture nothing is classified until every pointer is up, then all is normal", () => {
    let s = run([down(0), down(30, 300, 500, { id: 2 })]).state;
    s = run([up(60)], s).state;
    expect(run([down(80, 100, 500, { id: 3 }), up(90, 100, 500, 3)], s).gestures).toEqual([]);
    s = run([up(100, 300, 500, 2)], s).state;
    expect(kinds(run([down(200, 100, 500, { id: 4 }), up(260, 100, 500, 4)], s).gestures)).toEqual(["tap"]);
  });
  it("moves and releases of a pointer that is not tracked are ignored", () => {
    const r = run([down(0), move(10, 300, 100, { id: 9 }), up(20, 300, 100, 9), up(40)]);
    expect(kinds(r.gestures)).toEqual(["tap"]);
  });
  it("a cancelled pointer sends nothing: pointercancel mid-drag gives cancel and no drop", () => {
    const r = run([down(0), move(16, 100, 440), move(32, 100, 360), cancel(40), move(50, 100, 300), up(60, 100, 300)]);
    expect(kinds(r.gestures)).toEqual(["dragStart", "drag", "drag", "cancel"]);
    expect(tracking(r.state)).toBe(false);
  });
  it("a cancelled press (pointercancel before moving) gives only cancel", () => {
    expect(kinds(run([down(0), cancel(100)]).gestures)).toEqual(["cancel"]);
  });
  it("lost capture after the release (the browser's implicit release) is ignored", () => {
    expect(kinds(run([down(0), up(50), cancel(51)]).gestures)).toEqual(["tap"]);
  });
  it("a mouse's other buttons start nothing", () => {
    expect(run([down(0, 100, 500, { kind: "mouse", button: 2 }), up(50)]).gestures).toEqual([]);
  });
});

describe("mouse extras", () => {
  const hover = (at: number, on: K | null, buttons = 0, kind: PointerKind = "mouse") => move(at, 10, 10, { on, buttons, kind });
  it("hover reports the target under a mouse with no button down, once per change", () => {
    const r = run([hover(0, "a"), hover(10, "a"), hover(20, "b"), hover(30, null)]);
    expect(r.gestures.map((g) => (g.g === "hover" ? g.on : g.g))).toEqual(["a", "b", null]);
  });
  it("touch moves and pressed mice never hover", () => {
    expect(run([hover(0, "a", 0, "touch"), hover(10, "b", 1)]).gestures).toEqual([]);
  });
  it("leaving the surface ends a hover", () => {
    const r = run([hover(0, "a"), { t: "leave", id: 1, at: 5 }]);
    expect(r.gestures.map((g) => (g.g === "hover" ? g.on : g.g))).toEqual(["a", null]);
  });
  it("the wheel passes through with its deltas", () => {
    const r = classify(initialClassifier<K>(), { t: "wheel", dx: 30, dy: 2, x: 5, y: 6, at: 7, on: "c" });
    expect(r.gestures).toEqual([{ g: "wheel", on: "c", dx: 30, dy: 2, x: 5, y: 6, at: 7 }]);
  });
  it("a click is a tap like a touch", () => {
    expect(run([down(0, 1, 1, { kind: "mouse" }), up(80, 1, 1)]).gestures).toEqual([{ g: "tap", on: "card", kind: "mouse", x: 1, y: 1, at: 80 }]);
  });
});

describe("determinism", () => {
  it("the same inputs give the same gestures and state", () => {
    const inputs = [down(0), move(16, 90, 480), move(32, 70, 470), tick(40), up(48, 60, 470)];
    expect(run(inputs)).toEqual(run(inputs));
  });
});
