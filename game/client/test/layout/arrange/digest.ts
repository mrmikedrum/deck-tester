// An arrangement as a golden's text (§7.2): each unit by row and place, what it shows, its count, posture and turn; then
// attention, the seat's facts and anything over a limit.
import type { ArrCard, ArrangeResult, Arrangement } from "../../../src/layout/arrange/contract";
import type { CardId } from "../../../src/layout/types";

const name = (cards: ReadonlyMap<CardId, ArrCard>, id: CardId | null) => (id === null ? "-" : (cards.get(id)?.name ?? `#${id}`));
const r1 = (x: number) => Math.round(x * 10) / 10;

export function digest(a: Arrangement, cards: readonly ArrCard[], overflow: ArrangeResult["overflow"]): string {
  const by = new Map(cards.map((c) => [c.id, c]));
  const out = [`policy ${a.policy} · ${a.rows.map((r, i) => `row ${i} ${r.posture}${r.posture === "stand" ? (r.quarter ? " (quarter)" : " (notch)") : ""} v${r1(r.v)} ${r.places} places`).join(" · ")}`];
  // by row on the table (each row's depth from the anchor), then across
  const f = a.frame, along = (p: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }) => (p.x - f.anchor.x) * d.x + (p.y - f.anchor.y) * d.y + (p.z - f.anchor.z) * d.z;
  const rowOf = (u: (typeof a.units)[number]) => {
    const p = u.cards.find((c) => c.card === u.top) ?? u.cards[0];
    const v = p ? along(p.foot, f.away) : 0;
    return a.rows.reduce((best, r, i) => (r.v <= v + 1e-6 ? i : best), 0);
  };
  const acrossOf = (u: (typeof a.units)[number]) => (u.cards[0] ? along(u.cards[0].foot, f.across) : 0);
  const units = [...a.units].sort((x, y) => rowOf(x) - rowOf(y) || acrossOf(x) - acrossOf(y));
  for (const u of units) {
    const top = u.cards.find((p) => p.card === u.top);
    const f = u.facts;
    const facts = f.kind === "well" ? `well ${f.lands} lands ${f.open} open` : f.kind === "fan" ? `fan ${f.count} · ${f.power} power` : f.kind === "stack" ? `×${f.count}` : f.kind === "summary" ? `summary ${f.count}` : "";
    const notable = u.notable.length ? ` · proud ${u.notable.map((n) => `${name(by, n.card)} (${n.cue})`).join(", ")}` : "";
    const flags = [u.acting ? "acting" : "", u.retyped ? "retyped" : "", u.marker ? `die ${u.marker.count}` : ""].filter(Boolean).join(" ");
    out.push(`  ${u.tier.padEnd(6)} ${u.slot.row}.${u.slot.interval}.${u.slot.place} u${r1(top ? top.foot.x : 0)} ${u.kind.padEnd(7)} ${name(by, u.top).padEnd(30)} ${top?.posture ?? "-"}${top && top.turn !== "none" ? ` ${top.turn}` : ""} ${facts}${flags ? ` · ${flags}` : ""}${notable}`);
  }
  for (const t of a.attention) out.push(`  attention ${t.why}: ${t.cards.map((id) => name(by, id)).join(", ")}`);
  if (a.seat) out.push(`  seat ${JSON.stringify(a.seat)}`);
  if (overflow) out.push(`  OVERFLOW ${overflow.reason} ${overflow.cards.length} cards`);
  if (a.report.violations.length) out.push(`  VIOLATIONS ${a.report.violations.map((v) => `${v.rule} ${v.unit} ${r1(v.measured)}`).join("; ")}`);
  const parted = a.report.poses.flatMap((p) => p.violations.map((v) => `${v.rule} ${r1(v.measured)}`));
  if (parted.length) out.push(`  parted: ${parted.join("; ")}`);
  return out.join("\n");
}

