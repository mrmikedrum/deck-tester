// What left the stack between two models when one source put several items there: each resolution is its own, read
// from its own log entry, whether the stack showed it or only the log did.
import { describe, expect, it } from "vitest";
import { changesBetween, freshLog } from "../../src/model/delta/changes";
import { resolutionsOf } from "../../src/model/delta/resolutions";
import type { TableModel } from "../../src/model";
import { creature, tableOf } from "./fixtures";
import type { TableSpec } from "./fixtures";

const warden = creature(700, "Soul Warden", "You", 1, 1);
const seats: TableSpec["seats"] = { You: { battlefield: [warden] } };
const gain = (i: number) => ({ i, type: "STACK_RESOLVE", text: "Soul Warden (700) - You gain 1 life.", card: 700 });
const life = (i: number) => ({ i, type: "LIFE", text: "You gained 1 life.", card: null });
const added = { i: 10, type: "STACK_ADD", text: "Soul Warden's trigger", card: 700 };
const ability = (id: number) => ({ id, source: warden, spell: false, text: "Soul Warden (700) - You gain 1 life." });

function resolutions(prev: TableModel, next: TableModel) {
  const fresh = freshLog(prev, next);
  return resolutionsOf(prev, next, changesBetween(prev, next, fresh), fresh).map((r) => ({
    popped: r.popped !== null,
    item: r.item?.id ?? null,
    from: r.span?.from ?? null,
  }));
}

describe("several items from one source resolving between two polls", () => {
  const log = [added, gain(20), life(21), gain(22), life(23)];

  it("two popped abilities each read their own entry, the top one the first", () => {
    const prev = tableOf({ seats, stack: [ability(901), ability(902)], log: [added] });
    const next = tableOf({ seats, stack: [], log });
    expect(resolutions(prev, next)).toEqual([
      { popped: true, item: 902, from: 0 },
      { popped: true, item: 901, from: 2 },
    ]);
  });

  it("two abilities only the log saw are two resolutions", () => {
    const prev = tableOf({ seats, log: [added] });
    const next = tableOf({ seats, log });
    expect(resolutions(prev, next)).toEqual([
      { popped: false, item: null, from: 0 },
      { popped: false, item: null, from: 2 },
    ]);
  });

  it("one the stack showed and one only the log saw: each its own entry", () => {
    const prev = tableOf({ seats, stack: [ability(901)], log: [added] });
    const next = tableOf({ seats, stack: [], log });
    expect(resolutions(prev, next)).toEqual([
      { popped: true, item: 901, from: 0 },
      { popped: false, item: null, from: 2 },
    ]);
  });

  it("an entry for a source still on the stack is not read as a resolution only the log saw", () => {
    const prev = tableOf({ seats, stack: [ability(901)], log: [added] });
    const next = tableOf({ seats, stack: [ability(901)], log: [added, gain(20)] });
    expect(resolutions(prev, next)).toEqual([]);
  });
});
