import { describe, expect, it } from "vitest";
import { CARD, clearBehind, liePose, onFrame, slotFrame, standPose } from "../../../src/layout/arrange/frame";
import { S_TABLE, SLOT, rowWidth, tableScale } from "../../../src/layout/arrange/scale";
import type { FloorRow } from "../../../src/layout/arrange/scale";
import { momentKey, momentOf, stanceOf } from "../../../src/layout/arrange/moment";
import { arrCardOf } from "../../../src/layout/arrange/card";
import { pinhole } from "../../../src/layout/projector";
import { makeGeo } from "../../../src/layout/seat/geometry";
import { cardMiddle } from "../../../src/layout/shape";
import { tableTemplate } from "../../../src/layout/template";
import { reservations } from "../../../src/layout/reservations";
import { designUnit } from "../../../src/layout/types";
import type { CardId } from "../../../src/layout/types";
import { seatId } from "../../../src/model";
import { creature, tableOf } from "../../model/fixtures";

const tpl = tableTemplate(4);
const VP = { w: 1180, h: 820 };
const proj = pinhole(tpl.camera, VP);
const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(a.z).toBeCloseTo(b.z, 9);
};

describe("frame geometry: on the level table, today's geometry (goldens)", () => {
  const g = makeGeo(proj, reservations(VP, "normal"), 56);
  for (const slot of tpl.slots)
    it(`${slot.position}: a point of the frame is mat's toWorld at the same depth from the fixed edge`, () => {
      const f = slotFrame(slot);
      for (const [a, depth] of [[0, 0], [-2.5, 1.3], [3.1, 4.4], [0.7, slot.d]] as const) close(onFrame(f, a, depth), g.toWorld(slot, a, slot.d / 2 - depth));
      // orthonormal and right-handed
      const { across: x, away: y, normal: n } = f;
      expect(x.x * y.x + x.y * y.y + x.z * y.z).toBeCloseTo(0, 12);
      close({ x: x.y * y.z - x.z * y.y, y: x.z * y.x - x.x * y.z, z: x.x * y.y - x.y * y.x }, n);
    });

  it("a card standing at the camera's pitch has today's middle (shape.ts cardMiddle, stand)", () => {
    const f = slotFrame(tpl.slots[2]!), s = 1.4, at = 1.1;
    const p = standPose(f, 0.5, at, proj.pitch);
    const mid = { x: p.foot.x + (p.up.x * s) / 2, y: p.foot.y + (p.up.y * s) / 2, z: p.foot.z + (p.up.z * s) / 2 };
    close(mid, cardMiddle(proj, { pos: onFrame(f, 0.5, at), scale: s, posture: "stand" }, false));
  });

  it("a card lying flat has today's middle (shape.ts cardMiddle, flat)", () => {
    const f = slotFrame(tpl.slots[2]!), s = 1.1, at = 3;
    const p = liePose(f, 0, at, s);
    const mid = { x: p.foot.x + (p.up.x * s) / 2, y: p.foot.y + (p.up.y * s) / 2, z: p.foot.z + (p.up.z * s) / 2 };
    // today's flat card is placed by its foot: the same middle is half a card up from it
    close(mid, cardMiddle(proj, { pos: onFrame(f, 0, at - s / 2), scale: s, posture: "flat" }, false));
  });

  it("a quarter turn points the top right, a notch turns clockwise", () => {
    const f = slotFrame(tpl.slots[2]!);
    close(liePose(f, 0, 2, 1, Math.PI / 2).up, f.across);
    const n = liePose(f, 0, 2, 1, (15 * Math.PI) / 180).up;
    expect(n.x).toBeGreaterThan(0); // toward across (right), from away
  });

  it("the lean is 25° back from the normal, away from me", () => {
    const p = standPose(slotFrame(tpl.slots[2]!), 0, 1);
    expect(Math.acos(p.up.y)).toBeCloseTo((25 * Math.PI) / 180, 9);
    expect(p.up.z).toBeLessThan(0);
  });
});

describe("one card size", () => {
  const u = designUnit(VP);
  const leaf = (i: number) => {
    const f = slotFrame(tpl.slots[i]!), front = SLOT.margin + SLOT.strip * S_TABLE;
    const back = clearBehind(proj, f, front, S_TABLE) + SLOT.strip * S_TABLE;
    const us = [-f.w / 2 + 1, 0, f.w / 2 - 1];
    return [
      { frame: f, v: front, us, posture: "stand", floor: 56 },
      { frame: f, v: back, us, posture: "lie", floor: 44 },
    ] as FloorRow[];
  };
  // My field's deepest row stands at z ≈ 1.5 (the near slot's anchor is at z = 6.5); it is placed for real in step 9.
  const mine: FloorRow = { frame: slotFrame(tpl.slots[0]!), v: 5, us: [-10, 0, 10], posture: "stand", floor: 72 };
  const rows = [...leaf(1), ...leaf(2), ...leaf(3), mine];

  it("S_table is the smallest 0.05 step at which every rest row meets its floor at 1180x820, exactly", () => {
    expect(tableScale(proj, rows, u)).toBe(S_TABLE);
  });

  it("at S_table the leaf's front reads 59-61 px and its back 54 (the design's table)", () => {
    const [front, back] = leaf(2);
    expect(rowWidth(proj, front!, S_TABLE, u)).toBeGreaterThan(59);
    expect(rowWidth(proj, back!, S_TABLE, u)).toBeGreaterThan(54);
  });

  it("four places on every leaf's front, at abutting card-height slots and 0.2 margins (§4.4)", () => {
    for (const i of [1, 2, 3]) expect(Math.floor((tpl.slots[i]!.w - 2 * SLOT.margin) / (SLOT.stand * S_TABLE) + 1e-9)).toBe(4);
  });

  it("a lying slot holds a card turned a notch", () => {
    expect(SLOT.lie).toBeCloseTo(CARD.w * Math.cos(Math.PI / 12) + CARD.h * Math.sin(Math.PI / 12), 12);
  });
});

describe("the moment (from by-relevance)", () => {
  const model = tableOf({
    turn: 7,
    active: "Atraxa",
    phase: "MAIN1",
    seats: { Atraxa: { battlefield: [creature(1, "Bear", "Atraxa", 2, 2), creature(2, "Tired", "Atraxa", 3, 3, { tapped: true })] }, You: { battlefield: [creature(3, "Mine", "You")] } },
  });
  const atraxa = seatId("Atraxa");

  it("an opponent's turn before attackers asks what can come at me", () => {
    const m = momentOf(model);
    expect(m).toEqual({ q: "threat", seat: atraxa });
    expect(momentKey(m)).toBe("threat:Atraxa");
  });

  it("stance is light: the ready creature forward, the tapped one down, mine untouched", () => {
    const m = momentOf(model);
    const c = (id: number) => arrCardOf(model.cards.get(id as CardId)!);
    expect(stanceOf(c(1), atraxa, false, m)).toBe("forward");
    expect(stanceOf(c(2), atraxa, false, m)).toBe("down");
    expect(stanceOf(c(3), seatId("You"), true, m)).toBeNull();
  });

  it("legal targets of a decision are the question, before combat", () => {
    const m = momentOf(model, { kind: "targets", options: [2 as CardId], draft: [] });
    expect(m).toEqual({ q: "aim", legal: [2] });
  });
});
