// Flat sprites drawn together: the contact shades, pools of light, glows and halos that lie on the vellum or behind a
// card are each a plane with a sprite, and a table holds a hundred of them. A sprite built with `batched` stays in the
// scene graph as a proxy (posed, shown and hidden, its colour and opacity set, as any mesh) but is not drawn itself:
// each frame `DecalBatch.sync` draws every shown proxy of the same sprite and blending as one instance of one mesh.
import { Color, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry } from "three";
import type { Material, Mesh, Object3D, Scene } from "three";
import { ABOVE } from "./focus-pass";

/** Marks a sprite drawn by the batch. */
const BATCHED = "batchedDecal";

/**
 * Draw this plane with the batch: its geometry a centred plane (`PlaneGeometry`), its material a `MeshBasicMaterial`
 * whose map, colour, opacity and blending the batch reads every frame. It is never drawn on its own.
 */
export function batched<M extends Mesh>(m: M): M {
  const mat = m.material as MeshBasicMaterial;
  m.userData[BATCHED] = true;
  // (Kept for what the batch reads; the proxy itself is never drawn.)
  mat.visible = false;
  return m;
}

/** A batch unused for this many frames is disposed. */
const IDLE_FRAMES = 120;

const keyOf = (o: Mesh, above: boolean): string => {
  const m = o.material as MeshBasicMaterial;
  return [m.map?.uuid ?? "-", m.alphaMap?.uuid ?? "-", m.blending, m.transparent, m.depthTest, m.depthWrite, m.side, o.renderOrder, above ? 1 : 0].join("|");
};

class Batch {
  readonly mesh: InstancedMesh;
  readonly alpha: InstancedBufferAttribute;
  /** Frames since it last drew anything. */
  idle = 0;
  constructor(
    geo: PlaneGeometry,
    like: Mesh,
    readonly capacity: number,
    above: boolean,
  ) {
    const src = like.material as MeshBasicMaterial;
    const mat = new MeshBasicMaterial({
      map: src.map,
      alphaMap: src.alphaMap,
      transparent: src.transparent,
      depthTest: src.depthTest,
      depthWrite: src.depthWrite,
      blending: src.blending,
      side: src.side,
      toneMapped: src.toneMapped,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float iAlpha;\nvarying float vAlpha;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAlpha = iAlpha;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vAlpha;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vAlpha;");
    };
    mat.customProgramCacheKey = () => "decal-batch";
    const g = new PlaneGeometry(1, 1);
    for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
    g.setIndex(geo.index);
    this.alpha = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    g.setAttribute("iAlpha", this.alpha);
    this.mesh = new InstancedMesh(g, mat, capacity);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = like.renderOrder;
    this.mesh.matrixAutoUpdate = false;
    if (above) this.mesh.layers.set(ABOVE);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as Material).dispose();
    this.mesh.dispose();
  }
}

/** Every batched sprite under the scene, drawn as one instanced mesh per sprite, blending, order and layer. */
export class DecalBatch {
  readonly group;
  private readonly plane = new PlaneGeometry(1, 1);
  private readonly batches = new Map<string, Batch>();
  private readonly m = new Matrix4();
  private readonly s = new Matrix4();
  private readonly c = new Color();

  constructor(group: Object3D) {
    this.group = group;
  }

  /** Draw every shown proxy under `root` (once a frame, matrices updated). */
  sync(root: Scene | Object3D): void {
    const groups = new Map<string, Mesh[]>();
    root.traverseVisible((o) => {
      if (!o.userData[BATCHED]) return;
      const m = o as Mesh,
        mat = m.material as MeshBasicMaterial;
      if (mat.opacity <= 0.001) return;
      const above = (o.layers.mask & (1 << ABOVE)) !== 0 && (o.layers.mask & 1) === 0;
      const k = keyOf(m, above);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(m);
    });
    // A batch nothing has used for a while goes (its texture or its kind of draw may never come back).
    for (const [k, b] of this.batches) {
      if (groups.has(k)) {
        b.idle = 0;
        continue;
      }
      b.mesh.count = 0;
      if (++b.idle > IDLE_FRAMES) {
        this.group.remove(b.mesh);
        b.dispose();
        this.batches.delete(k);
      }
    }
    for (const [k, list] of groups) {
      let b = this.batches.get(k);
      if (!b || b.capacity < list.length) {
        if (b) {
          this.group.remove(b.mesh);
          b.dispose();
        }
        let cap = 16;
        while (cap < list.length) cap *= 2;
        b = new Batch(this.plane, list[0]!, cap, k.endsWith("|1"));
        this.batches.set(k, b);
        this.group.add(b.mesh);
      }
      list.forEach((o, i) => {
        const p = (o.geometry as PlaneGeometry).parameters;
        this.s.makeScale(p?.width ?? 1, p?.height ?? 1, 1);
        b.mesh.setMatrixAt(i, this.m.multiplyMatrices(o.matrixWorld, this.s));
        const mat = o.material as MeshBasicMaterial;
        b.mesh.setColorAt(i, this.c.copy(mat.color));
        b.alpha.setX(i, mat.opacity);
      });
      b.mesh.count = list.length;
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      b.alpha.needsUpdate = true;
    }
  }

  /** How many sprites are drawn now and in how many batches. */
  stats(): { sprites: number; batches: number } {
    let sprites = 0,
      batches = 0;
    for (const b of this.batches.values())
      if (b.mesh.count) {
        sprites += b.mesh.count;
        batches++;
      }
    return { sprites, batches };
  }

  dispose(): void {
    for (const b of this.batches.values()) {
      this.group.remove(b.mesh);
      b.dispose();
    }
    this.batches.clear();
    this.plane.dispose();
  }
}
