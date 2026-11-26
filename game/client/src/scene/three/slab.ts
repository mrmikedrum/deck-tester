// A card's presence on the table besides its own slab: the block of stock under a pile's top card (the same slab as a
// card, stretched to its count's true height, a line per card on its walls), and the soft contact shade where a card, a
// block or a standing card's foot meets the vellum (the lamp's shadow map does the rest).
import { Group, Mesh, MeshBasicMaterial } from "three";
import { materials } from "../../theme";
import { batched } from "./batch";
import { createCard } from "./cards";
import type { CardObject } from "./cards";
import type { Host } from "./host";
import type { Lease } from "./textures";

const { slab, card } = materials;

/** How high a block of `count` cards under a top card rises, world units (before the piece's scale). */
export const blockHeight = (count: number, step: number = slab.step, cap: number = slab.cap): number =>
  count <= 0 ? 0 : Math.min(cap, count * step);

/** A block of stock: its top at its group's origin, running down (along -z) by its height; a line on its walls per card. */
export class Block {
  /** Its top: where the piece puts it. */
  readonly mesh = new Group();
  private readonly card: CardObject;
  private readonly tint: number;
  constructor(host: Host, token: boolean) {
    this.card = createCard(host.kit, null, { token });
    this.tint = this.card.state.stock;
    this.mesh.add(this.card.group);
  }
  /** Show `count` cards in `h` of height (0 hides it). */
  set(count: number, h: number): void {
    this.mesh.visible = count > 0 && h > 0;
    if (!this.mesh.visible) return;
    this.card.group.scale.set(1, 1, h / card.thickness);
    this.card.group.position.z = -h / 2;
    this.card.state.strata = Math.max(1, count);
  }
  tone(k: number): void {
    this.card.state.stock = this.tint * k;
  }
  dispose(): void {
    this.card.dispose();
  }
}

/** The soft dark seam under a lying card or block, a little larger than it, where it meets the vellum. */
export class Contact {
  readonly mesh: Mesh;
  private readonly mat: MeshBasicMaterial;
  private readonly lease: Lease;
  constructor(
    host: Host,
    private readonly strength: number = slab.contact.opacity,
  ) {
    this.lease = host.painter.drop();
    this.mat = new MeshBasicMaterial({ map: this.lease.texture, color: 0x000000, transparent: true, opacity: strength, depthWrite: false, toneMapped: false });
    this.mesh = batched(new Mesh(host.kit.geo.contact, this.mat));
    this.mesh.renderOrder = -1;
  }
  fade(k: number): void {
    this.mat.opacity = this.strength * k;
  }
  dispose(): void {
    this.mat.dispose();
    this.lease.release();
  }
}
