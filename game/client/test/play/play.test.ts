// Behaviour to pin, item 2: `play` decisions. Option 1 is pass; the pass button's label by phase; a hand card let go
// 90 px up plays (one option sends, several open an offer sheet carrying the pose, none toasts); what glows opens its
// plays; a land whose only option is a mana ability activates it from the inspector. Corpus envelopes throughout;
// where a phase or an option the corpus lacks is needed, the envelope's view or decision is edited (said per test).
import { describe, expect, it } from "vitest";
import { Table, edited, idsOf, ofKind, raw, withDecision } from "./rig";

const passOf = (t: Table) => t.allButtons().find((b) => b.role === "pass");

describe("the pass button", () => {
  const cases: [string, () => ReturnType<typeof raw>, string][] = [
    ["my main phase (corpus 009)", () => raw("009-play-commander-zone.json"), "To combat"],
    ["my second main (corpus 026)", () => raw("026-play-monarch.json"), "End turn"],
    ["my end step (026, phase edited)", () => edited("026-play-monarch.json", (v) => void (v["phase"] = "END_OF_TURN")), "Pass"],
    ["their turn (026, active edited)", () => edited("026-play-monarch.json", (v) => void ((v["active"] = "Atraxa"), (v["phase"] = "MAIN1"))), "Pass"],
    [
      "attackers aimed at me (026, combat edited)",
      () =>
        edited("026-play-monarch.json", (v) => {
          v["active"] = "Atraxa";
          v["phase"] = "COMBAT_DECLARE_ATTACKERS";
          v["combat"] = { attackers: [{ id: 834, defender: "You" }], blockers: [] };
        }),
      "Pass toward blocks",
    ],
    ["an opponent's ability on the stack, nothing to answer it (corpus 030)", () => raw("030-play-watching.json"), "Pass priority"],
    ["an opponent's spell and responses on offer (corpus 048): plain Pass", () => raw("048-play-three-players.json"), "Pass"],
    ["my own spell on top (corpus 013): plain Pass", () => raw("013-play-stack.json"), "Pass"],
  ];
  it.each(cases)("%s: labelled by phase, last, and sends [1]", (_, env, label) => {
    const t = new Table();
    t.open(env());
    expect(passOf(t)?.label).toBe(label);
    expect(t.buttons().at(-1)).toBe(label);
    t.press(label);
    expect(t.answers()).toEqual([[1]]);
  });

  it("attackers aimed at me: the headline says so and the hint explains passing", () => {
    const t = new Table();
    t.open(
      edited("026-play-monarch.json", (v) => {
        v["active"] = "Atraxa";
        v["phase"] = "COMBAT_DECLARE_ATTACKERS";
        v["combat"] = { attackers: [{ id: 834, defender: "You" }], blockers: [] };
      }),
    );
    expect(t.p.controls.prompt?.headline).toBe("Before blocks");
    expect(t.p.controls.prompt?.hint).toBe("Passing advances toward your chance to block.");
  });

  it("with plays on offer the pass button keeps its label and the plays get their own button (corpus 009)", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    expect(t.buttons()).toEqual(["Choose a play (3)", "Let Forge decide", "To combat"]);
    expect(t.p.controls.prompt?.headline).toBe("Available plays");
    expect(t.p.controls.prompt?.where).toBe("Turn 2 · Your main phase");
  });
});

describe("a hand card let go (the 90 px rule)", () => {
  // corpus 012: Haywire Mite (33) has one play (option 2), Willbender (829) two (12, 13), the Forest (23) none
  const env = "012-play-mana-pool.json";

  it("less than 90 px up does nothing; 90 px or more with exactly one play sends it, carrying the pose", () => {
    const t = new Table();
    t.open(env);
    expect(t.release(33, -60)).toEqual([]);
    expect(t.release(33, -89)).toEqual([]);
    expect(t.answers()).toEqual([]);
    const fx = t.release(33, -90);
    const send = ofKind(fx, "send");
    expect(send).toHaveLength(1);
    expect(send[0]!.body).toMatchObject({ answer: [2] });
    expect(send[0]!.carried).toEqual({ card: 33, pose: expect.objectContaining({ rotation: 0, scale: 1 }) });
  });

  it("a card with several plays opens an offer sheet named for it, holding the card; a pick sends that play, carried", () => {
    const t = new Table();
    t.open(env);
    t.release(829, -120);
    expect(t.answers()).toEqual([]);
    const sheet = t.p.controls.sheet!;
    expect(sheet.kind).toBe("plays");
    expect(sheet.title).toBe("Willbender");
    expect(sheet.items.map((i) => i.option)).toEqual([12, 13]);
    expect(sheet.items.map((i) => i.label)).toEqual(["Cast Willbender", "Cast Willbender"]);
    expect(sheet.carried?.card).toBe(829);
    const fx = t.pick(13);
    expect(ofKind(fx, "send")[0]).toMatchObject({ body: { answer: [13] }, carried: { card: 829 } });
    expect(t.p.controls.sheet).toBeNull();
  });

  it("the offer sheet only takes its own options", () => {
    const t = new Table();
    t.open(env);
    t.release(829, -120);
    t.pick(2); // Haywire Mite's play, not on this sheet
    expect(t.answers()).toEqual([]);
  });

  it("dismissing the offer sheet sends nothing and the card can be played again", () => {
    const t = new Table();
    t.open(env);
    t.release(829, -120);
    t.dismiss();
    expect(t.p.controls.sheet).toBeNull();
    t.release(33, -100);
    expect(t.answers()).toEqual([[2]]);
  });

  it("90 px up but let go over the hand or off the table does nothing; the same release over the table plays", () => {
    const t = new Table();
    t.open(env);
    expect(t.release(33, -200, undefined, false)).toEqual([]);
    expect(t.answers()).toEqual([]);
    expect(t.p.controls.sheet).toBeNull();
    t.release(33, -200, undefined, true);
    expect(t.answers()).toEqual([[2]]);
  });

  it("a card with no play toasts and sends nothing", () => {
    const t = new Table();
    t.open(env);
    expect(ofKind(t.release(23, -140), "toast")).toEqual([{ kind: "toast", text: "You can't play that now" }]);
    expect(t.answers()).toEqual([]);
  });

  it("a release outside a play decision does nothing (corpus 011: pay)", () => {
    const t = new Table();
    t.open("011-pay-my-planeswalker.json");
    expect(t.release(33, -200)).toEqual([]);
  });
});

describe("what glows on the table", () => {
  it("hand cards with a play are marked for the hand, permanents with one on the table (corpus 047)", () => {
    const t = new Table();
    t.open("047-play-poison.json");
    const m = t.p.board.marks;
    expect([...m.hand].sort((a, b) => a - b)).toEqual([8, 78, 88, 94]);
    expect(m.cards.get(819 as never)).toBe("option"); // Jace Beleren's +2
    expect(m.cards.get(806 as never)).toBe("option"); // a Swamp's mana
    expect(m.cards.has(12 as never)).toBe(false); // the Mountain in hand has no play
  });

  it("a permanent with an ability opens the inspector with it as a button; the button sends that option (corpus 047)", () => {
    const t = new Table();
    t.open("047-play-poison.json");
    const fx = t.tapCard(819);
    expect(fx).toEqual([{ kind: "inspect", card: 819 }]);
    expect(t.p.controls.cardActions.get(819 as never)).toEqual([{ option: 14, label: "+2: Each player draws a card", cost: null }]);
    expect(t.answers()).toEqual([]);
    t.pick(14);
    expect(t.answers()).toEqual([[14]]);
  });

  it("an inspector action sends while the stack's rules sheet is open under it (corpus 014)", () => {
    const t = new Table();
    t.open("014-play-opponent-spell-targets-me-stack-targets-card.json");
    t.press("Stack rules");
    expect(t.p.controls.sheet?.kind).toBe("stack");
    expect(t.p.controls.cardActions.get(822 as never)?.map((a) => a.option)).toEqual([2]);
    t.pick(2, 822);
    expect(t.answers()).toEqual([[2]]);
  });

  it("a land whose only option is a mana ability activates it: the tap opens it, its one button sends it (corpus 058)", () => {
    const t = new Table();
    t.open("058-play-poison.json");
    expect(t.tapCard(807)).toEqual([{ kind: "inspect", card: 807 }]);
    expect(t.p.controls.cardActions.get(807 as never)).toEqual([{ option: 2, label: "{T}: Add {R}", cost: null }]);
    t.pick(2);
    expect(t.answers()).toEqual([[2]]);
  });

  it("mana is not a play: it is neither counted nor listed (corpus 058: 13 options, 4 plays)", () => {
    const t = new Table();
    t.open("058-play-poison.json");
    expect(t.buttons()[0]).toBe("Choose a play (4)");
    t.press("Choose a play (4)");
    const items = t.p.controls.sheet!.items;
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.option >= 12)).toBe(true); // options 2-11 are mana abilities
  });

  it("a permanent with no play claims nothing (the app inspects it) and sends nothing", () => {
    const t = new Table();
    t.open("047-play-poison.json");
    expect(t.tapCard(818)).toEqual([{ kind: "unclaimed" }]);
    expect(t.p.controls.cardActions.has(818 as never)).toBe(false);
  });

  it("the commander plays from my plate (009, a command-zone cast added to the decision)", () => {
    const t = new Table();
    const env = withDecision("009-play-commander-zone.json", {
      kind: "play",
      options: ["pass", "Plains (land)", "Marath, Will of the Wild (commander)"],
      refs: [{}, { card: 50, spell: true }, { card: 100, spell: true }],
    });
    t.open(env);
    expect(t.p.board.marks.seats.get("You" as never)).toBe("option");
    expect(t.tapSeat("You")).toEqual([{ kind: "inspect", card: 100 }]);
    expect(t.p.controls.cardActions.get(100 as never)?.map((a) => a.label)).toEqual(["Cast from the command zone"]);
    t.pick(3);
    expect(t.answers()).toEqual([[3]]);
  });

  it("\"Choose a play\" lists everything and never sends by itself; a pick sends it (corpus 009)", () => {
    const t = new Table();
    t.open("009-play-commander-zone.json");
    t.press("Choose a play (3)");
    const sheet = t.p.controls.sheet!;
    expect(sheet.title).toBe("Everything you can play");
    expect(sheet.items.map((i) => i.label)).toEqual(["Play Plains", "Play Forest", "Play Karn's Bastion"]);
    expect(t.answers()).toEqual([]);
    t.pick(4);
    expect(t.answers()).toEqual([[4]]);
  });

  it("an opponent's spell with one response: the response is its own button and sends it (corpus 054)", () => {
    const t = new Table();
    t.open("054-play-commander-damage.json");
    const r = t.allButtons().find((b) => b.role === "choice")!;
    expect(r.label).toMatch(/^Marath, Will of the Wild: /);
    t.act({ a: "press", button: r.id });
    expect(t.answers()).toEqual([[2]]);
  });

  it("several responses open \"Choose a response\" (corpus 048)", () => {
    const t = new Table();
    t.open("048-play-three-players.json");
    t.press("Choose a response (7)");
    expect(t.p.controls.sheet?.title).toBe("Choose a response");
    expect(t.p.controls.sheet?.items).toHaveLength(7);
  });

  it("a permanent dragged in play offers its plays: one goes at once (corpus 047, Jace)", () => {
    const t = new Table();
    t.open("047-play-poison.json");
    t.drag({ card: 819 as never }, { seat: "Atraxa" as never });
    expect(t.answers()).toEqual([[14]]);
  });

  it("a drag let go onto nothing does nothing, as the old client's drag wanted a destination (corpus 047, Jace)", () => {
    const t = new Table();
    t.open("047-play-poison.json");
    expect(t.drag({ card: 819 as never }, { nothing: true })).toEqual([{ kind: "unclaimed" }]);
    expect(t.answers()).toEqual([]);
    expect(t.p.controls.sheet).toBeNull();
  });

  it("idsOf finds what the wire holds (rig sanity)", () => {
    expect(idsOf(raw("012-play-mana-pool.json"), "You", "Willbender")).toEqual([829]);
  });
});
