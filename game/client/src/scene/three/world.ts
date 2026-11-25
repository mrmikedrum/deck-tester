// The world under the cards: the tome the table is, and one lamp over it. Static; pieces are added by the stage.
// Ported from old h.js `buildScene`.
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  NoColorSpace,
  RepeatWrapping,
  Texture,
  Vector2,
} from "three";
import { colour, materials } from "../../theme";
import type { Source } from "../../theme";
import type { Lease } from "./textures";

const { lights, surface } = materials;
const PLANE = { w: 60, d: 50, z: -4 } as const;

export interface World {
  readonly group: Group;
  readonly background: Color;
  /** The table's light: 1, or dimmed while the stack is the focus. */
  tone(k: number): void;
  dispose(): void;
}

/** The table plane, with the tome painted on it (a lease the caller holds) and its normal map. */
export function createWorld(tome: Lease, normal: Source | null): World {
  const group = new Group();
  let nmap: Texture | null = null;
  if (normal) {
    nmap = new Texture(normal as HTMLImageElement);
    nmap.wrapS = nmap.wrapT = RepeatWrapping;
    nmap.repeat.set(surface.table.normalRepeat[0], surface.table.normalRepeat[1]);
    nmap.colorSpace = NoColorSpace; // a normal map is data, not colour
    nmap.needsUpdate = true;
  }
  const geo = new PlaneGeometry(PLANE.w, PLANE.d);
  const mat = new MeshStandardMaterial({ map: tome.texture, roughness: surface.table.roughness });
  if (nmap) {
    mat.normalMap = nmap;
    mat.normalScale = new Vector2(surface.table.normalScale, surface.table.normalScale);
  }
  // It is the bottom of everything, so it writes no depth: across a plane this large, depth is not fine enough to keep a
  // page 3 mm above it in front from every point of view.
  mat.depthWrite = false;
  const table = new Mesh(geo, mat);
  table.rotation.x = -Math.PI / 2;
  table.position.z = PLANE.z;
  table.receiveShadow = true;
  table.renderOrder = -4;
  group.add(table);
  // One lamp over the table, warm, and a little of the room: the pages shade by it, the cards never do.
  group.add(new AmbientLight(lights.ambient.colour, lights.ambient.intensity));
  const lamp = new PointLight(lights.lamp.colour, lights.lamp.intensity, lights.lamp.distance, lights.lamp.decay);
  lamp.position.set(lights.lamp.at.x, lights.lamp.at.y, lights.lamp.at.z);
  group.add(lamp);
  const sun = new DirectionalLight(lights.sun.colour, lights.sun.intensity),
    sh = lights.sun.shadow;
  sun.position.set(lights.sun.at.x, lights.sun.at.y, lights.sun.at.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(sh.size, sh.size);
  Object.assign(sun.shadow.camera, {
    left: -sh.half,
    right: sh.half,
    top: sh.half,
    bottom: -sh.half,
    near: sh.near,
    far: sh.far,
  });
  sun.shadow.bias = sh.bias;
  sun.shadow.normalBias = sh.normalBias;
  group.add(sun);
  return {
    group,
    background: new Color(colour.table),
    tone: (k) => mat.color.setScalar(k),
    dispose: () => {
      geo.dispose();
      mat.dispose();
      nmap?.dispose();
      sun.shadow.map?.dispose();
    },
  };
}
