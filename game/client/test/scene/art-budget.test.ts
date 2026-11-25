// The decoded-art budget against what is on show: with more art visible than the budget holds, redrawing must not load
// art again. Pieces and the stage's view are real (three.js objects need no WebGL); the host is the parts of one they
// use, with the painters stubbed (no 2D canvas in node) and a budget that holds one decoded image.
import { describe, expect, it, vi } from "vitest";
import { Scene } from "three";
import type { FaceSpec } from "../../src/theme";
import { FACE_DEFAULTS, NO_SURFACES } from "../../src/theme";
import { ArtCache } from "../../src/scene/resources";
import { cardGeometry } from "../../src/scene/three/geometry";
import type { Host } from "../../src/scene/three/host";
import { Rim, SharedMaterials } from "../../src/scene/three/materials";
import { Painter } from "../../src/scene/three/painter";
import { TextureCache } from "../../src/scene/three/textures";
import { StageRenderer } from "../../src/scene/three/view";
import type { ActorView, StageView } from "../../src/scene/stage/types";

/** Every face painted, by its art (null: painted without). */
const painted: (string | null)[] = [];
vi.mock("../../src/theme", async (orig) => {
  const real = await orig<typeof import("../../src/theme")>();
  const size = (c: HTMLCanvasElement) => Object.assign(c, { width: 8, height: 8 });
  return {
    ...real,
    paintFace: (c: HTMLCanvasElement, spec: FaceSpec) => {
      painted.push(spec.art);
      size(c);
    },
    paintBack: size,
    paintSign: size,
    paintChip: size,
    paintPlate: size,
  };
});

const IMAGE = { width: 100, height: 100 }; // 40,000 bytes decoded
const ONE_IMAGE = 50_000;

function rig(budget: number) {
  const loads: string[] = [];
  const arrived: { to: (url: string) => void } = { to: () => undefined };
  const arts = new ArtCache(
    budget,
    (url) => {
      loads.push(url);
      return Promise.resolve({ ...IMAGE, close: () => undefined });
    },
    (url) => arrived.to(url),
  );
  const textures = new TextureCache({ budget: 1e9, anisotropy: 1, canvas: () => ({ width: 0, height: 0 }) as HTMLCanvasElement });
  const painter = new Painter(textures, { surfaces: NO_SURFACES, art: (u) => arts.get(u) as never });
  const rim = new Rim();
  const host = {
    painter,
    rim,
    kit: { geo: cardGeometry(), shared: new SharedMaterials(0, 0, painter.back().texture), rim },
    scene: new Scene(),
    art: (u: string) => arts.get(u),
    setTableTone: () => undefined,
    setScrim: () => undefined,
  } as unknown as Host;
  const view = new StageRenderer(host, () => 0);
  arrived.to = (url) => view.artArrived(url);
  /** One frame, as the host draws it: the view, then the art that arrived before it may go. */
  const frame = (v: StageView) => {
    view.draw(v);
    arts.releaseFresh();
  };
  return { loads, arts, frame };
}

const SAMPLE = { pos: { x: 0, y: 0, z: 0 }, rx: 0, ry: 0, s: 1, fade: 0, lift: 0, tap: 0, glow: 0, alpha: 1, w: 0, d: 0 };
function unit(id: string, art: string): ActorView {
  return {
    id,
    kind: "unit",
    form: `unit|${id}`,
    mods: "",
    draw: {
      t: "unit",
      unit: "card",
      posture: "flat",
      token: false,
      title: null,
      sub: null,
      mixed: false,
      mine: true,
      chips: [],
      dressed: [],
      colours: [],
      well: null,
      copies: [],
      tapNote: null,
      label: null,
      seatColour: "#000",
      seed: 1,
    },
    mark: null,
    face: { ...FACE_DEFAULTS, name: id, art },
    shown: 1,
    sample: SAMPLE,
    visible: true,
  } as ActorView;
}
const board: StageView = {
  actors: [unit("a", "cache/art/a.jpg"), unit("b", "cache/art/b.jpg")],
  ghosts: [],
  lanes: [],
  bolts: [],
  strikes: [],
  aims: [],
  tableTone: 1,
  scrim: 0,
  above: new Set(),
  drawn: new Map(),
  now: 0,
  still: false,
};
const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("art over budget", () => {
  it("two faces showing, a budget for one image: eight redraws load each image once", async () => {
    painted.length = 0;
    const r = rig(ONE_IMAGE);
    r.frame(board); // both faces ask for their art
    await settle(); // both arrive before the next frame: the second would evict the first before anything painted it
    for (let i = 0; i < 8; i++) {
      r.frame(board);
      await settle();
    }
    expect(r.loads).toEqual(["cache/art/a.jpg", "cache/art/b.jpg"]);
    // Painted without art, then once with it; never again without (an evicted bitmap keeps its painted face).
    expect(painted.filter((a) => a === "cache/art/a.jpg")).toHaveLength(1);
    expect(painted.filter((a) => a === "cache/art/b.jpg")).toHaveLength(1);
    expect(painted.filter((a) => a === null)).toHaveLength(2);
    // The budget holds: one bitmap decoded, the other evicted once both were painted.
    expect(r.arts.stats()).toMatchObject({ entries: 1, decodes: 2, requests: 2, pending: 0 });
  });

  it("an Aura's art arriving repaints it on the card it dresses", async () => {
    painted.length = 0;
    const r = rig(10 * ONE_IMAGE);
    // (Its own face has no art to wait for: only the Aura's arriving can repaint it.)
    const base = { ...unit("a", "cache/art/a.jpg"), face: { ...FACE_DEFAULTS, name: "a", art: null } };
    const dressedUnit = { ...base, draw: { ...base.draw, dressed: [{ card: 9, face: { ...FACE_DEFAULTS, name: "Rancor", art: "cache/art/rancor.jpg" } }] } } as unknown as ActorView;
    const v = { ...board, actors: [dressedUnit] };
    r.frame(v);
    await settle();
    r.frame(v);
    expect(r.loads).toContain("cache/art/rancor.jpg");
    expect(painted).toContain("cache/art/rancor.jpg");
  });

  it("art arriving repaints only the faces waiting for it", async () => {
    painted.length = 0;
    const r = rig(10 * ONE_IMAGE);
    r.frame({ ...board, actors: [unit("a", "cache/art/a.jpg")] });
    await settle();
    r.frame({ ...board, actors: [unit("a", "cache/art/a.jpg")] }); // a painted with its art
    painted.length = 0;
    r.frame(board); // b appears and asks for its art
    await settle();
    r.frame(board);
    expect(painted).toEqual([null, "cache/art/b.jpg"]); // a was not repainted when b's art came
  });
});
