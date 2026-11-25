import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { pinhole } from "../../src/layout/projector";
import { tableTemplate } from "../../src/layout/template";

// The old client's camera, built with three itself, exactly as h.js built it (CAM, resize()).
function threeCamera(w: number, h: number): THREE.PerspectiveCamera {
  const CAM = { pos: [0, 18, 14], at: [0, 0, -1.6], fov: 38 } as const;
  const cam = new THREE.PerspectiveCamera(34, w / h, 1, 120);
  cam.position.set(...CAM.pos);
  cam.lookAt(...CAM.at);
  cam.aspect = w / h;
  const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) * 1.44);
  cam.fov = Math.max(CAM.fov, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hHalf) / cam.aspect)));
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

const oldProject = (cam: THREE.PerspectiveCamera, w: number, h: number, v: THREE.Vector3) => {
  const p = v.clone().project(cam);
  return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
};

function oldTableAt(cam: THREE.PerspectiveCamera, w: number, h: number, px: number, py: number, y: number): THREE.Vector3 {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), cam);
  const hit = new THREE.Vector3();
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit) ?? new THREE.Vector3(-4, y, 6);
}

// 1180x820 (the design size), a landscape iPad, a small laptop, a retina iPad, and narrow ones where the fov rule bites.
const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [1180, 820],
  [1366, 1024],
  [1024, 768],
  [2732, 2048],
  [820, 1180],
  [600, 900],
  [390, 844],
  [1920, 800],
];

describe("projector", () => {
  const camera = tableTemplate(4).camera;
  for (const [w, h] of VIEWPORTS) {
    it(`project matches three at ${w}x${h}`, () => {
      const cam = threeCamera(w, h), mine = pinhole(camera, { w, h });
      for (let x = -14; x <= 14; x += 3.5)
        for (let z = -18; z <= 12; z += 3)
          for (const y of [0, 0.5, 1, 3.2]) {
            const a = oldProject(cam, w, h, new THREE.Vector3(x, y, z)), b = mine.project({ x, y, z });
            expect(Math.abs(a.x - b.x)).toBeLessThan(1e-6 * Math.max(1, w));
            expect(Math.abs(a.y - b.y)).toBeLessThan(1e-6 * Math.max(1, h));
          }
    });
    it(`onTable matches the old tableAt at ${w}x${h}`, () => {
      const cam = threeCamera(w, h), mine = pinhole(camera, { w, h });
      for (let fx = 0; fx <= 1; fx += 0.125)
        for (let fy = 0; fy <= 1; fy += 0.125)
          for (const level of [0, 2, 3.2]) {
            const a = oldTableAt(cam, w, h, fx * w, fy * h, level), b = mine.onTable(fx * w, fy * h, level);
            expect(b.x).toBeCloseTo(a.x, 5);
            expect(b.y).toBeCloseTo(a.y, 5);
            expect(b.z).toBeCloseTo(a.z, 5);
          }
    });
  }

  it("round-trips a table point through the screen", () => {
    const p = pinhole(camera, { w: 1180, h: 820 }), at = { x: 3, y: 0, z: -2 };
    const s = p.project(at), back = p.onTable(s.x, s.y);
    expect(back.x).toBeCloseTo(at.x, 6);
    expect(back.z).toBeCloseTo(at.z, 6);
  });

  it("looks down at the pitch the old PITCH constant had", () => {
    expect(pinhole(camera, { w: 1180, h: 820 }).pitch).toBeCloseTo(Math.atan2(18, 15.6), 12);
  });
});
