// The stage's view in three.js: piece objects created, patched or swapped by piece id and form (a new form rebuilds,
// new mods patch in place), every one posed from the stage's sample each frame; flying cards, lanes and the stack's
// arcs likewise, and every effect ticked on the frame's clock. It decides nothing: where things are and how they look
// is the stage's.
import { Box3, Group, Raycaster, Vector2, Vector3 } from "three";
import type { Camera, Material, Mesh, Object3D } from "three";
import type { PieceKind, StageView } from "../stage/types";
import { Arc, FxKit, Ribbon, strikeFx } from "./fx";
import type { Effect } from "./fx";
import type { Host } from "./host";
import { COVERS, GhostPiece, artWanted, createPiece, placeGroup } from "./pieces";
import type { Clock, PieceEnv, PieceView } from "./pieces";

/** An object's place on screen (CSS px): its bounding box, and for a page the quad of its outline. */
export interface ScreenBox {
  readonly id: string;
  readonly kind: PieceKind | "ghost";
  readonly visible: boolean;
  readonly box: readonly [number, number, number, number];
  readonly quad?: readonly (readonly [number, number])[];
}

/**
 * A card face as it was last drawn, for the layout audit (CSS px): its quad (foot-left, foot-right, top-right, top-left
 * of the card's own face, however it is turned), its width on screen (the mean of its foot and top edges), and, for a
 * stack card, whether it stands up as the table's focus.
 */
export interface DrawnFace {
  readonly kind: PieceKind | "ghost";
  readonly visible: boolean;
  readonly quad: readonly (readonly [number, number])[];
  readonly width: number;
  readonly up: boolean;
}

/** A seed from an id: the same lane or arc draws the same particles. */
const hash = (id: string): number => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 17);

interface Entry {
  readonly kind: PieceKind;
  readonly form: string;
  mods: string;
  readonly view: PieceView | null;
  /** A stack card standing up as the table's focus (the audit sets it aside). */
  up: boolean;
}

export class StageRenderer {
  private readonly root = new Group();
  private readonly pieces = new Map<string, Entry>();
  private readonly ghosts = new Map<string, GhostPiece>();
  private readonly lanes = new Map<string, Ribbon>();
  private readonly bolts = new Map<string, Arc>();
  /** Plates' bursts, each riding its plate's object while it lasts. */
  private readonly strikes = new Map<string, Effect>();
  private readonly laneGroup = new Group();
  private readonly arcs = new Map<string, Arc>();
  private readonly arcGroup = new Group();
  private kit: FxKit | null = null;
  /** Art that arrived since the last draw: the pieces whose faces want it repaint (a flying card repaints every frame). */
  private arrived = new Set<string>();

  constructor(
    private readonly host: Host,
    private readonly pitch: () => number,
  ) {
    host.scene.add(this.root, this.laneGroup, this.arcGroup);
  }

  /** The effects' sprites, leased from the host's painter (again after a rebuilt context). */
  private get fx(): FxKit {
    this.kit ??= new FxKit(
      (k) => this.host.painter.fx(k),
      () => this.host.renderer.getPixelRatio(),
    );
    return this.kit;
  }

  private env(): PieceEnv {
    return { host: this.host, fx: this.fx, pitch: this.pitch() };
  }

  /** Art arrived for `url`: the faces waiting for it repaint on the next draw, and nothing else does. */
  artArrived(url: string): void {
    this.arrived.add(url);
  }

  draw(view: StageView): void {
    const clock: Clock = { t: view.now / 1000, still: view.still };
    const seen = new Set<string>();
    for (const v of view.actors) {
      seen.add(v.id);
      let e = this.pieces.get(v.id);
      if (e && e.form !== v.form) {
        this.drop(v.id, e);
        e = undefined;
      }
      if (!e) {
        const pv = createPiece(this.env(), v);
        e = { kind: v.kind, form: v.form, mods: v.mods, view: pv, up: false };
        if (pv) this.root.add(pv.group);
        this.pieces.set(v.id, e);
      } else if (e.mods !== v.mods || (this.arrived.size > 0 && artWanted(v).some((u) => this.arrived.has(u)))) {
        e.view?.patch(v);
        e.mods = v.mods;
      }
      e.up = v.draw.t === "stack" && v.draw.up;
      if (!e.view) continue;
      placeGroup(e.view.group, v.sample);
      e.view.group.visible = v.visible;
      e.view.look(v, clock);
    }
    for (const [id, e] of [...this.pieces]) if (!seen.has(id)) this.drop(id, e);

    const flying = new Set<string>();
    for (const g of view.ghosts) {
      flying.add(g.id);
      let p = this.ghosts.get(g.id);
      if (!p) {
        p = new GhostPiece(this.host, g);
        this.ghosts.set(g.id, p);
        this.root.add(p.group);
      }
      p.update(g);
    }
    for (const [id, p] of [...this.ghosts])
      if (!flying.has(id)) {
        this.root.remove(p.group);
        p.dispose();
        this.ghosts.delete(id);
      }
    // The lanes and bolts of a combat: each kept by id while it lasts, its points moved with its pieces.
    const laned = new Set<string>();
    for (const l of view.lanes) {
      laned.add(l.id);
      const spec = { points: l.points, colour: l.colour };
      let r = this.lanes.get(l.id);
      if (!r) {
        r = new Ribbon(this.fx, spec, hash(l.id));
        this.lanes.set(l.id, r);
        this.laneGroup.add(r.object);
      } else r.set(spec);
      r.tick(clock.t, 1, clock.still);
    }
    for (const [id, r] of [...this.lanes]) if (!laned.has(id)) this.dropLane(id, r);
    const struck = new Set<string>();
    for (const b of view.bolts) {
      struck.add(b.id);
      const spec = { points: b.points, colours: b.colours, faint: false, flare: true, source: true, width: 0.05, jitter: 0.1 };
      let arc = this.bolts.get(b.id);
      if (!arc) {
        arc = new Arc(this.fx, spec, hash(b.id));
        this.bolts.set(b.id, arc);
        this.laneGroup.add(arc.object);
      } else arc.set(spec);
      // Out before the row has closed: full, then gone over its last fifth.
      arc.tick(clock.t, b.k < 0.8 ? 1 : Math.max(0, (1 - b.k) / 0.2), clock.still);
    }
    for (const [id, arc] of [...this.bolts])
      if (!struck.has(id)) {
        this.laneGroup.remove(arc.object);
        arc.dispose();
        this.bolts.delete(id);
      }
    // A struck plate: its burst rides the plate (made again with it if the plate is rebuilt), timed by the frame's clock.
    const hit = new Set<string>();
    for (const x of view.strikes) {
      const plate = this.pieces.get(x.plate)?.view?.group;
      if (!plate) continue;
      hit.add(x.id);
      let fx = this.strikes.get(x.id);
      if (!fx) {
        fx = strikeFx(this.fx, x.seed, x.t0 / 1000);
        this.strikes.set(x.id, fx);
      }
      if (fx.object.parent !== plate) plate.add(fx.object);
      fx.tick(clock.t, 1, clock.still);
    }
    for (const [id, fx] of [...this.strikes]) if (!hit.has(id)) this.dropStrike(id, fx);
    const aimed = new Set<string>();
    for (const a of view.aims) {
      aimed.add(a.id);
      const spec = { points: a.points, colours: a.colours, faint: a.faint, flare: a.flare };
      let arc = this.arcs.get(a.id);
      if (!arc) {
        arc = new Arc(this.fx, spec, hash(a.id));
        this.arcs.set(a.id, arc);
        this.arcGroup.add(arc.object);
      } else arc.set(spec);
      arc.tick(clock.t, 1, clock.still);
    }
    for (const [id, arc] of [...this.arcs]) if (!aimed.has(id)) this.dropArc(id, arc);
    this.host.setTableTone(view.tableTone);
    this.arrived.clear();
  }

  private dropLane(id: string, r: Ribbon): void {
    this.laneGroup.remove(r.object);
    r.dispose();
    this.lanes.delete(id);
  }

  private dropStrike(id: string, fx: Effect): void {
    fx.object.removeFromParent();
    fx.dispose();
    this.strikes.delete(id);
  }

  private dropArc(id: string, arc: Arc): void {
    this.arcGroup.remove(arc.object);
    arc.dispose();
    this.arcs.delete(id);
  }

  private drop(id: string, e: Entry): void {
    if (e.view) {
      this.root.remove(e.view.group);
      e.view.dispose();
    }
    this.pieces.delete(id);
  }

  /** Let go of every object (a rebuilt context, a fault): the next draw builds them again. */
  clear(): void {
    for (const [id, e] of [...this.pieces]) this.drop(id, e);
    for (const p of this.ghosts.values()) {
      this.root.remove(p.group);
      p.dispose();
    }
    this.ghosts.clear();
    for (const [id, r] of [...this.lanes]) this.dropLane(id, r);
    for (const [id, arc] of [...this.bolts]) {
      this.laneGroup.remove(arc.object);
      arc.dispose();
      this.bolts.delete(id);
    }
    for (const [id, arc] of [...this.arcs]) this.dropArc(id, arc);
    for (const [id, fx] of [...this.strikes]) this.dropStrike(id, fx);
    this.kit?.dispose();
    this.kit = null;
  }

  /** Where every object it holds is on screen, for a viewport of `w` x `h` (the recorder's track; not per frame in the app). */
  screen(camera: Camera, w: number, h: number): ScreenBox[] {
    const v = new Vector3();
    const at = (x: number, y: number, z: number): [number, number] => {
      v.set(x, y, z).project(camera);
      return [Math.round(((v.x + 1) / 2) * w * 10) / 10, Math.round(((1 - v.y) / 2) * h * 10) / 10];
    };
    const one = (id: string, kind: ScreenBox["kind"], o: Object3D): ScreenBox | null => {
      o.updateWorldMatrix(true, true);
      const b = new Box3().setFromObject(o);
      if (b.isEmpty()) return null;
      const pts: [number, number][] = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(at(x, y, z));
      const xs = pts.map((p) => p[0]),
        ys = pts.map((p) => p[1]);
      let visible = true;
      for (let q: Object3D | null = o; q; q = q.parent) if (!q.visible) visible = false;
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
      if (kind !== "page") return { id, kind, visible, box };
      const y = (b.min.y + b.max.y) / 2;
      return { id, kind, visible, box, quad: [at(b.min.x, y, b.min.z), at(b.max.x, y, b.min.z), at(b.max.x, y, b.max.z), at(b.min.x, y, b.max.z)] };
    };
    const out: ScreenBox[] = [];
    for (const [id, e] of this.pieces) {
      const s = e.view ? one(id, e.kind, e.view.group) : null;
      if (s) out.push(s);
    }
    for (const [id, g] of this.ghosts) {
      const s = one(id, "ghost", g.group);
      if (s) out.push(s);
    }
    return out;
  }

  /** Every card face it holds as last drawn, by piece id (the layout audit's measures; not per frame in the app). */
  measure(camera: Camera, w: number, h: number): Record<string, DrawnFace> {
    const v = new Vector3();
    const at = (x: number, y: number, z: number, m: Object3D): [number, number] => {
      v.set(x, y, z).applyMatrix4(m.matrixWorld).project(camera);
      return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
    };
    const out: Record<string, DrawnFace> = {};
    const one = (id: string, kind: DrawnFace["kind"], group: Object3D, front: Mesh | null | undefined, up: boolean): void => {
      if (!front) return;
      group.updateWorldMatrix(true, true);
      const g = front.geometry;
      g.computeBoundingBox();
      const b = g.boundingBox!, z = (b.min.z + b.max.z) / 2;
      const quad = [at(b.min.x, b.min.y, z, front), at(b.max.x, b.min.y, z, front), at(b.max.x, b.max.y, z, front), at(b.min.x, b.max.y, z, front)];
      const len = (p: readonly number[], q: readonly number[]): number => Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!);
      let visible = true;
      for (let o: Object3D | null = front; o; o = o.parent) if (!o.visible) visible = false;
      out[id] = { kind, visible, quad, width: (len(quad[0]!, quad[1]!) + len(quad[3]!, quad[2]!)) / 2, up };
    };
    for (const [id, e] of this.pieces) if (e.view) one(id, e.kind, e.view.group, e.view.front?.(), e.up);
    for (const [id, g] of this.ghosts) one(id, "ghost", g.group, g.front(), false);
    return out;
  }

  /**
   * The piece drawn on top at (x, y) CSS px, by id, or null (the table, a page or an effect): the first card, edge or
   * label a ray from the eye meets, where what is drawn without a depth test (the plates) is over what is drawn before
   * it. Pieces in `skip` are looked through (a focus set aside). The layout audit's cover; not per frame in the app.
   */
  under(camera: Camera, x: number, y: number, w: number, h: number, skip: ReadonlySet<string> = new Set()): string | null {
    const owner = new Map<Object3D, string>();
    for (const [id, e] of this.pieces) if (e.view) owner.set(e.view.group, id);
    for (const [id, g] of this.ghosts) owner.set(g.group, id);
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), camera);
    this.root.updateWorldMatrix(true, true);
    let near: { id: string; order: number } | null = null, flat: { id: string; order: number } | null = null;
    for (const hit of ray.intersectObject(this.root, true)) {
      const m = hit.object as Mesh;
      if (!m.isMesh || !m.userData[COVERS]) continue;
      const mat = ([] as Material[]).concat(m.material)[0];
      if (!mat || (mat.transparent && mat.opacity < 0.1)) continue;
      let shown = true, id: string | undefined;
      for (let o: Object3D | null = m; o; o = o.parent) {
        if (!o.visible) shown = false;
        id ??= owner.get(o);
      }
      if (!shown || id === undefined || skip.has(id)) continue;
      const it = { id, order: m.renderOrder };
      if (mat.depthTest === false) {
        if (!flat || it.order > flat.order) flat = it;
      } else near ??= it;
    }
    // A plate writes no depth and draws late: over what is drawn before it, under what is drawn after.
    if (flat && near) return near.order > flat.order ? near.id : flat.id;
    return (flat ?? near)?.id ?? null;
  }

  /** How many objects it holds (the workbench and tests read it). */
  counts(): { pieces: number; ghosts: number } {
    return { pieces: this.pieces.size, ghosts: this.ghosts.size };
  }

  dispose(): void {
    this.clear();
    this.host.scene.remove(this.root, this.laneGroup, this.arcGroup);
  }
}
