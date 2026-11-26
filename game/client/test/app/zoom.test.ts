// The camera zoom's trial (`?zoom`): a long press on the table composes the camera on what is under it (a card or pile,
// or a seat's page); then any input (a tap on the table, a prompt's button, a hand card, Escape) only brings the table
// back, and nothing of it reaches play. Without the trial nothing zooms.
import { describe, expect, it } from "vitest";
import { initialState } from "../../src/app/state";
import { update } from "../../src/app/update";
import type { AppState } from "../../src/app/state";
import type { Msg } from "../../src/app/msg";
import type { CommitId, Stamp } from "../../src/protocol";
import type { Ms } from "../../src/platform";
import { seatId } from "../../src/model";
import type { ZoomRequest } from "../../src/scene/stage";

const stamp: Stamp = { at: 10, commit: 0 as CommitId };
const zoom = (to: ZoomRequest | null): Msg => ({ t: "zoom", stamp, to });
const run = (s: AppState, ...ms: Msg[]): AppState => ms.reduce((x, m) => update(x, m).state, s);
const zoomed = (to: ZoomRequest = { group: "card:7" }) => run(initialState({ clientBuild: "t", zoomTrial: true }), zoom(to));

describe("the zoom's trial", () => {
  it("a long press zooms to the group or the seat's page under it", () => {
    expect(zoomed().zoom.on).toEqual({ group: "card:7" });
    expect(zoomed({ seat: seatId("Marath") }).zoom.on).toEqual({ seat: "Marath" });
  });

  it("Escape brings the table back and closes nothing", () => {
    const s = zoomed();
    const back = update(s, { t: "dismiss", stamp });
    expect(back.state.zoom.on).toBeNull();
    expect(back.effects).toEqual([]);
    expect(back.state.focus).toBe(s.focus);
  });

  // Every way input acts: a tap on the table, a prompt's button, opening a layer. Zoomed, each only comes back.
  const acts: [string, Msg][] = [
    ["a tap on the table", { t: "act", stamp, stop: null, act: { a: "tap", on: { group: "card:9", members: [] } } }],
    ["a prompt's button", { t: "act", stamp, stop: null, act: { a: "press", button: "b1" } } as Msg],
    ["opening the inspector", { t: "open", stamp, layer: "inspector", card: null }],
    ["a seat's board", { t: "board", stamp, seat: "Marath" }],
  ];
  for (const [what, m] of acts)
    it(`zoomed in, ${what} only brings the table back: play hears nothing`, () => {
      const s = zoomed();
      const step = update(s, m);
      expect(step.state.zoom.on).toBeNull();
      expect(step.state.play).toBe(s.play);
      expect(step.state.focus).toBe(s.focus);
      expect(step.effects).toEqual([]);
    });

  // The camera eases back over the theme's time: what is under a press then is what it shows on its way, not the table.
  const drew = (composed: boolean): Msg => ({
    t: "scene",
    at: 20 as Ms,
    report: { active: composed, fault: null, scene: { active: composed, consumed: null, consumedSeq: null, landed: [], stackLanding: null, fault: null, recaps: [], flying: false, ...(composed ? { composed } : {}) } },
  });
  const menu: Msg = { t: "open", stamp, layer: "menu", card: null };
  for (const [what, m] of [...acts, ["opening the Game menu", menu] as [string, Msg]])
    it(`on the camera's way back, ${what} still reaches nothing`, () => {
      // Zoomed and drawn so, then Escape: the subject is gone but the camera has not reached the table yet.
      const s = run(zoomed(), drew(true), { t: "dismiss", stamp }, drew(true));
      expect(s.zoom.on).toBeNull();
      const step = update(s, m);
      expect(step.state.play).toBe(s.play);
      expect(step.state.focus).toBe(s.focus);
      expect(step.effects).toEqual([]);
    });

  it("once the table's camera is drawn again, input acts again", () => {
    const home = run(zoomed(), drew(true), { t: "dismiss", stamp }, drew(true), drew(false));
    expect(update(home, menu).state.focus).not.toBe(home.focus);
  });

  it("a hover is still a hover while zoomed", () => {
    const s = update(zoomed(), { t: "hover", stamp, group: "card:3" }).state;
    expect(s.zoom.on).toEqual({ group: "card:7" });
    expect(s.hover).toBe("card:3");
  });

  it("without the trial a long press does nothing", () => {
    const s0 = initialState({ clientBuild: "t" });
    expect(run(s0, zoom({ group: "card:7" }))).toBe(s0);
  });
});
