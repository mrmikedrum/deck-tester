// Batched sprites: every shown proxy of one sprite drawn as one instance of one mesh; put away with the batch, its
// meshes leave the group they were drawn in (a context restored builds a new batch in the same group).
import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, Texture } from "three";
import { DecalBatch, batched } from "../../src/scene/three/batch";

describe("the sprite batch", () => {
  it("draws two proxies of one sprite as one mesh, and takes it out of its group when disposed", () => {
    const scene = new Scene(),
      group = new Group(),
      map = new Texture();
    scene.add(group);
    const plane = new PlaneGeometry(1, 1);
    for (const x of [0, 2]) {
      const m = batched(new Mesh(plane, new MeshBasicMaterial({ map, transparent: true, opacity: 0.5 })));
      m.position.x = x;
      scene.add(m);
    }
    scene.updateMatrixWorld();
    const batch = new DecalBatch(group);
    batch.sync(scene);
    expect(batch.stats()).toEqual({ sprites: 2, batches: 1 });
    expect(group.children).toHaveLength(1);
    batch.dispose();
    expect(group.children).toHaveLength(0);
  });
});
