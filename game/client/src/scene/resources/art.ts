// Decoded card art: an ImageBitmap per url, bounded by bytes like the textures. A face asks for its art by url; where it
// is not ready the face paints without it, and `onReady` says when to paint again. The loader is injected, so the
// cache is testable and the host decides how images are fetched (same-origin `cache/cards/...`).
//
// A bitmap is only needed to paint: once a face is painted with it, the face keeps its texture whether or not the bitmap
// stays (scene/three/pieces.ts). So art that has just arrived is held (not evictable) until the next frame has painted
// what waited for it (`releaseFresh`, called by the host after each render): otherwise, with more art arriving at once
// than the budget holds, the first would be evicted before anything painted it, asked for again, and so on.
import { ByteCache, textureBytes } from "./cache";
import type { CacheStats } from "./cache";

export interface ArtImage {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

export type ArtLoader = (url: string) => Promise<ArtImage | null>;

export interface ArtStats extends CacheStats {
  /** Loads out now: a recorder waits for none before it steps its clock. */
  readonly pending: number;
  /** Loads started, decoded and failed since creation (a url evicted and asked for again loads again). */
  readonly requests: number;
  readonly decodes: number;
  readonly failures: number;
}

export class ArtCache {
  private readonly cache: ByteCache<ArtImage>;
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();
  /** Arrived since the last `releaseFresh`, each holding a reference. */
  private fresh = new Set<string>();
  /** Bumped by `clear`: a load started before it lands in a cache that no longer wants it. */
  private generation = 0;
  private requests = 0;
  private decodes = 0;
  private failures = 0;

  constructor(
    budget: number,
    private readonly load: ArtLoader,
    private readonly onReady: (url: string) => void,
  ) {
    this.cache = new ByteCache(budget, (i) => i.close?.());
  }

  /** The decoded art, or null while it loads (a load is started once; a failed url is not retried). */
  get(url: string): ArtImage | null {
    if (this.cache.has(url)) {
      // Touch: a use makes it the newest idle entry.
      const img = this.cache.acquire(url, () => {
        throw new Error("unreachable");
      });
      this.cache.release(url);
      return img;
    }
    if (!this.pending.has(url) && !this.failed.has(url)) {
      this.pending.add(url);
      this.requests++;
      const gen = this.generation;
      void this.load(url).then(
        (img) => {
          if (gen !== this.generation) return void img?.close?.(); // cleared while it decoded: nobody holds it
          this.pending.delete(url);
          if (!img) {
            this.failures++;
            return void this.failed.add(url);
          }
          this.decodes++;
          this.cache.acquire(url, () => ({ value: img, bytes: textureBytes(img.width, img.height, false) }));
          if (this.fresh.has(url)) this.cache.release(url); // one hold per url
          this.fresh.add(url);
          this.onReady(url);
        },
        () => {
          if (gen !== this.generation) return;
          this.pending.delete(url);
          this.failures++;
          this.failed.add(url);
        },
      );
    }
    return null;
  }

  /** A frame has painted what waited for the art that arrived before it: that art may be evicted again. */
  releaseFresh(): void {
    if (!this.fresh.size) return;
    const urls = this.fresh;
    this.fresh = new Set();
    for (const url of urls) this.cache.release(url);
  }

  stats(): ArtStats {
    return {
      ...this.cache.stats(),
      pending: this.pending.size,
      requests: this.requests,
      decodes: this.decodes,
      failures: this.failures,
    };
  }

  /** Close everything; loads still out are closed when they land and never reported. */
  clear(): void {
    this.generation++;
    this.pending.clear();
    this.fresh = new Set();
    this.cache.clear();
  }
}
