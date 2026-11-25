// The account's words against the spec's tables ("Told, not shown", section 3): the turn-9 and turn-15 boards of the game
// clip, with the cards the spec has standing left out of the account.
import { describe, expect, it } from "vitest";
import { boardOf } from "../../../src/layout/board";
import type { SeatBoard } from "../../../src/layout/board";
import { accountOf, byImportance } from "../../../src/layout/told/account";
import type { Account } from "../../../src/layout/told/account";
import { seatId } from "../../../src/model";
import type { CardId } from "../../../src/protocol";
import { gameAt } from "./clip";

/** A seat's account, every permanent written but those named standing, its lands and rocks, and its planeswalkers. */
function written(board: SeatBoard, standing: readonly string[]): Set<CardId> {
  const isMana = (c: SeatBoard["cards"][number]) => !c.creature && !c.planeswalker && !c.specialLand && (c.land || c.manaRock || c.treasure);
  return new Set(board.cards.filter((c) => !isMana(c) && !c.planeswalker && !standing.includes(c.name)).map((c) => c.id));
}

/** The account as text, a line each, marks as ▮ (ready) and ▬ (tapped). */
function lines(a: Account): string[] {
  const marks = (m: readonly boolean[]) => m.map((t) => (t ? "▬" : "▮")).join("");
  return [
    ...(a.tally ? [`${a.tally.power} power · ${a.tally.creatures} creatures`] : []),
    ...a.traits.map((t) => t.text),
    ...a.entries.map((e) => [e.text, marks(e.marks), e.trait].filter(Boolean).join(" ")),
    ...a.works.map((w) => w.text),
  ];
}

const seat = (turn: 9 | 15, name: string) => boardOf(gameAt(turn), seatId(name));

describe("the account at turn 15", () => {
  it("Marath: 92 power, three kinds, five more, the works", () => {
    const b = seat(15, "Marath");
    const a = accountOf(b, written(b, ["Marath, Will of the Wild", "Rishkar, Peema Renegade", "Herd Baloth", "Evolution Witness", "Generous Patron"]), { width: 40 });
    expect(lines(a)).toEqual([
      "92 power · 33 creatures",
      "Beast 4/4 ×9 ▮▮▮▮▮▮▮▬▬",
      "Elemental 3/3 ×8 ▮▮▮▮▮▮▬▬",
      "Cat Beast 2/2 ×6 ▮▮▮▮▬▬",
      "5 more · 6 power ▮▮▮▮▬",
      "Felidar Retreat · Song of the Worldsoul",
      "Unbound Flourishing · +2",
    ]);
    expect(a.lines).toBe(7);
  });

  it("Atraxa: the fliers counted with their power, her own traits by name", () => {
    const b = seat(15, "Atraxa");
    const a = accountOf(b, written(b, ["Atraxa, Praetors' Voice", "Glissa, Herald of Predation", "Steel Overseer", "Tekuthal, Inquiry Dominus"]), { width: 36 });
    expect(lines(a)).toEqual([
      "42 power · 21 creatures",
      "11 fly (21 power)",
      "Atraxa deathtouch, lifelink",
      "Thopter 1/1 ×8 ▮▮▮▮▮▮▬▬ fly",
      "Construct 0/0 ×3 ▮▮▬",
      "6 more · 9 power ▮▮▮▮▮▮",
      "Throne of Geth · Incubator ×3 · +2", // works go by arrival: the Incubators came before Paladin Class
    ]);
  });

  it("Dack: the works take the lines left", () => {
    const b = seat(15, "Dack");
    const a = accountOf(b, written(b, ["Dack Fayden, Helping Hand", "Wispweaver Angel", "Restoration Angel", "Felidar Guardian"]), { width: 52 });
    expect(lines(a)).toEqual([
      "21 power · 13 creatures",
      "8 fly (13 power)",
      "Spirit 1/1 ×6 ▮▮▮▮▬▬ fly",
      "3 more · 3 power ▮▮▮",
      "Rule of Law · Smothering Tithe · Thorn of Amethyst",
      // (Lion's Eye Diamond makes no mana with {T}: it is a work, not a rock in the well.)
      "Lion's Eye Diamond · Trinisphere · Deafening Silence",
      "Suppression Field · Defense Grid · Cursed Totem",
    ]);
  });

  it("every clause carries the cards it counted, and every written card is in the account once", () => {
    const b = seat(15, "Marath");
    const w = written(b, ["Marath, Will of the Wild"]);
    const a = accountOf(b, w);
    expect(new Set(a.written)).toEqual(w);
    expect(a.written.length).toBe(w.size);
    expect(a.tally!.ids.length).toBe(33);
    for (const e of a.entries) expect(e.ids.length).toBe(e.marks.length);
  });
});

describe("the account at turn 9", () => {
  it("Marath: a single unlike card is named", () => {
    const b = seat(9, "Marath");
    const a = accountOf(b, written(b, ["Marath, Will of the Wild", "Herd Baloth", "Kami of Whispered Hopes", "Pollenbright Druid", "Incubation Druid"]), { width: 62 });
    expect(lines(a)).toEqual([
      "34 power · 13 creatures",
      "Beast 4/4 ×3 ▮▮▬",
      "Elemental 3/3 ×2 ▮▬",
      "Cat Beast 2/2 ×2 ▮▬",
      "Evolution Sage 3/2 ▬",
      "Felidar Retreat · Song of the Worldsoul · Unbound Flourishing",
    ]);
  });

  it("Atraxa: identical works are counted", () => {
    const b = seat(9, "Atraxa");
    const a = accountOf(b, written(b, ["Atraxa, Praetors' Voice", "Glissa, Herald of Predation", "Steel Overseer", "Chrome Host Seedshark"]), { width: 40 });
    expect(lines(a)).toEqual([
      "21 power · 9 creatures",
      "4 fly (10 power)",
      "Atraxa deathtouch, lifelink",
      "Thopter 1/1 ×2 ▮▬ fly",
      "3 more · 1 power ▮▮▮",
      "Throne of Geth · Incubator ×2",
    ]);
  });
});

describe("who stands", () => {
  it("ranks by power, legend, combat keyword, less tapped and tokens; ties by toughness, then age", () => {
    const b = seat(15, "Atraxa");
    const order = b.cards.filter((c) => c.creature && !c.commander && !c.token).sort(byImportance).map((c) => c.name);
    expect(order.slice(0, 3)).toEqual(["Tekuthal, Inquiry Dominus", "Glissa, Herald of Predation", "Steel Overseer"]);
    const m = seat(9, "Marath");
    const mo = m.cards.filter((c) => c.creature && !c.commander && !c.token).sort(byImportance).map((c) => c.name);
    expect(mo.slice(0, 4)).toEqual(["Herd Baloth", "Kami of Whispered Hopes", "Pollenbright Druid", "Incubation Druid"]);
  });
});
