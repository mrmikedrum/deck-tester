// Dice count copies, and nothing else: a block of identical cards has dice on the vellum at its foot saying how many it
// holds. 2 to 6 is one d6 (pips), 7 to 20 one d20 (a numeral), more is d10s side by side, one per digit. Bone with dark
// ink, a little yaw each, never on a card. A die tumbles to its new face when the count changes (not under reduced
// motion).
import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import type { BufferGeometry, Material } from "three";
import type { Host } from "./host";
import type { Lease } from "./textures";

/** The dice a count takes: each its kind and the face it shows. */
export function diceFor(n: number): { kind: "d6" | "d20" | "d10"; face: number }[] {
  if (n < 2) return [];
  if (n <= 6) return [{ kind: "d6", face: n }];
  if (n <= 20) return [{ kind: "d20", face: n }];
  return [...String(n)].map((d) => ({ kind: "d10" as const, face: Number(d) }));
}

/** A die's size, world units (a card is 1 tall), and how far apart dice sit. */
const DIE = { s: 0.24, gap: 1.12, tumble: 0.35, hop: 0.12 } as const;
const BONE = 0xe9dcc0;

/** The faces a d6 shows on its sides, given its top (opposite faces sum to 7). */
const SIDES: Readonly<Record<number, readonly number[]>> = { 1: [3, 4, 2, 5], 2: [1, 6, 3, 4], 3: [1, 6, 2, 5], 4: [1, 6, 2, 5], 5: [1, 6, 3, 4], 6: [3, 4, 2, 5] };

class Die {
  readonly group = new Group();
  private readonly leases: Lease[] = [];
  private readonly own: { dispose(): void }[] = [];
  constructor(host: Host, kind: "d6" | "d20" | "d10", face: number, yaw: number) {
    const s = DIE.s;
    const lease = (pips: boolean, n: number): Lease => {
      const l = host.painter.dieFace(pips, n);
      this.leases.push(l);
      return l;
    };
    const lit = (map: Lease | null): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ color: map ? 0xffffff : BONE, roughness: 0.55, ...(map ? { map: map.texture } : {}) });
      this.own.push(m);
      return m;
    };
    const keep = <G extends BufferGeometry>(g: G): G => (this.own.push(g), g);
    let body: Mesh;
    if (kind === "d6") {
      const [a, b, c, d] = SIDES[face] ?? [1, 2, 3, 4];
      // BoxGeometry's faces: +x, -x, +y (top), -y, +z (toward me), -z.
      body = new Mesh(keep(new BoxGeometry(s, s, s)), [lit(lease(true, a!)), lit(lease(true, b!)), lit(lease(true, face)), lit(null), lit(lease(true, c!)), lit(lease(true, d!))]);
      body.position.y = s / 2;
    } else {
      const r = kind === "d20" ? s * 0.78 : s * 0.62;
      const geo = kind === "d20" ? keep(new IcosahedronGeometry(r, 0)) : keep(new CylinderGeometry(r * 0.62, r, r * 1.15, 10));
      const m = lit(null);
      m.flatShading = true;
      body = new Mesh(geo, m);
      body.position.y = kind === "d20" ? r * 0.8 : r * 0.58;
      // Its numeral on a facet facing up.
      const top = new Mesh(keep(new CircleGeometry(r * (kind === "d20" ? 0.66 : 0.6), 24)), new MeshBasicMaterial({ map: lease(false, face).texture, toneMapped: false }));
      this.own.push(top.material as Material);
      top.rotation.x = -Math.PI / 2;
      // (On a d20 it sits just over the top, where the facets meet, so it reads from across the table.)
      top.position.y = body.position.y + (kind === "d20" ? r * 0.96 : r * 0.58) + 0.002;
      this.group.add(top);
    }
    body.castShadow = true;
    this.group.add(body);
    this.group.rotation.y = yaw;
  }
  dispose(): void {
    for (const l of this.leases) l.release();
    for (const o of this.own) o.dispose();
  }
}

/** A row of dice for a count, at its group's origin, growing to the right. */
export class Dice {
  readonly group = new Group();
  private dice: Die[] = [];
  private n = 0;
  private changedAt: number | null = null;
  private pending = false;
  constructor(
    private readonly host: Host,
    private readonly seed: number,
  ) {}
  /** Show `n` copies (under 2: no dice). */
  set(n: number): void {
    if (n === this.n) return;
    if (this.n >= 2 && n >= 2) this.pending = true;
    this.n = n;
    for (const d of this.dice) {
      this.group.remove(d.group);
      d.dispose();
    }
    this.dice = diceFor(n).map((x, i) => {
      // A little yaw each, seeded by the pile, so dice are never perfectly square.
      const yaw = (((this.seed * 7919 + i * 104729) % 1000) / 1000 - 0.5) * 0.5;
      const die = new Die(this.host, x.kind, x.face, yaw);
      die.group.position.x = i * DIE.s * DIE.gap;
      this.group.add(die.group);
      return die;
    });
  }
  /** Every frame: a die whose count changed tumbles to its new face (hops and turns once), unless motion is reduced. */
  tick(t: number, still: boolean): void {
    if (this.pending) {
      this.pending = false;
      this.changedAt = t;
    }
    const k = this.changedAt === null || still ? 1 : Math.min(1, (t - this.changedAt) / DIE.tumble);
    const hop = Math.sin(Math.PI * k) * DIE.hop;
    for (const d of this.dice) {
      const body = d.group.children[d.group.children.length - 1]!;
      body.rotation.x = (1 - k) * Math.PI * 1.5;
      d.group.position.y = hop;
    }
    if (k >= 1) this.changedAt = null;
  }
  get moving(): boolean {
    return this.changedAt !== null;
  }
  dispose(): void {
    for (const d of this.dice) d.dispose();
  }
}

/** Where dice sit at a pile's foot (in its ground's frame: +x right, +z toward me), at its right-hand corner. */
export const DICE_AT = { x: 0.36 - DIE.s * 0.05, z: DIE.s * 1.05 } as const;
