// A support lying turned (tapped) is as wide as a card is tall. Its row's places widen just enough that an upright
// neighbour keeps off its name and foot, so the page need not fold harder to keep the limits. Atraxa's board in the
// combat clip (atraxa-turned.json, its seat board as layout reads it): her artifacts pile shows a tapped Incubator between
// Tezzeret and Wrenn and Realmbreaker. Folding harder there had put her (the commander), Glissa and both planeswalkers in
// piles; laid out like the old client, nothing is covered.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planTable } from "../../src/layout";
import type { SeatBoard } from "../../src/layout/board";
import type { CardId } from "../../src/layout/types";
import { SEATS } from "./boards";

const atraxa = JSON.parse(readFileSync(resolve(import.meta.dirname, "atraxa-turned.json"), "utf8")) as SeatBoard;
const empty = (seat: (typeof SEATS)[number]): SeatBoard => ({ seat, mine: seat === SEATS[0], cards: [], fixtures: { graveyard: 0, exile: 0, commandZone: false } });

describe("a support lying turned", () => {
  it("keeps the page at its first fold, as the old client laid it out: commander, Glissa and both planeswalkers alone", () => {
    const board = { ...atraxa, seat: SEATS[2]! };
    const plan = planTable({
      viewport: { w: 1180, h: 820 },
      mode: "normal",
      seats: [empty(SEATS[0]!), empty(SEATS[1]!), board, empty(SEATS[3]!)].map((b) => ({ seat: b.seat, board: b })),
      involved: new Set(),
      settling: false,
      memory: null,
      stack: [],
    });
    expect(plan.violations).toEqual([]);
    const sp = plan.seats.get(SEATS[2]!)!;
    expect(sp.report.pressure).toBe(0);
    const alone = (id: number) => sp.units.some((u) => u.members.length === 1 && u.members[0] === (id as CardId));
    for (const id of [1019, 1042, 1073, 1118]) expect(alone(id), String(id)).toBe(true);
    expect(sp.units.find((u) => u.members.includes(1119 as CardId))?.tapped).toBe(true);
  });
});
