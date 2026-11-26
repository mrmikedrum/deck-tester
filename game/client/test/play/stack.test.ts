// The prompt's stack summary and headline over the corpus: one line an item, numbered, only for two or more (a lone
// item is the card held up); a stack of three with a spell aimed at my creature, the top resolving, a spell aimed at a
// player, triggers, and my own spell's targets being chosen.
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
/** A row as the chrome sets it: "1 Doom Blade → Serra Angel". */
const lines = (p: PromptOf): string[] => p.stack.map((r) => `${r.n} ${r.title}${r.at ? ` → ${r.at}` : ""}`);

describe("the stack summary, top first", () => {
  it("a stack of three: numbered, top first; an opponent's spell aimed at my creature in red", () => {
    const p = prompt(opened(STACK_OF_THREE));
    expect(lines(p)).toEqual(["1 Doom Blade → Serra Angel", "2 Doom Blade → your Grizzly Bears", "3 Thorn of the Black Rose"]);
    expect(p.stack.map((r) => r.aimed)).toEqual([false, true, false]);
    // Dack's Doom Blade on top, at Atraxa's Serra Angel: what is cast, in game terms; one response, two buttons.
    expect(p.headline).toBe("Dack's Doom Blade targets Serra Angel");
    expect(p.context).toBeNull();
  });

  it("the top resolves: the threat is next, in red, and the headline names what it targets", () => {
    const t = opened(STACK_OF_THREE);
    t.open(RESOLVING);
    const p = prompt(t);
    expect(lines(p)).toEqual(["1 Doom Blade → your Grizzly Bears", "2 Thorn of the Black Rose"]);
    expect(p.stack[0]!.aimed).toBe(true);
    expect(p.tone).toBe("threat");
    expect(p.headline).toBe("Atraxa's Doom Blade targets your Grizzly Bears");
  });

  it("a lone item has no summary: the card is held up", () => {
    const p = prompt(opened(AT_A_PLAYER));
    expect(p.stack).toEqual([]);
    expect(p.headline).toBe("Lightning Bolt targets Princess");
  });

  it("triggers: each its card's ability, short names", () => {
    expect(lines(prompt(opened("023-play-monarch.json")))).toEqual(["1 Rancor ability", "2 Soul Warden ability", "3 Soul's Attendant ability"]);
  });

  it("an empty stack: no summary, and the context is the choice's own again", () => {
    for (const n of ["016-order-mana-pool.json", "026-play-monarch.json"]) expect(prompt(opened(n)).stack).toEqual([]);
    const p = prompt(opened("024-targets-monarch.json"));
    expect(p.stack).toEqual([]);
    expect(p.headline).toBe("Target");
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

  it("the headline says what is chosen for what; no note (the arc draws as targets are picked)", () => {
    const t = choosing();
    expect(prompt(t).headline).toBe("Up to 2 targets for Thorn of the Black Rose");
    expect(prompt(t).stack).toEqual([]);
    t.tapSeat("Princess");
    expect(prompt(t).headline).toBe("Up to 2 targets for Thorn of the Black Rose");
  });
});

describe("a spell aimed at mine", () => {
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

  it("Swords to Plowshares: the headline names it and what it targets, in red; OK acknowledges it", () => {
    const p = prompt(recast("Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power."));
    expect(p.headline).toBe("Princess's Swords to Plowshares targets your Soul Warden");
    expect(p.tone).toBe("threat");
  });
});
