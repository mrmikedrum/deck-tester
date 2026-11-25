// Painted textures on the GPU: a canvas painted by a theme painter becomes a texture held by lease. Textures are
// reference-counted by whoever shows them and kept, unreferenced, in a byte-bounded LRU; evicting disposes the texture
// and releases the canvas's pixels. Nothing here is ever left to the garbage collector alone.
import { CanvasTexture, SRGBColorSpace } from "three";
import type { Texture } from "three";
import { ByteCache, textureBytes } from "../resources";
import type { CacheStats } from "../resources";

/** A held reference to a cached texture. Releasing twice, or after the cache was cleared, does nothing. */
export interface Lease {
  readonly key: string;
  readonly texture: Texture;
  /** The canvas size in pixels, for sizing the plane it is shown on. */
  readonly width: number;
  readonly height: number;
  release(): void;
}

export interface TextureCacheOptions {
  readonly budget: number;
  readonly anisotropy: number;
  /** Where canvases come from (the document in the page; a fake in tests). */
  readonly canvas?: () => HTMLCanvasElement;
}

export class TextureCache {
  private readonly cache: ByteCache<Texture>;
  private readonly anisotropy: number;
  private readonly makeCanvas: () => HTMLCanvasElement;

  constructor(opts: TextureCacheOptions) {
    this.anisotropy = opts.anisotropy;
    this.makeCanvas = opts.canvas ?? (() => document.createElement("canvas"));
    this.cache = new ByteCache(opts.budget, (t) => {
      t.dispose();
      const img = t.image as Partial<HTMLCanvasElement> | undefined;
      if (img && typeof img.width === "number") {
        img.width = 0;
        img.height = 0;
      }
    });
  }

  /** The texture for `key`, painting it with `paint` if nobody has it. */
  lease(key: string, paint: (canvas: HTMLCanvasElement) => void): Lease {
    const texture = this.cache.acquire(key, () => {
      const canvas = this.makeCanvas();
      paint(canvas);
      const t = new CanvasTexture(canvas);
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = this.anisotropy;
      return { value: t, bytes: textureBytes(canvas.width, canvas.height) };
    });
    return this.wrap(key, texture);
  }

  /** The texture for `key` if it is already painted (held or idle), without painting; null otherwise. */
  leaseCached(key: string): Lease | null {
    if (!this.cache.has(key)) return null;
    const texture = this.cache.acquire(key, () => {
      throw new Error("unreachable");
    });
    return this.wrap(key, texture);
  }

  private wrap(key: string, texture: Texture): Lease {
    const img = texture.image as HTMLCanvasElement;
    let open = true;
    return {
      key,
      texture,
      width: img.width,
      height: img.height,
      release: () => {
        if (!open) return;
        open = false;
        this.cache.release(key);
      },
    };
  }

  stats(): CacheStats {
    return this.cache.stats();
  }

  clear(): void {
    this.cache.clear();
  }
}
