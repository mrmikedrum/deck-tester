// The page's renderer: the scene on the canvas and the chrome over it, both shown once per commit from app state, with
// one report back to the loop. The scene is built on the first commit that has a viewport and drawn once it is ready
// (three loaded, fonts in); until then the chrome's waiting state stands alone. A scene that cannot start (no WebGL, a
// failed load) is terminal: its resources are freed, it is not built again, the next commit reports one terminal fault
// (the app shows its notice with Reload) and `ready` rejects with the cause. Gestures over the canvas run through
// input's recognizer and become `act` messages aimed at what was on screen when the pointer went down: that commit, its
// stop and the hit group under the press as drawn then (layout's hit testing on the committed plan), so play drops a
// gesture whose stop has expired or whose group's members changed by the time it is let go; taps and drags so far. A
// mouse with no button down reports the group under it as `hover` when that changes (null when it leaves the canvas or
// presses); a touch never hovers.
// Teardown disposes everything; a later commit builds it again.
import { chromeRenderer } from "../chrome";
import type { ChromeRenderer } from "../chrome";
import { bindPointer } from "../input";
import type { Gesture, PointerBinding } from "../input";
import type { HitGroup, Point, SeatId } from "../layout";
import type { Act, Target } from "../play";
import type { Ms } from "../platform";
import { now } from "../platform";
import type { StopId } from "../protocol";
import { createScene } from "../scene/three/scene";
import type { SceneHandle } from "../scene/three/scene";
import type { Renderer } from "./loop";
import type { InputMsg } from "./msg";
import type { RenderReport } from "./slots";
import type { AppState } from "./state";
import { chromeView, sceneFrame } from "./views";

export interface PagePorts {
  readonly canvas: HTMLCanvasElement;
  readonly ui: HTMLElement;
  /** Queues the player's input for the next frame. */
  readonly emit: (m: InputMsg) => void;
  /** Asks the loop for a frame. */
  readonly wake: () => void;
  readonly dpr: () => number;
}

export interface PageRenderer extends Renderer {
  /** The scene, once built (the debug surface's `inspect`). */
  readonly scene: SceneHandle | null;
  /** Resolves when the scene is first ready to draw; rejects, with the cause, when it cannot start. */
  readonly ready: Promise<void>;
}

/** What a gesture is aimed at: the group under it, or nothing; a sifted card's group (`sift:<card>`, the scene's
 * `siftGroupId`) is the card itself, as a tap on it on the table would be. */
const targetOf = (g: HitGroup | null): Target => {
  if (!g) return { nothing: true };
  const card = g.id.startsWith("sift:") ? g.members[0] : undefined;
  return card !== undefined ? { card } : { group: g.id, members: g.members };
};

/** A press on the canvas, captured at pointer-down: the commit and stop on screen then, and the hit group under it. */
interface Press {
  readonly commit: number;
  readonly stop: StopId | null;
  readonly group: HitGroup | null;
}

export function pageRenderer(ports: PagePorts): PageRenderer {
  let chrome: ChromeRenderer | null = null;
  let scene: SceneHandle | null = null;
  let sceneReady = false;
  /** The scene could not start: reported once (`failure` until then), and not built again until teardown. */
  let failed = false;
  let failure: string | null = null;
  let binding: PointerBinding | null = null;
  /** What the last commit showed: canvas gestures are stamped with it and aimed at its stop. */
  let drawn: { commit: number; stop: StopId | null } = { commit: 0, stop: null };
  /** The last press, read by the recognizer's `pick` as the pointer goes down (each gesture keeps its own). */
  let press: Press = { commit: 0, stop: null, group: null };
  /** The group a mouse hovers, as last emitted. */
  let hovered: string | null = null;
  /** The plates' hit groups as last committed: a drag let go over a nameplate (chrome) drops on that seat's plate. */
  let plates: readonly HitGroup[] = [];
  let markReady: () => void = () => {};
  let markFailed: (e: unknown) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  ready.catch(() => undefined); // the cause is reported as a fault; a page with no one waiting on `ready` is no error

  const pick = (x: number, y: number): HitGroup | null => {
    if (!scene) return null;
    const r = ports.canvas.getBoundingClientRect();
    const p: Point = { x: x - r.left, y: y - r.top };
    return scene.pick(p);
  };
  /** The seat whose page is under (x, y), CSS px in the page. */
  const seatAt = (x: number, y: number): SeatId | null => {
    if (!scene) return null;
    const r = ports.canvas.getBoundingClientRect();
    return scene.seatAt({ x: x - r.left, y: y - r.top });
  };
  /** The plate whose nameplate is on top at (x, y), CSS px in the page. */
  const plateAt = (x: number, y: number): HitGroup | null => {
    const el = ports.canvas.ownerDocument.elementFromPoint(x, y)?.closest<HTMLElement>("[data-plate]");
    const seat = el?.dataset["plate"];
    return seat === undefined ? null : (plates.find((g) => g.seat !== null && String(g.seat) === seat) ?? null);
  };
  const act = (act: Act, at: Ms, p: Press): void => ports.emit({ t: "act", stamp: { at, commit: p.commit }, stop: p.stop, act });
  const capture = (e: PointerEvent): void => {
    press = { commit: drawn.commit, stop: drawn.stop, group: pick(e.clientX, e.clientY) };
  };
  const hover = (group: string | null): void => {
    if (group === hovered) return;
    hovered = group;
    ports.emit({ t: "hover", stamp: { at: now(), commit: drawn.commit }, group });
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.buttons === 0) hover(pick(e.clientX, e.clientY)?.id ?? null);
  };
  const onOff = (): void => hover(null);
  const gesture = (g: Gesture<Press>): void => {
    switch (g.g) {
      case "tap":
        if (g.on) act({ a: "tap", on: targetOf(g.on.group) }, g.at, g.on);
        return;
      case "drop":
        // The drop's target is what is under it now (a seat's nameplate, which is chrome, or the table); its source,
        // stop and commit are the press's.
        if (g.on?.group) act({ a: "drag", from: targetOf(g.on.group), onto: targetOf(plateAt(g.x, g.y) ?? pick(g.x, g.y)) }, g.at, g.on);
        return;
      case "hold": {
        // A long press on a card or pile, or on a seat's page: the zoom's trial composes the camera on it (the app
        // ignores it otherwise).
        if (!g.on) return;
        const seat = g.on.group ? null : seatAt(g.x, g.y);
        const to = g.on.group ? { group: g.on.group.id } : seat !== null ? { seat } : null;
        if (to) ports.emit({ t: "zoom", stamp: { at: g.at, commit: g.on.commit }, to });
        return;
      }
      default:
        return; // the wheel: not in the slice; hover is read off the canvas's own moves (onMove)
    }
  };

  function build(s: AppState): void {
    chrome ??= chromeRenderer(ports.ui, { emit: (i) => ports.emit(i), wake: ports.wake });
    if (scene || failed || s.viewport.w <= 0 || s.viewport.h <= 0) return;
    const sc = createScene({ canvas: ports.canvas, viewport: { w: s.viewport.w, h: s.viewport.h }, dpr: ports.dpr(), wake: ports.wake });
    scene = sc;
    sceneReady = false;
    sc.ready().then(
      () => {
        if (scene !== sc) return;
        sceneReady = true;
        markReady();
        ports.wake();
      },
      (e: unknown) => {
        if (scene !== sc) return;
        failed = true;
        failure = `scene: ${e instanceof Error ? e.message : String(e)}`;
        scene = null;
        sc.dispose();
        markFailed(e);
        ports.wake();
      },
    );
    // Before the recognizer's own listener, so its `pick` reads this press.
    ports.canvas.addEventListener("pointerdown", capture);
    binding = bindPointer<Press>(ports.canvas, { pick: () => press, on: (gs) => gs.forEach(gesture) });
    ports.canvas.addEventListener("pointerdown", ports.wake);
    ports.canvas.addEventListener("pointermove", onMove);
    ports.canvas.addEventListener("pointerleave", onOff);
    ports.canvas.addEventListener("pointerdown", onOff);
  }

  return {
    get scene() {
      return scene;
    },
    ready,
    show(state, now): RenderReport {
      plates = state.plan ? state.plan.hits.groups.filter((g) => g.kind === "plate") : [];
      build(state);
      binding?.tick(now);
      const frame = sceneFrame(state);
      const sceneReport = scene && sceneReady && frame ? scene.show(frame, now) : null;
      const c = chrome!.show(chromeView(state, sceneReport), now);
      drawn = { commit: state.commit, stop: frame?.cues.stop ?? null };
      const terminal = failure;
      failure = null;
      const active = (sceneReport?.active ?? false) || c.active || (binding?.active ?? false);
      // `ambient`: the scene's report says its idle table still moves on its own (read structurally: the scene's report
      // type may not name it yet).
      const ambient = (sceneReport as { readonly ambient?: boolean } | null)?.ambient === true;
      const more = { ...(c.carried?.length ? { carried: c.carried } : {}), ...(ambient ? { ambient } : {}) };
      if (terminal !== null) return { active, fault: terminal, terminal: true, scene: sceneReport, ...more };
      return { active, fault: sceneReport?.fault ?? c.fault, scene: sceneReport, ...more };
    },
    dispose() {
      binding?.dispose();
      ports.canvas.removeEventListener("pointerdown", ports.wake);
      ports.canvas.removeEventListener("pointerdown", capture);
      ports.canvas.removeEventListener("pointermove", onMove);
      ports.canvas.removeEventListener("pointerleave", onOff);
      ports.canvas.removeEventListener("pointerdown", onOff);
      hovered = null;
      scene?.dispose();
      chrome?.dispose();
      binding = null;
      scene = null;
      chrome = null;
      sceneReady = false;
      failed = false; // a later commit may try again
      failure = null;
    },
  };
}
