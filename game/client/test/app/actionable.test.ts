// When a decision becomes actionable: the table shows as each snapshot arrives, but a decision whose cards have no data
// yet (its options, the stack's top and what it aims at) is held back from play (the prompt waits, no buttons, no
// auto-pass) until their data comes back, or CARDS_WAIT_MS after it arrived, when it goes with what there is (logged).
// A hidden card a chooser offers by name is drawn from the catalog by that name.
import { describe, expect, it } from "vitest";
import * as play from "../../src/play";
import { AUTO_PASS_MS } from "../../src/play";
import { CARDS_WAIT_MS } from "../../src/app/catalog";
import { catalogJson } from "../model/fixtures";
import { raw, withDecision } from "../play/rig";
import { rig } from "./rig";
import type { Rig } from "./rig";

/** A cold page shown 030: Gideon Jura's ability on the stack, an opponent's, with nothing real to answer it with. */
function cold(): Rig {
  const r = rig({ cold: true });
  r.loop.start();
  r.frame(0);
  r.now = 10;
  r.transport.push(raw("030-play-watching.json"));
  r.frame(10);
  return r;
}

const prompt = (r: Rig) => play.present(r.state.play).controls.prompt;
const autopass = (r: Rig) => [...r.state.deadlines.items].find(([id]) => id.startsWith("play/autopass:"))?.[1].due ?? null;

describe("a decision whose cards have no data yet", () => {
  it("is held: the table shows, the prompt waits with no buttons, nothing counts down, and its cards are asked for", () => {
    const r = cold();
    expect(r.state.session.decision?.id).toBe(148);
    expect(r.state.model).not.toBeNull();
    expect(r.commits.at(-1)?.frame).not.toBeNull(); // the table is drawn
    expect(r.state.session.stop).toBeNull();
    expect(prompt(r)).toMatchObject({ headline: "…", buttons: [] });
    expect(r.commits.at(-1)?.view.controls.prompt?.buttons).toEqual([]);
    expect(autopass(r)).toBeNull();
    expect(r.transport.cardRequests.flat()).toContain("Gideon Jura");
    // A press drawn for no stop is dropped.
    r.act();
    r.frame(20);
    expect(r.transport.answers).toEqual([]);
  });

  it("is offered when its data arrives, with auto-pass counted from then", () => {
    const r = cold();
    r.now = 400;
    r.transport.catalog(catalogJson);
    r.frame(400);
    expect(r.state.session.stop).not.toBeNull();
    expect(prompt(r)?.buttons.map((b) => b.role)).toContain("pass");
    expect(autopass(r)).toBe(400 + AUTO_PASS_MS);
    expect(r.logs.map((l) => l.code)).not.toContain("cards.late");
  });

  it("is offered with what there is when the wait runs out, and says so", () => {
    const r = cold();
    r.frame(10 + CARDS_WAIT_MS - 1);
    expect(r.state.session.stop).toBeNull();
    expect(r.sched.wakes.at(-1) ?? 10 + CARDS_WAIT_MS).toBe(10 + CARDS_WAIT_MS);
    r.frame(10 + CARDS_WAIT_MS);
    expect(r.state.session.stop).not.toBeNull();
    expect(autopass(r)).toBe(10 + CARDS_WAIT_MS + AUTO_PASS_MS);
    const late = r.logs.find((l) => l.code === "cards.late");
    expect(late?.level).toBe("warn");
    expect(late?.message).toContain("Gideon Jura");
    // The reply that comes afterwards changes how the table reads, not the stop.
    const stop = r.state.session.stop;
    r.transport.catalog(catalogJson);
    r.frame(10 + CARDS_WAIT_MS + 100);
    expect(r.state.session.stop).toBe(stop);
  });

  it("is offered when the wait runs out at a fractional time (the deadline's own time, compared exactly)", () => {
    // (1619.012489643532 + 1200) - 1619.012489643532 is 1199.9999999999998: measured as a difference, the wait never ran out.
    const t0 = 1619.012489643532;
    const r = rig({ cold: true });
    r.loop.start();
    r.frame(0);
    r.now = t0;
    r.transport.push(raw("030-play-watching.json"));
    r.frame(t0);
    expect(r.state.session.stop).toBeNull();
    r.frame(t0 + CARDS_WAIT_MS);
    expect(r.state.session.stop).not.toBeNull();
  });

  it("a failed request is not asked again at once: it waits for the next snapshot", () => {
    const r = cold();
    const asked = r.transport.cardRequests.length;
    expect(asked).toBeGreaterThan(0);
    r.transport.catalog(null, "HTTP 500");
    r.frame(50);
    r.frame(400);
    expect(r.transport.cardRequests.length).toBe(asked);
    expect(r.state.session.stop).toBeNull(); // still held, until its data or the wait's end
    const again = raw("030-play-watching.json");
    again["v"] = Number(again["v"]) + 1;
    r.transport.push(again);
    r.frame(500);
    expect(r.transport.cardRequests.length).toBeGreaterThan(asked);
    expect(r.transport.cardRequests.slice(asked).flat()).toContain("Gideon Jura");
  });

  it("is not held again by later snapshots of the same decision", () => {
    const r = cold();
    r.frame(10 + CARDS_WAIT_MS);
    const stop = r.state.session.stop;
    expect(stop).not.toBeNull();
    const again = raw("030-play-watching.json");
    again["v"] = Number(again["v"]) + 1;
    r.transport.push(again);
    r.frame(10 + CARDS_WAIT_MS + 50);
    expect(r.state.session.stop).toBe(stop);
  });

  it("a decision whose cards the page already has is offered at once", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.now = 10;
    r.transport.push(raw("030-play-watching.json"));
    r.frame(10);
    expect(r.state.session.stop).not.toBeNull();
    expect(autopass(r)).toBe(10 + AUTO_PASS_MS);
  });
});

describe("a chooser offering cards off the table", () => {
  const search = () =>
    withDecision("009-play-commander-zone.json", {
      kind: "choose",
      prompt: "Search for a land",
      options: ["Forest", "Swamp"],
      refs: [
        { card: 99901, name: "Forest" },
        { card: 99902, name: "Swamp" },
      ],
    });

  it("waits for the names it shows, then draws each item from the catalog by its name", () => {
    const r = rig({ cold: true });
    r.loop.start();
    r.frame(0);
    r.transport.push(search());
    r.frame(10);
    expect(r.state.session.stop).toBeNull();
    expect(r.transport.cardRequests.flat()).toEqual(expect.arrayContaining(["Forest", "Swamp"]));
    r.now = 50;
    r.transport.catalog({ Forest: { name: "Forest", faces: [{ name: "Forest", img: "cache/card/forest.jpg", art: "cache/art/forest.jpg" }] } });
    r.frame(50);
    const view = r.commits.at(-1)!.view;
    expect(view.controls.sheet?.items.map((i) => [i.card, i.name])).toEqual([
      [null, "Forest"],
      [null, "Swamp"],
    ]);
    expect(view.named.get("Forest")?.image).toBe("cache/card/forest.jpg");
    expect(view.named.has("Swamp")).toBe(false); // answered without data: drawn by its label
  });
});
