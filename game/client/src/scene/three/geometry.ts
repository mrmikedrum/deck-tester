// Shared geometry: a card's rounded face (uv remapped to the card), its edge, the chip and halo planes.
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
} from "three";
import type { BufferGeometry } from "three";
import { materials } from "../../theme";

const { card, surface } = materials;

export interface CardGeometry {
  readonly face: BufferGeometry;
  readonly edge: BufferGeometry;
  readonly chip: BufferGeometry;
  readonly chipTop: BufferGeometry;
  readonly halo: BufferGeometry;
  dispose(): void;
}

/** A card is a thin box with its face on +Z, centred on the origin, 1 tall. */
export function cardGeometry(): CardGeometry {
  const r = card.corner,
    w = card.w,
    h = card.h,
    sh = new Shape();
  sh.moveTo(-w / 2 + r, -h / 2);
  sh.lineTo(w / 2 - r, -h / 2);
  sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  sh.lineTo(w / 2, h / 2 - r);
  sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  sh.lineTo(-w / 2 + r, h / 2);
  sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  sh.lineTo(-w / 2, -h / 2 + r);
  sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const face = new ShapeGeometry(sh, card.curveSegments);
  const uv = face.attributes["uv"],
    pos = face.attributes["position"];
  if (uv && pos) for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  const edge = new ExtrudeGeometry(sh, {
    depth: card.thickness,
    bevelEnabled: false,
    curveSegments: card.curveSegments,
  });
  edge.translate(0, 0, -card.thickness / 2);
  const c = surface.chip;
  const chip = new CylinderGeometry(c.radius, c.radius, c.height, c.segments);
  const chipTop = new CircleGeometry(c.radius, c.segments);
  const halo = new PlaneGeometry(card.w * surface.halo.w, card.h * surface.halo.h);
  const all = [face, edge, chip, chipTop, halo];
  return { face, edge, chip, chipTop, halo, dispose: () => all.forEach((g) => g.dispose()) };
}

/** A unit plane and a box, for pages, plaques and piles. */
export const unitPlane = (w: number, h: number): PlaneGeometry => new PlaneGeometry(w, h);
export const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
