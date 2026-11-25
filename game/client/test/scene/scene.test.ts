// The Scene's lifecycle around the three.js host, with the host and its view stubbed: async init that a dispose overtakes
// builds nothing, and a restored context or newly decoded art wakes the owner's idle frame loop.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostOptions } from "../../src/scene/three/host";
import { createScene } from "../../src/scene/three/scene";
import type { Assets } from "../../src/scene/three/assets";
import { hitTest } from "../../src/layout";
import type { Point, Quad } from "../../src/layout";
import { movedQuad } from "../../src/scene/stage";
import type { StageView } from "../../src/scene/stage";
import { corpusSteps, frameOf } from "./corpus";

const hosts: { opts: HostOptions; disposed: boolean }[] = [];
let fonts: { resolve: () => void; promise: Promise<void> };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
};

vi.mock("../../src/platform", async (orig) => ({ ...(await orig<typeof import("../../src/platform")>()), fontsReady: () => fonts.promise }));
vi.mock("../../src/scene/three/host", () => ({
  Host: class {
    readonly entry: { opts: HostOptions; disposed: boolean };
    constructor(opts: HostOptions) {
      this.entry = { opts, disposed: false };
      hosts.push(this.entry);
    }
    dispose() {
      this.entry.disposed = true;
    }
    get size() {
      return this.entry.opts.viewport;
    }
    setViewport() {}
    render() {}
  },
}));
vi.mock("../../src/scene/three/view", () => ({
  StageRenderer: class {
    draw(view: StageView) {
      if (drawThrows) throw new Error("lost");
      drawnViews.push(view);
    }
    artArrived() {}
    clear() {}
    dispose() {}
  },
}));

const assets = { surfaces: {}, tomeNormal: null } as unknown as Assets;
let drawThrows = false;
const drawnViews: StageView[] = [];
const options = (wake = () => {}) => ({ canvas: {} as HTMLCanvasElement, viewport: { w: 1180, h: 820 }, dpr: 1, assets, wake });

beforeEach(() => {
  hosts.length = 0;
  drawnViews.length = 0;
  drawThrows = false;
  fonts = deferred();
});

describe("the scene's async init", () => {
  it("disposed while fonts are pending, it builds no host when they land", async () => {
    const scene = createScene(options());
    const ready = scene.ready();
    scene.dispose();
    fonts.resolve();
    await ready;
    expect(hosts).toEqual([]);
    expect(scene.host).toBeNull();
  });
  it("ready after dispose builds nothing", async () => {
    const scene = createScene(options());
    scene.dispose();
    fonts.resolve();
    await scene.ready();
    expect(hosts).toEqual([]);
  });
});

describe("waking an idle loop", () => {
  it("a restored context and newly decoded art ask the owner for a frame", async () => {
    const wake = vi.fn();
    const scene = createScene(options(wake));
    fonts.resolve();
    await scene.ready();
    expect(hosts).toHaveLength(1);
    const h = hosts[0]!.opts;
    h.onRebuild?.();
    expect(wake).toHaveBeenCalledTimes(1);
    h.onArt?.("cache/cards/a.jpg");
    expect(wake).toHaveBeenCalledTimes(2);
    scene.dispose();
    expect(hosts[0]!.disposed).toBe(true);
    h.onArt?.("cache/cards/b.jpg"); // a late arrival after teardown wakes nothing
    expect(wake).toHaveBeenCalledTimes(2);
  });
});

describe("picking", () => {
  const centre = (q: Quad): Point => ({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 });
  it("reaches a card where the last frame drawn without a fault drew it, and layout's group at rest", async () => {
    const scene = createScene(options());
    fonts.resolve();
    await scene.ready();
    expect(scene.pick({ x: 10, y: 10 })).toBeNull(); // nothing drawn yet
    let t = 0;
    let moving: { id: string; at: Point } | null = null;
    for (const run of corpusSteps()) {
      for (const step of run) {
        let report = scene.show(frameOf(step, [step.set]), (t += 16));
        for (let k = 0; k < 300 && report.active; k++) {
          const view = drawnViews.at(-1)!;
          for (const g of step.plan.hits.groups) {
            const d = view.drawn.get(g.id);
            if (!d?.pickable || moving) continue;
            const c = centre(movedQuad(step.plan.projector, g.quad, d));
            const home = centre(g.quad);
            if (Math.hypot(c.x - home.x, c.y - home.y) > 40 && hitTest(step.plan, c)?.id !== g.id && scene.pick(c)?.id === g.id) moving = { id: g.id, at: c };
          }
          if (moving) {
            // A faulted frame draws nothing: the picker keeps the last frame that was drawn.
            drawThrows = true;
            expect(scene.show(frameOf(step, []), (t += 16)).fault).not.toBeNull();
            drawThrows = false;
            expect(scene.pick(moving.at)?.id).toBe(moving.id);
            break;
          }
          report = scene.show(frameOf(step, []), (t += 16));
        }
        if (moving) break;
        for (let k = 0; k < 1250 && report.active; k++) report = scene.show(frameOf(step, []), (t += 16));
        const p = centre(step.plan.hits.groups[0]!.quad);
        expect(scene.pick(p)?.id).toBe(hitTest(step.plan, p)?.id);
      }
      if (moving) break;
    }
    expect(moving).not.toBeNull();
    scene.dispose();
  });
});
