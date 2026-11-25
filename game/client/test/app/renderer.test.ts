// @vitest-environment happy-dom
// The page renderer's canvas gestures: a tap or a drag is aimed at what was on screen when the pointer went down (its
// commit, its stop, the hit group under it as drawn then), never at what a later commit shows when it is let go. The
// scene and the chrome are stand-ins: what is under the pointer is set by the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HitGroup } from "../../src/layout";
import { NO_INSETS, now } from "../../src/platform";
import { decodeSnapshot } from "../../src/protocol";
import type { CardId } from "../../src/protocol";
import type { InputMsg } from "../../src/app/msg";
import { pageRenderer } from "../../src/app/renderer";
import type { PageRenderer } from "../../src/app/renderer";
import { initialState } from "../../src/app/state";
import type { AppState } from "../../src/app/state";
import { update } from "../../src/app/update";
import { sceneFrame } from "../../src/app/views";
import { envelope } from "./rig";
import { catalog } from "../model/fixtures";

/** What the stand-in scene's pick finds under the pointer. */
const under: { group: HitGroup | null; ambient: boolean } = { group: null, ambient: false };

vi.mock("../../src/scene/three/scene", () => ({
  createScene: () => ({
    host: null,
    renderer: null,
    out: { size: 0, drain: () => [], listen: () => undefined },
    ready: () => Promise.resolve(),
    show: () => ({ active: false, consumed: null, consumedSeq: null, landed: [], stackLanding: null, fault: null, recaps: [], flying: false, ...(under.ambient ? { ambient: true } : {}) }),
    inspect: () => null,
    pick: () => under.group,
    dispose: () => undefined,
  }),
}));

vi.mock("../../src/chrome", async (original) => ({
  ...(await original<typeof import("../../src/chrome")>()),
  chromeRenderer: () => ({ show: () => ({ active: false, fault: null }), dispose: () => undefined }),
}));

const group = (members: number[]): HitGroup => ({ id: "unit:x", kind: "unit", seat: null, members: members as CardId[] }) as unknown as HitGroup;

/** A page that has the card data its decisions are about (so each is offered as it arrives). */
const warm = (): AppState => ({ ...initialState({ clientBuild: "b", viewport: { w: 1180, h: 820, safe: NO_INSETS } }), catalog });

function stateAt(decision: number, v: number, s: AppState = warm()): AppState {
  const r = decodeSnapshot(envelope({ v, decision }));
  if (!r.ok) throw new Error(r.error.summary);
  const next = update(s, { t: "snapshot", at: v * 100, epoch: 0, snap: r.value, continuity: v === 1 ? "first" : "advance", asked: v * 100 }).state;
  return { ...next, commit: next.commit + 1 };
}

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", clientX: x, clientY: y, buttons: 1 }));
}

let canvas: HTMLCanvasElement, page: PageRenderer, emitted: InputMsg[];

beforeEach(async () => {
  document.body.innerHTML = `<canvas id="stage"></canvas><div id="ui"></div>`;
  canvas = document.getElementById("stage") as HTMLCanvasElement;
  emitted = [];
  page = pageRenderer({ canvas, ui: document.getElementById("ui")!, emit: (m) => emitted.push(m), wake: () => undefined, dpr: () => 1 });
  page.show(stateAt(1, 1), now());
  await page.ready;
});
afterEach(() => page.dispose());

describe("a canvas gesture is aimed at what was on screen at pointer-down", () => {
  it("a tap pressed under decision 1 and released after decision 2 is shown carries decision 1's stop and commit", () => {
    const s1 = stateAt(1, 1);
    page.show(s1, now());
    under.group = group([5]);
    pointer(canvas, "pointerdown", 300, 300);
    const s2 = stateAt(2, 2, s1);
    expect(s2.session.stop).not.toBe(s1.session.stop);
    page.show(s2, now());
    under.group = group([5, 6]); // what the later commit shows there
    pointer(canvas, "pointerup", 300, 300);
    expect(emitted).toEqual([
      { t: "act", stamp: { at: expect.any(Number), commit: s1.commit }, stop: s1.session.stop, act: { a: "tap", on: { group: "unit:x", members: [5] } } },
    ]);
    // Play drops it: its stop has expired.
    const out = update(s2, emitted[0]!);
    expect(out.effects.filter((e) => e.kind === "answer")).toEqual([]);
  });

  it("a drag keeps its source as drawn at pointer-down, with that stop and commit", () => {
    const s1 = stateAt(1, 1);
    page.show(s1, now());
    under.group = group([5]);
    pointer(canvas, "pointerdown", 300, 300);
    const s2 = stateAt(2, 2, s1);
    page.show(s2, now());
    pointer(canvas, "pointermove", 360, 300);
    under.group = { ...group([9]), id: "plate:x" } as HitGroup;
    pointer(canvas, "pointerup", 400, 300);
    expect(emitted).toEqual([
      {
        t: "act",
        stamp: { at: expect.any(Number), commit: s1.commit },
        stop: s1.session.stop,
        act: { a: "drag", from: { group: "unit:x", members: [5] }, onto: { group: "plate:x", members: [9] } },
      },
    ]);
  });
});

describe("the scene's ambient flag", () => {
  it("passes to the loop in the commit's report", () => {
    under.ambient = true;
    expect(page.show(stateAt(1, 1), now()).ambient).toBe(true);
    under.ambient = false;
    expect(page.show(stateAt(1, 1), now()).ambient).toBeUndefined();
  });
});

describe("a sifted card's group is the card itself", () => {
  it("a tap on a `sift:` group is a tap on its card", () => {
    page.show(stateAt(1, 1), now());
    under.group = { id: "sift:5", kind: "card", seat: null, members: [5] } as unknown as HitGroup;
    pointer(canvas, "pointerdown", 300, 300);
    pointer(canvas, "pointerup", 300, 300);
    expect(emitted.filter((m) => m.t === "act").map((m) => m.t === "act" && m.act)).toEqual([{ a: "tap", on: { card: 5 } }]);
  });
});

function mouse(target: EventTarget, type: string, x: number, y: number, buttons = 0): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 2, pointerType: "mouse", clientX: x, clientY: y, buttons }));
}

describe("hover: the group under a mouse pointer", () => {
  const hovers = () => emitted.filter((m) => m.t === "hover").map((m) => (m.t === "hover" ? m.group : undefined));

  it("is emitted when it changes, and null when the pointer leaves or presses", () => {
    page.show(stateAt(1, 1), now());
    under.group = group([5]);
    mouse(canvas, "pointermove", 300, 300);
    mouse(canvas, "pointermove", 305, 300); // the same group: nothing new
    under.group = { ...group([9]), id: "plate:x" } as HitGroup;
    mouse(canvas, "pointermove", 400, 300);
    mouse(canvas, "pointerleave", 900, 300);
    mouse(canvas, "pointerleave", 900, 300); // already none
    under.group = group([5]);
    mouse(canvas, "pointermove", 300, 300);
    mouse(canvas, "pointerdown", 300, 300, 1);
    expect(hovers()).toEqual(["unit:x", "plate:x", null, "unit:x", null]);
    const first = emitted.find((m) => m.t === "hover")!;
    expect(first.stamp.commit).toBe(stateAt(1, 1).commit);
  });

  it("is a mouse's only: a touch, or a mouse with a button down, hovers nothing", () => {
    page.show(stateAt(1, 1), now());
    under.group = group([5]);
    pointer(canvas, "pointermove", 300, 300);
    mouse(canvas, "pointermove", 300, 300, 1);
    expect(hovers()).toEqual([]);
  });

  it("is paint-only: the app keeps it and hands it to the scene, and the plan stays as it was", () => {
    const s1 = stateAt(1, 1);
    const s2 = update(s1, { t: "hover", stamp: { at: 500, commit: s1.commit }, group: "unit:x" }).state;
    expect(s2.hover).toBe("unit:x");
    expect(s2.plan).toBe(s1.plan);
    expect(s2.planKey).toBe(s1.planKey);
    expect(s2.play).toBe(s1.play);
    expect(sceneFrame(s2)?.hover).toBe("unit:x");
    expect(sceneFrame(update(s2, { t: "hover", stamp: { at: 600, commit: s1.commit }, group: null }).state)?.hover).toBeNull();
    expect(initialState({ clientBuild: "b" }).hover).toBeNull();
  });
});
