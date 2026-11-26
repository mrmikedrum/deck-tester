// The world under the cards: the tome the table is, the lamp over it and the room's fill. Static; pieces are added by
// the stage. The lamp is the only light that casts: a spot whose soft shadow map falls on the tome, the pages and the
// cards (the host redraws it only while something moves).
import { ABOVE } from "./focus-pass";
import {
  Color,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  RepeatWrapping,
  SpotLight,
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
  /** The lamp: the one shadow-casting light. */
  readonly lamp: SpotLight;
  /** The table's light: 1, or dimmed under a sift. */
  tone(k: number): void;
  dispose(): void;
}

/** The table plane, with the tome painted on it (a lease the caller holds) and its normal map; the lamp and the fill. */
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
  const l = lights.lamp,
    sh = l.shadow;
  const lamp = new SpotLight(l.colour, l.intensity, 0, l.angle, l.penumbra, l.decay);
  lamp.position.set(l.at.x, l.at.y, l.at.z);
  lamp.target.position.set(l.aim.x, l.aim.y, l.aim.z);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(sh.size, sh.size);
  lamp.shadow.camera.near = sh.near;
  lamp.shadow.camera.far = sh.far;
  lamp.shadow.bias = sh.bias;
  lamp.shadow.normalBias = sh.normalBias;
  lamp.shadow.radius = sh.radius;
  const fill = new HemisphereLight(lights.fill.sky, lights.fill.ground, lights.fill.intensity);
  group.add(lamp, lamp.target, fill);
  // The lights reach what the focus draws above its scrim, too.
  for (const x of [lamp, fill]) x.layers.enable(ABOVE);
  return {
    group,
    background: new Color(colour.table),
    lamp,
    tone: (k) => mat.color.setScalar(k),
    dispose: () => {
      geo.dispose();
      mat.dispose();
      nmap?.dispose();
      lamp.shadow.dispose();
    },
  };
}
