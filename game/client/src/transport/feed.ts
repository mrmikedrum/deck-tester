// The snapshot feed both adapters share: decode, classify against what the app last took, mark epochs, and the
// acknowledgement rules. One snapshot is out at a time; the app's ack decides where the next poll starts:
//   took   the cursor moves to it, and it becomes what the next one is classified against
//   fault  the first time, re-sync (ask v=0); the second time for the same v, skip it (move the cursor only)
//   stale  re-sync (ask v=0), so the app gets the current snapshot under its current epoch
// A decode failure is handled the same way as a fault, without waiting for an ack.
// A newGame or restart moves the epoch on here, and the snapshot carries the new one; the app adopts it.
import { decodeSnapshot } from "../protocol";
import type { Snapshot } from "../protocol";
import type { Ms } from "../platform";
import { classify } from "./continuity";
import type { Ack, TransportEvent } from "./types";

/** What the adapter does after a body: wait for the app's ack, poll again now, or back off. */
export type Then = "wait" | "poll" | "backoff";

const rawV = (json: unknown): number | null => {
  const v = typeof json === "object" && json !== null ? (json as { v?: unknown }).v : undefined;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
};

export class Feed {
  epoch = 0;
  private accepted: Snapshot | null = null;
  private cursor = 0;
  private resync = false;
  private out: Snapshot | null = null;
  private faulted: number | null = null;
  private decodeFaulted: number | null | undefined = undefined;

  /** A fresh run: nothing taken, the next snapshot is `first`. */
  reset(epoch: number): void {
    this.epoch = epoch;
    this.accepted = this.out = this.faulted = null;
    this.decodeFaulted = undefined;
    this.cursor = 0;
    this.resync = false;
  }

  /** Every call from the app carries its epoch; the feed keeps the newest. */
  note(epoch: number): void {
    if (epoch > this.epoch) this.epoch = epoch;
  }

  /** A snapshot is out, waiting for the app's ack. */
  get waiting(): boolean {
    return this.out !== null;
  }

  /** The v the next request asks from (0 to re-sync), and consumes a pending re-sync. */
  next(): number {
    return this.takeResync() ? 0 : this.cursor;
  }

  /** Whether the next request is a re-sync; consumes it. */
  takeResync(): boolean {
    const r = this.resync;
    this.resync = false;
    return r;
  }

  /** The next request should re-sync (ask v=0), as after an indeterminate answer. */
  wantResync(): void {
    this.resync = true;
  }

  /** A GET /api/view body: the event to emit, and what to do next. */
  receive(json: unknown, asked: Ms, at: Ms): { event: TransportEvent; then: Then } {
    const r = decodeSnapshot(json);
    if (!r.ok) {
      const v = rawV(json);
      let then: Then = "poll";
      if (this.decodeFaulted === v) {
        if (v === null) then = "backoff";
        else this.cursor = v; // seen twice: skip it
      } else {
        this.decodeFaulted = v;
        this.resync = true;
      }
      return { event: { t: "fault", at, epoch: this.epoch, code: "decode", message: r.error.summary, v }, then };
    }
    const snap = r.value;
    const continuity = classify(this.accepted, snap);
    if (continuity === "newGame" || continuity === "restart") this.epoch += 1;
    this.out = snap;
    return { event: { t: "snapshot", at, epoch: this.epoch, snap, continuity, asked }, then: "wait" };
  }

  /** The app's ack for the snapshot out; ignored unless it names that snapshot's v. */
  ack(epoch: number, v: number, ack: Ack): boolean {
    this.note(epoch);
    const snap = this.out;
    if (!snap || snap.v !== v) return false;
    this.out = null;
    if (ack === "took") {
      this.accepted = snap;
      this.cursor = v;
      this.faulted = null;
      this.decodeFaulted = undefined;
    } else if (ack === "fault") {
      if (this.faulted === v) this.cursor = v;
      else {
        this.faulted = v;
        this.resync = true;
      }
    } else this.resync = true;
    return true;
  }
}
