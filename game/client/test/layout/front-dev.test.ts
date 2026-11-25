// Dev harness (not a gate): plans the recorder's clips with the leaves and prints what the audit says. CLIPS=<json>.
import { readFileSync } from "node:fs";
import { it } from "vitest";
import { auditSeat, front, pinhole, planTable, reservations, tableInputOf, tableTemplate } from "../../src/layout";
import type { LayoutMemory, SeatId } from "../../src/layout";
import { decodeCatalog, modelOf, playerViewer } from "../../src/model";
import { decodeSnapshot } from "../../src/protocol";

const file = process.env["CLIPS"];
it.skipIf(!file)("dev: the clips on leaves", () => {
  const all = JSON.parse(readFileSync(file!, "utf8")) as Record<string, { envs: unknown[]; catalog: unknown }>;
  const only = (process.env["ONLY"] ?? "game").split(",");
  for (const name of only) {
    const c = all[name]!;
    const cat = decodeCatalog(c.catalog);
    let memory: ReadonlyMap<SeatId, LayoutMemory> | null = null;
    c.envs.forEach((e, i) => {
      const r = decodeSnapshot(e);
      if (!r.ok) throw new Error("decode");
      const model = modelOf(r.value, cat, playerViewer(r.value)!)!;
      const plan = planTable({ ...tableInputOf(model, { viewport: { w: 1180, h: 820 }, memory }), paradigm: (process.env["PARADIGM"] ?? "front") as "front" | "mat" });
      if (process.env["AUDIT"]) {
        const tpl = tableTemplate(4, "landscape", "front"), vp = { w: 1180, h: 820 }, projector = pinhole(tpl.camera, vp), reserve = reservations(vp);
        const ti = tableInputOf(model, { viewport: vp, memory });
        ti.seats.forEach(({ seat, board }, k) => {
          if (k === 0) return;
          const inp = { seat, board, region: { ...tpl.slots[k]!, lift: 0 }, projector, reserve, viewport: vp, involved: ti.involved, settling: false, memory: memory?.get(seat) ?? null };
          const sp = front.plan({ ...inp, pressure: 0 });
          console.log(`  audit ${seat}:`, auditSeat(sp, inp).map((v) => `${v.rule} ${v.group} ${v.measured.toFixed(2)}/${v.limit}`).join("; "));
        });
      }
      memory = plan.memory;
      console.log(`== ${name} ${i} turn ${model.turn}: ${plan.violations.length} violations`, plan.violations.slice(0, 8));
      for (const [seat, sp] of plan.seats) {
        console.log(`  ${seat} lastResort=${sp.report.lastResort} p=${sp.report.pressure}`, sp.units.map((u) => `${u.id}:${u.kind}/${u.placement.posture}x${u.members.length}@${u.placement.scale.toFixed(2)}${u.title ? `"${u.title}"` : ""}`).join(" "));
      }
    });
  }
});
