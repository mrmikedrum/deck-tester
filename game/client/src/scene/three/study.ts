// The render study's scenes (the page is scene/study; three.js is imported only here): one board, four ways of drawing it.
//   A physical: cards as objects (lit faces and paper edges, real thickness, piles a few mm high), one warm spot lamp
//     with soft shadow maps that fall on the vellum and on cards, a hemisphere fill and a faint room reflection, contact
//     darkening under everything that touches the table, standing cards held in bronze stands.
//   B illustrated: flat unlit tiles, soft blurred drop shadows, piles suggested by a few offset edges, the tome's own
//     painted light and nothing else.
//   C hybrid: A's light, shadows and proportions with B's faces: lit but matte, and partly self-lit so they stay clean.
//   D focus: A's board, and a moment that steps out of realism: what matters now is lifted, drawn flat and unlit with a
//     halo, over the rest of the table dimmed by a scrim (the game's focus pass, generalised).
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  NoColorSpace,
  NoToneMapping,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  QuadraticBezierCurve3,
  RepeatWrapping,
  Scene,
  Shape,
  ShapeGeometry,
  SpotLight,
  SRGBColorSpace,
  Texture,
  TubeGeometry,
  Vector2,
  Vector3,
  VSMShadowMap,
  WebGLRenderer,
} from "three";
import type { Material } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  colour,
  FACE_H,
  FACE_W,
  faceKey,
  faceSpec,
  paintBack,
  paintFace,
  paintTable,
  seeded,
  signal,
  TABLE_PLANE,
  TABLE_PX,
} from "../../theme";
import type { FaceEnv, FaceSpec, Source } from "../../theme";
import { tableTemplate } from "../../layout";
import type { V3 } from "../../layout";
import { applyCamera, cameraParams } from "./camera";
import { CH, CW, THICK, faceOf } from "../study/board";
import type { Board, Piece } from "../study/board";

export type Variant = "A" | "B" | "C" | "D";
export type Moment = "rest" | "main" | "combat" | "spell";

export interface StudyParams {
  readonly variant: Variant;
  readonly moment: Moment;
  readonly shadow: "pcf" | "vsm";
  readonly shadowSize: number;
  readonly shadowRadius: number;
  /** The scrim over the rest of the table in a moment (0 none, 1 black); null: the moment's own. */
  readonly dim: number | null;
  /** How far what matters rises off the table, world units (a card is 1.85 tall). */
  readonly lift: number;
  /** How unlit what matters is drawn: 1 flat and unlit, 0 as lit as the table. */
  readonly flat: number;
  /** The halo's strength (0 none). */
  readonly halo: number;
  /** How far into the moment: 0 at rest, 1 fully in (a still of the transition between). */
  readonly t: number;
  /** Redraw the shadow map every frame (a moving table); false draws it once (a still one). */
  readonly liveShadows: boolean;
}

export interface StudyEnv extends FaceEnv {
  readonly tomeNormal: Source | null;
}

/** The focus's layer: what matters draws here again, above the scrim. */
const ABOVE = 1;

/** The painted face's card (inside its 4 px margin) and its corner, as fractions and in world units. */
const PAINT = { u0: 4 / FACE_W, u1: 1 - 4 / FACE_W, v0: 4 / FACE_H, v1: 1 - 4 / FACE_H } as const;
const CORNER = (16 / (FACE_H - 8)) * CH;

/**
 * The lamp: up and to the left of the table, a little toward the viewer, so standing cards face it and throw their shade
 * back and to the right where it shows; its cone and distance make a pool of light that falls off toward the corners.
 */
const LAMP = {
  intensity: 1750,
  angle: 0.5,
  penumbra: 1,
  at: { x: -11, y: 23, z: 4 },
  aim: { x: 0.5, y: 0, z: -3.5 },
  fill: 0.38,
} as const;

const linearAlpha = (a: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, a)), 2.2);
const vec = (p: V3): Vector3 => new Vector3(p.x, p.y, p.z);

function roundRect(w: number, h: number, r: number): Shape {
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

/** The face plane: the card's outline, its uv mapped onto the painted card inside the canvas's margin. */
function faceGeometry(): BufferGeometry {
  const g = new ShapeGeometry(roundRect(CW, CH, CORNER), 6);
  const uv = g.attributes["uv"],
    pos = g.attributes["position"];
  if (uv && pos)
    for (let i = 0; i < uv.count; i++) {
      const u = (pos.getX(i) + CW / 2) / CW,
        v = (pos.getY(i) + CH / 2) / CH;
      uv.setXY(i, PAINT.u0 + u * (PAINT.u1 - PAINT.u0), PAINT.v0 + v * (PAINT.v1 - PAINT.v0));
    }
  return g;
}

/** A slab of the card's outline `depth` thick, from z = 0 up (caps, then sides; local z is the slab's height). */
function slab(depth: number): BufferGeometry {
  return new ExtrudeGeometry(roundRect(CW, CH, CORNER), { depth, bevelEnabled: false, curveSegments: 6 });
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext("2d");
  if (!x) throw new Error("no 2d context");
  return x;
}

/**
 * A soft rounded rectangle on a plane `pw` x `ph`: the card's outline at its centre, alpha 1 inside and `fall(d)` at a
 * distance d (world units) outside it. Computed from the outline's distance field, so it is smooth and the same in
 * every browser. Grey levels: a material colours it and reads them as its alpha.
 */
function softRect(pw: number, ph: number, fall: (d: number) => number, px = 192): DataTexture {
  const w = px,
    h = Math.round((px * ph) / pw),
    data = new Uint8Array(w * h * 4);
  const hx = CW / 2 - CORNER,
    hy = CH / 2 - CORNER;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = ((i + 0.5) / w - 0.5) * pw,
        y = ((j + 0.5) / h - 0.5) * ph;
      const qx = Math.max(Math.abs(x) - hx, 0),
        qy = Math.max(Math.abs(y) - hy, 0);
      const d = Math.hypot(qx, qy) - CORNER;
      const a = d <= 0 ? 1 : fall(d);
      const k = (j * w + i) * 4;
      // Every channel: an alphaMap reads green.
      data[k] = data[k + 1] = data[k + 2] = data[k + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
    }
  const t = new DataTexture(data, w, h);
  t.colorSpace = NoColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** A number on a disc: bronze and struck (physical) or a parchment badge (illustrated). */
function numberDisc(n: number, look: "bronze" | "badge", bronze: Source | null): CanvasTexture {
  const S = 128,
    c = canvas(S, S),
    x = ctx(c);
  x.beginPath();
  x.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  if (look === "bronze") {
    x.fillStyle = (bronze && x.createPattern(bronze, "repeat")) || colour.bronze;
    x.fill();
    const g = x.createRadialGradient(S * 0.4, S * 0.35, 4, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(255,230,180,.25)");
    g.addColorStop(1, "rgba(30,15,5,.45)");
    x.fillStyle = g;
    x.fill();
    x.lineWidth = 5;
    x.strokeStyle = "rgba(40,22,8,.8)";
    x.stroke();
  } else {
    x.fillStyle = colour.bone;
    x.fill();
    x.lineWidth = 7;
    x.strokeStyle = colour.ink;
    x.stroke();
  }
  x.font = `700 ${n > 9 ? 62 : 74}px "Barlow Condensed", sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  const label = String(n);
  if (look === "bronze") {
    // Struck: a dark cut with a lit lip below it.
    x.fillStyle = "rgba(255,225,170,.55)";
    x.fillText(label, S / 2 + 1, S / 2 + 6);
    x.fillStyle = "rgba(30,14,4,.95)";
    x.fillText(label, S / 2, S / 2 + 3);
  } else {
    x.fillStyle = colour.ink;
    x.fillText(label, S / 2, S / 2 + 4);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Uniform<T> {
  value: T;
}

/**
 * A lit face (MeshStandardMaterial) that can step out of the light: `flat` mixes its lit colour with its texture as an
 * unlit face would show it, after tone mapping (so 1 is exactly the game's unlit face). One material, one uniform: a
 * moment crosses smoothly instead of swapping materials.
 */
function steppingFace(m: MeshStandardMaterial, flat: Uniform<number>): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms["uFlat"] = flat;
    sh.fragmentShader =
      "uniform float uFlat;\n" +
      sh.fragmentShader.replace(
        "#include <tonemapping_fragment>",
        "#include <tonemapping_fragment>\n#ifdef USE_MAP\ngl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(map, vMapUv).rgb, uFlat);\n#endif",
      );
  };
  m.customProgramCacheKey = () => "stepping";
}

/** A pile's sides: the edges of the cards in it, a fine light-and-dark line each, by height in the slab. */
function paperEdge(m: MeshStandardMaterial): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms["uThick"] = { value: THICK };
    sh.vertexShader =
      "varying float vSlabZ;\n" +
      sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSlabZ = position.z;");
    sh.fragmentShader =
      "uniform float uThick;\nvarying float vSlabZ;\n" +
      sh.fragmentShader.replace(
        "#include <map_fragment>",
        "#include <map_fragment>\nfloat k_ = fract(vSlabZ / uThick);\ndiffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 0.35, k_) * smoothstep(1.0, 0.75, k_));",
      );
  };
  m.customProgramCacheKey = () => "paper-edge";
}

export interface Study {
  readonly renderer: WebGLRenderer;
  /** The game's camera (layout's template, the projector's fov rule), or a closer one looking from `eye` at `at`. */
  look(view: { readonly eye: V3; readonly at: V3; readonly fov: number } | null): void;
  draw(): void;
  /** Draw, then wait for the GPU to finish (one pixel read back): the frame's whole cost, CPU and GPU. */
  drawSync(): void;
  /** The scene's numbers: draw calls and triangles of one frame, and what lights and shadows it uses. */
  stats(): Record<string, number | string>;
  dispose(): void;
}

/** What matters in each moment: by seat, the names lifted out, the halo's colour and how much the rest dims. */
interface MomentSpec {
  readonly pick: (p: Piece) => boolean;
  readonly colour: (p: Piece) => string;
  readonly dim: number;
}

const ME = 0,
  ATRAXA = 2;

const MAIN = new Set([
  "Island",
  "Mystic Sanctuary",
  "Otawara, Soaring City",
  "Minamo, School at Water's Edge",
  "Vesuva",
  "Arcane Signet",
  "Fellwar Stone",
  "Everflowing Chalice",
  "Springleaf Drum",
  "Insight Engine",
  "Staff of the Storyteller",
  "Princess Yue",
  "Faerie Mastermind",
  "Meloku the Clouded Mirror",
  "Whirler Rogue",
]);
const ATTACKERS = new Set([
  "Princess Yue",
  "Faerie Mastermind",
  "Master of Waves",
  "Meloku the Clouded Mirror",
  "Mulldrifter",
  "Elemental (Waves)",
]);
const BLOCKERS = new Set([
  "Atraxa, Praetors' Voice",
  "Tekuthal, Inquiry Dominus",
  "Brimaz, Blight of Oreskos",
  "Steel Overseer",
  "Phyrexian Metamorph",
  "Chrome Host Seedshark",
  "Filigree Vector",
  "Cankerbloom",
  "Hangarback Walker",
  "Thopter",
  "Construct",
]);
const ANSWERS = new Set([
  "Mana Vault",
  "Grim Monolith",
  "Mox Opal",
  "Chrome Mox",
  "Throne of Geth",
  "Tezzeret, Cruel Captain",
  "Wrenn and Realmbreaker",
]);

const MOMENTS: Readonly<Record<Exclude<Moment, "rest">, MomentSpec>> = {
  // My main phase: what I can use now (untapped mana, abilities I can pay for); tapped and idle things stay on the table.
  main: { pick: (p) => p.seat === ME && !p.tapped && MAIN.has(p.name), colour: () => signal.option, dim: 0.32 },
  // Combat: my attackers, the defender's possible blockers and the mana and permanents that could answer.
  combat: {
    pick: (p) =>
      !p.tapped &&
      ((p.seat === ME && ATTACKERS.has(p.name)) ||
        (p.seat === ATRAXA && (BLOCKERS.has(p.name) || ANSWERS.has(p.name)))),
    colour: (p) => (p.seat === ME ? signal.option : signal.dangerRim),
    dim: 0.42,
  },
  // A spell and its target: Swords to Plowshares, held up, at my Meloku.
  spell: {
    pick: (p) => p.seat === ME && p.name === "Meloku the Clouded Mirror",
    colour: () => signal.dangerRim,
    dim: 0.55,
  },
};

export function buildStudy(
  canvasEl: HTMLCanvasElement,
  board: Board,
  env: StudyEnv,
  prm: StudyParams,
  size: { w: number; h: number; dpr: number },
): Study {
  const physical = prm.variant !== "B";
  const renderer = new WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(size.dpr);
  renderer.setSize(size.w, size.h, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = physical ? NeutralToneMapping : NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = physical;
  renderer.shadowMap.type = prm.shadow === "vsm" ? VSMShadowMap : PCFShadowMap;
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new Scene();
  scene.background = new Color(colour.table);
  const camera = new PerspectiveCamera(38, size.w / size.h, 1, 120);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ---- textures ----
  const tableCanvas = canvas(TABLE_PX, TABLE_PX);
  paintTable(tableCanvas, env.surfaces);
  const tableTex = keep(new CanvasTexture(tableCanvas));
  tableTex.colorSpace = SRGBColorSpace;
  tableTex.anisotropy = aniso;
  const faces = new Map<string, CanvasTexture>();
  const faceTex = (spec: FaceSpec): CanvasTexture => {
    const k = faceKey(spec);
    let t = faces.get(k);
    if (!t) {
      const c = canvas(FACE_W, FACE_H);
      if (spec.down) paintBack(c, env);
      else paintFace(c, spec, env);
      t = keep(new CanvasTexture(c));
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = aniso;
      faces.set(k, t);
    }
    return t;
  };
  const backTex = faceTex(faceSpec({ name: "", down: true }));
  const discs = new Map<string, CanvasTexture>();
  const disc = (n: number): CanvasTexture => {
    const k = `${n}`;
    let t = discs.get(k);
    if (!t) {
      t = keep(numberDisc(n, physical ? "bronze" : "badge", env.surfaces.bronze));
      discs.set(k, t);
    }
    return t;
  };

  // ---- geometry ----
  const faceGeo = keep(faceGeometry());
  const cardSlab = keep(slab(THICK));
  cardSlab.translate(0, 0, -THICK / 2);
  const slabs = new Map<number, BufferGeometry>();
  const slabOf = (n: number): BufferGeometry => {
    let g = slabs.get(n);
    if (!g) {
      g = keep(slab(n * THICK));
      slabs.set(n, g);
    }
    return g;
  };
  const MARGIN = 0.5;
  const decalGeo = keep(new PlaneGeometry(CW + 2 * MARGIN, CH + 2 * MARGIN));
  decalGeo.rotateX(-Math.PI / 2);
  // Contact shade: dark under the card, falling off over a few millimetres to nothing by the plane's edge.
  const decalTex = keep(softRect(CW + 2 * MARGIN, CH + 2 * MARGIN, (d) => Math.exp(-Math.pow(d / 0.17, 1.6))));
  // A halo: a thin glow off the card's edge (it is behind the card, so only the outside shows).
  const HALO = 0.45;
  const haloGeo = keep(new PlaneGeometry(CW + 2 * HALO, CH + 2 * HALO));
  const haloTex = keep(softRect(CW + 2 * HALO, CH + 2 * HALO, (d) => 0.85 * Math.exp(-d / 0.09)));
  const chipR = 0.21,
    chipH = 0.065;
  const chipGeo = keep(new CylinderGeometry(chipR, chipR, chipH, 32));
  const chipTop = keep(new CircleGeometry(chipR, 32));
  chipTop.rotateX(-Math.PI / 2);

  // ---- materials ----
  const flatUniforms: Uniform<number>[] = [];
  const shared = new Map<string, Material>();
  /** A face's material: lit card stock (A, D), matte and partly self-lit (C), or flat and unlit (B). */
  const faceMaterial = (tex: Texture, own: boolean): Material => {
    const k = tex.uuid;
    const hit = own ? undefined : shared.get(k);
    if (hit) return hit;
    let m: Material;
    if (prm.variant === "B") {
      const b = new MeshBasicMaterial({ map: tex, alphaTest: 0.5 });
      b.toneMapped = false;
      m = b;
    } else if (prm.variant === "C") {
      m = new MeshLambertMaterial({
        map: tex,
        alphaTest: 0.5,
        emissive: new Color(0.42, 0.42, 0.42),
        emissiveMap: tex,
      });
    } else {
      const s = new MeshStandardMaterial({
        map: tex,
        alphaTest: 0.5,
        roughness: 0.48,
        metalness: 0,
        envMapIntensity: 0.55,
      });
      if (own) {
        const u = { value: 0 };
        flatUniforms.push(u);
        steppingFace(s, u);
        (s.userData as { flat?: Uniform<number> }).flat = u;
      }
      m = s;
    }
    keep(m);
    if (!own) shared.set(k, m);
    return m;
  };
  // Paper: cream card stock at the cut edge, a little darker where a pile's edges are.
  const edgeMat = keep(new MeshStandardMaterial({ color: 0xd9c9a6, roughness: 0.85 }));
  const pileMat = keep(new MeshStandardMaterial({ color: 0xcdbb95, roughness: 0.9 }));
  paperEdge(pileMat);
  const hidden = keep(new MeshBasicMaterial({ visible: false }));
  const bronzeTex = env.surfaces.bronze ? keep(new Texture(env.surfaces.bronze as HTMLImageElement)) : null;
  if (bronzeTex) {
    bronzeTex.colorSpace = SRGBColorSpace;
    bronzeTex.wrapS = bronzeTex.wrapT = RepeatWrapping;
    bronzeTex.needsUpdate = true;
  }
  const bronzeMat = keep(
    prm.variant === "C"
      ? new MeshStandardMaterial({
          color: 0x9a7a48,
          metalness: 0.35,
          roughness: 0.75,
          ...(bronzeTex ? { map: bronzeTex } : {}),
        })
      : new MeshStandardMaterial({
          color: 0xb08a52,
          metalness: 0.85,
          roughness: 0.42,
          ...(bronzeTex ? { map: bronzeTex } : {}),
        }),
  );
  const contactMat = keep(
    new MeshBasicMaterial({ color: 0x140a03, alphaMap: decalTex, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  contactMat.toneMapped = false;
  const dropMat = keep(
    new MeshBasicMaterial({ color: 0x1c0f05, alphaMap: decalTex, transparent: true, opacity: 0.42, depthWrite: false }),
  );
  dropMat.toneMapped = false;
  const outlineMat = keep(new MeshBasicMaterial({ color: 0x1e130a }));
  outlineMat.toneMapped = false;
  const underMat = keep(new MeshBasicMaterial({ color: 0xd6c39c }));
  underMat.toneMapped = false;

  // ---- the table ----
  const tableGeo = keep(new PlaneGeometry(TABLE_PLANE.w, TABLE_PLANE.d));
  let tableMat: Material;
  if (physical) {
    const t = new MeshStandardMaterial({ map: tableTex, roughness: 0.92 });
    if (env.tomeNormal) {
      const n = keep(new Texture(env.tomeNormal as HTMLImageElement));
      n.wrapS = n.wrapT = RepeatWrapping;
      n.repeat.set(6, 5);
      n.colorSpace = NoColorSpace;
      n.needsUpdate = true;
      t.normalMap = n;
      t.normalScale = new Vector2(0.6, 0.6);
    }
    tableMat = t;
  } else {
    const b = new MeshBasicMaterial({ map: tableTex });
    b.toneMapped = false;
    tableMat = b;
  }
  keep(tableMat);
  tableMat.depthWrite = false;
  const table = new Mesh(tableGeo, tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.z = TABLE_PLANE.z;
  table.receiveShadow = true;
  table.renderOrder = -4;
  scene.add(table);

  // ---- light ----
  if (physical) {
    // One warm lamp over the table, a little to the left and toward the viewer, so standing cards face it and cast their
    // shade back across the vellum; it falls off by distance and by its cone toward the far corners.
    const lamp = new SpotLight(0xffcf98, LAMP.intensity, 0, LAMP.angle, LAMP.penumbra, 2);
    lamp.position.set(LAMP.at.x, LAMP.at.y, LAMP.at.z);
    lamp.target.position.set(LAMP.aim.x, LAMP.aim.y, LAMP.aim.z);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(prm.shadowSize, prm.shadowSize);
    lamp.shadow.camera.near = 12;
    lamp.shadow.camera.far = 50;
    lamp.shadow.bias = -0.00012;
    lamp.shadow.normalBias = 0.004;
    lamp.shadow.radius = prm.shadowRadius;
    if (prm.shadow === "vsm") lamp.shadow.blurSamples = 12;
    scene.add(lamp, lamp.target);
    // The room: a warm hemisphere fill and a faint reflection for the card stock's sheen and the bronze.
    const hemi = new HemisphereLight(0xffe4c0, 0x2a1a0e, prm.variant === "C" ? LAMP.fill * 1.2 : LAMP.fill);
    scene.add(hemi);
    const pmrem = new PMREMGenerator(renderer);
    const room = pmrem.fromScene(new RoomEnvironment(), 0.04);
    keep(room.texture);
    pmrem.dispose();
    scene.environment = room.texture;
    scene.environmentIntensity = prm.variant === "C" ? 0.12 : 0.3;
    for (const l of [lamp, hemi]) l.layers.enable(ABOVE);
  }

  // ---- pieces ----
  const basis = (p: Pick<Piece, "right" | "up">): Matrix4 => {
    const r = vec(p.right),
      u = vec(p.up),
      n = new Vector3().crossVectors(r, u).normalize();
    return new Matrix4().makeBasis(r, u, n);
  };

  /** One physical card: lit face, its back, and the cut edge between, centred, face on +Z. */
  const physicalCard = (tex: Texture, own: boolean): Group => {
    const g = new Group();
    const edge = new Mesh(cardSlab, [hidden, edgeMat]);
    edge.castShadow = true;
    edge.receiveShadow = true;
    const front = new Mesh(faceGeo, faceMaterial(tex, own));
    front.position.z = THICK / 2 + 0.0002;
    front.castShadow = true;
    front.receiveShadow = true;
    const back = new Mesh(faceGeo, faceMaterial(backTex, false));
    back.position.z = -THICK / 2 - 0.0002;
    back.rotation.y = Math.PI;
    back.castShadow = true;
    back.receiveShadow = true;
    g.add(edge, front, back);
    return g;
  };

  /** One illustrated tile: its face over a hairline of ink. */
  const flatCard = (tex: Texture): Group => {
    const g = new Group();
    const ink = new Mesh(faceGeo, outlineMat);
    ink.scale.set(1 + 0.035 / CW, 1 + 0.035 / CH, 1);
    ink.position.z = -0.002;
    const front = new Mesh(faceGeo, faceMaterial(tex, false));
    g.add(ink, front);
    return g;
  };

  const decalMats = new Map<string, MeshBasicMaterial>();
  const decalMat = (mat: MeshBasicMaterial, opacity: number): MeshBasicMaterial => {
    const k = `${mat.uuid}:${opacity.toFixed(2)}`;
    let m = decalMats.get(k);
    if (!m) {
      m = keep(Object.assign(mat.clone(), { opacity: Number(opacity.toFixed(2)) }));
      decalMats.set(k, m);
    }
    return m;
  };
  const contact = (
    at: Vector3,
    m: Matrix4,
    w: number,
    d: number,
    opacity: number,
    mat: MeshBasicMaterial = contactMat,
  ): Mesh => {
    const mesh = new Mesh(decalGeo, decalMat(mat, opacity));
    mesh.position.copy(at);
    mesh.position.y = 0.0015;
    mesh.quaternion.setFromRotationMatrix(m);
    // The decal lies in the frame's plane: its own x along `right`, z along -up projected (lying), so scale to size.
    mesh.scale.set(w / (CW + 2 * MARGIN), 1, d / (CH + 2 * MARGIN));
    mesh.renderOrder = -3;
    scene.add(mesh);
    return mesh;
  };

  const flatBasis = (p: Piece): Matrix4 => {
    // A lying frame on the table: x along the piece's right, z along its down (toward the viewer), y up.
    const r = vec(p.right);
    r.y = 0;
    r.normalize();
    return new Matrix4().makeBasis(
      r,
      new Vector3(0, 1, 0),
      new Vector3().crossVectors(r, new Vector3(0, 1, 0)).normalize(),
    );
  };

  /** Each piece's top card, and its pose at rest, for a moment to lift. */
  const tops = new Map<Piece, { obj: Object3D; rest: Vector3 }>();
  const chip = (at: Vector3, n: number): void => {
    if (physical) {
      const body = new Mesh(chipGeo, bronzeMat);
      body.position.copy(at).setY(chipH / 2);
      body.castShadow = true;
      body.receiveShadow = true;
      const top = new Mesh(
        chipTop,
        keep(new MeshStandardMaterial({ map: disc(n), metalness: prm.variant === "C" ? 0.3 : 0.8, roughness: 0.45 })),
      );
      top.position.copy(at).setY(chipH + 0.0005);
      top.receiveShadow = true;
      scene.add(body, top);
      contact(at, new Matrix4(), chipR * 2 + 0.15, chipR * 2 + 0.15, 0.5);
    } else {
      const m = keep(new MeshBasicMaterial({ map: disc(n), transparent: true }));
      m.toneMapped = false;
      const top = new Mesh(chipTop, m);
      top.position.copy(at).setY(0.02);
      scene.add(top);
      const shade = new Mesh(chipTop, dropMat);
      shade.position.copy(at).add(new Vector3(0.03, 0.005, 0.05));
      shade.scale.setScalar(1.25);
      scene.add(shade);
    }
  };

  const ownFaces = prm.variant === "D";
  const rand = seeded(7);
  for (const p of board.pieces) {
    const tex = faceTex(p.face);
    const m = basis(p);
    if (p.posture === "stand") {
      const card = physical ? physicalCard(tex, ownFaces) : flatCard(tex);
      card.position.copy(vec(p.centre));
      card.quaternion.setFromRotationMatrix(m);
      scene.add(card);
      tops.set(p, { obj: card, rest: card.position.clone() });
      const r = vec(p.right),
        u = vec(p.up);
      // How wide the card is along the table (its foot): its width, or its height when it is turned a quarter.
      const acrossW = Math.abs(u.y) < 0.5 ? CH : CW;
      const along = Math.abs(u.y) < 0.5 ? u.clone() : r.clone();
      along.y = 0;
      along.normalize();
      const base = vec(p.base);
      const fm = new Matrix4().makeBasis(
        along,
        new Vector3(0, 1, 0),
        new Vector3().crossVectors(along, new Vector3(0, 1, 0)).normalize(),
      );
      // Away from the viewer along the table (up x along: the frame's own away).
      const away = new Vector3().crossVectors(new Vector3(0, 1, 0), along).normalize();
      if (physical) {
        // A bronze stand holds it: a low rail along its foot.
        const rail = new Mesh(
          keep(
            new ExtrudeGeometry(roundRect(acrossW + 0.1, 0.16, 0.05), {
              depth: 0.045,
              bevelEnabled: false,
              curveSegments: 4,
            }),
          ),
          bronzeMat,
        );
        // The rail's outline lies along the foot (x) and across it (y); its height is its extrusion (z, up).
        rail.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(along, away, new Vector3(0, 1, 0)));
        rail.position.copy(base).setY(0);
        rail.castShadow = true;
        rail.receiveShadow = true;
        scene.add(rail);
        contact(base.clone().addScaledVector(away, 0.05), fm, acrossW + 0.25, 0.5, 0.75);
      } else {
        // Its soft shade: a little under its foot and a long soft fall behind it.
        contact(base.clone().addScaledVector(away, 0.12), fm, acrossW + 0.1, 0.35, 0.5, dropMat);
        contact(base.clone().addScaledVector(away, 0.55), fm, acrossW + 0.2, 1.3, 0.22, dropMat);
      }
      if (p.plus > 0)
        chip(
          base
            .clone()
            .addScaledVector(along, acrossW / 2 - 0.12)
            .addScaledVector(away, -0.38),
          p.plus,
        );
      continue;
    }
    // Lying: a single card, or a pile.
    const base = vec(p.base);
    const up = new Vector3(0, 1, 0);
    const fm = flatBasis(p);
    if (physical) {
      const shown = Math.min(p.count, p.name === "" ? 1 : 3);
      const under = p.count - shown;
      if (under > 0) {
        const block = new Mesh(slabOf(under), [pileMat, pileMat]);
        block.position.copy(base);
        block.quaternion.setFromRotationMatrix(m);
        block.castShadow = true;
        block.receiveShadow = true;
        scene.add(block);
      }
      for (let i = 0; i < shown; i++) {
        const top = i === shown - 1;
        // The top few cards of a pile lie a little askew, as cards do.
        const jit = p.count > 1 && p.name !== "" ? 1 : 0;
        const card = physicalCard(top ? tex : faceTex(p.face), top && ownFaces);
        card.position.copy(base).addScaledVector(up, (under + i + 0.5) * THICK);
        card.position.x += (rand() - 0.5) * 0.03 * jit;
        card.position.z += (rand() - 0.5) * 0.03 * jit;
        card.quaternion.setFromRotationMatrix(m);
        card.rotateZ((rand() - 0.5) * 0.035 * jit);
        scene.add(card);
        if (top) tops.set(p, { obj: card, rest: card.position.clone() });
      }
      const height = p.count * THICK;
      contact(base, fm, CW + 0.16 + height * 2, CH + 0.16 + height * 2, Math.min(0.8, 0.5 + height * 1.5));
    } else {
      // Illustrated: the top tile, and up to three offset edges under it for a pile.
      const unders = p.count > 1 ? Math.min(3, p.count - 1) : 0;
      const toward = new Vector3(0.018, 0, 0.04);
      for (let i = unders; i >= 1; i--) {
        const g = new Group();
        const ink = new Mesh(faceGeo, outlineMat);
        ink.scale.set(1 + 0.035 / CW, 1 + 0.035 / CH, 1);
        const paper = new Mesh(faceGeo, underMat);
        paper.position.z = 0.002;
        g.add(ink, paper);
        g.position
          .copy(base)
          .addScaledVector(toward, i)
          .setY(0.004 + (unders - i) * 0.004);
        g.quaternion.setFromRotationMatrix(m);
        scene.add(g);
      }
      const card = flatCard(tex);
      // A shingled single lies over the one before it (its base is a card's thickness higher): keep that order.
      card.position.copy(base).setY(0.004 + unders * 0.004 + 0.004 + (base.y / THICK) * 0.004);
      card.quaternion.setFromRotationMatrix(m);
      scene.add(card);
      tops.set(p, { obj: card, rest: card.position.clone() });
      contact(
        base
          .clone()
          .add(new Vector3(0.05, 0, 0.12))
          .addScaledVector(toward, unders),
        fm,
        CW + 0.25,
        CH + 0.25,
        0.4,
        dropMat,
      );
    }
    if (p.counted) {
      const r = vec(p.right),
        d = vec(p.up).negate();
      // The count on the vellum by the pile's near right corner, where no card covers it.
      chip(
        base
          .clone()
          .addScaledVector(r, CW / 2 + 0.2)
          .addScaledVector(d, CH / 2 - 0.25),
        p.count,
      );
    }
  }

  // ---- the moment (D) ----
  const halos: Mesh[] = [];
  let spellObj: Object3D | null = null;
  let arc: Mesh | null = null;
  const spec = prm.moment === "rest" ? null : MOMENTS[prm.moment];
  const lifted: { obj: Object3D; rest: Vector3; flat: Uniform<number> | null }[] = [];
  if (spec && prm.variant === "D") {
    const above = (o: Object3D): void => o.traverse((c) => c.layers.enable(ABOVE));
    const haloOf = (obj: Object3D, col: string, danger: boolean): void => {
      const m = keep(
        new MeshBasicMaterial({
          color: new Color(col),
          alphaMap: haloTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: DoubleSide,
          ...(danger ? {} : { blending: AdditiveBlending }),
        }),
      );
      m.toneMapped = false;
      const h = new Mesh(haloGeo, m);
      h.position.z = -0.03;
      h.layers.set(ABOVE);
      h.renderOrder = -1;
      obj.add(h);
      halos.push(h);
    };
    for (const p of board.pieces) {
      if (!spec.pick(p)) continue;
      const t = tops.get(p);
      if (!t) continue;
      above(t.obj);
      const front = t.obj.children[1] as Mesh | undefined;
      const fl =
        ((front?.material as MeshStandardMaterial | undefined)?.userData as { flat?: Uniform<number> } | undefined)
          ?.flat ?? null;
      lifted.push({ obj: t.obj, rest: t.rest, flat: fl });
      const col = spec.colour(p);
      haloOf(t.obj, col, col === signal.dangerRim);
    }
    if (prm.moment === "spell") {
      // The spell, held up between me and the table, facing me; its aim drawn to its target.
      const swords = physicalCard(faceTex(faceOf({ name: "Swords to Plowshares" }, false)), true);
      swords.scale.setScalar(1.3);
      scene.add(swords);
      above(swords);
      const front = swords.children[1] as Mesh | undefined;
      const fl =
        ((front?.material as MeshStandardMaterial | undefined)?.userData as { flat?: Uniform<number> } | undefined)
          ?.flat ?? null;
      haloOf(swords, signal.selected, false);
      spellObj = swords;
      lifted.push({ obj: swords, rest: new Vector3(-3.0, 6.2, 2.6), flat: fl });
    }
  }

  // ---- the scrim ----
  const scrimCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scrimMat = keep(
    new MeshBasicMaterial({
      color: new Color(colour.stackScrim),
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    }),
  );
  scrimMat.toneMapped = false;
  const scrimScene = new Scene();
  scrimScene.add(new Mesh(keep(new PlaneGeometry(2, 2)), scrimMat));

  /** Pose the moment at t (0 rest, 1 in): lift, unlight, halo, dim. */
  const pose = (t: number): void => {
    const e = 1 - Math.pow(1 - t, 3);
    const eye = camera.position;
    for (const l of lifted) {
      const toEye = eye.clone().sub(l.rest).normalize();
      l.obj.position
        .copy(l.rest)
        .addScaledVector(new Vector3(0, 1, 0), prm.lift * e)
        .addScaledVector(toEye, prm.lift * 0.6 * e);
      if (l.flat) l.flat.value = prm.flat * e;
    }
    for (const h of halos) (h.material as MeshBasicMaterial).opacity = Math.min(1, prm.halo) * e * 0.9;
    if (spellObj) {
      spellObj.lookAt(eye);
      if (!arc) {
        const meloku = lifted[0]?.obj;
        if (meloku) {
          const from = spellObj.position.clone().add(new Vector3(0.3, -CH * 0.55, 0));
          const to = meloku.position.clone().add(new Vector3(0, CH * 0.45, 0));
          const mid = from
            .clone()
            .lerp(to, 0.5)
            .add(new Vector3(0, 1.4, 0));
          const tube = keep(new TubeGeometry(new QuadraticBezierCurve3(from, mid, to), 48, 0.03, 6, false));
          const am = keep(new MeshBasicMaterial({ color: new Color(signal.dangerRim), transparent: true, opacity: 0 }));
          am.toneMapped = false;
          arc = new Mesh(tube, am);
          arc.layers.set(ABOVE);
          scene.add(arc);
        }
      }
      if (arc) (arc.material as MeshBasicMaterial).opacity = e;
    }
    scrimMat.opacity = linearAlpha((prm.dim ?? spec?.dim ?? 0) * e);
  };

  let shadowsDrawn = false;
  const focus = prm.variant === "D" && spec !== null && prm.t > 0;
  const draw = (): void => {
    if (prm.variant === "D") pose(spec ? prm.t : 0);
    // Count every pass of the frame (the focus draws three).
    renderer.info.reset();
    renderer.shadowMap.autoUpdate = prm.liveShadows || !shadowsDrawn;
    camera.layers.set(0);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    shadowsDrawn = true;
    if (focus) {
      renderer.autoClear = false;
      renderer.render(scrimScene, scrimCam);
      renderer.clearDepth();
      const auto = renderer.shadowMap.autoUpdate,
        bg = scene.background;
      renderer.shadowMap.autoUpdate = false;
      scene.background = null;
      camera.layers.set(ABOVE);
      renderer.render(scene, camera);
      camera.layers.set(0);
      scene.background = bg;
      renderer.shadowMap.autoUpdate = auto;
      renderer.autoClear = true;
    }
  };

  const look: Study["look"] = (view) => {
    if (!view) {
      applyCamera(camera, cameraParams(tableTemplate(4).camera, { w: size.w, h: size.h }));
      return;
    }
    camera.fov = view.fov;
    camera.aspect = size.w / size.h;
    camera.near = 0.05;
    camera.far = 120;
    camera.position.set(view.eye.x, view.eye.y, view.eye.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(view.at.x, view.at.y, view.at.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  };
  look(null);
  const gl = renderer.getContext(),
    px = new Uint8Array(4);

  return {
    renderer,
    look,
    draw,
    drawSync: () => {
      draw();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    },
    stats: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries,
      lifted: lifted.length,
      shadowMap: physical ? `${prm.shadow} ${prm.shadowSize} r${prm.shadowRadius}` : "none",
    }),
    dispose: () => {
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}
