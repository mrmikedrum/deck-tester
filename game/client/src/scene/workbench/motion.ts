// The workbench's motion page (`workbench.html?only=motion`): the protocol corpus played through the real scene, one
// envelope at a time, so the stage's choreography can be watched: play, pause, step, back, slow motion, reduced motion.
// `?manual` stops the clock: time moves only through `__motion.advance(ms)`, so tools take frame-exact screenshots.
import { planTable, tableInputOf } from "../../layout";
import type { TablePlan } from "../../layout";
import { decodeCatalog, diff, modelOf, playerViewer } from "../../model";
import type { CardCatalog, ChangeSet, TableModel } from "../../model";
import type { BoardCues, Mark } from "../../play";
import type { CardId } from "../../protocol";
import { frame } from "../../platform";
import { decodeSnapshot } from "../../protocol";
import { NO_FOCUS } from "../stage";
import type { FocusTop, SceneFrame, SceneReport } from "../stage";
import { createScene } from "../three";
import type { SceneHandle } from "../three";

const VIEWPORT = { w: 1180, h: 820 };
const NO_CUES: BoardCues = { stop: null, marks: { cards: new Map(), seats: new Map(), hand: new Set() }, combat: null, handAway: false };
/** Playing, the next envelope comes this long after the table has come to rest. */
const PAUSE_AT_REST = 700;

const envelopes = import.meta.glob<unknown>("../../../../../tests/fixtures/protocol/0*.json", { import: "default" });
const catalogFile = import.meta.glob<unknown>("../../../test/model/catalog.json", { import: "default" });

interface Step {
  readonly name: string;
  readonly model: TableModel;
  readonly plan: TablePlan;
  readonly set: ChangeSet;
}

/**
 * Demonstration cues, so marks can be looked at: my untapped permanents are options (the first one chosen), whatever
 * the stack aims at is in danger, and the other seats' plates are options.
 */
function demoCues(model: TableModel): BoardCues {
  const me = model.viewer.perspective;
  const cards = new Map<CardId, Mark>();
  for (const c of model.cards.values()) if (c.zone === "battlefield" && c.controller === me && !c.tapped) cards.set(c.id, "option");
  const first = [...cards.keys()][0];
  if (first !== undefined) cards.set(first, "selected");
  for (const it of model.stack) for (const t of it.targets) if ("card" in t) cards.set(t.card, "danger");
  const seats = new Map(model.seats.filter((x) => x.id !== me && !x.out).map((x) => [x.id, "option" as Mark]));
  return { ...NO_CUES, marks: { cards, seats, hand: new Set() } };
}

/**
 * The focus the workbench cycles through: none, the stack, a lean-in on the seat across (or left, or right), a sift of
 * the biggest pile on the table (or my graveyard).
 */
const FOCI = ["none", "stack", "lean", "lean-left", "lean-right", "sift", "sift-graveyard"] as const;
function focusOf(kind: (typeof FOCI)[number], model: TableModel, plan: TablePlan): FocusTop {
  if (kind === "stack") return { ...NO_FOCUS, layer: "stack" };
  if (kind.startsWith("lean")) {
    const i = kind === "lean-left" ? 1 : kind === "lean-right" ? 3 : 2;
    return { ...NO_FOCUS, layer: "lean", seat: model.seats[i]?.id ?? null };
  }
  if (kind === "sift-graveyard") return { ...NO_FOCUS, layer: "sift", group: `zone:graveyard:${model.viewer.perspective}` };
  if (kind === "sift") {
    const g = [...plan.hits.groups].filter((x) => x.members.length > 1).sort((a, b) => b.members.length - a.members.length)[0];
    return g ? { ...NO_FOCUS, layer: "sift", group: g.id } : NO_FOCUS;
  }
  return NO_FOCUS;
}

async function loadRuns(catalog: CardCatalog): Promise<Step[][]> {
  const names = Object.keys(envelopes).sort();
  const runs: Step[][] = [];
  let last = Infinity,
    seq = 0,
    prev: TableModel | null = null,
    kept: TablePlan | null = null;
  for (const path of names) {
    const raw = (await envelopes[path]!()) as Record<string, unknown>;
    const v = Number(raw["v"]);
    if (!(v > last) || !runs.length) {
      runs.push([]);
      prev = null;
      kept = null;
    }
    last = v;
    const decoded = decodeSnapshot(raw);
    if (!decoded.ok) continue;
    const viewer = playerViewer(decoded.value);
    const model = viewer ? modelOf(decoded.value, catalog, viewer) : null;
    if (!model) continue;
    let plan: TablePlan;
    try {
      // The places the last plan kept, fed back as the app feeds its layout memory.
      plan = planTable(tableInputOf(model, { viewport: VIEWPORT, memory: kept?.memory ?? null }));
    } catch {
      continue; // layout cannot plan it yet (the scene's tests list these)
    }
    runs[runs.length - 1]!.push({ name: path.split("/").pop()!, model, plan, set: diff(prev, model, ++seq) });
    prev = model;
    kept = plan;
  }
  return runs.filter((r) => r.length);
}

export async function motion(root: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const manual = params.has("manual");
  const catalogPath = Object.keys(catalogFile)[0];
  const catalog = catalogPath ? decodeCatalog(await catalogFile[catalogPath]!()) : new Map();
  const runs = await loadRuns(catalog);

  const wrap = document.createElement("section");
  wrap.id = "motion";
  const bar = document.createElement("div");
  bar.className = "row";
  bar.style.alignItems = "center";
  const canvas = document.createElement("canvas");
  canvas.id = "stage";
  canvas.style.width = `${VIEWPORT.w}px`;
  canvas.style.height = `${VIEWPORT.h}px`;
  const status = document.createElement("pre");
  status.style.cssText = "font: 12px/1.4 ui-monospace, monospace; color: #a69c8b; margin: 6px 0; white-space: pre-wrap; max-width: 1180px";
  wrap.append(Object.assign(document.createElement("h2"), { textContent: "Motion: the corpus through the stage" }), bar, canvas, status);
  root.append(wrap);

  const scene: SceneHandle = createScene({ canvas, viewport: VIEWPORT, dpr: globalThis.devicePixelRatio || 1 });
  await scene.ready();

  let run = Number(params.get("run") ?? 0) % runs.length;
  let at = Number(params.get("at") ?? 0);
  let playing = params.has("play");
  let speed = Number(params.get("speed") ?? 1);
  let reduced = params.has("reduced");
  let marks = params.has("marks");
  let focus: (typeof FOCI)[number] = (FOCI as readonly string[]).includes(params.get("focus") ?? "") ? (params.get("focus") as (typeof FOCI)[number]) : "none";
  let mode: SceneFrame["mode"] = "cut";
  let pending: ChangeSet[] = [];
  let t = 0;
  let restSince = 0;
  let last: SceneReport | null = null;
  let commit = 0;
  // Change sets are numbered as the app numbers them: one epoch, always rising (going back is a cut, never a replay).
  let seq = 0;

  const current = (): Step => runs[run]![Math.min(at, runs[run]!.length - 1)]!;
  const show = (): SceneReport => {
    const s = current();
    const report = scene.show(
      {
        model: s.model,
        plan: s.plan,
        changes: pending,
        mode,
        cues: marks ? demoCues(s.model) : NO_CUES,
        focus: focusOf(focus, s.model, s.plan),
        moments: [],
        hover: null,
        commit: ++commit,
        reducedMotion: reduced,
      },
      t,
    );
    mode = "animate";
    if (report.consumedSeq !== null) pending = pending.filter((c) => c.seq > report.consumedSeq!);
    last = report;
    return report;
  };
  const describeState = (): void => {
    const snap = scene.inspect();
    const s = current();
    const moved = s.set.changes.filter((c) => c.t === "moved").length;
    status.textContent =
      `run ${run + 1}/${runs.length} · envelope ${at + 1}/${runs[run]!.length} ${s.name} · ${moved} moved · ${s.set.moments.map((m) => m.reading).join(", ")}\n` +
      `t ${Math.round(t)} ms · ${last?.active ? "moving" : "at rest"} · flights ${snap.flights.length} (${snap.flights.filter((f) => f.state === "waiting").length} waiting) · backlog ${snap.backlog.waiting.length} · pieces ${snap.pieces.length} · cuts ${snap.cuts}` +
      (snap.recaps.length ? ` · recaps ${snap.recaps.length}` : "");
  };
  const goto = (r: number, i: number): void => {
    run = ((r % runs.length) + runs.length) % runs.length;
    at = Math.max(0, Math.min(i, runs[run]!.length - 1));
    pending = [];
    mode = "cut";
    show();
    describeState();
  };
  const step = (by = 1): void => {
    const n = runs[run]!.length;
    if (by < 0 || at + by >= n) return goto(run, by < 0 ? at + by : at);
    for (let k = 0; k < by && at + 1 < n; k++) {
      at++;
      pending.push({ ...current().set, seq: ++seq });
    }
    show();
    describeState();
  };
  // (Coarse frames are exact: every leg is a function of time, and the lift spring is solved in closed form.)
  const advance = (ms: number): SceneReport => {
    const frames = Math.max(1, Math.min(6, Math.ceil(ms / 16)));
    let r = last!;
    for (let i = 0; i < frames; i++) {
      t += ms / frames;
      r = show();
    }
    describeState();
    return r;
  };

  const button = (label: string, title: string, on: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title;
    b.style.cssText = "font: 14px Barlow, sans-serif; padding: 4px 10px; background: #2b1d12; color: #f3ece0; border: 1px solid #8a6a3a; border-radius: 6px; cursor: pointer";
    b.addEventListener("click", on);
    bar.append(b);
    return b;
  };
  button("⟲ run", "Next run of the corpus", () => goto(run + 1, 0));
  button("⏮", "Back one envelope (a cut)", () => step(-1));
  const play = button(playing ? "❚❚" : "▶", "Play or pause", () => {
    playing = !playing;
    play.textContent = playing ? "❚❚" : "▶";
  });
  button("⏭", "Next envelope", () => step(1));
  button("⏭⏭", "Two envelopes at once (the backlog)", () => step(2));
  const sp = button(`${speed}×`, "Speed", () => {
    speed = speed === 1 ? 0.25 : speed === 0.25 ? 0.1 : 1;
    sp.textContent = `${speed}×`;
  });
  const mk = button(marks ? "marks ✓" : "marks", "Demonstration marks: options, a choice, danger", () => {
    marks = !marks;
    mk.textContent = marks ? "marks ✓" : "marks";
  });
  const fc = button(`focus: ${focus}`, "Cycle the focus: none, the stack, a lean-in, a sift", () => {
    focus = FOCI[(FOCI.indexOf(focus) + 1) % FOCI.length]!;
    fc.textContent = `focus: ${focus}`;
  });
  const rm = button(reduced ? "reduced ✓" : "reduced", "Reduced motion", () => {
    reduced = !reduced;
    rm.textContent = reduced ? "reduced ✓" : "reduced";
  });

  goto(run, at);
  let wall = 0;
  const tick = (now: number): void => {
    const dt = wall ? Math.min(100, now - wall) : 16;
    wall = now;
    if (!manual) {
      t += dt * speed;
      const r = show();
      if (r.active) restSince = t;
      else if (playing && t - restSince > PAUSE_AT_REST * speed) {
        if (at + 1 < runs[run]!.length) step(1);
        else goto(run + 1, 0);
        restSince = t;
      }
      describeState();
    }
    frame(tick);
  };
  frame(tick);
  Object.assign(globalThis, {
    __motion: {
      scene,
      goto,
      step,
      advance,
      set: (o: { marks?: boolean; focus?: (typeof FOCI)[number]; reduced?: boolean }) => {
        if (o.marks !== undefined) marks = o.marks;
        if (o.focus !== undefined) focus = o.focus;
        if (o.reduced !== undefined) reduced = o.reduced;
      }, runs: () => runs.map((r) => r.map((s) => s.name)), state: () => ({ run, at, t, last }) },
  });
}
