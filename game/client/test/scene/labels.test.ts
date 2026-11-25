// Pile labels sized on screen and placed so none meets another label or another card's name strip or foot.
import { describe, expect, it } from "vitest";
import type { TablePlan } from "../../src/layout";
import { LABEL_PX, labelText, placeLabels, shorter } from "../../src/scene/stage";
import type { LabelAsk } from "../../src/scene/stage";

/** A card's face quad on screen (foot-left, foot-right, top-right, top-left) at (x, y) top-left, w x h. */
const quad = (x: number, y: number, w: number, h: number) =>
  [
    { x, y: y + h },
    { x: x + w, y: y + h },
    { x: x + w, y },
    { x, y },
  ] as const;
const planOf = (groups: { id: string; seat: string; x: number; y: number; w?: number; h?: number }[]): TablePlan =>
  ({ hits: { rev: 0, groups: groups.map((g, i) => ({ id: g.id, kind: "pile", seat: g.seat, members: [], quad: quad(g.x, g.y, g.w ?? 60, g.h ?? 84), order: i })) } }) as unknown as TablePlan;
const ask = (id: string, name: string, count: number, mine = false): LabelAsk => ({ id, seat: (mine ? "You" : "Dack") as never, mine, name, count, tap: null });
const chars = (text: string, px: number) => text.length * 0.55 * px;

describe("pile labels", () => {
  it("one line, the parenthesis dropped, then the leading words, then the name ellipsized to five letters", () => {
    expect(shorter("Elemental (Marath)")).toEqual(["Elemental", "Elementa…", "Element…", "Elemen…", "Eleme…"]);
    expect(shorter("Cat Beast")[1]).toBe("Beast");
    expect(labelText("Beast", 9, "↷4")).toBe("Beast 9 ↷4");
  });
  it("13 px on my page, 12 on the others', centred on the card's top edge", () => {
    const plan = planOf([{ id: "a", seat: "You", x: 100, y: 300 }, { id: "b", seat: "Dack", x: 400, y: 100 }]);
    const out = placeLabels(plan, [ask("a", "Illusion", 2, true), ask("b", "Beast", 3)], chars);
    expect(out.get("a")).toEqual({ name: "Illusion", px: LABEL_PX.mine, slide: 0 });
    expect(out.get("b")).toEqual({ name: "Beast", px: LABEL_PX.theirs, slide: 0 });
  });
  it("too wide for its row: smaller first, then shorter; never under 11 px", () => {
    // Neighbours 70 px apart: 64 px of room.
    const plan = planOf([{ id: "a", seat: "Dack", x: 100, y: 200 }, { id: "b", seat: "Dack", x: 170, y: 200 }]);
    const a = placeLabels(plan, [ask("a", "Elemental (Marath)", 2)], chars).get("a")!;
    expect(a.px).toBeGreaterThanOrEqual(LABEL_PX.floor);
    expect(chars(labelText(a.name, 2, null), a.px) + LABEL_PX.pad * a.px).toBeLessThanOrEqual(64);
  });
  it("a label meeting another's name strip slides, or gives way to the count chip", () => {
    // A card standing just above the pile's top edge: its foot is where the label would go.
    const plan = planOf([{ id: "a", seat: "Dack", x: 100, y: 200 }, { id: "b", seat: "Ana", x: 95, y: 110, w: 70, h: 84 }]);
    const out = placeLabels(plan, [ask("a", "Beast", 3)], chars);
    expect(out.has("a")).toBe(false);
  });
});
