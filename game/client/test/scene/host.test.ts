// The host's composer teardown: the composer disposes only its own targets and copy pass, so the passes it was given
// (bloom's targets and materials, the output pass) are disposed first, on teardown and on context recovery alike.
import { describe, expect, it, vi } from "vitest";
import { Mesh, Texture, Vector2, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { disposeComposer } from "../../src/scene/three/host";
import { createCard } from "../../src/scene/three/card";
import { cardGeometry } from "../../src/scene/three/geometry";
import { Rim, SharedMaterials } from "../../src/scene/three/materials";
import { motion } from "../../src/theme";

it("draws every visible sift-card surface in the transparent pass without changing table cards", () => {
  const texture = new Texture();
  const shared = new SharedMaterials(0x302010, 0x201810, texture);
  const geo = cardGeometry();
  const kit = { geo, shared, rim: new Rim() };
  const materialsOf = (card: ReturnType<typeof createCard>) => card.body.children.flatMap((object) => {
    const material = (object as Mesh).material;
    return (Array.isArray(material) ? material : [material]).filter((m) => m.visible);
  });
  const table = createCard(kit, texture);
  const sift = createCard(kit, texture, { transparent: true });
  const dispose = materialsOf(sift).map((m) => vi.spyOn(m, "dispose"));

  expect(materialsOf(sift).map((m) => m.transparent)).toEqual([true, true, true]);
  expect(materialsOf(table).map((m) => m.transparent)).toEqual([false, false, false]);
  sift.dispose();
  for (const material of dispose) expect(material).toHaveBeenCalledOnce();
  table.dispose();
  shared.dispose();
  texture.dispose();
});

describe("disposeComposer", () => {
  it("disposes every pass it owns, then the composer", () => {
    const renderer = { getPixelRatio: () => 1, getSize: (v: Vector2) => v.set(8, 8) };
    const composer = new EffectComposer(renderer as never, new WebGLRenderTarget(8, 8));
    const bloom = new UnrealBloomPass(new Vector2(8, 8), 1, 0, 1);
    const output = new OutputPass();
    composer.addPass(bloom);
    composer.addPass(output);
    const order: string[] = [];
    vi.spyOn(bloom, "dispose").mockImplementation(() => void order.push("bloom"));
    vi.spyOn(output, "dispose").mockImplementation(() => void order.push("output"));
    vi.spyOn(composer, "dispose").mockImplementation(() => void order.push("composer"));
    disposeComposer(composer);
    expect(order).toEqual(["bloom", "output", "composer"]);
  });
});

describe("the rim under reduced motion", () => {
  it("breathes normally, and holds steady at its strongest when motion is reduced", () => {
    const rim = new Rim();
    const at = (ms: number, still: boolean) => {
      rim.update(ms, still);
      return [rim.colours.option.getHex(), rim.colours.danger.getHex()];
    };
    expect(at(0, false)).not.toEqual(at(motion.optionPeriod * 1.3, false));
    const steady = at(0, true);
    for (const ms of [137, 1000, 4321, 9000]) expect(at(ms, true)).toEqual(steady);
  });
});
