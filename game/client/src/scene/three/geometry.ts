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

const { card, surface, slab } = materials;

export interface CardGeometry {
  readonly face: BufferGeometry;
  readonly edge: BufferGeometry;
  /** A block of stock one unit deep, its top at 0 and running down to -1 (scaled by its height), its walls' v along it. */
  readonly block: BufferGeometry;
  /** The contact shadow's plane under a lying card. */
  readonly contact: BufferGeometry;
  readonly chip: BufferGeometry;
  readonly chipTop: BufferGeometry;
  readonly halo: BufferGeometry;
  dispose(): void;
}

/**
 * A card is a slab with its face on +Z, 1 tall: the face at the card's true half thickness, the stock (`slab.depth`)
 * running down from it, so a pose that lays a card's middle on the page still lays its face where it was.
 */
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
    depth: slab.depth,
    bevelEnabled: false,
    curveSegments: card.curveSegments,
  });
  edge.translate(0, 0, card.thickness / 2 - slab.depth);
  const block = new ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: card.curveSegments });
  block.translate(0, 0, -1);
  // The drop texture's dark core is 100 x 140 of its 160 x 200 (decals.ts `paintDrop`): the core a little past the card.
  const contact = new PlaneGeometry(card.w * 1.6 * slab.contact.grow, card.h * 1.43 * slab.contact.grow);
  const c = surface.chip;
  const chip = new CylinderGeometry(c.radius, c.radius, c.height, c.segments);
  const chipTop = new CircleGeometry(c.radius, c.segments);
  const halo = new PlaneGeometry(card.w * surface.halo.w, card.h * surface.halo.h);
  const all = [face, edge, block, contact, chip, chipTop, halo];
  return { face, edge, block, contact, chip, chipTop, halo, dispose: () => all.forEach((g) => g.dispose()) };
}

/** A unit plane and a box, for pages, plaques and piles. */
export const unitPlane = (w: number, h: number): PlaneGeometry => new PlaneGeometry(w, h);
export const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
