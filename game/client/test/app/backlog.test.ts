// The app's change queue is bounded: past QUEUE_LIMIT sets waiting for the scene, the older ones are dropped and the
// next commit cuts. A must-not-miss moment among them (a creature of mine lost, a sweep, an elimination, something
// aimed at me) is not lost with them: its recap is made before the cut and kept with the scene's own.
import { describe, expect, it } from "vitest";
import { QUEUE_LIMIT } from "../../src/app/update";
import { envelope, rig } from "./rig";

type Json = Record<string, unknown>;

const BEAR = { id: 50, name: "Grizzly Bears", owner: "You", controller: "You", type: "Creature - Bear", power: 2, toughness: 2 };

/** The rig's envelope at `v`, with my Grizzly Bears on the battlefield (or in my graveyard), and Atraxa at `life`. */
function at(v: number, o: { bear: "battlefield" | "graveyard"; life: number }): Json {
  const e = envelope({ v, decision: null });
  const players = (e["view"] as Json)["players"] as Json[];
  players[0]![o.bear] = [BEAR];
  players[1]!["life"] = o.life;
  return e;
}

describe("a change queue past its limit", () => {
  it("keeps the newest sets, cuts, and recaps what the dropped sets must not let me miss", () => {
    const r = rig();
    r.renderer.sceneless = true; // the scene is still loading: every set waits
    r.loop.start();
    r.frame(0);
    r.transport.push(at(1, { bear: "battlefield", life: 40 }));
    r.frame(10);
    r.transport.push(at(2, { bear: "graveyard", life: 40 })); // my creature died: must not be missed
    r.frame(20);
    for (let i = 0; i < QUEUE_LIMIT; i++) {
      r.transport.push(at(3 + i, { bear: "graveyard", life: 39 - i }));
      r.frame(30 + i * 10);
    }
    expect(r.state.changes.sets).toHaveLength(QUEUE_LIMIT);
    expect(r.state.changes.cut).toBe(true);
    const lost = r.state.narrative.missed.filter((c) => c.why === "lost");
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ how: "collapsed", cards: [50] });
    expect(r.logs.some((l) => l.code === "queue.recap" && l.message.includes("50"))).toBe(true);
    // More sets while the cut waits: each recapped once as it comes (the bear's death is not recapped again).
    r.transport.push(at(3 + QUEUE_LIMIT, { bear: "graveyard", life: 1 }));
    r.frame(1000);
    expect(r.state.narrative.missed.filter((c) => c.why === "lost")).toHaveLength(1);
    // The scene draws the cut: the queue's recapping ends with it.
    r.renderer.sceneless = false;
    r.loop.wake();
    r.frame(1100);
    expect(r.state.changes).toMatchObject({ cut: false, overflow: false });
  });

  it("recaps nothing while the queue is within its limit", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(at(1, { bear: "battlefield", life: 40 }));
    r.frame(10);
    r.transport.push(at(2, { bear: "graveyard", life: 40 }));
    r.frame(20);
    expect(r.state.narrative.missed).toEqual([]);
  });
});
