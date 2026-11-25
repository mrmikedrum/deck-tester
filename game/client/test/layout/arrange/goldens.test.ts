/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boards, planTable, tableInputOf, tableTemplate, pinhole } from "../../../src/layout";
import { arrCard } from "../../../src/layout/arrange/card";
import type { ArrCard, ArrangeResult, Arrangement } from "../../../src/layout/arrange/contract";
import { NO_ACTING, NO_RELATIONS } from "../../../src/layout/arrange/contract";
import { PARTED, leafContainer } from "../../../src/layout/arrange/leaf";
import { momentOf } from "../../../src/layout/arrange/moment";
import { readyTapped } from "../../../src/layout/arrange/policies/ready-tapped";
import { policyFor } from "../../../src/layout/arrange/policies/select";
import { works } from "../../../src/layout/arrange/policies/works";
import { arrange } from "../../../src/layout/arrange/solver";
import type { Policy } from "../../../src/layout/arrange/contract";
import type { CardId, SeatId } from "../../../src/layout/types";
import type { TableModel } from "../../../src/model";
import { modelOf } from "../../../src/model";
import { designModels } from "../../../src/scene/workbench/bench-inputs";
import { catalog, corpusNames, corpusSnapshot, viewerOf } from "../../model/fixtures";
import { ME, THEM, ac, many, resetIds, run } from "./cards";

// Goldens (§7.2), printed as slot digests a person can read against the designer's tables: the design pass's three
// opponents at turns 4, 9 and 15, each on the across leaf; the protocol corpus's across leaf as `planTable` shadows it;
// and the hand-written boards. A change to any of them is a change to look at, not to accept blindly.

const VP = { w: 1180, h: 820 };
const tpl = tableTemplate(4);
const proj = pinhole(tpl.camera, VP);
const design = designModels(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../tests/fixtures/boards/design-pass.json"), "utf8")));

const name = (cards: ReadonlyMap<CardId, ArrCard>, id: CardId | null) => (id === null ? "-" : (cards.get(id)?.name ?? `#${id}`));
const r1 = (x: number) => Math.round(x * 10) / 10;

/** An arrangement as text: each unit by row and place, what it shows, its count, posture and turn; then attention. */
export function digest(a: Arrangement, cards: readonly ArrCard[], overflow: ArrangeResult["overflow"]): string {
  const by = new Map(cards.map((c) => [c.id, c]));
  const out = [`policy ${a.policy} · ${a.rows.map((r, i) => `row ${i} ${r.posture} v${r1(r.v)} ${r.places} places`).join(" · ")}`];
  const units = [...a.units].sort((x, y) => x.slot.row - y.slot.row || x.slot.interval - y.slot.interval || (x.cards[0]?.foot.x ?? 0) - (y.cards[0]?.foot.x ?? 0));
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

function onAcross(model: TableModel, seat: SeatId, policy?: Policy) {
  const cards = boards(model).find((b) => b.seat === seat)!.board.cards.map((c) => arrCard(model, c.id)!);
  const clock = { turn: model.turn, phase: model.phase, active: model.active, settling: false };
  const chosen = policy ?? policyFor(cards, null, clock).policy;
  const container = leafContainer({ id: `rest:${seat}`, seat, viewer: model.viewer.perspective, slot: tpl.slots[2]!, projector: proj, safe: { left: 0, top: 0, right: VP.w, bottom: VP.h }, poses: [PARTED] });
  const r = arrange({ container, cards, relations: NO_RELATIONS, acting: NO_ACTING, moment: momentOf(model), policy: chosen, memory: null, clock });
  return { r, cards };
}

describe("the design pass's tables on the across leaf", () => {
  it("turns 4, 9 and 15, each opponent", async () => {
    const parts: string[] = [];
    for (const turn of [4, 9, 15]) {
      const m = design.get(turn)!;
      for (const seat of m.seats.slice(1)) {
        const { r, cards } = onAcross(m, seat.id);
        expect(new Set(r.fit.units.flatMap((u) => [...u.members, ...u.dressing])).size).toBe(cards.length);
        expect(r.overflow, `${seat.id} turn ${turn}`).toBeNull();
        parts.push(`== ${seat.id}, turn ${turn} (${cards.length} permanents)\n${digest(r.fit, cards, r.overflow)}`);
      }
    }
    await expect(parts.join("\n\n") + "\n").toMatchFileSnapshot("__goldens__/design-pass.txt");
  });
});

describe("the protocol corpus: planTable's shadow of the across leaf", () => {
  it("every snapshot with a table plans its across leaf, every card placed, beside mat", async () => {
    const lines: string[] = [];
    let memory = null as Arrangement["memory"] | null;
    for (const n of corpusNames) {
      const snap = corpusSnapshot(n);
      const model = snap.view && modelOf(snap, catalog, viewerOf());
      if (!model || model.seats.length !== 4) continue;
      const plan = planTable(tableInputOf(model, { viewport: VP, mode: "normal", shadow: { memory } }));
      const sh = plan.shadow!;
      expect(sh.error, n).toBeNull();
      const fit = sh.result!.fit;
      memory = fit.memory;
      const held = fit.units.flatMap((u) => [...u.members, ...u.dressing]);
      const placed = new Set([...held, ...(sh.result!.overflow?.reason === "actors" ? sh.result!.overflow.cards : [])]);
      const theirs = boards(model).find((b) => b.seat === sh.seat)!.board.cards.map((c) => c.id);
      expect(placed, n).toEqual(new Set(theirs));
      // mat's plan of the same seat is still there, untouched
      expect(plan.seats.get(sh.seat)!.units.length > 0 || theirs.length === 0).toBe(true);
      const kinds = fit.units.map((u) => `${u.tier[0]}${u.kind[0]}${u.members.length > 1 ? u.members.length : ""}`).join(" ");
      lines.push(`${n}: ${sh.policy} ${theirs.length} → ${fit.units.length} units [${kinds}]${sh.result!.overflow ? ` OVERFLOW ${sh.result!.overflow.reason}` : ""}${fit.report.violations.length ? ` VIOLATIONS ${fit.report.violations.length}` : ""}`);
    }
    expect(lines.length).toBeGreaterThan(10);
    await expect(lines.join("\n") + "\n").toMatchFileSnapshot("__goldens__/corpus.txt");
  });
});

describe("hand-written boards", () => {
  it("each, as a digest", async () => {
    const cases: [string, () => { cards: ArrCard[]; r: ArrangeResult }][] = [];
    const add = (label: string, make: () => ArrCard[], o: Partial<Parameters<typeof run>[0]> = {}) =>
      cases.push([label, () => {
        resetIds(1);
        const cards = make();
        return { cards, r: run({ cards, ...o }) };
      }]);
    add("empty", () => []);
    add("the commander alone", () => [ac({ name: "Marath", commander: true, power: 5 })]);
    add("one creature", () => [ac({ name: "Grizzly Bears", power: 2 })]);
    add("30 identical Elementals with 7 spent", () => [ac({ name: "Marath", commander: true, power: 5 }), ...many(23, { name: "Elemental", token: true, power: 3 }), ...many(7, { name: "Elemental", token: true, power: 3, tapped: true })]);
    const light = () => [ac({ name: "Dack", commander: true, kind: "planeswalker", loyalty: 4 }), ...["Rule of Law", "Trinisphere", "Thorn of Amethyst", "Deafening Silence"].map((n) => ac({ kind: "enchantment", name: n, binds: true })), ...["Cursed Totem", "Defense Grid"].map((n) => ac({ kind: "artifact", name: n })), ...many(4, { name: "Spirit", token: true, power: 1 }), ...many(6, { kind: "rock", name: "Treasure", token: true }), ...many(8, { kind: "land", name: "Plains", basic: true })];
    add("a creature-light board under ready-tapped", light, { policy: readyTapped });
    add("a creature-light board under works", light, { policy: works });
    add("40 lands", () => [...many(25, { kind: "land", name: "Forest", basic: true }), ...many(10, { kind: "land", name: "Forest", basic: true, tapped: true }), ...Array.from({ length: 5 }, (_, i) => ac({ kind: "land", name: `Utility ${i}` }))]);
    add("six attachments on one creature", () => {
      const host = ac({ name: "Voltron", power: 3 });
      return [host, ...Array.from({ length: 6 }, (_, i) => ac({ kind: i % 2 ? "artifact" : "enchantment", name: `Attachment ${i}`, attachedTo: host.id }))];
    });
    add("a legal target inside a stack of 9", () => [ac({ name: "Marath", commander: true, power: 5 }), ...many(9, { name: "Beast", token: true, power: 3 }), ...Array.from({ length: 6 }, (_, i) => ac({ name: `Body ${i}`, power: 2 }))], { acting: { offered: new Set([4 as CardId]), choosing: true } });
    add("a deathtouch creature at the bottom of a rest fan", () => [ac({ name: "Marath", commander: true, power: 5 }), ...Array.from({ length: 12 }, (_, i) => ac({ name: `Bear ${i}`, power: 2 + (i % 2) })), ac({ name: "Typhoid Rats", power: 1, keywords: ["deathtouch"] })]);
    add("a sweep of 25 (the moment lights; nothing moves)", () => Array.from({ length: 25 }, (_, i) => ac({ name: `Soldier ${i % 5}`, power: 1 + (i % 4) })), { moment: { q: "sweep", reaches: Array.from({ length: 25 }, (_, i) => (i + 1) as CardId), caster: ME } });
    add("two attackers acting out of their stack", () => [ac({ name: "Marath", commander: true, power: 5 }), ...many(9, { name: "Beast", token: true, power: 3 })], { acting: { involved: new Set([2 as CardId, 3 as CardId]) } });
    const parts = cases.map(([label, f]) => {
      const { cards, r } = f();
      return `== ${label} (${cards.length} permanents)\n${digest(r.fit, cards, r.overflow)}`;
    });
    await expect(parts.join("\n\n") + "\n").toMatchFileSnapshot("__goldens__/hand-written.txt");
  });
});

void THEM;
