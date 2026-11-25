import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { pinhole, tableTemplate } from "../../src/layout";
import { applyCamera, cameraParams, renderSizes } from "../../src/scene/three/camera";
import { TextureCache } from "../../src/scene/three/textures";

const VIEWPORTS = [
  { w: 1180, h: 820 },
  { w: 820, h: 1180 },
  { w: 1920, h: 1080 },
  { w: 600, h: 900 },
];

describe("camera", () => {
  const spec = tableTemplate(4).camera;
  it("projects exactly as layout's projector does", () => {
    for (const vp of VIEWPORTS) {
      const cam = new PerspectiveCamera();
      applyCamera(cam, cameraParams(spec, vp));
      const proj = pinhole(spec, vp);
      for (const p of [
        { x: 0, y: 0, z: 0 },
        { x: -8.68, y: 0, z: -7.42 },
        { x: 8, y: 1.2, z: 3 },
        { x: 0, y: 0.5, z: -10.5 },
      ]) {
        const v = new Vector3(p.x, p.y, p.z).project(cam);
        const px = ((v.x + 1) / 2) * vp.w,
          py = ((1 - v.y) / 2) * vp.h;
        const want = proj.project(p);
        expect(px).toBeCloseTo(want.x, 4);
        expect(py).toBeCloseTo(want.y, 4);
      }
    }
  });
  it("takes its parameters from the spec and the viewport", () => {
    const p = cameraParams(spec, { w: 1180, h: 820 });
    expect(p.position).toEqual(spec.pos);
    expect(p.target).toEqual(spec.at);
    expect(p.fov).toBeGreaterThanOrEqual(38); // 38 on a wide enough screen (1180 x 820 is a hair narrower)
    expect(cameraParams(spec, { w: 1920, h: 1080 }).fov).toBe(38);
    expect(p.aspect).toBeCloseTo(1180 / 820);
    expect(cameraParams(spec, { w: 600, h: 900 }).fov).toBeGreaterThan(38);
  });
  it("sizes targets by the pixel-ratio policy without measuring", () => {
    expect(renderSizes({ w: 1180, h: 820 }, 3)).toEqual({ width: 1180, height: 820, renderer: 2, composer: 1.5 });
    expect(renderSizes({ w: 1180, h: 820 }, 1)).toMatchObject({ renderer: 1, composer: 1 });
    expect(renderSizes({ w: 0, h: 0 }, 0)).toMatchObject({ width: 1, height: 1, renderer: 1 });
  });
});

describe("TextureCache", () => {
  const canvas = () => ({ width: 0, height: 0 }) as unknown as HTMLCanvasElement;
  const paint = (w: number, h: number) => (c: HTMLCanvasElement) => {
    c.width = w;
    c.height = h;
  };
  it("leases by key, evicts idle textures over budget and frees their pixels", () => {
    const cache = new TextureCache({ budget: 3_000_000, anisotropy: 4, canvas });
    const a = cache.lease("a", paint(500, 500)),
      a2 = cache.lease("a", paint(500, 500));
    expect(a2.texture).toBe(a.texture);
    const b = cache.lease("b", paint(500, 500));
    expect(cache.stats().bytes).toBe(2 * Math.round(500 * 500 * 4 * (4 / 3)));
    a.release();
    a.release(); // idempotent
    expect(cache.stats().live).toBe(2);
    a2.release();
    expect(cache.stats().idle).toBe(1);
    // a third texture pushes the total past 3 MB: the idle one goes
    const c = cache.lease("c", paint(500, 500));
    expect(cache.stats()).toMatchObject({ disposed: 1, entries: 2 });
    expect((a.texture.image as { width: number }).width).toBe(0);
    c.release();
    b.release();
    cache.clear();
    expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
  });
});
