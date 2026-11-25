// A source: events queued between frames and drained, in arrival order, by the app's frame loop. Nothing is pushed
// into the app by callback; a source only wakes the loop (asks for a frame) when something arrives.

export interface Source<T> {
  /** Everything queued, oldest first; the source is empty afterwards. */
  drain(): T[];
  /** How many events are queued now. */
  readonly size: number;
  /** The loop's waker, called whenever an event is queued; null stops waking. */
  listen(wake: (() => void) | null): void;
}

/** A plain queue. `latest` keeps only the newest event (a viewport reading, say), so a burst drains as one. */
export class Queue<T> implements Source<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;

  constructor(private readonly latest = false) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    if (this.latest) this.items = [item];
    else this.items.push(item);
    this.wake?.();
  }

  drain(): T[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  /** Drops everything queued (teardown). */
  clear(): void {
    this.items = [];
  }

  listen(wake: (() => void) | null): void {
    this.wake = wake;
  }
}
