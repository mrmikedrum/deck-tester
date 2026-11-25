// Lanes and arcs rebuild their ribbons every jitter step while combat is up: into the buffers they already have (no
// arrays made per rebuild), and the same as a fresh one built at that step (nothing carried from the last build).
import { describe, expect, it } from "vitest";
import { BufferAttribute, Mesh, Texture } from "three";
import type { BufferGeometry } from "three";
import { Arc, FxKit, Ribbon } from "../../src/scene/three/fx";
import type { Lease } from "../../src/scene/three/textures";

const kit = () => new FxKit(() => ({ texture: new Texture(), release: () => undefined }) as unknown as Lease, () => 1);
const points = (dx: number) => Array.from({ length: 13 }, (_, i) => ({ x: i * 0.4 + dx, y: 0.2 + Math.sin(i / 3) * 0.3, z: -i * 0.1 }));
const ribbons = (o: { object: { children: unknown[] } }): BufferGeometry[] =>
  o.object.children.filter((c): c is Mesh => c instanceof Mesh && !!c.geometry.getAttribute("aU")).map((m) => m.geometry);
const arrays = (gs: BufferGeometry[]) => gs.flatMap((g) => ["position", "aU", "aV"].map((k) => (g.getAttribute(k) as BufferAttribute).array));
const positions = (gs: BufferGeometry[]) => gs.map((g) => [...(g.getAttribute("position") as BufferAttribute).array]);

/** How many Float32Arrays `f` makes. */
function counting(f: () => void): number {
  const Real = globalThis.Float32Array;
  let n = 0;
  globalThis.Float32Array = class extends Real {
    constructor(...a: unknown[]) {
      super(...(a as [number]));
      n++;
    }
  } as typeof Float32Array;
  try {
    f();
  } finally {
    globalThis.Float32Array = Real;
  }
  return n;
}

describe("ribbons", () => {
  const STEP_S = 10; // far apart in time: a new jitter step each tick
  for (const [name, make] of [
    ["an attack's lane", (pts: ReturnType<typeof points>) => new Ribbon(kit(), { points: pts, colour: "#c03020" }, 7)],
    ["a spell's arc", (pts: ReturnType<typeof points>) => new Arc(kit(), { points: pts, colours: ["R"], faint: false, flare: true, source: true }, 7)],
  ] as const)
    it(`${name}: rebuilt into the same buffers, the same as a fresh build`, () => {
      const r = make(points(0));
      r.tick(0, 1, false);
      const first = arrays(ribbons(r));
      expect(first.length).toBeGreaterThan(0);
      for (let k = 1; k <= 4; k++) {
        r.set({ ...(r as unknown as { spec: object }).spec, points: points(k * 0.05) } as never);
        const made = counting(() => r.tick(k * STEP_S, 1, false));
        expect(made, "arrays made by a rebuild").toBe(0);
        const now = arrays(ribbons(r));
        now.forEach((a, i) => expect(a, `buffer ${i}`).toBe(first[i]));
        const fresh = make(points(k * 0.05));
        fresh.tick(k * STEP_S, 1, false);
        expect(positions(ribbons(r))).toEqual(positions(ribbons(fresh)));
      }
    });
});
