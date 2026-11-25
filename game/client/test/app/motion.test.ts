// Reduced motion: the setting the page starts with and every change of it reach the scene's frame; decision timing never
// changes with it (auto-pass fires at 3,200 ms either way).
import { describe, expect, it } from "vitest";
import { AUTO_PASS_MS } from "../../src/play";
import { initialState } from "../../src/app/state";
import { raw } from "../play/rig";
import { rig } from "./rig";
import type { Rig } from "./rig";

/** Corpus 030: Atraxa's ability on top, my only option a mana ability: play passes by itself. */
function watching(reducedMotion: boolean): Rig {
  const r = rig({ reducedMotion });
  r.loop.start();
  r.frame(0);
  r.now = 100;
  r.transport.push(raw("030-play-watching.json")); // stamped 100
  r.frame(100);
  return r;
}

describe("reduced motion", () => {
  it("starts from the page's setting (off by default) and reaches the scene's frame", () => {
    expect(initialState({ clientBuild: "b" }).reducedMotion).toBe(false);
    expect(initialState({ clientBuild: "b", reducedMotion: true }).reducedMotion).toBe(true);
    const r = watching(true);
    expect(r.state.reducedMotion).toBe(true);
    expect(r.commits.at(-1)?.frame?.reducedMotion).toBe(true);
  });

  it("follows a change of the setting", () => {
    const r = watching(false);
    expect(r.commits.at(-1)?.frame?.reducedMotion).toBe(false);
    r.motion.push({ at: 200, reduced: true });
    r.frame(200);
    expect(r.state.reducedMotion).toBe(true);
    expect(r.commits.at(-1)?.frame?.reducedMotion).toBe(true);
    r.motion.push({ at: 300, reduced: false });
    r.frame(300);
    expect(r.commits.at(-1)?.frame?.reducedMotion).toBe(false);
  });

  it("is a setting of the page: teardown keeps it", () => {
    const r = watching(true);
    r.loop.teardown();
    expect(r.state.reducedMotion).toBe(true);
  });

  it.each([
    ["off", false, false],
    ["on", true, true],
    ["turned on during the countdown", false, true],
  ])("auto-pass fires at 3,200 ms with reduced motion %s", (_, start, later) => {
    const r = watching(start);
    expect(AUTO_PASS_MS).toBe(3200);
    if (later !== start) {
      r.motion.push({ at: 1000, reduced: later });
      r.frame(1000);
      expect(r.state.reducedMotion).toBe(later);
    }
    r.frame(100 + 3199);
    expect(r.transport.answers).toHaveLength(0);
    r.frame(100 + 3200);
    expect(r.transport.answers).toHaveLength(1);
    expect(r.transport.answers[0]?.body).toMatchObject({ answer: [1] });
  });
});
