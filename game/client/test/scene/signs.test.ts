// A well's or a zone's sign through the renderer (view.ts `settleSigns`): where it would meet another label it slides,
// then gives up its second line before that line crosses the 11 px floor, then gives way to its count chip; it is never
// left drawn over another label. Real meshes under a real camera; the piece views are stubbed to hold just the signs.
import { describe, expect, it, vi } from "vitest";
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry } from "three";
import type { ActorView, StageView } from "../../src/scene/stage";
import { StageRenderer } from "../../src/scene/three/view";
import type { Host } from "../../src/scene/three/host";
import { LABEL, SIGN_ALTS } from "../../src/scene/three/pieces";
import type { LabelTag, SignAlts } from "../../src/scene/three/pieces";

const views = new Map<string, Group>();
vi.mock("../../src/scene/three/pieces", async (original) => ({
  ...(await original<typeof import("../../src/scene/three/pieces")>()),
  createPiece: (_env: unknown, v: ActorView) => ({ group: views.get(v.id)!, patch() {}, look() {}, dispose() {} }),
  placeGroup() {},
}));

const W = 1180, H = 820, DIST = 10;
const camera = new PerspectiveCamera(50, W / H, 0.1, 100);
camera.position.set(0, 0, DIST);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
/** CSS px per world unit at the table's plane (z = 0). */
const PPU = H / (2 * DIST * Math.tan((25 * Math.PI) / 180));

const plane = (tag: LabelTag, w: number, h: number, x: number, y: number): Mesh => {
  const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial());
  m.userData[LABEL] = tag;
  m.position.set(x, y, 0);
  return m;
};
/** A well's sign at (x, y): its two lines, its one-line form and its count chip, as pieces.ts builds them. */
function wellSign(x: number, y: number): { group: Group; sign: Mesh; alts: SignAlts } {
  const sign = plane({ fonts: [60, 55], h: 152, want: 12 }, 1.2, 0.5, x, y);
  const line = plane({ fonts: [60], h: 96, want: 12 }, 1.2, 0.3, x, y);
  const chip = new Mesh(new PlaneGeometry(0.26, 0.26), new MeshBasicMaterial());
  const alts: SignAlts = { line, chip };
  sign.userData[SIGN_ALTS] = alts;
  line.visible = chip.visible = false;
  const group = new Group();
  group.add(sign, line, chip);
  return { group, sign, alts };
}

function draw(groups: Record<string, Group>): StageRenderer {
  views.clear();
  for (const [id, g] of Object.entries(groups)) views.set(id, g);
  const host = { scene: { add() {} }, setTableTone() {}, setScrim() {}, painter: { fx: () => null }, renderer: { getPixelRatio: () => 1 }, camera, size: { w: W, h: H } } as unknown as Host;
  const view = new StageRenderer(host, () => 0);
  const actor = (id: string) => ({ id, kind: "unit", form: id, mods: "", draw: { t: "unit" }, visible: true, sample: {} }) as unknown as ActorView;
  view.draw({ now: 0, still: true, actors: Object.keys(groups).map(actor), ghosts: [], lanes: [], bolts: [], strikes: [], aims: [], scrim: 0, above: new Set(), tableTone: 1 } as unknown as StageView);
  return view;
}

/** A wide label across the middle (another pile's title, already placed): no slide gets past it. */
const wall = (): Group => {
  const g = new Group();
  g.add(plane({ fonts: [60], h: 96 }, 6, 40 / PPU, 0, 0));
  return g;
};
const meets = (a: readonly number[], b: readonly number[]): boolean => Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!) > 2 && Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!) > 2;

describe("a sign that would meet another label", () => {
  it("drops its second line rather than shrink it under 11 px", () => {
    // Its two lines (30.4 px tall at 12 px) reach 3 px into the wall's top edge: at 11 px they would clear it, but the
    // second line would be 10.1 px. On one line (19.2 px tall) it clears it at 12.
    const top = H / 2 - 20, y = (H / 2 - (top + 3 - 15.2)) / PPU;
    const s = wellSign(0, y);
    const view = draw({ a: wall(), b: s.group });
    expect(s.sign.visible).toBe(false);
    expect(s.alts.line!.visible).toBe(true);
    const shown = view.labels(camera, W, H).filter((l) => l.visible);
    expect(Math.min(...shown.map((l) => l.px))).toBeGreaterThanOrEqual(11 - 1e-3);
    expect(shown.filter((l) => l.id === "b").every((l) => !shown.some((o) => o.id !== l.id && meets(o.box, l.box)))).toBe(true);
  });
  it("gives way to its count chip where no form of it clears, never drawn over the other", () => {
    const s = wellSign(0, 0);
    const view = draw({ a: wall(), b: s.group });
    expect(s.alts.chip!.visible).toBe(true);
    const shown = view.labels(camera, W, H).filter((l) => l.visible);
    expect(shown.map((l) => l.id)).toEqual(["a"]);
  });
});
