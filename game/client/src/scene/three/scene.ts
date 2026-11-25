// The Scene (docs "scene: the table"): data in, a report out. The app hands it a whole frame each commit; the stage
// turns it into motion, the view draws it with the host, and the report says what happened. A throw in `show` is a
// fault: reported, and the next commit is a cut; a lost context rebuilds the host and cuts likewise.
import { tableTemplate } from "../../layout";
import type { CameraSpec, HitGroup, Point, TablePlan, Viewport } from "../../layout";
import { Queue, fontsReady } from "../../platform";
import type { Ms } from "../../platform";
import type { ArtLoader } from "../resources";
import { pickDrawn } from "../stage/pick";
import { Stage } from "../stage/stage";
import { estimate } from "../stage/labels";
import { SIGN_FONT, font } from "../../theme";
import type { SceneFrame, SceneIntent, SceneReport, SceneSnapshot, StageView } from "../stage/types";
import { loadAssets } from "./assets";
import type { Assets } from "./assets";
import { Host } from "./host";
import { StageRenderer } from "./view";

export interface Scene {
  /** Classified gestures over the canvas. (A stub source for now: the gesture recognizer lands with input/.) */
  readonly out: Queue<SceneIntent>;
  /** three loaded, fonts and surfaces ready. */
  ready(): Promise<void>;
  /** Consume changes, retarget, step the animator to `now`, draw. */
  show(frame: SceneFrame, now: Ms): SceneReport;
  /** Plain data for tests, debug and the recorder: pieces, flights, the backlog. */
  inspect(): SceneSnapshot;
  /**
   * What a tap at `p` reaches: layout's hit groups where the last frame drawn without a fault drew their pieces (a card
   * moving through a reflow is reached where it is seen). At rest, layout's `hitTest` on that plan; the same group ids.
   * A piece showing none of its cards (in flight to it, or held by the chrome) is not reached. Groups in `skip` are
   * looked through (the layout audit sets a focus aside).
   */
  pick(p: Point, skip?: ReadonlySet<string>): HitGroup | null;
  dispose(): void;
}

export interface SceneOptions {
  readonly canvas: HTMLCanvasElement;
  readonly viewport: Viewport;
  readonly dpr: number;
  readonly camera?: CameraSpec;
  /** Loaded in `ready` when not given. */
  readonly assets?: Assets;
  readonly art?: ArtLoader;
  readonly reducedMotion?: boolean;
  /**
   * Asks the owner for a frame when the scene changed between commits on its own: a lost context came back (the board
   * is rebuilt as a cut) or art a face was waiting for finished decoding. An idle loop draws nothing until it is woken.
   */
  readonly wake?: () => void;
}

const IDLE: SceneReport = { active: false, consumed: null, consumedSeq: null, landed: [], stackLanding: null, fault: null, recaps: [], flying: false };

export interface SceneHandle extends Scene {
  /** The host, once ready (the workbench's stats and screenshots). */
  readonly host: Host | null;
  readonly renderer: StageRenderer | null;
}

/**
 * A label's text width (CSS px) at a size, as its sign paints it: measured on a canvas in the sign's font (once fonts
 * are ready, as everything painted is), at the sign's own size and scaled.
 */
function signMeasure(doc: Document | null | undefined): (text: string, px: number) => number {
  const ctx = doc?.createElement("canvas").getContext("2d");
  if (!ctx) return estimate;
  const cache = new Map<string, number>();
  return (text, px) => {
    let w = cache.get(text);
    if (w === undefined) {
      ctx.font = `700 ${SIGN_FONT.text}px ${font.num}`;
      w = ctx.measureText(text).width;
      cache.set(text, w);
    }
    return (w * px) / SIGN_FONT.text;
  };
}

export function createScene(opts: SceneOptions): SceneHandle {
  const stage = new Stage({ ...(opts.reducedMotion === undefined ? {} : { reducedMotion: opts.reducedMotion }), measure: signMeasure(opts.canvas.ownerDocument) });
  const out = new Queue<SceneIntent>();
  let host: Host | null = null;
  let renderer: StageRenderer | null = null;
  let plan: SceneFrame["plan"] | null = null;
  /** The last frame drawn without a fault: its plan and where it drew each piece (what `pick` reaches). */
  let shown: { readonly plan: TablePlan; readonly drawn: StageView["drawn"] } | null = null;
  let pending: Promise<void> | null = null;
  /** Set by dispose: an init still waiting on fonts or images builds nothing when they land. */
  let disposed = false;

  const ready = (): Promise<void> => {
    pending ??= (async () => {
      await fontsReady();
      if (disposed) return;
      const assets = opts.assets ?? (await loadAssets());
      if (disposed) return;
      const h = new Host({
        canvas: opts.canvas,
        viewport: opts.viewport,
        dpr: opts.dpr,
        camera: opts.camera ?? tableTemplate(4).camera,
        assets,
        ...(opts.art ? { art: opts.art } : {}),
        onArt: (url) => {
          if (!renderer) return;
          renderer.artArrived(url);
          opts.wake?.();
        },
        onRebuild: () => {
          // Nothing on the GPU survived: drop every object; the next frame is a cut from the latest state.
          shown = null;
          renderer?.clear();
          stage.reset();
          opts.wake?.();
        },
      });
      host = h;
      renderer = new StageRenderer(h, () => plan?.projector.pitch ?? 0);
    })();
    return pending;
  };

  return {
    out,
    ready,
    get host() {
      return host;
    },
    get renderer() {
      return renderer;
    },
    show(frame, now) {
      if (!host || !renderer) return IDLE;
      try {
        plan = frame.plan;
        const vp = frame.plan.viewport;
        if (vp.w !== host.size.w || vp.h !== host.size.h) host.setViewport(vp, opts.dpr);
        const { report, view } = stage.show(frame, now);
        renderer.draw(view);
        host.render(now, frame.reducedMotion ?? opts.reducedMotion ?? false);
        shown = { plan: frame.plan, drawn: view.drawn };
        return report;
      } catch (e) {
        renderer.clear();
        stage.reset();
        return { ...IDLE, active: true, fault: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
      }
    },
    inspect: () => stage.inspect(),
    pick: (p, skip) => (shown ? pickDrawn(shown.plan, shown.drawn, p, skip) : null),
    dispose() {
      disposed = true;
      renderer?.dispose();
      host?.dispose();
      renderer = null;
      host = null;
      shown = null;
      out.clear();
    },
  };
}
