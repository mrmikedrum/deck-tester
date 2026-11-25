// A headless app for tests: the real loop and router on the scripted transport, a virtual clock, a fake scheduler
// that records requests and wakes, a renderer that records commits (and hands back a scene report the test sets), and a
// client log that records entries.
import type { ClientLogEntry, StopId } from "../../src/protocol";
import { NO_INSETS, Queue } from "../../src/platform";
import type { MotionReading } from "../../src/app/loop";
import type { Ms } from "../../src/platform";
import { scriptedTransport } from "../../src/transport";
import type { AnswerOutcome, ScriptedTransport } from "../../src/transport";
import * as play from "../../src/play";
import type { Carried } from "../../src/play";
import type { SceneReport } from "../../src/scene/stage/types";
import { createLoop } from "../../src/app/loop";
import type { Loop, Renderer, Scheduler } from "../../src/app/loop";
import type { InputMsg, Msg } from "../../src/app/msg";
import type { NoticeSurface } from "../../src/app/notice";
import { readoutLines } from "../../src/app/readout";
import { initialState } from "../../src/app/state";
import type { AppState } from "../../src/app/state";
import type { Step } from "../../src/app/update";
import { chromeView, sceneFrame } from "../../src/app/views";
import { catalog as fixtureCatalog, corpusNames, rawCorpus } from "../model/fixtures";
import { decodeSnapshot } from "../../src/protocol";
import { modelOf, playerViewer } from "../../src/model";
import type { SceneFrame, SceneSnapshot } from "../../src/scene/stage/types";
import { Stage } from "../../src/scene/stage/stage";
import type { ChromeView } from "../../src/chrome";

type Json = Record<string, unknown>;

export const BUILD = "testbuild000";

/** The names the corpus's decisions wait on that the fixtures' catalog lacks (Lightning Bolt): a warm page has asked. */
const ANSWERED: ReadonlySet<string> = new Set(
  corpusNames.flatMap((n) => {
    const r = decodeSnapshot(rawCorpus.get(n));
    const viewer = r.ok ? playerViewer(r.value) : null;
    const model = r.ok && viewer ? modelOf(r.value, fixtureCatalog, viewer) : null;
    return r.ok && model && r.value.decision ? play.cardsWanted(model, r.value.decision) : [];
  }),
);

const OTHERS = ["Atraxa", "Dack", "Princess"] as const;

/** A minimal valid GET /api/view envelope: four seats ("You" first), a `play` decision with `id` unless `decision` is
 * null (pass, or play the Island in hand). */
export function envelope(o: {
  v: number;
  gen?: number | null;
  decision?: number | null;
  /** The bridge's status of the last answer it forwarded; `attempt` absent as from a bridge that predates it. */
  answer?: { id: number; attempt?: number; state: "working" | "applied" | "refused"; error?: string } | null;
  build?: string | null;
  state?: string;
  turn?: number;
  prompt?: string;
}): Json {
  const turn = o.turn ?? 1;
  const label = `T${turn} main1`;
  const decision =
    o.decision === null || o.decision === undefined
      ? null
      : { id: o.decision, kind: "play", turn: label, prompt: o.prompt ?? "", options: ["pass", "Island"], min: 1, max: 1, repeat: false, refs: [{}, { card: 5, spell: true }] };
  const key = decision ? ["play", label, o.prompt ?? "", "2", "pass", "Island"].join("|") : "";
  return {
    state: o.state ?? "playing",
    gen: o.gen === undefined ? 1 : o.gen,
    v: o.v,
    error: null,
    build: o.build === undefined ? null : o.build,
    answer: o.answer
      ? { key, id: o.answer.id, ...(o.answer.attempt === undefined ? {} : { attempt: o.answer.attempt }), state: o.answer.state, error: o.answer.error ?? null }
      : null,
    view: {
      turn,
      label,
      active: "You",
      phase: "MAIN1",
      priority: "You",
      me: "You",
      players: [
        {
          name: "You",
          life: 40,
          library: 90,
          hand: [{ id: 5, name: "Island", owner: "You", controller: "You", type: "Basic Land - Island" }],
          battlefield: [],
          command: [],
          graveyard: [],
          exile: [],
        },
        ...OTHERS.map((name) => ({ name, life: 40, library: 90, handCount: 7, battlefield: [], command: [], graveyard: [], exile: [] })),
      ],
      stack: [],
      log: [{ i: turn * 10, type: "turn", text: `turn ${turn}` }],
    },
    decision,
    over: null,
    pilots: { You: "human", Atraxa: "forge ai", Dack: "forge ai", Princess: "forge ai" },
  };
}

export interface Commit {
  readonly commit: number;
  readonly now: Ms;
  readonly epoch: number;
  readonly lines: readonly string[];
  /** What each renderer was handed (the scene's frame is null while there is nothing to draw). */
  readonly frame: SceneFrame | null;
  readonly view: ChromeView;
  /** The stage's snapshot after it drew this commit (with `stage: true`). */
  readonly inspect: SceneSnapshot | null;
}

export interface Rig {
  readonly loop: Loop;
  readonly transport: ScriptedTransport;
  readonly inputs: Queue<InputMsg>;
  /** The reduced-motion setting's changes. */
  readonly motion: Queue<MotionReading>;
  readonly commits: Commit[];
  readonly logs: ClientLogEntry[];
  readonly sched: { requests: number; requested: boolean; wakes: (Ms | null)[]; disposed: number };
  /** `throwNext` faults the next commit, `throwAll` every commit until cleared; `sceneless`: the scene is not drawing yet
   * (still loading), so it reports nothing and consumes nothing. */
  readonly renderer: {
    active: boolean;
    throwNext: string | null;
    throwAll: string | null;
    disposed: number;
    report: Partial<SceneReport> | null;
    sceneless: boolean;
    /** The next commit reports this as a terminal fault (the scene could not start), once. */
    terminal: string | null;
    /** The next commit's chrome reports these carried cards drawn elsewhere (re-anchored by a resize), once. */
    carried: Carried[] | null;
    /** The next commit reports the idle table moving on its own (the scene's ambient effects), once. */
    ambient: boolean;
  };
  readonly state: AppState;
  /** The real stage (pure, no three.js) drawing every frame, when the rig was made with `stage: true`. */
  readonly stage: Stage | null;
  now: Ms;
  /** One frame at `at` (default: the clock). */
  frame(at?: Ms): void;
  /** Frames every 16 ms while one is requested (at most `max`). */
  settle(max?: number): void;
  /** The player presses the pass button on screen (drawn for `stop`, by default the one on screen) at the clock. */
  act(stop?: StopId | null): void;
  /** Any act, drawn for the stop on screen unless `stop` says otherwise. */
  send(act: play.Act, stop?: StopId | null): void;
  /** The outcome of the n-th answer sent; `attempt`, the bridge's number for it, as its reply carries it. */
  reply(n: number, outcome: AnswerOutcome, attempt?: number): void;
}

export interface RigOptions {
  readonly update?: (s: AppState, m: Msg) => Step;
  readonly clientBuild?: string;
  /** Draw with the real stage, whose reports (consumed sets, landed moments) go back to the app. */
  readonly stage?: boolean;
  /** Answer card requests from this /api/cards body. */
  readonly catalog?: Readonly<Record<string, unknown>>;
  /** Start with no card data at all (a cold cache). By default the page is warm: it holds the fixtures' catalog, and
   * every other name the corpus's decisions wait on has been answered (without data). */
  readonly cold?: boolean;
  /** The app's own notice surface (faults, a stale build), drawn whatever the renderer does. */
  readonly notice?: NoticeSurface;
  /** The page starts with reduced motion asked for. */
  readonly reducedMotion?: boolean;
}

export function rig(o: RigOptions = {}): Rig {
  let now = 0;
  const transport = scriptedTransport({ clock: () => now, ...(o.catalog ? { catalog: o.catalog } : {}) });
  const stage = o.stage ? new Stage() : null;
  const inputs = new Queue<InputMsg>();
  const motion = new Queue<MotionReading>(true);
  const commits: Commit[] = [];
  const logs: ClientLogEntry[] = [];
  const sched = { requests: 0, requested: false, wakes: [] as (Ms | null)[], disposed: 0 };
  const rend = { active: false, throwNext: null as string | null, throwAll: null as string | null, disposed: 0, report: null as Partial<SceneReport> | null, sceneless: false, terminal: null as string | null, carried: null as Carried[] | null, ambient: false };
  const renderer: Renderer = {
    show(state, at) {
      if (rend.throwAll) throw new Error(rend.throwAll);
      if (rend.throwNext) {
        const m = rend.throwNext;
        rend.throwNext = null;
        throw new Error(m);
      }
      // As the page's renderer does: the scene first, then the chrome, told what the scene took this commit.
      const frame = sceneFrame(state);
      const drawn = frame && stage ? stage.show(frame, at).report : null;
      const scene: SceneReport | null = frame && !rend.sceneless
        ? { ...(drawn ?? { active: false, consumed: null, consumedSeq: null, landed: [], stackLanding: null, fault: null, recaps: [], flying: false }), ...rend.report }
        : null;
      rend.report = null;
      const inspect = frame && stage ? stage.inspect() : null;
      commits.push({ commit: state.commit, now: at, epoch: state.epoch, lines: readoutLines(state), frame, view: chromeView(state, scene), inspect });
      const terminal = rend.terminal;
      rend.terminal = null;
      const carried = rend.carried;
      rend.carried = null;
      const ambient = rend.ambient;
      rend.ambient = false;
      if (terminal) return { active: false, fault: terminal, terminal: true, scene: null };
      return { active: rend.active || (drawn?.active ?? false), fault: null, scene, ...(carried ? { carried } : {}), ...(ambient ? { ambient } : {}) };
    },
    dispose() {
      rend.disposed += 1;
    },
  };
  const scheduler = (): Scheduler => ({
    request() {
      sched.requests += 1;
      sched.requested = true;
    },
    wakeAt(at) {
      sched.wakes.push(at);
    },
    dispose() {
      sched.disposed += 1;
    },
  });
  const start = initialState({ clientBuild: o.clientBuild ?? BUILD, viewport: { w: 1180, h: 820, safe: NO_INSETS }, reducedMotion: o.reducedMotion ?? false });
  const loop = createLoop(o.cold ? start : { ...start, catalog: fixtureCatalog, cardAsks: { out: new Map(), done: ANSWERED, failed: new Set() } }, {
    transport,
    log: { report: (e) => logs.push(e), flush: () => undefined, dispose: () => undefined },
    renderer,
    inputs: [inputs],
    motion,
    scheduler,
    ...(o.update ? { update: o.update } : {}),
    ...(o.notice ? { notice: o.notice } : {}),
  });
  const r: Rig = {
    loop,
    transport,
    inputs,
    motion,
    commits,
    logs,
    sched,
    renderer: rend,
    stage,
    get state() {
      return loop.state;
    },
    get now() {
      return now;
    },
    set now(t: Ms) {
      now = t;
    },
    frame(at = now) {
      now = at;
      sched.requested = false;
      loop.frame(at);
    },
    settle(max = 20) {
      for (let i = 0; i < max && sched.requested; i++) r.frame(now + 16);
    },
    act(stop = loop.state.session.stop) {
      const pass = play.present(loop.state.play).controls.prompt?.buttons.find((b) => b.role === "pass");
      r.send({ a: "press", button: pass?.id ?? "pass" }, stop);
    },
    send(act, stop = loop.state.session.stop) {
      inputs.push({ t: "act", stamp: { at: now, commit: loop.state.commit }, stop, act });
    },
    reply(n, outcome, attempt) {
      const sent = transport.answers[n];
      if (!sent) throw new Error(`no answer ${n}`);
      transport.reply(sent.token, outcome, attempt);
    },
  };
  return r;
}
