// @vitest-environment happy-dom
// The chrome rendered from views into a DOM: the prompt's buttons and their states, the sheet, the hand, and the acts
// they emit, each stamped with the stop and commit of the view that drew it.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromeRenderer } from "../../src/chrome";
import type { ChromeIntent, ChromeRenderer, ChromeView } from "../../src/chrome";
import { BUSY, CROWDED, HAND, MAIN, NUMBER, OFFER, STOP, TARGETS, THREAT, WORDS, button, controls, view } from "../../src/chrome/workbench/samples";
import type { StopId } from "../../src/play";
import type { CardId } from "../../src/protocol";

let root: HTMLElement, r: ChromeRenderer, sent: ChromeIntent[], wakes: number, clock: number;

beforeEach(() => {
  document.body.innerHTML = `<div id="ui"></div>`;
  root = document.getElementById("ui")!;
  sent = [];
  wakes = 0;
  clock = 5000;
  r = chromeRenderer(root, { emit: (i) => sent.push(i), wake: () => wakes++, now: () => clock, measure: (t) => t.length * 7 });
});
afterEach(() => r.dispose());

const $ = <E extends Element = HTMLElement>(sel: string): E | null => root.querySelector<E>(sel);
const $$ = (sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const texts = (sel: string): string[] => $$(sel).map((e) => e.textContent ?? "");
const show = (v: ChromeView, now = 1000) => r.show(v, now);
const click = (el: Element | null): void => {
  if (!el) throw new Error("nothing to click");
  (el as HTMLElement).click();
};
function pointer(target: EventTarget, type: string, o: { id?: number; x?: number; y?: number } = {}): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: o.id ?? 1, pointerType: "touch", clientX: o.x ?? 100, clientY: o.y ?? 700, buttons: 1 }),
  );
}

describe("the prompt", () => {
  it("shows where, the headline and what it is about, with play's buttons in order", () => {
    show(view());
    expect($(".l-where")?.textContent).toBe("Turn 9 · Your main phase");
    // What can be played is lit: no headline and no instructions.
    expect($(".l-what")).toBeNull();
    expect($(".l-ctx")).toBeNull();
    expect(texts(".l-buttons button")).toEqual(["All plays (6)", "Auto", "To combat"]);
    expect($$(".l-buttons button").map((b) => b.className)).toEqual(["l-choice", "l-delegate", "act l-pass"]);
    expect($(".l-prompt")?.classList.contains("asking")).toBe(true);
    expect($(".l-prompt")?.classList.contains("play")).toBe(true);
  });
  it("a press sends the button's id, stamped with the stop and commit that drew it and the event's time", () => {
    show(view({ commit: 7 }));
    clock = 5123;
    click($(".l-pass"));
    expect(sent).toEqual([{ t: "act", stamp: { at: 5123, commit: 7 }, stop: STOP, act: { a: "press", button: "pass" } }]);
  });
  it("a control redrawn for a newer stop and commit carries those", () => {
    show(view({ commit: 7 }));
    const other = "g7:d43:2" as StopId;
    show(view({ commit: 8, controls: controls(MAIN, { stop: other }) }));
    click($(".l-pass"));
    expect(sent.at(-1)).toMatchObject({ stop: other, stamp: { commit: 8 } });
  });
  it("Done below the minimum is shown, disabled, and sends nothing", () => {
    show(view({ controls: controls(TARGETS) }));
    const done = $$(".l-buttons button").find((b) => b.textContent === "None")!;
    expect(done).toBeDefined();
    expect((done as HTMLButtonElement).disabled).toBe(true);
    expect(done.className).toBe("act l-done");
    click(done);
    expect(sent).toEqual([]);
    expect($(".l-prompt")?.classList.contains("play")).toBe(false);
  });
  it("busy: marked busy, nothing asks, every button disabled", () => {
    show(view({ controls: controls({ ...MAIN, busy: true }) }));
    const p = $(".l-prompt")!;
    expect(p.getAttribute("aria-busy")).toBe("true");
    expect(p.classList.contains("asking")).toBe(false);
    expect($$(".l-buttons button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    for (const b of $$(".l-buttons button")) click(b);
    expect(sent).toEqual([]);
  });
  it("busy with nothing to press draws the headline only", () => {
    show(view({ controls: controls(BUSY) }));
    expect($(".l-what")?.textContent).toBe("…");
    expect($(".l-buttons")).toBeNull();
  });
  it("a spectator sees the words and no buttons, and no sheet", () => {
    show(view({ controls: controls(THREAT, { mayAnswer: false, sheet: OFFER }) }));
    expect($(".l-what")?.textContent).toBe(THREAT.headline);
    expect($(".l-buttons")).toBeNull();
    expect($(".l-sheet")).toBeNull();
    expect($(".l-prompt")?.classList.contains("asking")).toBe(false);
  });
  it("a threat is red; the countdown fills the pass button at the commit's time and keeps the frames coming", () => {
    const v = view({ controls: controls(THREAT) });
    const half = show(v, 1600);
    expect($(".l-prompt")?.classList.contains("threat")).toBe(true);
    expect($(".l-pass")?.className).toBe("act l-pass auto");
    expect($(".l-auto-bar")?.style.transform).toBe("scaleX(0.5)");
    expect(half.active).toBe(true);
    expect(texts(".l-buttons button")).toEqual(["Hold", "OK"]);
    const done = show(v, 3300);
    expect($(".l-auto-bar")?.style.transform).toBe("scaleX(1)");
    expect(done.active).toBe(false);
  });
  it("braced costs are pips, read aloud by their letter", () => {
    show(view({ controls: controls({ ...MAIN, buttons: [button("respond", "Cast Snap", { cost: "{1}{U}", tone: "primary", role: "choice" })] }) }));
    const pips = $$(".l-buttons .pip");
    expect(pips.map((p) => p.className)).toEqual(["pip pip-n", "pip pip-u"]);
    expect(pips.map((p) => p.getAttribute("aria-label"))).toEqual(["1", "U"]);
  });
  it("sits inside the prompt's reserve and the safe area", () => {
    show(view({ viewport: { w: 1180, h: 820, safe: { top: 0, right: 0, bottom: 20, left: 0 } } }));
    const chrome = $(".dm-chrome")!;
    expect(chrome.style.getPropertyValue("--safe-bottom")).toBe("20px");
    expect(chrome.style.getPropertyValue("--u")).toBe("1px");
    expect($(".l-prompt")?.style.getPropertyValue("--res-bottom")).toBe("0px");
  });
});

describe("a press answers only what was touched", () => {
  const OTHER = "g7:d43:2" as StopId;
  /** A pointer press and release on a control, with the click a pointer makes (`detail` 1). */
  const pressOn = (el: Element | null): void => {
    if (!el) throw new Error("nothing to press");
    pointer(el, "pointerdown");
  };
  const releaseOn = (el: Element | null): void => {
    if (!el) throw new Error("nothing to release on");
    pointer(el, "pointerup");
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  };

  it("a prompt button pressed for one stop and released after a new stop is drawn in its place sends nothing", () => {
    show(view({ commit: 7 }));
    const pass = $(".l-pass");
    pressOn(pass);
    show(view({ commit: 8, controls: controls(MAIN, { stop: OTHER }) }));
    expect($(".l-pass")).toBe(pass); // the same element, redrawn for the new stop
    releaseOn($(".l-pass"));
    expect(sent).toEqual([]);
  });

  it("a prompt button pressed and released under the same stop carries the stop and commit seen at pointer-down", () => {
    show(view({ commit: 7 }));
    pressOn($(".l-pass"));
    clock = 5200;
    show(view({ commit: 8 })); // a redraw (a countdown frame), same stop
    releaseOn($(".l-pass"));
    expect(sent).toEqual([{ t: "act", stamp: { at: 5200, commit: 7 }, stop: STOP, act: { a: "press", button: "pass" }, origin: "b:pass" }]);
  });

  it("a prompt button whose control changed under the pointer sends nothing", () => {
    show(view({ commit: 7 }));
    const b = $$(".l-buttons button")[0]!;
    pressOn(b);
    const renamed = { ...MAIN, buttons: MAIN.buttons.map((x, i) => (i === 0 ? { ...x, id: "other" } : x)) };
    show(view({ commit: 8, controls: controls(renamed) }));
    releaseOn($$(".l-buttons button")[0]!);
    expect(sent).toEqual([]);
  });

  it("keyboard activation (Enter or Space: a click with no pointer) acts on the stop drawn now", () => {
    show(view({ commit: 7 }));
    show(view({ commit: 8, controls: controls(MAIN, { stop: OTHER }) }));
    $(".l-pass")!.focus();
    click($(".l-pass")); // what the browser dispatches for Enter or Space on a button: detail 0
    expect(sent).toEqual([{ t: "act", stamp: { at: 5000, commit: 8 }, stop: OTHER, act: { a: "press", button: "pass" }, origin: "b:pass" }]);
  });

  it("a numbered sheet option pressed for one stop and released after a new stop sends nothing", () => {
    show(view({ commit: 3, controls: controls(MAIN, { sheet: OFFER }) }));
    const opt = $('[data-option="4"]');
    pressOn(opt);
    show(view({ commit: 4, controls: controls(MAIN, { sheet: OFFER, stop: OTHER }) }));
    expect($('[data-option="4"]')).toBe(opt);
    releaseOn(opt);
    expect(sent).toEqual([]);
  });

  it("a numbered sheet option released on another option than the one pressed sends nothing; the same one sends", () => {
    show(view({ commit: 3, controls: controls(MAIN, { sheet: OFFER }) }));
    pressOn($('[data-option="3"]'));
    releaseOn($('[data-option="4"]'));
    expect(sent).toEqual([]);
    pressOn($('[data-option="4"]'));
    show(view({ commit: 4, controls: controls(MAIN, { sheet: OFFER }) }));
    releaseOn($('[data-option="4"]'));
    expect(sent).toEqual([{ t: "act", stamp: { at: 5000, commit: 3 }, stop: STOP, act: { a: "pick", option: 4 } }]);
  });

  it("a cancelled pointer sends nothing", () => {
    show(view({ commit: 7 }));
    pressOn($(".l-pass"));
    pointer($(".l-pass")!, "pointercancel");
    $(".l-pass")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(sent).toEqual([]);
  });
});

describe("the sheet", () => {
  it("lists one card's plays; a tap picks its option", () => {
    show(view({ controls: controls(MAIN, { sheet: OFFER }) }));
    expect($(".l-sheet h3")?.textContent).toBe("Frantic Search");
    expect($$("button.l-opt b").map((b) => b.firstChild?.textContent)).toEqual(["Cast Frantic Search", "Cast Frantic Search (Flashback)"]);
    expect(texts("button.l-opt b .cost")).toEqual(["2U", "2U"]);
    expect($(".dm-chrome")?.classList.contains("sheet-open")).toBe(true);
    click($$("button.l-opt")[1]!);
    expect(sent).toEqual([{ t: "act", stamp: { at: 5000, commit: 1 }, stop: STOP, act: { a: "pick", option: 4 } }]);
  });
  it("the stud and a tap on the scrim dismiss; a tap inside the box does not", () => {
    show(view({ controls: controls(MAIN, { sheet: OFFER }) }));
    click($(".l-box h3"));
    expect(sent).toEqual([]);
    click($(".g-close"));
    click($(".l-sheet"));
    expect(sent.map((s) => s.t)).toEqual(["dismiss", "dismiss"]);
  });
  it("the stepper steps within its bounds and its button presses", () => {
    show(view({ controls: controls(null, { sheet: NUMBER }) }));
    expect($("output")?.textContent).toBe("3");
    click($('[aria-label="Less"]'));
    click($('[aria-label="More"]'));
    click($(".l-row .l-done"));
    expect(sent.map((s) => (s.t === "act" ? s.act : null))).toEqual([{ a: "step", by: -1 }, { a: "step", by: 1 }, { a: "press", button: "value" }]);
    show(view({ controls: controls(null, { sheet: { ...NUMBER, stepper: { min: 0, max: 7, value: 7 } } }) }));
    expect($('[aria-label="More"]')?.classList.contains("end")).toBe(true); // dimmed, never disabled: a step past the end stays there
  });
  it("picked items are marked, with their order number", () => {
    const items = OFFER.items.map((i, k) => ({ ...i, picked: k === 1, badge: k === 1 ? 1 : null }));
    show(view({ controls: controls(MAIN, { sheet: { ...OFFER, items } }) }));
    const opts = $$("button.l-opt");
    expect(opts[1]!.classList.contains("on")).toBe(true);
    expect(opts[1]!.dataset["n"]).toBe("1");
    expect(opts[0]!.dataset["n"]).toBeUndefined();
  });
  it("one card's plays are rows even when the card can be pictured (live.js `offer`)", () => {
    const items = OFFER.items.map((i) => ({ ...i, card: 123 as CardId }));
    show(view({ controls: controls(MAIN, { sheet: { ...OFFER, items } }), looks: new Map([[123 as CardId, { name: "Frantic Search", image: "x.jpg" }]]) }));
    expect($$(".l-card")).toHaveLength(0);
    expect($(".l-grid")).toBeNull();
    expect($$(".l-sheet > .l-box > button.l-opt")).toHaveLength(2);
  });
  it("a chooser draws cards the catalogue can picture as cards, in a grid", () => {
    const items = OFFER.items.map((i) => ({ ...i, card: 123 as CardId }));
    const sheet = { ...OFFER, kind: "chooser" as const, items };
    show(view({ controls: controls(MAIN, { sheet }), looks: new Map([[123 as CardId, { name: "Frantic Search", image: "x.jpg" }]]) }));
    expect($$(".l-grid .l-card")).toHaveLength(2);
  });
  it("a chooser's options without pictures are rows in its grid", () => {
    show(view({ controls: controls(MAIN, { sheet: WORDS }) }));
    expect(texts(".l-grid button.l-opt")).toEqual(["Alpha", "Beta", "Gamma"]);
    expect($$(".l-grid button")[2]!.dataset["n"]).toBe("1");
    expect(texts(".l-row button")).toEqual(["Clear", "Done (1)"]);
    expect($$(".l-row button").map((b) => b.className)).toEqual(["l-ghost", "l-done"]);
  });
  it("cards off the table (a library search) are pictured by name", () => {
    const items = OFFER.items.map((i, k) => ({ ...i, card: null, name: k === 0 ? "Forest" : "Swamp" }));
    show(view({ controls: controls(MAIN, { sheet: { ...OFFER, kind: "chooser", items } }), named: new Map([["Forest", { name: "Forest", image: "forest.jpg" }]]) }));
    expect($$(".l-grid .l-card").map((c) => c.dataset["option"])).toEqual([String(items[0]!.option)]);
    expect($(".l-grid .l-card .pic")?.getAttribute("style")).toContain("forest.jpg");
    expect($$("button.l-opt")).toHaveLength(1); // Swamp has no picture: drawn by its label
  });
});

describe("a card sheet (a library search, a graveyard)", () => {
  /** A chooser of hidden cards by name, each pictured by the catalogue. */
  const search = (names: readonly string[], pick: { min: number; max: number }, picked: readonly number[] = []) => {
    const items = names.map((name, i) => ({ option: i + 1, label: name, cost: null, detail: `${name} text`, card: null, name, picked: picked.includes(i + 1), badge: null }));
    const sheet = { kind: "chooser" as const, title: "Choose a land card (Farseek)", wide: true, items, stepper: null, buttons: [], carried: null, pick: { ...pick, ordered: false, repeat: false } };
    const named = new Map(names.map((n) => [n, { name: n, image: `${n.toLowerCase()}.jpg` }]));
    return view({ controls: controls(MAIN, { sheet }), named });
  };
  const distinct = (n: number) => Array.from({ length: n }, (_, i) => `Card ${String(i + 1).padStart(2, "0")}`);
  const shownNames = () => $$(".l-deal .l-card .sr").map((e) => e.textContent);
  /** The page is the sheet's own state: Preact draws its change on the next microtask. */
  const turn = async (which: "Next page" | "Previous page") => {
    $<HTMLButtonElement>(`[aria-label="${which}"]`)?.click();
    await Promise.resolve();
  };

  it("deals the printed cards, one size, with no words under them", () => {
    show(search(["Hallowed Fountain", "Island", "Mountain", "Sacred Foundry", "Watery Grave"], { min: 1, max: 1 }));
    const cards = $$(".l-deal .l-card");
    expect(cards).toHaveLength(5);
    expect(cards.every((c) => !c.querySelector("small"))).toBe(true); // the card says what it is
    expect(cards.every((c) => c.style.width === "")).toBe(true); // one size: the grid's --cw, never per card
    expect($(".l-deal")?.getAttribute("style")).toMatch(/--cw:\s*\d+px/);
    expect($(".l-pager")).toBeNull(); // five fit on one page
    expect($(".l-sheet.cards")).not.toBeNull();
  });
  it("copies off the table lie as one pile with their count; a tap takes the next copy", () => {
    show(search(["Island", "Island", "Island", "Mountain", "Mountain", "Watery Grave"], { min: 0, max: 2 }, [1]));
    expect(shownNames()).toEqual(["Island, 3 copies", "Mountain, 2 copies", "Watery Grave"]);
    expect(texts(".l-deal .l-card .count")).toEqual(["×3", "×2"]);
    const island = $$(".l-deal .l-card")[0]!;
    expect(island.classList.contains("on")).toBe(true);
    expect(island.getAttribute("aria-pressed")).toBe("true");
    click(island);
    expect(sent.at(-1)).toMatchObject({ act: { a: "pick", option: 2 } });
  });
  it("picked cards are lifted with a seal; when the choice is full the rest dim and a tap on them sends nothing", () => {
    show(search(["Island", "Mountain", "Plains", "Swamp"], { min: 2, max: 2 }, [1, 3]));
    const cards = $$(".l-deal .l-card");
    expect(cards.map((c) => c.classList.contains("on"))).toEqual([true, false, true, false]);
    expect(cards.map((c) => !!c.querySelector(".seal"))).toEqual([true, false, true, false]);
    expect(cards.map((c) => c.classList.contains("full"))).toEqual([false, true, false, true]);
    click(cards[1]!);
    expect(sent).toEqual([]);
    click(cards[0]!); // a picked card is put back
    expect(sent.at(-1)).toMatchObject({ act: { a: "pick", option: 1 } });
  });
  it("past what fits, pages: the pager turns them and stops at either end", async () => {
    const names = distinct(62);
    show(search(names, { min: 1, max: 1 }));
    const first = shownNames();
    expect(first.length).toBeGreaterThan(4);
    expect(first.length).toBeLessThan(62);
    expect(first[0]).toBe("Card 01");
    const pages = Math.ceil(62 / first.length);
    expect($$(".l-pager .studs i")).toHaveLength(pages);
    expect($<HTMLButtonElement>('[aria-label="Previous page"]')?.disabled).toBe(true);
    await turn("Next page");
    expect(shownNames()[0]).toBe(names[first.length]);
    expect($(".l-pager")?.getAttribute("aria-label")).toBe(`Page 2 of ${pages}`);
    expect(sent).toEqual([]); // turning a page answers nothing
    for (let i = 0; i < pages; i++) await turn("Next page");
    expect($<HTMLButtonElement>('[aria-label="Next page"]')?.disabled).toBe(true);
    expect(shownNames().at(-1)).toBe("Card 62");
  });
  it("keeps its page while picks change; a pick on a later page sends that card's option", async () => {
    const names = distinct(40);
    show(search(names, { min: 0, max: 2 }));
    const per = shownNames().length;
    await turn("Next page");
    click($$(".l-deal .l-card")[0]!);
    expect(sent.at(-1)).toMatchObject({ act: { a: "pick", option: per + 1 } });
    show(search(names, { min: 0, max: 2 }, [per + 1]));
    expect(shownNames()[0]).toBe(names[per]);
    expect($$(".l-deal .l-card")[0]!.classList.contains("on")).toBe(true);
  });
  it("its box never scrolls (the cards are sized to the screen) and has no option stripe", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../../src/chrome/chrome.css"), "utf8");
    const rule = /\.l-sheet\.cards \.l-box \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/overflow:\s*visible/);
    expect(rule).toMatch(/max-height:\s*none/);
    expect(css).not.toMatch(/\.l-card::before/);
  });
});

describe("the hand", () => {
  it("draws the fan, open on the last card, playable edges lit", () => {
    show(view());
    const cards = $$(".g-hand .hcard[data-id]");
    expect(cards.map((c) => Number(c.dataset["id"]))).toEqual(HAND.map((c) => c.id));
    expect(cards.filter((c) => c.classList.contains("playable"))).toHaveLength(3);
    expect(cards.at(-1)?.getAttribute("aria-current")).toBe("true");
    expect(cards[1]?.querySelector(".l-hand-label")?.textContent).toBe("Snap 1U");
  });
  it("a crowded hand's names wrap only between words: each word shrinks to fit its strip, or is ellipsized at the floor", () => {
    const long = [...CROWDED, { ...CROWDED[0]!, id: 148 as CardId, name: "Phantasmagorically" }, { ...CROWDED[0]!, id: 149 as CardId, name: "Realmbreaker" }];
    show(view({ hand: { cards: long, away: false, respond: false, carried: [], fresh: [] } }));
    const css = readFileSync(resolve(import.meta.dirname, "../../src/chrome/chrome.css"), "utf8");
    const rule = /\.l-hand-label \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).not.toMatch(/overflow-wrap:\s*anywhere|word-break:\s*break-all/);
    expect(rule).toMatch(/overflow-wrap:\s*normal/);
    expect(rule).toContain("var(--label-k, 1)");
    expect(css).toMatch(/\.l-hand-label\.tight \{[^}]*text-overflow:\s*ellipsis/);
    const cards = $$(".g-hand .held .hcard[data-id]");
    expect(cards).toHaveLength(long.length);
    let shrunk = 0;
    for (const c of cards) {
      const style = c.getAttribute("style") ?? "";
      const w = Number(/--label-w:\s*([\d.]+)px/.exec(style)?.[1]);
      const k = Number(/--label-k:\s*([\d.]+)/.exec(style)?.[1] ?? "1");
      const label = c.querySelector(".l-hand-label")!;
      const name = long.find((x) => x.id === Number(c.dataset["id"]))!.name;
      const longest = Math.max(...name.split(/\s+/).map((word) => word.length * 7));
      if (k < 1) shrunk++;
      // The strip's content box (3 px padding each side) holds its longest word at the shrunk size, unless the size is
      // at its floor, where the word is ellipsized.
      if (label.classList.contains("tight")) expect(k * 14, name).toBeCloseTo(8, 1);
      else expect(k * longest, `${name}: ${k} x ${longest} in ${w}`).toBeLessThanOrEqual(w - 6);
    }
    expect(shrunk).toBeGreaterThan(0);
  });
  it("slides away", () => {
    show(view({ hand: { cards: HAND, away: true, respond: false, carried: [], fresh: [] } }));
    expect($(".g-hand")?.classList.contains("away")).toBe(true);
  });
  it("a carried card leaves the fan and is drawn where it was let go", () => {
    show(view({ controls: controls(MAIN, { sheet: OFFER }), hand: { cards: HAND, away: false, respond: false, carried: [OFFER.carried!], fresh: [] } }));
    expect($$(".g-hand .held .hcard").map((c) => Number(c.dataset["id"]))).not.toContain(123);
    const loose = $(".l-loose .hcard")!;
    expect(loose.dataset["card"]).toBe("123");
    expect(loose.getAttribute("style")).toContain("top:");
  });
  it("a resize while a card is carried reports its re-anchored pose, once: the app moves the moment there", () => {
    const carried = OFFER.carried!;
    const handOf = (pose: typeof carried.pose) => ({ cards: HAND, away: false, respond: false, carried: [{ card: carried.card, pose }], fresh: [] });
    expect(show(view({ commit: 1, hand: handOf(carried.pose) })).carried ?? []).toEqual([]);
    // The page grows: the hand moves, and the card held over it with it.
    const grown = show(view({ commit: 2, hand: handOf(carried.pose) }, 1400, 900), 1016).carried ?? [];
    expect(grown.map((c) => c.card)).toEqual([carried.card]);
    const moved = grown[0]!.pose;
    expect(moved).not.toEqual(carried.pose);
    const drawn = $(".l-loose .hcard")?.getAttribute("style");
    // The app's next view carries the new pose: drawn where it was, nothing more to report.
    expect(show(view({ commit: 3, hand: handOf(moved) }, 1400, 900), 1032).carried ?? []).toEqual([]);
    expect($(".l-loose .hcard")?.getAttribute("style")).toBe(drawn);
  });
  it("dragging a card up and letting go over the table sends a release, stamped with the commit the gesture started under", () => {
    show(view({ commit: 4 }));
    const card = $('.held .hcard[data-id="123"]')!;
    pointer(card, "pointerdown", { y: 700 });
    expect(wakes).toBeGreaterThan(0);
    pointer(card, "pointermove", { y: 660 });
    pointer(card, "pointermove", { y: 580 });
    show(view({ commit: 5 }), 1016);
    expect($('.held .hcard[data-id="123"]')?.classList.contains("dragging")).toBe(true);
    clock = 5200;
    pointer(document, "pointerup", { y: 580 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: "act", stop: STOP, stamp: { at: 5200, commit: 4 }, act: { a: "release", card: 123, dy: -120, overTable: true } });
  });
  it("a card held through a new stop is let go under the stop it was lifted for (play drops it as stale)", () => {
    show(view({ commit: 4 }));
    const card = $('.held .hcard[data-id="123"]')!;
    pointer(card, "pointerdown", { y: 700 });
    pointer(card, "pointermove", { y: 580 });
    const replacement = "g7:d43:2" as StopId;
    show(view({ commit: 5, controls: controls(MAIN, { stop: replacement }) }), 1016);
    pointer(document, "pointerup", { y: 580 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ stop: STOP, stamp: { commit: 4 }, act: { a: "release", card: 123 } });
    // the next gesture starts under the new stop
    pointer(card, "pointerdown", { y: 700 });
    pointer(card, "pointermove", { y: 580 });
    pointer(document, "pointerup", { y: 580 });
    expect(sent[1]).toMatchObject({ stop: replacement, stamp: { commit: 5 } });
  });
  it.each([
    ["over the hand (90 px up from low on the card)", { y: 790 }, { y: 700 }],
    ["over the prompt", { y: 790 }, { x: 1000, y: 690 }],
    ["off the screen", { y: 700 }, { y: -20 }],
  ])("let go %s, the release says it is not over the table", (_, from, to) => {
    show(view());
    const card = $('.held .hcard[data-id="123"]')!;
    pointer(card, "pointerdown", from);
    pointer(card, "pointermove", { y: from.y - 60 }); // lifted: straight up first
    pointer(card, "pointermove", to);
    pointer(document, "pointerup", to);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ act: { a: "release", card: 123, overTable: false } });
  });
  it("a second finger mid-drag sends nothing", () => {
    show(view());
    const card = $('.held .hcard[data-id="123"]')!;
    pointer(card, "pointerdown");
    pointer(card, "pointermove", { y: 600 });
    pointer(card, "pointerdown", { id: 2, x: 300 });
    pointer(document, "pointerup", { y: 560 });
    pointer(document, "pointerup", { id: 2 });
    expect(sent).toEqual([]);
  });
  it("a cancelled pointer sends nothing", () => {
    show(view());
    const card = $('.held .hcard[data-id="123"]')!;
    pointer(card, "pointerdown");
    pointer(card, "pointermove", { y: 560 });
    pointer(document, "pointercancel");
    pointer(document, "pointerup", { y: 560 });
    expect(sent).toEqual([]);
  });
  it("tapping the open card sends a tap on it", () => {
    show(view({ commit: 3 }));
    const card = $('.held .hcard[data-id="126"]')!;
    pointer(card, "pointerdown");
    pointer(document, "pointerup");
    expect(sent).toEqual([{ t: "act", stamp: { at: 5000, commit: 3 }, stop: STOP, act: { a: "tap", on: { card: 126 } }, origin: "h:126" }]);
  });
  it("holding a card keeps the frames coming until the peek", () => {
    show(view());
    pointer($('.held .hcard[data-id="121"]')!, "pointerdown"); // at 5000, the clock the frames share
    expect(show(view(), 5100).active).toBe(true);
    expect($(".g-peek")).toBeNull();
    show(view(), 5400);
    expect($(".g-peek")?.getAttribute("style")).toContain("card/snap.jpg");
  });
});

describe("the renderer", () => {
  it("before a game shows only the waiting line", () => {
    show(view({ waiting: "Shuffling up…" }));
    expect($(".l-waiting")?.textContent).toBe("Shuffling up…");
    expect($(".g-hand")).toBeNull();
    expect($(".l-buttons")).toBeNull();
  });
  it("shows a toast while the view has one, and keeps its text as it fades", () => {
    show(view({ toast: "You can't play that now" }));
    expect($(".l-toast.on")?.textContent).toBe("You can't play that now");
    show(view({ toast: null }));
    expect($(".l-toast.on")).toBeNull();
    expect($(".l-toast")?.textContent).toBe("You can't play that now");
  });
  it("reports a fault instead of throwing, and draws the next commit as a cut", () => {
    const broken = { ...view(), hand: undefined } as unknown as ChromeView;
    const report = show(broken);
    expect(report.active).toBe(false);
    expect(report.fault).toMatch(/\w/);
    expect(show(view()).fault).toBeNull();
    expect($$(".g-hand .hcard[data-id]")).toHaveLength(HAND.length);
  });
  it("is idle when nothing moves", () => {
    expect(show(view()).active).toBe(false);
  });
  it("dispose removes everything it drew", () => {
    show(view());
    r.dispose();
    expect(root.innerHTML).toBe("");
  });
});
