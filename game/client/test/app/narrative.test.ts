// The narrative through the whole app, headless, on real corpus envelopes (the scripted transport, play, the real stage
// drawing and reporting): the log strip at the top left, the stack summary in the prompt, a notice that waits for its
// change set's motion before the prompt asks and the strip tells, the loss notice once the loss has been seen, and the
// log and loss sheets as focus layers.
import { describe, expect, it } from "vitest";
import type { InputMsg } from "../../src/app/msg";
import type { ChromeView } from "../../src/chrome";
import { raw } from "../play/rig";
import { rig } from "./rig";
import type { Rig } from "./rig";

/** A rig with the real stage, started on `first` (the first snapshot: a cut), and every frame for 2 s after it. */
function from(first: string): Rig {
  const r = rig({ stage: true });
  r.loop.start();
  r.frame(0);
  r.transport.push(raw(first));
  r.frame(100);
  run(r, 2000);
  return r;
}

/** Frames every 16 ms for `ms`. */
function run(r: Rig, ms: number): void {
  const end = r.now + ms;
  while (r.now < end) r.frame(r.now + 16);
}

const view = (r: Rig): ChromeView => r.commits.at(-1)!.view;
const strip = (r: Rig): string[] => view(r).log.lines.map((l) => l.text);

/** The player's own input to the app (a control's order), at the clock. */
function order(r: Rig, m: { t: "open"; layer: "log" | "losses" } | { t: "dismiss" } | { t: "dismissRecap" }): void {
  const stamp = { at: r.now, commit: r.state.commit };
  const msg: InputMsg = m.t === "open" ? { t: "open", stamp, layer: m.layer, card: null } : { ...m, stamp };
  r.inputs.push(msg);
  r.frame(r.now + 16);
}

/**
 * Pushes `name` and plays frames until the stage has played it: each frame, whether the notice it brought still waits,
 * and whether the stage was still moving when it drew. Ends two frames after the stage is idle.
 */
function played(r: Rig, name: string): { waiting: boolean; moving: boolean }[] {
  r.transport.push(raw(name));
  const seen: { waiting: boolean; moving: boolean }[] = [];
  for (let idle = 0; idle < 2 && r.now < 60_000; ) {
    r.frame(r.now + 16);
    const moving = r.stage!.active();
    seen.push({ waiting: r.state.narrative.notices.length > 0, moving });
    idle = moving ? 0 : idle + 1;
  }
  return seen;
}

describe("the log strip and the stack summary on the slice", () => {
  it("the strip heads the table with the turn from the first commit, and tells the cast once the table has it", () => {
    const r = from("023-play-monarch.json");
    expect(view(r).log).toEqual({
      heading: "Turn 2 · You",
      lines: [
        { text: "You triggered Rancor", draw: false },
        { text: "Rancor was put into Graveyard from Battlefield.", draw: false },
      ],
      tone: "recent",
    });
    played(r, "024-targets-monarch.json");
    played(r, "025-play-stack-targets-player.json");
    expect(strip(r)[0]).toBe("You cast Lightning Bolt targeting [Princess]");
  });

  it("the Bolt on its way to the stack: the prompt watches it, saying the line it will ask with", () => {
    const r = from("023-play-monarch.json");
    played(r, "024-targets-monarch.json");
    r.transport.push(raw("025-play-stack-targets-player.json"));
    r.frame(r.now + 16);
    let v = view(r);
    expect(v.stackOpen).toBe(true);
    // A lone item: no summary (the card is held up).
    expect(v.controls.prompt?.stack).toEqual([]);
    // On its way: the prompt watches it, and "All plays" is not offered meanwhile.
    expect(v.watch).toMatchObject({ headline: "", toStack: true, sweeping: false });
    run(r, 4000);
    v = view(r);
    expect(v.watch).toBeNull();
    expect(v.controls.prompt?.headline).toBe("Lightning Bolt targets Princess");
    expect(v.controls.prompt?.buttons.map((b) => b.label)).toContain("Resolve");
  });

  it("the stack layer set aside: the view says so, and the decision's context is there for the prompt (live.js `status`)", () => {
    const r = from("032-confirm-watching.json");
    let v = view(r);
    expect(v.stackOpen).toBe(true);
    expect(v.controls.prompt?.stack).toHaveLength(3);
    expect(v.controls.prompt?.context).toMatch(/^Whenever another creature enters, you may gain 1/);
    order(r, { t: "dismiss" });
    v = view(r);
    expect(v.stackOpen).toBe(false);
    expect(v.chips.map((c) => c.label)).toEqual(["Stack 3"]);
  });
});

describe("a notice waits for its change set's motion", () => {
  it("the cast's notice holds the prompt's watching headline until the stage has played its set, then goes at once", () => {
    const r = from("023-play-monarch.json");
    played(r, "024-targets-monarch.json");
    const seen = played(r, "025-play-stack-targets-player.json");
    const freed = seen.findIndex((f) => !f.waiting);
    expect(freed).toBeGreaterThan(0);
    // Waiting every frame the stage moved; let go in the frame after the one it drew idle (its report is folded then).
    expect(seen.slice(0, freed).every((f) => f.waiting)).toBe(true);
    expect(seen[freed - 1]!.moving).toBe(false);
    expect(seen.slice(0, freed - 1).some((f) => f.moving)).toBe(true);
    expect(seen.slice(freed).every((f) => !f.waiting)).toBe(true);
    expect(view(r).watch).toBeNull();
  });

  it("what a set did is not told before its motion: the strip keeps the last line until the stage has played it", () => {
    const r = from("023-play-monarch.json");
    r.transport.push(raw("024-targets-monarch.json"));
    r.frame(r.now + 16);
    // Rancor's trigger resolves: Rancor comes back to my hand. Unnamed while it moves; told once it is in.
    expect(view(r).watch?.headline).toBe("A card returning from the graveyard to your hand");
    expect(strip(r)).not.toContain("Rancor returned from the graveyard to your hand");
    run(r, 3000);
    expect(view(r).watch).toBeNull();
    expect(strip(r)[0]).toBe("Rancor returned from the graveyard to your hand");
  });

  it("a cut releases what waited: a new game's first commit has nothing waiting", () => {
    const r = from("023-play-monarch.json");
    r.transport.push(raw("024-targets-monarch.json"));
    r.frame(r.now + 16);
    expect(r.state.narrative.notices).toHaveLength(1);
    const next = raw("009-play-commander-zone.json");
    next["gen"] = 2;
    r.transport.push(next);
    r.frame(r.now + 16);
    expect(r.state.narrative.notices).toEqual([]);
    expect(view(r).watch).toBeNull();
    expect(view(r).log.heading).toBe("Turn 2 · You"); // the new game's own (its first lines, told at once)
  });
});

describe("the loss notice and the sheets", () => {
  it("my creature exiled on Atraxa's turn: the loss notice comes once the attack has been seen, and goes with the turn", () => {
    const r = from("032-confirm-watching.json");
    r.transport.push(raw("033-block-attack-on-planeswalker-they-attack.json"));
    r.frame(r.now + 16);
    expect(view(r).watch?.headline).toBe("Atraxa attacks");
    expect(view(r).recap).toBeNull(); // not told before it is seen
    run(r, 4000);
    expect(view(r).watch).toBeNull();
    expect(view(r).recap).toEqual({ title: "Lost: Thorn of the Black Rose (exile) ›", summary: "" });
    played(r, "034-order-blocked-poison.json");
    expect(view(r).recap).toEqual({ title: "Lost: Thorn of the Black Rose (exile) ›", summary: "" });
    played(r, "035-play-face-down.json");
    expect(view(r).recap).toBeNull(); // a new turn
  });

  it("the loss report opens from the notice; the notice's ✕ dismisses it", () => {
    const r = from("032-confirm-watching.json");
    played(r, "033-block-attack-on-planeswalker-they-attack.json");
    order(r, { t: "open", layer: "losses" });
    expect(view(r).layers.map((l) => l.layer).at(-1)).toBe("losses");
    expect(view(r).losses).toEqual([
      { name: "Thorn of the Black Rose", fate: "went to exile", why: expect.stringMatching(/^Swords to Plowshares - Exile Thorn of the Black Rose/) },
    ]);
    order(r, { t: "dismiss" });
    expect(view(r).losses).toBeNull();
    expect(view(r).recap).not.toBeNull();
    order(r, { t: "dismissRecap" });
    expect(view(r).recap).toBeNull();
  });

  it("the strip opens the log, turns newest first; its losses line opens the report over it; each goes by dismiss", () => {
    const r = from("032-confirm-watching.json");
    played(r, "033-block-attack-on-planeswalker-they-attack.json");
    order(r, { t: "open", layer: "log" });
    let v = view(r);
    expect(v.logSheet?.groups[0]?.heading).toEqual({ type: "turn", text: "Turn 3 · Atraxa" });
    expect(v.logSheet?.losses).toBe("Your losses · 1 to exile");
    expect(r.commits.at(-1)!.frame?.focus.layer).toBe("sheet"); // the scene sees it as a sheet
    order(r, { t: "open", layer: "losses" });
    v = view(r);
    expect(v.layers.map((l) => l.layer).slice(-2)).toEqual(["log", "losses"]);
    expect(v.losses).toHaveLength(1);
    order(r, { t: "dismiss" });
    expect(view(r).losses).toBeNull();
    expect(view(r).logSheet).not.toBeNull();
    order(r, { t: "dismiss" });
    expect(view(r).logSheet).toBeNull();
  });

  it("a new game asked for starts the story again: no strip, no recap, no sheet", () => {
    const r = from("032-confirm-watching.json");
    played(r, "033-block-attack-on-planeswalker-they-attack.json");
    order(r, { t: "open", layer: "log" });
    r.inputs.push({ t: "newGame", stamp: { at: r.now, commit: r.state.commit }, req: { deck: "a", opponents: ["b", "c", "d"], mana: "creatures" } });
    r.frame(r.now + 16);
    const v = view(r);
    expect(v.log.heading).toBe("");
    expect(v.recap).toBeNull();
    expect(v.logSheet).toBeNull();
    expect(r.state.narrative.losses).toEqual([]);
  });
});
