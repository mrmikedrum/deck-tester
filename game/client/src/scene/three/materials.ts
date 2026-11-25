// Materials: the unlit card-face material with its signal rim, tap and dim looks (ported from old h.js `faceMat`), the
// shared rim colours that breathe together, and the materials every card shares. Parameters live in theme.
import { Color, MeshBasicMaterial, MeshStandardMaterial } from "three";
import type { Texture } from "three";
import { materials, motion, signal } from "../../theme";

const { rim: rimParams, faceTone } = materials;

export type Signal = "option" | "selected" | "danger";

const WIDTH: Readonly<Record<Signal, number>> = {
  option: rimParams.option,
  selected: rimParams.selected,
  danger: rimParams.danger,
};

/** The rim colours and clock every face material shares: set once a frame, read by every lit card. */
export class Rim {
  /** Seconds, for the rim's flicker. */
  readonly time = { value: 0 };
  readonly colours: Readonly<Record<Signal, Color>> = {
    option: new Color(signal.option),
    selected: new Color(signal.giltRim),
    danger: new Color(signal.dangerRim),
  };

  /**
   * Breathe: the option ring pulses, danger beats (a heartbeat, plain at arm's length, never past full: blood, not light).
   * `still` (reduced motion): neither moves; each holds at its strongest.
   */
  update(nowMs: number, still = false): void {
    this.time.value = still ? 0 : nowMs / 1000;
    const o = rimParams.optionBreath,
      d = rimParams.dangerBeat;
    this.colours.option.set(signal.option).multiplyScalar(o.base + o.swing * (still ? 1 : Math.sin(nowMs / motion.optionPeriod)));
    this.colours.danger
      .set(signal.dangerRim)
      .multiplyScalar(d.base + d.swing * (still ? 1 : Math.pow(Math.max(0, Math.sin(nowMs / motion.dangerPeriod)), 4)));
  }
}

interface Uniform<T> {
  value: T;
}
interface FaceUniforms {
  dim: Uniform<number>;
  tap: Uniform<number>;
  rim: Uniform<Color>;
  rimW: Uniform<number>;
}

const FACE_UNIFORMS = new WeakMap<MeshBasicMaterial, FaceUniforms>();

/**
 * A material for card faces: unlit so every seat reads the same. Two looks: `tap` shades a tapped card but keeps its
 * colour; `dim` greys out what is in the background (out of focus, leaving the table). A signal burns on the card's edge.
 */
export function faceMaterial(map: Texture, rim: Rim, dim = false): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map });
  const u: FaceUniforms = {
    dim: { value: dim ? 1 : 0 },
    tap: { value: 0 },
    rim: { value: new Color(0, 0, 0) },
    rimW: { value: rimParams.idle },
  };
  FACE_UNIFORMS.set(m, u);
  m.toneMapped = false;
  const t = faceTone;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { dim: u.dim, tap: u.tap, rim: u.rim, rimW: u.rimW, uTime: rim.time });
    sh.fragmentShader =
      "uniform float dim;\nuniform float tap;\nuniform vec3 rim;\nuniform float rimW;\nuniform float uTime;\n" +
      sh.fragmentShader.replace(
        "#include <map_fragment>",
        "#include <map_fragment>\nfloat g_ = dot(diffuseColor.rgb, vec3(.299,.587,.114));\n" +
          `diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(g_), diffuseColor.rgb, ${t.tap.mix.toFixed(2)}) * vec3(${t.tap.tint.map((n) => n.toFixed(2)).join(",")}), tap);\n` +
          `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(g_) * ${t.dim.grey.toFixed(2)}, dim * ${t.dim.amount.toFixed(2)});\n` +
          "float e_ = min(min(vMapUv.x, 1.0 - vMapUv.x) * 1.4, min(vMapUv.y, 1.0 - vMapUv.y));\n" +
          "float flick_ = 0.85 + 0.15 * sin(uTime * 7.0 + vMapUv.y * 20.0) * sin(uTime * 3.1 + vMapUv.x * 17.0);\n" +
          `float sel_ = step(${rimParams.hardAbove.toFixed(3)}, rimW);\n` +
          "float band_ = smoothstep(rimW, rimW - 0.005, e_);\n" +
          "diffuseColor.rgb = mix(diffuseColor.rgb, rim, band_ * sel_);\n" +
          "diffuseColor.rgb *= 1.0 - 0.7 * sel_ * smoothstep(rimW + 0.009, rimW + 0.004, e_) * smoothstep(rimW - 0.003, rimW + 0.002, e_);\n" +
          "diffuseColor.rgb += rim * smoothstep(mix(rimW, 0.03, sel_), 0.0, e_) * flick_ * mix(2.2, 0.3, sel_);\n" +
          "diffuseColor.rgb *= 1.0 - 0.85 * step(0.06, rimW) * smoothstep(0.012, 0.008, e_);",
      );
  };
  return m;
}

/** Show or clear a signal on a face material. The rim colour is the shared, breathing one: nothing is walked per frame. */
export function setSignal(m: MeshBasicMaterial, rim: Rim, kind: Signal | null): void {
  const u = FACE_UNIFORMS.get(m);
  if (!u) return;
  if (kind) {
    u.rim.value = rim.colours[kind];
    u.rimW.value = WIDTH[kind];
  } else {
    u.rim.value = ZERO;
    u.rimW.value = rimParams.idle;
  }
}

const ZERO = new Color(0, 0, 0);

/** A face material's look uniforms. */
export function setLook(m: MeshBasicMaterial, look: { readonly tap?: number; readonly dim?: number }): void {
  const u = FACE_UNIFORMS.get(m);
  if (!u) return;
  if (look.tap !== undefined) u.tap.value = look.tap;
  if (look.dim !== undefined) u.dim.value = look.dim;
}

/** What every card shares: its edge, the invisible side faces, and the metals of chips and mounts. */
export class SharedMaterials {
  readonly hidden = new MeshBasicMaterial({ visible: false });
  readonly edge = new MeshStandardMaterial({ color: 0x2a1f14, roughness: materials.surface.edge.roughness });
  readonly edgeDark = new MeshStandardMaterial({ color: 0x2a1f14, roughness: materials.surface.edgeDark.roughness });

  /** A card's back, the tome's leather, shared by every card. */
  readonly rear: MeshBasicMaterial;

  constructor(edgeColour: number, tokenEdgeColour: number, back: Texture) {
    this.edge.color.set(edgeColour);
    this.edgeDark.color.set(tokenEdgeColour);
    this.rear = new MeshBasicMaterial({ map: back });
  }

  dispose(): void {
    this.rear.dispose();
    this.hidden.dispose();
    this.edge.dispose();
    this.edgeDark.dispose();
  }
}
