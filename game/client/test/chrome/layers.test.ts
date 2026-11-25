// @vitest-environment happy-dom
// The chrome's layers rendered from views: the inspector, the mulligan, the Game menu and its form, the hand as a list,
// the stack's rules, the fixtures (the Game button, chips, the back bar), and the focus stack's rules in the
// DOM: layers in its order, everything under the top one inert, keyboard focus into a new layer and back to the control
// that opened it, and a scrim that dismisses only a press that started on it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromeRenderer } from "../../src/chrome";
import type { ChromeIntent, ChromeRenderer, ChromeView } from "../../src/chrome";
import {
  HAND,
  HAND_SHEET,
  INSPECTOR,
  MAIN,
  MENU,
  MULLIGAN,
  MULLIGAN_PROMPT,
  OFFER,
  STACK_ROWS,
  STACK_SHEET,
  STOP,
  THREAT,
  controls,
  view,
} from "../../src/chrome/workbench/samples";
import type { CardId } from "../../src/protocol";

let root: HTMLElement, r: ChromeRenderer, sent: ChromeIntent[];

beforeEach(() => {
  document.body.innerHTML = `<div id="ui"></div>`;
  root = document.getElementById("ui")!;
  sent = [];
  r = chromeRenderer(root, { emit: (i) => sent.push(i), wake: () => undefined, now: () => 5000, measure: (t) => t.length * 7 });
});
afterEach(() => r.dispose());

const $ = <E extends Element = HTMLElement>(sel: string): E | null => root.querySelector<E>(sel);
const $$ = (sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const texts = (sel: string): string[] => $$(sel).map((e) => e.textContent ?? "");
const show = (more: Partial<ChromeView>) => r.show(view(more), 1000);
const click = (el: Element | null): void => {
  if (!el) throw new Error("nothing to click");
  (el as HTMLElement).click();
};
const orders = () => sent.map((i) => (i.t === "act" ? { act: i.act } : { ...i, stamp: undefined }));
function pointer(target: EventTarget, type: string): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", clientX: 5, clientY: 5, buttons: 1 }));
}
const tapOn = (down: Element, up: Element = down): void => {
  pointer(down, "pointerdown");
  pointer(up, "pointerup");
  up.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
};

describe("the inspector", () => {
  const open = (more: Partial<ChromeView> = {}) => show({ layers: [{ layer: "inspector", restore: null }], inspector: INSPECTOR, ...more });
  it("shows the card large, its name, whose and where, its facts, its plays and its rules", () => {
    open();
    expect($(".scrim .inspector .big")?.getAttribute("style")).toContain("meloku-the-clouded-mirror.jpg");
    expect($(".inspector h3")?.textContent).toBe("Meloku the Clouded Mirror");
    expect($(".inspector .owner")?.textContent).toBe("You · Battlefield");
    expect(texts(".inspector .chip")).toEqual(["Commander", "2/4", "Flying"]);
    expect($$(".l-actions button")).toHaveLength(1);
    expect($(".inspector .oracle")?.textContent).toContain("Create a 1/1 blue Illusion");
    expect($(".inspector")?.getAttribute("style")).toContain("var(--seat-near)");
  });
  it("an action is a pick of its option on its card; ✕ dismisses; a related card opens in its place", () => {
    open({ inspector: { ...INSPECTOR, related: [{ label: "Attached", cards: [{ id: 9 as CardId, name: "Sol Ring", image: null }] }] } });
    click($(".l-actions button"));
    click($(".inspector .g-close"));
    click($(".inspector .rel .tile"));
    expect(orders()).toEqual([{ act: { a: "pick", option: 5, card: INSPECTOR.card } }, { t: "dismiss" }, { t: "open", layer: "inspector", card: 9 }]);
    expect(sent[0]).toMatchObject({ stop: STOP });
  });
  it("a card in my hand is held up in the hand's focus: the card and its plays, under the fan, which stays live", () => {
    open({ inspector: { ...INSPECTOR, held: true } });
    expect($(".scrim.from-hand .inspector.from-hand .big")?.getAttribute("style")).toContain("meloku-the-clouded-mirror.jpg");
    expect($(".inspector.from-hand .info h3")).toBeNull(); // the leaf holds only its plays
    expect($$(".inspector.from-hand .l-actions button")).toHaveLength(1);
    expect(($(".l-hand-host") as HTMLElement | null)?.inert).toBe(false);
    expect(($(".scrim.from-hand") as HTMLElement | null)?.style.zIndex).toBe("40");
  });
  it("a card held up says what it is in words: its description always, and in its picture's place when that is missing", () => {
    open({ inspector: { ...INSPECTOR, held: true } });
    const dialog = $(".inspector.from-hand");
    const text = $(`#${dialog?.getAttribute("aria-describedby") ?? "none"}`);
    expect(text?.textContent).toContain("Meloku the Clouded Mirror");
    expect(text?.textContent).toContain("Create a 1/1 blue Illusion");
    expect(text?.classList.contains("sr")).toBe(true); // the picture is there: the words are read, not shown
    open({ inspector: { ...INSPECTOR, held: true, image: null } });
    expect($(".inspector.from-hand .held-text")?.classList.contains("sr")).toBe(false);
    expect($(".inspector.from-hand .held-text h3")?.textContent).toBe("Meloku the Clouded Mirror");
  });
  it("no plays: no action list", () => {
    open({ inspector: { ...INSPECTOR, actions: [] } });
    expect($(".l-actions")).toBeNull();
  });
  it("a press that starts on the scrim and ends there dismisses; one that began elsewhere (a tap on the table) does not", () => {
    open();
    const scrim = $(".scrim")!;
    scrim.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); // the tap's late click
    expect(sent).toEqual([]);
    tapOn($(".inspector h3")!, scrim); // pressed inside the leaf, let go outside
    expect(sent).toEqual([]);
    tapOn(scrim);
    expect(orders()).toEqual([{ t: "dismiss" }]);
  });
});

describe("the mulligan", () => {
  const open = () => show({ controls: controls(MULLIGAN_PROMPT), layers: [{ layer: "mulligan", restore: null }], mulligan: MULLIGAN, hand: { cards: HAND, away: true, respond: false, carried: [], fresh: [] } });
  it("the hand over the dimmed table with play's buttons; the prompt bar is not drawn", () => {
    open();
    expect($(".l-mull h2")?.textContent).toBe("Keep this hand?");
    expect($$(".l-mull .cards button")).toHaveLength(7);
    expect(texts(".l-mull .l-buttons button")).toEqual(["Mulligan", "Keep 7"]);
    expect($$(".l-mull .l-buttons button").map((b) => b.className)).toEqual(["", "act"]);
    expect($(".l-prompt")).toBeNull();
  });
  it("Keep presses play's button; a card opens the inspector", () => {
    open();
    click($$(".l-mull .l-buttons button")[1]!);
    click($$(".l-mull .cards button")[2]!);
    expect(orders()).toEqual([{ act: { a: "press", button: "keep" } }, { t: "open", layer: "inspector", card: 122 }]);
  });
  it("set aside: no overlay, a chip that brings it back", () => {
    show({ controls: controls(MULLIGAN_PROMPT), chips: [{ layer: "mulligan", label: "Your opening hand" }] });
    expect($(".l-mull")).toBeNull();
    expect($(".l-prompt")).toBeNull();
    click($(".l-chips .l-stackchip"));
    expect(orders()).toEqual([{ t: "restore", layer: "mulligan" }]);
  });
});

describe("the Game menu", () => {
  it("the Game button opens it; it lists every seat's deck and how mana is paid", () => {
    show({});
    click($(".l-menu"));
    expect(orders()).toEqual([{ t: "open", layer: "menu", card: null }]);
    show({ layers: [{ layer: "menu", restore: "menu" }], menu: MENU });
    expect($(".l-sheet h3")?.textContent).toBe("New game");
    expect($$(".l-sheet select")).toHaveLength(5);
    expect(texts(".l-field span")).toEqual(["Your deck", "Left (Jev)", "Across (Jev)", "Right (Jev)", "Paying mana"]);
  });
  it("Start asks for the game chosen, starting from the last one asked for", () => {
    const last = { deck: "dack-cedh", opponents: ["eternities-assimilation-iii", "dack-cedh", "blue-moon-combat-revision"], mana: "auto" as const };
    show({ layers: [{ layer: "menu", restore: null }], menu: { ...MENU, last } });
    const across = $$(".l-sheet select")[2] as HTMLSelectElement;
    across.value = "eternities-living-worlds-iii"; // the player's change, kept in the form until Start
    show({ commit: 2, layers: [{ layer: "menu", restore: null }], menu: { ...MENU, last } });
    click($(".l-sheet .l-done"));
    expect(orders()).toEqual([{ t: "newGame", req: { deck: "dack-cedh", opponents: ["eternities-assimilation-iii", "eternities-living-worlds-iii", "blue-moon-combat-revision"], mana: "auto" } }]);
  });
  it("while the decks are listed, and when listing them failed, Start is disabled and says why", () => {
    show({ layers: [{ layer: "menu", restore: null }], menu: { decks: null, error: null, last: null } });
    expect($(".l-sheet .l-note")?.textContent).toBe("Listing the decks…");
    expect(($(".l-sheet .l-done") as HTMLButtonElement).disabled).toBe(true);
    show({ layers: [{ layer: "menu", restore: null }], menu: { decks: [], error: "HTTP 500", last: null } });
    expect($(".l-sheet .l-note")?.textContent).toBe("Couldn't list the decks: HTTP 500");
  });
  it("no game: the waiting line and New game; a game over: New game beside the prompt's words", () => {
    show({ waiting: "No game yet", newGame: true });
    expect(texts(".l-buttons button")).toEqual(["New game"]);
    click($(".l-buttons button"));
    show({ waiting: "Shuffling up…", newGame: false });
    expect($(".l-buttons")).toBeNull();
    show({ controls: controls({ ...MAIN, headline: "Game over", hint: null, buttons: [] }), newGame: true });
    expect(texts(".l-prompt .l-buttons button")).toEqual(["New game"]);
    expect(orders()).toEqual([{ t: "open", layer: "menu", card: null }]);
  });
});

describe("the nameplates", () => {
  const PLATE = {
    seat: "Atraxa",
    group: "plate:Atraxa",
    name: "Atraxa",
    life: 32,
    place: "across" as const,
    mine: false,
    active: false,
    ring: "option" as const,
    out: false,
    x: 500,
    y: 6,
    icons: [{ kind: "hand" as const, figure: "5" }],
  };
  const plates = () => $(".l-plates") as HTMLElement | null;
  it("a tap on a plate is the tap on its plate's hit group", () => {
    show({ plates: [PLATE] });
    expect(plates()?.inert).toBe(false);
    click($(".l-plate"));
    expect(orders()).toEqual([{ act: { a: "tap", on: { group: "plate:Atraxa", members: [] } } }]);
  });
  it("are inert under a modal layer of another kind: a plate never answers through the Game menu", () => {
    show({ plates: [PLATE], layers: [{ layer: "menu", restore: "menu" }], menu: MENU });
    expect(plates()?.inert).toBe(true);
    show({ plates: [PLATE], layers: [{ layer: "inspector", restore: null }], inspector: INSPECTOR });
    expect(plates()?.inert).toBe(true);
  });
  it("stay live over the nameplate focus: another plate is the way to another seat", () => {
    const focus = { seat: "Dack", name: "Dack", life: 31, place: "right" as const, mine: false, lines: [], graveyard: [], exile: [], hand: [], handCount: 4, library: 60, also: null };
    show({ plates: [PLATE], layers: [{ layer: "seat", restore: "plate:Dack" }], seatFocus: focus });
    expect(plates()?.inert).toBe(false);
  });
  it("a nameplate focus's graveyard and exile open in full, from their headings or from the cards past those shown", () => {
    const yard = Array.from({ length: 8 }, (_, i) => ({ id: (400 + i) as CardId, name: `Card ${i}`, image: null }));
    const focus = { seat: "Dack", name: "Dack", life: 31, place: "right" as const, mine: false, lines: [], graveyard: yard, exile: [], hand: [], handCount: 4, library: 60, also: null };
    show({ layers: [{ layer: "seat", restore: "plate:Dack" }], seatFocus: focus });
    expect($$(".l-seat .l-zone-open")).toHaveLength(1); // an empty exile has nothing to open
    click($(".l-seat .l-zone-open"));
    click($(".l-seat .l-more"));
    expect($(".l-seat .l-more")?.textContent).toBe("3 more");
    expect(orders()).toEqual([
      { t: "zone", seat: "Dack", zone: "graveyard" },
      { t: "zone", seat: "Dack", zone: "graveyard" },
    ]);
  });
});

describe("the hand as a list", () => {
  it("has no View hand button: looking at the hand is a focus, opened by tapping one of my cards", () => {
    show({});
    expect($(".l-hand-view")).toBeNull();
  });
  it("lists each card with its cost and whether it has a play; a card opens the inspector; Hold while auto-pass runs", () => {
    show({ controls: controls(THREAT), layers: [{ layer: "hand", restore: "hand" }], handSheet: HAND_SHEET });
    expect($(".l-sheet h3")?.textContent).toBe("Your hand");
    expect($$(".l-sheet .l-opt")).toHaveLength(7);
    expect($$(".l-sheet .l-opt.l-read")).toHaveLength(4);
    expect($$(".l-sheet .l-opt")[1]?.querySelector("b")?.textContent).toBe("Snap 1U");
    expect($$(".l-sheet .l-opt")[6]?.querySelector("small")?.textContent).toBe("Last added");
    click($(".l-hand-pass button"));
    click($$(".l-sheet .l-opt")[3]!);
    expect(orders()).toEqual([{ act: { a: "press", button: "hold" } }, { t: "open", layer: "inspector", card: 123 }]);
  });
});

describe("the hold countdown over the layers that cover the prompt", () => {
  /** The bar's fill, as its transform says. */
  const bar = (): number | null => {
    const st = $(".l-hand-pass .l-auto-bar")?.getAttribute("style");
    return st ? Number(/scaleX\(([\d.]+)\)/.exec(st)![1]) : null;
  };
  it("the hand's list and the inspector carry Hold with auto-pass's bar, filling as the prompt's does", () => {
    // THREAT: auto-pass runs from 0 for 3,200 ms.
    for (const more of [{ layers: [{ layer: "hand" as const, restore: "hand" }], handSheet: HAND_SHEET }, { layers: [{ layer: "inspector" as const, restore: null }], inspector: INSPECTOR }]) {
      r.show(view({ controls: controls(THREAT), ...more }), 800);
      expect(bar()).toBeCloseTo(0.25);
      expect($(".l-hand-pass button")?.classList.contains("auto")).toBe(true);
      r.show(view({ commit: 2, controls: controls(THREAT), ...more }), 2400);
      expect(bar()).toBeCloseTo(0.75);
      r.show(view({ commit: 3, controls: controls(THREAT), ...more }), 5000);
      expect(bar()).toBe(1);
    }
  });
  it("no countdown, no bar; a viewer who may not answer has no Hold at all", () => {
    show({ controls: controls({ ...THREAT, countdown: null }), layers: [{ layer: "hand", restore: "hand" }], handSheet: HAND_SHEET });
    expect($(".l-hand-pass button")).not.toBeNull();
    expect(bar()).toBeNull();
    show({ commit: 2, controls: controls(THREAT, { mayAnswer: false }), layers: [{ layer: "hand", restore: "hand" }], handSheet: HAND_SHEET });
    expect($(".l-hand-pass")).toBeNull();
  });
});

describe("the stack's rules and the fixtures", () => {
  it("the stack's rules: each item, top first, with its rules", () => {
    show({ controls: controls(THREAT, { sheet: STACK_SHEET }), layers: [{ layer: "stack", restore: null }, { layer: "sheet", restore: null }], stack: STACK_ROWS });
    expect($(".l-sheet h3")?.textContent).toBe("Stack rules · first to last");
    expect(texts(".l-rules > b")).toEqual(["Swords to Plowshares · Dack", "Phantasmal Image · You"]);
  });
  it("a chip restores its layer; the back bar goes back to the table", () => {
    show({ chips: [{ layer: "stack", label: "Stack 2" }], back: "Ana's side", layers: [{ layer: "lean", restore: null }] });
    expect(texts(".l-stackchip")).toEqual(["Stack 2"]);
    expect($(".l-back span")?.textContent).toBe("Ana's side");
    click($(".l-stackchip"));
    click($(".l-back button"));
    expect(orders()).toEqual([{ t: "restore", layer: "stack" }, { t: "dismiss" }]);
  });
});

describe("the layers in the focus stack's order", () => {
  it("each over the one below; everything under the top one is inert", () => {
    show({ controls: controls(MAIN, { sheet: OFFER }), layers: [{ layer: "sheet", restore: null }, { layer: "inspector", restore: null }], inspector: INSPECTOR });
    const sheet = $(".l-sheet")!, scrim = $(".scrim")!;
    expect(Number(scrim.style.zIndex)).toBeGreaterThan(Number(sheet.style.zIndex));
    expect(sheet.parentElement?.inert).toBe(true);
    expect(scrim.parentElement?.inert).toBe(false);
    expect(($(".l-base") as HTMLElement).inert).toBe(true);
    expect(($(".l-hand-host") as HTMLElement).inert).toBe(true);
  });
  it("play's sheet alone stays under the fan, which stays live over it; the prompt under it is inert", () => {
    show({ controls: controls(MAIN, { sheet: OFFER }), layers: [{ layer: "sheet", restore: null }] });
    expect($(".l-sheet")?.style.zIndex).toBe("40");
    expect(($(".l-hand-host") as HTMLElement).inert).toBe(false);
    expect(($(".l-base") as HTMLElement).inert).toBe(true);
  });
  it("nothing open: nothing inert", () => {
    show({});
    expect(($(".l-base") as HTMLElement).inert).toBe(false);
    expect(($(".l-hand-host") as HTMLElement).inert).toBe(false);
  });
  it("a layer that comes up takes keyboard focus; when it goes, focus returns to the control that opened it", () => {
    show({});
    $(".l-menu")!.focus();
    show({ commit: 2, layers: [{ layer: "menu", restore: "menu" }], menu: MENU });
    expect(document.activeElement?.closest("[data-layer]")?.getAttribute("data-layer")).toBe("menu");
    show({ commit: 3 });
    expect(document.activeElement).toBe($(".l-menu"));
  });
  it("a layer opened from another and closed back to it returns focus to the control in it that opened it", () => {
    const row = `l:${HAND_SHEET.cards[0]!.id}`;
    show({ layers: [{ layer: "hand", restore: "hand" }], handSheet: HAND_SHEET });
    const opener = $(`[data-fk="${row}"]`)!;
    opener.focus();
    show({ commit: 2, layers: [{ layer: "hand", restore: "hand" }, { layer: "inspector", restore: row }], handSheet: HAND_SHEET, inspector: INSPECTOR });
    expect(document.activeElement?.closest("[data-layer]")?.getAttribute("data-layer")).toBe("inspector");
    show({ commit: 3, layers: [{ layer: "hand", restore: "hand" }], handSheet: HAND_SHEET });
    expect(document.activeElement).toBe($(`[data-fk="${row}"]`));
  });
});
