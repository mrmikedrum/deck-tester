// The camera, built from layout's projector data so that what the scene draws and what layout measures are one
// camera: the same position, target, vertical field of view (wider on narrow screens, as the projector's rule) and
// aspect. `cameraParams` is pure; `applyCamera` writes it into a three.js camera.
import type { PerspectiveCamera } from "three";
import { fovFor } from "../../layout/projector";
import type { CameraSpec } from "../../layout/projector";
import type { V3, Viewport } from "../../layout/types";
import { materials } from "../../theme";

export interface CameraParams {
  readonly position: V3;
  readonly target: V3;
  /** Vertical field of view, degrees. */
  readonly fov: number;
  readonly aspect: number;
  readonly near: number;
  readonly far: number;
}

export function cameraParams(spec: CameraSpec, viewport: Viewport): CameraParams {
  const aspect = viewport.w / viewport.h;
  return {
    position: spec.pos,
    target: spec.at,
    fov: fovFor(spec, aspect),
    aspect,
    near: materials.camera.near,
    far: materials.camera.far,
  };
}

/** Make `cam` the camera `params` describes (up is +y, as the projector's look-at). */
export function applyCamera(cam: PerspectiveCamera, p: CameraParams): void {
  cam.fov = p.fov;
  cam.aspect = p.aspect;
  cam.near = p.near;
  cam.far = p.far;
  cam.position.set(p.position.x, p.position.y, p.position.z);
  cam.up.set(0, 1, 0);
  cam.lookAt(p.target.x, p.target.y, p.target.z);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
}

export interface RenderSizes {
  /** CSS size of the drawing buffer. */
  readonly width: number;
  readonly height: number;
  readonly renderer: number;
  readonly composer: number;
}

/** The DPR policy: the renderer at most 2x, the composer's targets at most 1.5x. The size is the viewport it was given, never measured. */
export function renderSizes(viewport: Viewport, dpr: number): RenderSizes {
  const renderer = Math.min(dpr > 0 ? dpr : 1, materials.pixelRatio.renderer);
  return {
    width: Math.max(1, Math.round(viewport.w)),
    height: Math.max(1, Math.round(viewport.h)),
    renderer,
    composer: Math.min(renderer, materials.pixelRatio.composer),
  };
}
