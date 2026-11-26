// Real pieces drawn by the view. Tapped is shaded by what the card is, not by how far it has turned (a notch turn is
// still tapped). Under a composed camera a tap is reached by a ray through it (view.ts `pickAt`): the nearer of two cards one behind
// the other, its piece's id; but what stands above the scrim is drawn over everything (the focus pass) and is reached
// first; and what the caller looks through (`skip`) is passed by. The pieces and the view are real (three.js objects
// need no WebGL); the host is the parts of one they use, with the painters stubbed (no 2D canvas in node).
import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Scene } from "three";
import { FACE_DEFAULTS, NO_SURFACES } from "../../src/theme";
import { ArtCache } from "../../src/scene/resources";
import { CARD, CardDeck, createCard } from "../../src/scene/three/cards";
import type { CardState } from "../../src/scene/three/cards";
import { cardGeometry } from "../../src/scene/three/geometry";
import type { Host } from "../../src/scene/three/host";
import { Rim } from "../../src/scene/three/materials";
import { Painter } from "../../src/scene/three/painter";
import { TextureCache } from "../../src/scene/three/textures";
import { StageRenderer } from "../../src/scene/three/view";
import type { ActorView, StageView } from "../../src/scene/stage/types";

vi.mock("../../src/theme", async (orig) => {
  const real = await orig<typeof import("../../src/theme")>();
  const size = (c: HTMLCanvasElement) => Object.assign(c, { width: 8, height: 8 });
  return { ...real, paintFace: size, paintBack: size, paintSign: size, paintChip: size, paintDrop: size, paintFxSprite: size };
});

const W = 800,
  H = 600;
const camera = new PerspectiveCamera(30, W / H, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
camera.updateProjectionMatrix();

function view(): StageRenderer {
  const arts = new ArtCache(1e9, () => Promise.resolve(null), () => undefined);
  const textures = new TextureCache({ budget: 1e9, anisotropy: 1, canvas: () => ({ width: 0, height: 0 }) as HTMLCanvasElement });
  const painter = new Painter(textures, { surfaces: NO_SURFACES, art: (u) => arts.get(u) as never });
  const rim = new Rim();
  const host = {
    painter,
    rim,
    kit: { geo: cardGeometry(), deck: new CardDeck(1, painter.back().texture, rim), rim },
    scene: new Scene(),
    camera,
    size: { w: W, h: H },
    art: (u: string) => arts.get(u),
    renderer: { getPixelRatio: () => 1 },
    setTableTone: () => undefined,
    setScrim: () => undefined,
  } as unknown as Host;
  return new StageRenderer(host, () => 0);
}

/** A card standing square to the camera at depth `z`. */
const card = (id: string, z: number): ActorView =>
  ({
    id,
    kind: "unit",
    form: `unit|${id}`,
    mods: "",
    draw: { t: "unit", unit: "card", posture: "stand", token: false, title: null, sub: null, mixed: false, mine: true, chips: [], dressed: [], colours: [], well: null, copies: [], tapNote: null, label: null, seatColour: "#000", seed: 1, sick: false, cue: null },
    mark: null,
    face: { ...FACE_DEFAULTS, name: id, art: null },
    shown: 1,
    sample: { pos: { x: 0, y: 0, z }, rx: 0, ry: 0, s: 1, fade: 0, lift: 0, tap: 0, glow: 0, alpha: 1, w: 0, d: 0 },
    visible: true,
    hl: null,
  }) as ActorView;

const frame = (above: string[] = []): StageView => ({
  actors: [card("far", 0), card("near", 1)],
  ghosts: [],
  lanes: [],
  bolts: [],
  strikes: [],
  aims: [],
  tableTone: 1,
  scrim: above.length ? 0.3 : 0,
  above: new Set(above),
  drawn: new Map(),
  now: 0,
  still: true,
});

describe("a ray through a tap", () => {
  it("reaches the nearer of two cards, by its piece", () => {
    const v = view();
    v.draw(frame());
    expect(v.pickAt(camera, W / 2, H / 2, W, H)?.id).toBe("near");
  });
  it("reaches what stands above the scrim first, as the focus pass draws it", () => {
    const v = view();
    v.draw(frame(["far"]));
    expect(v.pickAt(camera, W / 2, H / 2, W, H)?.id).toBe("far");
  });
  it("passes what it looks through, and off every card meets the table", () => {
    const v = view();
    v.draw(frame());
    expect(v.pickAt(camera, W / 2, H / 2, W, H, new Set(["near"]))?.id).toBe("far");
    const off = v.pickAt(camera, 5, H - 5, W, H);
    expect(off?.id ?? null).toBeNull();
  });
});

describe("tapped", () => {
  const states = (v: StageRenderer): CardState[] => {
    const out: CardState[] = [];
    (v as unknown as { root: Scene }).root.traverse((o) => o.userData[CARD] && out.push(o.userData[CARD] as CardState));
    return out;
  };
  it("a tapped card turned only a notch is shaded as tapped; an untapped one turning is not", () => {
    const v = view();
    const notch = card("notch", 0);
    v.draw({ ...frame(), actors: [{ ...notch, face: { ...notch.face!, tapped: true }, sample: { ...notch.sample, tap: 1 / 6 } }] });
    expect(states(v).map((s) => s.tap)).toEqual([1]);
    const turning = card("turning", 0);
    v.draw({ ...frame(), actors: [{ ...turning, sample: { ...turning.sample, tap: 0.7 } }] });
    expect(states(v).map((s) => s.tap)).toEqual([0]);
  });
  it("a card made tapped is shaded from the start", () => {
    const v = view();
    const kit = (v as unknown as { host: Host }).host.kit;
    expect(createCard(kit, null, { tapped: true }).state.tap).toBe(1);
    expect(createCard(kit, null).state.tap).toBe(0);
  });
});
