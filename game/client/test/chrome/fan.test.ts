// The fan's geometry (live.js `poses`): pure, so the tuned layout is pinned number for number.
import { describe, expect, it } from "vitest";
import { cardSize, fan, fanLeft, labelFont } from "../../src/chrome/fan";
import type { FanInput } from "../../src/chrome/fan";

const NAMES = ["Island", "Snap", "Arcane Denial", "Frantic Search", "Ghostly Flicker", "Phantasmal Image", "Reality Shift"];
const input = (more: Partial<FanInput> = {}): FanInput => ({
  names: NAMES,
  playable: NAMES.map(() => false),
  f: NAMES.length - 1,
  vel: 0,
  thumbing: false,
  respond: false,
  u: 1,
  ...more,
});

describe("fan", () => {
  it("is 150 u by 150 x 680/488 u a card, its origin 18 u plus half the fan in", () => {
    expect(cardSize(1)).toEqual({ w: 150, h: (150 * 680) / 488 });
    expect(cardSize(0.5).w).toBe(75);
    expect(fanLeft(1)).toBeCloseTo(18 + (150 * 2.9) / 2);
    expect(labelFont(0.5)).toBe('700 12px "Barlow Condensed", sans-serif');
  });
  it("one card stands at the origin, leaning 1.5 degrees left as a hand is held, with a full strip", () => {
    expect(fan(input({ names: ["Island"], f: 0 }))).toEqual([{ x: 0, y: 0, rot: -1.5, z: 10, label: 146 }]);
  });
  it("none is empty", () => {
    expect(fan(input({ names: [] }))).toEqual([]);
  });
  it("bunched cards show a strip of 0.3 of a card, spread over 1.9 card widths when there is room", () => {
    const poses = fan(input({ names: ["Island", "Snap", "Brainstorm"], f: 2 }));
    // strips of 45; needed 90 < span 285: each gap gets its strip plus an even share of the rest, never more than an
    // opened card (141)
    const gap = Math.min(141, 45 + (285 - 90) / 2);
    expect(poses[1]!.x - poses[0]!.x).toBeCloseTo(gap);
    expect(poses[2]!.x - poses[1]!.x).toBeCloseTo(gap);
    expect(poses[0]!.label).toBeCloseTo(gap - 4);
  });
  it("past the span every strip shrinks evenly, to no less than 0.1 of a card", () => {
    const ten = fan(input({ names: Array.from({ length: 10 }, (_, i) => `Card ${i}`), f: 9 }));
    for (let i = 1; i < ten.length; i++) expect(ten[i]!.x - ten[i - 1]!.x).toBeCloseTo(285 / 9);
    const forty = fan(input({ names: Array.from({ length: 40 }, (_, i) => `Card ${i}`), f: 39 }));
    for (let i = 1; i < forty.length; i++) expect(forty[i]!.x - forty[i - 1]!.x).toBeCloseTo(15);
  });
  it("arcs: the end cards drop 0.05 of a card and tilt 4 degrees outward, all leaning 1.5 left; z rises along the fan", () => {
    const poses = fan(input());
    const first = poses[0]!, last = poses.at(-1)!;
    expect(first.y).toBeCloseTo(150 * 0.05);
    expect(first.rot).toBeCloseTo(-4 - 1.5);
    expect(last.rot).toBeCloseTo(4 - 1.5);
    expect(poses.map((p) => p.z)).toEqual([10, 11, 12, 13, 14, 15, 16]);
    expect(Math.abs(first.x + last.x)).toBeLessThan(1e-9);
  });
  it("no gap is wider than an opened card (0.94 of a card)", () => {
    const poses = fan(input({ names: ["Supercalifragilistic", "Antidisestablishmentarianism", "X"], f: 0, thumbing: true }));
    for (let i = 1; i < poses.length; i++) expect(poses[i]!.x - poses[i - 1]!.x).toBeLessThanOrEqual(150 * 0.94 + 1e-9);
  });
  it("thumbing opens the gap after the focus", () => {
    const rest = fan(input({ f: 2 })), thumbed = fan(input({ f: 2, thumbing: true }));
    const gap = (p: typeof rest, i: number): number => p[i + 1]!.x - p[i]!.x;
    expect(gap(thumbed, 2)).toBeGreaterThan(gap(rest, 2));
    expect(gap(thumbed, 0)).toBeLessThan(gap(rest, 0));
  });
  it("the card being thumbed over lifts 0.07 of a card", () => {
    const poses = fan(input({ f: 2.25, thumbing: true })); // the old curve peaks a quarter and three quarters of the way
    const flat = fan(input({ f: 2, thumbing: true }));
    expect(poses[3]!.y).toBeLessThan(flat[3]!.y - 150 * 0.07 * 0.9);
    expect(flat[3]!.y).toBeGreaterThanOrEqual(0); // at rest on a whole card nothing is lifted
  });
  it("leans with the spring's push, clamped", () => {
    const still = fan(input({ f: 3 })), pushed = fan(input({ f: 3, vel: 1 }));
    expect(pushed[3]!.x).toBeCloseTo(still[3]!.x - 150 * 0.05);
    expect(pushed[3]!.rot).toBeLessThan(still[3]!.rot);
  });
  it("responding, the playable cards open and the rest close to their strips", () => {
    const playable = NAMES.map((_, i) => i === 3);
    const plain = fan(input({ playable })), opened = fan(input({ playable, respond: true }));
    const gap = (p: typeof plain, i: number): number => p[i + 1]!.x - p[i]!.x;
    expect(gap(opened, 3)).toBeGreaterThan(gap(plain, 3));
    expect(gap(opened, 0)).toBeLessThanOrEqual(gap(plain, 0));
    // but never while thumbing
    expect(fan(input({ playable, respond: true, thumbing: true }))).toEqual(fan(input({ playable, thumbing: true })));
  });
});
