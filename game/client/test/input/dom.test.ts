// @vitest-environment happy-dom
// The DOM adapter: real Pointer Events on an element, stamped with the injected clock; releases and cancels read on
// the document; the hold fired by the caller's tick.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindPointer } from "../../src/input";
import type { Gesture, PointerBinding } from "../../src/input";

let host: HTMLElement, card: HTMLElement, binding: PointerBinding, seen: Gesture<string>[], clock: number;

function fire(target: EventTarget, type: string, o: { id?: number; x?: number; y?: number; kind?: string; buttons?: number; button?: number } = {}): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: o.id ?? 1,
      pointerType: o.kind ?? "touch",
      clientX: o.x ?? 100,
      clientY: o.y ?? 500,
      button: o.button ?? 0,
      buttons: o.buttons ?? 1,
    }),
  );
}

beforeEach(() => {
  document.body.innerHTML = `<div id="host"><div class="card" data-k="seven"><span id="inner">Seven</span></div></div>`;
  host = document.getElementById("host")!;
  card = host.querySelector(".card")!;
  seen = [];
  clock = 1000;
  binding = bindPointer<string>(host, {
    pick: (t) => (t instanceof Element ? (t.closest<HTMLElement>("[data-k]")?.dataset["k"] ?? null) : null),
    on: (gs) => seen.push(...gs),
    now: () => clock,
  });
});
afterEach(() => binding.dispose());

describe("bindPointer", () => {
  it("a press and release is a tap on what the press picked, at the injected clock's time", () => {
    fire(document.getElementById("inner")!, "pointerdown");
    expect(binding.active).toBe(true);
    clock = 1080;
    fire(document, "pointerup");
    expect(seen).toEqual([{ g: "tap", on: "seven", kind: "touch", x: 100, y: 500, at: 1080 }]);
    expect(binding.active).toBe(false);
  });
  it("a release off the surface (on the document) still ends the gesture", () => {
    fire(card, "pointerdown");
    clock = 1016;
    fire(card, "pointermove", { y: 470 });
    clock = 1032;
    fire(document.body, "pointerup", { y: 400 });
    expect(seen.map((g) => g.g)).toEqual(["dragStart", "drag", "drop"]);
    expect(seen.at(-1)).toMatchObject({ dy: -100, on: "seven" });
  });
  it("the hold fires on the caller's tick, when due", () => {
    fire(card, "pointerdown");
    expect(binding.due()).toBe(1380);
    binding.tick(1300);
    expect(seen).toEqual([]);
    binding.tick(1400);
    expect(seen.map((g) => g.g)).toEqual(["hold"]);
  });
  it("pointercancel sends nothing but cancel", () => {
    fire(card, "pointerdown");
    fire(card, "pointermove", { y: 380 });
    fire(document, "pointercancel");
    fire(document, "pointerup", { y: 300 });
    expect(seen.map((g) => g.g)).toEqual(["dragStart", "drag", "cancel"]);
  });
  it("lost capture mid-gesture cancels it", () => {
    fire(card, "pointerdown");
    fire(card, "lostpointercapture");
    expect(seen.map((g) => g.g)).toEqual(["cancel"]);
  });
  it("a second finger cancels, and neither finger's release sends anything", () => {
    fire(card, "pointerdown", { id: 1 });
    fire(card, "pointerdown", { id: 2, x: 300 });
    fire(document, "pointerup", { id: 1 });
    fire(document, "pointerup", { id: 2 });
    expect(seen.map((g) => g.g)).toEqual(["cancel"]);
  });
  it("a hovering mouse reports what it is over; a sideways wheel is taken from the page", () => {
    fire(card, "pointermove", { kind: "mouse", buttons: 0 });
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 30, deltaY: 2 });
    card.dispatchEvent(wheel);
    expect(seen.map((g) => g.g)).toEqual(["hover", "wheel"]);
    expect(wheel.defaultPrevented).toBe(true);
  });
  it("after dispose nothing is read", () => {
    binding.dispose();
    fire(card, "pointerdown");
    fire(document, "pointerup");
    expect(seen).toEqual([]);
  });
});
