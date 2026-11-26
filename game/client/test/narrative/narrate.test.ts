// The narrative over the corpus (the first game, envelope after envelope, as the app would narrate each change set)
// and over hand-made tables for the readings the corpus lacks (a counterspell, Sunfall). The words are the old
// client's (live.js `take`, `recordLog`, `feed`, `noteLosses`, `recapHTML`, `status`); Forge's lines are kept as Forge
// wrote them, without its bracketed annotations.
import { describe, expect, it } from "vitest";
import { diff, logText, modelOf } from "../../src/model";
import type { ChangeSet, TableModel } from "../../src/model";
import * as narrative from "../../src/narrative";
import { mustNotMiss } from "../../src/scene/stage/backlog";
import type { Recap, State } from "../../src/narrative";
import {
  catalog,
  corpusRuns,
  corpusSnapshot,
  creature,
  land,
  spell,
  tableOf,
  token,
  viewerOf,
} from "../model/fixtures";
import type { TableSpec } from "../model/fixtures";

const modelNamed = (n: string): TableModel => {
  const m = modelOf(corpusSnapshot(n), catalog, viewerOf());
  if (!m) throw new Error(`${n} has no view`);
  return m;
};

/** The app's part: each snapshot's change set narrated as it is queued, then released once the scene has played it. */
class Story {
  s: State = narrative.initial;
  model: TableModel | null = null;
  seq = 0;
  last: ChangeSet | null = null;
  see(m: TableModel): this {
    this.last = diff(this.model, m, ++this.seq);
    this.s = narrative.narrate(this.s, this.last, m);
    this.model = m;
    return this;
  }
  played(): this {
    this.s = narrative.release(this.s, this.seq);
    return this;
  }
  get strip() {
    return narrative.logStripView(this.s, this.model);
  }
  get lines(): string[] {
    return this.strip.lines.map((l) => l.text);
  }
  get watch() {
    return narrative.watching(this.s, this.model);
  }
  get recap() {
    return narrative.recapView(this.s);
  }
  get sheet() {
    return narrative.logSheetView(this.s);
  }
}

const FIRST_GAME = corpusRuns().find((r) => r.includes("013-play-stack.json"))!;
/** The first game up to and including `last`, each set played before the next. */
function through(last: string, o: { playLast?: boolean } = {}): Story {
  const story = new Story();
  for (const n of FIRST_GAME.slice(FIRST_GAME.indexOf("009-play-commander-zone.json"), FIRST_GAME.indexOf(last) + 1)) {
    story.see(modelNamed(n));
    if (n !== last || o.playLast) story.played();
  }
  return story;
}

describe("the log strip and the log, over the first game", () => {
  it("the turn heads the strip in place of Forge's own turn line", () => {
    const st = through("009-play-commander-zone.json", { playLast: true });
    expect(st.strip.heading).toBe("Turn 2 · You");
    const headings = st.sheet.groups.map((g) => g.heading);
    expect(headings[0]).toEqual({ type: "turn", text: "Turn 2 · You" });
    expect(headings).toContainEqual({ type: "turn", text: "Turn 1 (Princess)" });
    // Forge's "Turn 2 (You)" became the heading: it is not there twice
    expect(st.s.entries.filter((e) => e.type === "turn" && /^Turn 2\b/.test(e.said)).length).toBe(1);
  });

  it("my spell goes on the stack: the prompt watches it on its way, and the strip tells the cast", () => {
    const st = through("013-play-stack.json");
    expect(st.watch).toEqual({ headline: "", arriving: [11], toStack: true, sweeping: false });
    expect(st.lines[0]).toBe("You cast Thorn of the Black Rose");
    st.played();
    expect(st.watch).toBeNull();
  });

  it("spells still on the stack are told as their casts, with their targets, newest first", () => {
    expect(through("014-play-opponent-spell-targets-me-stack-targets-card.json", { playLast: true }).lines).toEqual([
      "Dack cast Doom Blade targeting [Serra Angel]",
      "Atraxa cast Doom Blade targeting [Grizzly Bears]",
    ]);
  });

  it("the top resolves: what it did waits for the motion, then the log has Forge's line and the result", () => {
    const st = through("015-play-opponent-spell-targets-me.json");
    expect(st.s.notices.map((n) => n.motion)).toEqual(["Doom Blade resolves"]);
    expect(st.watch).toBeNull(); // the stack is still open: its summary shows, not the motion
    const told = () => st.sheet.groups[0]!.rows.map((r) => r.text);
    expect(told()).not.toContain("Doom Blade - Destroy Serra Angel.");
    st.played();
    expect(told().slice(0, 3)).toEqual([
      "Serra Angel went to the graveyard. Doom Blade - Destroy Serra Angel. Doom Blade went to the graveyard.",
      "Doom Blade - Destroy Serra Angel.",
      "Serra Angel was put into Graveyard from Battlefield.",
    ]);
    expect(st.sheet.groups[0]!.rows[0]!.type).toBe("result");
  });

  it("the stack empties: the prompt watches the spell enter; the strip then has the result's headline alone", () => {
    const st = through("016-order-mana-pool.json");
    expect(st.watch?.headline).toBe("Thorn of the Black Rose enters");
    st.played();
    expect(st.watch).toBeNull();
    expect(st.lines).toEqual(["Grizzly Bears went to the graveyard"]);
  });

  it("triggers go on the stack under the top one's name", () => {
    const st = through("017-play-mana-pool.json");
    expect(st.s.notices.at(-1)!.motion).toBe("Your Thorn ability");
    expect(st.watch?.arriving).toEqual([560, 559, 558]);
  });

  it("a card returning to my hand: unnamed on its way, named once there", () => {
    const st = through("024-targets-monarch.json");
    expect(st.watch?.headline).toBe("A card returning from the graveyard to your hand");
    expect(st.lines).not.toContain("Rancor returned from the graveyard to your hand");
    st.played();
    expect(st.lines[0]).toBe("Rancor returned from the graveyard to your hand");
  });

  it("a card drawn with no draw line in the log comes into the hand by name", () => {
    const st = through("029-choose-monarch.json", { playLast: true });
    expect(st.lines[0]).toBe("Into your hand · Arcane Signet");
  });
});

describe("losses on someone else's turn", () => {
  it("my creature exiled on Atraxa's turn: a loss notice once it has been seen, kept through the turn", () => {
    const st = through("033-block-attack-on-planeswalker-they-attack.json");
    expect(st.watch?.headline).toBe("Atraxa attacks");
    expect(st.recap).toBeNull(); // not told before it is seen
    st.played();
    expect(st.recap).toEqual({ title: "Lost: Thorn of the Black Rose (exile) ›", summary: "" });
    st.see(modelNamed("034-order-blocked-poison.json"));
    expect(st.watch?.headline).toBe("Combat damage");
    st.played();
    expect(st.recap).toEqual({ title: "Lost: Thorn of the Black Rose (exile) ›", summary: "" });
    st.see(modelNamed("035-play-face-down.json")).played();
    expect(st.recap).toBeNull(); // a new turn
    expect(narrative.lossReport(st.s)).toEqual([
      {
        name: "Thorn of the Black Rose",
        fate: "went to exile",
        why: "Swords to Plowshares - Exile Thorn of the Black Rose. You gains life equal to its power.",
      },
    ]);
    expect(st.sheet.losses).toBe("Your losses · 1 to exile");
  });

  it("several at once are counted by where they went, a token by its leaving play", () => {
    const st = through("038-play-watching.json", { playLast: true });
    expect(st.recap).toEqual({ title: "Lost 2: Face-down, Soldier Token ›", summary: "" });
    expect(
      narrative
        .lossReport(st.s)
        .slice(0, 2)
        .map((r) => r.fate),
    ).toEqual(["(token) left play", "went to the graveyard"]);
    st.s = narrative.dismissRecap(st.s);
    expect(st.recap).toBeNull();
  });

  it("on my own turn, nothing is noted as a loss", () => {
    expect(through("016-order-mana-pool.json", { playLast: true }).s.losses).toEqual([]);
  });
});

// ---- hand-made: a counterspell, Sunfall --------------------------------------------------------------------------

describe("a counterspell resolves", () => {
  const tokens = [101, 102, 103].map((id) => token(id, "Soldier Token", "You"));
  const blade = spell(842, "Doom Blade", "Atraxa", "Destroy target nonblack creature.");
  const counter = spell(850, "Counterspell", "You", "Counter target spell.");
  const bladeItem = { id: 900, source: blade, targets: [103], text: "Doom Blade (842) - Destroy Soldier Token (103)." };
  const counterItem = {
    id: 901,
    source: counter,
    targets: [842],
    text: "Counterspell (850) - Counter Doom Blade (842).",
  };
  const log2 = [
    { i: 10, type: "STACK_ADD", text: "Atraxa cast Doom Blade targeting [Soldier Token (103)]", card: 842 },
    { i: 11, type: "STACK_ADD", text: "You cast Counterspell targeting [Doom Blade (842)]", card: 850 },
  ];
  const log3 = [
    ...log2,
    { i: 12, type: "STACK_RESOLVE", text: "Counterspell (850) - Counter Doom Blade (842).", card: 850 },
    { i: 13, type: "STACK_RESOLVE", text: "Doom Blade (842) was countered.", card: 842 },
  ];
  const base: TableSpec = { active: "Atraxa", seats: { You: { battlefield: tokens } } };
  const before = tableOf({ ...base, stack: [bladeItem, counterItem], log: log2 });
  const after = tableOf({
    ...base,
    seats: { You: { battlefield: tokens, graveyard: [counter] }, Atraxa: { graveyard: [blade] } },
    stack: [],
    log: log3,
  });

  it("while it moves the strip says the counterspell is resolving; then what was countered and what it saved", () => {
    const st = new Story().see(before).played().see(after);
    expect(st.watch).toEqual({
      headline: "Doom Blade is countered",
      arriving: [],
      toStack: false,
      sweeping: false,
    });
    expect(st.strip).toEqual({
      heading: "Turn 5 · Atraxa",
      lines: [{ text: "Counterspell is resolving", draw: false }],
      tone: "one",
    });
    st.played();
    expect(st.strip.lines.map((l) => l.text)).toEqual([
      "Doom Blade was countered",
      "Soldier Token stayed on the battlefield",
    ]);
    expect(st.strip.tone).toBe("summary");
    const result = st.s.entries.find((e) => e.type === "result")!;
    expect(result.said).toBe(
      // what was targeted, then each item that left, the top (my counterspell) first, as live.js `outcomes` read them
      "Soldier Token stayed on the battlefield. Counterspell - Counter Doom Blade. Counterspell went to the graveyard. Doom Blade was countered. Doom Blade went to the graveyard.",
    );
    expect(st.recap).toBeNull(); // nothing of mine left
  });
});

describe("a spell that leaves the stack without resolving", () => {
  const blade = spell(842, "Doom Blade", "Atraxa", "Destroy target nonblack creature.");
  const item = { id: 900, source: blade, targets: [103], text: "Doom Blade (842) - Destroy Soldier Token (103)." };
  const cast = { i: 10, type: "STACK_ADD", text: "Atraxa cast Doom Blade targeting [Soldier Token (103)]", card: 842 };
  const base: TableSpec = { active: "Atraxa", seats: {} };
  const before = tableOf({ ...base, stack: [item], log: [cast] });
  const gone = (log: NonNullable<TableSpec["log"]>) => tableOf({ ...base, seats: { Atraxa: { graveyard: [blade] } }, stack: [], log });

  it("fizzles: the prompt says so, as Forge did, never that it resolves", () => {
    const st = new Story().see(before).played().see(gone([cast, { i: 11, type: "STACK_RESOLVE", text: "Doom Blade (842) fizzles.", card: 842 }]));
    expect(st.last!.changes.find((c) => c.t === "popped")).toMatchObject({ how: "fizzled" });
    expect(st.watch?.headline).toBe("Doom Blade fizzles");
  });
  it("gone with no word from Forge on how: the prompt says only that it left the stack", () => {
    const st = new Story().see(before).played().see(gone([cast]));
    expect(st.last!.changes.find((c) => c.t === "popped")).toMatchObject({ how: "unknown" });
    expect(st.watch?.headline).toBe("Doom Blade leaves the stack");
  });
});

describe("Sunfall resolves on Atraxa's turn", () => {
  const sunfall = spell(
    951,
    "Sunfall",
    "Atraxa",
    "Exile all creatures. Incubate X, where X is the number of creatures exiled this way.",
    "Sorcery",
  );
  const bears = creature(10, "Grizzly Bears", "You");
  const giant = creature(20, "Hill Giant", "Atraxa", 3, 3);
  const incubator = token(70, "Incubator", "Atraxa", 0, 0, {
    type: "Artifact - Incubator",
    power: null,
    toughness: null,
    counters: { "+1/+1": 2 },
  });
  const lands: TableSpec["seats"] = {
    You: { battlefield: [land(1, "Plains", "You"), bears] },
    Atraxa: { battlefield: [giant] },
  };
  const cast = [{ i: 39, type: "STACK_ADD", text: "Atraxa cast Sunfall", card: 951 }];
  const before = tableOf({ active: "Atraxa", seats: lands, stack: [{ id: 961, source: sunfall }], log: cast });
  const after = tableOf({
    active: "Atraxa",
    seats: {
      You: { battlefield: [land(1, "Plains", "You")], exile: [bears] },
      Atraxa: { battlefield: [incubator], graveyard: [sunfall], exile: [giant] },
    },
    log: [
      ...cast,
      { i: 40, type: "STACK_RESOLVE", text: "Sunfall (951) - Exile all creatures. Incubate 2.", card: 951 },
    ],
  });

  it("the prompt watches the sweep in red; the strip then has Sunfall's headline and the caster's Incubator", () => {
    const st = new Story().see(before).played().see(after);
    expect(st.watch).toEqual({
      headline: "Sunfall resolves",
      arriving: [],
      toStack: false,
      sweeping: true,
    });
    st.played();
    expect(st.strip.lines.map((l) => l.text)).toEqual([
      "Sunfall exiled creatures",
      "Atraxa's Incubator · 2 +1/+1 counters",
    ]);
    expect(st.recap).toEqual({ title: "Lost: Grizzly Bears (exile) ›", summary: "" });
  });
});

describe("my own Sunfall, played compressed", () => {
  it("reports what it exiled of mine, never itself or the Incubator it makes", () => {
    const sunfall = spell(951, "Sunfall", "You", "Exile all creatures. Incubate X, where X is the number of creatures exiled this way.", "Sorcery");
    const bears = creature(10, "Grizzly Bears", "You");
    const giant = creature(20, "Hill Giant", "Atraxa", 3, 3);
    const incubator = token(70, "Incubator", "You", 0, 0, { type: "Artifact - Incubator", power: null, toughness: null, counters: { "+1/+1": 2 } });
    const cast = [{ i: 39, type: "STACK_ADD", text: "You cast Sunfall", card: 951 }];
    const before = tableOf({ active: "You", seats: { You: { battlefield: [land(1, "Plains", "You"), bears] }, Atraxa: { battlefield: [giant] } }, stack: [{ id: 961, source: sunfall }], log: cast });
    const after = tableOf({
      active: "You",
      seats: { You: { battlefield: [land(1, "Plains", "You"), incubator], exile: [bears], graveyard: [sunfall] }, Atraxa: { exile: [giant] } },
      log: [...cast, { i: 40, type: "STACK_RESOLVE", text: "Sunfall (951) - Exile all creatures. Incubate 2.", card: 951 }],
    });
    const st = new Story().see(before).played().see(after);
    const me = st.model!.viewer.perspective;
    const recaps = mustNotMiss(st.last!, me, () => false, "compressed");
    expect(recaps.map((r) => r.why)).toContain("sweep");
    const lost = narrative.recapped(st.s, recaps, st.model!).losses.map((l) => l.name);
    expect(lost).toEqual(["Grizzly Bears"]);
  });
});

describe("large loss notices", () => {
  const recap = (names: string[], tokens: number) => {
    const losses: State["losses"] = [
      ...names.map((name) => ({ name, where: "to exile", token: false })),
      ...Array.from({ length: tokens }, () => ({ name: "Thopter", where: "away", token: true })),
    ].map((loss, i) => ({ ...loss, id: i, card: i as State["losses"][number]["card"], why: "", wait: null }));
    return narrative.recapView({ ...narrative.initial, losses, recap: losses.map((loss) => loss.id) })?.title;
  };

  it("counts cards by destination and tokens when most of the losses are tokens", () => {
    expect(recap(Array(8).fill("Creature"), 14)).toBe("Lost 22: 8 cards to exile, 14 tokens ›");
    expect(recap([], 5)).toBe("Lost 5: 5 tokens ›");
  });

  it("names the first two nontoken cards when most of the losses are cards", () => {
    expect(recap(["Princess Yue", "Faerie Mastermind", "Whirler Rogue", "Tiller Engine", "Mulldrifter"], 2))
      .toBe("Lost 7: Princess Yue, Faerie Mastermind +5 ›");
  });
});

// ---- resets, releases, recaps, bounds ----------------------------------------------------------------------------

describe("what waits, and for how long", () => {
  it('a release frees only the sets played; "all" frees the rest', () => {
    const st = through("013-play-stack.json");
    st.see(modelNamed("014-play-opponent-spell-targets-me-stack-targets-card.json"));
    expect(st.s.notices.map((n) => n.seq)).toEqual([st.seq - 1, st.seq]);
    st.s = narrative.release(st.s, st.seq - 1);
    expect(st.s.notices.map((n) => n.seq)).toEqual([st.seq]);
    st.s = narrative.release(st.s, "all");
    expect(st.s.notices).toEqual([]);
    expect(st.s.entries.every((e) => e.wait === null)).toBe(true);
  });

  it("a cut to another position starts the story again (ids keep rising)", () => {
    const st = through("044-mode-i-attack.json", { playLast: true });
    const serial = st.s.serial;
    const other = corpusRuns().find((r) => r.includes("045-choose-watching.json"))!;
    const m = modelNamed(other[0]!);
    st.see(m);
    expect(st.last!.changes[0]).toMatchObject({ t: "reset" });
    expect(st.s.losses).toEqual([]);
    // its own lines and its heading (in place of Forge's "Turn 6 (Atraxa)"), nothing older
    // and the line for going back (live.js `restored`), the strip's newest
    const said = new Set([
      ...m.log.map((e) => logText(e.text)),
      "Turn 6 · Atraxa",
      "Back to Atraxa's main phase.",
    ]);
    expect(st.s.entries.map((e) => e.said).filter((x) => !said.has(x))).toEqual([]);
    expect(st.strip.heading).toBe("Turn 6 · Atraxa");
    expect(st.s.entries[0]!.id).toBeGreaterThan(serial);
  });

  it("recaps of sets the player did not see: their notices go, and a loss of mine they carry is noted once", () => {
    const st = through("016-order-mana-pool.json"); // Grizzly Bears (817) destroyed on my own turn: no loss noted
    const recap: Recap = {
      seq: st.seq,
      rev: st.model!.rev,
      how: "collapsed",
      kind: "resolve",
      reading: "resolve",
      why: "lost",
      seats: ["You" as never],
      cards: [817 as never],
    };
    st.s = narrative.recapped(st.s, [recap, recap], st.model!);
    expect(st.s.notices).toEqual([]);
    expect(st.recap).toEqual({ title: "Lost: Grizzly Bears (graveyard) ›", summary: "" });
    expect(st.s.missed.length).toBe(2);
    // a sweep's cards that are not mine are not my losses
    const sweep: Recap = { ...recap, why: "sweep", cards: [832 as never] };
    expect(narrative.recapped(st.s, [sweep], st.model!).losses.length).toBe(1);
  });

  it("memory is bounded: the log, the strip's candidates, the notices, the recaps and the toasts", () => {
    const st = new Story();
    const base: TableSpec = { active: "Atraxa", seats: {} };
    for (let k = 0; k < 300; k++) {
      const log = [0, 1].map((j) => ({
        i: 2 * k + j,
        type: "LIFE",
        text: `Life: Atraxa ${40 - k} > ${39 - k}` + (j ? " again" : ""),
      }));
      const spellK = spell(5000 + k, "Lightning Bolt", "Atraxa", "Lightning Bolt deals 3 damage to any target.");
      st.see(tableOf({ ...base, turn: 5, stack: [{ id: 7000 + k, source: spellK }], log }));
    }
    expect(st.s.entries.length).toBe(narrative.LOG_KEPT);
    expect(st.s.latest.length).toBe(narrative.LATEST_KEPT);
    expect(st.s.notices.length).toBe(narrative.NOTICES_KEPT);
    const recaps = Array.from({ length: 50 }, (_, k): Recap => ({
      seq: k,
      rev: "",
      how: "compressed",
      kind: "cast",
      reading: "cast",
      why: "targeted",
      seats: [],
      cards: [],
    }));
    expect(narrative.recapped(st.s, recaps, st.model!).missed.length).toBe(narrative.RECAPS_KEPT);
    let s = st.s;
    const ids: number[] = [];
    for (let k = 0; k < 6; k++) {
      const r = narrative.toast(s, `toast ${k}`, "info", k);
      s = r.state;
      ids.push(r.id);
      if (k >= narrative.TOASTS_KEPT) expect(r.expired).toEqual([ids[k - narrative.TOASTS_KEPT]]);
    }
    expect(s.toasts.map((t) => t.text)).toEqual(["toast 2", "toast 3", "toast 4", "toast 5"]);
    expect(narrative.expire(s, ids[5]!).toasts.length).toBe(3);
  });
});
