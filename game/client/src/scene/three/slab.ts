// A card's presence on the table: the block of stock under a pile's top card (its height its count, strata on its walls)
// the contact shadow where a card or a block meets the vellum, and the cast shadow: the card's soft silhouette projected
// along the sun onto the vellum under it (a planar shadow: exact for any posture, and the same pixels every frame).
import { DoubleSide, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, RepeatWrapping, Vector3 } from "three";
import type { Texture } from "three";
import { materials } from "../../theme";
import type { Host } from "./host";
import type { Lease } from "./textures";

const { slab } = materials;

/** Toward the lamp, a unit vector: what a planar shadow is projected along. */
const SUN = new Vector3(slab.cast.from.x, slab.cast.from.y, slab.cast.from.z).normalize();

/** The projection along the lamp onto the plane y = y0 (row-major: x' = x - (sx/sy)(y - y0), y' = y0, likewise z). */
function flatten(m: Matrix4, y0: number): Matrix4 {
  const kx = SUN.x / SUN.y,
    kz = SUN.z / SUN.y;
  return m.set(1, -kx, 0, kx * y0, 0, 0, 0, y0, 0, -kz, 1, kz * y0, 0, 0, 0, 1);
}

/** How high a block of `count` cards under a top card rises, world units (before the piece's scale). */
export const blockHeight = (count: number, step: number = slab.step, cap: number = slab.cap): number =>
  count <= 0 ? 0 : Math.min(cap, count * step);

/** A block of stock: its top at its group's origin, running down (along -z) by its height; strata one per card. */
export class Block {
  readonly mesh: Mesh;
  private readonly mat: MeshStandardMaterial;
  private readonly tex: Texture;
  private readonly lease: Lease;
  private key = "";
  constructor(host: Host, token: boolean) {
    this.lease = host.painter.strata();
    this.tex = this.lease.texture.clone();
    this.tex.wrapS = this.tex.wrapT = RepeatWrapping;
    this.tex.needsUpdate = true;
    this.mat = new MeshStandardMaterial({ map: this.tex, color: token ? slab.tokenStock : 0xffffff, roughness: slab.roughness });
    this.mesh = new Mesh(host.kit.geo.block, [this.mat, this.mat]);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData["covers"] = true;
  }
  /** Show `count` cards in `h` of height (0 hides it). */
  set(count: number, h: number): void {
    this.mesh.visible = count > 0 && h > 0;
    if (!this.mesh.visible) return;
    this.mesh.scale.set(1, 1, h);
    const lines = Math.max(1, Math.min(count, Math.round(h / slab.strataMin)));
    const key = `${lines}`;
    if (key === this.key) return;
    this.key = key;
    this.tex.repeat.set(1, lines);
  }
  tone(k: number): void {
    this.mat.color.setScalar(k);
  }
  dispose(): void {
    this.mat.dispose();
    this.tex.dispose();
    this.lease.release();
  }
}

/** The soft dark seam under a lying card or block, a little larger than it, where it meets the vellum. */
export class Contact {
  readonly mesh: Mesh;
  private readonly mat: MeshBasicMaterial;
  private readonly lease: Lease;
  constructor(host: Host) {
    this.lease = host.painter.drop();
    this.mat = new MeshBasicMaterial({ map: this.lease.texture, color: 0x000000, transparent: true, opacity: slab.contact.opacity, depthWrite: false, toneMapped: false });
    this.mesh = new Mesh(host.kit.geo.contact, this.mat);
    this.mesh.renderOrder = -1;
  }
  fade(k: number): void {
    this.mat.opacity = slab.contact.opacity * k;
  }
  dispose(): void {
    this.mat.dispose();
    this.lease.release();
  }
}

/**
 * A card's cast shadow: an anchor rides in the card's own frame (on its face), and a soft card-shaped shade is that
 * anchor flattened along the sun onto the vellum at `ground`, every time it is drawn. A standing card's falls behind it;
 * a block's top throws one past its far edge as long as it is tall; a lone lying card's is a sliver.
 */
export class CastShadow {
  readonly anchor = new Object3D();
  readonly mesh: Mesh;
  private readonly mat: MeshBasicMaterial;
  private readonly lease: Lease;
  private readonly flat = new Matrix4();
  /** The vellum's height under it, world units. */
  ground = 0;
  constructor(host: Host) {
    this.lease = host.painter.drop();
    this.mat = new MeshBasicMaterial({ map: this.lease.texture, color: slab.cast.colour, transparent: true, opacity: slab.cast.opacity, depthWrite: false, toneMapped: false });
    // Flattened, it can face away from me whichever way it lay: drawn from both sides, in one pass.
    this.mat.side = DoubleSide;
    this.mat.forceSinglePass = true;
    this.mesh = new Mesh(host.kit.geo.contact, this.mat);
    this.mesh.renderOrder = -1;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = () => {
      this.mesh.matrixWorld.multiplyMatrices(flatten(this.flat, this.ground), this.anchor.matrixWorld);
    };
  }
  fade(k: number): void {
    this.mat.opacity = slab.cast.opacity * k;
  }
  dispose(): void {
    this.mat.dispose();
    this.lease.release();
  }
}
