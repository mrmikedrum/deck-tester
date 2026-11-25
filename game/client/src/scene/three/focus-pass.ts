// The stack as the table's focus, in the composer: one scrim laid over the table as drawn, then what stands above it (the
// stack's cards, what they aim at, the arcs) drawn again over the scrim in their own places, at full colour. What stands
// above is marked by a layer (ABOVE); everything is still drawn in the first pass, so its shadows fall as before.
import { Color, MeshBasicMaterial } from "three";
import type { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";

/** The layer the focus draws above its scrim. */
export const ABOVE = 1;

/**
 * The scrim is laid in linear light, before tone mapping and the display's curve; its alpha is the look's, as over the
 * finished picture (where 0.55 leaves 45% of the light). Through the display's gamma that is 1 - 0.45^2.2 of linear light.
 */
export const linearAlpha = (a: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, a)), 2.2);

export class FocusPass extends Pass {
  /** The scrim's alpha: 0 draws nothing. */
  alpha = 0;
  private readonly material: MeshBasicMaterial;
  private readonly quad: FullScreenQuad;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    colour: number,
  ) {
    super();
    this.needsSwap = false;
    this.material = new MeshBasicMaterial({ color: new Color(colour), transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this.material.toneMapped = false;
    this.quad = new FullScreenQuad(this.material);
  }

  override render(renderer: WebGLRenderer, _write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    if (this.alpha <= 0) return;
    const autoClear = renderer.autoClear, shadows = renderer.shadowMap.autoUpdate, background = this.scene.background;
    const layers = this.camera.layers.mask;
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.autoClear = false;
    this.material.opacity = linearAlpha(this.alpha);
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
