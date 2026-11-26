// The flight lifecycle: every card on its way between zones, from the frame its set is taken until it lands (or is
// dropped by a cut). The one owner of flights: it launches them (taking over a flight of the same card), lifts early
// leavers off their places, sets each off when its turn comes, steps it along its path, ends it, and says what it
// carries for the rest of the stage: the cards on their way to each piece, the cards waiting their turn in a piece, the
// moments it ended. It reads the stage's actors and its latest description; it never writes them. Pure.
import { reserved } from "../../layout";
import type { TablePlan, V3 } from "../../layout";
import type { TableModel } from "../../model";
import type { CardId } from "../../protocol";
import type { Ms } from "../../play";
import { mana } from "../../theme";
import type { FaceSpec } from "../../theme";
import { Actor } from "./animator";
import type { PathSpec } from "./animator";
import { plain, sampleOf } from "./actors";
import type { Actors } from "./actors";
import { DURATION, FLIGHT_LIMIT, PATH, v3 } from "./motion";
import { atPlate, handPose, onPile, screenPose } from "./poses";
import { LOOK } from "./types";
import type { Description, FlightPlan, FlightSnapshot, GhostView, MomentId, Sample } from "./types";

interface FlightState {
  readonly id: string;
  readonly seq: number;
  readonly plan: FlightPlan;
  readonly start: number;
  readonly dur: number;
  readonly lift: number;
  readonly big: boolean;
  /** It waits in the piece it leaves until it sets off (a departure from a piece the stage shows). */
  readonly holds: boolean;
  /**
   * A card standing alone that leaves: it comes off its place at once and waits just above it for its turn (h.js: "each
   * clears its page at once and waits just above it"), so the board can close up under it.
   */
  readonly early: boolean;
  /** Where it sets off from, when not the piece it left (a flight it took over from). */
  readonly from: (() => Sample) | null;
  readonly moment: MomentId | null;
  /**
   * Where the piece it leaves (or its maker) stood when it was scheduled: a resolved ability's stack entry is gone before
   * its flare sets off, and it flares from here rather than from a plate.
   */
  stood: Sample | null;
  ghost: Actor | null;
  origin: Sample | null;
}

/** What flights read of the stage: its actors, and the latest description, plan and model it adopted. */
export interface FlightBoard {
  readonly actors: Actors;
  desc(): Description | null;
  plan(): TablePlan | null;
  model(): TableModel | null;
}

export class Flights {
  private readonly flights = new Map<string, FlightState>();
  /** Moments whose flights were dropped (a cut, a reset): they end with the next report, so each ends exactly once. */
  private dropped: MomentId[] = [];

  constructor(private readonly board: FlightBoard) {}

  get size(): number {
    return this.flights.size;
  }

  /** Every flight goes; the moments they carried end (reported landed: the card is where the model has it). */
  drop(): void {
    for (const f of this.flights.values()) if (f.moment) this.dropped.push(f.moment);
    this.flights.clear();
  }

  /** The moments dropped flights carried, once. */
  takeDropped(): MomentId[] {
    return this.dropped.splice(0);
  }

  launch(plan: FlightPlan, seq: number, start: number, dur: number, lift: number, big: boolean, t: Ms): void {
    let from: (() => Sample) | null = null;
    let at = start;
    let carried: MomentId | null = null;
    // The chain's tail: a card moved again while still on its way already has a flight waiting on the one in the air.
    const prev = [...this.flights.values()].filter((f) => f.plan.key === plan.key).at(-1);
    if (prev) {
      if (prev.ghost && prev.ghost.committed(t)) {
        // Past a third of its way between zones: it finishes first, then goes on from where it landed.
        at = Math.max(start, prev.start + prev.dur);
        const landing = () => this.destSample(prev);
        from = landing;
      } else {
        // Not yet committed: it turns at once from where it is (a waiting one never left).
        // The flight it replaces may carry a moment (a land played from the hand that leaves at once): this one carries
        // it on, so it still ends exactly once.
        const here = prev.ghost?.now ?? null;
        carried = prev.moment;
        this.flights.delete(prev.id);
        if (here) from = () => here;
        else if (prev.from) {
          // It was waiting on a flight still in the air: so does this one, from where that one lands.
          from = prev.from;
          at = Math.max(start, prev.start);
        }
      }
    }
    const actors = this.board.actors;
    const origin = plan.origin.from === "piece" ? actors.get(plan.origin.piece) : undefined;
    const early = plan.departure && from === null && lift > 0 && !!origin && origin.piece.kind === "unit" && origin.shown.length === 1;
    const holds = plan.departure && plan.origin.from === "piece" && from === null && !early;
    const moment = (plan.origin.from === "hand" ? plan.origin.moment : null) ?? carried;
    const f: FlightState = { id: `${seq}:${plan.key}`, seq, plan, start: at, dur, lift, big, holds, early, from, moment, stood: null, ghost: null, origin: null };
    if ((plan.origin.from === "piece" || plan.origin.from === "maker") && actors.has(plan.origin.piece)) f.stood = this.originSample(f);
    this.flights.set(f.id, f);
    if (early) this.liftOff(f, t);
  }

  /** Cards that have left a piece but wait their turn in it. */
  heldBy(): Map<string, CardId[]> {
    const out = new Map<string, CardId[]>();
    for (const f of this.flights.values()) {
      if (!f.holds || f.ghost || f.plan.card === null || f.plan.origin.from !== "piece") continue;
      const list = out.get(f.plan.origin.piece);
      if (list) list.push(f.plan.card);
      else out.set(f.plan.origin.piece, [f.plan.card]);
    }
    return out;
  }

  /** Cards on their way to each piece (a pile or the piece they become). */
  inbound(): Map<string, Set<CardId>> {
    const out = new Map<string, Set<CardId>>();
    for (const f of this.flights.values()) {
      const d = f.plan.dest;
      if (f.plan.card === null || (d.to !== "pile" && d.to !== "piece")) continue;
      const s = out.get(d.piece);
      if (s) s.add(f.plan.card);
      else out.set(d.piece, new Set([f.plan.card]));
    }
    return out;
  }

  /** The cards (or null, an ability) flying into a piece. */
  boundFor(piece: string): Set<CardId | null> {
    return new Set([...this.flights.values()].filter((f) => f.plan.dest.to !== "hand" && f.plan.dest.to !== "nowhere" && "piece" in f.plan.dest && f.plan.dest.piece === piece).map((f) => f.plan.card));
  }

  /** Every card a flight carries. */
  cards(): Set<CardId> {
    const out = new Set<CardId>();
    for (const f of this.flights.values()) if (f.plan.card !== null) out.add(f.plan.card);
    return out;
  }

  /** Whether any flight carries a card (an ability's flare carries none). */
  carriesAny(): boolean {
    for (const f of this.flights.values()) if (f.plan.card !== null) return true;
    return false;
  }

  /** Whether a flight carries this card. */
  carries(card: CardId): boolean {
    for (const f of this.flights.values()) if (f.plan.card === card) return true;
    return false;
  }

  /** An early leaver lifts off its place now and hovers there until its turn, then flies the rest of its way. */
  private liftOff(f: FlightState, t: Ms): void {
    const from = this.originSample(f);
    const up = { ...from, pos: { ...from.pos, y: from.pos.y + PATH.rise } };
    f.origin = from;
    f.ghost = new Actor(from, t);
    f.ghost.go({ t0: t, dur: f.lift, path: { k: "ease", ease: "sine" }, to: () => up, commit: false }, "replace");
    const path = this.pathOf(f, up);
    const rest = path.k === "flight" ? { ...path, lift: 0, rise: 0 } : path;
    f.ghost.go({ t0: f.start + f.lift, dur: f.dur - f.lift, path: rest, to: () => this.destSample(f), commit: true }, "after");
  }

  /** Sets off what is due, and ends what has landed (or outlived its limit): their moments go to `landed`. */
  step(t: Ms, landed: MomentId[]): void {
    for (const f of [...this.flights.values()]) {
      if (!f.ghost && t >= f.start) {
        const from = f.from ? f.from() : this.originSample(f);
        f.origin = from;
        f.ghost = new Actor(from, f.start);
        f.ghost.go({ t0: f.start, dur: f.dur, path: this.pathOf(f, from), to: () => this.destSample(f), commit: true }, "replace");
      }
      const end = f.start + f.dur;
      if (t >= end || (f.ghost && t - f.start > FLIGHT_LIMIT)) {
        this.flights.delete(f.id);
        if (f.moment) landed.push(f.moment);
      }
    }
  }

  /** What to draw of each flight that has set off, stepped to `t`. */
  ghosts(t: Ms): GhostView[] {
    const out: GhostView[] = [];
    for (const f of this.flights.values()) {
      if (!f.ghost) continue;
      const sample = f.ghost.step(t);
      const k = Math.max(0, Math.min(1, (t - f.start) / Math.max(1, f.dur)));
      const flare = f.plan.motion === "burn" || f.plan.motion === "fizzle" ? k : null;
      out.push({ id: f.id, face: f.plan.face, token: f.plan.token, sample, flare, colours: f.plan.face ? colours(f.plan.face.frame) : [] });
    }
    return out;
  }

  snapshot(t: Ms): FlightSnapshot[] {
    return [...this.flights.values()].map((f) => ({
      id: f.id,
      key: f.plan.key,
      card: f.plan.card,
      departure: f.plan.departure,
      origin: f.plan.origin,
      dest: f.plan.dest,
      phase: f.plan.phase,
      cohort: f.plan.cohort,
      seq: f.seq,
      start: f.start,
      end: f.start + f.dur,
      state: f.ghost ? "flying" : "waiting",
      progress: Math.max(0, Math.min(1, (t - f.start) / Math.max(1, f.dur))),
    }));
  }

  // ---- where a flight goes ------------------------------------------------------------------------------------------

  private proj() {
    return this.board.plan()!.projector;
  }

  /** Where a flight sets off: the piece it left as it is now (the top of a zone pile), the hand, a plate, its maker. */
  private originSample(f: FlightState): Sample {
    const o = f.plan.origin;
    const actors = this.board.actors;
    const desc = this.board.desc();
    const destScale = () => {
      const d = f.plan.dest;
      const p = d.to === "pile" || d.to === "piece" ? desc?.pieces.get(d.piece) : undefined;
      return p?.pose.s ?? 1;
    };
    if (o.from === "piece") {
      const a = actors.get(o.piece);
      const base = a?.actor.now ?? (desc?.pieces.get(o.piece) ? sampleOf(desc.pieces.get(o.piece)!) : null);
      if (base) {
        if (a?.piece.kind === "zone" && a.piece.draw.t === "zone") return plain({ ...base, ...onPile(base, Math.max(0, a.shown.length - 1), a.piece.draw.mine) });
        if (a?.piece.kind === "plate") return plain({ ...base, ...atPlate(base, PATH.entrySize) });
        return plain(base);
      }
      if (f.stood) return f.stood;
    }
    if (o.from === "hand") {
      if (o.pose) return plain({ ...LOOK, ...screenPose(this.proj(), o.pose, PATH.castHeight) });
      const hand = reserved(this.board.plan()!.reserve, "hand");
      const h = handPose(this.proj(), hand);
      const pos = hand ? this.proj().onTable((hand.left + hand.right) / 2, (hand.top + hand.bottom) / 2, PATH.castHeight) : h.pos;
      return plain({ ...LOOK, ...h, pos, s: destScale() * PATH.castFrom });
    }
    if (o.from === "maker") {
      const a = actors.get(o.piece);
      if (a) return plain({ ...a.actor.now, s: Math.min(a.actor.now.s, 1.2) });
      if (f.stood) return f.stood;
    }
    const seat = o.from === "plate" ? o.seat : (this.board.model()?.viewer.perspective ?? null);
    const plate = actors.get(`plate:${seat}`);
    const base = plate?.actor.now ?? { ...LOOK, pos: v3(0, 1, -6), rx: 0, ry: 0, s: 1 };
    return plain({ ...base, ...atPlate(base, destScale() * PATH.castFrom) });
  }

  /** Where a flight lands, resolved every frame: a destination that moves is followed. */
  private destSample(f: FlightState): Sample {
    const d = f.plan.dest;
    const actors = this.board.actors;
    if (d.to === "pile") {
      const a = actors.get(d.piece);
      if (a && a.piece.draw.t === "zone") return plain({ ...a.actor.now, ...onPile(a.actor.now, a.shown.length, a.piece.draw.mine) });
    }
    if (d.to === "pile" || d.to === "piece") {
      const a = actors.get(d.piece);
      if (a?.piece.kind === "plate") return plain({ ...a.actor.now, ...atPlate(a.actor.now, PATH.plateSize) });
      if (a) return plain(a.actor.now);
      const p = this.board.desc()?.pieces.get(d.piece);
      if (p) return plain(sampleOf(p));
    }
    if (d.to === "hand") return plain({ ...LOOK, ...handPose(this.proj(), reserved(this.board.plan()!.reserve, "hand")) });
    if (d.to === "nowhere" && d.how === "plate") {
      const plate = actors.get(`plate:${d.seat}`);
      if (plate) return plain({ ...plate.actor.now, ...atPlate(plate.actor.now, PATH.plateSize) });
    }
    return f.origin ?? this.originSample(f);
  }

  private pathOf(f: FlightState, from: Sample): PathSpec {
    const d = f.plan.dest;
    const proj = this.proj();
    const actors = this.board.actors;
    switch (f.plan.motion) {
      case "cast": {
        const mine = f.plan.origin.from === "hand";
        const desc = this.board.desc();
        const stacked = (desc?.pieces.size ?? 0) > 0 && [...(desc?.pieces.values() ?? [])].filter((p) => p.kind === "stack").length > 1;
        return { k: "cast", via: mine ? (stacked ? "under" : "line") : "middle", arc: mine ? PATH.castArc : PATH.castArcTheirs, up: proj.up };
      }
      case "join": {
        // It comes in from the side it came from (a card played from my hand from my edge, theirs from their plate),
        // so it never flies past where it rests and back (playtest: the first card played overshot my mat's edge); a
        // card that came from where it lands comes in from the table's middle.
        const to = this.destSample(f);
        const mid = proj.onTable(proj.viewport.w / 2, proj.viewport.h / 2, 0);
        const back = Math.hypot(from.pos.x - to.pos.x, from.pos.z - to.pos.z) > 1e-3;
        const dx = (back ? from.pos.x : mid.x) - to.pos.x,
          dz = (back ? from.pos.z : mid.z) - to.pos.z,
          l = Math.hypot(dx, dz) || 1;
        const k = back ? Math.min(PATH.joinVia * to.s, l / 2) : PATH.joinVia * to.s;
        const via: V3 = { x: to.pos.x + (dx / l) * k, y: to.pos.y + PATH.joinViaUp, z: to.pos.z + (dz / l) * k };
        return { k: "join", via };
      }
      case "burn": {
        const rise = f.lift > 0 || actors.get((f.plan.origin as { piece?: string }).piece ?? "")?.shown.length ? PATH.burnPileRise * from.s : PATH.burnRise;
        return { k: "burn", wait: (f.dur * DURATION.burnWait) / (DURATION.burnWait + DURATION.burn), rise };
      }
      case "fizzle":
        return { k: "fizzle" };
      case "withdraw":
        return { k: "flight", lift: 0, rise: 0, arc: PATH.arc, ease: "sine", settle: 1, shrinkFrom: 0 };
      case "spell":
        return { k: "flight", lift: 0, rise: 0, arc: PATH.arc, ease: f.big ? "cubic" : "out3", settle: f.big ? PATH.settleBig : 1, shrinkFrom: f.big ? 0 : PATH.shrinkFrom };
      case "depart":
      case "return": {
        const pile = d.to === "pile";
        const o = f.plan.origin.from === "piece" ? actors.get(f.plan.origin.piece) : undefined;
        const standee = o?.piece.draw.t === "unit" && o.piece.draw.posture === "stand";
        const rise = f.lift > 0 && (o?.shown.length ?? 0) > 1 ? PATH.rise + PATH.pileRise * from.s : PATH.rise;
        return {
          k: "flight",
          lift: f.lift,
          rise,
          arc: standee && !pile ? PATH.standeeArc * from.s : PATH.arc,
          ease: "out2",
          settle: pile ? PATH.settlePile : 1,
          shrinkFrom: pile ? 0 : PATH.shrinkFrom,
        };
      }
    }
  }
}

/** A flare's colours from a face's frame: the mana it stands for (fx.js `colorsOf`), gold for several, silver for none. */
function colours(frame: FaceSpec["frame"]): string[] {
  if (frame === "W" || frame === "U" || frame === "B" || frame === "R" || frame === "G") return [mana[frame]];
  if (frame === "M") return [mana.W, mana.R];
  return [mana.C];
}
