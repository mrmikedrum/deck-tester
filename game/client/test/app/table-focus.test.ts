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

describe("the clash, a table layer", () => {
  const creature = (id: number, name: string, who: string, p = 2): Json => ({ id, name, owner: who, controller: who, type: "Creature - Soldier", power: p, toughness: 2 });
  /** Atraxa's two attack `at`; Dack's two stand by; Princess's one; a pass-only decision of mine. */
  /** Atraxa's Raider (40) and Brute (41) attack `at`; `blocks` [blocker, attacker]; Forge's verdict per attacker from
   *  the blocks unless `blocked` says otherwise; `ordinal`, Forge's combat in the turn. */
  function fight(o: { v: number; at: string | null; blocks?: [number, number][]; attackers?: number[]; phase?: string; guard?: boolean; blocked?: number[]; ordinal?: number }): Json {
    const e = board({ v: o.v, islands: 2 }) as { view: Json & { players: Json[] } };
    e.view.players[0]!["battlefield"] = [...(e.view.players[0]!["battlefield"] as Json[]), ...(o.guard === false ? [] : [creature(30, "Guard", "You")])];
    e.view.players[1]!["battlefield"] = [creature(40, "Raider", "Atraxa", 3), creature(41, "Brute", "Atraxa", 4)];
    e.view.players[2]!["battlefield"] = [creature(50, "Watcher", "Dack")];
    e.view["active"] = "Atraxa";
    e.view["phase"] = o.phase ?? "COMBAT_DECLARE_BLOCKERS";
    const blocked = o.blocked ?? (o.blocks ?? []).map(([, a]) => a);
    e.view["combat"] = o.at
      ? { ordinal: o.ordinal ?? 1, attackers: (o.attackers ?? [40, 41]).map((id) => ({ id, defender: o.at, blocked: blocked.includes(id) })), blockers: (o.blocks ?? []).map(([id, blocking]) => ({ id, blocking })), damage: [] }
      : null;
    return e;
  }
  const fighterOf = (r: Rig, card: number) => groups(r).find((g) => g.members.includes(card as CardId))!;

  it("comes up when I am attacked; a tap on the shade sets it aside behind a Combat chip; the chip raises it; it goes with the combat", () => {
    const r = started(fight({ v: 1, at: "You" }));
    expect(layers(r)).toEqual([["clash", null]]);
    expect(r.state.plan!.gathering!.focus).toBe(true);
    expect(r.commits.at(-1)!.view.clash!.plaques.map((p) => p.words)).toEqual(["Atraxa attacks You · 7 unblocked"]);
    // a tap on a fighter reads it (the inspector over the clash)
    tap(r, fighterOf(r, 40));
    expect(layers(r).at(-1)).toEqual(["inspector", null]);
    r.inputs.push({ t: "dismiss", stamp: { at: r.now, commit: r.state.commit } });
    r.frame((r.now += 10));
    // a tap off the fighters (my Islands, under the shade) sets it aside: the table form, the chip
    tap(r, islands(r));
    expect(layers(r)).toEqual([]);
    expect(r.state.focus.aside.map((e) => e.layer)).toEqual(["clash"]);
    expect(r.state.plan!.gathering!.form).toBe("table");
    expect(r.commits.at(-1)!.view.chips).toEqual([{ layer: "clash", label: "Combat" }]);
    // blocks declared in the same combat keep it aside
    r.transport.push(fight({ v: 2, at: "You", blocks: [[30, 40]] }));
    r.frame((r.now += 400));
    expect(layers(r)).toEqual([]);
    // the chip raises it again
    r.inputs.push({ t: "restore", layer: "clash", stamp: { at: r.now, commit: r.state.commit } });
    r.frame((r.now += 10));
    expect(layers(r)).toEqual([["clash", null]]);
    expect(r.state.plan!.gathering!.form).toBe("clash");
    // the combat ends: it goes, chip and all
    r.transport.push(fight({ v: 3, at: null }));
    r.frame((r.now += 400));
    expect(layers(r)).toEqual([]);
    expect(r.state.focus.aside).toEqual([]);
  });

  it("an attacker whose blocker left stays blocked by Forge's verdict: no brand, and its column keeps its place", () => {
    const r = started(fight({ v: 1, at: "You", blocks: [[30, 40]] }));
    const cols = () => r.state.plan!.gathering!.wings[0]!.columns;
    const order = cols().map((c) => c.attackers[0]);
    expect(cols().find((c) => c.attackers.includes(40 as CardId))!.slot).toBeNull();
    // the Guard dies: the engine's combat no longer lists it, and Forge still says the Raider is blocked
    const gone = fight({ v: 2, at: "You", blocked: [40] }) as { view: Json & { players: Json[] } };
    gone.view.players[0]!["battlefield"] = (gone.view.players[0]!["battlefield"] as Json[]).filter((c) => c["id"] !== 30);
    r.transport.push(gone);
    r.frame((r.now += 400));
    const raider = cols().find((c) => c.attackers.includes(40 as CardId))!;
    expect(raider.blocked).toBe(true);
    expect(raider.slot).toBeNull();
    expect(cols().map((c) => c.attackers[0])).toEqual(order);
    expect(r.commits.at(-1)!.view.clash!.plaques[0]!.words).toBe("Atraxa attacks You · 4 unblocked");
  });

  it("one combat, one memory: an attacker leaving combat as another loses its blocker leaves a clash set aside, aside", () => {
    const r = started(fight({ v: 1, at: "You", blocks: [[30, 40]] }));
    r.inputs.push({ t: "dismiss", stamp: { at: r.now, commit: r.state.commit } });
    r.frame((r.now += 10));
    expect(r.state.focus.aside.map((e) => e.layer)).toEqual(["clash"]);
    // the Brute leaves combat and the Guard dies: the Raider attacks alone, Forge still calls it blocked
    r.transport.push(fight({ v: 2, at: "You", attackers: [40], guard: false, blocked: [40] }));
    r.frame((r.now += 400));
    expect(layers(r)).toEqual([]);
    expect(r.state.focus.aside.map((e) => e.layer)).toEqual(["clash"]);
    // set aside: the table form, and the Raider, still blocked, draws no lane at me
    expect(r.state.plan!.gathering!.form).toBe("table");
    expect(r.state.plan!.gathering!.wings[0]!.columns[0]!.blocked).toBe(true);
    const d = describeTable({ model: r.state.model!, plan: r.state.plan!, cues: play.present(r.state.play).board, focus: { layer: null, seat: null, group: null, card: null, table: [] }, hover: null });
    expect(d.lanes).toEqual([]);
    // raised again: no brand for it
    r.inputs.push({ t: "restore", layer: "clash", stamp: { at: r.now, commit: r.state.commit } });
    r.frame((r.now += 10));
    expect(r.state.plan!.gathering!.wings[0]!.columns[0]!.slot).toBeNull();
  });

  it("the combat's identity carries Forge's ordinal: a second combat in the turn starts afresh, its clash up again", () => {
    const r = started(fight({ v: 1, at: "You", ordinal: 1 }));
    r.inputs.push({ t: "dismiss", stamp: { at: r.now, commit: r.state.commit } });
    r.frame((r.now += 10));
    expect(r.state.focus.aside.map((e) => e.layer)).toEqual(["clash"]);
    r.transport.push(fight({ v: 2, at: "You", ordinal: 2 }));
    r.frame((r.now += 400));
    expect(r.state.focus.combat?.key).toMatch(/\|2$/);
    expect(layers(r)).toEqual([["clash", null]]);
    expect(r.state.focus.aside).toEqual([]);
  });

  it("Forge's unblock: an attacker it makes unblocked after blocks takes its brand", () => {
    const r = started(fight({ v: 1, at: "You", blocks: [[30, 40]] }));
    const raider = () => r.state.plan!.gathering!.wings[0]!.columns.find((c) => c.attackers.includes(40 as CardId))!;
    expect(raider().slot).toBeNull();
    r.transport.push(fight({ v: 2, at: "You", blocked: [] }));
    r.frame((r.now += 400));
    expect(raider().blocked).toBe(false);
    expect(raider().slot).not.toBeNull();
    expect(r.commits.at(-1)!.view.clash!.plaques[0]!.words).toBe("Atraxa attacks You · 7 unblocked");
  });

  it("a reconnect after a blocker died: Forge's verdict alone keeps the attacker blocked, no brand, the clash up", () => {
    const e = fight({ v: 1, at: "You", guard: false, blocked: [40] });
    const r = started(e);
    expect(layers(r)).toEqual([["clash", null]]);
    const raider = r.state.plan!.gathering!.wings[0]!.columns.find((c) => c.attackers.includes(40 as CardId))!;
    expect(raider.blocked).toBe(true);
    expect(raider.slot).toBeNull();
    expect(r.commits.at(-1)!.view.clash!.plaques[0]!.words).toBe("Atraxa attacks You · 4 unblocked");
  });

  it("a tap on the \"more\" column opens the fighters past the clash's columns, the clash still up under them", () => {
    const e = fight({ v: 1, at: "You" }) as { view: Json & { players: Json[] } };
    const ids = Array.from({ length: 20 }, (_, i) => 100 + i);
    e.view.players[1]!["battlefield"] = ids.map((id, i) => creature(id, `Fighter ${i}`, "Atraxa", 2));
    e.view["combat"] = { attackers: ids.map((id) => ({ id, defender: "You" })), blockers: [] };
    const r = started(e);
    const more = groups(r).find((g) => g.id === "clash:more")!;
    expect(more.members.length).toBe(r.state.plan!.gathering!.more.length);
    expect(more.members.length).toBeGreaterThan(0);
    tap(r, more);
    expect(layers(r)).toEqual([
      ["clash", null],
      ["sift", "clash:more"],
    ]);
    expect(r.commits.at(-1)!.view.sift).not.toBeNull();
    const d = describeTable({ model: r.state.model!, plan: r.state.plan!, cues: play.present(r.state.play).board, focus: r.commits.at(-1)!.frame!.focus, hover: null });
    const sifted = [...d.pieces.values()].flatMap((p) => (p.draw.t === "sift" ? [p.draw.card] : []));
    expect(sifted.sort()).toEqual([...more.members].sort());
  });

  it("a jump straight to the main phase ends the combat: its memory, the clash and its chip go", () => {
    const r = started(fight({ v: 1, at: "You", blocks: [[30, 40]] }));
    expect(r.state.focus.combat).toBeDefined();
    r.inputs.push({ t: "dismiss", stamp: { at: r.now, commit: r.state.commit } });
    r.frame((r.now += 10));
    r.transport.push(fight({ v: 2, at: "You", phase: "MAIN2" }));
    r.frame((r.now += 400));
    expect(r.state.focus.combat).toBeUndefined();
    expect(r.state.focus.aside).toEqual([]);
    expect(r.commits.at(-1)!.view.chips).toEqual([]);
  });

  it("between opponents: the table form before blocks; once one is blocked, a duel in the parted middle, no layer", () => {
    const r = started(fight({ v: 1, at: "Dack" }));
    expect(layers(r)).toEqual([]);
    expect(r.state.plan!.gathering!.form).toBe("table");
    r.transport.push(fight({ v: 2, at: "Dack", blocks: [[50, 41]] }));
    r.frame((r.now += 400));
    expect(layers(r)).toEqual([]);
    expect(r.state.plan!.gathering!.duels).not.toBeNull();
    expect(r.state.plan!.part).toBeGreaterThanOrEqual(0);
    // the duel wears its clasp; no plaque, no brand (the plates' tallies and the prompt say who fights)
    expect(r.commits.at(-1)!.view.clash).toMatchObject({ plaques: [], brands: [] });
    expect(r.commits.at(-1)!.view.clash!.clasps.length).toBe(1);
  });

  it("the wire is untouched: the same answer in either form", () => {
    const answerIn = (aside: boolean) => {
      const r = started(fight({ v: 1, at: "You" }));
      if (aside) {
        r.inputs.push({ t: "dismiss", stamp: { at: r.now, commit: r.state.commit } });
        r.frame((r.now += 10));
        expect(r.state.plan!.gathering!.form).toBe("table");
      }
      r.act();
      r.frame((r.now += 10));
      return r.transport.answers.map((a) => a.body);
    };
    expect(answerIn(true)).toEqual(answerIn(false));
  });
});
