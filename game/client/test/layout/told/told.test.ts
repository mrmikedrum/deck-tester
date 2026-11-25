// The told table (spec "Told, not shown"): pages open while small, written once they outgrow eight places; the front row
// by importance; every account lettered at its floor; and the answers a moment writes in red.
import { describe, expect, it } from "vitest";
import { planTable, tableInputOf, told } from "../../../src/layout";
import type { TableInput, TablePlan } from "../../../src/layout";
import { attackSlip } from "../../../src/layout/told/answers";
import { boardOf } from "../../../src/layout/board";
import { askOf } from "../../../src/app/plan";
import { seatId } from "../../../src/model";
import type { TableModel } from "../../../src/model";
import { decodeSnapshot } from "../../../src/protocol";
import { clipEnvelope, clipModel, gameAt } from "./clip";

const VPS = [
  { w: 1180, h: 820 },
  { w: 1024, h: 768 },
  { w: 1366, h: 1024 },
];
const plan = (m: TableModel, vp = VPS[0]!, more: Partial<TableInput> = {}): TablePlan => planTable({ ...tableInputOf(m, { viewport: vp, ask: null }), layout: told, ...more });
const mode = (p: TablePlan, seat: string): string => (p.seats.get(seatId(seat))!.memory.fit as { mode: string }).mode;
const standing = (p: TablePlan, m: TableModel, seat: string): string[] =>
  p.seats.get(seatId(seat))!.units.filter((u) => u.role === "creature").map((u) => m.cards.get(u.top)!.face.name);

describe("pages", () => {
  it("stay open while small, and write once they outgrow eight places; mine never writes", () => {
    const p4 = plan(gameAt(4)), p9 = plan(gameAt(9));
    for (const s of ["Marath", "Atraxa", "Dack"]) {
      expect(mode(p4, s), s).toBe("open");
      expect(mode(p9, s), s).toBe("told");
    }
    expect(mode(p9, "You")).toBe("open");
    expect([...p9.seats.get(seatId("You"))!.units].some((u) => u.account)).toBe(false);
  });

  it.each([4, 6, 9, 12, 15] as const)("turn %i: no limit broken by a told page, at every supported viewport", (turn) => {
    for (const vp of VPS) {
      const p = plan(gameAt(turn), vp);
      expect(p.violations, `${vp.w}x${vp.h}`).toEqual([]);
      for (const s of ["Marath", "Atraxa", "Dack"]) expect(p.seats.get(seatId(s))!.report.lastResort, `${s} ${vp.w}`).toBe(false);
    }
  });

  it("stands the commander and the most important creatures; writes the rest down", () => {
    const m = gameAt(15), p = plan(m);
    expect(standing(p, m, "Atraxa").sort()).toEqual(["Atraxa, Praetors' Voice", "Glissa, Herald of Predation", "Steel Overseer", "Tekuthal, Inquiry Dominus"]);
    expect(standing(p, m, "Dack").sort()).toEqual(["Dack Fayden, Helping Hand", "Felidar Guardian", "Restoration Angel", "Wispweaver Angel"]);
    expect(standing(p, m, "Marath")).toContain("Marath, Will of the Wild");
    const acct = p.seats.get(seatId("Marath"))!.units.find((u) => u.account)!;
    expect(acct.account!.words.tally).toMatchObject({ power: 92, creatures: 33 });
    expect(acct.kind).toBe("summary");
    // Every written card is a member of the account, which a tap opens.
    expect(new Set(acct.members)).toEqual(new Set(acct.account!.words.written));
  });
});

/** A clip's decision as the table asks it, and the table planned with it. */
function asked(name: string, beat: number | "first", more: (p: TableInput) => Partial<TableInput> = () => ({})): { m: TableModel; p: TablePlan } {
  const m = clipModel(name, beat), snap = decodeSnapshot(clipEnvelope(name, beat).env);
  if (!snap.ok) throw new Error(snap.error.summary);
  const input = { ...tableInputOf(m, { viewport: VPS[0]!, ask: askOf(snap.value.decision, true) }), layout: told };
  return { m, p: planTable({ ...input, ...more(input) }) };
}
const said = (p: TablePlan, seat: string): string | undefined => p.answers.find((a) => a.id === `heading:${seat}`)?.lines.join(" / ");

describe("answers", () => {
  it("while I attack, each seat I may attack gets its heading: what may block, in facts a player would check", () => {
    const { p } = asked("attack15", 0);
    // (One line under the plaque: the clauses that fit, in their order.)
    expect(said(p, "Marath")).toBe("26 untapped · no fliers or reach");
    // (Atraxa's line keeps to her account's width, beside the well: the clauses that fit there.)
    expect(said(p, "Atraxa")).toBe("17 untapped · 9 fly");
    expect(said(p, "Dack")).toBe("10 untapped · 5 fly · biggest 4/6");
    expect(p.violations).toEqual([]);
  });

  it("narrows to the one answer my fliers ask", () => {
    const m = clipModel("attack15", 0);
    const fliers = boardOf(m, seatId("You")).cards.filter((c) => c.creature && !c.tapped && c.keywords.includes("Flying"));
    expect(attackSlip(boardOf(m, seatId("Marath")), fliers).lines).toEqual(["No fliers or reach"]);
    expect(attackSlip(boardOf(m, seatId("Atraxa")), fliers).lines).toEqual(["9 fly · Atraxa 8/8 deathtouch"]);
  });

  it("a sweep on the stack says what each page loses", () => {
    const { p } = asked("wipe15", 0);
    expect(said(p, "Marath")).toBe("Loses 33 creatures");
    expect(said(p, "Atraxa")).toBe("Loses 21 creatures");
    expect(said(p, "Dack")).toBe("Loses 13 creatures");
    expect(p.answers.some((a) => a.seat === seatId("You") && a.kind === "heading")).toBe(false);
  });

  it("an attack is said on the plaque it threatens while it is declared, and gone once damage is dealt", () => {
    expect(asked("block15", 1).p.landings).toEqual([expect.objectContaining({ seat: seatId("You"), text: "35" })]);
    expect(asked("alpha15", 0).p.landings.map((l) => l.text)).toEqual(["35"]);
    expect(asked("alpha15", 1).p.landings.map((l) => l.text)).toEqual(["12"]);
    expect(asked("alpha15", 2).p.landings).toEqual([]);
  });

  it("the base page writes nothing", () => {
    const m = clipModel("wipe15", 0);
    expect(planTable(tableInputOf(m, { viewport: VPS[0]! })).answers).toEqual([]);
  });
});
