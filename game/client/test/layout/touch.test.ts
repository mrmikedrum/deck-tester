// The touch target is Apple's 44 pt, in CSS px at every viewport (intent.md "Hard limits": "Tappable"). Floors scale
// with the design unit; the patch a finger needs does not.
import { describe, expect, it } from "vitest";
import { TAP_PX } from "../../src/layout/board";
import { audit } from "../../src/layout/shape";
import type { Quad, Shape } from "../../src/layout/shape";

const rect = (l: number, t: number, r: number, b: number): Quad => [
  { x: l, y: b },
  { x: r, y: b },
  { x: r, y: t },
  { x: l, y: t },
];

/** A lone card face `w` x `h` CSS px, with no floor of its own: only the patch rule can fail. */
function lone(w: number, h: number): Shape {
  const face = rect(100, 100, 100 + w, 100 + h);
  return { group: "u", kind: "unit", seat: "x", face, name: rect(100, 100, 100 + w, 100 + h / 6), foot: rect(100, 100 + (5 * h) / 6, 100 + w, 100 + h), order: 0, floor: 0, width: w, members: [] };
}

describe("the tappable patch is 44 CSS px at every supported viewport", () => {
  it("is 44", () => expect(TAP_PX).toBe(44));
  for (const vp of [
    { w: 1024, h: 768 },
    { w: 1180, h: 820 },
    { w: 1366, h: 1024 },
  ])
    it(`${vp.w}x${vp.h}: a 40 px patch is too small, a 48 px one is enough`, () => {
      const small = audit([lone(40, 60)], vp).filter((v) => v.rule === "tap-patch");
      expect(small).toHaveLength(1);
      expect(small[0]!.limit).toBe(44);
      expect(audit([lone(48, 60)], vp).filter((v) => v.rule === "tap-patch")).toEqual([]);
    });
});
