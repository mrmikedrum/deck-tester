// Shared geometry: the contact shade under what touches the vellum and a highlight's halo behind a card.
// (A card's own slab is the deck's: cards.ts `slabGeometry`.)
import { PlaneGeometry } from "three";
import type { BufferGeometry } from "three";
import { materials } from "../../theme";

const { card, surface, slab } = materials;

export interface CardGeometry {
  /** The contact shade's plane under a lying card or block. */
  readonly contact: BufferGeometry;
  /** A card's halo: a soft glow behind it, a little larger. */
  readonly halo: BufferGeometry;
  dispose(): void;
}

export function cardGeometry(): CardGeometry {
  // The drop texture's dark core is 100 x 140 of its 160 x 200 (decals.ts `paintDrop`): the core a little past the card.
  const contact = new PlaneGeometry(card.w * 1.6 * slab.contact.grow, card.h * 1.43 * slab.contact.grow);
  const halo = new PlaneGeometry(card.w * surface.halo.w, card.h * surface.halo.h);
  const all = [contact, halo];
  return { contact, halo, dispose: () => all.forEach((g) => g.dispose()) };
}
