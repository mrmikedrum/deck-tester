// The prompt's stack summary and context, in the old client's words (live.js `stackSummary` and `status`), over the
// corpus: a stack of three with a spell aimed at my creature, the top resolving, a spell aimed at a player, triggers,
// my own spell's targets being chosen, and the cards whose wording the old summary shortened.
import { describe, expect, it } from "vitest";
import { promptOf } from "../../src/play/prompt";
import type { PromptOf } from "../../src/play/prompt";
import { open } from "../../src/play/state";
import { Table, edited, withDecision } from "./rig";

const STACK_OF_THREE = "014-play-opponent-spell-targets-me-stack-targets-card.json";
const RESOLVING = "015-play-opponent-spell-targets-me.json";
const AT_A_PLAYER = "025-play-stack-targets-player.json";

function prompt(t: Table): PromptOf {
  const p = promptOf(open(t.state));
  if (!p) throw new Error("no prompt");
  return p;
}
const opened = (env: Parameters<Table["open"]>[0]): Table => {
  const t = new Table();
  t.open(env);
  return t;
};
/** A row as the old markup read: `<order> <title> · <who>`, then the effect. */
const lines = (p: PromptOf): string[] => p.stack.map((r) => `${r.order} ${r.title} · ${r.who} | ${r.effect}`);

describe("the stack summary, top first", () => {
  it("a stack of three: the next to resolve first; an opponent's spell aimed at my creature is a pending threat", () => {
    const p = prompt(opened(STACK_OF_THREE));
    expect(lines(p)).toEqual([
      "Next if all pass Doom Blade · Dack | Aimed at Serra Angel. Destroy target nonblack creature.",
      "Pending threat Doom Blade · Atraxa | Aimed at your Grizzly Bears. Destroy target nonblack creature.",
      "Pending Thorn of the Black Rose · You | Deathtouch",
    ]);
    expect(p.stack.map((r) => r.aimed)).toEqual([false, true, false]);
    expect(p.headline).toBe("You can respond");
    expect(p.context).toBeNull(); // a play decision has none (the chrome shows the summary while the stack layer is up)
  });

  it("the top resolves: the threat is next, in red", () => {
    const t = opened(STACK_OF_THREE);
    t.open(RESOLVING);
    const p = prompt(t);
    expect(lines(p)).toEqual([
      "Next if all pass Doom Blade · Atraxa | Aimed at your Grizzly Bears. Destroy target nonblack creature.",
      "Pending Thorn of the Black Rose · You | Deathtouch",
    ]);
    expect(p.stack[0]!.aimed).toBe(true);
    expect(p.tone).toBe("threat");
  });

  it("a spell aimed at a player", () => {
    const p = prompt(opened(AT_A_PLAYER));
    expect(lines(p)).toEqual([
      "Next if all pass Lightning Bolt · You | Aimed at Princess. Lightning Bolt deals 3 damage to any target.",
    ]);
    expect(p.stack[0]!.item).toBe(682);
  });

  it("triggers: each named as its card's ability, its effect the trigger's first sentence", () => {
    expect(lines(prompt(opened("023-play-monarch.json")))).toEqual([
      "Next if all pass Rancor's ability · You | When Rancor is put into a graveyard from the battlefield, return Rancor to its owner's hand.",
      "Pending Soul Warden's ability · You | Whenever another creature enters, you gain 1 life.",
      "Pending Soul's Attendant's ability · You | Whenever another creature enters, you may gain 1 life.",
    ]);
    // "Thorn of the Black Rose" is "Thorn" (live.js `shortCard`)
    expect(prompt(opened("017-play-mana-pool.json")).stack[0]!.title).toBe("Thorn's ability");
  });

  it("an empty stack: no summary, and the context is the choice's own again", () => {
    for (const n of ["016-order-mana-pool.json", "026-play-monarch.json"]) expect(prompt(opened(n)).stack).toEqual([]);
    const p = prompt(opened("024-targets-monarch.json"));
    expect(p.stack).toEqual([]);
    expect(p.headline).toBe("Choose a target");
    expect(p.context).toBe("this deals 3 damage to any target.");
  });
});

describe("choosing my own spell's targets", () => {
  // My Thorn of the Black Rose alone on the stack, with no targets yet, and a targets decision for it.
  const choosing = () =>
    opened(
      withDecision("013-play-stack.json", {
        kind: "targets",
        prompt: "target for Thorn of the Black Rose",
        options: ["Princess", "you"],
        refs: [{ player: "Princess" }, { player: "You" }],
        min: 1,
        max: 2,
      }),
    );

  it("the top row says so, then names the picks; the stack note says the same", () => {
    const t = choosing();
    expect(lines(prompt(t))).toEqual(["Next if all pass Thorn of the Black Rose · You | Choosing targets"]);
    expect(t.p.controls.stackNote).toBe("Choosing targets");
    // The context is kept with a stack (live.js `context`: the spell asking): the chrome shows it once the stack layer
    // is set aside.
    expect(prompt(t).context).toBe("Thorn of the Black Rose");
    t.tapSeat("Princess");
    expect(lines(prompt(t))).toEqual([
      "Next if all pass Thorn of the Black Rose · You | Aimed at Princess. Deathtouch",
    ]);
    expect(t.p.controls.stackNote).toBe("Aimed at Princess.");
    t.tapSeat("You");
    expect(prompt(t).stack[0]!.effect).toBe("Aimed at Princess and you. Deathtouch");
  });
});

describe("the wording the old summary shortened", () => {
  /** The Bolt of 025, recast as another spell aimed at my Soul Warden (820). */
  const recast = (name: string, text: string) =>
    opened(
      edited(AT_A_PLAYER, (v) => {
        const st = (v["stack"] as Record<string, unknown>[])[0]!;
        st["source"] = {
          ...(st["source"] as object),
          name,
          text,
          type: "Instant",
          owner: "Princess",
          controller: "Princess",
        };
        st["controller"] = "Princess";
        st["targets"] = [820];
      }),
    );

  it("Swords to Plowshares names its target", () => {
    const p = prompt(
      recast("Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power."),
    );
    expect(lines(p)).toEqual([
      "Next if all pass Swords to Plowshares · Princess | Exile your Soul Warden. Its controller gains life equal to its power.",
    ]);
    expect(p.stack[0]!.aimed).toBe(true);
  });

  it("a counterspell names what it counters; Arcane Denial is shortened", () => {
    const p = prompt(recast("Arcane Denial", ""));
    expect(p.stack[0]!.effect).toBe(
      "Counter your Soul Warden. Next upkeep, its controller may draw up to two. You draw one.",
    );
  });

  it("a target the table does not show is an unrecorded target", () => {
    const t = opened(
      edited(AT_A_PLAYER, (v) => {
        (v["stack"] as Record<string, unknown>[])[0]!["targets"] = [99999];
      }),
    );
    expect(prompt(t).stack[0]!.effect).toBe("Aimed at unrecorded target. Lightning Bolt deals 3 damage to any target.");
  });
});

describe("who chose an item of mine (live.js `playChoice`, `st.actor`)", () => {
  it("the play I sent labels the spell it brings to the stack, once; a refused one labels nothing", () => {
    const t = opened("023-play-monarch.json");
    t.pick(2); // Lightning Bolt
    expect(t.lastSend()?.body).toMatchObject({ answer: [2] });
    t.settled("applied");
    t.open("024-targets-monarch.json");
    t.open(AT_A_PLAYER);
    expect(prompt(t).stack.map((r) => r.who)).toEqual(["You · Your choice"]);

    const refused = opened("023-play-monarch.json");
    refused.pick(2);
    refused.settled("refused");
    refused.open("024-targets-monarch.json");
    refused.open(AT_A_PLAYER);
    expect(prompt(refused).stack.map((r) => r.who)).toEqual(["You"]);
  });

  it("a cut back to an earlier position forgets the labels", () => {
    const t = opened("023-play-monarch.json");
    t.pick(2);
    t.settled("applied");
    t.open("024-targets-monarch.json");
    t.open(AT_A_PLAYER);
    t.open(AT_A_PLAYER, { continuity: "rewind" });
    expect(prompt(t).stack.map((r) => r.who)).toEqual(["You"]);
  });
});
