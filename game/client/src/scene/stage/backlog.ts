// The bounded backlog (docs "The backlog is bounded"): change sets are taken in order (by seq), one when the stage is
// ready for the next. More than two waiting, or the oldest over 1.5 s old: the older ones play compressed (shorter, no
// stagger). More than eight waiting, or the oldest over 3 s: all of them collapse into a cut to the newest model. A
// must-not-miss moment (a sweep, an elimination, something of the viewer's lost or aimed at) that is compressed or
// collapsed leaves a recap. Pure: time is an argument.
import type { ChangeSet, SeatId } from "../../model";
import type { CardId } from "../../protocol";
import type { Ms } from "../../play";
import { BACKLOG } from "./motion";
import type { Recap } from "./types";

interface Waiting {
  readonly set: ChangeSet;
  readonly at: Ms;
}

export type Take =
  | { readonly how: "play" | "compressed"; readonly set: ChangeSet }
  | { readonly how: "collapse"; readonly sets: readonly ChangeSet[] };

export class Backlog {
  private queue: Waiting[] = [];

  /** Queue a set (ignored unless newer than every set queued). */
  push(set: ChangeSet, at: Ms): void {
    const last = this.queue[this.queue.length - 1];
    if (last && set.seq <= last.set.seq) return;
    this.queue.push({ set, at });
  }

  get size(): number {
    return this.queue.length;
  }

  waiting(now: Ms): { seq: number; rev: string; age: Ms }[] {
    return this.queue.map((w) => ({ seq: w.set.seq, rev: w.set.rev, age: now - w.at }));
  }

  /** Over the bounds: everything waiting collapses into a cut. */
  overflowing(now: Ms): boolean {
    const oldest = this.queue[0];
    return !!oldest && (this.queue.length > BACKLOG.cutWaiting || now - oldest.at > BACKLOG.cutAge);
  }

  /**
   * What to take now. Past the bounds, everything (a cut); else, when the stage is `ready`, the oldest set, compressed
   * when more than two wait or it is older than 1.5 s and it is not the newest; else nothing.
   */
  take(now: Ms, ready: boolean): Take | null {
    if (!this.queue.length) return null;
    if (this.overflowing(now)) return { how: "collapse", sets: this.drain() };
    if (!ready) return null;
    const oldest = this.queue.shift()!;
    const pressed = this.queue.length >= 1 && (this.queue.length + 1 > BACKLOG.compressWaiting || now - oldest.at > BACKLOG.compressAge);
    return { how: pressed ? "compressed" : "play", set: oldest.set };
  }

  /** Whether a set still waiting moves any card. */
  movesAny(): boolean {
    return this.queue.some((w) => w.set.changes.some((c) => c.t === "moved"));
  }

  /** Whether a set still waiting moves this card. */
  moves(card: CardId): boolean {
    return this.queue.some((w) => w.set.changes.some((c) => c.t === "moved" && c.card === card));
  }

  drain(): ChangeSet[] {
    const out = this.queue.map((w) => w.set);
    this.queue = [];
    return out;
  }
}

/**
 * The moments of a set the viewer must not miss: a sweep, an elimination, a card of theirs that left the battlefield,
 * a spell or ability aimed at them or their things.
 */
export function mustNotMiss(set: ChangeSet, me: SeatId, mine: (card: CardId) => boolean, how: Recap["how"]): Recap[] {
  const out: Recap[] = [];
  for (const m of set.moments) {
    const changes = m.changes.map((i) => set.changes[i]!);
    const cards = new Set<CardId>();
    let why: Recap["why"] | null = null;
    if (m.reading === "sweep" || m.reading === "sunfall" || m.kind === "sweep") why = "sweep";
    if (m.reading === "eliminated" || changes.some((c) => c.t === "eliminated")) why = why ?? "eliminated";
    for (const c of changes) {
      if (c.t === "moved" && c.from === "battlefield" && c.before?.controller === me) {
        cards.add(c.card);
        why = why ?? "lost";
      }
      if (c.t === "pushed" && c.item.controller !== me) {
        for (const t of c.item.targets) {
          const hit = "seat" in t ? t.seat === me : mine(t.card);
          if (!hit) continue;
          why = why ?? "targeted";
          if ("card" in t) cards.add(t.card);
        }
      }
      // What a sweep took: what left the battlefield (not the spell itself, nor what it makes, Sunfall's Incubator).
      if (c.t === "moved" && c.from === "battlefield" && (m.reading === "sweep" || m.reading === "sunfall")) cards.add(c.card);
    }
    if (why) out.push({ seq: set.seq, rev: set.rev, how, kind: m.kind, reading: m.reading, why, seats: m.seats, cards: [...cards] });
  }
  return out;
}
