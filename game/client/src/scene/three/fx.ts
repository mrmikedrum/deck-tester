// The table's magic (old fx.js, ported): a cast spell crackles with its colours, an aim is a live arc of that energy, a
// card in danger has a sigil branded into the page at its foot, a card you can act on has embers stirring under it, a
// card you chose has a pool of gilt under it, a land is a well of its mana's light, a creature stands in the ash it was
// cast into, and a spell ignites as it is cast. Particles are textured points moved by turbulence in the shader, drawn
// brighter than white so the bloom turns them into light. Everything is seeded (by the card it belongs to) and timed by
// the frame's `now`, so the same frame draws the same particles. Reduced motion drops the particles and the jitter and
// holds every breath still. Each effect rides the object it belongs to and is disposed with it.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import type { Material, Object3D, Texture } from "three";
import { fx as palette, mana, manaDark, seeded, signal } from "../../theme";
import type { FxSprite } from "../../theme";
import type { Lease } from "./textures";

/** Signal brightness over white: what blooms. */
const HDR = palette.hdr;

/** Tuned numbers of each effect, named (old fx.js inline literals). */
const FX = {
  spell: { crackle: 80, motes: 24, smoke: 36 },
  ember: { n: 70, size: 5, rise: 0.5, spread: 0.04, speed: 0.45, turb: 0.06 },
  ash: { r: 1.7, tilt: 0.4 },
  sigil: { w: 0.62, at: 0.42, beat: 2.4, base: 0.55, swing: 0.45 },
  well: { wash: 0.72, heart: 0.8, breath: 0.08, rate: 0.9, stain: 0.6 },
  chosen: { w: 1.0, d: 0.42, at: 0.2, opacity: 0.7 },
  burst: { ms: 600, n: 140, size: 14, spread: 0.9 },
  /** A plaque struck as its life drops (h.js `buildBoard`): blood and bone, longer, denser and wider than a cast's. */
  strike: { ms: 700, n: 160, size: 14, spread: 1.4 },
  /** An arc is rebuilt (its jitter moves) this often, seconds. */
  arcStep: 0.06,
} as const;

/** Mana letters (or colours as they are) to light colours; colourless where none. */
const manaColours = (cols: readonly string[]): string[] =>
  (cols.length ? cols : ["C"]).map((k) => (k.startsWith("#") ? k : (mana[k as keyof typeof mana] ?? mana.C)));
const darkColours = (cols: readonly string[]): string[] => (cols.length ? cols : ["C"]).map((k) => manaDark[k as keyof typeof manaDark] ?? manaDark.C);

/** Where effects get their sprites, the pixel ratio and the time. */
interface FxEnv {
  sprite(kind: FxSprite): Lease;
  readonly pixelRatio: number;
}

/** One effect: built once, ticked every frame with the time (s) and how strong it may be (a dimmed seat's are quieter). */
export interface Effect {
  readonly object: Object3D;
  tick(t: number, level: number, still: boolean): void;
  dispose(): void;
}

/** Owns what effects share: sprite leases, held for as long as the scene is up. */
export class FxKit implements FxEnv {
  private leases = new Map<FxSprite, Lease>();
  constructor(
    private readonly lease: (kind: FxSprite) => Lease,
    private readonly ratio: () => number,
  ) {}
  get pixelRatio(): number {
    return this.ratio();
  }
  sprite(kind: FxSprite): Lease {
    let l = this.leases.get(kind);
    if (!l) {
      l = this.lease(kind);
      this.leases.set(kind, l);
    }
    return l;
  }
  map(kind: FxSprite): Texture {
    return this.sprite(kind).texture;
  }
  dispose(): void {
    for (const l of this.leases.values()) l.release();
    this.leases.clear();
  }
}

// ---- the particle emitter ---------------------------------------------------------------------------------------------

const VERT = `
  uniform float uTime; uniform float uSize; uniform float uRise; uniform float uSpread; uniform float uSpeed; uniform float uTurb;
  attribute vec4 aSeed; attribute vec3 aColor; attribute vec3 aStart; attribute vec3 aDir;
  varying vec3 vColor; varying float vLife; varying float vAng;
  vec3 curl(vec3 p) {
    return vec3(sin(p.y * 7.1 + uTime * 2.3) + sin(p.z * 5.3 - uTime * 1.7), sin(p.z * 6.7 + uTime * 1.9) + sin(p.x * 4.9 + uTime * 2.9), sin(p.x * 5.9 - uTime * 2.1) + sin(p.y * 6.1 + uTime * 1.3));
  }
  void main() {
    float life = fract(uTime * uSpeed * (0.6 + aSeed.x * 0.8) + aSeed.y);
    vLife = life;
    vec3 p = aStart + aDir * life * uSpread * 2.0;
    p += curl(aStart * 3.0 + aSeed.xyz * 9.0) * uTurb * life;
    p.y += life * uRise;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float fade = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.5, 1.0, life));
    gl_PointSize = uSize * (0.4 + aSeed.z * 0.9) * fade * (22.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
    vColor = aColor; vAng = aSeed.w * 6.2831 + uTime * (aSeed.x - 0.5) * 4.0;
  }`;
const FRAG = `
  uniform sampler2D uSprite; uniform float uHdr;
  varying vec3 vColor; varying float vLife; varying float vAng;
  void main() {
    vec2 d = gl_PointCoord - 0.5; float c = cos(vAng), s = sin(vAng);
    vec2 uv = vec2(c * d.x - s * d.y, s * d.x + c * d.y) + 0.5;
    vec4 t = texture2D(uSprite, uv);
    float a = t.a * (1.0 - vLife * 0.5);
    vec3 col = mix(vColor, vec3(1.0), t.r * 0.6) * uHdr;
    gl_FragColor = vec4(col * a, a);
  }`;

interface EmitterSpec {
  readonly n: number;
  readonly colours: readonly string[];
  readonly start: (i: number) => Vector3;
  readonly dir: (i: number, s: Vector3) => Vector3;
  readonly size?: number;
  readonly rise?: number;
  readonly spread?: number;
  readonly speed?: number;
  readonly turb?: number;
  readonly sprite?: FxSprite;
  readonly hdr?: number;
  readonly blending?: "add" | "normal";
}

interface Emitter {
  readonly points: Points;
  readonly material: ShaderMaterial;
  readonly hdr: number;
  dispose(): void;
}

function emitter(kit: FxKit, rand: () => number, o: EmitterSpec): Emitter {
  const n = Math.max(1, o.n),
    g = new BufferGeometry();
  const seed = new Float32Array(n * 4),
    col = new Float32Array(n * 3),
    st = new Float32Array(n * 3),
    dr = new Float32Array(n * 3);
  const cs = o.colours.map((c) => new Color(c));
  for (let i = 0; i < n; i++) {
    seed.set([rand(), rand(), rand(), rand()], i * 4);
    const c = cs[Math.floor(rand() * cs.length)] ?? new Color(1, 1, 1);
    col.set([c.r, c.g, c.b], i * 3);
    const s = o.start(i),
      d = o.dir(i, s);
    st.set([s.x, s.y, s.z], i * 3);
    dr.set([d.x, d.y, d.z], i * 3);
  }
  g.setAttribute("position", new BufferAttribute(st.slice(), 3));
  g.setAttribute("aSeed", new BufferAttribute(seed, 4));
  g.setAttribute("aColor", new BufferAttribute(col, 3));
  g.setAttribute("aStart", new BufferAttribute(st, 3));
  g.setAttribute("aDir", new BufferAttribute(dr, 3));
  const hdr = o.hdr ?? HDR;
  const m = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: (o.size ?? 10) * kit.pixelRatio },
      uRise: { value: o.rise ?? 0.5 },
      uSpread: { value: o.spread ?? 0.12 },
      uSpeed: { value: o.speed ?? 0.9 },
      uTurb: { value: o.turb ?? 0.08 },
      uSprite: { value: kit.map(o.sprite ?? "ember") },
      uHdr: { value: hdr },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: (o.blending ?? "add") === "add" ? AdditiveBlending : NormalBlending,
  });
  const p = new Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 20;
  return {
    points: p,
    material: m,
    hdr,
    dispose: () => {
      g.dispose();
      m.dispose();
    },
  };
}

/** A plane lying on the page (its +y up), textured with a sprite. */
function flatPlane(map: Texture, w: number, d: number, mat: Partial<ConstructorParameters<typeof MeshBasicMaterial>[0]> = {}): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const m = new Mesh(new PlaneGeometry(w, d), new MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, ...mat }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 0;
  return m;
}

const disposeMesh = (m: Mesh): void => {
  m.geometry.dispose();
  (m.material as Material).dispose();
};

// ---- a cast spell: its mana crackles off the card's rim ----------------------------------------------------------------

/** On a card mesh (1 tall, `cw` wide, facing +z): crackle running along its rim, a few motes, and its dark heart behind. */
export function spellFx(kit: FxKit, colours: readonly string[], seed: number, strength = 1, cw = 0.716): Effect {
  const rand = seeded(seed * 2654435761 + 1013904223);
  const cols = manaColours(colours);
  const group = new Group();
  const rim = (): Vector3 => {
    const side = rand(),
      t = rand() * 2 - 1;
    return side < 0.3
      ? new Vector3((t * cw) / 2, 0.5, -0.03)
      : side < 0.5
        ? new Vector3((t * cw) / 2, -0.5, -0.03)
        : side < 0.75
          ? new Vector3(-cw / 2, t / 2, -0.03)
          : new Vector3(cw / 2, t / 2, -0.03);
  };
  const out = (_: number, s: Vector3): Vector3 =>
    new Vector3(
      Math.abs(s.x) > cw / 2 - 0.01 ? Math.sign(s.x) * (0.5 + rand() * 0.5) : (rand() - 0.5) * 0.3,
      Math.abs(s.y) > 0.49 ? Math.sign(s.y) * (0.5 + rand() * 0.5) : (rand() - 0.5) * 0.3,
      -0.6 - rand() * 0.4,
    ).normalize();
  const crackle = emitter(kit, rand, { n: Math.round(FX.spell.crackle * strength), colours: cols, size: 8, rise: 0.04, spread: 0.06, speed: 1.4, turb: 0.035, sprite: "streak", hdr: HDR * 0.8, start: rim, dir: out });
  const motes = emitter(kit, rand, { n: Math.round(FX.spell.motes * strength), colours: cols, size: 4, rise: 0.3, spread: 0.04, speed: 0.35, turb: 0.05, sprite: "ember", hdr: HDR * 0.7, start: rim, dir: out });
  const smoke = emitter(kit, rand, {
    n: FX.spell.smoke,
    colours: darkColours(colours),
    size: 26,
    rise: 0.25,
    spread: 0.05,
    speed: 0.22,
    turb: 0.08,
    sprite: "ember",
    hdr: 0.8,
    blending: "normal",
    start: () => {
      const s = rim().multiplyScalar(0.92);
      s.z = -0.22;
      return s;
    },
    dir: out,
  });
  smoke.points.renderOrder = 19;
  const all = [smoke, motes, crackle];
  for (const e of all) group.add(e.points);
  return {
    object: group,
    tick: (t, level, still) => {
      group.visible = !still && level > 0.02;
      for (const e of all) {
        e.material.uniforms["uTime"]!.value = t;
        e.material.uniforms["uHdr"]!.value = e.hdr * level;
      }
    },
    dispose: () => all.forEach((e) => e.dispose()),
  };
}

// ---- embers under a card you can act on -------------------------------------------------------------------------------

/** Coals and a few sparks lying under a card (in its lying frame, +y up off the page), the signal's warm ember. */
export function emberFx(kit: FxKit, seed: number, w = 0.9, d = 0.5, y = 0.012): Effect {
  const rand = seeded(seed * 2654435761 + 7);
  const e = FX.ember;
  const em = emitter(kit, rand, {
    n: e.n,
    colours: palette.embers,
    size: e.size,
    rise: e.rise,
    spread: e.spread,
    speed: e.speed,
    turb: e.turb,
    start: () => new Vector3((rand() - 0.5) * w, y, (rand() - 0.5) * d + 0.1),
    dir: () => new Vector3(0, 1, 0),
  });
  return {
    object: em.points,
    tick: (t, level, still) => {
      em.points.visible = !still && level > 0.02;
      em.material.uniforms["uTime"]!.value = t;
      em.material.uniforms["uHdr"]!.value = em.hdr * level;
    },
    dispose: () => em.dispose(),
  };
}

// ---- ash where a creature was cast ----------------------------------------------------------------------------------

/** The vellum singed round a standee's foot, turned and mirrored its own way (seeded), drawn as page, never as light. */
export function ashFx(kit: FxKit, seed: number, r: number = FX.ash.r): Effect {
  const rand = seeded(seed * 2654435761 + 11);
  const m = flatPlane(kit.map("ash"), r, r * 0.6);
  m.rotation.z = (rand() - 0.5) * FX.ash.tilt;
  m.position.set(0, 0.005, 0.04);
  m.scale.set(rand() < 0.5 ? -1 : 1, rand() < 0.5 ? -1 : 1, 1);
  const mat = m.material;
  return {
    object: m,
    tick: (_t, level) => {
      mat.opacity = level;
    },
    dispose: () => disposeMesh(m),
  };
}

// ---- the danger sigil -----------------------------------------------------------------------------------------------

/** A brand at a card's foot (in its standing frame: +y up off the page, +z toward me), the heat in it beating. */
export function sigilFx(kit: FxKit, seed: number, r = 1): Effect {
  const rand = seeded(seed * 2654435761 + 13);
  const s = FX.sigil,
    w = r * s.w;
  const group = new Group();
  const burn = flatPlane(kit.map("brand"), w, w);
  const heat = flatPlane(kit.map("brandHeat"), w, w, { color: new Color(palette.sigil.heat) });
  heat.position.y = 0.001;
  burn.renderOrder = heat.renderOrder = 1;
  group.add(burn, heat);
  group.position.set(0, 0.008, s.at * r);
  group.rotation.y = (rand() - 0.5) * 0.3;
  return {
    object: group,
    tick: (t, level, still) => {
      const beat = still ? 1 : Math.pow(Math.max(0, Math.sin(t * s.beat)), 6);
      burn.material.opacity = level;
      heat.material.opacity = (s.base + s.swing * beat) * level;
    },
    dispose: () => {
      disposeMesh(burn);
      disposeMesh(heat);
    },
  };
}

// ---- a land's well --------------------------------------------------------------------------------------------------

/**
 * The page under a land is a pool of its mana (in the card's lying frame: +z up off the page): a wash of its colour, a
 * lit heart of the second, breathing slowly, a mote now and then. Spent (every land in it tapped), the light goes and a
 * dull stain of its colour gone to brown is left.
 */
export function wellFx(kit: FxKit, colours: readonly string[], seed: number, spent: boolean, w = 0.716, h = 1): Effect {
  const rand = seeded(seed * 2654435761 + 17);
  const cols = manaColours(colours),
    col = new Color(cols[0]),
    col2 = new Color(cols[cols.length - 1]);
  const W = FX.well;
  const group = new Group();
  const plane = (sx: number, sy: number, mat: Partial<ConstructorParameters<typeof MeshBasicMaterial>[0]>, z: number): Mesh<PlaneGeometry, MeshBasicMaterial> => {
    const m = new Mesh(new PlaneGeometry(w * sx, h * sy), new MeshBasicMaterial({ map: kit.map("wellGlow"), transparent: true, depthWrite: false, toneMapped: false, ...mat }));
    m.position.z = z;
    m.renderOrder = 0;
    return m;
  };
  const meshes: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  let motes: Emitter | null = null;
  const phase = rand() * 6.28;
  if (spent) {
    const stain = plane(1.55, 1.45, { color: col.clone().lerp(new Color(palette.wellStain), 0.55).multiplyScalar(0.75), opacity: W.stain }, 0.0015);
    stain.rotation.z = (rand() - 0.5) * 0.06;
    meshes.push(stain);
  } else {
    const wash = plane(1.6, 1.5, { color: col.clone().lerp(new Color(1, 1, 1), 0.1), opacity: W.wash }, 0.0015);
    const heart = plane(1.4, 1.32, { color: col2.clone().multiplyScalar(0.4), opacity: W.heart, blending: AdditiveBlending }, 0.0025);
    wash.rotation.z = (rand() - 0.5) * 0.06;
    heart.rotation.z = (rand() - 0.5) * 0.08;
    meshes.push(wash, heart);
    motes = emitter(kit, rand, {
      n: 3,
      colours: cols,
      size: 3,
      rise: 0,
      spread: 0.12,
      speed: 0.12,
      turb: 0.03,
      sprite: "ember",
      hdr: HDR * 0.3,
      start: () => new Vector3((rand() - 0.5) * w * 0.8, (rand() - 0.5) * h * 0.8, 0.02),
      dir: () => new Vector3((rand() - 0.5) * 0.15, (rand() - 0.5) * 0.15, 1).normalize(),
    });
    group.add(motes.points);
  }
  for (const m of meshes) group.add(m);
  return {
    object: group,
    tick: (t, level, still) => {
      const b = spent || still ? 1 : 1 + W.breath * Math.sin(t * W.rate + phase);
      if (spent) meshes[0]!.material.opacity = W.stain * level;
      else {
        meshes[0]!.material.opacity = W.wash * b * level;
        meshes[1]!.material.opacity = W.heart * b * level;
      }
      if (motes) {
        motes.points.visible = !still;
        motes.material.uniforms["uTime"]!.value = t;
        motes.material.uniforms["uHdr"]!.value = motes.hdr * level;
      }
    },
    dispose: () => {
      meshes.forEach(disposeMesh);
      motes?.dispose();
    },
  };
}

// ---- gold under a card you chose --------------------------------------------------------------------------------------

/** A steady pool of gilt in front of a chosen card's foot: "you did", where embers say "you could". No sparks. */
export function chosenFx(kit: FxKit): Effect {
  const c = FX.chosen;
  const m = flatPlane(kit.map("pool"), c.w, c.d, { color: new Color(palette.pool).multiplyScalar(0.75), opacity: c.opacity, blending: AdditiveBlending });
  m.position.set(0, 0.01, c.at);
  return {
    object: m,
    tick: (_t, level) => {
      m.material.opacity = c.opacity * level;
    },
    dispose: () => disposeMesh(m),
  };
}

// ---- a burst: a spell igniting as it is cast -------------------------------------------------------------------------

/** Streaks thrown out from a card and gone within `ms`; `t0` (s) is when it went off. Reduced motion draws none. */
export function burstFx(
  kit: FxKit,
  colours: readonly string[],
  seed: number,
  t0: number,
  b: { readonly ms: number; readonly n: number; readonly size: number; readonly spread: number } = FX.burst,
): Effect {
  const rand = seeded(seed * 2654435761 + 19);
  const em = emitter(kit, rand, {
    n: b.n,
    colours: manaColours(colours),
    size: b.size,
    rise: 0.2,
    spread: b.spread,
    speed: 1 / (b.ms / 1000),
    turb: 0.2,
    sprite: "streak",
    start: () => new Vector3((rand() - 0.5) * 0.3, (rand() - 0.5) * 0.4, 0),
    dir: () => new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
  });
  return {
    object: em.points,
    tick: (t, level, still) => {
      const k = (t - t0) / (b.ms / 1000);
      em.points.visible = !still && k >= 0 && k < 1;
      em.material.uniforms["uTime"]!.value = Math.max(0, t - t0);
      em.material.uniforms["uHdr"]!.value = HDR * Math.max(0, 1 - k) * level;
    },
    dispose: () => em.dispose(),
  };
}

/** A plaque struck as its life drops: the danger rim's blood and bone thrown off it (h.js `buildBoard`). */
export const strikeFx = (kit: FxKit, seed: number, t0: number): Effect =>
  burstFx(kit, [signal.dangerRim, "#ffd9a0"], seed, t0, FX.strike);

// ---- an arc: a spell's aim, a crackling ribbon of its light -----------------------------------------------------------

/** The direction the ribbons face: toward the camera (its back along the view). */
const FACE = new Vector3(0, 0.756, 0.655);

/** Scratch for building ribbons (builds never overlap). */
const DIR = new Vector3(),
  SIDE = new Vector3();

/**
 * A ribbon facing the camera along the points, raised by `dy`; `aU` runs along it in world units (an attack's pulses),
 * `aV` across. Written into the geometry's own buffers: they are made only when the number of points changes.
 */
function ribbonGeo(pts: readonly Vector3[], w: number, g: BufferGeometry, dy = 0): void {
  const n = pts.length;
  let pos = g.getAttribute("position") as BufferAttribute | undefined;
  let au = g.getAttribute("aU") as BufferAttribute | undefined;
  if (!pos || !au || pos.count !== n * 2) {
    pos = new BufferAttribute(new Float32Array(n * 6), 3);
    au = new BufferAttribute(new Float32Array(n * 2), 1);
    const vs = new Float32Array(n * 2),
      idx: number[] = [];
    for (let i = 0; i < n; i++) {
      vs[i * 2] = 1;
      vs[i * 2 + 1] = -1;
      if (i < n - 1) {
        const j = i * 2;
        idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
      }
    }
    g.setAttribute("position", pos);
    g.setAttribute("aU", au);
    g.setAttribute("aV", new BufferAttribute(vs, 1));
    g.setIndex(idx);
  }
  const P = pos.array as Float32Array,
    U = au.array as Float32Array;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!,
      q = pts[Math.min(n - 1, i + 1)]!,
      r = pts[Math.max(0, i - 1)]!;
    if (i) run += p.distanceTo(pts[i - 1]!);
    U[i * 2] = U[i * 2 + 1] = run;
    DIR.copy(q).sub(r).normalize();
    SIDE.crossVectors(DIR, FACE).normalize().multiplyScalar(w * (0.3 + 0.7 * Math.sin((i / (n - 1)) * Math.PI)));
    const o = i * 6;
    P[o] = p.x + SIDE.x;
    P[o + 1] = p.y + dy + SIDE.y;
    P[o + 2] = p.z + SIDE.z;
    P[o + 3] = p.x - SIDE.x;
    P[o + 4] = p.y + dy - SIDE.y;
    P[o + 5] = p.z - SIDE.z;
  }
  pos.needsUpdate = true;
  au.needsUpdate = true;
  g.computeBoundingSphere();
}

/**
 * A ribbon's path as last built, kept so a frame that changes nothing (the same jitter step, its points the same to a
 * thousandth) rebuilds nothing; and its jittered points, reused build to build.
 */
class RibbonPath {
  /** The jitter step it was last built at (-1 before its first build). */
  step = -1;
  private at = new Int32Array(0);
  readonly out: Vector3[] = [];

  /** Whether `pts` at jitter `step` differ from the last build (and, if so, remembers them). */
  changed(step: number, pts: readonly { readonly x: number; readonly y: number; readonly z: number }[]): boolean {
    const n = pts.length;
    let same = step === this.step && this.at.length === n * 3;
    if (this.at.length !== n * 3) this.at = new Int32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = pts[i]!,
        x = Math.round(p.x * 1000),
        y = Math.round(p.y * 1000),
        z = Math.round(p.z * 1000);
      if (same && (this.at[i * 3] !== x || this.at[i * 3 + 1] !== y || this.at[i * 3 + 2] !== z)) same = false;
      this.at[i * 3] = x;
      this.at[i * 3 + 1] = y;
      this.at[i * 3 + 2] = z;
    }
    this.step = step;
    return !same;
  }

  /** The points copied into `out` (as many as there are), then displaced midpoint by midpoint (seeded, as before). */
  jittered(pts: readonly { readonly x: number; readonly y: number; readonly z: number }[], rand: () => number, amt: number): Vector3[] {
    const out = this.out,
      n = pts.length;
    while (out.length < n) out.push(new Vector3());
    out.length = n;
    for (let i = 0; i < n; i++) out[i]!.set(pts[i]!.x, pts[i]!.y, pts[i]!.z);
    const disp = (a: number, b: number, k: number): void => {
      if (b - a < 2) return;
      const m = (a + b) >> 1;
      const x = rand() - 0.5,
        y = (rand() - 0.5) * 0.6,
        z = rand() - 0.5;
      out[m]!.x += x * k;
      out[m]!.y += y * k;
      out[m]!.z += z * k;
      disp(a, m, k * 0.55);
      disp(m, b, k * 0.55);
    };
    if (amt > 0) disp(0, n - 1, amt);
    return out;
  }
}

/** What an arc is drawn along: its points (world), its colours, whether it is the top item's (the rest are fainter). */
export interface ArcSpec {
  readonly points: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly colours: readonly string[];
  readonly faint: boolean;
  /** A flare where it lands (not on a plaque, nor a spell under it). */
  readonly flare: boolean;
  /** A flare where it leaves too (a bolt). */
  readonly source?: boolean;
  /** Its width (a spell's aim 0.0315; a bolt 0.05). */
  readonly width?: number;
  /** How far its path is jittered (0.08). */
  readonly jitter?: number;
}

/**
 * A spell's arc (fx.js `arc`, its spell form): a thin line of the spell's own colour lifted toward white, over a glow and
 * a wider haze of its second colour, the path jittered afresh every FX.arcStep (seeded by the step, so a frame is always
 * the same), drips falling off it and a small pool of light where it lands. Fainter for the items below the top.
 */
export class Arc implements Effect {
  readonly object = new Group();
  private readonly core: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly glow: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly haze: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly drips: Emitter;
  private readonly pool: Mesh<PlaneGeometry, MeshBasicMaterial> | null;
  private readonly start: Mesh<PlaneGeometry, MeshBasicMaterial> | null;
  private spec: ArcSpec;
  private readonly path = new RibbonPath();
  constructor(
    kit: FxKit,
    spec: ArcSpec,
    private readonly seed: number,
  ) {
    this.spec = spec;
    const cols = manaColours(spec.colours),
      col = new Color(cols[0]),
      col2 = new Color(cols[1 % cols.length]);
    const mat = (c: Color, o: number): MeshBasicMaterial =>
      new MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
    this.core = new Mesh(new BufferGeometry(), mat(col.clone().lerp(new Color(1, 1, 1), 0.35).multiplyScalar(HDR * 0.45), 0.95));
    this.glow = new Mesh(new BufferGeometry(), mat(col.clone().multiplyScalar(HDR * 0.42), 0.7));
    this.haze = new Mesh(new BufferGeometry(), mat(col2.clone().multiplyScalar(0.6), 0.25));
    this.core.renderOrder = this.glow.renderOrder = this.haze.renderOrder = 21;
    const rand = seeded(seed * 2654435761 + 23);
    this.drips = emitter(kit, rand, { n: 30, colours: cols, size: 7, rise: -1.1, spread: 0.06, speed: 0.75, turb: 0.05, sprite: "streak", start: () => new Vector3(), dir: () => new Vector3(0, -1, 0) });
    this.object.add(this.haze, this.glow, this.core, this.drips.points);
    const w = spec.width ?? 0.0315;
    const poolOf = (big: number) => flatPlane(kit.map("pool"), w * big, w * big * 0.7, { color: col.clone().lerp(new Color(1, 0.85, 0.6), 0.25).multiplyScalar(1.8), opacity: 0.8, blending: AdditiveBlending });
    this.pool = spec.flare ? poolOf(5) : null;
    this.start = spec.source ? poolOf(4) : null;
    for (const p of [this.pool, this.start])
      if (p) {
        p.renderOrder = 21;
        this.object.add(p);
      }
  }

  /** New points (its ends moved with their pieces). */
  set(spec: ArcSpec): void {
    this.spec = spec;
  }

  private build(t: number, still: boolean): void {
    const pts = this.spec.points;
    const n = pts.length;
    if (n < 2) return;
    const step = still ? 0 : Math.floor(t / FX.arcStep);
    if (!this.path.changed(step, pts)) return;
    const rand = seeded((this.seed * 31 + step * 7919) >>> 0);
    const out = this.path.jittered(pts, rand, still ? 0 : (this.spec.jitter ?? 0.08));
    for (let i = 1; i < n - 1; i++) out[i]!.y = Math.max(0.05, out[i]!.y);
    const w = this.spec.width ?? 0.0315;
    ribbonGeo(out, w * 0.3, this.core.geometry);
    ribbonGeo(out, w, this.glow.geometry);
    ribbonGeo(out, w * 1.6, this.haze.geometry);
    const ds = this.drips.points.geometry.getAttribute("aStart") as BufferAttribute;
    for (let i = 0; i < ds.count; i++) {
      const p = out[Math.floor(rand() * (n - 1))]!;
      ds.setXYZ(i, p.x, p.y, p.z);
    }
    ds.needsUpdate = true;
    const end = out[n - 1]!,
      first = out[0]!;
    this.pool?.position.set(end.x, end.y + 0.03, end.z);
    this.start?.position.set(first.x, first.y + 0.03, first.z);
  }

  tick(t: number, level: number, still: boolean): void {
    this.build(t, still);
    const k = (this.spec.faint ? 0.45 : 1) * level;
    const flick = still ? 1 : 0.7 + 0.3 * seeded((this.seed + this.path.step * 13) >>> 0)();
    this.core.material.opacity = flick * k;
    this.glow.material.opacity = (still ? 0.65 : 0.55 + 0.2 * Math.sin(t * 9)) * k;
    this.haze.material.opacity = 0.25 * k;
    this.drips.points.visible = !still;
    this.drips.material.uniforms["uTime"]!.value = t;
    this.drips.material.uniforms["uHdr"]!.value = this.drips.hdr * k;
    if (this.pool) this.pool.material.opacity = (still ? 0.8 : 0.65 + 0.3 * Math.sin(t * 7)) * k;
    if (this.start) this.start.material.opacity = (still ? 0.8 : 0.65 + 0.3 * Math.sin(t * 7 + 2)) * k;
  }

  dispose(): void {
    disposeMesh(this.core);
    disposeMesh(this.glow);
    disposeMesh(this.haze);
    this.drips.dispose();
    if (this.pool) disposeMesh(this.pool);
    if (this.start) disposeMesh(this.start);
  }
}

// ---- an attack's lane: a stroke of its seat's ink with hot pulses running along it ------------------------------------

/** Tuned numbers of a lane (fx.js `arc` with `ink`, `dash`, `flare`, `source`, as h.js `drawLanes` calls it). */
const LANE = { width: 0.035, jitter: 0.05, drips: 6, edge: 0.45, ink: 0.8, wash: 0.22, pulse: 2.2, landing: 11, leaving: 7 } as const;

const DASH_V = `attribute float aU; attribute float aV; varying float vU; varying float vV;
  void main() { vU = aU; vV = aV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// A sparse train of hot white-gold pulses of uneven length with long, uneven gaps, travelling toward the defender: each
// hot at its head and tailing off behind, soft across its width, a bolt in flight rather than a painted dash.
const DASH_F = `
  uniform vec3 uColor; uniform float uOpacity; uniform float uPhase; varying float vU; varying float vV;
  void main() {
    float x = vU / 0.9 - uPhase, seg = floor(x), k = fract(x);
    float h = fract(sin(seg * 12.9898) * 43758.5453), on = 0.2 + 0.25 * h;
    float a = smoothstep(0.0, on, k) * (1.0 - smoothstep(on, on + 0.05, k)) * step(0.45, h);
    a *= 1.0 - vV * vV;
    gl_FragColor = vec4(uColor * (0.6 + 0.6 * a), a * uOpacity);
  }`;

export interface LaneSpec {
  readonly points: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  /** The attacker's seat ink. */
  readonly colour: string;
}

/**
 * An attack (fx.js `arc` with `ink`): laid on the page like a stroke of the pen rather than shone onto it (pale light on
 * tan paper washes out): a saturated band of the seat's colour over a dark edge, a sparse train of white-gold pulses in
 * it running toward the defender, a flare where it leaves the attacker and a bigger one where it lands. Reduced motion
 * holds it still: no jitter, no drips or sparks, the pulses where they stand.
 */
export class Ribbon implements Effect {
  readonly object = new Group();
  private readonly core: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly glow: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly wash: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly edge: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly drips: Emitter;
  private readonly flares: { pool: Mesh<PlaneGeometry, MeshBasicMaterial>; sparks: Emitter; at: "start" | "end" }[] = [];
  private spec: LaneSpec;
  private readonly path = new RibbonPath();
  constructor(
    kit: FxKit,
    spec: LaneSpec,
    private readonly seed: number,
  ) {
    this.spec = spec;
    const col = new Color(spec.colour);
    const flat = (c: Color, o: number): MeshBasicMaterial =>
      new MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: NormalBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
    this.core = new Mesh(
      new BufferGeometry(),
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color("#fff0c0").multiplyScalar(2.2) }, uOpacity: { value: 1 }, uPhase: { value: 0 } },
        vertexShader: DASH_V,
        fragmentShader: DASH_F,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.glow = new Mesh(new BufferGeometry(), flat(col, LANE.ink));
    this.wash = new Mesh(new BufferGeometry(), flat(col, LANE.wash));
    this.edge = new Mesh(new BufferGeometry(), flat(new Color(0x140a04), LANE.edge));
    this.core.renderOrder = this.glow.renderOrder = this.wash.renderOrder = 21;
    this.edge.renderOrder = 20;
    const rand = seeded(seed * 2654435761 + 41);
    const cols = [spec.colour];
    this.drips = emitter(kit, rand, { n: LANE.drips, colours: cols, size: 7, rise: -1.1, spread: 0.06, speed: 0.75, turb: 0.05, sprite: "streak", start: () => new Vector3(), dir: () => new Vector3(0, -1, 0) });
    this.object.add(this.edge, this.wash, this.glow, this.core, this.drips.points);
    const flareAt = (at: "start" | "end", big: number): void => {
      const w = LANE.width;
      const pool = flatPlane(kit.map("pool"), w * big, w * big * 0.7, { color: col.clone().lerp(new Color(1, 0.85, 0.6), 0.25).multiplyScalar(1.8), opacity: 0.8, blending: AdditiveBlending });
      pool.renderOrder = 21;
      const sparks = emitter(kit, rand, {
        n: big > 8 ? 22 : 12,
        colours: [spec.colour, "#fff4d8"],
        size: 4.5,
        rise: 0.6,
        spread: 0.1,
        speed: 1.1,
        turb: 0.05,
        sprite: "streak",
        hdr: HDR * 0.85,
        start: () => new Vector3((rand() - 0.5) * w * 1.5, 0.06, (rand() - 0.5) * w * 1.5),
        dir: () => new Vector3(rand() - 0.5, 1.6, rand() - 0.5).normalize(),
      });
      this.object.add(pool, sparks.points);
      this.flares.push({ pool, sparks, at });
    };
    flareAt("end", LANE.landing);
    flareAt("start", LANE.leaving);
  }

  set(spec: LaneSpec): void {
    this.spec = spec;
  }

  private build(t: number, still: boolean): void {
    const pts = this.spec.points, n = pts.length;
    if (n < 2) return;
    const step = still ? 0 : Math.floor(t / FX.arcStep);
    if (!this.path.changed(step, pts)) return;
    const rand = seeded((this.seed * 31 + step * 7919) >>> 0);
    const out = this.path.jittered(pts, rand, still ? 0 : LANE.jitter);
    for (let i = 1; i < n - 1; i++) out[i]!.y = Math.max(0.02, out[i]!.y);
    const w = LANE.width;
    ribbonGeo(out, w * 0.75, this.core.geometry);
    ribbonGeo(out, w, this.glow.geometry);
    ribbonGeo(out, w * 1.8, this.wash.geometry);
    ribbonGeo(out, w * 1.3, this.edge.geometry, -0.01);
    const ds = this.drips.points.geometry.getAttribute("aStart") as BufferAttribute;
    for (let i = 0; i < ds.count; i++) {
      const p = out[Math.floor(rand() * (n - 1))]!;
      ds.setXYZ(i, p.x, p.y, p.z);
    }
    ds.needsUpdate = true;
    for (const f of this.flares) {
      const at = f.at === "end" ? out[n - 1]! : out[0]!;
      f.pool.position.set(at.x, at.y + 0.03, at.z);
      f.sparks.points.position.set(at.x, at.y, at.z);
    }
  }

  tick(t: number, level: number, still: boolean): void {
    this.build(t, still);
    const flick = still ? 1 : 0.85 + 0.15 * seeded((this.seed + this.path.step * 13) >>> 0)();
    this.core.material.uniforms["uPhase"]!.value = still ? 0 : t * LANE.pulse;
    this.core.material.uniforms["uOpacity"]!.value = flick * level;
    this.glow.material.opacity = (still ? LANE.ink : LANE.ink + 0.08 * Math.sin(t * 9)) * level;
    this.wash.material.opacity = LANE.wash * level;
    this.edge.material.opacity = LANE.edge * level;
    this.drips.points.visible = !still;
    this.drips.material.uniforms["uTime"]!.value = t;
    this.drips.material.uniforms["uHdr"]!.value = this.drips.hdr * level;
    this.flares.forEach((f, i) => {
      f.pool.material.opacity = (still ? 0.8 : 0.65 + 0.3 * Math.sin(t * 7 + i * 2)) * level;
      f.sparks.points.visible = !still;
      f.sparks.material.uniforms["uTime"]!.value = t;
      f.sparks.material.uniforms["uHdr"]!.value = HDR * 0.85 * level;
    });
  }

  dispose(): void {
    disposeMesh(this.core);
    disposeMesh(this.glow);
    disposeMesh(this.wash);
    disposeMesh(this.edge);
    this.drips.dispose();
    for (const f of this.flares) {
      disposeMesh(f.pool);
      f.sparks.dispose();
    }
  }
}
