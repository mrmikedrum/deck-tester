// The camera's composed moves: onto a card or a pile (a hit group, where it was last drawn) or onto a seat's page, and
// back to the table. It is never free navigation: the player asks for a subject and the camera frames it, lower and a
// little from the right, so cards show their thickness and their shadows; any tap or Escape brings it back (the app's).
// Pure: the composition from the plan and what was drawn, and the ease between two cameras on the frame's clock.
import type { TablePlan, V3, Viewport } from "../../layout";
import { CH } from "../../layout/seat/geometry";
import { materials } from "../../theme";
import { drawnPage } from "../stage/pick";
import type { DrawnPiece } from "../stage/pick";
import type { ZoomRequest } from "../stage/types";
import type { CameraParams } from "./camera";

const Z = materials.zoom;

const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const lerp = (a: V3, b: V3, k: number): V3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

/** The direction from a subject to the eye: `elevation` over the table, turned `yaw` from straight on toward the right. */
const toEye = (): V3 => {
  const c = Math.cos(Z.elevation);
  return { x: Math.sin(Z.yaw) * c, y: Math.sin(Z.elevation), z: Math.cos(Z.yaw) * c };
};

/** The camera that frames a subject `size` tall (world units) at `at`, filling `fill` of the screen's height. */
function frame(at: V3, size: number, fill: number, viewport: Viewport, near: number, far: number): CameraParams {
  const half = (Z.fov * Math.PI) / 360;
  const dist = size / fill / (2 * Math.tan(half));
  return { position: add(at, scale(toEye(), dist)), target: at, fov: Z.fov, aspect: viewport.w / viewport.h, near, far };
}

/**
 * The camera for a request, or null when its subject is not on the table: a group framed where it was last drawn (its
 * middle, at its size), a seat's page framed whole.
 */
export function composeZoom(req: ZoomRequest, plan: TablePlan, drawn: ReadonlyMap<string, DrawnPiece>, viewport: Viewport, clip: { near: number; far: number }): CameraParams | null {
  if ("group" in req) {
    const d = drawn.get(req.group);
    if (!d) return null;
    const s = d.now;
    return frame({ x: s.pos.x, y: s.pos.y + s.lift, z: s.pos.z }, CH * Math.max(0.3, s.s), Z.fill, viewport, Math.min(clip.near, 0.1), clip.far);
  }
  // The page as drawn (a lean-in raises it and turns it toward me).
  const page = drawnPage(plan, drawn, req.seat);
  if (!page) return null;
  // The page seen from the zoom's angle: its depth foreshortened, its width by the screen's shape.
  const tall = Math.max(page.d * Math.sin(Z.elevation), (page.w * viewport.h) / viewport.w);
  return frame(page.pos, tall, Z.seatFill, viewport, Math.min(clip.near, 0.1), clip.far);
}

/** A camera between two, `k` of the way. */
export function between(a: CameraParams, b: CameraParams, k: number): CameraParams {
  return { position: lerp(a.position, b.position, k), target: lerp(a.target, b.target, k), fov: a.fov + (b.fov - a.fov) * k, aspect: b.aspect, near: Math.min(a.near, b.near), far: b.far };
}

const ease = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/**
 * The camera's move between the table's camera and a zoom, on the frame's clock: `set` the camera wanted (null: the
 * table's), `at` the camera to draw now. A new subject sets off from where the camera is; reduced motion cuts.
 */
export class CameraMove {
  private from: CameraParams | null = null;
  private to: CameraParams | null = null;
  private t0 = 0;
  private ms: number = Z.ms;
  /** The subject asked for last (a key): the same subject drawn again keeps its move. */
  private key = "";
  private last: CameraParams | null = null;

  /** Ask for `want` (null: back to `table`), keyed by its subject, at `now`. */
  set(want: CameraParams | null, key: string, table: CameraParams, now: number, ms: number = Z.ms): void {
    if (key === this.key) {
      // The same subject: follow it if it moved (a reflow), without restarting the ease.
      if (want) this.to = want;
      return;
    }
    this.from = this.last ?? table;
    this.to = want;
    this.t0 = now;
    this.ms = ms;
    this.key = key;
  }

  /** The camera to draw at `now` (null: the table's own, nothing moving or zoomed). */
  at(now: number, table: CameraParams, still: boolean): CameraParams | null {
    const target = this.to ?? table;
    const k = still || !this.from ? 1 : Math.min(1, Math.max(0, (now - this.t0) / this.ms));
    const cam = k >= 1 ? target : between(this.from ?? table, target, ease(k));
    this.last = this.to || k < 1 ? cam : null;
    return this.last;
  }

  /** Still easing toward its subject (or back) at `now`. */
  moving(now: number, still: boolean): boolean {
    return !still && this.from !== null && now - this.t0 < this.ms;
  }

  /** Zoomed in, or on its way in or out. */
  get active(): boolean {
    return this.last !== null;
  }
}
