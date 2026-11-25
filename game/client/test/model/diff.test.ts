// diff on hand-made model pairs: the scenarios the delta must tell right (a countered removal, a board wipe, a
// two-seat attack and its blocks), resets, and ordering by the log.
import { describe, expect, it } from "vitest";
import { diff } from "../../src/model";
import type { Change, ChangeSet, Moment, TableModel } from "../../src/model";
import { boardOf } from "../../src/layout";
import { card, creature, land, spell, tableOf, token } from "./fixtures";
import type { TableSpec, WireCard } from "./fixtures";
import { expectPartition } from "./laws";

const changesOf = (set: ChangeSet, m: Moment): Change[] => m.changes.map((i) => set.changes[i]!);
const kinds = (set: ChangeSet) => set.moments.map((m) => `${m.kind}:${m.reading}`);
const run = (a: TableModel, b: TableModel, seq = 1) => {
  const set = diff(a, b, seq);
  expectPartition(set);
  return set;
};

// ---- S1: a removal aimed at one of my five identical tokens, my counterspell, both resolve ------------------------

describe("S1: an opponent's removal on one of my 5 identical tokens, countered", () => {
  const tokens = [101, 102, 103, 104, 105].map((id) => token(id, "Soldier Token", "You"));
  const blade = spell(842, "Doom Blade", "Atraxa", "Destroy target nonblack creature.");
  const counter = spell(850, "Counterspell", "You", "Counter target spell.");
  const bladeItem = { id: 900, source: blade, targets: [103], text: "Doom Blade (842) - Destroy Soldier Token (103)." };
  const counterItem = { id: 901, source: counter, targets: [842], text: "Counterspell (850) - Counter Doom Blade (842)." };
  const log1 = [{ i: 10, type: "STACK_ADD", text: "Atraxa cast Doom Blade targeting [Soldier Token (103)]", card: 842 }];
  const log2 = [...log1, { i: 11, type: "STACK_ADD", text: "You cast Counterspell targeting [Doom Blade (842)]", card: 850 }];
  const log3 = [
    ...log2,
    { i: 12, type: "STACK_RESOLVE", text: "Counterspell (850) - Counter Doom Blade (842).", card: 850 },
    { i: 13, type: "STACK_RESOLVE", text: "Doom Blade (842) was countered.", card: 842 },
  ];
  const base: TableSpec = { active: "Atraxa", seats: { You: { battlefield: tokens, hand: [counter] } } };
  const a = tableOf({ ...base, stack: [bladeItem], log: log1 });
  const b = tableOf({ ...base, seats: { You: { battlefield: tokens } }, stack: [bladeItem, counterItem], log: log2 });
  const c = tableOf({ ...base, seats: { You: { battlefield: tokens, graveyard: [counter] }, Atraxa: { graveyard: [blade] } }, stack: [], log: log3 });

  it("the five tokens are one pile to the eye", () => {
    const pile = boardOf(a, "You" as never).cards;
    expect(new Set(pile.map((x) => x.sig)).size).toBe(1);
  });

  it("my counterspell goes on the stack: one cast moment, ordered by the log", () => {
    const set = run(a, b);
    expect(kinds(set)).toEqual(["cast:cast"]);
    expect(set.changes.map((x) => x.t)).toEqual(["pushed", "moved"]);
    const moved = set.changes[1] as Extract<Change, { t: "moved" }>;
    expect([moved.kind, moved.from, moved.to, moved.before?.zone, moved.after?.zone]).toEqual(["cast", "hand", "stack", "hand", "stack"]);
    expect(set.moments[0]!.cause).toEqual({ item: 901, card: 850 });
    expect(set.order).toBe("log");
  });

  it("both resolve to graveyards in one counter moment; the token stays and is saved", () => {
    const set = run(b, c);
    expect(kinds(set)).toEqual(["resolve:counter"]);
    const m = set.moments[0]!;
    expect(changesOf(set, m).map((x) => (x.t === "popped" ? `popped ${x.item.id} ${x.how}` : x.t === "moved" ? `${x.kind} ${x.card}` : x.t))).toEqual([
      "popped 901 resolved",
      "spent 850",
      "popped 900 countered",
      "spent 842",
    ]);
    expect(m.cause).toEqual({ item: 901, card: 850 });
    expect(m.detail).toEqual({ t: "counter", countered: 900, by: 901, saved: [103] });
    expect(set.changes.some((x) => "card" in x && x.card === 103)).toBe(false);
    expect([...set.involved].sort()).toEqual(["Atraxa", "You"]);
    expect(set.order).toBe("log");
  });

  it("without the log, the pops' causes are unknown and nothing is guessed", () => {
    const set = run(b, tableOf({ ...base, seats: { You: { battlefield: tokens, graveyard: [counter] }, Atraxa: { graveyard: [blade] } }, stack: [], log: log2 }));
    const pops = set.changes.filter((x) => x.t === "popped");
    expect(pops.map((x) => x.t === "popped" && x.how)).toEqual(["unknown", "unknown"]);
    expect(kinds(set)).toEqual(["resolve:resolve", "resolve:resolve"]);
    expect(set.moments.every((m) => m.detail === null)).toBe(true);
    // inferred: the top (my counterspell) first
    expect(set.changes.map((x) => (x.t === "popped" ? x.item.id : null)).filter((x) => x !== null)).toEqual([901, 900]);
    expect(set.order).toBe("inferred");
  });
});

// ---- S2: a board wipe ----------------------------------------------------------------------------------------------

describe("S2: a board wipe across four seats", () => {
  const damnation = spell(950, "Damnation", "Atraxa", "Destroy all creatures. They can't be regenerated.", "Sorcery");
  // 14 creatures: 3 of them tokens, 2 that will be exiled instead, plus lands that stay and an Aura that falls off
  const you = [creature(1, "Grizzly Bears", "You"), creature(2, "Hill Giant", "You", 3, 3), token(3, "Soldier Token", "You"), token(4, "Soldier Token", "You")];
  const atraxa = [creature(5, "Serra Angel", "Atraxa", 4, 4), creature(6, "Soul Warden", "Atraxa", 1, 1), creature(7, "Copper Myr", "Atraxa", 1, 1), token(8, "Spirit Token", "Atraxa")];
  const dack = [creature(9, "Glistener Elf", "Dack", 1, 1), creature(10, "Blighted Agent", "Dack", 1, 1), creature(11, "Fiend Hunter", "Dack", 1, 3)];
  const princess = [creature(12, "Restoration Angel", "Princess", 3, 4), creature(13, "Meloku the Clouded Mirror", "Princess", 2, 4), creature(14, "Willbender", "Princess", 1, 2)];
  const rancor = card(15, "Rancor", "You", "Enchantment - Aura", { attachedTo: 1 });
  const lands = (seat: "You" | "Atraxa" | "Dack" | "Princess", id: number) => [land(id, "Plains", seat)];
  const tokens = new Set([3, 4, 8]), exiled = new Set([12, 13]);
  const dead = (ws: readonly WireCard[]) => ws.filter((w) => !tokens.has(w.id) && !exiled.has(w.id));
  const before: TableSpec = {
    active: "Atraxa",
    seats: {
      You: { battlefield: [...you, rancor, ...lands("You", 21)] },
      Atraxa: { battlefield: [...atraxa, ...lands("Atraxa", 22)] },
      Dack: { battlefield: [...dack, ...lands("Dack", 23)] },
      Princess: { battlefield: [...princess, ...lands("Princess", 24)] },
    },
  };
  const after = (log: NonNullable<TableSpec["log"]>, wipe: WireCard[] = [damnation]): TableSpec => ({
    active: "Atraxa",
    seats: {
      You: { battlefield: lands("You", 21), graveyard: [...dead(you), rancor] },
      Atraxa: { battlefield: lands("Atraxa", 22), graveyard: [...dead(atraxa), ...wipe] },
      Dack: { battlefield: lands("Dack", 23), graveyard: dead(dack) },
      Princess: { battlefield: lands("Princess", 24), graveyard: dead(princess), exile: princess.filter((w) => exiled.has(w.id)) },
    },
    log,
  });
  const resolveLog = [{ i: 40, type: "STACK_RESOLVE", text: "Damnation (950) - Destroy all creatures. They can't be regenerated.", card: 950 }];

  const check = (set: ChangeSet, reading: string) => {
    expect(set.moments.length).toBe(1);
    const m = set.moments[0]!;
    expect(`${m.kind}:${m.reading}`).toBe(`sweep:${reading}`);
    const moves = changesOf(set, m).filter((x): x is Extract<Change, { t: "moved" }> => x.t === "moved" && x.from === "battlefield");
    expect(moves.length).toBe(15); // 14 creatures and the Aura on one of them
    expect(moves.filter((x) => x.kind === "token-gone").map((x) => x.card).sort((p, q) => p - q)).toEqual([3, 4, 8]);
    expect(moves.filter((x) => x.kind === "exile").map((x) => x.card).sort((p, q) => p - q)).toEqual([12, 13]);
    expect(moves.filter((x) => x.kind === "die").length).toBe(10);
    // the token-gone change still shows the token as it was
    expect(moves.find((x) => x.card === 3)!.before?.face.name).toBe("Soldier Token");
    expect([...set.involved].sort()).toEqual(["Atraxa", "Dack", "Princess", "You"]);
  };

  it("one sweep moment holds every departure, the spell first", () => {
    const set = run(tableOf({ ...before, stack: [{ id: 960, source: damnation }] }), tableOf(after(resolveLog)));
    check(set, "sweep");
    expect(set.changes[0]).toMatchObject({ t: "popped", how: "resolved" });
    expect(set.moments[0]!.cause).toEqual({ item: 960, card: 950 });
  });

  it("a wipe cast and resolved inside one poll interval is still one sweep, read from the log", () => {
    // Damnation was never seen on the stack: it went from Atraxa's hidden hand to her graveyard
    const set = run(tableOf(before), tableOf(after([{ i: 39, type: "STACK_ADD", text: "Atraxa cast Damnation", card: 950 }, ...resolveLog])));
    expect(kinds(set)).toEqual(["sweep:sweep"]);
    const sweep = set.moments[0]!;
    expect(sweep.cause).toEqual({ item: null, card: 950 });
    expect(changesOf(set, sweep).filter((x) => x.t === "moved").length).toBe(16); // the departures and Damnation's own trip
  });

  it("Sunfall reads as Sunfall, exiling, with the Incubator it leaves", () => {
    const sunfall = spell(951, "Sunfall", "Atraxa", "Exile all creatures. Incubate X, where X is the number of creatures exiled this way.", "Sorcery");
    const all = [...you, ...atraxa, ...dack, ...princess];
    const incubator = token(70, "Incubator", "Atraxa", 0, 0, { type: "Artifact - Incubator", power: null, toughness: null, counters: { "+1/+1": 14 } });
    const set = run(
      tableOf({ ...before, stack: [{ id: 961, source: sunfall }] }),
      tableOf({
        active: "Atraxa",
        seats: {
          You: { battlefield: lands("You", 21), graveyard: [rancor], exile: you.filter((w) => !tokens.has(w.id)) },
          Atraxa: { battlefield: [...lands("Atraxa", 22), incubator], graveyard: [sunfall], exile: atraxa.filter((w) => !tokens.has(w.id)) },
          Dack: { battlefield: lands("Dack", 23), exile: dack },
          Princess: { battlefield: lands("Princess", 24), exile: princess },
        },
        log: [{ i: 40, type: "STACK_RESOLVE", text: "Sunfall (951) - Exile all creatures. Incubate 14.", card: 951 }],
      }),
    );
    expect(kinds(set)).toEqual(["sweep:sunfall"]);
    const moved = changesOf(set, set.moments[0]!).filter((x): x is Extract<Change, { t: "moved" }> => x.t === "moved");
    expect(moved.filter((x) => x.from === "battlefield").length).toBe(all.length + 1);
    expect(moved.some((x) => x.card === 70 && x.kind === "token")).toBe(true);
  });
});

// ---- S3: two opponents attack with six, I block with three -------------------------------------------------------

describe("S3: two opponents attack with 6, I block with 3", () => {
  const hers = [creature(1, "Serra Angel", "Atraxa", 4, 4), creature(2, "Hill Giant", "Atraxa", 3, 3), creature(3, "Grizzly Bears", "Atraxa"), creature(4, "Soul Warden", "Atraxa", 1, 1)];
  const his = [creature(5, "Blighted Agent", "Dack", 1, 1), creature(6, "Glistener Elf", "Dack", 1, 1)];
  const mine = [creature(11, "Restoration Angel", "You", 3, 4), creature(12, "Fiend Hunter", "You", 1, 3), creature(13, "Willbender", "You", 1, 2), creature(14, "Copper Myr", "You", 1, 1)];
  const tapped = (ws: readonly WireCard[]) => ws.map((w) => ({ ...w, tapped: true }));
  const attackers = [...hers, ...his].map((w) => ({ id: w.id, defender: "You" }));
  const blocks = [
    { id: 11, blocking: 1 },
    { id: 12, blocking: 3 },
    { id: 13, blocking: 5 },
  ];
  const seats = (atk: boolean, extra: Partial<TableSpec["seats"]> = {}): TableSpec["seats"] => ({
    You: { battlefield: mine },
    Atraxa: { battlefield: atk ? tapped(hers) : hers },
    Dack: { battlefield: atk ? tapped(his) : his },
    ...extra,
  });
  const begin = tableOf({ active: "Atraxa", phase: "COMBAT_BEGIN", seats: seats(false) });
  const declared = tableOf({ active: "Atraxa", phase: "COMBAT_DECLARE_ATTACKERS", seats: seats(true), combat: { attackers } });
  const blocked = tableOf({ active: "Atraxa", phase: "COMBAT_DECLARE_BLOCKERS", seats: seats(true), combat: { attackers, blockers: blocks } });

  it("attackers declared: an assault moment per attacking seat, each with its attackers tapping", () => {
    const set = run(begin, declared);
    expect(kinds(set)).toEqual(["turn:turn", "assault:assault", "assault:assault"]);
    const [, a, d] = set.moments;
    expect(changesOf(set, a!).filter((x) => x.t === "attacks").length).toBe(4);
    expect(changesOf(set, a!).filter((x) => x.t === "tapped").length).toBe(4);
    expect(changesOf(set, d!).filter((x) => x.t === "attacks").length).toBe(2);
    expect(a!.seats).toEqual(expect.arrayContaining(["Atraxa", "You"]));
    expect(d!.seats).toEqual(expect.arrayContaining(["Dack", "You"]));
  });

  it("blockers declared: one blocks moment with my three blocks", () => {
    const set = run(declared, blocked);
    expect(kinds(set)).toEqual(["turn:turn", "blocks:blocks"]);
    const m = set.moments[1]!;
    expect(changesOf(set, m).map((x) => x.t === "blocked" && [x.block.blocker, x.block.attacker])).toEqual([
      [11, 1],
      [12, 3],
      [13, 5],
    ]);
  });

  it("combat damage: the fighters that died and the life lost are one combat moment; then the combatants return", () => {
    const damage = tableOf({
      active: "Atraxa",
      phase: "COMBAT_DAMAGE",
      seats: seats(true, {
        You: { battlefield: [mine[0]!, mine[3]!], graveyard: [mine[1]!, mine[2]!], life: 34 },
        Atraxa: { battlefield: tapped([hers[0]!, hers[1]!, hers[3]!]), graveyard: [hers[2]!] },
      }),
      combat: { attackers, blockers: blocks },
    });
    const set = run(blocked, damage);
    expect(kinds(set)).toEqual(["turn:turn", "combat:combat-damage"]);
    const m = changesOf(set, set.moments[1]!);
    expect(m.filter((x) => x.t === "moved").map((x) => x.t === "moved" && x.card)).toEqual([3, 12, 13]);
    expect(m.filter((x) => x.t === "life")).toEqual([{ t: "life", seat: "You", from: 40, to: 34 }]);
    const end = tableOf({ active: "Atraxa", phase: "COMBAT_END", seats: seats(true, { You: { battlefield: [mine[0]!, mine[3]!], graveyard: [mine[1]!, mine[2]!], life: 34 }, Atraxa: { battlefield: tapped([hers[0]!, hers[1]!, hers[3]!]), graveyard: [hers[2]!] } }) });
    expect(kinds(run(damage, end))).toEqual(["turn:turn", "combat:combat-over"]);
  });
});

// ---- resets ---------------------------------------------------------------------------------------------------------

describe("resets", () => {
  const t = tableOf({ seats: { You: { battlefield: [creature(1, "Grizzly Bears", "You")] } }, log: [{ i: 5, type: "LAND", text: "You played Plains (2)", card: 2 }] });
  it("the first model is a reset", () => {
    const set = diff(null, t, 0);
    expect(set.changes).toEqual([{ t: "reset", why: "first" }]);
    expect(kinds(set)).toEqual(["other:reset"]);
    expectPartition(set);
  });
  it("a new game (gen) is a reset, however alike the tables", () => {
    const set = run(t, tableOf({ gen: 2, seats: { You: { battlefield: [creature(1, "Grizzly Bears", "You")] } } }), 3);
    expect(set.changes).toEqual([{ t: "reset", why: "game" }]);
    expect(set.seq).toBe(3);
  });
  it("a view that goes back a turn, or loses the log it carried on from, is a reset (live.js jump)", () => {
    // Both went back (an earlier turn; the same turn with a log that ends earlier): nothing was on the stack to set aside.
    expect(run(t, tableOf({ turn: 4, seats: {} })).changes).toEqual([{ t: "reset", why: "jump", back: { aside: [] } }]);
    expect(
      run(t, tableOf({ seats: {}, log: [{ i: 3, type: "LAND", text: "You played Island (9)", card: 9 }] })).changes,
    ).toEqual([{ t: "reset", why: "jump", back: { aside: [] } }]);
    expect(
      run(t, tableOf({ seats: {}, log: [{ i: 9, type: "LAND", text: "Dack played Island (9)", card: 9 }] })).changes[0]
        ?.t,
    ).not.toBe("reset");
  });
});

// ---- ordering inside one snapshot -----------------------------------------------------------------------------------

describe("ordering by the log", () => {
  const giant = creature(853, "Hill Giant", "You", 3, 3);
  const bears = creature(817, "Grizzly Bears", "You");
  const bolt = spell(851, "Lightning Bolt", "Princess", "Lightning Bolt deals 3 damage to any target.");
  const blade = spell(852, "Doom Blade", "Dack", "Destroy target nonblack creature.");

  it("a pop and a push in one snapshot: the resolution (and what it killed) before the next cast", () => {
    const a = tableOf({ seats: { You: { battlefield: [giant, bears] } }, stack: [{ id: 51, source: bolt, targets: [853] }] });
    const log = [
      { i: 20, type: "STACK_RESOLVE", text: "Lightning Bolt (851) - Lightning Bolt (851) deals 3 damage to Hill Giant (853).", card: 851 },
      { i: 21, type: "ZONE_CHANGE", text: "Hill Giant (853) was put into Graveyard from Battlefield.", card: 853 },
      { i: 22, type: "STACK_ADD", text: "Dack cast Doom Blade targeting [Grizzly Bears (817)]", card: 852 },
    ];
    const b = tableOf({ seats: { You: { battlefield: [bears], graveyard: [giant] }, Princess: { graveyard: [bolt] } }, stack: [{ id: 52, source: blade, targets: [817] }], log });
    const set = run(a, b);
    expect(kinds(set)).toEqual(["resolve:resolve", "cast:cast"]);
    expect(set.changes.map((x) => (x.t === "moved" ? `${x.kind} ${x.card}` : x.t))).toEqual(["popped", "spent 851", "die 853", "pushed", "cast 852"]);
    expect(set.order).toBe("log");
  });

  it("the log's order wins over the inferred one; without it the order is inferred and says so", () => {
    const a = tableOf({ seats: { You: { battlefield: [giant] }, Dack: { handCount: 5 } } });
    const after = (log: NonNullable<TableSpec["log"]>) => tableOf({ seats: { You: { graveyard: [giant] }, Dack: { handCount: 4 } }, stack: [{ id: 52, source: blade }], log });
    const logged = run(
      a,
      after([
        { i: 30, type: "ZONE_CHANGE", text: "Hill Giant (853) was put into Graveyard from Battlefield.", card: 853 },
        { i: 31, type: "STACK_ADD", text: "Dack cast Doom Blade", card: 852 },
      ]),
    );
    expect(logged.changes.filter((x) => x.t === "moved").map((x) => x.t === "moved" && x.card)).toEqual([853, 852]);
    expect(logged.order).toBe("log");
    const inferred = run(a, after([]));
    expect(inferred.changes.filter((x) => x.t === "moved").map((x) => x.t === "moved" && x.card)).toEqual([852, 853]);
    expect(inferred.order).toBe("inferred");
  });

  it("which of two spells killed a creature, with no log to say, stays unknown", () => {
    const a = tableOf({ seats: { You: { battlefield: [giant] } }, stack: [{ id: 51, source: bolt, targets: [853] }, { id: 52, source: blade, targets: [853] }] });
    const b = tableOf({ seats: { You: { graveyard: [giant] }, Princess: { graveyard: [bolt] }, Dack: { graveyard: [blade] } } });
    const set = run(a, b);
    const death = set.moments.find((m) => changesOf(set, m).some((x) => x.t === "moved" && x.card === 853))!;
    expect(`${death.kind}:${death.reading}`).toBe("other:unknown");
    expect(death.cause).toBeNull();
    // with one spell alone aimed at it, the death is that spell's
    const one = run(
      tableOf({ seats: { You: { battlefield: [giant] } }, stack: [{ id: 52, source: blade, targets: [853] }] }),
      tableOf({ seats: { You: { graveyard: [giant] }, Dack: { graveyard: [blade] } } }),
    );
    expect(kinds(one)).toEqual(["resolve:resolve"]);
  });
});
