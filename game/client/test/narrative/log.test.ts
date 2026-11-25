// @vitest-environment happy-dom
// The log as the chrome draws it (chrome/log.tsx) from the narrative's views: the strip at the top left with the turn
// and the newest lines, the full log turn by turn, the loss notice and the loss report; and the views from a real game.
import { h, render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LogSheet, LogStrip, LossRecap, LossSheet, StackSummary } from "../../src/chrome/log";
import { promptOf } from "../../src/play/prompt";
import { open } from "../../src/play/state";
import { Table } from "../play/rig";
import { diff, modelOf } from "../../src/model";
import type { TableModel } from "../../src/model";
import * as narrative from "../../src/narrative";
import type { LogSheetView, LogStripView } from "../../src/narrative";
import { catalog, corpusRuns, corpusSnapshot, viewerOf } from "../model/fixtures";

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = `<div id="ui"></div>`;
  root = document.getElementById("ui")!;
});
afterEach(() => render(null, root));

const $ = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const texts = (sel: string): string[] => $$(sel).map((e) => e.textContent ?? "");

const STRIP: LogStripView = {
  heading: "Turn 9 · You",
  lines: [
    { text: "Atraxa put a +1/+1 counter on Serra Angel", draw: false },
    { text: "Drew Island", draw: true },
  ],
  tone: "recent",
};

describe("the strip", () => {
  it("shows the turn and the two newest lines; a tap opens the log", () => {
    let opened = 0;
    render(h(LogStrip, { view: STRIP, onOpen: () => opened++ }), root);
    const strip = $(".l-feed")!;
    expect(strip.tagName).toBe("BUTTON");
    expect(strip.getAttribute("aria-label")).toBe("What happened");
    expect($(".l-feed-turn")?.textContent).toBe("Turn 9 · You");
    expect($(".l-feed-events")?.className).toBe("l-feed-events recent");
    expect(texts(".l-feed-event")).toEqual(["Atraxa put a +1/+1 counter on Serra Angel", "Drew Island"]);
    expect($$(".l-feed-event").map((e) => e.classList.contains("l-feed-draw"))).toEqual([false, true]);
    strip.click();
    expect(opened).toBe(1);
  });

  it("a summary is marked as one; mana symbols are pips; no lines, just the turn", () => {
    render(
      h(LogStrip, {
        view: { heading: "Turn 3 · Atraxa", lines: [{ text: "Add {G}{G}", draw: false }], tone: "summary" },
        onOpen: () => {},
      }),
      root,
    );
    expect($(".l-feed-events")?.className).toBe("l-feed-events summary");
    expect($$(".l-feed-event .pip").map((p) => p.getAttribute("aria-label"))).toEqual(["G", "G"]);
    render(h(LogStrip, { view: { heading: "Turn 3 · Atraxa", lines: [], tone: "one" }, onOpen: () => {} }), root);
    expect($(".l-feed-events")).toBeNull();
    expect($(".l-feed-turn")?.textContent).toBe("Turn 3 · Atraxa");
  });

  it("is hidden before a turn has begun", () => {
    render(h(LogStrip, { view: { heading: "", lines: [], tone: "one" }, onOpen: () => {} }), root);
    expect($(".l-feed")).toBeNull();
  });
});

const SHEET: LogSheetView = {
  groups: [
    {
      heading: { type: "turn", text: "Turn 9 · You" },
      rows: [
        { type: "result", text: "Serra Angel went to the graveyard" },
        { type: "combat", text: "Atraxa assigned Serra Angel to attack You." },
      ],
    },
    { heading: { type: "turn", text: "Turn 8 · Dack" }, rows: [{ type: "land", text: "Dack played Island" }] },
  ],
  losses: "Your losses · 1 to the graveyard",
};

describe("the log sheet", () => {
  it("each turn's heading over its lines, newest first, each row classed by its type", () => {
    let closed = 0,
      losses = 0;
    render(h(LogSheet, { view: SHEET, onClose: () => closed++, onLosses: () => losses++ }), root);
    expect($("h3")?.textContent).toBe("What happened");
    expect($(".l-sheet")?.className).toBe("l-sheet wide");
    expect($$(".l-log-turn").map((g) => [...g.children].map((r) => `${r.className}: ${r.textContent}`))).toEqual([
      [
        "t-turn: Turn 9 · You",
        "t-result: Serra Angel went to the graveyard",
        "t-combat: Atraxa assigned Serra Angel to attack You.",
      ],
      ["t-turn: Turn 8 · Dack", "t-land: Dack played Island"],
    ]);
    $(".l-history-losses")!.click();
    expect(losses).toBe(1);
    $(".g-close")!.click();
    $(".l-sheet")!.click(); // the scrim
    $(".l-box")!.click(); // inside the box: nothing
    expect(closed).toBe(2);
  });

  it("nothing yet, and no losses button without losses", () => {
    render(h(LogSheet, { view: { groups: [], losses: null }, onClose: () => {}, onLosses: () => {} }), root);
    expect($(".l-log")?.textContent).toBe("Nothing yet");
    expect($(".l-history-losses")).toBeNull();
  });
});

describe("the loss notice and report", () => {
  it("the notice names the loss, opens the report and can be dismissed", () => {
    let opened = 0,
      dismissed = 0;
    render(
      h(LossRecap, {
        view: { title: "Your loss", summary: "Thorn of the Black Rose · to exile" },
        onOpen: () => opened++,
        onDismiss: () => dismissed++,
      }),
      root,
    );
    expect(texts(".l-lost > *")).toEqual(["Your loss", "Thorn of the Black Rose · to exile", "View loss report ›"]);
    $(".l-lost")!.click();
    $(".l-recap .g-close")!.click();
    expect([opened, dismissed]).toEqual([1, 1]);
    expect($(".l-recap .g-close")?.getAttribute("aria-label")).toBe("Dismiss loss notice");
  });

  it("the report: each card, where it went, and why", () => {
    render(
      h(LossSheet, {
        rows: [
          { name: "Soldier Token", fate: "(token) left play", why: null },
          {
            name: "Thorn of the Black Rose",
            fate: "went to exile",
            why: "Swords to Plowshares - Exile Thorn of the Black Rose.",
          },
        ],
        onClose: () => {},
      }),
      root,
    );
    expect($("h3")?.textContent).toBe("What you lost");
    expect(texts(".l-log > div")).toEqual([
      "Soldier Token (token) left play",
      "Thorn of the Black Rose went to exileSwords to Plowshares - Exile Thorn of the Black Rose.",
    ]);
    expect($(".l-log small")?.textContent).toBe("Swords to Plowshares - Exile Thorn of the Black Rose.");
  });
});

describe("drawn from a real game", () => {
  it("the strip and the sheet after Atraxa's turn 3", () => {
    const run = corpusRuns().find((r) => r.includes("013-play-stack.json"))!;
    let s = narrative.initial,
      prev: TableModel | null = null,
      seq = 0;
    for (const n of run.slice(
      run.indexOf("009-play-commander-zone.json"),
      run.indexOf("033-block-attack-on-planeswalker-they-attack.json") + 1,
    )) {
      const m = modelOf(corpusSnapshot(n), catalog, viewerOf())!;
      s = narrative.release(narrative.narrate(s, diff(prev, m, ++seq), m), seq);
      prev = m;
    }
    render(h(LogStrip, { view: narrative.logStripView(s, prev), onOpen: () => {} }), root);
    expect($(".l-feed-turn")?.textContent).toBe("Turn 3 · Atraxa");
    expect(texts(".l-feed-event").length).toBe(1); // someone else's turn: one line
    render(h(LogSheet, { view: narrative.logSheetView(s), onClose: () => {}, onLosses: () => {} }), root);
    const headings = texts(".l-log-turn > .t-turn");
    expect(headings.slice(0, 2)).toEqual(["Turn 3 · Atraxa", "Turn 2 · You"]);
    expect($(".l-history-losses")?.textContent).toBe("Your losses · 1 to exile");
    render(h(LossRecap, { view: narrative.recapView(s)!, onOpen: () => {}, onDismiss: () => {} }), root);
    expect($(".l-lost small")?.textContent).toBe("Thorn of the Black Rose · to exile");
  });
});

describe("the stack summary", () => {
  it("a stack of three with a spell aimed at my creature, as the old prompt drew it", () => {
    const t = new Table();
    t.open("014-play-opponent-spell-targets-me-stack-targets-card.json");
    const rows = promptOf(open(t.state))!.stack;
    render(h(StackSummary, { rows, arriving: [69] }), root);
    expect($("ol")?.getAttribute("aria-label")).toBe("Stack in resolution order");
    expect(texts(".l-stackinfo li")).toEqual([
      "Arriving Doom Blade · DackAimed at Serra Angel. Destroy target nonblack creature.",
      "Pending threat Doom Blade · AtraxaAimed at your Grizzly Bears. Destroy target nonblack creature.",
      "Pending Thorn of the Black Rose · YouDeathtouch",
    ]);
    expect($$(".l-order").map((e) => e.classList.contains("aimed"))).toEqual([false, true, false]);
    render(h(StackSummary, { rows }), root);
    expect($(".l-order")?.textContent).toBe("Next if all pass");
    render(h(StackSummary, { rows: [] }), root);
    expect($(".l-stackinfo")).toBeNull();
  });
});
