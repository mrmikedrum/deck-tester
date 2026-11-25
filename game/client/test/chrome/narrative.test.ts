// @vitest-environment happy-dom
// The narrative's views drawn by the chrome: the log strip at the top left (it opens the log), the log and the loss
// report as focus layers, the loss notice set into the prompt, the stack summary in the context's place while the stack
// layer is up, and the prompt while the table moves (live.js `status`'s `watching`).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromeRenderer } from "../../src/chrome";
import type { ChromeIntent, ChromeRenderer, ChromeView } from "../../src/chrome";
import { LOG, LOG_SHEET, LOSSES, MAIN, NO_LOG, RECAP, THREAT, controls, view } from "../../src/chrome/workbench/samples";
import type { Button, PromptView } from "../../src/play";
import type { StackId } from "../../src/protocol";

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
const orders = () => sent.map((i) => (i.t === "act" ? { act: i.act } : { ...i, stamp: undefined, origin: undefined }));
const withPrompt = (p: Partial<PromptView>, base: PromptView = THREAT) => controls({ ...base, ...p });
const chrome = (): Element | null => root.querySelector(".dm-chrome");

describe("the log strip", () => {
  it("hidden before a turn; the turn and the newest line once there is one; a tap opens the log", () => {
    show({ log: NO_LOG });
    expect($(".l-feed")).toBeNull();
    show({ log: LOG });
    expect($(".l-feed-turn")?.textContent).toBe("Turn 9 · Dack");
    expect(texts(".l-feed-event")).toEqual(["Dack cast Swords to Plowshares targeting Herd Baloth"]);
    click($(".l-feed"));
    expect(orders()).toEqual([{ t: "open", layer: "log", card: null }]);
  });
  it("not drawn while the waiting prompt holds the screen", () => {
    show({ log: LOG, waiting: "No game yet" });
    expect($(".l-feed")).toBeNull();
  });
});

describe("the log and the loss report", () => {
  it("the log is a layer: turns newest first, its losses line opens the report, the stud dismisses", () => {
    show({ log: LOG, layers: [{ layer: "log", restore: "log" }], logSheet: LOG_SHEET });
    expect($('[data-layer="log"] h3')?.textContent).toBe("What happened");
    expect(texts(".l-log-turn > .t-turn")).toEqual(["Turn 9 · Dack", "Turn 8 · You"]);
    expect(($(".l-base") as HTMLElement).inert).toBe(true);
    expect(root.ownerDocument.activeElement).toBe($('[data-layer="log"] [tabindex="-1"]'));
    click($(".l-history-losses"));
    click($('[data-layer="log"] .g-close'));
    expect(orders()).toEqual([{ t: "open", layer: "losses", card: null }, { t: "dismiss" }]);
  });
  it("the report over the log: each loss, where it went and why; the log under it is inert", () => {
    show({ layers: [{ layer: "log", restore: null }, { layer: "losses", restore: null }], logSheet: LOG_SHEET, losses: LOSSES });
    expect($('[data-layer="losses"] h3')?.textContent).toBe("What you lost");
    expect($('[data-layer="losses"] .l-log b')?.textContent).toBe("Herd Baloth");
    expect($('[data-layer="losses"] .l-log small')?.textContent).toBe("Swords to Plowshares exiled Herd Baloth");
    expect($('[data-layer="log"]')?.parentElement?.inert).toBe(true);
    expect($('[data-layer="losses"]')?.parentElement?.inert).toBe(false);
    expect(chrome()?.classList.contains("sheet-open")).toBe(true);
  });
});

describe("the prompt", () => {
  it("the loss notice above the buttons: it opens the report, its ✕ dismisses it", () => {
    show({ controls: controls(MAIN), recap: RECAP });
    const recap = $(".l-prompt .l-recap")!;
    expect(recap.nextElementSibling?.classList.contains("l-buttons")).toBe(true);
    expect($(".l-lost b")?.textContent).toBe("Your loss");
    expect($(".l-lost small")?.textContent).toBe("Herd Baloth · to exile");
    click($(".l-lost"));
    click($(".l-recap .g-close"));
    expect(orders()).toEqual([{ t: "open", layer: "losses", card: null }, { t: "dismissRecap" }]);
  });
  // Two on the stack: Arcane Denial over the Swords.
  const TWO = withPrompt({
    context: "Draw a card.",
    stack: [
      { item: 2 as StackId, n: 1, title: "Arcane Denial", at: "Swords to Plowshares", aimed: false },
      { item: 1 as StackId, n: 2, title: "Swords to Plowshares", at: "your Herd Baloth", aimed: true },
    ],
  });
  it("two or more on the stack: one numbered line each after the headline while the stack layer is up, in the context's place", () => {
    show({ controls: TWO, stackOpen: true });
    expect($(".l-what")?.nextElementSibling?.classList.contains("l-stackinfo")).toBe(true);
    expect(texts(".l-stackinfo li")).toEqual(["1 Arcane Denial → Swords to Plowshares", "2 Swords to Plowshares → your Herd Baloth"]);
    expect([...document.querySelectorAll(".l-stackinfo li")].map((li) => li.classList.contains("aimed"))).toEqual([false, true]);
    expect($(".l-ctx")).toBeNull();
  });
  it("the stack layer set aside: no summary, and the context shows again", () => {
    show({ controls: TWO, stackOpen: false });
    expect($(".l-stackinfo")).toBeNull();
    expect($(".l-ctx")?.textContent).toBe("Draw a card.");
  });
  it("on the way to the stack: its headline, the item arriving, no Choose a play, not asking, never red", () => {
    const choice: Button = { id: "choice", label: "All plays (2)", tone: "primary", role: "choice", enabled: true, detail: null, cost: null, countdown: false };
    const c = withPrompt({ buttons: [choice, ...THREAT.buttons], hint: "Highlights mark available plays." });
    show({ controls: c, stackOpen: true, watch: { headline: "", arriving: [1 as StackId], toStack: true, sweeping: true } });
    const p = $(".l-prompt")!;
    // The line it will ask with, so the words do not change as it lands.
    expect($(".l-what")?.textContent).toBe(THREAT.headline);
    expect(texts(".l-buttons button")).not.toContain("All plays (2)");
    expect(p.classList.contains("moving")).toBe(true);
    expect(p.classList.contains("asking")).toBe(false);
    expect(p.classList.contains("threat")).toBe(false);
    expect($(".l-ctx")).toBeNull();
    expect(chrome()?.classList.contains("watching")).toBe(true);
  });
  it("while the table moves with the stack empty: the motion's headline, no hint or context; red while Sunfall sweeps", () => {
    const c = withPrompt({ tone: "normal", hint: "Highlights mark available plays.", context: "Draw a card.", floating: "Floating {G}", stack: [] }, MAIN);
    show({ controls: c, watch: { headline: "Doom Blade resolves", arriving: [], toStack: false, sweeping: true } });
    expect($(".l-what")?.textContent).toBe("Doom Blade resolves");
    expect($(".l-ctx")?.textContent).toBe("Floating G");
    expect($(".l-prompt")?.classList.contains("threat")).toBe(true);
    show({ controls: c, watch: null });
    expect($(".l-prompt")?.classList.contains("threat")).toBe(false);
    expect($(".l-prompt")?.classList.contains("moving")).toBe(false);
    expect(chrome()?.classList.contains("watching")).toBe(false);
  });
});
