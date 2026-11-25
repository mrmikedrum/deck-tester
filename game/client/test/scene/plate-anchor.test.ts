// The seats' plates are chrome (chrome/plates.tsx): on the table a plate's piece only keeps its place, where a player's
// arcs and lanes land. It paints nothing and asks for no art.
import { describe, expect, it } from "vitest";
import { artWanted, createPiece } from "../../src/scene/three/pieces";
import type { PieceEnv } from "../../src/scene/three/pieces";
import type { ActorView } from "../../src/scene/stage/types";

const SAMPLE = { pos: { x: 0, y: 0, z: 0 }, rx: 0, ry: 0, s: 1, fade: 0, lift: 0, tap: 0, glow: 0, alpha: 0, w: 0, d: 0 };
const plate: ActorView = {
  id: "plate:Atraxa",
  kind: "plate",
  form: "plate|Atraxa",
  mods: "",
  draw: { t: "plate", spec: { name: "Atraxa", life: 32, seat: "#2f4a7a", monarch: false, turn: false, ring: "none", art: "cache/art/atraxa.jpg" } },
  face: null,
  mark: null,
  sample: SAMPLE,
  shown: 0,
  visible: true,
} as unknown as ActorView;

describe("a plate on the table", () => {
  it("leases no texture and wants no art: it is only a place", () => {
    const refuse = () => {
      throw new Error("a plate on the table painted something");
    };
    const env = { host: { painter: new Proxy({}, { get: () => refuse }), art: refuse }, fx: {}, pitch: 0.9 } as unknown as PieceEnv;
    const view = createPiece(env, plate)!;
    expect(view.group.children).toHaveLength(0);
    expect(artWanted(plate)).toEqual([]);
  });
});
