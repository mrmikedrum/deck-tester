// One card: a thin box with its face on +Z, centred on the origin and 1 tall; a front, a rear (the tome's back) and a
// dark edge. The tap turns the body inside the pose group so a pose can face the card toward the camera without
// undoing its quarter turn. Ported from old h.js `cardMesh`.
import { Group, Mesh } from "three";
import type { MeshBasicMaterial, Texture } from "three";
import { materials } from "../../theme";
import type { CardGeometry } from "./geometry";
import { faceMaterial } from "./materials";
import type { Rim, SharedMaterials } from "./materials";

const { card } = materials;

export interface CardKit {
  readonly geo: CardGeometry;
  readonly shared: SharedMaterials;
  readonly rim: Rim;
}

export interface CardOptions {
  readonly tapped?: boolean;
  readonly token?: boolean;
  readonly dim?: boolean;
}

export interface CardObject {
  /** The pose group: position, rotation and scale go here. */
  readonly group: Group;
  readonly body: Group;
  readonly front: Mesh;
  /** Its own face material (uniforms per card); dispose it with the card. */
  readonly material: MeshBasicMaterial;
  dispose(): void;
}

export function createCard(kit: CardKit, face: Texture, opts: CardOptions = {}): CardObject {
  const group = new Group();
  const edge = new Mesh(kit.geo.edge, [kit.shared.hidden, opts.token ? kit.shared.edgeDark : kit.shared.edge]);
  edge.castShadow = true;
  const material = faceMaterial(face, kit.rim, opts.dim ?? false);
  const front = new Mesh(kit.geo.face, material);
  front.position.z = card.thickness / 2 + card.faceLift;
  const rear = new Mesh(kit.geo.face, kit.shared.rear);
  rear.position.z = -card.thickness / 2 - card.faceLift;
  rear.rotation.y = Math.PI;
  const body = new Group();
  body.rotation.z = opts.tapped ? -Math.PI / 2 : 0;
  body.add(edge, front, rear);
  group.add(body);
  return { group, body, front, material, dispose: () => material.dispose() };
}
