// The old client's remaining narrative behaviours, on hand-made tables: going back to an earlier position (live.js
// `take`'s `rewound`, `restoreNotice` and `setAside`), the strip's words for paying Marath's Elemental ability
// (`recordLog`'s `feedText`), "Survivors are settling" once Sunfall's exiles have landed (`settleMotion`), and the cards
// that last came into my hand (`lastHandArrivals`), in the fan and in "Your hand".
import { describe, expect, it } from "vitest";
import { diff } from "../../src/model";
import type { TableModel } from "../../src/model";
import type { CardId } from "../../src/protocol";
import * as narrative from "../../src/narrative";
import type { State } from "../../src/narrative";
import { initialState } from "../../src/app/state";
import { chromeView } from "../../src/app/views";
import { card, creature, land, spell, tableOf } from "../model/fixtures";

const narrated = (models: readonly TableModel[]): State => {
  let s = narrative.initial;
  let prev: TableModel | null = null;
  models.forEach((m, i) => {
    s = narrative.release(narrative.narrate(s, diff(prev, m, i + 1), m), i + 1);
    prev = m;
  });
  return s;
};

describe("going back to an earlier position", () => {
  const bolt = spell(40, "Lightning Bolt", "Atraxa", "Lightning Bolt deals 3 damage to any target.");
  const bears = creature(41, "Grizzly Bears", "You");
  const later = tableOf({
    turn: 6,
    active: "You",
    seats: { You: { battlefield: [bears] } },
    stack: [{ id: 700, source: bolt, targets: [41] }],
    log: [{ i: 30, type: "STACK_ADD", text: "Atraxa cast Lightning Bolt targeting Grizzly Bears (41)", card: 40 }],
  });
  const earlier = tableOf({
    turn: 5,
    active: "You",
    phase: "MAIN2",
    seats: { You: { battlefield: [bears] } },
    log: [{ i: 20, type: "LAND", text: "You played Plains (2)", card: 2 }],
  });

  it("says where it went back to, and what it set aside, in the log and as the strip's summary", () => {
    const s = narrated([later, earlier]);
    expect(s.restore).toBe("Back to your second main");
    const newest = s.entries.find((e) => e.id === s.latest[0])!;
    expect(newest.said).toBe("Back to your second main. Set aside Lightning Bolt → Grizzly Bears.");
    expect(narrative.logStripView(s, earlier)).toMatchObject({
      lines: [{ text: "Set aside Lightning Bolt → Grizzly Bears" }],
      tone: "summary",
    });
  });

  it("with nothing set aside, the position is restored", () => {
    const calm = tableOf({
      ...{ turn: 6, active: "Dack" as const },
      seats: {},
      log: [{ i: 30, type: "LAND", text: "Dack played Island (9)", card: 9 }],
    });
    const back = tableOf({
      turn: 6,
      active: "Dack",
      phase: "UPKEEP",
      seats: {},
      log: [{ i: 25, type: "LAND", text: "Dack played Swamp (8)", card: 8 }],
    });
    const s = narrated([calm, back]);
    expect(s.restore).toBe("Back to Dack's upkeep");
    expect(narrative.logStripView(s, back).lines.map((l) => l.text)).toEqual(["Position restored"]);
  });

  it("the prompt's cue is up until the cut has been seen, then the decision is asked again; the next set forgets it", () => {
    let s = narrated([later, earlier]);
    expect(narrative.restoreView(s, earlier)).toEqual({
      cue: "Back to your second main",
      headline: "",
      restoring: true,
    });
    s = narrative.restored(s);
    expect(narrative.restoreView(s, earlier)?.restoring).toBe(false);
    const on = tableOf({
      turn: 5,
      active: "You",
      phase: "MAIN2",
      seats: { You: { battlefield: [bears], life: 39 } },
      log: [{ i: 20, type: "LAND", text: "You played Plains (2)", card: 2 }],
    });
    s = narrative.narrate(s, diff(earlier, on, 9), on);
    expect(narrative.restoreView(s, on)).toBeNull();
  });
});

describe("the strip's words for Marath's Elemental", () => {
  it("Forge's line paying for the ability reads as what it was spent on; the log keeps Forge's", () => {
    const marath = card(50, "Marath, Will of the Wild", "Atraxa", "Legendary Creature - Elemental Beast", {
      power: 3,
      toughness: 3,
    });
    const base = {
      turn: 5,
      active: "Atraxa" as const,
      log: [{ i: 1, type: "LAND", text: "Atraxa played Forest (3)", card: 3 }],
    };
    const before = tableOf({ ...base, seats: { Atraxa: { battlefield: [marath] } } });
    const paid = tableOf({
      ...base,
      seats: { Atraxa: { battlefield: [marath] } },
      stack: [
        {
          id: 800,
          source: marath,
          spell: false,
          text: "Marath, Will of the Wild - Create a 3/3 green Elemental creature token.",
        },
      ],
      log: [
        ...base.log,
        {
          i: 2,
          type: "ZONE_CHANGE",
          text: "Atraxa removed 3 +1/+1 counters from Marath to activate Marath, Will of the Wild",
          card: 50,
        },
      ],
    });
    const s = narrated([before, paid]);
    expect(narrative.logStripView(s, paid).lines[0]?.text).toBe("Marath spent 3 +1/+1 counters for a 3/3 Elemental");
    expect(narrative.logSheetView(s).groups.flatMap((g) => g.rows.map((r) => r.text))).toContain(
      "Atraxa removed 3 +1/+1 counters from Marath to activate Marath, Will of the Wild",
    );
  });
});

describe("Sunfall's survivors", () => {
  it("once the exiles have landed and only the survivors' re-fit is left, the prompt says nothing more (the loss notice names what left)", () => {
    const m = tableOf({ seats: {} });
    const s: State = {
      ...narrative.initial,
      notices: [
        { id: 1, seq: 1, motion: "Sunfall resolves", line: null, arriving: [], hand: [], sweeping: true },
      ],
    };
    expect(narrative.watching(s, m, true)?.headline).toBe("Sunfall resolves");
    expect(narrative.watching(s, m, false)).toEqual({
      headline: "",
      arriving: [],
      toStack: false,
      sweeping: true,
    });
    const plain: State = {
      ...s,
      notices: [{ ...s.notices[0]!, motion: "Cards are leaving the stack", sweeping: false }],
    };
    expect(narrative.watching(plain, m, false)?.headline).toBe("Cards are leaving the stack");
  });
});

describe("the cards that last came into my hand", () => {
  const island = land(5, "Island", "You");
  const a = tableOf({
    active: "You",
    seats: { You: { hand: [island] } },
    log: [{ i: 1, type: "LAND", text: "x", card: null }],
  });
  const b = tableOf({
    active: "You",
    seats: { You: { hand: [island, land(6, "Plains", "You")] } },
    log: [
      { i: 1, type: "LAND", text: "x", card: null },
      { i: 2, type: "DRAW", text: "You drew a card.", card: null },
    ],
  });
  const c = tableOf({
    active: "You",
    seats: { You: { hand: [island, land(6, "Plains", "You")], life: 39 } },
    log: [
      { i: 1, type: "LAND", text: "x", card: null },
      { i: 2, type: "DRAW", text: "You drew a card.", card: null },
    ],
  });

  it('are kept until the next arrive (not the first hand), and glow in the fan and read "Last added" in the list', () => {
    expect(narrated([a]).fresh).toEqual([]);
    const s = narrated([a, b, c]);
    expect(s.fresh).toEqual([6 as CardId]);
    const app = { ...initialState({ clientBuild: "t" }), model: c, narrative: s };
    expect(chromeView(app).hand.fresh).toEqual([6]);
    const listed = chromeView({
      ...app,
      focus: {
        ...app.focus,
        layers: [{ layer: "hand", card: null, seat: null, group: null, page: 0, dismissible: true, restore: null }],
      },
    }).handSheet;
    expect(listed?.cards.map((x) => [x.name, x.fresh])).toEqual([
      ["Island", false],
      ["Plains", true],
    ]);
  });
});

describe("what another player puts onto the battlefield", () => {
  const bears = creature(51, "Grizzly Bears", "Dack");
  const angel = creature(52, "Serra Angel", "Dack");
  const mine = creature(53, "Llanowar Elves", "You");
  const at = (turn: number, dack: ReturnType<typeof creature>[], you: ReturnType<typeof creature>[] = []) =>
    tableOf({ turn, active: "Dack", seats: { Dack: { battlefield: dack }, You: { battlefield: you } }, log: [] });

  it("is news until the next arrive or the next turn; what I put down myself never is", () => {
    expect(narrated([at(5, [])]).arrived).toEqual([]);
    expect(narrated([at(5, []), at(5, [bears])]).arrived).toEqual([51]);
    expect(narrated([at(5, []), at(5, [bears]), at(5, [bears], [mine])]).arrived).toEqual([51]);
    expect(narrated([at(5, []), at(5, [bears]), at(5, [bears, angel])]).arrived).toEqual([52]);
    expect(narrated([at(5, []), at(5, [bears]), at(6, [bears])]).arrived).toEqual([]);
  });
});
