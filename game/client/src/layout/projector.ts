import type { Point, V3, Viewport } from "./types";

// A pinhole camera as plain data, and the math of three.js's PerspectiveCamera + Vector3.project + the old tableAt
// raycast-to-plane, with no three import. A golden test compares it with three itself.

export interface CameraSpec {
  readonly pos: V3;
  readonly at: V3;
  /** Vertical field of view, degrees, for a wide enough screen. */
  readonly fovDeg: number;
  /** The table's width is kept on narrower screens: at aspects below this factor's reach the fov grows (old `resize`). */
  readonly keepWidth: number;
}

export interface Projector {
  readonly viewport: Viewport;
  /** The camera's steepness: how far it looks down, radians. Standing cards lean back by it to face the camera. */
  readonly pitch: number;
  /** Where the eye is, and the camera's own right and up directions in the world (unit vectors). */
  readonly eye: V3;
  readonly right: V3;
  readonly up: V3;
  /** World to CSS pixels (three: `v.project(cam)` mapped to the viewport). */
  project(p: V3): Point;
  /**
   * The point where the ray through CSS pixel (x, y) meets the level `height` above the table plane. Above the horizon
   * the old code fell back to (-4, height, 6); so does this.
   */
  onTable(x: number, y: number, height?: number): V3;
}

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** The old `resize()` rule: fov 38 on wide screens, wider on narrow ones so the table's width stays in view. */
export function fovFor(spec: CameraSpec, aspect: number): number {
  const hHalf = Math.atan(Math.tan(rad(spec.fovDeg / 2)) * spec.keepWidth);
  return Math.max(spec.fovDeg, deg(2 * Math.atan(Math.tan(hHalf) / aspect)));
}

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** The camera of `spec` for a viewport: look-at (up is +y), perspective with the fov rule above. */
export function pinhole(spec: CameraSpec, viewport: Viewport): Projector {
  const aspect = viewport.w / viewport.h;
  const tanHalf = Math.tan(rad(fovFor(spec, aspect) / 2));
  // Camera basis as three's Matrix4.lookAt builds it for a camera: z points from the target back to the eye.
  const zAxis = norm(sub(spec.pos, spec.at));
  const xAxis = norm(cross({ x: 0, y: 1, z: 0 }, zAxis));
  const yAxis = cross(zAxis, xAxis);
  const pitch = Math.atan2(spec.pos.y - spec.at.y, spec.pos.z - spec.at.z);
  return {
    viewport,
    pitch,
    eye: spec.pos,
    right: xAxis,
    up: yAxis,
    project(p) {
      const d = sub(p, spec.pos);
      const xv = dot(d, xAxis), yv = dot(d, yAxis), depth = -dot(d, zAxis);
      const nx = xv / (depth * tanHalf * aspect), ny = yv / (depth * tanHalf);
      return { x: ((nx + 1) / 2) * viewport.w, y: ((1 - ny) / 2) * viewport.h };
    },
    onTable(x, y, height = 0) {
      const nx = (x / viewport.w) * 2 - 1, ny = -(y / viewport.h) * 2 + 1;
      const vx = nx * tanHalf * aspect, vy = ny * tanHalf;
      const dir = norm({
        x: xAxis.x * vx + yAxis.x * vy - zAxis.x,
        y: xAxis.y * vx + yAxis.y * vy - zAxis.y,
        z: xAxis.z * vx + yAxis.z * vy - zAxis.z,
      });
      // three's Ray.intersectPlane for the plane y = height: no hit when parallel or behind the eye.
      if (dir.y !== 0) {
        const t = (height - spec.pos.y) / dir.y;
        if (t >= 0) return { x: spec.pos.x + dir.x * t, y: height, z: spec.pos.z + dir.z * t };
      }
      return { x: -4, y: height, z: 6 };
    },
  };
}
