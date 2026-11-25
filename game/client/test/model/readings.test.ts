// The readings: the old client's text and threat expressions, as tables; and the catalog's tolerant decoding.
import { describe, expect, it } from "vitest";
import {
  alarming,
  decodeCatalog,
  departureIn,
  drewCards,
  elementalCreation,
  entersDraw,
  isArcaneDenial,
  isCounterspell,
  isCreatureSweep,
  isDamagePhase,
  isExileTargetCreature,
  isIncubateSweep,
  isLandfallModes,
  logCards,
  logText,
  makesElemental,
  seatId,
  sweepHarms,
  sweepHits,
  threatens,
  topOf,
} from "../../src/model";
import type { Role, SeatId } from "../../src/model";
import type { LogEntry } from "../../src/protocol";
import { creature, spell, tableOf, token } from "./fixtures";

const ROLES: readonly Role[] = ["creature", "walker", "mana", "support"];
const me = seatId("You"), her = seatId("Atraxa");
const entry = (type: string, text: string, card: number | null = null, i = 1) => ({ i, type, text, card }) as LogEntry;

describe("sweeps (h.js sweepHits, sweepHarms)", () => {
  const reach = (text: string) => {
    const hit = sweepHits(text);
    return hit ? ROLES.filter(hit) : null;
  };
  it.each([
    ["Exile all creatures. Incubate X, where X is the number of creatures exiled this way.", ["creature"]],
    ["Destroy each nonland permanent.", ["creature", "walker", "support"]],
    ["Return all permanents to their owners' hands.", ["creature", "walker", "mana", "support"]],
    ["Each creature you control gets +1/+1.", ["creature"]],
    ["Destroy target creature.", null],
  ] as const)("%s reaches %j", (text, roles) => expect(reach(text)).toEqual(roles));

  const harms = (text: string, controller: SeatId | null = her) => {
    const h = sweepHarms(text, controller);
    return h && { mine: ROLES.filter((r) => h(r, me)), hers: ROLES.filter((r) => h(r, her)) };
  };
  it.each([
    ["Exile all creatures.", { mine: ["creature"], hers: ["creature"] }],
    ["Damnation deals 2 damage to each creature and each player.", { mine: ["creature"], hers: ["creature"] }],
    ["All creatures get -3/-3 until end of turn.", { mine: ["creature"], hers: ["creature"] }],
    ["Destroy all creatures your opponents control.", { mine: ["creature"], hers: [] }],
    ["Destroy all creatures you don't control.", { mine: ["creature"], hers: [] }],
    ["Return all creatures you control to their owner's hand.", { mine: [], hers: ["creature"] }],
    ["Destroy each nonland permanent.", { mine: ["creature", "walker", "support"], hers: ["creature", "walker", "support"] }],
  ] as const)("%s harms %j", (text, want) => expect(harms(text)).toEqual(want));
  it.each(["Each creature you control gets +1/+1.", "Draw a card for each creature you control.", "Destroy target creature."])(
    "%s harms nothing",
    (text) => expect(harms(text)).toBeNull(),
  );
});

describe("spell text (live.js)", () => {
  it("counterspells, Arcane Denial's wording, Swords' wording", () => {
    expect(isCounterspell("Counter target spell. Its controller loses 2 life.")).toBe(true);
    expect(isCounterspell("Counter target noncreature spell.")).toBe(false);
    const denial =
      "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep.";
    expect(isArcaneDenial(denial)).toBe(true);
    expect(isArcaneDenial("Counter target spell.")).toBe(false);
    expect(isExileTargetCreature("Exile target creature. Its controller gains life equal to its power.")).toBe(true);
    expect(isExileTargetCreature("Exile target creature.")).toBe(false);
  });
  it("Marath's Elemental and its log line, Felidar Retreat's modes, Sunfall's wording", () => {
    expect(makesElemental("Marath (101) - create an X/X green Elemental creature token, where X = 3")).toBe(true);
    expect(makesElemental("Create a 2/2 white Cat Beast creature token.")).toBe(false);
    expect(elementalCreation("You created a 3/3 Elemental and two Beasts.")).toBe("two Beasts");
    expect(elementalCreation("You created a Treasure.")).toBeNull();
    const retreat = "Landfall — Whenever a land you control enters, choose one —\n• Create a 2/2 white Cat Beast creature token.\n• Put a +1/+1 counter on each creature you control. Those creatures gain vigilance until end of turn.";
    expect(isLandfallModes("Landfall", retreat)).toBe(true);
    expect(isLandfallModes("Landfall", "Create a Treasure.")).toBe(false);
    expect(entersDraw("Flying\nWhen this creature enters, draw a card. Then discard a card.")).toBe("When this creature enters, draw a card.");
    expect(entersDraw("Flying")).toBeNull();
    expect(isIncubateSweep("Exile all creatures. Incubate X, where X is the number of creatures exiled this way.")).toBe(true);
  });
});

describe("log lines (live.js)", () => {
  it("logText strips Forge's annotations and ids", () => {
    expect(logText("Lightning Bolt (863) - Lightning Bolt (863) deals 3 damage to Jace Beleren (819).")).toBe(
      "Lightning Bolt - Lightning Bolt deals 3 damage to Jace Beleren.",
    );
    expect(logText("You cast Brainstorm [Card: Brainstorm (830)]  ")).toBe("You cast Brainstorm");
  });
  it("logCards names the entry's card and every id in its text", () => {
    expect(logCards(entry("STACK_RESOLVE", "Lightning Bolt (851) deals 3 damage to Hill Giant (853).", 851))).toEqual([851, 853]);
    expect(logCards(entry("COMBAT", "Dack assigned Blighted Agent (843) to attack You."))).toEqual([843]);
  });
  it("draws, damage phases, departures", () => {
    expect(drewCards("You drew 2 cards.", "You")).toBe(2);
    expect(drewCards("Atraxa drew a card", "Atraxa")).toBe(1);
    expect(drewCards("Atraxa cast Brainstorm", "Atraxa")).toBeNull();
    expect(["COMBAT_DAMAGE", "COMBAT_FIRST_STRIKE_DAMAGE", "COMBAT_END"].map(isDamagePhase)).toEqual([true, true, false]);
    const item = { source: 842 as never, spell: true };
    expect(departureIn(entry("STACK_RESOLVE", "Doom Blade (842) - Destroy Grizzly Bears (817).", 842), item, "Doom Blade")).toBe("resolved");
    expect(departureIn(entry("STACK_RESOLVE", "Doom Blade (842) was countered.", 842), item, "Doom Blade")).toBe("countered");
    expect(departureIn(entry("GAME_ACTION", "Doom Blade was countered."), item, "Doom Blade")).toBe("countered");
    expect(departureIn(entry("STACK_RESOLVE", "Doom Blade (842) fizzles.", 842), item, "Doom Blade")).toBe("fizzled");
    expect(departureIn(entry("STACK_RESOLVE", "Bolt (9) resolves.", 9), item, "Doom Blade")).toBeNull();
  });
});

describe("threats (live.js threat, creatureSweep, the red prompt)", () => {
  const bears = creature(10, "Grizzly Bears", "You");
  const blade = spell(20, "Doom Blade", "Atraxa", "Destroy target nonblack creature.");
  const table = (stack: Parameters<typeof tableOf>[0]["stack"]) => tableOf({ seats: { You: { battlefield: [bears, token(11, "Soldier Token", "You")] }, Atraxa: { battlefield: [creature(30, "Hill Giant", "Atraxa", 3, 3)] } }, stack: stack ?? [] });

  it("someone else's spell aimed at my card or me threatens; at theirs, or my own, does not", () => {
    expect(threatens(topOf(table([{ id: 1, source: blade, targets: [10] }]))!, table([{ id: 1, source: blade, targets: [10] }]))).toBe(true);
    const atMe = table([{ id: 1, source: spell(21, "Lightning Bolt", "Atraxa", "Lightning Bolt deals 3 damage to any target."), targets: ["You"] }]);
    expect(threatens(topOf(atMe)!, atMe)).toBe(true);
    const atHers = table([{ id: 1, source: blade, targets: [30] }]);
    expect(threatens(topOf(atHers)!, atHers)).toBe(false);
    const mine = table([{ id: 1, source: spell(22, "Swords to Plowshares", "You", "Exile target creature. Its controller gains life equal to its power."), targets: [10] }]);
    expect(threatens(topOf(mine)!, mine)).toBe(false);
  });

  it("the prompt reads red for the top only: a threat, or Sunfall", () => {
    const under = table([
      { id: 1, source: blade, targets: [10] },
      { id: 2, source: spell(23, "Brainstorm", "Atraxa", "Draw three cards, then put two cards from your hand on top of your library in any order.") },
    ]);
    expect(alarming(under)).toBe(false);
    const sunfall = table([{ id: 1, source: spell(24, "Sunfall", "Atraxa", "Exile all creatures. Incubate X.", "Sorcery") }]);
    expect(isCreatureSweep(topOf(sunfall)!, sunfall)).toBe(true);
    expect(alarming(sunfall)).toBe(true);
    expect(alarming(table([]))).toBe(false);
  });
});

describe("the catalog decodes tolerantly", () => {
  it("repairs what it can and skips what is not an entry", () => {
    const cat = decodeCatalog({
      Good: { name: "Good", faces: [{ name: "Good", type: "Artifact", text: "{T}: Add {C}.", power: null, colors: [], art: "cache/art/good.jpg" }], produces: ["C"] },
      NoFaces: { name: "NoFaces" },
      Wrong: { faces: [{ type: 7, power: 3, colors: "W", keywords: [1, "Flying"] }], produces: "G" },
      Junk: 42,
    });
    expect([...cat.keys()].sort()).toEqual(["Good", "NoFaces", "Wrong"]);
    expect(cat.get("Good")!.faces[0]).toMatchObject({ type: "Artifact", art: "cache/art/good.jpg", img: null, cost: "" });
    expect(cat.get("NoFaces")!.faces).toEqual([expect.objectContaining({ name: "NoFaces", type: "", text: "" })]);
    expect(cat.get("Wrong")!.faces[0]).toMatchObject({ name: "Wrong", type: "", power: "3", colors: [], keywords: ["Flying"] });
    expect(cat.get("Wrong")!.produces).toEqual([]);
    expect(decodeCatalog(null).size).toBe(0);
    expect(decodeCatalog({ More: { faces: [] } }, cat).size).toBe(4);
  });
});
