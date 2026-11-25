import { it } from "vitest";
import { auditSeat, tableInputOf } from "../../../src/layout";
import { pinhole } from "../../../src/layout/projector";
import { reservations } from "../../../src/layout/reservations";
import { tableTemplate } from "../../../src/layout/template";
import { told } from "../../../src/layout/seat/told";
import { seatShapes, bounds } from "../../../src/layout/shape";
import { gameAt } from "./clip";
it("probe", () => {
  const vp = { w: 1180, h: 820 }, tpl = tableTemplate(4), projector = pinhole(tpl.camera, vp), reserve = reservations(vp, "normal");
  const m = gameAt(15), ti = tableInputOf(m, { viewport: vp, ask: null }), i = 2;
  const { seat, board } = ti.seats[i]!;
  const input = { seat, board, region: { ...tpl.slots[i]!, lift: 0 }, projector, reserve, viewport: vp, involved: ti.involved, settling: false, memory: null };
  const sp = told.plan({ ...input, pressure: 0 });
  console.log(JSON.stringify(auditSeat(sp, input)));
  for (const s of seatShapes(projector, sp, false)) { const b = bounds(s.face); console.log(s.group, Math.round(b.l), Math.round(b.t), Math.round(b.r), Math.round(b.b), s.order.toFixed(2)); }
  console.log(JSON.stringify(sp.fixtures.heading));
});
