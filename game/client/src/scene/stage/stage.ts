// The stage: frames in, motion out. Each `show` takes the change sets the backlog allows, plans their flights (causality
// orders them), adopts the latest description as every piece's target, reconciles actors by piece id (create, patch,
// adopt a re-keyed piece, keep a remnant, fold into a pile), steps the animator to `now` and says what to draw. It owns
// the actors; `Flights` (inflight.ts) owns every flight's lifecycle and `Membership` what each actor shows. A card the
// chrome still holds is drawn nowhere until the stage takes the set that brings it, then flies from where it was let go.
// Pure: no three.js, no clock; the three.js view draws what `show` returns.
import type { TableModel } from "../../model";
import type { CardId } from "../../protocol";
import type { TablePlan, V3 } from "../../layout";
import type { SeatId } from "../../model";
import type { Ms } from "../../play";
import { faceKey, motion } from "../../theme";
import type { FaceSpec } from "../../theme";
import { Actor, sameSample } from "./animator";
import type { PathSpec } from "./animator";
import { plain, sampleOf } from "./actors";
import type { ActorState, FaceMemo } from "./actors";
import { Backlog, mustNotMiss } from "./backlog";
import { isBig, schedule } from "./causality";
import type { ScheduleInput } from "./causality";
import { describe } from "./describe";
import { faceOfCard, inkOf } from "./faces";
import { handOffFlights, planFlights } from "./flights";
import type { PlanContext } from "./flights";
import { Flights } from "./inflight";
import { Membership } from "./membership";
import { DURATION, PATH, SCRIM, paced } from "./motion";
import type { Measure } from "./labels";
import type { Pace } from "./motion";
import { retitle } from "./piles";
import type { DrawnPiece } from "./pick";
import { aimPath } from "./aims";
import { atPlate, quadScreenPose, siftRoll } from "./poses";
import { tableFocusKey } from "./types";
import type {
  ActorView,
  AimView,
  BoltView,
  Description,
  FlightPlan,
  LaneView,
  MomentId,
  MomentView,
  Piece,
  PieceSnapshot,
  Recap,
  Sample,
  SceneFrame,
  SceneReport,
  SceneSnapshot,
  StageView,
  StrikeView,
} from "./types";

/** How long a bolt strikes (h.js: out after 500 ms). */
const BOLT_MS = 500;
/** How long a struck plate's burst lasts (h.js `buildBoard`'s `SeatFX.burst(..., { ms: 700 })`). */
export const STRIKE_MS = 700;
/** How many points a lane's stroke is drawn through. */
const LANE_POINTS = 32;

/** Where a piece's foot rests on the table, from its sample (its pose stands half a card up its own up axis), plus `off`. */
const groundAt = (s: Sample, off: V3): V3 => {
  const h = 0.5 * s.s;
  return { x: s.pos.x + off.x, y: 0, z: s.pos.z - Math.sin(s.rx) * h + off.z };
};

/** A lane's stroke: a cubic from its start, cresting at `apex` over the page through its middle half, down to its end. */
export function lanePath(from: V3, to: V3, apex: number): V3[] {
  const at = (k: number): V3 => ({ x: from.x + (to.x - from.x) * k, y: apex, z: from.z + (to.z - from.z) * k });
  const b = at(0.25), c = at(0.75);
  return Array.from({ length: LANE_POINTS + 1 }, (_, i) => {
    const k = i / LANE_POINTS, u = 1 - k;
    const w0 = u * u * u, w1 = 3 * u * u * k, w2 = 3 * u * k * k, w3 = k * k * k;
    return { x: w0 * from.x + w1 * b.x + w2 * c.x + w3 * to.x, y: w0 * from.y + w1 * b.y + w2 * c.y + w3 * to.y, z: w0 * from.z + w1 * b.z + w2 * c.z + w3 * to.z };
  });
}

/** A bolt's way (h.js): from the attacker up, through where its lane landed, down past it, on to the plaque. */
export function boltPath(src: V3, via: V3 | null, plate: V3): V3[] {
  const from = { x: src.x, y: 0.3, z: src.z }, to = { x: plate.x, y: 0.3, z: plate.z };
  const v = via ? { x: via.x, y: 0.35, z: via.z } : { x: from.x + (to.x - from.x) * 0.4, y: 0.35, z: from.z + (to.z - from.z) * 0.4 };
  const pts = [from, v, { x: v.x, y: v.y, z: v.z + 1.6 }, to];
  // Centripetal-free Catmull-Rom through the four points (three's CatmullRomCurve3 default, uniform), 48 steps.
  const P = (i: number) => pts[Math.max(0, Math.min(3, i))]!;
  const out: V3[] = [];
  for (let n = 0; n <= 48; n++) {
    const f = (n / 48) * 3, i = Math.min(2, Math.floor(f)), k = f - i;
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * k + (2 * a - 5 * b + 4 * c - d) * k * k + (-a + 3 * b - 3 * c + d) * k * k * k);
    out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), z: cr(p0.z, p1.z, p2.z, p3.z) });
  }
  return out;
}

/** What a description is made from: a frame whose inputs are all the same describes the same table. */
interface DescribedFrom {
  readonly model: TableModel;
  readonly plan: TablePlan;
  readonly cues: SceneFrame["cues"];
  readonly focus: string;
  readonly hover: string | null;
  readonly desc: Description;
}

/** How much of its history the stage keeps for `inspect` (recaps, sets taken): the newest this many. */
const HISTORY = 64;

export interface StageOptions {
  readonly reducedMotion?: boolean;
  /** The labels' text widths (labels.ts); an estimate without one. */
  readonly measure?: Measure;
}

export class Stage {
  private desc: Description | null = null;
  private described: DescribedFrom | null = null;
  private model: TableModel | null = null;
  private plan: TablePlan | null = null;
  private readonly actors = new Map<string, ActorState>();
  private readonly flights = new Flights({ actors: this.actors, desc: () => this.desc, plan: () => this.plan, model: () => this.model });
  private readonly members = new Membership();
  private readonly backlog = new Backlog();
  private lastSeq = -Infinity;
  private reflowAt = 0;
  private nextAt = 0;
  private moveMs: number = DURATION.move;
  private focusKey = "";
  private consumed: { rev: string; seq: number } | null = null;
  private readonly recaps: Recap[] = [];
  private lastDepartures: FlightPlan[] = [];
  private readonly taken: { seq: number; how: "played" | "compressed" | "collapsed" | "cut"; at: Ms }[] = [];
  private faces = new Map<CardId, FaceSpec>();
  private now = 0;
  private cuts = 0;
  private bolts: { id: string; attacker: CardId; seat: SeatId; via: V3 | null; t0: Ms; colours: string[] }[] = [];
  private strikes: StrikeView[] = [];
  private reduced = false;
  /** Each page's turn as last drawn, and until when its edge is still changing hands (the view's 300 ms handover). */
  private readonly pageTurns = new Map<string, boolean>();
  private readonly inks = new Map<string, string>();
  private handoffUntil = -Infinity;
  /** Each stack card's focus as last drawn (its printed face fades in and out over `motion.stackPrint`). */
  private readonly stackUps = new Map<string, boolean>();
  /** The stack's scrim easing toward the description's: where it set off from, when, and to what. */
  private scrimFade = { from: 0, to: 0, at: 0 as Ms };

  constructor(private readonly opts: StageOptions = {}) {}

  /** Forget everything: the next frame is a cut (a lost context, a renderer fault). */
  reset(): void {
    this.desc = null;
    this.described = null;
    this.actors.clear();
    this.flights.drop();
    this.faces.clear();
    this.backlog.drain();
  }

  show(frame: SceneFrame, now: Ms): { report: SceneReport; view: StageView } {
    const t = Math.max(now, this.now);
    this.now = t;
    const reduced = frame.reducedMotion ?? this.opts.reducedMotion ?? false;
    this.reduced = reduced;
    const recaps: Recap[] = [];
    const landed: MomentId[] = [];
    const me = frame.model.viewer.perspective;
    const mine = (id: CardId) => frame.model.cards.get(id)?.controller === me;
    // Seqs only rise within an epoch: a frame whose newest set is older than one already seen starts a new epoch (a
    // new game, a restart): what waited is dropped and the table cuts.
    const newest = frame.changes.reduce((m, c) => Math.max(m, c.seq), -Infinity);
    const epoch = frame.changes.length > 0 && newest < this.lastSeq;
    if (epoch) {
      this.backlog.drain();
      this.lastSeq = -Infinity;
      this.consumed = null; // the old epoch's seqs say nothing about the new one's
    }
    const fresh = frame.changes.filter((c) => c.seq > this.lastSeq);
    for (const set of fresh) {
      this.backlog.push(set, t);
      this.lastSeq = set.seq;
    }
    const latest = this.describe(frame);
    // Cards the chrome holds whose sets wait: taken by a cut (or a collapse) rather than played, they are handed off.
    const holding = this.holding(frame);
    const reset = fresh.some((s) => s.changes.some((c) => c.t === "reset"));
    let cut = frame.mode === "cut" || this.desc === null || reset || epoch;
    let played = false;
    if (!cut) {
      const take = this.backlog.take(t, t >= this.nextAt);
      if (take?.how === "collapse") {
        cut = true;
        for (const s of take.sets) {
          recaps.push(...mustNotMiss(s, me, mine, "collapsed"));
          this.took(s.seq, s.rev, "collapsed", t);
        }
      } else if (take) {
        const pace: Pace = { compressed: take.how === "compressed", reduced };
        if (pace.compressed) recaps.push(...mustNotMiss(take.set, me, mine, "compressed"));
        this.start(take.set, pace, latest, frame, t);
        this.took(take.set.seq, take.set.rev, pace.compressed ? "compressed" : "played", t);
        played = true;
      }
    }
    if (cut) {
      for (const s of this.backlog.drain()) this.took(s.seq, s.rev, "cut", t);
      this.cutTo(latest, frame, t);
      this.handOff(holding, latest, frame, t, reduced);
    } else this.adopt(latest, frame, t, played, reduced);
    this.recaps.push(...recaps);
    if (this.recaps.length > HISTORY) this.recaps.splice(0, this.recaps.length - HISTORY);
    this.flights.step(t, landed);
    landed.push(...this.flights.takeDropped());
    const view = this.render(t, new Set(this.holding(frame).map((m) => m.card)));
    const top = frame.plan.stack[0];
    const report: SceneReport = {
      active: this.active(),
      consumed: this.consumed?.rev ?? null,
      consumedSeq: this.consumed?.seq ?? null,
      landed,
      stackLanding: top ? quadScreenPose(top.quad) : null,
      fault: null,
      recaps,
      flying: this.flights.carriesAny() || this.backlog.movesAny(),
      // (Reduced motion holds every effect still: nothing moves on its own. A bolt is motion, and keeps `active`.)
      ambient: !reduced && (view.lanes.length > 0 || view.aims.length > 0 || this.ambientPieces()),
    };
    return { report, view };
  }

  /** The table's description for a frame: the last one again when nothing it is made from changed (most frames). */
  private describe(frame: SceneFrame): Description {
    const focus = tableFocusKey(frame.focus);
    const d = this.described;
    if (d && d.model === frame.model && d.plan === frame.plan && d.cues === frame.cues && d.focus === focus && d.hover === frame.hover) return d.desc;
    const desc = describe({ model: frame.model, plan: frame.plan, cues: frame.cues, focus: frame.focus, hover: frame.hover, ...(this.opts.measure ? { measure: this.opts.measure } : {}) });
    this.described = { model: frame.model, plan: frame.plan, cues: frame.cues, focus, hover: frame.hover, desc };
    return desc;
  }

  active(): boolean {
    return (
      this.flights.size > 0 ||
      this.backlog.size > 0 ||
      this.bolts.length > 0 ||
      this.strikes.length > 0 ||
      this.now < this.handoffUntil ||
      this.scrimAt(this.now) !== this.scrimFade.to ||
      [...this.actors.values()].some((a) => a.actor.moving() || a.into !== null)
    );
  }

  /**
   * Something drawn with an effect that moves on its own: a mark's embers, a well's breathing glow, a spell crackling. A
   * spent well is a still stain; a piece not drawn (a fold's member) moves nothing.
   */
  private ambientPieces(): boolean {
    for (const st of this.actors.values()) {
      const p = st.piece;
      if (p.kind === "hidden" || (p.needsMembers && st.shown.length === 0)) continue;
      if (p.mark) return true;
      if (p.draw.t === "stack") return true;
      if (p.draw.t === "unit" && p.draw.well !== null && !p.draw.well.spent) return true;
    }
    return false;
  }

  // ---- bolts ----------------------------------------------------------------------------------------------------------

  /**
   * Combat damage from attackers nobody blocked, exactly the life lost (h.js `buildBoard`): each strikes the plaque, a
   * bolt from the attacker through where its lane landed (an open gap in the row) on to the plaque, so whose blow it was
   * reads, not only that life went. Any other loss (life paid, a spell) has no bolt.
   */
  private strike(set: SceneFrame["changes"][number], frame: SceneFrame, t: Ms): void {
    // A player who loses life is struck: the blow lands on their plaque as its number changes (any loss, any cause).
    for (const c of set.changes)
      if (c.t === "life" && c.to < c.from)
        this.strikes.push({
          id: `strike:${c.seat}:${set.seq}`,
          plate: `plate:${c.seat}`,
          t0: t,
          seed: set.seq * 31 + c.from - c.to,
        });
    const m = frame.model,
      combat = m.combat ?? this.model?.combat ?? null;
    if (!combat || !/DAMAGE/.test(m.phase)) return;
    for (const c of set.changes) {
      if (c.t !== "life" || c.to >= c.from) continue;
      const by = combat.attackers.filter((a) => a.defending === c.seat && a.defender !== null && "seat" in a.defender && !combat.blockers.some((b) => b.attacker === a.attacker) && m.cards.has(a.attacker));
      const power = by.reduce((n, a) => n + Math.max(0, m.cards.get(a.attacker)?.power ?? 0), 0);
      if (!by.length || power !== c.from - c.to) continue;
      for (const a of by) {
        const lane = this.desc?.lanes.find((l) => l.attacker === a.attacker);
        const via = lane && "at" in lane.to ? lane.to.at : null;
        this.bolts.push({ id: `bolt:${a.attacker}:${set.seq}`, attacker: a.attacker, seat: c.seat, via, t0: t, colours: [inkOf(m, m.cards.get(a.attacker)?.controller ?? null), "#fff0c0"] });
      }
    }
  }

  private boltViews(t: Ms): BoltView[] {
    this.bolts = this.bolts.filter((b) => t - b.t0 < BOLT_MS);
    const out: BoltView[] = [];
    for (const b of this.bolts) {
      const home = this.members.homeOf(b.attacker);
      const src = home ? this.actors.get(home) : undefined, plate = this.actors.get(`plate:${b.seat}`);
      if (!src || !plate) continue;
      out.push({ id: b.id, points: boltPath(groundAt(src.actor.now, { x: 0, y: 0, z: 0 }), b.via, plate.actor.now.pos), colours: b.colours, k: (t - b.t0) / BOLT_MS });
    }
    return out;
  }

  private took(seq: number, rev: string, how: "played" | "compressed" | "collapsed" | "cut", at: Ms): void {
    this.taken.push({ seq, how, at });
    if (this.taken.length > HISTORY) this.taken.shift();
    if (!this.consumed || seq > this.consumed.seq) this.consumed = { rev, seq };
  }

  // ---- taking a change set ------------------------------------------------------------------------------------------

  private context(latest: Description, frame: SceneFrame): PlanContext {
    return {
      model: frame.model,
      desc: latest,
      homeOf: (card) => this.members.homeOf(card),
      poseOf: (id) => this.actors.get(id)?.actor.now ?? latest.pieces.get(id)?.pose ?? null,
      shownOf: (id) => this.actors.get(id)?.shown ?? [],
      moments: frame.moments,
    };
  }

  private start(set: SceneFrame["changes"][number], pace: Pace, latest: Description, frame: SceneFrame, t: Ms): void {
    const ctx = this.context(latest, frame);
    const plans = planFlights(set, ctx);
    const inputs: ScheduleInput[] = plans.map((f) => {
      const from = f.origin.from === "piece" ? this.actors.get(f.origin.piece) : undefined;
      const to = f.dest.to === "pile" || f.dest.to === "piece" ? latest.pieces.get(f.dest.piece) : undefined;
      const maker = f.origin.from === "maker" ? this.actors.get(f.origin.piece) : undefined;
      return {
        flight: f,
        pileLift: !!from && from.piece.kind === "unit" && from.shown.length > 1,
        big: f.motion === "spell" && !!from && isBig(from.actor.now.s, to?.pose.s ?? 1),
        afterAbility: !!maker && maker.piece.draw.t === "stack" && maker.piece.draw.ability,
      };
    });
    const tl = schedule(inputs, pace);
    tl.flights.forEach((s, i) => this.flights.launch(s, set.seq, t + s.start, s.dur, s.lift, inputs[i]!.big, t));
    this.reflowAt = t + tl.reflow;
    this.nextAt = t + tl.p2;
    this.moveMs = paced(DURATION.move, pace);
    this.lastDepartures = plans.filter((p) => p.departure);
    this.strike(set, frame, t);
    // Faces of cards that leave the model while they fly (a token, a card to a library) are kept for their piles' holds.
    for (const p of plans) if (p.card !== null && p.face) this.faces.set(p.card, p.face);
  }

  /**
   * The cards the chrome still draws (a moment it owns) that a set the stage has not taken moves, with no flight yet:
   * the stage draws them nowhere until it takes that set (docs "Moments across both renderers").
   */
  private holding(frame: SceneFrame): MomentView[] {
    return frame.moments.filter((m) => m.owner === "chrome" && !this.flights.carries(m.card) && this.backlog.moves(m.card));
  }

  /** Held cards whose sets a cut took: each flies from its carried pose, as the played set would have flown it. */
  private handOff(held: readonly MomentView[], latest: Description, frame: SceneFrame, t: Ms, reduced: boolean): void {
    if (!held.length) return;
    const plans = handOffFlights(held, this.context(latest, frame));
    const tl = schedule(plans.map((f) => ({ flight: f, pileLift: false, big: false, afterAbility: false })), { compressed: false, reduced });
    const seq = this.consumed?.seq ?? 0;
    for (const f of tl.flights) this.flights.launch(f, seq, t + f.start, f.dur, f.lift, false, t);
  }

  // ---- reconciling actors with the latest description --------------------------------------------------------------

  private adopt(latest: Description, frame: SceneFrame, t: Ms, played: boolean, reduced: boolean): void {
    this.desc = latest;
    this.model = frame.model;
    this.plan = frame.plan;
    const focusKey = tableFocusKey(frame.focus);
    const focused = focusKey !== this.focusKey;
    this.focusKey = focusKey;
    const pace: Pace = { compressed: false, reduced };
    const dur = played ? this.moveMs : paced(focused ? DURATION.focus : DURATION.decision, pace);
    const gate = Math.max(t, this.reflowAt);
    /** A look's own change (a mark, a tap, a dim): reduced motion shortens it like any other. */
    const look = paced(DURATION.tap, pace);
    const steps = this.fightSteps(latest, pace);
    for (const piece of latest.pieces.values()) {
      let st = this.actors.get(piece.id);
      if (!st) {
        const src = this.adoptable(piece, latest);
        if (src) {
          this.actors.delete(src.id);
          src.id = piece.id;
          this.actors.set(piece.id, src);
          st = src;
        }
      }
      if (!st) {
        this.actors.set(piece.id, this.create(piece, t, gate, dur));
        continue;
      }
      const wasStack = st.piece.kind === "stack";
      st.piece = piece;
      st.remnant = false;
      st.into = null;
      const step = steps.get(piece.id);
      this.retarget(st, sampleOf(piece), piece.kind === "stack" ? t : gate, step ? Math.max(dur, step.dur) : dur, t, wasStack && piece.kind === "stack", look, step?.path);
    }
    const held = this.flights.heldBy();
    for (const st of [...this.actors.values()]) {
      if (latest.pieces.has(st.id)) continue;
      if (st.into !== null) {
        if (t >= st.intoEnd) this.actors.delete(st.id);
        continue;
      }
      if ((held.get(st.id) ?? []).length) {
        st.remnant = true;
        continue;
      }
      // A sifted card goes back into the pile it came from (h.js `unsift`), wherever that pile is by then.
      const back = st.piece.draw.t === "sift" && this.actors.has(st.piece.draw.from) ? st.piece.draw.from : null;
      const into = back ?? (st.shown.length && st.piece.kind === "unit" ? this.foldTarget(st, latest) : null);
      if (into) {
        st.into = into;
        st.intoEnd = gate + paced(back ? DURATION.unsift : Math.max(DURATION.into, this.moveMs), pace);
        const dest = this.actors.get(into);
        const far = !back && dest ? Math.abs(dest.actor.now.pos.x - st.actor.now.pos.x) > 0.716 * st.actor.now.s * PATH.intoHopPast : false;
        const up = this.plan.projector.up;
        st.actor.go(
          {
            t0: gate,
            dur: st.intoEnd - gate,
            path: { k: "hop", hop: far ? st.actor.now.s * PATH.intoHop : 0, up },
            to: () => {
              const d = this.actors.get(into);
              return d ? { ...plain(d.actor.now), fade: d.actor.now.fade } : st.actor.now;
            },
            commit: false,
          },
          "replace",
        );
        continue;
      }
      this.actors.delete(st.id);
    }
  }

  /** An actor that is no longer described and shows most of this piece's cards (a pile re-keyed when its top changed). */
  private adoptable(piece: Piece, latest: Description): ActorState | null {
    if (piece.kind !== "unit" || !piece.members.length) return null;
    let best: ActorState | null = null,
      n = 0;
    for (const st of this.actors.values()) {
      if (latest.pieces.has(st.id) || st.piece.kind !== "unit" || st.into !== null) continue;
      const k = st.shown.filter((id) => piece.members.includes(id)).length;
      if (k > n) {
        best = st;
        n = k;
      }
    }
    return best;
  }

  /** The one described piece every card this actor shows went into (a pile it folds into), or null. */
  private foldTarget(st: ActorState, latest: Description): string | null {
    const homes = new Set(st.shown.map((id) => latest.home.get(id)));
    if (homes.size !== 1) return null;
    const [home] = [...homes];
    const p = home ? latest.pieces.get(home) : undefined;
    return p && p.kind === "unit" && this.actors.has(p.id) ? p.id : null;
  }

  private create(piece: Piece, t: Ms, gate: Ms, dur: number): ActorState {
    const target = sampleOf(piece);
    const st: ActorState = { id: piece.id, piece, actor: new Actor(target, t), remnant: false, into: null, intoEnd: 0, shown: [] };
    const inbound = this.flights.boundFor(piece.id);
    if (piece.draw.t === "scrim") {
      // The shade comes up over the table as the cards rise.
      st.actor.snap({ ...target, alpha: 0 });
      st.actor.go({ t0: t, dur: paced(DURATION.sift, { compressed: false, reduced: this.reduced }), path: { k: "ease", ease: "sine" }, to: () => target, commit: false }, "replace");
      return st;
    }
    if (piece.draw.t === "sift") {
      // Out of its pile, rising as it goes, a little staggered (h.js `sift`: lerp with a lift of 0.6 at the middle).
      const src = this.actors.get(piece.draw.from);
      if (!src) return st;
      const n = [...(this.desc?.pieces.values() ?? [])].filter((p) => p.draw.t === "sift").length || 1;
      const i = [...(this.desc?.pieces.keys() ?? [])].filter((k) => k.startsWith("sift:") && k !== "sift:scrim").indexOf(piece.id);
      const dur = paced(DURATION.sift, { compressed: false, reduced: this.reduced });
      st.actor.snap({ ...target, pos: src.actor.now.pos, rx: -Math.PI / 2, ry: 0, s: src.actor.now.s * 0.9 });
      st.actor.go(
        { t0: t + (this.reduced ? 0 : (Math.max(0, i) * dur * 0.3) / n), dur, path: { k: "hop", hop: 0.6, up: this.plan!.projector.up }, to: () => target, commit: false },
        "replace",
      );
      return st;
    }
    if (piece.kind !== "unit" && piece.kind !== "stack") return st;
    if (piece.needsMembers && piece.members.every((id) => inbound.has(id))) return st; // it appears as its cards land
    // A card that was shown elsewhere (a fighter out of its pile, a card changing seats) emerges from there.
    const from = piece.members.map((id) => this.members.homeOf(id)).find((a) => a !== null && a !== piece.id);
    const src = from ? this.actors.get(from) : undefined;
    let start: Sample | null = src ? { ...target, pos: src.actor.now.pos, rx: src.actor.now.rx, ry: src.actor.now.ry, s: src.actor.now.s } : null;
    let path: PathSpec = { k: "ease", ease: "sine" };
    if (!start && piece.kind === "stack" && piece.face !== null) {
      // An ability rises off its source where it stands (h.js: `was[s.card].pos + (0, .8, 0)`), at half size.
      const at = this.members.homeOf(piece.face);
      const a = at ? this.actors.get(at) : undefined;
      if (a) {
        start = { ...target, pos: { ...a.actor.now.pos, y: a.actor.now.pos.y + PATH.ability }, s: target.s * PATH.castFrom };
        path = { k: "cast", via: "line", arc: PATH.castArc, up: this.plan!.projector.up };
      }
    }
    if (!start && piece.kind === "unit" && piece.seat !== null) {
      // New to the table with nothing to come from: from its controller's plate at half size (h.js `plateAt`).
      const plate = this.actors.get(`plate:${piece.seat}`);
      if (plate) start = { ...target, ...atPlate(plate.actor.now, PATH.entrySize) };
    }
    if (!start) return st;
    st.actor.snap(start);
    st.actor.go({ t0: piece.kind === "stack" ? t : gate, dur: piece.kind === "stack" ? this.moveMs : dur, path, to: () => target, commit: piece.kind === "stack" }, "replace");
    return st;
  }

  /**
   * The fighters stepping out to the combat row or home from it (h.js `layout`): each crosses its own page's depth and
   * then the open middle, hopping over what it passes, and fighters from one seat set off one after another, the one
   * nearest the fight first, so two leaving one place never travel as one.
   */
  private fightSteps(latest: Description, pace: Pace): Map<string, { path: PathSpec; dur: number }> {
    const out = new Map<string, { path: PathSpec; dur: number }>();
    const plan = this.plan;
    if (!plan) return out;
    const movers: { id: string; seat: string; out: boolean; far: number; ahead: number }[] = [];
    for (const piece of latest.pieces.values()) {
      const st = this.actors.get(piece.id);
      if (!st || piece.kind !== "unit" || !!st.piece.fight === !!piece.fight) continue;
      const from = st.actor.now.pos, to = piece.pose.pos;
      const far = Math.hypot(to.x - from.x, to.z - from.z);
      if (far < 0.3) continue;
      movers.push({ id: piece.id, seat: String(piece.seat), out: !!piece.fight, far, ahead: -Math.abs(from.z - to.z) });
    }
    const dur = paced(DURATION.move, pace);
    for (const seat of new Set(movers.map((m) => m.seat))) {
      const ms = movers.filter((m) => m.seat === seat).sort((a, b) => (Math.abs(a.ahead - b.ahead) > 0.3 ? b.ahead - a.ahead : b.far - a.far));
      ms.forEach((m, n) => {
        const wait = pace.reduced || pace.compressed || ms.length < 2 ? 0 : Math.min(0.45, 0.45 / (ms.length - 1)) * n;
        out.set(m.id, { path: { k: "fight", out: m.out, hop: Math.min(0.9, m.far * 0.12), up: plan.projector.up, wait }, dur });
      });
    }
    return out;
  }

  private retarget(st: ActorState, to: Sample, gate: Ms, dur: number, t: Ms, shift: boolean, look: Ms, stepPath?: PathSpec): void {
    const cur = st.actor.target();
    // (A lift alone, a hover's, is a change too: the lift springs toward the target's.)
    if (sameSample(cur, to) && cur.lift === to.lift) return;
    const samePose = sameSample({ ...cur, fade: 0, tap: 0, glow: 0, alpha: 1, lift: 0 }, { ...to, fade: 0, tap: 0, glow: 0, alpha: 1, lift: 0 });
    const mode = st.actor.committed(t) ? "after" : "replace";
    if (samePose) {
      // Only its look changed (a mark, a tap, a dim): at once, on its own short ease, without restarting a move.
      const p = st.actor.progress(t);
      const left = p ? Math.max(0, p.end - t) : 0;
      st.actor.go({ t0: t, dur: Math.max(look, left), path: { k: "ease", ease: "sine" }, to: () => to, commit: false }, mode);
      return;
    }
    // A stack card already standing moves over for what came on top in the first half of the newcomer's flight.
    const path: PathSpec = stepPath ?? { k: "ease", ease: shift ? "early" : "sine" };
    st.actor.go({ t0: gate, dur, path, to: () => to, commit: false }, mode);
  }

  private cutTo(latest: Description, frame: SceneFrame, t: Ms): void {
    this.desc = latest;
    this.model = frame.model;
    this.plan = frame.plan;
    this.flights.drop();
    this.faces.clear();
    for (const piece of latest.pieces.values()) {
      const st = this.actors.get(piece.id);
      if (st) {
        st.piece = piece;
        st.remnant = false;
        st.into = null;
        st.actor.snap(sampleOf(piece));
      } else this.actors.set(piece.id, { id: piece.id, piece, actor: new Actor(sampleOf(piece), t), remnant: false, into: null, intoEnd: 0, shown: [] });
    }
    for (const id of [...this.actors.keys()]) if (!latest.pieces.has(id)) this.actors.delete(id);
    this.reflowAt = this.nextAt = t;
    this.focusKey = tableFocusKey(frame.focus);
    this.cuts++;
  }

  // ---- what to draw -------------------------------------------------------------------------------------------------

  /** A piece's face and its key, derived again only when its card, its mark or the model changed. */
  private faceOf(st: ActorState, card: CardId | null, mark: Piece["mark"]): FaceMemo | null {
    if (card === null) return null;
    const c = this.model?.cards.get(card);
    const src = c ?? this.faces.get(card);
    if (!src) return null;
    const m = st.face;
    if (m && m.src === src && m.mark === mark && m.model === this.model) return m;
    const face = c ? faceOfCard(this.model!, c, mark) : (src as FaceSpec);
    st.face = { src, mark, model: this.model, face, key: faceKey(face) };
    return st.face;
  }

  private render(t: Ms, away: ReadonlySet<CardId>): StageView {
    this.members.reconcile(this.actors.values(), this.flights.inbound(), this.flights.heldBy(), away);
    const actors: ActorView[] = [];
    const drawn = new Map<string, DrawnPiece>();
    for (const st of this.actors.values()) {
      const p = st.piece;
      const sample = st.actor.step(t);
      if (p.kind === "hidden") continue;
      // A piece showing none of its cards (on their way to it, or still the chrome's) is not there to be tapped.
      const target = st.actor.target();
      const rest = p.base ? { ...target, ...p.base } : target;
      if (p.draw.t === "page") {
        // The turn's edge moving to another page: the view fades it over its handover, so the frames keep coming.
        const was = this.pageTurns.get(st.id);
        if (was !== undefined && was !== p.draw.turn && !this.reduced) this.handoffUntil = t + motion.turnHandoff;
        this.pageTurns.set(st.id, p.draw.turn);
      }
      if (p.draw.t === "account") {
        // Ink that changed is wet (red) until it dries: the view fades it on the clock, so the frames keep coming.
        const was = this.inks.get(st.id);
        if (was !== undefined && was !== p.mods && !this.reduced) this.handoffUntil = Math.max(this.handoffUntil, t + motion.inkDries);
        this.inks.set(st.id, p.mods);
      }
      if (p.draw.t === "stack") {
        // The printed card crossing over the painted face as it rises or is set aside: the view fades it on the clock.
        const was = this.stackUps.get(st.id);
        if (was !== p.draw.up && !this.reduced) this.handoffUntil = Math.max(this.handoffUntil, t + motion.stackPrint);
        this.stackUps.set(st.id, p.draw.up);
      }
      const sift = p.draw.t === "sift" ? { sift: { card: p.draw.card, seat: p.seat, roll: siftRoll(p.draw.tapped, sample.alpha) } } : {};
      drawn.set(st.id, { now: sample, rest, pickable: !(p.members.length > 0 && st.shown.length === 0), ...sift });
      const faceCard = p.kind === "zone" ? (st.shown[st.shown.length - 1] ?? null) : p.kind === "unit" ? (st.shown.includes(p.face!) ? p.face : (st.shown[0] ?? p.face)) : p.face;
      const fm = this.faceOf(st, faceCard, p.mark);
      const face = fm?.face ?? null;
      // Its Auras and Equipment are drawn once they have arrived, and never counted in its title.
      const dressedAll = p.draw.t === "unit" ? p.draw.dressed : [];
      const dressed = dressedAll.filter((d) => st.shown.includes(d.card));
      const count = st.shown.filter((id) => !dressedAll.some((d) => d.card === id)).length;
      const draw = p.draw.t === "unit" ? { ...p.draw, title: retitle(p.draw.title, count), dressed } : p.draw;
      actors.push({
        id: st.id,
        kind: p.kind,
        form: p.form,
        mods: `${p.mods}|${count}|${fm?.key ?? ""}|${dressed.map((d) => d.card).join(",")}`,
        draw,
        mark: p.mark,
        face,
        shown: count,
        sample,
        visible: !p.needsMembers || st.shown.length > 0,
      });
    }
    this.pruneFaces();
    const ghosts = this.flights.ghosts(t);
    // Each lane between where its pieces are now: low over the page, a hand's breadth up, so a standing card in its way
    // hides it rather than it crossing a face (h.js `drawLanes`).
    const lanes: LaneView[] = [];
    for (const l of this.desc?.lanes ?? []) {
      const a = this.actors.get(l.from);
      const b = "piece" in l.to ? this.actors.get(l.to.piece) : undefined;
      if (!a || ("piece" in l.to && !b)) continue;
      const from = groundAt(a.actor.now, l.fromOffset);
      const to = "piece" in l.to ? groundAt(b!.actor.now, l.to.offset) : l.to.at;
      lanes.push({ id: l.id, points: lanePath(from, to, l.apex), colour: l.colour, blocked: l.blocked });
    }
    const bolts = this.boltViews(t);
    this.strikes = this.strikes.filter((x) => t - x.t0 < STRIKE_MS);
    const strikes = this.strikes.filter((x) => this.actors.has(x.plate));
    // Each aim between where its two pieces are now, once its spell has landed on the stack (held dark while it flies in).
    const aims: AimView[] = [];
    for (const a of this.desc?.aims ?? []) {
      const f = this.actors.get(a.from),
        to = this.actors.get(a.to);
      if (!f || !to || !this.plan || f.actor.moving() || (f.piece.needsMembers && !f.shown.length)) continue;
      const up = f.piece.draw.t === "stack" && f.piece.draw.up;
      aims.push({ id: a.id, points: aimPath(this.plan.projector, f.actor.now, to.actor.now, a.onto, up), colours: a.colours, faint: a.faint, flare: a.onto === "card" });
    }
    return {
      actors,
      ghosts,
      lanes,
      bolts,
      strikes,
      aims,
      tableTone: this.desc?.tableTone ?? 1,
      scrim: this.scrimTo(this.desc?.scrim ?? 0, t),
      above: this.desc?.above ?? new Set(),
      drawn,
      now: t,
      still: this.reduced,
    };
  }

  /** The scrim's alpha at `t`: eased toward the description's (in over SCRIM.inMs, out over SCRIM.outMs; reduced motion
   * cuts). */
  private scrimAt(t: Ms): number {
    const f = this.scrimFade;
    const ms = f.to > f.from ? SCRIM.inMs : SCRIM.outMs;
    if (this.reduced || f.from === f.to || t - f.at >= ms) return f.to;
    const k = Math.max(0, (t - f.at) / ms);
    return f.from + (f.to - f.from) * (1 - (1 - k) * (1 - k));
  }

  private scrimTo(target: number, t: Ms): number {
    if (target !== this.scrimFade.to) this.scrimFade = { from: this.scrimAt(t), to: target, at: t };
    return this.scrimAt(t);
  }

  /** Fallback faces live only while a flight or a remnant still shows a card the model no longer has. */
  private pruneFaces(): void {
    if (!this.faces.size) return;
    const flying = this.flights.cards();
    for (const id of this.faces.keys()) if (this.model?.cards.has(id) || (!flying.has(id) && !this.members.shows(id))) this.faces.delete(id);
  }

  // ---- inspect ------------------------------------------------------------------------------------------------------

  inspect(): SceneSnapshot {
    const t = this.now;
    const pieces: PieceSnapshot[] = [...this.actors.values()].map((st) => ({
      id: st.id,
      kind: st.piece.kind,
      seat: st.piece.seat,
      members: st.remnant ? [] : st.piece.members,
      shown: st.shown,
      visible: st.piece.kind !== "hidden" && (!st.piece.needsMembers || st.shown.length > 0),
      remnant: st.remnant,
      form: st.piece.form,
      mods: st.piece.mods,
      now: st.actor.now,
      target: st.piece.pose,
      moving: st.actor.moving() || st.into !== null,
    }));
    const flights = this.flights.snapshot(t);
    return {
      now: t,
      pieces,
      flights,
      backlog: { waiting: this.backlog.waiting(t), consumed: this.consumed?.rev ?? null, consumedSeq: this.consumed?.seq ?? null, taken: [...this.taken] },
      recaps: [...this.recaps],
      departures: this.lastDepartures,
      cuts: this.cuts,
      faces: this.faces.size,
    };
  }
}
