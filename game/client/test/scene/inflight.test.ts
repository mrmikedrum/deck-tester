// The flight lifecycle on its own: a card the model moves again while it is still on its way flies once at a time, the
// newest flight following the chain's tail.
import { describe, expect, it } from "vitest";
import type { CardId } from "../../src/protocol";
import { order } from "../../src/scene/stage";
import type { FlightPlan } from "../../src/scene/stage";
import { Flights } from "../../src/scene/stage/inflight";

const card = 7 as CardId;
const plan = (dest: string): FlightPlan => {
  const base: Omit<FlightPlan, "phase" | "cohort"> = {
    key: `card:${card}`,
    card,
    departure: false,
    origin: { from: "plate", seat: "A" as never },
    dest: { to: "piece", piece: dest },
    face: null,
    token: false,
    motion: "depart",
    rank: 0,
    distance: 0,
  };
  return { ...base, ...order(base) };
};
// A depart reads nothing of the projector; the stand-in only has to exist.
const board = { actors: new Map(), desc: () => null, plan: () => ({ projector: {} }) as never, model: () => null };

/** How many of the card's ghosts each frame draws, the most at once. */
function most(flights: Flights, from: number, to: number): number {
  let n = 0;
  for (let t = from; t <= to; t += 8) {
    flights.step(t, []);
    n = Math.max(n, flights.ghosts(t).length);
  }
  return n;
}

describe("flights of one card", () => {
  it("a third move while the second waits on the first flies one ghost at a time", () => {
    const flights = new Flights(board);
    flights.launch(plan("zone:graveyard:A"), 1, 0, 400, 0, false, 0);
    expect(most(flights, 0, 200)).toBe(1); // committed: past a third of its way
    flights.launch(plan("zone:exile:A"), 2, 200, 400, 0, false, 200);
    flights.launch(plan("zone:library:A"), 3, 210, 400, 0, false, 210);
    expect(most(flights, 210, 2000)).toBe(1);
  });
  it("a move that replaces a waiting one still waits for the flight in the air", () => {
    const flights = new Flights(board);
    flights.launch(plan("zone:graveyard:A"), 1, 0, 400, 0, false, 0);
    most(flights, 0, 200);
    flights.launch(plan("zone:exile:A"), 2, 200, 400, 0, false, 200);
    flights.launch(plan("zone:library:A"), 3, 210, 400, 0, false, 210);
    const snap = flights.snapshot(210);
    expect(snap.filter((f) => f.state === "waiting").every((f) => f.start >= 400)).toBe(true);
  });
});
