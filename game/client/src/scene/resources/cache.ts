// A reference-counted cache bounded by an estimated byte budget. Entries in use (refs > 0) are never evicted; entries
// nobody holds wait in least-recently-released order and are evicted oldest first whenever the total passes the budget.
// Pure: it knows nothing of three.js, only how to make, size and dispose a value, so its accounting is testable.

export interface CacheStats {
  readonly entries: number;
  readonly live: number;
  readonly idle: number;
  /** Estimated bytes of everything held, live and idle. */
  readonly bytes: number;
  /** Of those, the bytes of entries in use (never evicted) and of idle ones (evicted first when over budget). */
  readonly liveBytes: number;
  readonly idleBytes: number;
  readonly budget: number;
  /** Entries evicted or cleared (and so disposed) since creation. */
  readonly disposed: number;
}

interface Entry<V> {
  readonly value: V;
  readonly bytes: number;
  refs: number;
}

export class ByteCache<V> {
  private readonly live = new Map<string, Entry<V>>();
  /** Insertion order is release order: the first is the next to go. */
  private readonly idle = new Map<string, Entry<V>>();
  private total = 0;
  private gone = 0;

  constructor(
    readonly budget: number,
    private readonly free: (value: V) => void,
  ) {}

  /** Take a reference to `key`, making the value (and its size in bytes) if nobody has it. */
  acquire(key: string, make: () => { readonly value: V; readonly bytes: number }): V {
    const held = this.live.get(key);
    if (held) {
      held.refs++;
      return held.value;
    }
    const kept = this.idle.get(key);
    if (kept) {
      this.idle.delete(key);
      kept.refs = 1;
      this.live.set(key, kept);
      return kept.value;
    }
    const made = make();
    this.live.set(key, { value: made.value, bytes: made.bytes, refs: 1 });
    this.total += made.bytes;
    this.trim();
    return made.value;
  }

  /** Drop one reference. A value nobody holds any more stays cached until the budget needs the room. False if `key` was not held. */
  release(key: string): boolean {
    const e = this.live.get(key);
    if (!e) return false;
    if (--e.refs > 0) return true;
    this.live.delete(key);
    this.idle.set(key, e);
    this.trim();
    return true;
  }

  has(key: string): boolean {
    return this.live.has(key) || this.idle.has(key);
  }

  refs(key: string): number {
    return this.live.get(key)?.refs ?? 0;
  }

  /** Evict idle entries, oldest first, until the total fits (live entries may leave it over budget). */
  trim(): void {
    for (const [key, e] of this.idle) {
      if (this.total <= this.budget) return;
      this.idle.delete(key);
      this.drop(e);
    }
  }

  /** Dispose every entry, held or not (a lost context, or the scene going away). References held afterwards release as unknown. */
  clear(): void {
    for (const e of this.live.values()) this.drop(e);
    for (const e of this.idle.values()) this.drop(e);
    this.live.clear();
    this.idle.clear();
  }

  stats(): CacheStats {
    let idleBytes = 0;
    for (const e of this.idle.values()) idleBytes += e.bytes;
    return {
      entries: this.live.size + this.idle.size,
      live: this.live.size,
      idle: this.idle.size,
      bytes: this.total,
      liveBytes: this.total - idleBytes,
      idleBytes,
      budget: this.budget,
      disposed: this.gone,
    };
  }

  private drop(e: Entry<V>): void {
    this.total -= e.bytes;
    this.gone++;
    this.free(e.value);
  }
}

/** What a texture costs on the GPU: RGBA, a third more with mipmaps. */
export function textureBytes(w: number, h: number, mipmaps = true): number {
  return Math.round(w * h * 4 * (mipmaps ? 4 / 3 : 1));
}
