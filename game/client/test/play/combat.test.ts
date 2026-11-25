// Behaviour to pin, items 4 and 5: `attack` (tap to toggle, tap a plate to retarget, drag onto a player, "Everyone
// attacks") and `block` (one legal pairing picks itself, otherwise hold the blocker and tap the attacker, illegal pairs
// toast). Corpus 037 (one attacker, six defenders) and 033 (blockers that can each block only Gideon); the multi-creature
// attack and the blockers with choices are those envelopes with their decisions extended (said per test).
import { describe, expect, it } from "vitest";
import type { CardId } from "../../src/protocol";
import { Table, edited, ofKind, withDecision } from "./rig";

const ATTACK = "037-attack-poison.json";
const DEFENDERS = ["Atraxa", 872, "Dack", 873, "Princess", 874] as const; // Gideon, Chandra, Ajani are planeswalkers
/** 037 with my face-down creature (829) attacking too: options creature-major, 871 is 1-6, 829 is 7-12. */
const twoAttackers = (view?: (v: Record<string, unknown>) => void) =>
  withDecision(
    ATTACK,
    {
      kind: "attack",
      prompt: "attackers, at most one defender each",
      options: [871, 829].flatMap((c) => DEFENDERS.map((d) => `${c} -> ${d}`)),
      refs: [871, 829].flatMap((card) => DEFENDERS.map((to) => ({ card, to }))),
      min: 0,
      max: 12,
    },
    view,
  );

describe("attack", () => {
  it("tap a creature to pick it at the first opponent; Attack (n) sends; the draft is drawn as lanes (corpus 037)", () => {
    const t = new Table();
    t.open(ATTACK);
    expect(t.buttons()).toEqual(["Everyone attacks", "No attack", "Let Forge decide"]);
    expect(t.p.controls.prompt?.headline).toBe("Tap creatures to attack Atraxa, or drag them to a player");
    expect(t.p.board.marks.seats.get("Atraxa" as never)).toBe("selected");
    t.tapCard(871);
    expect(t.buttons()).toEqual(["Clear", "Attack (1)", "Let Forge decide"]);
    expect(t.p.controls.prompt?.headline).toBe("Attacking with 1. Tap more, or drag one to another player");
    expect(t.p.board.combat).toEqual({ attacks: [{ attacker: 871, defender: { seat: "Atraxa" } }], blocks: [] });
    expect(t.p.board.marks.cards.get(871 as CardId)).toBe("selected");
    expect(t.answers()).toEqual([]);
    t.press("Attack (1)");
    expect(t.answers()).toEqual([[1]]);
  });

  it("tapping a picked creature takes it back; Clear empties; \"No attack\" sends []", () => {
    const t = new Table();
    t.open(twoAttackers());
    t.tapCard(871);
    t.tapCard(829);
    t.tapCard(871);
    expect(t.buttons()).toContain("Attack (1)");
    t.press("Clear");
    expect(t.buttons()).toEqual(["Everyone attacks", "No attack", "Let Forge decide"]);
    expect(t.p.board.combat).toBeNull();
    t.press("No attack");
    expect(t.answers()).toEqual([[]]);
  });

  it("tapping another player's plate re-aims the picks, and later picks go to that player (037 extended)", () => {
    const t = new Table();
    t.open(twoAttackers());
    t.tapCard(871);
    t.tapSeat("Dack");
    expect(t.p.board.marks.seats.get("Dack" as never)).toBe("selected");
    t.tapCard(829);
    t.press("Attack (2)");
    expect(t.answers()).toEqual([[3, 9]]);
  });

  it("tapping a planeswalker makes it the defender (corpus 037: Chandra)", () => {
    const t = new Table();
    t.open(ATTACK);
    t.tapCard(873);
    expect(t.p.controls.prompt?.headline).toBe("Tap creatures to attack Chandra Nalaar, or drag them to a player");
    t.tapCard(871);
    expect(t.p.board.combat?.attacks).toEqual([{ attacker: 871, defender: { card: 873 } }]);
    t.press("Attack (1)");
    expect(t.answers()).toEqual([[4]]);
  });

  it("my own plate is not a defender: the tap is the app's, nothing changes", () => {
    const t = new Table();
    t.open(ATTACK);
    expect(t.tapSeat("You")).toEqual([{ kind: "unclaimed" }]);
    expect(t.p.controls.prompt?.headline).toMatch(/attack Atraxa/);
  });

  it("\"Everyone attacks\" picks every creature at the current defender and is gone once all are picked (037 extended)", () => {
    const t = new Table();
    t.open(twoAttackers());
    t.tapSeat("Princess");
    t.press("Everyone attacks");
    expect(t.buttons()).toEqual(["Clear", "Attack (2)", "Let Forge decide"]);
    t.press("Attack (2)");
    expect(t.answers()).toEqual([[5, 11]]);
  });

  it("dragging a creature onto a plate, a planeswalker or a player's permanent attacks there (037 extended)", () => {
    const t = new Table();
    t.open(twoAttackers());
    t.drag({ card: 829 as CardId }, { seat: "Princess" as never });
    expect(t.p.board.combat?.attacks).toEqual([{ attacker: 829, defender: { seat: "Princess" } }]);
    t.drag({ card: 829 as CardId }, { card: 874 as CardId }); // Ajani: that planeswalker
    expect(t.p.board.combat?.attacks).toEqual([{ attacker: 829, defender: { card: 874 } }]);
    t.drag({ card: 871 as CardId }, { card: 855 as CardId }); // Glistener Elf: its controller, Princess
    t.press("Attack (2)");
    expect(t.answers()).toEqual([[12, 5]]);
  });

  it("a drag onto somewhere it can't attack toasts and picks nothing", () => {
    const t = new Table();
    t.open(ATTACK);
    const fx = t.drag({ card: 871 as CardId }, { seat: "You" as never });
    expect(ofKind(fx, "toast")).toEqual([{ kind: "toast", text: "It can't attack there" }]);
    expect(t.buttons()).toContain("No attack");
  });

  it("the first defender is the first opponent still in the game (037 extended, Atraxa eliminated)", () => {
    const t = new Table();
    t.open(twoAttackers((v) => void (v["players"] = (v["players"] as { name: string }[]).filter((p) => p.name !== "Atraxa"))));
    expect(t.p.controls.prompt?.headline).toMatch(/attack Dack/);
    t.tapCard(871);
    t.press("Attack (1)");
    expect(t.answers()).toEqual([[3]]);
  });

  it("a tap on a group whose members changed since it was drawn is dropped", () => {
    const t = new Table();
    t.open(ATTACK);
    expect(t.tap({ group: "c871", members: [871 as CardId, 999 as CardId] })).toEqual([]);
    expect(t.tap({ group: "gone", members: [] })).toEqual([]);
    t.tap({ group: "c871", members: [871 as CardId] });
    expect(t.buttons()).toContain("Attack (1)");
  });
});

const BLOCK = "033-block-attack-on-planeswalker-they-attack.json";
/** 033 with Atraxa's Sandstorm Salvager (237) attacking too, and blockers with choices: Grizzly Bears 818 can block
 * Gideon (872) or Blighted Agent (834); Soul's Attendant 821 the Agent or the Salvager; Soul Warden 820 only Gideon. */
const choices = () =>
  withDecision(
    BLOCK,
    {
      kind: "block",
      prompt: "blockers, each blocking one attacker",
      options: ["818>872", "818>834", "821>834", "821>237", "820>872"],
      refs: [
        { card: 818, blocks: 872 },
        { card: 818, blocks: 834 },
        { card: 821, blocks: 834 },
        { card: 821, blocks: 237 },
        { card: 820, blocks: 872 },
      ],
      min: 0,
      max: 5,
    },
    (v) => void (v["combat"] as { attackers: unknown[] }).attackers.push({ id: 237, defender: "You" }),
  );

describe("block", () => {
  it("a blocker with a single legal pairing picks it with one tap (corpus 033)", () => {
    const t = new Table();
    t.open(BLOCK);
    expect(t.buttons()).toEqual(["No blocks", "Let Forge decide"]);
    expect(t.p.controls.prompt?.headline).toBe("Tap a creature, then the attacker it blocks (or drag it there)");
    t.tapCard(818);
    expect(t.buttons()).toEqual(["Clear", "Block (1)", "Let Forge decide"]);
    expect(t.p.board.combat).toEqual({ attacks: [], blocks: [{ blocker: 818, attacker: 872 }] });
    t.press("Block (1)");
    expect(t.answers()).toEqual([[1]]);
  });

  it("tapping a picked blocker takes it back; Clear and \"No blocks\" (corpus 033)", () => {
    const t = new Table();
    t.open(BLOCK);
    t.tapCard(818);
    t.tapCard(818);
    expect(t.buttons()).toEqual(["No blocks", "Let Forge decide"]);
    t.tapCard(820);
    t.press("Clear");
    t.press("No blocks");
    expect(t.answers()).toEqual([[]]);
  });

  it("otherwise hold the blocker and tap the attacker it blocks (033 extended)", () => {
    const t = new Table();
    t.open(choices());
    t.tapCard(818);
    expect(t.buttons()).toEqual(["Clear", "No blocks", "Let Forge decide"]);
    expect(t.p.controls.prompt?.headline).toBe("Now tap the attacker for Grizzly Bears to block");
    // holding: only the attackers it can block stay lit, in red
    const m = t.p.board.marks.cards;
    expect([m.get(872 as CardId), m.get(834 as CardId), m.get(237 as CardId)]).toEqual(["danger", "danger", undefined]);
    expect(m.get(818 as CardId)).toBe("selected");
    t.tapCard(834);
    t.tapCard(820); // a single pairing: picked at once
    expect(t.p.board.combat?.blocks).toEqual([
      { blocker: 818, attacker: 834 },
      { blocker: 820, attacker: 872 },
    ]);
    t.press("Block (2)");
    expect(t.answers()).toEqual([[2, 5]]);
  });

  it("an illegal pair toasts and picks nothing; the blocker stays held (033 extended)", () => {
    const t = new Table();
    t.open(choices());
    t.tapCard(821);
    const fx = t.tapCard(872);
    expect(ofKind(fx, "toast")).toEqual([{ kind: "toast", text: "That creature can't block that attacker" }]);
    expect(t.buttons()).toEqual(["Clear", "No blocks", "Let Forge decide"]);
    t.tapCard(237);
    t.press("Block (1)");
    expect(t.answers()).toEqual([[4]]);
  });

  it("dragging a blocker onto an attacker it can block picks the pair; onto another toasts (033 extended)", () => {
    const t = new Table();
    t.open(choices());
    expect(ofKind(t.drag({ card: 818 as CardId }, { card: 237 as CardId }), "toast")).toEqual([{ kind: "toast", text: "It can't block that" }]);
    t.drag({ card: 818 as CardId }, { card: 834 as CardId });
    t.press("Block (1)");
    expect(t.answers()).toEqual([[2]]);
  });

  it("an attacker tapped with no blocker held is the app's (it inspects)", () => {
    const t = new Table();
    t.open(choices());
    expect(t.tapCard(834)).toEqual([{ kind: "unclaimed" }]);
  });

  it("the attack it shows is the engine's when nothing is drafted (corpus 033 combat not overwritten)", () => {
    const t = new Table();
    t.open(edited(BLOCK, () => {}));
    expect(t.p.board.combat).toBeNull();
  });
});
