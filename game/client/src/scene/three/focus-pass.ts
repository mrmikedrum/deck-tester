// A focus in the composer (the stack, the clash): one scrim laid over the table as drawn, then what stands above it (the
// stack's cards, what they aim at, the arcs, the clash's fighters) drawn again over the scrim in their own places, at
// full colour. What stands above is marked by a layer (ABOVE); everything is still drawn in the first pass, so its
// shadows fall as before. The clash also asks for a calm ground under its fighters: a soft-edged panel of the page's own
// tone over the area it covers (`FocusWell`), so the boards behind it stop showing through, while the shade over the rest
// of the table stays light.
import { Color, ShaderMaterial, Vector4 } from "three";
import type { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";

/** The layer the focus draws above its scrim. */
export const ABOVE = 1;

/**
 * The scrim is laid in linear light, before tone mapping and the display's curve; its alpha is the look's, as over the
 * finished picture (where 0.55 leaves 45% of the light). Through the display's gamma that is 1 - 0.45^2.2 of linear light.
 */
export const linearAlpha = (a: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, a)), 2.2);

/** A calm ground under a focus: a rect on screen (CSS px), its soft edge (px), its tone and how much it covers. */
export interface FocusWell {
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
  readonly feather: number;
  readonly colour: number;
  readonly alpha: number;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
uniform vec3 uScrim;
uniform float uAlpha;
uniform vec4 uRect;     // l, t, r, b in px from the top left
uniform vec2 uSize;     // the viewport, px
uniform float uFeather;
uniform vec3 uWell;
uniform float uWellAlpha;
varying vec2 vUv;
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  vec2 c = (uRect.xy + uRect.zw) * 0.5, h = (uRect.zw - uRect.xy) * 0.5;
  vec2 q = abs(p - c) - h + uFeather;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uFeather;
  float k = uWellAlpha > 0.0 ? 1.0 - smoothstep(-uFeather, uFeather, d) : 0.0;
  float a = mix(uAlpha, uWellAlpha, k);
  vec3 col = mix(uScrim * uAlpha, uWell * uWellAlpha, k) / max(a, 1e-4);
  gl_FragColor = vec4(col, a);
}`;

export class FocusPass extends Pass {
  /** The scrim's alpha: 0 draws nothing. */
  alpha = 0;
  /** The calm ground under the clash, or null. */
  well: FocusWell | null = null;
  /** The viewport, CSS px (the well's rect is in it). */
  size = { w: 1, h: 1 };
  private readonly material: ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    colour: number,
  ) {
    super();
    this.needsSwap = false;
    this.material = new ShaderMaterial({
      uniforms: {
        uScrim: { value: new Color(colour) },
        uAlpha: { value: 0 },
        uRect: { value: new Vector4() },
        uSize: { value: [1, 1] },
        uFeather: { value: 1 },
        uWell: { value: new Color() },
        uWellAlpha: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.material.toneMapped = false;
    this.quad = new FullScreenQuad(this.material);
  }

  override render(renderer: WebGLRenderer, _write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    if (this.alpha <= 0) return;
    const autoClear = renderer.autoClear, shadows = renderer.shadowMap.autoUpdate, background = this.scene.background;
    const layers = this.camera.layers.mask;
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.autoClear = false;
    const u = this.material.uniforms, w = this.well;
    u["uAlpha"]!.value = linearAlpha(this.alpha);
    u["uSize"]!.value = [this.size.w, this.size.h];
    u["uWellAlpha"]!.value = w ? linearAlpha(w.alpha) : 0;
    if (w) {
      (u["uRect"]!.value as Vector4).set(w.l, w.t, w.r, w.b);
      u["uFeather"]!.value = Math.max(1, w.feather);
      (u["uWell"]!.value as Color).setHex(w.colour);
    }
    this.quad.render(renderer);
    // Above the scrim: only what is marked, over a fresh depth (it never meets the dimmed table's depth), with the
    // shadow map the first pass made.
    renderer.clearDepth();
    renderer.shadowMap.autoUpdate = false;
    this.scene.background = null;
    this.camera.layers.set(ABOVE);
    renderer.render(this.scene, this.camera);
    this.camera.layers.mask = layers;
    this.scene.background = background;
    renderer.shadowMap.autoUpdate = shadows;
    renderer.autoClear = autoClear;
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
