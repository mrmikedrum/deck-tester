// A pile's title tab says what it holds (h.js `titleTab`, `tabSub`): a pile of a creature's copies is titled by its name
// and count, never a round "×n" that reads like a counter; where some are tapped and some not, how many; a pile of unlike
// creatures its largest groups by name, and how many of it are tapped.
import { describe as group, expect, it } from "vitest";
import { planTable, tableInputOf } from "../../src/layout";
import { NO_FOCUS, describe } from "../../src/scene/stage";
import type { Draw } from "../../src/scene/stage";
import { tableOf, token } from "../model/fixtures";
import { NO_CUES } from "./corpus";

const tabs = (m: ReturnType<typeof tableOf>) => {
  const plan = planTable(tableInputOf(m, { viewport: { w: 1180, h: 820 } }));
  const d = describe({ model: m, plan, cues: NO_CUES, focus: NO_FOCUS, hover: null });
  return [...d.pieces.values()]
    .filter((p) => p.seat === ("Dack" as never) && p.draw.t === "unit" && p.draw.title)
    .map((p) => {
      const u = p.draw as Extract<Draw, { t: "unit" }>;
      return [u.title, u.sub];
    });
};

group("a pile's title tab", () => {
  it("copies of a creature: its name and count, never a round \"×n\"", () => {
    const beasts = Array.from({ length: 24 }, (_, i) => token(100 + i, "Beast", "Dack", 4, 4, { tapped: i < 6 }));
    const t = tabs(tableOf({ active: "You", seats: { Dack: { battlefield: beasts } } }));
    expect(t.length).toBeGreaterThan(0);
    for (const [title] of t) expect(title).toMatch(/^(Beast )?\d+$/);
    expect(t.some(([title]) => /^Beast \d+$/.test(title ?? ""))).toBe(true);
  });
  it("unlike creatures folded: copies stacked under their name; a fan by its count, what it holds by name, most first", () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => token(200 + i, "Elemental", "Dack", 3, 3, { tapped: i < 5 })),
      ...Array.from({ length: 20 }, (_, i) => token(300 + i, "Beast", "Dack", 4, 4)),
      ...Array.from({ length: 12 }, (_, i) => token(400 + i, `Spirit ${i}`, "Dack", 1, 1)),
    ];
    const t = tabs(tableOf({ active: "You", seats: { Dack: { battlefield: many } } }));
    expect(t, JSON.stringify(t)).toEqual(expect.arrayContaining([["Beast 20", null], ["Elemental 25", null]]));
    expect(t.some(([title, sub]) => /^\d+$/.test(title ?? "") && /^Elemental 5\b/.test(sub ?? "")), JSON.stringify(t)).toBe(true);
  });
});
