// The host's composer teardown: the composer disposes only its own targets and copy pass, so the passes it was given
// (the focus and output passes) are disposed first, on teardown and on context recovery alike.
import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Scene, Texture, Vector2, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FocusPass } from "../../src/scene/three/focus-pass";
import { disposeComposer } from "../../src/scene/three/host";
import { CardDeck, createCard } from "../../src/scene/three/cards";
import { cardGeometry } from "../../src/scene/three/geometry";
import { Rim } from "../../src/scene/three/materials";
import { motion } from "../../src/theme";

it("draws a sift's cards in the transparent pass, in their order, without shadows; table cards as they were", () => {
  const texture = new Texture();
  const deck = new CardDeck(1, texture, new Rim());
  const kit = { deck, geo: cardGeometry(), rim: new Rim() };
  const table = createCard(kit, null);
  const sift = createCard(kit, null, { transparent: true, order: 16, shadow: false });
  expect([sift.state.transparent, sift.state.order, sift.state.shadow]).toEqual([true, 16, false]);
  expect([table.state.transparent, table.state.order, table.state.shadow]).toEqual([false, 0, true]);
  sift.dispose();
  table.dispose();
  deck.dispose();
  texture.dispose();
});

describe("disposeComposer", () => {
  it("disposes every pass it owns, then the composer", () => {
    const renderer = { getPixelRatio: () => 1, getSize: (v: Vector2) => v.set(8, 8) };
    const composer = new EffectComposer(renderer as never, new WebGLRenderTarget(8, 8));
    const focus = new FocusPass(new Scene(), new PerspectiveCamera(), 0);
    const output = new OutputPass();
    composer.addPass(focus);
    composer.addPass(output);
    const order: string[] = [];
    vi.spyOn(focus, "dispose").mockImplementation(() => void order.push("focus"));
    vi.spyOn(output, "dispose").mockImplementation(() => void order.push("output"));
    vi.spyOn(composer, "dispose").mockImplementation(() => void order.push("composer"));
    disposeComposer(composer);
    expect(order).toEqual(["focus", "output", "composer"]);
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
