// The vertical slice through the whole app, headless: real corpus envelopes on the scripted transport, play, the table
// plan, change sets and moments, drawn by the real stage (pure, no three.js). Lightning Bolt (822) is cast from the
// hand in 023, Forge asks for its target in 024 (the card is out of sight while it does), it is on the stack in 025, and
// it has resolved by 026.
import { describe, expect, it } from "vitest";
import * as play from "../../src/play";
import type { ScreenPose } from "../../src/play";
import type { CardId } from "../../src/protocol";
import { seatId } from "../../src/model";
import { HELD_LIMIT } from "../../src/app/moments";
import { sceneNews } from "../../src/app/update";
import { raw } from "../play/rig";
import { catalogJson } from "../model/fixtures";
import { rig } from "./rig";
import type { Rig } from "./rig";

const BOLT = 822 as CardId;
const POSE: ScreenPose = { rect: { left: 200, top: 420, right: 330, bottom: 600 }, rotation: 0.05, scale: 1.06 };

function at023(o: Parameters<typeof rig>[0] = { stage: true }): Rig {
  const r = rig(o);
  r.loop.start();
  r.frame(0);
  r.transport.push(raw("023-play-monarch.json"));
  r.frame(100);
  return r;
}

const presented = (r: Rig) => play.present(r.state.play);

/** Frames every 16 ms for `ms` (the stage's flights run on them). */
function run(r: Rig, ms: number): void {
  const end = r.now + ms;
  while (r.now < end) r.frame(r.now + 16);
}

describe("cast, target, resolve", () => {
  it("plays the slice end to end, with the hand-to-stack moment handed over in one commit", () => {
    const r = at023();
    expect(r.state.plan).not.toBeNull();
    expect(r.state.session.stop).toBe(presented(r).controls.stop);
    expect(r.commits.at(-1)?.view.hand.cards.find((c) => c.id === BOLT)?.playable).toBe(true);

    // Drag Lightning Bolt up out of the hand: its one play goes at once, carrying the pose it was let go at.
    r.now = 200;
    r.send({ a: "release", card: BOLT, dy: -140, pose: POSE, overTable: true });
    r.frame(210);
    expect(r.transport.answers).toHaveLength(1);
    expect(r.transport.answers[0]?.body).toMatchObject({ id: 120, answer: [2] });
    const [moment] = r.state.moments.open;
    expect(moment).toMatchObject({ owner: "chrome", from: POSE, key: { card: BOLT, option: 2, stop: r.state.session.stop } });
    let c = r.commits.at(-1)!;
    expect(c.view.hand.carried).toEqual([{ card: BOLT, pose: POSE }]);
    expect(c.frame?.moments).toEqual([{ id: moment!.id, card: BOLT, pose: POSE, owner: "chrome" }]);
    expect(c.view.controls.prompt?.busy).toBe(true);
    r.reply(0, { t: "queued" });
    r.frame(230);

    // Its target: Forge has taken the card out of the hand; the chrome keeps holding it, and the target is on the table.
    r.transport.push(raw("024-targets-monarch.json"));
    r.frame(400);
    expect(r.state.session.decision?.kind).toBe("targets");
    expect(r.state.model?.cards.has(BOLT)).toBe(false);
    expect(r.state.moments.open.map((m) => m.owner)).toEqual(["chrome"]);
    expect(r.commits.at(-1)?.view.hand.carried.map((x) => x.card)).toEqual([BOLT]);
    expect(r.commits.at(-1)?.view.looks.get(BOLT)?.name).toBe("Lightning Bolt");
    const princess = seatId("Princess");
    expect(presented(r).controls.sheet).toBeNull(); // every target is reachable on the table
    expect(presented(r).board.marks.seats.get(princess)).toBe("option");
    const plate = r.state.plan!.hits.groups.find((g) => g.id === `plate:${princess}`)!;
    expect(r.stage).not.toBeNull();

    // A double tap on Princess's plate sends one answer.
    r.now = 500;
    r.send({ a: "tap", on: { group: plate.id, members: plate.members } });
    r.send({ a: "tap", on: { group: plate.id, members: plate.members } });
    r.frame(510);
    expect(r.transport.answers).toHaveLength(2);
    expect(r.transport.answers[1]?.body).toMatchObject({ id: 125, answer: [8] });
    r.reply(1, { t: "queued" });

    // On the stack: the set that brings it waits its turn behind what 024 set moving, so the scene cannot fly it yet and
    // the chrome keeps holding it where it was let go.
    r.transport.push(raw("025-play-stack-targets-player.json"));
    r.frame(700);
    c = r.commits.at(-1)!;
    expect(r.state.model?.cards.get(BOLT)?.zone).toBe("stack");
    expect(c.inspect!.flights.some((f) => f.card === BOLT)).toBe(false);
    expect(c.view.hand.carried).toEqual([{ card: BOLT, pose: POSE }]);
    expect(c.frame?.moments).toEqual([{ id: moment!.id, card: BOLT, pose: POSE, owner: "chrome" }]);

    // The handoff commit, the first the chrome does not draw it in: the stage sets the card off from the carried pose
    // in that same commit, and draws it nowhere else.
    while (r.commits.at(-1)!.view.hand.carried.length && r.now < 3000) r.frame(r.now + 16);
    c = r.commits.at(-1)!;
    const before = r.commits.at(-2)!;
    expect(c.view.hand.carried).toEqual([]);
    expect(c.inspect!.flights.filter((f) => f.card === BOLT)).toEqual([
      expect.objectContaining({ origin: { from: "hand", moment: moment!.id, pose: POSE }, dest: { to: "piece", piece: "stack:682" }, progress: 0 }),
    ]);
    expect(c.inspect!.pieces.filter((p) => p.shown.includes(BOLT))).toEqual([]);
    expect(before.view.hand.carried).toEqual([{ card: BOLT, pose: POSE }]);
    expect(before.inspect!.flights.some((f) => f.card === BOLT)).toBe(false);
    r.frame(r.now + 16);
    expect(r.state.moments.open.map((m) => m.owner)).toEqual(["scene"]);

    // It lands: the moment ends, exactly once, as landed.
    run(r, 2500);
    expect(r.state.moments.open).toEqual([]);
    expect(r.state.moments.ended.filter((e) => e.id === moment!.id)).toEqual([{ id: moment!.id, card: BOLT, end: "landed", at: expect.any(Number) }]);
    expect(r.state.deadlines.items.has(`moments/${moment!.id}`)).toBe(false);

    // It resolves: off the stack, into my graveyard; every change set is consumed.
    r.transport.push(raw("026-play-monarch.json"));
    run(r, 3000);
    expect(r.state.model?.stack).toEqual([]);
    expect(r.state.model?.cards.get(BOLT)?.zone).toBe("graveyard");
    expect(r.state.changes.sets).toEqual([]);
    expect(r.stage!.inspect().flights).toEqual([]);
    expect(r.transport.answers).toHaveLength(2);
  });

  it("a resize while the card is held: the chrome's re-anchored pose becomes the moment's, and the flight sets off from it", () => {
    const r = at023();
    r.now = 200;
    r.send({ a: "release", card: BOLT, dy: -140, pose: POSE, overTable: true });
    r.frame(210);
    r.reply(0, { t: "queued" });
    r.transport.push(raw("024-targets-monarch.json"));
    r.frame(400);
    const [moment] = r.state.moments.open;

    // The page is resized: the chrome draws the held card at the hand's new place and reports it.
    const MOVED: ScreenPose = { rect: { left: 260, top: 380, right: 390, bottom: 560 }, rotation: 0.05, scale: 1.06 };
    r.renderer.carried = [{ card: BOLT, pose: MOVED }];
    r.frame(450);
    r.frame(466);
    expect(r.state.moments.open).toEqual([expect.objectContaining({ id: moment!.id, owner: "chrome", from: MOVED })]);
    let c = r.commits.at(-1)!;
    expect(c.view.hand.carried).toEqual([{ card: BOLT, pose: MOVED }]);
    expect(c.frame?.moments).toEqual([{ id: moment!.id, card: BOLT, pose: MOVED, owner: "chrome" }]);
    // The same pose again, or a pose for a card no moment holds (a sheet's offer), is no news for the loop to fold.
    const again = [{ card: BOLT, pose: MOVED }, { card: 999 as CardId, pose: POSE }];
    expect(sceneNews(r.state, { active: false, fault: null, scene: null, carried: again })).toBe(false);
    expect(sceneNews(r.state, { active: false, fault: null, scene: null, carried: [{ card: BOLT, pose: POSE }] })).toBe(true);

    // The handoff: the flight sets off from where the chrome last drew the card.
    r.transport.push(raw("025-play-stack-targets-player.json"));
    r.frame(700);
    while (r.commits.at(-1)!.view.hand.carried.length && r.now < 3000) r.frame(r.now + 16);
    c = r.commits.at(-1)!;
    expect(c.inspect!.flights.filter((f) => f.card === BOLT)).toEqual([
      expect.objectContaining({ origin: { from: "hand", moment: moment!.id, pose: MOVED }, progress: 0 }),
    ]);
  });

  // While a chrome-owned moment carries a card and the change set that brings it waits in the stage's backlog, the stage
  // does not show the card at its destination (stack:682 would show 822 from the 700 ms commit until the set is taken).
  it("while the chrome holds the cast card, the stage draws it nowhere (the scene's half of the handoff)", () => {
    const r = at023();
    r.now = 200;
    r.send({ a: "release", card: BOLT, dy: -140, pose: POSE, overTable: true });
    r.frame(210);
    r.reply(0, { t: "queued" });
    r.transport.push(raw("024-targets-monarch.json"));
    r.frame(400);
    const plate = r.state.plan!.hits.groups.find((g) => g.id === `plate:${seatId("Princess")}`)!;
    r.now = 500;
    r.send({ a: "tap", on: { group: plate.id, members: plate.members } });
    r.frame(510);
    r.transport.push(raw("025-play-stack-targets-player.json"));
    r.frame(700);
    while (r.commits.at(-1)!.view.hand.carried.length && r.now < 3000) {
      const c = r.commits.at(-1)!;
      expect(c.inspect!.pieces.filter((p) => p.visible && p.shown.includes(BOLT)), `commit at ${c.now}`).toEqual([]);
      r.frame(r.now + 16);
    }
  });

  it("a held card Forge never shows again ends when the game does: target choice, then game over", () => {
    const r = at023();
    r.send({ a: "release", card: BOLT, dy: -140, pose: POSE, overTable: true });
    r.frame(210);
    const id = r.state.moments.open[0]!.id;
    r.reply(0, { t: "queued" });
    r.transport.push(raw("024-targets-monarch.json"));
    r.frame(400);
    expect(r.state.moments.open.map((m) => m.owner)).toEqual(["chrome"]);
    const over = raw("024-targets-monarch.json");
    over["v"] = 70;
    over["state"] = "over";
    over["over"] = "over: Princess won";
    over["decision"] = null;
    r.transport.push(over);
    r.frame(500);
    expect(r.state.moments.open).toEqual([]);
    expect(r.state.moments.ended.at(-1)).toMatchObject({ id, card: BOLT, end: "abandoned" });
    expect(r.commits.at(-1)?.view.hand.carried).toEqual([]);
    expect([...r.state.deadlines.items.keys()].filter((k) => k.startsWith("moments/"))).toEqual([]);
  });

  it("a held card is not held for ever: the held backstop ends it", () => {
    const r = at023();
    r.now = 200;
    r.send({ a: "release", card: BOLT, dy: -140, pose: POSE, overTable: true });
    r.frame(210);
    const id = r.state.moments.open[0]!.id;
    r.reply(0, { t: "queued" });
    r.transport.push(raw("024-targets-monarch.json"));
    r.frame(400);
    expect(r.state.deadlines.items.get(`moments/${id}`)?.due).toBe(200 + HELD_LIMIT);
    r.frame(200 + HELD_LIMIT - 1);
    expect(r.state.moments.open).toHaveLength(1);
    r.frame(200 + HELD_LIMIT);
    expect(r.state.moments.open).toEqual([]);
    expect(r.state.moments.ended.at(-1)).toMatchObject({ id, end: "abandoned" });
    expect(r.commits.at(-1)?.view.hand.carried).toEqual([]);
  });

  it("a refused cast returns the card to the hand", () => {
    const r = at023();
    r.send({ a: "release", card: BOLT, dy: -140, pose: POSE, overTable: true });
    r.frame(210);
    const id = r.state.moments.open[0]!.id;
    r.reply(0, { t: "refused", reason: "that decision has passed" });
    r.frame(220);
    expect(r.state.moments.open).toEqual([]);
    expect(r.state.moments.ended.at(-1)).toMatchObject({ id, end: "returned" });
    expect(r.commits.at(-1)?.view.hand.carried).toEqual([]);
    expect(r.commits.at(-1)?.view.toast).toBe("that decision has passed");
    expect(r.commits.at(-1)?.view.controls.prompt?.busy).toBe(false);
  });

  it("a new decision with the card still in the hand returns it; a new game abandons what is held", () => {
    const r = at023();
    r.send({ a: "release", card: BOLT, dy: -140, pose: POSE, overTable: true });
    r.frame(210);
    const again = raw("023-play-monarch.json");
    again["v"] = 61;
    (again["decision"] as Record<string, unknown>)["id"] = 121;
    r.transport.push(again);
    r.frame(300);
    expect(r.state.moments.ended.at(-1)).toMatchObject({ end: "returned" });

    r.send({ a: "release", card: BOLT, dy: -140, pose: POSE, overTable: true });
    r.frame(400);
    expect(r.state.moments.open).toHaveLength(1);
    const fresh = raw("023-play-monarch.json");
    fresh["gen"] = 2;
    fresh["v"] = 62;
    r.transport.push(fresh);
    r.frame(500);
    expect(r.state.moments.open).toEqual([]);
    expect(r.state.moments.ended.at(-1)).toMatchObject({ end: "abandoned" });
    expect(r.commits.at(-1)?.frame?.mode).toBe("cut");
  });

  it("asks the bridge for card data it lacks, once, and draws with it when it comes", () => {
    const r = at023({ stage: true, catalog: catalogJson, cold: true });
    const asked = r.transport.cardRequests.flat();
    expect(asked).toContain("Lightning Bolt");
    expect(asked).toContain("Haywire Mite");
    expect(new Set(asked).size).toBe(asked.length);
    r.frame(120);
    const mite = [...r.state.model!.cards.values()].find((c) => c.name === "Haywire Mite");
    expect(mite?.face.catalogued).toBe(true);
    expect(r.state.model?.cards.get(BOLT)?.face.catalogued).toBe(false); // not in the test catalog
    r.transport.push(raw("024-targets-monarch.json"));
    r.frame(200);
    expect(new Set(r.transport.cardRequests.flat()).size).toBe(r.transport.cardRequests.flat().length);
  });

  it("a card request whose reply was discarded (teardown, a new game) is asked again; one answered is not", () => {
    const r = at023({ stage: true, cold: true });
    const asked = (from: number) => r.transport.cardRequests.slice(from).flat();
    expect(asked(0)).toContain("Lightning Bolt");
    // Teardown before the reply: the reply comes under the old epoch and is discarded.
    let from = r.transport.cardRequests.length;
    r.loop.teardown();
    r.transport.catalog(catalogJson);
    r.loop.start();
    r.frame(300);
    r.transport.push(raw("023-play-monarch.json"));
    r.frame(310);
    expect(asked(from)).toContain("Lightning Bolt");
    expect(asked(from)).toContain("Haywire Mite");
    // A new game asked for here, before the reply: the same.
    from = r.transport.cardRequests.length;
    r.inputs.push({ t: "newGame", stamp: { at: 320, commit: r.state.commit }, req: { deck: "a", opponents: [], mana: "auto" } });
    r.frame(330);
    r.transport.catalog(catalogJson);
    const fresh = raw("023-play-monarch.json");
    fresh["gen"] = 2;
    r.transport.push(fresh);
    r.frame(340);
    r.frame(350);
    expect(asked(from)).toContain("Haywire Mite");
    // Answered now: the next game does not ask for it again.
    r.transport.catalog(catalogJson);
    r.frame(360);
    expect([...r.state.model!.cards.values()].find((c) => c.name === "Haywire Mite")?.face.catalogued).toBe(true);
    from = r.transport.cardRequests.length;
    r.inputs.push({ t: "newGame", stamp: { at: 370, commit: r.state.commit }, req: { deck: "a", opponents: [], mana: "auto" } });
    r.frame(380);
    const third = raw("023-play-monarch.json");
    third["gen"] = 3;
    r.transport.push(third);
    r.frame(390);
    r.frame(400);
    expect(asked(from)).not.toContain("Haywire Mite");
    expect(asked(from)).not.toContain("Lightning Bolt"); // answered without data (not in the test catalog): not asked again
  });
});
