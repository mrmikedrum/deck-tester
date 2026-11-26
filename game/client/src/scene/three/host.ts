// The three.js host: the only owner of the WebGL renderer, the bloom composer and every GPU resource. It is given a
// viewport and a device pixel ratio (never measures the page), builds the camera from layout's projector data, holds the
// texture and art budgets, and recovers from a lost context by rebuilding everything from the latest description (the
// owner's `onRebuild`). It draws when told, at the time it is told: it has no loop of its own.
import {
  ACESFilmicToneMapping,
  Group,
  HalfFloatType,
  InstancedMesh,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { Mesh, Texture } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
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
import { DecalBatch } from "./batch";
import { CardDeck } from "./cards";
import type { CardKit } from "./cards";
import { cardGeometry } from "./geometry";
import type { CardGeometry } from "./geometry";
import { Rim } from "./materials";
import { Painter } from "./painter";
import { TextureCache } from "./textures";
import type { Lease } from "./textures";
import { FocusPass } from "./focus-pass";
import { createWorld } from "./world";
import type { World } from "./world";

const MB = 1024 * 1024;

/**
 * The memory the host allows itself: painted textures (signs, chips, pages; a face's canvas until it is copied), the face
 * atlas's pages that show nothing (the faces on show always have their layers), and decoded art.
 */
export const BUDGETS = { textures: 160 * MB, faces: 96 * MB, art: 64 * MB } as const;

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
  readonly budgets?: { readonly textures: number; readonly faces?: number; readonly art: number };
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
  /** The last frame drawn: its draw calls and triangles (every pass: shadows, the table, the focus, bloom, output). */
  readonly calls: number;
  readonly triangles: number;
  /** Cards drawn and the instanced batches they took; sprites likewise; the face atlas's pages and faces. */
  readonly cards: number;
  readonly cardBatches: number;
  readonly sprites: number;
  readonly spriteBatches: number;
  readonly atlas: { readonly pages: number; readonly faces: number; readonly shown: number; readonly bytes: number };
  /** Frames whose shadow map was drawn again (something that throws a shadow moved). */
  readonly shadowFrames: number;
}

/** The post-processing's settings (`Host.setQuality`). */
export interface Quality {
  /** The composer's pixel ratio (its targets: bloom, the focus pass); null is the policy's (`renderSizes`). */
  readonly composerDpr: number | null;
  readonly bloom: boolean;
  readonly msaa: boolean;
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
  private bloomPass!: UnrealBloomPass;
  /** The post-processing's settings (the render bench times each): the composer's pixel ratio, bloom, MSAA. */
  private quality: Quality = { composerDpr: null, bloom: true, msaa: true };
  private textures: TextureCache;
  private arts: ArtCache;
  private _painter: Painter;
  private _kit: CardKit;
  private geo: CardGeometry;
  private deck: CardDeck;
  private decals: DecalBatch;
  private readonly batches = new Group();
  private room: Texture | null = null;
  private backLease: Lease;
  private world: World;
  private tableLease: Lease;
  private spec: CameraSpec;
  /** A composed camera drawn instead of the table's (a zoom), or null. */
  private override: CameraParams | null = null;
  private viewport: Viewport;
  private dpr: number;
  private lost = false;
  private rebuilds = 0;
  private frames = 0;
  private shadowFrames = 0;
  /** The shadow map is stale (a new world, a resize): drawn again on the next frame whatever moved. */
  private shadowStale = true;
  /** The shadow casters outside the deck (dice) as last drawn: a sum over their matrices. */
  private casterSum = NaN;
  private drawn = { calls: 0, triangles: 0 };
  /** The time of the last frame drawn, for its delta and the intervals. */
  private lastFrame: number | null = null;
  private intervals: number[] = [];
  private pacing = { count: 0, max: 0, over33: 0 };
  private readonly budgets: { readonly textures: number; readonly faces?: number; readonly art: number };
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
    // The shadow map is drawn only while what throws a shadow moves (`render`).
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;
    // The host updates the scene's matrices once a frame, before the deck reads them (`render`).
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.add(this.batches);
    this.composer = this.newComposer();
    this.textures = this.newTextures();
    this.arts = this.newArts();
    this._painter = this.newPainter();
    this.geo = cardGeometry();
    this.backLease = this._painter.back();
    this.deck = new CardDeck(this.renderer.capabilities.getMaxAnisotropy(), this.backLease.texture, this.rim, this.budgets.faces ?? BUDGETS.faces);
    this.decals = new DecalBatch(this.batches);
    this.batches.add(this.deck.group);
    this._kit = { deck: this.deck, geo: this.geo, rim: this.rim };
    this.tableLease = this._painter.table();
    this.world = createWorld(this.tableLease, opts.assets.tomeNormal);
    this.scene.background = this.world.background;
    this.scene.add(this.world.group);
    this.environment();
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
    this.composer.setPixelRatio(this.quality.composerDpr === null ? s.composer : Math.min(s.renderer, this.quality.composerDpr));
    this.composer.setSize(s.width, s.height);
    applyCamera(this.camera, this.override ?? cameraParams(this.spec, viewport));
    this.shadowStale = true;
  }

  setCamera(spec: CameraSpec): void {
    this.spec = spec;
    applyCamera(this.camera, this.override ?? cameraParams(spec, this.viewport));
  }

  /** Draw from a composed camera (a zoom), or the table's own again (null). */
  setCameraOverride(p: CameraParams | null): void {
    if (!p && !this.override) return;
    this.override = p;
    applyCamera(this.camera, p ?? cameraParams(this.spec, this.viewport));
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
    this.scene.updateMatrixWorld();
    const moved = this.deck.sync(this.scene);
    this.decals.sync(this.scene);
    const sum = this.casters();
    if (moved || this.shadowStale || sum !== this.casterSum) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowFrames++;
    }
    this.shadowStale = false;
    this.casterSum = sum;
    this.deck.atlas.flush(this.renderer);
    this.renderer.info.reset();
    this.composer.render(dt / 1000);
    this.drawn = { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
    this.frames++;
    this.arts.releaseFresh();
  }

  /** The shadow casters the deck does not draw (dice), as one number: it changes when one moves, comes or goes. */
  private casters(): number {
    let sum = 0,
      k = 1;
    this.scene.traverseVisible((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.castShadow || (o as InstancedMesh).isInstancedMesh) return;
      for (const e of o.matrixWorld.elements) sum += e * (k = (k * 31) % 1009);
    });
    return sum;
  }

  /** The room the card stock and the bronze reflect, faintly (a prefiltered RoomEnvironment). */
  private environment(): void {
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.room = pmrem.fromScene(room, materials.lights.room.blur).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.room;
    this.scene.environmentIntensity = materials.lights.room.intensity;
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
      calls: this.drawn.calls,
      triangles: this.drawn.triangles,
      ...(() => {
        const d = this.deck.stats(),
          s = this.decals.stats();
        return { cards: d.cards, cardBatches: d.batches, atlas: d.atlas, sprites: s.sprites, spriteBatches: s.batches };
      })(),
      shadowFrames: this.shadowFrames,
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

  /**
   * The post-processing's settings, for measuring what each costs (the render bench): the composer's pixel ratio (null:
   * the policy's), bloom on or off, MSAA on or off. The game never changes them.
   */
  setQuality(q: Partial<Quality>): void {
    const msaa = q.msaa !== undefined && q.msaa !== this.quality.msaa;
    this.quality = { ...this.quality, ...q };
    if (msaa) {
      disposeComposer(this.composer);
      this.composer = this.newComposer();
    }
    this.bloomPass.enabled = this.quality.bloom;
    this.setViewport(this.viewport, this.dpr);
  }

  private newComposer(): EffectComposer {
    const s = renderSizes(this.viewport, this.dpr);
    const target = new WebGLRenderTarget(s.width, s.height, {
      samples: this.quality.msaa ? materials.tone.msaaSamples : 0,
      type: HalfFloatType,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // The stack's scrim, and what stands above it (focus-pass.ts).
    this.focusPass = new FocusPass(this.scene, this.camera, colour.stackScrim);
    composer.addPass(this.focusPass);
    // Light that is brighter than white blooms: the spells and the arcs. Cards and pages never reach it.
    const b = materials.bloom;
    this.bloomPass = new UnrealBloomPass(new Vector2(s.width, s.height), b.strength, b.radius, b.threshold);
    this.bloomPass.enabled = this.quality.bloom;
    composer.addPass(this.bloomPass);
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
    this.batches.remove(this.deck.group);
    this.deck.dispose();
    this.decals.dispose();
    this.room?.dispose();
    this.room = null;
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
    this.deck = new CardDeck(this.renderer.capabilities.getMaxAnisotropy(), this.backLease.texture, this.rim, this.budgets.faces ?? BUDGETS.faces);
    this.decals = new DecalBatch(this.batches);
    this.batches.add(this.deck.group);
    this._kit = { deck: this.deck, geo: this.geo, rim: this.rim };
    this.tableLease = this._painter.table();
    this.world = createWorld(this.tableLease, this.opts.assets.tomeNormal);
    this.scene.background = this.world.background;
    this.scene.add(this.world.group);
    this.environment();
    this.casterSum = NaN;
    this.setViewport(this.viewport, this.dpr);
    this.lost = false;
    this.rebuilds++;
    this.opts.onRebuild?.();
  }
}
