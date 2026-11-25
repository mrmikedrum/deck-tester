// The frame loop: the only place time enters the app. Each frame:
//   1. `now` is the frame's time (never earlier than the last frame's);
//   2. drain every source, in a fixed order: transport, the input sources (renderer intents, keyboard, debug), viewport,
//      the reduced-motion setting;
//   3. add every deadline due by `now`;
//   4. sort by time, ties: input, then snapshots (and the transport's other events), then deadlines;
//   5. fold through update, collecting effects (an event from an older epoch is ignored; a throw is an ingest fault,
//      reported, and the frame goes on); then run the effects against the state the fold ended in (each guarded: a
//      throw is an effect fault, reported, and what it left waiting is released);
//   6. commit once: the renderer shows the whole state at `now`; what the scene reports back (change sets consumed,
//      moments landed, recaps) is folded as a `scene` message in the next frame. The app's notice (faults, a stale
//      build, with Reload) is drawn after it on its own surface, whatever the renderer did.
// Then it wakes: frames while the renderer reports activity, a source has messages, a deadline falls before the next
// frame or a renderer fault wants a recovery commit (at most RENDER_RETRIES in a row; none for a terminal one, which
// raises the notice at once); otherwise idle, with one wake at the earliest deadline, or AMBIENT_MS on while the scene
// reports its idle table still moving on its own (still idle: `settled`). Any arrival on a source asks for a frame at
// once.
import type { Ms, Source, ViewportReading } from "../platform";
import type { ClientLog, NewGameRequest, Transport } from "../transport";
import { dueBy, earliest } from "./deadlines";
import { perform } from "./effects";
import type { Effect } from "./effects";
import { errorText, ingestFault, logEntry, RENDER_RETRIES, renderFault, renderOk, terminalFault } from "./faults";
import { topKey } from "./focus";
import { byTime, fromTransport } from "./msg";
import type { InputMsg, Msg } from "./msg";
import { noticeView } from "./notice";
import type { NoticeSurface } from "./notice";
import type { RenderReport } from "./slots";
import type { AppState } from "./state";
import { committed, effectFailed, sceneNews, tornDown, update as appUpdate } from "./update";
import type { Step } from "./update";

/** A frame within this of a deadline runs it rather than setting a timer. */
const FRAME_MS = 16;
/** An idle table that moves on its own (ambient effects) is drawn this often: about 10 frames a second. */
export const AMBIENT_MS = 100;

export interface Renderer {
  /** Draws the whole state at `now`. A throw is a renderer fault: reported, and the next commit is a cut. */
  show(state: AppState, now: Ms): RenderReport;
  /** Frees what it holds (teardown); a later `show` builds again. */
  dispose(): void;
}

/** The reduced-motion setting changed (platform's `reducedMotionSource`), at `at`. */
export interface MotionReading {
  readonly at: Ms;
  readonly reduced: boolean;
}

export interface Scheduler {
  request(): void;
  wakeAt(at: Ms | null): void;
  dispose(): void;
}

export interface LoopPorts {
  readonly transport: Transport;
  readonly log: ClientLog | null;
  readonly renderer: Renderer;
  /** Renderer intents, keyboard and debug, drained in this order after the transport. */
  readonly inputs?: readonly Source<InputMsg>[];
  readonly viewport?: Source<ViewportReading> | null;
  /** Changes of the reduced-motion setting (the setting at start is the initial state's). */
  readonly motion?: Source<MotionReading> | null;
  /** platform's frameScheduler in the page; a virtual one in tests. */
  readonly scheduler: (run: (now: Ms) => void) => Scheduler;
  /** The router (a test seam; the app's own by default). */
  readonly update?: (s: AppState, m: Msg) => Step;
  /** The app's notice with Reload, drawn after every commit on a surface the renderer does not own. */
  readonly notice?: NoticeSurface | null;
  /** The page's remembered preferences (the last game asked for), best effort. */
  readonly prefs?: { save(req: NewGameRequest): void } | null;
}

export interface Loop {
  /** Starts the transport under the state's epoch and asks for the first frame (the waiting state). */
  start(): void;
  /** Runs one frame at `now` (the scheduler calls it). */
  frame(now: Ms): void;
  /** Asks for a frame: a renderer's own motion changed between commits (a drag moved, a hold began, art arrived). */
  wake(): void;
  /** No frame is wanted: the last commit reported nothing moving, nothing is queued, no deadline is within a frame. */
  settled(): boolean;
  /** Stops the transport, cancels every deadline and moment, disposes the renderer; the epoch moves on. */
  teardown(): void;
  readonly state: AppState;
}

export function createLoop(initial: AppState, ports: LoopPorts): Loop {
  const update = ports.update ?? appUpdate;
  const inputs = ports.inputs ?? [];
  const viewport = ports.viewport ?? null;
  const motion = ports.motion ?? null;
  const sources: Source<unknown>[] = [ports.transport.out, ...inputs, ...(viewport ? [viewport] : []), ...(motion ? [motion] : [])];
  let state = initial;
  let last: Ms = -Infinity;
  let scheduler: Scheduler | null = null;
  /** The last commit's report, when it has news for update: folded in the next frame. */
  let reports: Msg[] = [];
  let idle = false;

  const pending = (): boolean => reports.length > 0 || sources.some((s) => s.size > 0);

  function drain(now: Ms): Msg[] {
    const msgs: Msg[] = [...reports, ...ports.transport.out.drain()];
    reports = [];
    for (const src of inputs) msgs.push(...src.drain());
    if (viewport) for (const r of viewport.drain()) msgs.push({ t: "viewport", ...r });
    if (motion) for (const r of motion.drain()) msgs.push({ t: "motion", ...r });
    for (const d of dueBy(state.deadlines, now)) msgs.push({ t: "deadline", at: d.due, id: d.id, serial: d.serial });
    return msgs.sort(byTime);
  }

  function fold(msgs: readonly Msg[]): Effect[] {
    const effects: Effect[] = [];
    for (const m of msgs) {
      const snapV = m.t === "snapshot" ? m.snap.v : null;
      if (fromTransport(m) && m.epoch < state.epoch) {
        if (snapV !== null) effects.push({ kind: "ack", epoch: state.epoch, v: snapV, ack: "stale" });
        continue;
      }
      try {
        const r = update(state, m);
        state = r.state;
        effects.push(...r.effects);
        if (snapV !== null) effects.push({ kind: "ack", epoch: state.epoch, v: snapV, ack: "took" });
      } catch (e) {
        const message = `${m.t}: ${errorText(e)}`;
        state = { ...state, faults: ingestFault(state.faults, message) };
        effects.push({ kind: "log", epoch: state.epoch, entry: logEntry(state, "error", "ingest.update", message) });
        if (snapV !== null) effects.push({ kind: "ack", epoch: state.epoch, v: snapV, ack: "fault" });
      }
    }
    return effects;
  }

  function commit(now: Ms): RenderReport {
    state = { ...state, commit: state.commit + 1, drawn: { top: topKey(state.focus), stop: state.session.stop } };
    let report: RenderReport;
    try {
      report = ports.renderer.show(state, now);
    } catch (e) {
      report = { active: false, fault: errorText(e), scene: null };
    }
    if (report.fault !== null) {
      state = { ...state, faults: report.terminal ? terminalFault(state.faults, report.fault) : renderFault(state.faults, report.fault, now) };
      ports.log?.report(logEntry(state, "error", "render", report.fault));
    } else state = { ...state, faults: renderOk(state.faults) };
    if (sceneNews(state, report)) reports.push({ t: "scene", at: now, report });
    state = committed(state, report, now);
    try {
      ports.notice?.show(noticeView(state));
    } catch (e) {
      ports.log?.report(logEntry(state, "error", "notice", errorText(e)));
    }
    return report;
  }

  /** Runs the effects, each guarded; a failed one's own follow-ups (its fault's log entry) run after it. */
  function run(effects: readonly Effect[], now: Ms): void {
    const queue = [...effects];
    for (let e = queue.shift(); e; e = queue.shift()) {
      try {
        perform(e, ports, state);
      } catch (err) {
        const r = effectFailed(state, e, errorText(err), now);
        state = r.state;
        queue.push(...r.effects);
      }
    }
  }

  function frame(at: Ms): void {
    if (!scheduler) return;
    const now = Math.max(at, last);
    last = now;
    run(fold(drain(now)), now);
    const report = commit(now);
    const next = earliest(state.deadlines);
    const recover = report.fault !== null && !report.terminal && state.faults.renderStreak <= RENDER_RETRIES;
    idle = !(report.active || pending() || recover || (next !== null && next - now <= FRAME_MS));
    if (!idle) scheduler.request();
    else scheduler.wakeAt(report.ambient ? Math.min(next ?? Infinity, now + AMBIENT_MS) : next);
  }

  const wake = (): void => scheduler?.request();

  return {
    start() {
      if (scheduler) return;
      scheduler = ports.scheduler(frame);
      for (const s of sources) s.listen(wake);
      ports.transport.start(state.epoch);
      scheduler.request();
    },
    frame,
    wake,
    settled: () => idle && !pending(),
    teardown() {
      for (const s of sources) {
        s.listen(null);
        s.drain(); // nothing queued before teardown reaches the next run
      }
      ports.transport.stop();
      scheduler?.dispose();
      scheduler = null;
      reports = [];
      ports.renderer.dispose();
      state = tornDown(state, last === -Infinity ? 0 : last);
    },
    get state() {
      return state;
    },
  };
}
