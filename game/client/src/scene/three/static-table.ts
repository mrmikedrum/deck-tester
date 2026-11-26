// A static table drawn by the host from layout's plan: each seat's page, plate and every unit's top card, posed as
// layout says (posture, scale, tap), with the title signs of folded piles. No animation, no game logic: this is the
// check that painters, materials, camera and layout agree. The stage will replace it.
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import type { BufferGeometry, Material } from "three";
import type { SeatId, SeatPlan, TablePlan, Unit } from "../../layout";
import type { FaceSpec, PlateSpec, SeatPlace } from "../../theme";
import { createCard } from "./cards";
import type { CardObject } from "./cards";
import type { Host } from "./host";
import { buildPage, buildPlate } from "./pieces";
import { PAGE_Y, unitPose } from "../stage/poses";
import type { Lease } from "./textures";


/** What the static table needs to draw a plan: the face of a unit's top card, and each seat's plate and place. */
export interface StaticTableInput {
  /** The plan to draw (the caller plans, at `host.size`). */
  plan(): TablePlan;
  face(unit: Unit, seat: SeatId): FaceSpec | null;
  token(unit: Unit): boolean;
  plate(seat: SeatId): PlateSpec;
  place(seat: SeatId): SeatPlace;
  mine(seat: SeatId): boolean;
}

export class StaticTable {
  private group: Group | null = null;
  private leases: Lease[] = [];
  private disposables: { dispose(): void }[] = [];
  plan: TablePlan | null = null;

  constructor(
    private readonly host: Host,
    private readonly input: StaticTableInput,
  ) {}

  /** Rebuild from the fixture (also what a restored context asks for). */
  build(): void {
    this.clear();
    const { host } = this;
    const plan = this.input.plan();
    this.plan = plan;
    const group = new Group();
    for (const [seat, sp] of plan.seats) this.seat(group, sp, this.input.place(seat), this.input.mine(seat), plan);
    host.scene.add(group);
    this.group = group;
  }

  clear(): void {
    if (this.group) this.host.scene.remove(this.group);
    this.group = null;
    for (const l of this.leases) l.release();
    for (const d of this.disposables) d.dispose();
    this.leases = [];
    this.disposables = [];
  }

  private lease(l: Lease): Lease {
    this.leases.push(l);
    return l;
  }
  private own<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private seat(root: Group, sp: SeatPlan, place: SeatPlace, mine: boolean, plan: TablePlan): void {
    const { page } = sp.fixtures;
    const seed = 7 + sp.seat.length * 131 + sp.seat.charCodeAt(0);
    const parts = this.own(buildPage(this.host, page.w, page.d, place, mine, seed));
    parts.group.position.set(page.pos.x, PAGE_Y, page.pos.z);
    parts.group.rotation.y = page.yaw;
    root.add(parts.group);
    for (const u of sp.units) this.unit(root, u, sp.seat, plan);
    this.plate(root, sp, plan);
  }

  private plate(root: Group, sp: SeatPlan, plan: TablePlan): void {
    const { plate } = sp.fixtures;
    const built = this.own(buildPlate(this.host.painter.plate(this.input.plate(sp.seat)), plan.projector.pitch));
    built.outer.position.set(plate.pos.x, plate.pos.y + 0.02, plate.pos.z);
    built.outer.scale.setScalar(plate.scale);
    root.add(built.outer);
  }

  private unit(root: Group, u: Unit, seat: SeatId, plan: TablePlan): void {
    const spec = this.input.face(u, seat);
    if (!spec) return;
    const { host } = this,
      kit = host.kit,
      p = u.placement,
      face = this.lease(host.painter.face(spec));
    const c: CardObject = createCard(kit, face, { tapped: u.tapped, token: this.input.token(u) });
    this.own(c);
    const pose = unitPose(plan.projector, p, u.tapped);
    c.group.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    c.group.rotation.x = pose.rx;
    c.group.scale.setScalar(pose.s);
    if (u.title) {
      const sign = this.lease(host.painter.sign({ text: u.title, colour: null, sub: null }));
      const sg = this.own(new PlaneGeometry(sign.width * 0.00375, sign.height * 0.00375));
      const sm = this.own(new MeshBasicMaterial({ map: sign.texture, transparent: true, depthWrite: false }));
      const mesh = new Mesh(sg as BufferGeometry, sm as Material);
      mesh.renderOrder = 5;
      mesh.position.set(0, 0.5 + 0.1, 0.03);
      c.group.add(mesh);
    }
    root.add(c.group);
  }
}
