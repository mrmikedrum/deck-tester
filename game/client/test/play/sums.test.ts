// The prompt's own sums (the told table writes them; spec "Told, not shown", section 5): my picks' power and fliers while
// I attack, what reaches me while I block, and what a creature sweep takes from me. Words only: what is sent never changes.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { Table, idsOf } from "./rig";

function clipBeat(name: string, index: number): Record<string, unknown> {
  const clips: { name: string; beats: { new?: { push?: Record<string, unknown> } }[] }[] =
    createRequire(import.meta.url)("../../../tools/clips.js");
  const push = clips.find((c) => c.name === name)?.beats[index]?.new?.push;
  if (!push) throw new Error(`no envelope for ${name} beat ${index}`);
  return push;
}

describe("the prompt's sums", () => {
  it("while I attack: the power at each defender and how many fly", () => {
    const env = clipBeat("attack15", 0), t = new Table();
    t.open(env);
    expect(t.p.controls.prompt?.sum).toBeNull();
    for (const name of ["Faerie Mastermind", "Meloku the Clouded Mirror", "Mulldrifter"]) t.tapCard(idsOf(env, "You", name)[0]!);
    expect(t.p.controls.prompt?.sum).toBe("6 power at Marath · 3 fly");
  });

  it("while I block: what reaches me, less what my blocks stop", () => {
    const env = clipBeat("block15", 1), t = new Table();
    t.open(env);
    expect(t.p.controls.prompt?.sum).toBe("Take 35");
    t.tapCard(idsOf(env, "You", "Princess Yue")[0]!);
    expect(t.p.controls.prompt?.sum).toBe("Take 35");
    t.tapCard(idsOf(env, "Marath", "Marath, Will of the Wild")[0]!);
    expect(t.p.controls.prompt?.sum).toBe("Take 30");
  });

  it("a creature sweep on the stack: what it takes from me", () => {
    const t = new Table();
    t.open(clipBeat("wipe15", 0));
    expect(t.p.controls.prompt?.sum).toMatch(/^You lose \d+ creatures$/);
  });
});
