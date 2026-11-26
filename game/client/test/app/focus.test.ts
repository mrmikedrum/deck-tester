// The focus stack: one ordered stack of typed layers (app/focus.ts), and the app keeping it: play's inspector and sheet,
// the stack layer coming up and being set aside, the mulligan, the Game menu and its decks, and the default for a tap
// play leaves. The pure module first, then through the whole app on the scripted transport.
import { describe, expect, it } from "vitest";
import * as play from "../../src/play";
import type { CardId, StopId } from "../../src/protocol";
import { close, dismiss, entry, focusTopOf, NO_FOCUS_STATE, open, restore, setAside, sync } from "../../src/app/focus";
import type { FocusState } from "../../src/app/focus";
import type { InputMsg } from "../../src/app/msg";
import { CARDS_WAIT_MS } from "../../src/app/catalog";
import { envelope, rig } from "./rig";
import type { Rig } from "./rig";

const layers = (f: FocusState): string[] => f.layers.map((e) => e.layer);
const aside = (f: FocusState): string[] => f.aside.map((e) => e.layer);

describe("the focus stack", () => {
  it("a new layer goes on top of its tier: the table's (stack, lean, sift) always under the chrome's", () => {
    let f = open(NO_FOCUS_STATE, entry("inspector", { card: 7 as CardId }));
    f = open(f, entry("stack"));
    expect(layers(f)).toEqual(["stack", "inspector"]);
    f = open(f, entry("lean"));
    expect(layers(f)).toEqual(["stack", "lean", "inspector"]);
    f = open(f, entry("menu"));
    expect(layers(f)).toEqual(["stack", "lean", "inspector", "menu"]);
  });
  it("one of each layer: opening one again replaces it, set aside or open", () => {
    let f = open(NO_FOCUS_STATE, entry("inspector", { card: 1 as CardId }));
    f = open(f, entry("menu"));
    f = open(f, entry("inspector", { card: 2 as CardId }));
    expect(f.layers.map((e) => [e.layer, e.card])).toEqual([
      ["menu", null],
      ["inspector", 2],
    ]);
    f = setAside(open(f, entry("stack")), "stack");
    expect(aside(f)).toEqual(["stack"]);
    f = open(f, entry("stack"));
    expect(aside(f)).toEqual([]);
    expect(layers(f)).toEqual(["stack", "menu", "inspector"]);
  });
  it("dismissing: the top goes; the stack and the mulligan are set aside; play's sheet asks play", () => {
    let f = open(open(NO_FOCUS_STATE, entry("stack")), entry("inspector", { card: 3 as CardId }));
    let d = dismiss(f);
    expect([layers(d.focus), d.play]).toEqual([["stack"], false]);
    d = dismiss(d.focus);
    expect([layers(d.focus), aside(d.focus), d.play]).toEqual([[], ["stack"], false]);
    f = open(NO_FOCUS_STATE, entry("sheet"));
    d = dismiss(f);
    expect(d).toEqual({ focus: f, play: true });
    expect(dismiss(NO_FOCUS_STATE).play).toBe(true); // nothing open: play may have something of its own
    f = open(NO_FOCUS_STATE, entry("mulligan"));
    expect(aside(dismiss(f).focus)).toEqual(["mulligan"]);
  });
  it("a layer that may not be dismissed stays, and play is not asked", () => {
    const f = open(NO_FOCUS_STATE, entry("menu", { dismissible: false }));
    expect(dismiss(f)).toEqual({ focus: f, play: false });
  });
  it("a chip restores its layer on top of its tier; closing takes a layer from either list", () => {
    let f = setAside(open(open(NO_FOCUS_STATE, entry("stack")), entry("inspector")), "stack");
    f = restore(f, "stack");
    expect([layers(f), aside(f)]).toEqual([["stack", "inspector"], []]);
    expect(restore(f, "mulligan")).toBe(f);
    expect(layers(close(f, "stack"))).toEqual(["inspector"]);
  });
  it("sync: the sheet while play shows one, the mulligan while asked, the stack layer for every new stack", () => {
    let f = sync(NO_FOCUS_STATE, { sheet: true, mulligan: false, stack: "" }, "b:plays");
    expect(f.layers).toEqual([entry("sheet", { restore: "b:plays" })]);
    f = sync(f, { sheet: false, mulligan: true, stack: "1:9" }, null);
    expect(layers(f)).toEqual(["stack", "mulligan"]);
    f = dismiss(dismiss(f).focus).focus; // the mulligan, then the stack, set aside
    expect(aside(f)).toEqual(["mulligan", "stack"]);
    expect(sync(f, { sheet: false, mulligan: true, stack: "1:9" }, null)).toBe(f); // nothing new: they stay aside
    f = sync(f, { sheet: false, mulligan: true, stack: "1:9,2:4" }, null); // a new item brings the stack up again
    expect([layers(f), aside(f)]).toEqual([["stack"], ["mulligan"]]);
    f = sync(f, { sheet: false, mulligan: false, stack: "" }, null);
    expect([layers(f), aside(f), f.stackKey]).toEqual([[], [], ""]);
  });
  it("the scene is handed the top entry with its subject, and every table layer open under it, bottom first", () => {
    const lean = { layer: "lean", seat: "Ana", group: null };
    const f = open(open(NO_FOCUS_STATE, entry("lean", { seat: "Ana" as never })), entry("inspector", { card: 5 as CardId }));
    expect(focusTopOf(f)).toEqual({ layer: "inspector", seat: null, group: null, card: 5, table: [lean] });
    expect(focusTopOf(close(f, "inspector"))).toEqual({ layer: "lean", seat: "Ana", group: null, card: null, table: [lean] });
    expect(focusTopOf(NO_FOCUS_STATE)).toEqual({ layer: null, seat: null, group: null, card: null, table: [] });
    // The stack under a lean-in under a sheet: the table sees both, the stack first; a chrome layer is not a table one.
    const g = open(open(open(NO_FOCUS_STATE, entry("sheet")), entry("lean", { seat: "Ana" as never })), entry("stack"));
    expect(g.layers.map((e) => e.layer)).toEqual(["lean", "stack", "sheet"]);
    expect(focusTopOf(g).table).toEqual([lean, { layer: "stack", seat: null, group: null }]);
    expect(focusTopOf(open(NO_FOCUS_STATE, entry("sift", { group: "pile:x" }))).table).toEqual([{ layer: "sift", seat: null, group: "pile:x" }]);
  });
});

// ---- through the app ---------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const MELOKU = { id: 40, name: "Meloku the Clouded Mirror", owner: "You", controller: "You", type: "Legendary Creature - Moonfolk Wizard", power: 2, toughness: 4 };
const SWORDS = { id: 77, name: "Swords to Plowshares", owner: "Atraxa", controller: "Atraxa", type: "Instant", text: "Exile target creature." };

/** The rig's envelope with Meloku on my battlefield, a decision (default: pass, or activate Meloku), and a stack. */
function table(o: { v: number; gen?: number; decision?: Json | null; stack?: Json[] }): Json {
  const e = envelope({ v: o.v, gen: o.gen ?? 1, decision: null }) as { view: Json & { players: Json[] }; decision: Json | null };
  e.view.players[0]!["battlefield"] = [MELOKU];
  e.view["stack"] = o.stack ?? [];
  const d = o.decision === undefined ? { id: 1, kind: "play", options: ["pass", "Meloku the Clouded Mirror: {1}: Create a token."], refs: [{}, { card: 40 }], min: 1, max: 1 } : o.decision;
  e.decision = d ? { turn: "T1 main1", prompt: "", repeat: false, ...d } : null;
  return e;
}
const spell = (id: number): Json => ({ id, source: SWORDS, controller: "Atraxa", spell: true, text: "Swords to Plowshares", targets: [40] });

function started(env: Json): Rig {
  const r = rig();
  r.loop.start();
  r.frame(0);
  r.transport.push(env);
  r.frame(10);
  r.frame(1300); // past the wait for card data the fixtures' catalog lacks: the decision is offered
  expect(r.state.model).not.toBeNull();
  r.now = 1300;
  return r;
}
const groupOf = (r: Rig, card: number, kind?: string) => {
  const g = r.state.plan?.hits.groups.find((x) => x.members.includes(card as CardId) && (!kind || x.kind === kind));
  if (!g) throw new Error(`no group for ${card}`);
  return g;
};
const tapGroup = (r: Rig, card: number, kind?: string): void => {
  const g = groupOf(r, card, kind);
  r.send({ a: "tap", on: { group: g.id, members: g.members } });
};
type Unstamped = InputMsg extends infer M ? (M extends unknown ? Omit<M, "stamp"> : never) : never;
const input = (r: Rig, m: Unstamped): void => r.inputs.push({ ...m, stamp: { at: r.now, commit: r.state.commit } } as InputMsg);
const view = (r: Rig) => r.commits.at(-1)!.view;
const topLayer = (r: Rig) => r.state.focus.layers.at(-1)?.layer ?? null;

describe("the app's focus", () => {
  it("play's inspect opens the inspector with the card's plays; the answer it sends closes it", () => {
    const r = started(table({ v: 1 }));
    tapGroup(r, 40);
    r.frame(1320);
    expect(r.state.focus.layers).toEqual([expect.objectContaining({ layer: "inspector", card: 40 })]);
    expect(r.commits.at(-1)!.frame?.focus).toEqual({ layer: "inspector", seat: null, group: null, card: 40, table: [] });
    const v = view(r).inspector!;
    expect(v.name).toBe("Meloku the Clouded Mirror");
    expect(v.owner).toBe("You · Battlefield");
    expect(v.chips).toContain("2/4");
    expect(v.actions.map((a) => a.option)).toEqual([2]);
    r.send({ a: "pick", option: 2 });
    r.frame(1330);
    expect(r.transport.answers.map((a) => "answer" in a.body && a.body.answer)).toEqual([[2]]);
    expect(r.state.focus.layers).toEqual([]);
  });
  it("opened from a control, the layer remembers it: keyboard focus goes back there when it closes", () => {
    const r = started(table({ v: 1 }));
    input(r, { t: "open", layer: "inspector", card: 40 as CardId, origin: "h:5" });
    r.frame(1320);
    expect(view(r).layers).toEqual([{ layer: "inspector", restore: "h:5" }]);
    input(r, { t: "dismiss" });
    r.frame(1330);
    expect(view(r).layers).toEqual([]);
  });
  it("an Escape pressed before a sheet that just arrived was drawn leaves it open", () => {
    const r = started(table({ v: 1 }));
    expect(r.state.focus.layers).toEqual([]);
    const choose = { id: 2, kind: "choose", prompt: "Choose a word", options: ["Alpha", "Beta", "Gamma"], refs: [{}, {}, {}], min: 1, max: 1 };
    r.transport.push(table({ v: 2, decision: choose }));
    r.frame(1310); // held for its words' card data, until the wait runs out
    const due = r.state.gate.held!.since + CARDS_WAIT_MS;
    expect(topLayer(r)).toBeNull();
    // The sheet comes up as the wait runs out, and an Escape made just after, on the commit still on screen, is taken in
    // the same frame.
    r.inputs.push({ t: "dismiss", stamp: { at: due + 1, commit: r.state.commit } });
    r.frame(due + 5);
    expect(topLayer(r)).toBe("sheet");
    expect(view(r).controls.sheet).not.toBeNull();
    // Once it has been seen, Escape closes it.
    r.now = due + 5;
    input(r, { t: "dismiss" });
    r.frame(due + 20);
    expect(view(r).controls.sheet).toBeNull();
  });
  it("a tap play leaves on a card alone opens the inspector, with no plays when it has none", () => {
    const r = started(table({ v: 1, decision: { id: 1, kind: "play", options: ["pass"], refs: [{}], min: 1, max: 1 } }));
    tapGroup(r, 40);
    r.frame(1320);
    expect(topLayer(r)).toBe("inspector");
    expect(view(r).inspector?.actions).toEqual([]);
  });
  it("the stack comes up for a new spell; a tap outside sets it aside with a chip; a tap on it brings it back", () => {
    const r = started(table({ v: 1, decision: null, stack: [spell(1)] }));
    expect(topLayer(r)).toBe("stack");
    expect(r.commits.at(-1)!.frame?.focus.layer).toBe("stack");
    tapGroup(r, 40); // a tap on the table, not the inspector: the tap outside
    r.frame(1320);
    expect(r.state.focus.layers).toEqual([]);
    expect(view(r).chips).toEqual([{ layer: "stack", label: "Stack 1" }]);
    tapGroup(r, 77, "stack");
    r.frame(1330);
    expect(topLayer(r)).toBe("stack");
    expect(view(r).chips).toEqual([]);
  });
  it("a tap on the stack held up opens its card's inspector (the card is there to read)", () => {
    const r = started(table({ v: 1, decision: null, stack: [spell(1)] }));
    expect(topLayer(r)).toBe("stack");
    tapGroup(r, 77, "stack");
    r.frame(1320);
    expect(topLayer(r)).toBe("inspector");
    expect(r.state.focus.layers.map((e) => e.layer)).toContain("stack");
  });
  it("Escape sets the stack aside, its chip restores it, a new item brings it up again, and an empty stack ends it", () => {
    const r = started(table({ v: 1, decision: null, stack: [spell(1)] }));
    // held up, the stack floats over the table: the mats part only once it is set aside, to rest in the middle
    expect(r.state.plan!.part).toBe(0);
    input(r, { t: "dismiss" });
    r.frame(1320);
    expect(view(r).chips.map((c) => c.layer)).toEqual(["stack"]);
    expect(r.state.plan!.part).toBeGreaterThan(0);
    input(r, { t: "restore", layer: "stack" });
    r.frame(1330);
    expect(topLayer(r)).toBe("stack");
    expect(r.state.plan!.part).toBe(0);
    input(r, { t: "dismiss" });
    r.frame(1340);
    r.transport.push(table({ v: 2, decision: null, stack: [spell(1), { ...spell(2), source: { ...SWORDS, id: 78 } }] }));
    r.frame(1350);
    expect([topLayer(r), view(r).chips]).toEqual(["stack", []]);
    // (a new item brings it up again: planned held from the snapshot on, never parted for a frame first)
    expect(r.state.plan!.part).toBe(0);
    r.transport.push(table({ v: 3, decision: null, stack: [] }));
    r.frame(1360);
    expect([r.state.focus.layers, r.state.focus.aside]).toEqual([[], []]);
  });
  it("an Escape pressed before a new spell's stack was drawn leaves it up: the open stack it replaced was another", () => {
    const r = started(table({ v: 1, decision: null, stack: [spell(1)] }));
    expect(topLayer(r)).toBe("stack");
    r.frame(1310); // the stack with one spell is on screen
    // A second spell arrives with the stack still up; the Escape, made on the commit that showed one spell, is taken
    // after it in the same frame.
    r.transport.push(table({ v: 2, decision: null, stack: [spell(1), { ...spell(2), source: { ...SWORDS, id: 78 } }] }));
    r.inputs.push({ t: "dismiss", stamp: { at: 1315, commit: r.state.commit } });
    r.frame(1320);
    expect([topLayer(r), view(r).chips]).toEqual(["stack", []]);
    // Once it has been seen, Escape sets it aside.
    r.now = 1320;
    input(r, { t: "dismiss" });
    r.frame(1330);
    expect(view(r).chips.map((c) => c.layer)).toEqual(["stack"]);
  });
  it("play's sheet is a layer while play shows it; dismissing it asks play, which closes it", () => {
    const r = started(table({ v: 1, decision: { id: 1, kind: "play", options: ["pass", "Island", "Meloku the Clouded Mirror: {1}: Create a token."], refs: [{}, { card: 5 }, { card: 40 }], min: 1, max: 1 } }));
    r.send({ a: "press", button: "plays" });
    r.frame(1320);
    expect(topLayer(r)).toBe("sheet");
    expect(view(r).controls.sheet?.title).toBe("Everything you can play");
    input(r, { t: "dismiss" });
    r.frame(1330);
    expect(play.present(r.state.play).controls.sheet).toBeNull();
    expect(r.state.focus.layers).toEqual([]);
  });
  it("the mulligan is a layer while asked: Escape sets it aside, its chip brings it back, answered it goes", () => {
    const mull = { id: 1, kind: "mulligan", prompt: "Keep this hand?", options: ["Keep", "Mulligan"], refs: [{}, {}], min: 1, max: 1 };
    const r = started(table({ v: 1, decision: mull }));
    expect(topLayer(r)).toBe("mulligan");
    expect(view(r).mulligan).toEqual({ title: "Keep this hand?", cards: [{ id: 5, name: "Island", image: expect.anything() }] });
    expect(view(r).hand.away).toBe(true);
    input(r, { t: "dismiss" });
    r.frame(1320);
    expect([view(r).mulligan, view(r).chips]).toEqual([null, [{ layer: "mulligan", label: "Your opening hand" }]]);
    input(r, { t: "restore", layer: "mulligan" });
    r.frame(1330);
    r.send({ a: "press", button: "keep" });
    r.frame(1340);
    expect(r.transport.answers.map((a) => "answer" in a.body && a.body.answer)).toEqual([[1]]);
    expect(r.state.focus.layers).toEqual([]);
  });
  it("a new stop closes the inspector: its actions were for the decision before", () => {
    const r = started(table({ v: 1 }));
    tapGroup(r, 40);
    r.frame(1320);
    expect(topLayer(r)).toBe("inspector");
    r.transport.push(table({ v: 2, decision: { id: 2, kind: "play", options: ["pass"], refs: [{}], min: 1, max: 1 } }));
    r.frame(1330);
    expect(r.state.focus.layers).toEqual([]);
  });
});

describe("the Game menu", () => {
  it("with no game, New game is offered and the deck list is asked for ahead; the menu shows it", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push({ state: "no game", gen: null, v: 1, error: null, build: null, answer: null, view: null, decision: null, over: null, pilots: {} });
    r.frame(10);
    expect(view(r).newGame).toBe(true);
    expect(view(r).waiting).toBe("No game yet");
    expect(r.transport.deckRequests).toBe(1);
    r.transport.deckList(["a.txt", "b.txt"]);
    r.frame(1320);
    input(r, { t: "open", layer: "menu", card: null, origin: "new-game" });
    r.frame(1330);
    expect(view(r).menu).toEqual({ decks: ["a.txt", "b.txt"], error: null, last: null });
    expect(r.transport.deckRequests).toBe(1);
  });
  it("a failed list is not kept: opening the menu asks again", () => {
    const r = started(table({ v: 1 }));
    input(r, { t: "open", layer: "menu", card: null });
    r.frame(1320);
    expect(r.transport.deckRequests).toBe(1);
    expect(view(r).menu?.decks).toBeNull();
    r.transport.deckList(null, "HTTP 500");
    r.frame(1330);
    expect(view(r).menu).toEqual({ decks: [], error: "HTTP 500", last: null, inProgress: true });
    input(r, { t: "dismiss" });
    input(r, { t: "open", layer: "menu", card: null });
    r.frame(1340);
    expect(r.transport.deckRequests).toBe(2);
  });
  it("Start asks for the game, remembers it for next time, and closes every layer", () => {
    const r = started(table({ v: 1, stack: [spell(1)] }));
    input(r, { t: "open", layer: "menu", card: null });
    r.frame(1320);
    const req = { deck: "a.txt", opponents: ["b.txt", "b.txt", "a.txt"], mana: "always" as const };
    input(r, { t: "newGame", req });
    r.frame(1330);
    expect(r.transport.newGames).toEqual([req]);
    expect(r.state.session.lastGame).toEqual(req);
    expect([r.state.focus.layers, r.state.focus.aside]).toEqual([[], []]);
  });
  it("the game is over: New game is offered beside the prompt", () => {
    const over = table({ v: 1, decision: null });
    (over as { over: string | null }).over = "over: Atraxa won";
    const r = started(over);
    expect(view(r).newGame).toBe(true);
  });
});

describe("the hand as a list", () => {
  it("lists the hand; a card picked from it opens the inspector in its place", () => {
    const r = started(table({ v: 1, decision: { id: 1, kind: "play", options: ["pass", "Island"], refs: [{}, { card: 5 }], min: 1, max: 1 } }));
    input(r, { t: "open", layer: "hand", card: null, origin: "hand" });
    r.frame(1320);
    expect(view(r).handSheet).toEqual({ cards: [{ id: 5, name: "Island", cost: null, playable: true, fresh: false }] });
    input(r, { t: "open", layer: "inspector", card: 5 as CardId, origin: "l:5" });
    r.frame(1330);
    expect(r.state.focus.layers.map((e) => e.layer)).toEqual(["inspector"]);
    expect(view(r).inspector?.actions.map((a) => a.option)).toEqual([2]);
  });
  it("a stale stop's act opens nothing", () => {
    const r = started(table({ v: 1 }));
    const g = groupOf(r, 40);
    r.send({ a: "tap", on: { group: g.id, members: g.members } }, "0.0.0" as StopId);
    r.frame(1320);
    expect(r.state.focus.layers).toEqual([]);
  });
});
