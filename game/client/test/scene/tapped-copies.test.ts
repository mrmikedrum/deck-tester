// A pile's drawn copies wear their members' state: how many of them are drawn tapped.
import { describe, expect, it } from "vitest";
import { tappedCopies } from "../../src/scene/stage";

describe("tapped copies", () => {
  it("up to three members it is exact", () => {
    expect(tappedCopies(2, 2, 1)).toBe(1); // Illusion 2, one tapped
    expect(tappedCopies(3, 3, 2)).toBe(2);
    expect(tappedCopies(3, 3, 3)).toBe(3);
    expect(tappedCopies(1, 1, 1)).toBe(1);
  });
  it("past that, the share: at least one, and one left ready unless all are tapped", () => {
    expect(tappedCopies(3, 9, 4)).toBe(1); // Beast 9 with four tapped (the label says ↷4)
    expect(tappedCopies(4, 5, 2)).toBe(2); // Island ×5 with two tapped
    expect(tappedCopies(4, 4, 1)).toBe(1); // Rocks 4 with one
    expect(tappedCopies(3, 20, 1)).toBe(1);
    expect(tappedCopies(3, 20, 19)).toBe(2);
    expect(tappedCopies(3, 20, 20)).toBe(3);
  });
  it("none tapped, none drawn tapped", () => {
    expect(tappedCopies(3, 9, 0)).toBe(0);
  });
});
