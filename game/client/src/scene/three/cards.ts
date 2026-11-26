// Every card on the table as one lit object, drawn together: a card is a slab of stock at its true thickness (its face on
// +z, its back on -z, its cut edge between), and every card of the same kind of draw is one instance of one mesh, so a
// table of two hundred cards costs a handful of draw calls. Faces live in a face atlas (layers of an array texture, one
// face each, copied from the painted canvas), so cards wearing different faces still draw together.
//
// A card in the scene graph is a proxy (`createCard`): its pose group, the body the tap turns, and an invisible mesh of
// its outline that the layout audit measures and raycasts. Each frame the deck (`CardDeck.sync`) walks the scene once,
// and every proxy that is shown becomes an instance: its world matrix, its face's layer, and its look (tapped, dimmed,
// flat for a highlight, the signal on its rim). A block (the cards under a pile's top one) is the same slab stretched to
// its height, a fine line on its walls per card.
import {
  Color,
  DataArrayTexture,
  DataTexture,
  DoubleSide,
  ExtrudeGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  Vector3,
} from "three";
import type { Object3D, Scene, Texture, WebGLRenderer } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FACE_H, FACE_W, materials, seeded } from "../../theme";
import { ABOVE } from "./focus-pass";
import type { CardGeometry } from "./geometry";
import type { Rim, Signal } from "./materials";
import type { Lease } from "./textures";

const { card, slab, rim: rimParams, faceTone, lights } = materials;
const T = card.thickness;

// ---- exposure -----------------------------------------------------------------------------------------------------

/** The lamp's light reaching a point (three's spot attenuation: its cone's smooth edge over its distance falloff). */
function lampAt(x: number, y: number, z: number): number {
  const l = lights.lamp;
  const dx = x - l.at.x, dy = y - l.at.y, dz = z - l.at.z, d = Math.hypot(dx, dy, dz);
  const ax = l.aim.x - l.at.x, ay = l.aim.y - l.at.y, az = l.aim.z - l.at.z, a = Math.hypot(ax, ay, az);
  const cos = (dx * ax + dy * ay + dz * az) / (d * a);
  const outer = Math.cos(l.angle), inner = Math.cos(l.angle * (1 - l.penumbra));
  const t = Math.min(1, Math.max(0, (cos - outer) / (inner - outer)));
  return (t * t * (3 - 2 * t)) / Math.max(Math.pow(d, l.decay), 0.01);
}

/**
 * How much of the lamp a card lifted off the table takes (1 on the table): the lamp's light where a card of scale `s`
 * stands on the table there, over its light where the card is drawn, never more than 1. A card lifted toward the lamp
 * (the gathering, a lean-in) is exposed as it would be on the table, never blown out in the lamp's hot spot.
 */
export function liftExposure(x: number, y: number, z: number, s: number): number {
  const rest = Math.min(y, 0.5 * card.h * s);
  if (rest >= y) return 1;
  const there = lampAt(x, y, z);
  return there > 0 ? Math.min(2, Math.max(0.5, lampAt(x, rest, z) / there)) : 1;
}

/** Faces per page of the atlas (one array texture): 32 faces at 336 x 468 with mipmaps is about 27 MB. */
export const FACE_LAYERS = 32;
/** One page's GPU storage, bytes (RGBA, with its mipmaps). */
export const PAGE_BYTES = Math.round((FACE_W * FACE_H * 4 * FACE_LAYERS * 4) / 3);

// ---- the face atlas -------------------------------------------------------------------------------------------------

/** A face's place in the atlas: its page and layer, held by whoever shows it. */
export interface FaceSlot {
  readonly key: string;
  readonly page: number;
  readonly layer: number;
}

interface SlotState extends FaceSlot {
  refs: number;
  used: number;
  /** Its face is not in its layer yet (or its copy found no canvas): the next lease of it copies again. */
  stale: boolean;
}

/**
 * Painted faces as layers of array textures. A lease's canvas is copied into its layer once (the canvas texture itself is
 * never uploaded); a layer nobody shows keeps its face until its room is wanted, so a face that comes back costs
 * nothing. A new face takes a free layer, else the layer of the face least recently shown that nobody shows now, and
 * only then a new page: the atlas grows with the faces on show, not with every face ever painted. A page that shows
 * nothing goes once the atlas is over its byte budget (or holds nothing at all). Copies wait for `flush`, which the host
 * calls before it draws.
 */
export class FaceAtlas {
  /** The pages, by index (a page let go is null until its room is wanted again). */
  readonly pages: (DataArrayTexture | null)[] = [];
  private readonly slots = new Map<string, SlotState>();
  private readonly free: number[][] = [];
  private pending: { slot: SlotState; image: unknown }[] = [];
  private clock = 0;

  constructor(
    private readonly anisotropy: number,
    /** The GPU bytes its pages may hold while they show nothing; faces on show always have a layer. */
    private readonly budget: number = 3 * PAGE_BYTES,
  ) {}

  /** A layer for the face `lease` holds (copied on the next flush, unless the atlas has it already). */
  acquire(lease: Lease): FaceSlot {
    let s = this.slots.get(lease.key);
    if (!s) {
      const at = this.room();
      s = { key: lease.key, page: at.page, layer: at.layer, refs: 0, used: 0, stale: true };
      this.slots.set(lease.key, s);
    }
    if (s.stale && !this.pending.some((c) => c.slot === s)) this.pending.push({ slot: s, image: lease.texture.image });
    s.refs++;
    s.used = ++this.clock;
    return s;
  }

  release(slot: FaceSlot): void {
    const s = this.slots.get(slot.key);
    if (!s || s.refs <= 0) return;
    s.refs--;
    s.used = ++this.clock;
  }

  /** A layer for a new face: a free one, the least recently shown face nobody shows now, or a page more. */
  private room(): { page: number; layer: number } {
    for (let p = 0; p < this.free.length; p++) {
      const layer = this.pages[p] ? this.free[p]!.pop() : undefined;
      if (layer !== undefined) return { page: p, layer };
    }
    let idle: SlotState | null = null;
    for (const s of this.slots.values()) if (s.refs === 0 && (!idle || s.used < idle.used)) idle = s;
    if (idle) {
      this.slots.delete(idle.key);
      this.pending = this.pending.filter((c) => c.slot !== idle);
      return { page: idle.page, layer: idle.layer };
    }
    return { page: this.addPage(), layer: 0 };
  }

  /** A new page (in the room of one let go, if any), its layers all free but the first (the caller's). */
  private addPage(): number {
    const gone = this.pages.indexOf(null);
    const page = gone >= 0 ? gone : this.pages.length;
    const t = new DataArrayTexture(null, FACE_W, FACE_H, FACE_LAYERS);
    t.colorSpace = SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = this.anisotropy;
    // Storage only: the faces are copied into it layer by layer.
    t.source.dataReady = false;
    t.needsUpdate = true;
    this.pages[page] = t;
    this.free[page] = Array.from({ length: FACE_LAYERS - 1 }, (_, i) => FACE_LAYERS - 1 - i);
    return page;
  }

  /** At least one page, so a deck with no face yet (a block alone) still has a texture to bind. */
  ensure(): void {
    if (!this.pages.some((p) => p)) this.free[this.addPage()]!.push(0);
  }

  /** The GPU bytes its pages hold. */
  get bytes(): number {
    return this.pages.filter((p) => p).length * PAGE_BYTES;
  }

  /**
   * Let go of pages that show nothing while they hold more than the budget, and of any page that holds no face at all
   * (the first page stays, for `ensure`). Their faces, shown again, are copied again.
   */
  trim(): void {
    const showing = new Set<number>(),
      holding = new Set<number>();
    for (const s of this.slots.values()) {
      holding.add(s.page);
      if (s.refs > 0) showing.add(s.page);
    }
    let idle = 0;
    for (let p = 0; p < this.pages.length; p++) if (this.pages[p] && !showing.has(p)) idle += PAGE_BYTES;
    for (let p = this.pages.length - 1; p > 0; p--) {
      const t = this.pages[p];
      if (!t || showing.has(p) || (holding.has(p) && idle <= this.budget)) continue;
      idle -= PAGE_BYTES;
      for (const [k, s] of this.slots) if (s.page === p) this.slots.delete(k);
      this.pending = this.pending.filter((c) => c.slot.page !== p);
      t.dispose();
      this.pages[p] = null;
      this.free[p] = [];
    }
  }

  /** Copy the faces waiting into their layers, and make each page's mipmaps once. */
  flush(renderer: WebGLRenderer): void {
    this.trim();
    if (!this.pending.length) return;
    const todo = this.pending;
    this.pending = [];
    const ok = todo.filter((c) => {
      const img = c.image as { width?: number; height?: number } | null;
      return !!this.pages[c.slot.page] && this.slots.get(c.slot.key) === c.slot && !!img?.width && !!img.height && img.width <= FACE_W && img.height <= FACE_H;
    });
    const lastOf = new Map<number, number>();
    ok.forEach((c, i) => lastOf.set(c.slot.page, i));
    const at = new Vector3();
    ok.forEach((c, i) => {
      const page = this.pages[c.slot.page]!;
      page.mipmapsAutoUpdate = lastOf.get(c.slot.page) === i;
      const src = { image: c.image, isTexture: true } as unknown as Texture;
      renderer.copyTextureToTexture(src, page, null, at.set(0, 0, c.slot.layer));
      page.mipmapsAutoUpdate = true;
      c.slot.stale = false;
    });
  }

  stats(): { pages: number; faces: number; shown: number; bytes: number } {
    let shown = 0;
    for (const s of this.slots.values()) if (s.refs > 0) shown++;
    return { pages: this.pages.filter((p) => p).length, faces: this.slots.size, shown, bytes: this.bytes };
  }

  dispose(): void {
    for (const p of this.pages) p?.dispose();
    this.pages.length = 0;
    this.free.length = 0;
    this.slots.clear();
    this.pending = [];
  }
}

// ---- the card's geometry ----------------------------------------------------------------------------------------------

function outline(): Shape {
  const r = card.corner,
    w = card.w,
    h = card.h,
    sh = new Shape();
  sh.moveTo(-w / 2 + r, -h / 2);
  sh.lineTo(w / 2 - r, -h / 2);
  sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  sh.lineTo(w / 2, h / 2 - r);
  sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  sh.lineTo(-w / 2 + r, h / 2);
  sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  sh.lineTo(-w / 2, -h / 2 + r);
  sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return sh;
}

function part(g: BufferGeometry, id: number): BufferGeometry {
  const n = g.attributes["position"]!.count;
  g.setAttribute("aPart", new BufferAttribute(new Float32Array(n).fill(id), 1));
  return g;
}

/** The face's plane (uv over the card), on +z at the card's half thickness. */
function facePlane(): BufferGeometry {
  const w = card.w,
    h = card.h;
  const g = new ShapeGeometry(outline(), card.curveSegments);
  const uv = g.attributes["uv"]!,
    pos = g.attributes["position"]!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  return g.toNonIndexed();
}

/**
 * One card as one geometry: its face (part 0) on +z, its cut edge (part 1) all round, its back (part 2) on -z; 1 tall,
 * `card.thickness` thick, centred. A block is this, stretched along z.
 */
export function slabGeometry(): BufferGeometry {
  const front = part(facePlane().translate(0, 0, T / 2), 0);
  const back = part(facePlane().rotateY(Math.PI).translate(0, 0, -T / 2), 2);
  const ext = new ExtrudeGeometry(outline(), { depth: T, bevelEnabled: false, curveSegments: card.curveSegments });
  const sides = ext.groups[1];
  const pick = (name: string, size: number): BufferAttribute => {
    const a = ext.attributes[name]!.array as Float32Array;
    return new BufferAttribute(a.slice((sides?.start ?? 0) * size, ((sides?.start ?? 0) + (sides?.count ?? 0)) * size), size);
  };
  const walls = new BufferGeometry();
  walls.setAttribute("position", pick("position", 3));
  walls.setAttribute("normal", pick("normal", 3));
  walls.setAttribute("uv", pick("uv", 2));
  walls.translate(0, 0, -T / 2);
  part(walls, 1);
  ext.dispose();
  const g = mergeGeometries([front, walls, back]);
  for (const x of [front, walls, back]) x.dispose();
  if (!g) throw new Error("the card's parts would not merge");
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Paper's tooth: a soft tiling noise the face's bump reads (seeded, so every page draws it the same). */
function grainTexture(): DataTexture {
  const N = 128,
    rand = seeded(91),
    base = new Float32Array(N * N);
  for (let i = 0; i < base.length; i++) base[i] = rand();
  const at = (x: number, y: number): number => base[((y + N) % N) * N + ((x + N) % N)]!;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      // A fine speckle over a softer mottle, so it reads as fibre, not as a pattern.
      let v = at(x, y) * 0.5;
      v += ((at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 4) * 0.3;
      v += ((at(x >> 2, y >> 2) + at((x >> 2) + 1, y >> 2)) / 2) * 0.2;
      const k = (y * N + x) * 4,
        b = Math.round(255 * v);
      data[k] = data[k + 1] = data[k + 2] = b;
      data[k + 3] = 255;
    }
  const t = new DataTexture(data, N, N);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.repeat.set(slab.face.grainTiles[0], slab.face.grainTiles[1]);
  t.needsUpdate = true;
  return t;
}

// ---- the card's material --------------------------------------------------------------------------------------------

const f3 = (n: number): string => n.toFixed(3);

const VERTEX_PARS = /* glsl */ `
attribute float aPart;
attribute float iLayer;
attribute vec4 iLook;
attribute vec4 iRim;
attribute vec2 iMore;
varying float vPart;
varying float vLayer;
varying vec4 vLook;
varying vec4 vRim;
varying vec2 vMore;
varying vec2 vCardUv;
varying float vSlab;
`;

const VERTEX_MAIN = /* glsl */ `
vPart = aPart;
vLayer = iLayer;
vLook = iLook;
vRim = iRim;
vMore = iMore;
vCardUv = uv;
vSlab = position.z / ${f3(T)} + 0.5;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2DArray uFaces;
uniform sampler2D uBack;
uniform vec3 uStock;
uniform float uTime;
varying float vPart;
varying float vLayer;
varying vec4 vLook;
varying vec4 vRim;
varying vec2 vMore;
varying vec2 vCardUv;
varying float vSlab;
`;

/**
 * What a card's surface is before the light: its face from the atlas (a block's top is stock), its cut edge cream stock
 * with a line per card on a block's walls, its back the tome's leather. Then its looks: tapped darkens and cools, dim
 * greys it out, and the signal paints a band on its rim (the glow round it is light: `rimGlow_`, added after).
 */
const FRAGMENT_MAP = /* glsl */ `
vec3 rimGlow_ = vec3(0.0);
float front_ = 1.0 - step(0.5, vPart);
vec3 base_;
if (vPart < 0.5 && vLayer >= 0.0) {
  base_ = texture(uFaces, vec3(vCardUv.x, 1.0 - vCardUv.y, vLayer)).rgb;
} else if (vPart > 1.5) {
  base_ = texture2D(uBack, vCardUv).rgb;
} else {
  float n_ = vLook.w;
  float k_ = fract(vSlab * max(n_, 1.0));
  float line_ = n_ > 1.5 ? mix(0.6, 1.0, smoothstep(0.0, 0.3, k_) * smoothstep(1.0, 0.7, k_)) : 1.0;
  base_ = uStock * vMore.x * line_;
  front_ = 0.0;
}
diffuseColor.rgb *= base_;
float g_ = dot(diffuseColor.rgb, vec3(.299, .587, .114));
diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(g_), diffuseColor.rgb, ${f3(faceTone.tap.mix)}) * vec3(${faceTone.tap.tint.map(f3).join(",")}), step(0.5, vLook.x) * front_);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(g_) * ${f3(faceTone.dim.grey)}, vLook.y * ${f3(faceTone.dim.amount)});
if (front_ > 0.5) {
  float rimW_ = vRim.w;
  float e_ = min(min(vCardUv.x, 1.0 - vCardUv.x) * 1.4, min(vCardUv.y, 1.0 - vCardUv.y));
  float flick_ = 0.85 + 0.15 * sin(uTime * 7.0 + vCardUv.y * 20.0) * sin(uTime * 3.1 + vCardUv.x * 17.0);
  float sel_ = step(${f3(rimParams.hardAbove)}, rimW_);
  float band_ = smoothstep(rimW_, rimW_ - 0.005, e_);
  diffuseColor.rgb = mix(diffuseColor.rgb, vRim.rgb, band_ * sel_);
  diffuseColor.rgb *= 1.0 - 0.7 * sel_ * smoothstep(rimW_ + 0.009, rimW_ + 0.004, e_) * smoothstep(rimW_ - 0.003, rimW_ + 0.002, e_);
  rimGlow_ = vRim.rgb * smoothstep(mix(rimW_, 0.03, sel_), 0.0, e_) * flick_ * mix(2.2, 0.3, sel_);
  rimGlow_ += vRim.rgb * (1.0 - sel_) * 0.18 * flick_ * (1.0 - smoothstep(0.0, 0.065, e_));
  diffuseColor.rgb *= 1.0 - 0.85 * step(0.06, rimW_) * smoothstep(0.012, 0.008, e_);
}
`;

/**
 * The lamp's light on a lifted card is its exposure on the table (`liftExposure`, vMore.y); the room's fill is as is. Its
 * mirror of the lamp, which no card on the table shows from my seat, fades as it rises (a gathered card turned up toward
 * me would otherwise catch the lamp's highlight full in the face and go milky).
 */
const FRAGMENT_LIGHTS = /* glsl */ `#include <lights_fragment_end>
float lift_ = min(vMore.y, 1.0);
reflectedLight.directDiffuse *= vMore.y;
reflectedLight.directSpecular *= lift_ * lift_ * lift_ * lift_;`;

/** A highlight steps the card out of the light: `flat` 1 is its surface as painted, unlit (vLook.z). */
const FRAGMENT_OUT = /* glsl */ `
outgoingLight = mix(outgoingLight, diffuseColor.rgb, vLook.z);
outgoingLight += rimGlow_;
#include <opaque_fragment>`;

/** The lit card material for one atlas page (its faces), opaque or drawn in the transparent pass (a sift's cards). */
function cardMaterial(page: Texture, back: Texture, grain: Texture, time: { value: number }, transparent: boolean): MeshStandardMaterial {
  const f = slab.face;
  const m = new MeshStandardMaterial({ roughness: f.roughness, metalness: 0, envMapIntensity: f.env, bumpMap: grain, bumpScale: f.grain, transparent });
  const uniforms = { uFaces: { value: page }, uBack: { value: back }, uStock: { value: new Color(slab.stock) }, uTime: time };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\n${VERTEX_PARS}`).replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <map_fragment>", FRAGMENT_MAP)
      .replace("#include <lights_fragment_end>", FRAGMENT_LIGHTS)
      .replace("#include <opaque_fragment>", FRAGMENT_OUT);
  };
  m.customProgramCacheKey = () => "deck-card";
  m.userData["uniforms"] = uniforms;
  return m;
}

// ---- a card in the scene graph --------------------------------------------------------------------------------------

/** Marks a card's proxy: its state, which the deck reads each frame. */
export const CARD = "deckCard";

export interface CardOptions {
  readonly tapped?: boolean;
  readonly token?: boolean;
  readonly dim?: boolean;
  /** Drawn in the transparent pass (a sift's cards, ordered over the sift's shade by `order`). */
  readonly transparent?: boolean;
  /** Its draw order among its pass (0 by default). */
  readonly order?: number;
  /** Throws a shadow (default true; a stack card and a sifted one do not). */
  readonly shadow?: boolean;
}

/** What the deck reads off a card proxy. */
export interface CardState {
  slot: FaceSlot | null;
  tap: number;
  dim: number;
  /** How far it has stepped out of the light (a highlight): 0 lit, 1 flat and unlit. */
  flat: number;
  signal: Signal | null;
  /** A block: its lines (cards) on its walls; 0 for one card. */
  strata: number;
  /** The stock's tone (a token's greyer, a block's fades with its pile). */
  stock: number;
  readonly transparent: boolean;
  readonly order: number;
  /** Throws a shadow (off for a fighter on the clash's plane, whose shadow would land far off on the table). */
  shadow: boolean;
}

export interface CardKit {
  readonly deck: CardDeck;
  readonly rim: Rim;
  readonly geo: CardGeometry;
}

/** One card as the scene graph holds it. Position, turn and scale go on `group`; the tap turns `body`. */
export interface CardObject {
  readonly group: Group;
  readonly body: Group;
  /** The card's outline where it is drawn (invisible: the deck draws it): what the audit measures and raycasts. */
  readonly front: Mesh;
  readonly state: CardState;
  /** Wear the face `lease` holds (the caller keeps holding it while it is worn). */
  face(lease: Lease): void;
  dispose(): void;
}

export function createCard(kit: CardKit, face: Lease | null, opts: CardOptions = {}): CardObject {
  const deck = kit.deck;
  const group = new Group();
  const body = new Group();
  const front = new Mesh(deck.geometry, deck.proxy);
  const state: CardState = {
    slot: null,
    tap: opts.tapped ? 1 : 0,
    dim: opts.dim ? 1 : 0,
    flat: 0,
    signal: null,
    strata: 0,
    // (A token's stock as a tone of the stock's colour: by its green, close enough for cream.)
    stock: opts.token ? new Color(slab.tokenStock).g / new Color(slab.stock).g : 1,
    transparent: !!opts.transparent,
    order: opts.order ?? 0,
    shadow: opts.shadow ?? true,
  };
  front.userData[CARD] = state;
  body.rotation.z = opts.tapped ? -Math.PI / 2 : 0;
  body.add(front);
  group.add(body);
  const wear = (lease: Lease | null): void => {
    const next = lease ? deck.atlas.acquire(lease) : null;
    if (state.slot) deck.atlas.release(state.slot);
    state.slot = next;
  };
  wear(face);
  return {
    group,
    body,
    front,
    state,
    face: wear,
    dispose() {
      if (state.slot) deck.atlas.release(state.slot);
      state.slot = null;
      front.userData[CARD] = undefined;
    },
  };
}

/** Show or clear a signal on a card's rim (its colour is the shared, breathing one). */
export function setSignal(c: CardObject, kind: Signal | null): void {
  c.state.signal = kind;
}

/** A card's look: tapped (shaded), dimmed, how flat (a highlight). */
export function setLook(c: CardObject, look: { readonly tap?: number; readonly dim?: number; readonly flat?: number }): void {
  if (look.tap !== undefined) c.state.tap = look.tap;
  if (look.dim !== undefined) c.state.dim = look.dim;
  if (look.flat !== undefined) c.state.flat = look.flat;
}

// ---- the deck: every card drawn ---------------------------------------------------------------------------------------

const WIDTH: Readonly<Record<Signal, number>> = { option: rimParams.option, selected: rimParams.selected, danger: rimParams.danger };

/** One instanced mesh: the cards of one atlas page, layer (table or above the scrim), pass and order. */
class Batch {
  readonly mesh: InstancedMesh;
  readonly layer: InstancedBufferAttribute;
  readonly look: InstancedBufferAttribute;
  readonly rim: InstancedBufferAttribute;
  readonly more: InstancedBufferAttribute;
  n = 0;
  /** Frames since it last drew anything. */
  idle = 0;
  constructor(
    base: BufferGeometry,
    material: MeshStandardMaterial,
    readonly capacity: number,
    above: boolean,
    order: number,
    shadow: boolean,
  ) {
    const g = new BufferGeometry();
    for (const [k, a] of Object.entries(base.attributes)) g.setAttribute(k, a);
    this.layer = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.look = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.rim = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.more = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    g.setAttribute("iLayer", this.layer);
    g.setAttribute("iLook", this.look);
    g.setAttribute("iRim", this.rim);
    g.setAttribute("iMore", this.more);
    this.mesh = new InstancedMesh(g, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = order;
    this.mesh.matrixAutoUpdate = false;
    // Above the scrim it is drawn again over it, and on the table too: there it throws its shadow onto the dimmed table.
    if (above) this.mesh.layers.enable(ABOVE);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

const ZERO = new Color(0, 0, 0);
/** A batch unused for this many frames is disposed. */
const IDLE_FRAMES = 120;

/**
 * The deck: the face atlas, the card's geometry and materials, and the instanced meshes every card is drawn with. `sync`
 * gathers the shown proxies under `root` each frame; the host calls it after the scene's matrices are up to date.
 */
export class CardDeck {
  readonly atlas: FaceAtlas;
  readonly geometry: BufferGeometry;
  /** The proxies' material: never drawn. */
  readonly proxy = new MeshBasicMaterial({ visible: false, side: DoubleSide });
  readonly group = new Group();
  private readonly grain = grainTexture();
  private readonly mats = new Map<string, MeshStandardMaterial>();
  private readonly batches = new Map<string, Batch>();
  /** The shadow casters' instance data last frame, to tell whether the shadow map must be drawn again. */
  private casters = new Float64Array(0);

  constructor(
    anisotropy: number,
    private readonly back: Texture,
    private readonly rim: Rim,
    /** The face atlas's byte budget for pages that show nothing (`FaceAtlas`). */
    faceBudget?: number,
  ) {
    this.atlas = new FaceAtlas(anisotropy, faceBudget);
    this.geometry = slabGeometry();
    this.group.matrixAutoUpdate = false;
  }

  /** The material for a page's cards, reading the page's texture as it is now (a page let go and made again is new). */
  private material(page: number, transparent: boolean): MeshStandardMaterial {
    const k = `${page}|${transparent}`;
    const tex = this.atlas.pages[page]!;
    let m = this.mats.get(k);
    if (!m) {
      m = cardMaterial(tex, this.back, this.grain, this.rim.time, transparent);
      this.mats.set(k, m);
    }
    (m.userData["uniforms"] as { uFaces: { value: Texture } }).uFaces.value = tex;
    return m;
  }

  /**
   * Draw every shown card under `root` (call once a frame, matrices updated): each proxy whose ancestors are all visible
   * becomes an instance of its batch. True when what throws shadows moved, appeared or went (the shadow map is stale).
   */
  sync(root: Scene | Object3D): boolean {
    const found: { s: CardState; o: Mesh; above: boolean }[] = [];
    root.traverseVisible((o) => {
      const s = o.userData[CARD] as CardState | undefined;
      if (s) found.push({ s, o: o as Mesh, above: (o.layers.mask & (1 << ABOVE)) !== 0 && (o.layers.mask & 1) === 0 });
    });
    const groups = new Map<string, typeof found>();
    for (const f of found) {
      const page = f.s.slot?.page ?? 0;
      const k = `${page}|${f.above ? 1 : 0}|${f.s.transparent}|${f.s.order}|${f.s.shadow}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(f);
    }
    // A batch nothing has used for a while goes (its texture or its kind of draw may never come back).
    for (const [k, b] of this.batches) {
      if (groups.has(k)) {
        b.idle = 0;
        continue;
      }
      b.mesh.count = 0;
      if (++b.idle > IDLE_FRAMES) {
        this.group.remove(b.mesh);
        b.dispose();
        this.batches.delete(k);
      }
    }
    const casters: number[] = [];
    for (const [k, list] of groups) {
      const [page, above, transparent, order, shadow] = k.split("|");
      this.atlas.ensure();
      let b = this.batches.get(k);
      if (!b || b.capacity < list.length) {
        if (b) {
          this.group.remove(b.mesh);
          b.dispose();
        }
        let cap = 16;
        while (cap < list.length) cap *= 2;
        b = new Batch(this.geometry, this.material(Number(page), transparent === "true"), cap, above === "1", Number(order), shadow === "true");
        this.batches.set(k, b);
        this.group.add(b.mesh);
      }
      b.mesh.material = this.material(Number(page), transparent === "true");
      list.forEach((f, i) => {
        const s = f.s;
        b.mesh.setMatrixAt(i, f.o.matrixWorld);
        b.layer.setX(i, s.slot && s.strata === 0 ? s.slot.layer : -1);
        b.look.setXYZW(i, s.tap > 0.5 ? 1 : 0, s.dim, s.flat, s.strata);
        const c = s.signal ? this.rim.colours[s.signal] : ZERO;
        b.rim.setXYZW(i, c.r, c.g, c.b, s.signal ? WIDTH[s.signal] : rimParams.idle);
        const e = f.o.matrixWorld.elements;
        b.more.setXY(i, s.stock, liftExposure(e[12]!, e[13]!, e[14]!, Math.hypot(e[0]!, e[1]!, e[2]!)));
        if (shadow === "true") for (const e of f.o.matrixWorld.elements) casters.push(e);
      });
      b.n = list.length;
      b.mesh.count = list.length;
      b.mesh.instanceMatrix.needsUpdate = true;
      for (const a of [b.layer, b.look, b.rim, b.more]) a.needsUpdate = true;
    }
    let moved = casters.length !== this.casters.length;
    if (!moved) for (let i = 0; i < casters.length; i++) if (Math.abs(casters[i]! - this.casters[i]!) > 1e-6) { moved = true; break; }
    if (moved) this.casters = Float64Array.from(casters);
    return moved;
  }

  /** How many cards are drawn now and in how many batches (the workbench's stats). */
  stats(): { cards: number; batches: number; atlas: ReturnType<FaceAtlas["stats"]> } {
    let cards = 0,
      batches = 0;
    for (const b of this.batches.values())
      if (b.mesh.count) {
        cards += b.mesh.count;
        batches++;
      }
    return { cards, batches, atlas: this.atlas.stats() };
  }

  dispose(): void {
    for (const b of this.batches.values()) {
      this.group.remove(b.mesh);
      b.dispose();
    }
    this.batches.clear();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    this.atlas.dispose();
    this.geometry.dispose();
    this.grain.dispose();
    this.proxy.dispose();
  }
}
