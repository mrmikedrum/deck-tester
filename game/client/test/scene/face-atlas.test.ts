// The face atlas grows with the faces on show, not with every face ever painted: a new face takes a free layer, then
// the room of a face nobody shows, and only then a page more; pages that show nothing go once it is over its budget.
// (Its pages need no WebGL until they are drawn; the copies wait for a flush, not run here.)
import { describe, expect, it } from "vitest";
import type { Texture } from "three";
import { FACE_LAYERS, FaceAtlas, PAGE_BYTES } from "../../src/scene/three/cards";
import type { FaceSlot } from "../../src/scene/three/cards";
import type { Lease } from "../../src/scene/three/textures";

const lease = (key: string): Lease => ({ key, texture: { image: null } as unknown as Texture, width: 0, height: 0, release: () => undefined });

describe("the face atlas", () => {
  it("a long run of face changes on a small board: its bytes plateau at what is on show", () => {
    const atlas = new FaceAtlas(1, 2 * PAGE_BYTES);
    const shown: FaceSlot[] = [];
    const bytes: number[] = [];
    // A board of eight cards whose faces keep changing (art arriving, counters, taps): 161 faces in all.
    for (let i = 0; i < 161; i++) {
      shown.push(atlas.acquire(lease(`face|${i}`)));
      if (shown.length > 8) atlas.release(shown.shift()!);
      atlas.trim();
      bytes.push(atlas.bytes);
    }
    expect(Math.max(...bytes)).toBe(PAGE_BYTES);
    expect(atlas.stats()).toMatchObject({ pages: 1, shown: 8 });
  });

  it("faces on show always have a layer, past the budget; a page that shows nothing goes when it is over", () => {
    const atlas = new FaceAtlas(1, PAGE_BYTES);
    const many = Array.from({ length: FACE_LAYERS + 5 }, (_, i) => atlas.acquire(lease(`face|${i}`)));
    expect(atlas.stats().pages).toBe(2);
    expect(new Set(many.map((s) => `${s.page}:${s.layer}`)).size).toBe(many.length);
    // The second page's faces put away: it shows nothing, the atlas is over its budget, so it goes.
    for (const s of many.filter((x) => x.page === 1)) atlas.release(s);
    atlas.trim();
    expect(atlas.stats()).toMatchObject({ pages: 1, bytes: PAGE_BYTES });
    // A page more again when the faces on show want it, in the room of the one let go.
    const back = Array.from({ length: 6 }, (_, i) => atlas.acquire(lease(`again|${i}`)));
    expect(back.some((s) => s.page === 1)).toBe(true);
    expect(atlas.pages[1]).not.toBeNull();
  });

  it("a face shown again keeps its layer while nobody needed the room", () => {
    const atlas = new FaceAtlas(1, PAGE_BYTES);
    const a = atlas.acquire(lease("face|a"));
    atlas.release(a);
    const b = atlas.acquire(lease("face|b"));
    expect(b.layer).not.toBe(a.layer);
    expect(atlas.acquire(lease("face|a"))).toBe(a);
  });
});
