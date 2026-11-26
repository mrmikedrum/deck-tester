// The table's own layers opened by a tap play leaves (live.js `H.tap`, h.js's tap): a pile, a well, a summary or a
// graveyard or exile with cards in it opens a sift of it (setting the stack aside); a seat's plate opens its nameplate
// focus, and a second tap closes it. A sift goes when its group is no longer on the table.
import { describe, expect, it } from "vitest";
import type { CardId } from "../../src/protocol";
import { seatId } from "../../src/model";
import { SIFT_PAGE, siftOf } from "../../src/layout";
import { describe as describeTable } from "../../src/scene/stage";
import * as play from "../../src/play";
import { envelope, rig } from "./rig";
import type { Rig } from "./rig";

type Json = Record<string, unknown>;
const island = (id: number): Json => ({ id, name: "Island", owner: "You", controller: "You", type: "Basic Land - Island" });
const BOLT = { id: 90, name: "Lightning Bolt", owner: "You", controller: "You", type: "Instant" };
const SWORDS = { id: 77, name: "Swords to Plowshares", owner: "Atraxa", controller: "Atraxa", type: "Instant", text: "Exile target creature." };
const spell = (id: number): Json => ({ id, source: SWORDS, controller: "Atraxa", spell: true, text: "Swords to Plowshares", targets: [] });

/** Five Islands on my battlefield, Lightning Bolt in my graveyard, a pass-only decision (every tap is the app's). */
function board(o: { v: number; islands?: number; graveyard?: Json[]; stack?: Json[] }): Json {
  const e = envelope({ v: o.v, decision: null }) as { view: Json & { players: Json[] }; decision: Json | null };
  e.view.players[0]!["battlefield"] = Array.from({ length: o.islands ?? 5 }, (_, i) => island(10 + i));
  e.view.players[0]!["graveyard"] = o.graveyard ?? [BOLT];
  e.view["stack"] = o.stack ?? [];
  e.decision = { id: o.v, kind: "play", turn: "T1 main1", prompt: "", repeat: false, options: ["pass"], refs: [{}], min: 1, max: 1 };
  return e;
}

function started(env: Json): Rig {
  const r = rig();
  r.loop.start();
  r.frame(0);
  r.transport.push(env);
  r.frame(10);
  r.frame(1300);
  expect(r.state.plan).not.toBeNull();
  r.now = 1300;
  return r;
}
const groups = (r: Rig) => r.state.plan!.hits.groups;
const tap = (r: Rig, g: { id: string; members: readonly CardId[] }): void => {
  r.send({ a: "tap", on: { group: g.id, members: g.members } });
  r.frame(r.now + 10);
  r.now += 10;
};
const layers = (r: Rig) => r.state.focus.layers.map((e) => [e.layer, e.group ?? e.seat ?? null]);
const islands = (r: Rig) => groups(r).find((g) => g.members.length > 1 && ["pile", "well", "summary"].includes(g.kind))!;

describe("a tap opens the table's layers", () => {
  it("a pile (a well, a summary) of more than one card opens its sift; a tap away puts it back", () => {
    const r = started(board({ v: 1 }));
    const g = islands(r);
    expect(g).toBeDefined();
    tap(r, g);
    expect(layers(r)).toEqual([["sift", g.id]]);
    expect(r.commits.at(-1)!.frame?.focus.table).toEqual([{ layer: "sift", seat: null, group: g.id }]);
    r.send({ a: "tap", on: { nothing: true } }); // nothing under the tap
    r.frame(r.now + 10);
    expect(layers(r)).toEqual([]);
  });

  it("a graveyard of 100 cards is sifted a page of 27 at a time, every card at least 44 px wide; its caption pages it", () => {
    const yard = Array.from({ length: 100 }, (_, i) => ({ id: 200 + i, name: `Card ${i}`, owner: "You", controller: "You", type: "Instant" }));
    const r = started(board({ v: 1, graveyard: yard }));
    const g = groups(r).find((x) => x.id === `zone:graveyard:${seatId("You")}`)!;
    tap(r, g);
    const sifted = () => {
      const f = r.commits.at(-1)!.frame!;
      const d = describeTable({ model: f.model, plan: f.plan, cues: f.cues, focus: f.focus, hover: null });
      return [...d.pieces.values()].filter((p) => p.draw.t === "sift");
    };
    expect(sifted()).toHaveLength(SIFT_PAGE);
    for (const pl of siftOf(r.state.viewport, Array.from({ length: SIFT_PAGE }, () => false))) expect(pl.rect.right - pl.rect.left).toBeGreaterThanOrEqual(44);
    const caption = () => r.commits.at(-1)!.view.sift!;
    expect(caption()).toMatchObject({ title: "Your graveyard ×100", page: 0, pages: 4, range: "1–27 of 100" });
    const page = (delta: number) => {
      r.inputs.push({ t: "siftPage", stamp: { at: r.now, commit: r.state.commit }, group: g.id, delta });
      r.frame((r.now += 10));
    };
    page(1);
    expect(caption().range).toBe("28–54 of 100");
    expect(sifted().map((p) => p.face)).toEqual(yard.slice(27, 54).map((c) => c.id));
    page(5);
    expect(caption()).toMatchObject({ page: 3, range: "82–100 of 100" });
    expect(sifted()).toHaveLength(19);
    page(-9);
    expect(caption().page).toBe(0);
    // A small pile has no pager.
    const small = started(board({ v: 1 }));
    tap(small, islands(small));
    expect(small.commits.at(-1)!.view.sift).toMatchObject({ title: "Island ×5", pages: 1, range: null });
  });

  it("with a sift on top a tap on another pile does not open a second: it is the tap away", () => {
    const r = started(board({ v: 1 }));
    tap(r, islands(r));
    r.send({ a: "tap", on: { nothing: true } });
    r.frame(r.now + 10);
    expect(layers(r)).toEqual([]);
  });

  it("a graveyard with cards in it opens its sift; an empty one does not", () => {
    const r = started(board({ v: 1 }));
    const me = seatId("You");
    const yard = groups(r).find((g) => g.id === `zone:graveyard:${me}`)!;
    tap(r, yard);
    expect(layers(r)).toEqual([["sift", yard.id]]);
    const empty = started(board({ v: 1, graveyard: [] }));
    tap(empty, groups(empty).find((g) => g.id === `zone:graveyard:${me}`) ?? { id: `zone:graveyard:${me}`, members: [] });
    expect(layers(empty)).toEqual([]);
  });

  it("a sift sets the stack aside first", () => {
    const r = started(board({ v: 1, stack: [spell(1)] }));
    expect(layers(r)).toEqual([["stack", null]]);
    tap(r, islands(r));
    expect(layers(r)).toEqual([["sift", islands(r).id]]);
    expect(r.state.focus.aside.map((e) => e.layer)).toEqual(["stack"]);
  });

  it("a sifted card is the card itself: the inspector opens on it over the sift", () => {
    const r = started(board({ v: 1 }));
    const g = islands(r);
    tap(r, g);
    r.send({ a: "tap", on: { card: g.members[1]! } });
    r.frame(r.now + 10);
    expect(layers(r)).toEqual([["sift", g.id], ["inspector", null]]);
    expect(r.state.focus.layers[1]?.card).toBe(g.members[1]);
  });

  it("a seat's plate opens its nameplate focus; a second tap on it closes it; my own plate opens mine", () => {
    const r = started(board({ v: 1 }));
    const atraxa = seatId("Atraxa");
    const plate = groups(r).find((g) => g.id === `plate:${atraxa}`)!;
    tap(r, plate);
    expect(layers(r)).toEqual([["seat", atraxa]]);
    // The table under it is shaded as under a sheet; nothing on the table leans in.
    expect(r.commits.at(-1)!.frame?.focus.table).toEqual([]);
    expect(r.commits.at(-1)!.frame?.focus.layer).toBe("sheet");
    tap(r, plate);
    expect(layers(r)).toEqual([]);
    tap(r, groups(r).find((g) => g.id === `plate:${seatId("You")}`)!);
    expect(layers(r)).toEqual([["seat", seatId("You")]]);
  });

  it("a nameplate's zone opens in full: the nameplate closes, its sift opens, and keyboard focus returns to the plate", () => {
    const r = started(board({ v: 1, graveyard: Array.from({ length: 9 }, (_, i) => ({ id: 300 + i, name: `Card ${i}`, owner: "You", controller: "You", type: "Instant" })) }));
    const me = seatId("You");
    tap(r, groups(r).find((g) => g.id === `plate:${me}`)!);
    expect(layers(r)).toEqual([["seat", me]]);
    expect(r.commits.at(-1)!.view.seatFocus?.graveyard).toHaveLength(9);
    r.inputs.push({ t: "zone", stamp: { at: r.now, commit: r.state.commit }, seat: String(me), zone: "graveyard" });
    r.frame(r.now + 10);
    expect(layers(r)).toEqual([["sift", `zone:graveyard:${me}`]]);
    expect(r.state.focus.layers[0]?.restore).toBe(`plate:${me}`);
    expect(r.commits.at(-1)!.view.sift?.title).toBe("Your graveyard ×9");
    // An empty zone has nothing to open.
    r.inputs.push({ t: "dismiss", stamp: { at: r.now, commit: r.state.commit } });
    r.frame(r.now + 10);
    r.inputs.push({ t: "zone", stamp: { at: r.now, commit: r.state.commit }, seat: String(me), zone: "exile" });
    r.frame(r.now + 10);
    expect(layers(r)).toEqual([]);
  });

  it("a sift goes when its group leaves the table", () => {
    const r = started(board({ v: 1 }));
    tap(r, islands(r));
    expect(layers(r).map((l) => l[0])).toEqual(["sift"]);
    r.transport.push(board({ v: 2, islands: 0 }));
    r.frame(r.now + 10);
    expect(layers(r)).toEqual([]);
  });

  const yardOf = (n: number, from = 200): Json[] => Array.from({ length: n }, (_, i) => ({ id: from + i, name: `Card ${i}`, owner: "You", controller: "You", type: "Instant" }));
  const yardGroup = (r: Rig) => groups(r).find((x) => x.id === `zone:graveyard:${seatId("You")}`)!;
  const pageBy = (r: Rig, group: string, delta: number): void => {
    r.inputs.push({ t: "siftPage", stamp: { at: r.now, commit: r.state.commit }, group, delta });
    r.frame((r.now += 10));
  };

  it("a spell that takes the table over a sift takes its caption with it: its pager and Put back are not there to press", () => {
    const r = started(board({ v: 1, graveyard: yardOf(100) }));
    const g = yardGroup(r);
    tap(r, g);
    expect(r.commits.at(-1)!.view.sift).toMatchObject({ title: "Your graveyard ×100", page: 0 });
    r.transport.push(board({ v: 2, graveyard: yardOf(100), stack: [spell(1)] }));
    r.frame((r.now += 10));
    // The stack is the table's top layer: the scene draws the stack, not the sift, and the chrome shows no caption.
    expect(r.commits.at(-1)!.frame?.focus.table?.at(-1)?.layer).toBe("stack");
    expect(r.commits.at(-1)!.view.sift).toBeNull();
    // A pager pressed for the sift the stack now covers turns nothing.
    pageBy(r, g.id, 1);
    expect(r.state.focus.layers.find((e) => e.layer === "sift")?.page).toBe(0);
    // Set aside, the stack gives the table back to the sift, caption and all.
    r.inputs.push({ t: "dismiss", stamp: { at: r.now, commit: r.state.commit } });
    r.frame((r.now += 10));
    expect(r.commits.at(-1)!.view.sift).toMatchObject({ title: "Your graveyard ×100", page: 0 });
  });

  it("a sift whose pile shrinks between two presses pages back from the page it shows", () => {
    const r = started(board({ v: 1, graveyard: yardOf(100) }));
    const g = yardGroup(r);
    tap(r, g);
    pageBy(r, g.id, 3);
    expect(r.commits.at(-1)!.view.sift).toMatchObject({ page: 3, range: "82–100 of 100" });
    // The graveyard shrinks to 60 cards: three pages, the last shown.
    r.transport.push(board({ v: 2, graveyard: yardOf(60) }));
    r.frame((r.now += 10));
    expect(r.commits.at(-1)!.view.sift).toMatchObject({ page: 2, range: "55–60 of 60" });
    pageBy(r, g.id, -1);
    expect(r.commits.at(-1)!.view.sift).toMatchObject({ page: 1, range: "28–54 of 60" });
  });
});

// A sift play opened for a gesture (a tap on a well of Islands, one of them another player's, while paying) lives as long
// as the gesture waits on it: a new decision closes it with the gesture; put away, it lets the gesture go.
describe("a chooser for a gesture", () => {
  /** Five Islands, the last owned by Atraxa (not a twin of the others), and a payment from them. */
  function paying(v: number, decision?: Json): Json {
    const e = board({ v }) as { view: { players: Json[] }; decision: Json };
    const bf = e.view.players[0]!["battlefield"] as Json[];
    bf[4] = { ...bf[4], owner: "Atraxa" };
    e.decision = decision ?? { id: v, kind: "pay", turn: "T1 main1", prompt: "mana to pay {U}", repeat: false, options: bf.map(() => "Island (U)"), refs: bf.map((c) => ({ card: c["id"] })), min: 0, max: 1 };
    return e;
  }
  const choosing = (r: Rig) => play.present(r.state.play).controls.choosing?.group ?? null;
  const opened = () => {
    const r = started(paying(1));
    const g = islands(r);
    tap(r, g);
    expect(layers(r)).toEqual([["sift", g.id]]);
    expect(choosing(r)).toBe(g.id);
    return { r, g };
  };

  it("its cards are named for the keyboard with what sets them apart (whose, tapped, counters, what is attached)", () => {
    const { r } = opened();
    expect(r.commits.at(-1)!.view.sift!.cards.map((c) => c.label)).toEqual(["Island", "Island", "Island", "Island", "Island, owned by Atraxa"]);
  });

  it("a new decision closes it, and the gesture goes with it", () => {
    const { r, g } = opened();
    const exile = paying(2, { id: 2, kind: "targets", turn: "T1 main1", prompt: "Exile target land", repeat: false, options: ["Island", "Island"], refs: [{ card: 10 }, { card: 11 }], min: 1, max: 1 });
    r.transport.push(exile);
    r.frame((r.now += 10));
    r.frame((r.now += 1300));
    expect(layers(r).filter(([l]) => l === "sift")).toEqual([]);
    expect(choosing(r)).toBeNull();
    expect(groups(r).some((x) => x.id === g.id)).toBe(true);
  });

  /** Two Grizzly Bears of mine, one owned by Atraxa (not twins), in one pile; they may attack Atraxa or Dack. */
  function bears(v: number, ids = [20, 21]): Json {
    const e = board({ v, islands: 0 }) as { view: { players: Json[] }; decision: Json };
    const bear = (id: number, owner: string): Json => ({ id, name: "Grizzly Bears", owner, controller: "You", type: "Creature - Bear", power: 2, toughness: 2 });
    e.view.players[0]!["battlefield"] = ids.map((id) => bear(id, id === 21 ? "Atraxa" : "You"));
    const refs = [20, 21].flatMap((card) => ["Atraxa", "Dack"].map((to) => ({ card, to })));
    e.decision = { id: 1, kind: "attack", turn: "T1 main1", prompt: "attackers", repeat: false, options: refs.map(() => "attack"), refs, min: 0, max: 4 };
    return e;
  }

  it("a tap on a card in the chooser, let go after a snapshot removed that card, is refused: nothing attacks", () => {
    const r = started(bears(1));
    const g = groups(r).find((x) => x.members.length > 1)!;
    r.send({ a: "drag", from: { group: g.id, members: g.members }, onto: { seat: seatId("Dack") } });
    r.frame((r.now += 10));
    // the tap on Bear 21 goes down in the sift: its stop and chooser are those on screen now
    const c = play.present(r.state.play).controls, stop = c.stop, rev = c.choosing!.rev;
    // the same decision, Bear 21 gone, arrives before the tap is let go
    r.transport.push(bears(2, [20]));
    r.frame((r.now += 10));
    r.frame((r.now += 1300));
    expect(choosing(r)).toBeNull();
    r.send({ a: "tap", on: { card: 21 as CardId, chooser: rev } }, stop);
    r.frame((r.now += 10));
    expect(play.present(r.state.play).board.combat).toBeNull();
    // and without the chooser's word, a card no longer on the table is no candidate either
    r.send({ a: "tap", on: { card: 21 as CardId } }, stop);
    r.frame((r.now += 10));
    expect(play.present(r.state.play).board.combat).toBeNull();
  });

  it("put away (Escape), it lets the gesture go: a later tap on one of its cards is that tap alone", () => {
    const r = started(bears(1));
    const g = groups(r).find((x) => x.members.length > 1)!;
    expect(g.members).toEqual([20, 21]);
    r.send({ a: "drag", from: { group: g.id, members: g.members }, onto: { seat: seatId("Dack") } });
    r.frame((r.now += 10));
    expect(choosing(r)).toBe(g.id);
    r.inputs.push({ t: "dismiss", stamp: { at: r.now, commit: r.state.commit } });
    r.frame((r.now += 10));
    expect(layers(r)).toEqual([]);
    expect(choosing(r)).toBeNull();
    // a tap on bear 21 (as from a sift opened again): it attacks the first opponent, not Dack
    r.send({ a: "tap", on: { card: 21 as CardId } });
    r.frame((r.now += 10));
    expect(play.present(r.state.play).board.combat?.attacks).toEqual([{ attacker: 21, defender: { seat: seatId("Atraxa") } }]);
  });
});
