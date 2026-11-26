// The camera's composed moves: a zoom frames its subject where it was last drawn, from lower and a little to the
// right, and the move eases in and back on the frame's clock (reduced motion cuts).
import { describe, expect, it } from "vitest";
import { CameraMove, between, composeZoom } from "../../src/scene/three/zoom";
import { cameraParams } from "../../src/scene/three/camera";
import { materials } from "../../src/theme";
import { tableTemplate } from "../../src/layout";
import { NO_FOCUS, Stage, seatOnTable } from "../../src/scene/stage";
import { corpusSteps, frameOf } from "./corpus";

const board = corpusSteps().flat().find((s) => s.name.startsWith("023"))!;
const VP = board.plan.viewport;
const Z = materials.zoom;

function drawn() {
  const stage = new Stage();
  stage.show(frameOf(board, [board.set], { mode: "cut" }), 16);
  return stage.show(frameOf(board, [], { focus: NO_FOCUS }), 32).view.drawn;
}

describe("composing a zoom", () => {
  it("aims at a card where it was drawn, from nearer, lower and to the right of the table's camera", () => {
    const d = drawn();
    const [id, piece] = [...d].find(([, p]) => p.pickable)!;
    const cam = composeZoom({ group: id }, board.plan, d, VP, materials.camera)!;
    expect(cam.target.x).toBeCloseTo(piece.now.pos.x, 6);
    expect(cam.target.z).toBeCloseTo(piece.now.pos.z, 6);
    expect(cam.fov).toBe(Z.fov);
    const table = cameraParams(tableTemplate(4).camera, VP);
    const dist = Math.hypot(cam.position.x - cam.target.x, cam.position.y - cam.target.y, cam.position.z - cam.target.z);
    const tableDist = Math.hypot(table.position.x - cam.target.x, table.position.y - cam.target.y, table.position.z - cam.target.z);
    expect(dist).toBeLessThan(tableDist);
    expect(cam.position.x).toBeGreaterThan(cam.target.x); // from the right
    const el = Math.asin((cam.position.y - cam.target.y) / dist);
    expect(el).toBeCloseTo(Z.elevation, 6);
  });

  it("frames a seat's page whole, and nothing for what is not on the table", () => {
    const d = drawn();
    const seat = [...board.plan.seats.keys()][0]!;
    expect(composeZoom({ seat }, board.plan, d, VP, materials.camera)).not.toBeNull();
    expect(composeZoom({ group: "no such group" }, board.plan, d, VP, materials.camera)).toBeNull();
  });
});

describe("the camera's move", () => {
  const table = cameraParams(tableTemplate(4).camera, VP);
  const close = { ...table, position: { x: 2, y: 3, z: 4 }, target: { x: 1, y: 0, z: 1 }, fov: 30 };

  it("eases in over the theme's time, and back to the table's own camera", () => {
    const m = new CameraMove();
    m.set(close, "g:x", table, 1000);
    expect(m.at(1000, table, false)).toEqual(between(table, close, 0));
    expect(m.moving(1000 + Z.ms / 2, false)).toBe(true);
    expect(m.at(1000 + Z.ms, table, false)).toEqual(close);
    expect(m.active).toBe(true);
    m.set(null, "", table, 3000);
    expect(m.at(3000 + Z.ms / 2, table, false)!.fov).toBeGreaterThan(close.fov);
    expect(m.at(3000 + Z.ms, table, false)).toBeNull();
    expect(m.active).toBe(false);
  });

  it("under reduced motion it cuts", () => {
    const m = new CameraMove();
    m.set(close, "g:x", table, 0);
    expect(m.at(0, table, true)).toEqual(close);
    expect(m.moving(1, true)).toBe(false);
  });
});

describe("a long press on a seat's page", () => {
  it("finds the seat whose page lies under it, and none off every page", () => {
    for (const [seat, sp] of board.plan.seats) {
      const pg = sp.fixtures.page;
      const at = board.plan.projector.project(pg.pos);
      expect(seatOnTable(board.plan, board.plan.projector.onTable(at.x, at.y, 0))).toBe(seat);
    }
    expect(seatOnTable(board.plan, { x: 1000, y: 0, z: 1000 })).toBeNull();
  });
});
