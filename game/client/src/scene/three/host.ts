// The three.js host: the only owner of the WebGL renderer, the bloom composer and every GPU resource. It is given a
// viewport and a device pixel ratio (never measures the page), builds the camera from layout's projector data, holds the
// texture and art budgets, and recovers from a lost context by rebuilding everything from the latest description (the
// owner's `onRebuild`). It draws when told, at the time it is told: it has no loop of its own.
import {
  ACESFilmicToneMapping,
  HalfFloatType,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { CameraSpec } from "../../layout/projector";
import type { Viewport } from "../../layout/types";
import { colour, materials } from "../../theme";
import type { FaceEnv } from "../../theme";
import { ArtCache } from "../resources";
import type { ArtLoader, ArtStats, CacheStats } from "../resources";
import { loadArt } from "./assets";
import type { Assets } from "./assets";
import { applyCamera, cameraParams, renderSizes } from "./camera";
import type { CameraParams } from "./camera";
import { cardGeometry } from "./geometry";
import type { CardGeometry } from "./geometry";
import { Rim, SharedMaterials } from "./materials";
import { Painter } from "./painter";
import { TextureCache } from "./textures";
import type { Lease } from "./textures";
import { FocusPass } from "./focus-pass";
import { createWorld } from "./world";
import type { World } from "./world";
import type { CardKit } from "./card";

const MB = 1024 * 1024;

/** The memory the host allows itself: painted textures on the GPU, and decoded art. */
export const BUDGETS = { textures: 160 * MB, art: 64 * MB } as const;

/**
 * Dispose a composer and the passes it was given: the composer frees only its own targets and copy pass, while bloom
 * owns several render targets and materials, and the output pass a material.
 */
export function disposeComposer(composer: EffectComposer): void {
  for (const pass of composer.passes) pass.dispose();
  composer.dispose();
}

export interface HostOptions {
  readonly canvas: HTMLCanvasElement;
  readonly viewport: Viewport;
  readonly dpr: number;
  readonly camera: CameraSpec;
  readonly assets: Assets;
  /** Loads card art by url (default: fetch and decode). */
  readonly art?: ArtLoader;
  /** Called when art arrives that a painted face may have wanted: repaint what shows it. */
  readonly onArt?: (url: string) => void;
  /** The context was lost and has come back: every resource was disposed; rebuild the scene from the latest description. */
  readonly onRebuild?: () => void;
  readonly budgets?: { readonly textures: number; readonly art: number };
}

export interface HostStats {
  /** Painted textures: entries live (shown) and idle (cached), their estimated bytes, evictions. */
  readonly textures: CacheStats;
  /** Decoded art likewise, with loads out (`pending`) and loads started, decoded and failed. */
  readonly art: ArtStats;
  /** What three.js holds on the GPU now (renderer.info.memory). */
  readonly geometries: number;
  readonly gpuTextures: number;
  readonly contextLost: boolean;
  readonly rebuilds: number;
  /** Frames drawn since the host was made. */
  readonly frames: number;
}

/** How many frame intervals the host keeps (about ten seconds at 60 fps). */
export const FRAME_WINDOW = 600;

/** Frame pacing: the intervals between drawn frames on the clock `render` is given (the frame loop's), newest last. */
export interface FrameIntervals {
  /** The last FRAME_WINDOW intervals, ms, since the host was made or the last reset. */
  readonly intervals: readonly number[];
  /** Over the same span: frames counted, the longest interval, and how many were over 33 ms (a missed 30 fps frame). */
  readonly count: number;
  readonly max: number;
  readonly over33: number;
}

export class Host {
  readonly canvas: HTMLCanvasElement;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly rim = new Rim();
  readonly renderer: WebGLRenderer;
  private composer: EffectComposer;
  private focusPass!: FocusPass;
  private textures: TextureCache;
  private arts: ArtCache;
  private _painter: Painter;
  private _kit: CardKit;
  private geo: CardGeometry;
  private shared: SharedMaterials;
  private backLease: Lease;
  private world: World;
  private tableLease: Lease;
  private spec: CameraSpec;
  private viewport: Viewport;
  private dpr: number;
  private lost = false;
  private rebuilds = 0;
  private frames = 0;
  /** The time of the last frame drawn, for its delta and the intervals. */
  private lastFrame: number | null = null;
  private intervals: number[] = [];
  private pacing = { count: 0, max: 0, over33: 0 };
  private readonly budgets: { readonly textures: number; readonly art: number };
  private readonly listeners: { readonly lost: (e: Event) => void; readonly restored: () => void };

  constructor(private readonly opts: HostOptions) {
    this.canvas = opts.canvas;
    this.spec = opts.camera;
    this.viewport = opts.viewport;
    this.dpr = opts.dpr;
    this.budgets = opts.budgets ?? BUDGETS;
    this.renderer = new WebGLRenderer({ canvas: opts.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = materials.tone.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.composer = this.newComposer();
    this.textures = this.newTextures();
    this.arts = this.newArts();
    this._painter = this.newPainter();
    this.geo = cardGeometry();
    this.backLease = this._painter.back();
    this.shared = new SharedMaterials(colour.cardEdge, colour.tokenEdge, this.backLease.texture);
    this._kit = { geo: this.geo, shared: this.shared, rim: this.rim };
    this.tableLease = this._painter.table();
    this.world = createWorld(this.tableLease, opts.assets.tomeNormal);
    this.scene.background = this.world.background;
    this.scene.add(this.world.group);
    this.setViewport(this.viewport, this.dpr);
    this.listeners = {
      lost: (e) => {
        e.preventDefault();
        this.lost = true;
      },
      restored: () => this.recover(),
    };
    this.canvas.addEventListener("webglcontextlost", this.listeners.lost);
    this.canvas.addEventListener("webglcontextrestored", this.listeners.restored);
  }

  /** Paint and lease textures. */
  get painter(): Painter {
    return this._painter;
  }
  /** What a card needs to be made. */
  get kit(): CardKit {
    return this._kit;
  }
  get camParams(): CameraParams {
    return cameraParams(this.spec, this.viewport);
  }

  /** The viewport changed (or the pixel ratio): size every target and rebuild the camera. The page measures, the host does not. */
  setViewport(viewport: Viewport, dpr: number): void {
    this.viewport = viewport;
    this.dpr = dpr;
    const s = renderSizes(viewport, dpr);
    this.renderer.setPixelRatio(s.renderer);
    this.renderer.setSize(s.width, s.height, false);
    this.composer.setPixelRatio(s.composer);
    this.composer.setSize(s.width, s.height);
    applyCamera(this.camera, cameraParams(this.spec, viewport));
  }

  setCamera(spec: CameraSpec): void {
    this.spec = spec;
    applyCamera(this.camera, cameraParams(spec, this.viewport));
  }

  /** The table's light (1 is full; the stage dims it under the stack). */
  setTableTone(k: number): void {
    this.world.tone(k);
  }

  /** The stack's scrim over the table (its alpha, 0 for none); what is on the ABOVE layer draws over it. */
  setScrim(alpha: number): void {
    this.focusPass.alpha = alpha;
  }

  /** The viewport the host was last given. */
  get size(): Viewport {
    return this.viewport;
  }

  get contextLost(): boolean {
    return this.lost;
  }

  /**
   * Draw the scene at time `nowMs`: the rim breathes (holds still under reduced motion), then the composer renders (bloom, tone mapping, output) with the
   * delta since the last frame given explicitly (its own clock would read the time behind the caller's back). Art that
   * arrived before this frame has now been painted: it may be evicted again.
   */
  render(nowMs: number, still = false): void {
    if (this.lost) return;
    const dt = this.lastFrame === null ? 0 : Math.max(0, nowMs - this.lastFrame);
    if (this.lastFrame !== null) this.interval(dt);
    this.lastFrame = nowMs;
    this.rim.update(nowMs, still);
    this.composer.render(dt / 1000);
    this.frames++;
    this.arts.releaseFresh();
  }

  private interval(ms: number): void {
    this.intervals.push(ms);
    if (this.intervals.length > FRAME_WINDOW) this.intervals.splice(0, this.intervals.length - FRAME_WINDOW);
    this.pacing.count++;
    this.pacing.max = Math.max(this.pacing.max, ms);
    if (ms > 33) this.pacing.over33++;
  }

  /** The frame intervals drawn so far (a copy); `reset` starts a new span (the next frame's interval is not counted). */
  frameIntervals(reset = false): FrameIntervals {
    const out = { intervals: [...this.intervals], ...this.pacing };
    if (reset) {
      this.intervals = [];
      this.pacing = { count: 0, max: 0, over33: 0 };
      this.lastFrame = null;
    }
    return out;
  }

  stats(): HostStats {
    return {
      textures: this.textures.stats(),
      art: this.arts.stats(),
      geometries: this.renderer.info.memory.geometries,
      gpuTextures: this.renderer.info.memory.textures,
      contextLost: this.lost,
      rebuilds: this.rebuilds,
      frames: this.frames,
    };
  }

  /** Decoded art for a face painter's `art` lookup (null while loading). */
  art(url: string): ReturnType<ArtCache["get"]> {
    return this.arts.get(url);
  }

  /** Starts loading art not yet decoded (a recorder preloads a scenario's art before it plays); `stats().art.pending` says when it is in. */
  preloadArt(urls: readonly string[]): void {
    for (const u of urls) this.arts.get(u);
  }

  dispose(): void {
    this.canvas.removeEventListener("webglcontextlost", this.listeners.lost);
    this.canvas.removeEventListener("webglcontextrestored", this.listeners.restored);
    this.releaseAll();
    disposeComposer(this.composer);
    this.renderer.dispose();
  }

  private newComposer(): EffectComposer {
    const s = renderSizes(this.viewport, this.dpr);
    const target = new WebGLRenderTarget(s.width, s.height, {
      samples: materials.tone.msaaSamples,
      type: HalfFloatType,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // The stack's scrim, and what stands above it (focus-pass.ts).
    this.focusPass = new FocusPass(this.scene, this.camera, colour.stackScrim);
    composer.addPass(this.focusPass);
    // Light that is brighter than white blooms: the spells and the arcs. Cards and pages never reach it.
    const b = materials.bloom;
    composer.addPass(new UnrealBloomPass(new Vector2(s.width, s.height), b.strength, b.radius, b.threshold));
    composer.addPass(new OutputPass());
    return composer;
  }

  private newTextures(): TextureCache {
    return new TextureCache({
      budget: this.budgets.textures,
      anisotropy: this.renderer.capabilities.getMaxAnisotropy(),
    });
  }

  private newArts(): ArtCache {
    return new ArtCache(this.budgets.art, this.opts.art ?? loadArt, (url) => this.opts.onArt?.(url));
  }

  private newPainter(): Painter {
    const env: FaceEnv = {
      surfaces: this.opts.assets.surfaces,
      art: (url) => this.arts.get(url) as ReturnType<FaceEnv["art"]>,
    };
    return new Painter(this.textures, env);
  }

  /** Dispose every GPU resource the host holds (not the renderer). */
  private releaseAll(): void {
    this.scene.remove(this.world.group);
    this.world.dispose();
    this.shared.dispose();
    this.geo.dispose();
    this.textures.clear();
    this.arts.clear();
  }

  /** The context came back: nothing on the GPU survived, so rebuild every resource and ask the owner for the scene. */
  private recover(): void {
    this.releaseAll();
    disposeComposer(this.composer);
    this.composer = this.newComposer();
    this.textures = this.newTextures();
    this.arts = this.newArts();
    this._painter = this.newPainter();
    this.geo = cardGeometry();
    this.backLease = this._painter.back();
    this.shared = new SharedMaterials(colour.cardEdge, colour.tokenEdge, this.backLease.texture);
    this._kit = { geo: this.geo, shared: this.shared, rim: this.rim };
    this.tableLease = this._painter.table();
    this.world = createWorld(this.tableLease, this.opts.assets.tomeNormal);
    this.scene.background = this.world.background;
    this.scene.add(this.world.group);
    this.setViewport(this.viewport, this.dpr);
    this.lost = false;
    this.rebuilds++;
    this.opts.onRebuild?.();
  }
}
