// The camera zoom's trial (`?zoom`): a long press on the table composes the camera on what is under it; a tap or
// Escape brings the table back, and nothing of either reaches play. Without the trial nothing zooms.
import { describe, expect, it } from "vitest";
import { initialState } from "../../src/app/state";
import { update } from "../../src/app/update";
import type { AppState } from "../../src/app/state";
import type { Msg } from "../../src/app/msg";
import type { CommitId, Stamp } from "../../src/protocol";

const stamp: Stamp = { at: 10, commit: 0 as CommitId };
const zoom = (group: string | null): Msg => ({ t: "zoom", stamp, group });
const run = (s: AppState, ...ms: Msg[]): AppState => ms.reduce((x, m) => update(x, m).state, s);

describe("the zoom's trial", () => {
  it("a long press zooms to the group under it; Escape brings the table back", () => {
    const s = run(initialState({ clientBuild: "t", zoomTrial: true }), zoom("card:7"));
    expect(s.zoom.on).toBe("card:7");
    const back = update(s, { t: "dismiss", stamp });
    expect(back.state.zoom.on).toBeNull();
    expect(back.effects).toEqual([]);
    expect(back.state.focus).toBe(s.focus);
  });

  it("zoomed in, a tap on the table only brings it back: play hears nothing", () => {
    const s = run(initialState({ clientBuild: "t", zoomTrial: true }), zoom("card:7"));
    const tap = update(s, { t: "act", stamp, stop: null, act: { a: "tap", on: { group: "card:9", members: [] } } });
    expect(tap.state.zoom.on).toBeNull();
    expect(tap.state.play).toBe(s.play);
    expect(tap.effects).toEqual([]);
  });

  it("without the trial a long press does nothing", () => {
    const s0 = initialState({ clientBuild: "t" });
    expect(run(s0, zoom("card:7"))).toBe(s0);
  });
});
