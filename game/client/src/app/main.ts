// The composition root: fonts, then the app's loop on the real bridge (long polls on relative api/ URLs), committing
// the scene on #stage and the chrome on #ui, the app's notice with Reload, and the tools' surface (`window.__deckmaster`).
// `?script` runs the same app on the scripted transport instead, for the recorder and a person at the console: nothing
// goes to a bridge; envelopes and answer replies come from `__deckmaster.script` (debug.ts). `?script=<url>` first loads
// a scenario from that JSON file: `{ catalog?: {name: entry}, envelopes?: [...], reply?: AnswerOutcome | null }` (the
// catalog answers every card request at once; `reply`, by default `{t: "queued"}`, answers every answer at once; null
// leaves replies to the script).
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import type { AnswerOutcome } from "../protocol";
import { clientBuild, fontsReady, frameScheduler, now, Queue, reducedMotionSource, viewportSource } from "../platform";
import { clientLogSender, longPollTransport, scriptedTransport } from "../transport";
import type { NewGameRequest, ScriptedTransport, Transport } from "../transport";
import { installDebug } from "./debug";
import { createLoop } from "./loop";
import type { Loop, MotionReading } from "./loop";
import type { InputMsg } from "./msg";
import { noticeSurface } from "./notice";
import { pageRenderer } from "./renderer";
import { initialState } from "./state";
import "./app.css";

/** A scenario for `?script=<url>`. */
interface Scenario {
  readonly catalog?: Readonly<Record<string, unknown>>;
  readonly envelopes?: readonly unknown[];
  readonly reply?: AnswerOutcome | null;
}

/** The scripted transport when the page asks for it (`?script`), with its scenario loaded; null for the real bridge. */
async function scripted(): Promise<{ transport: ScriptedTransport; envelopes: readonly unknown[] } | null> {
  const q = new URLSearchParams(globalThis.location?.search ?? "");
  if (!q.has("script")) return null;
  const url = q.get("script");
  let scenario: Scenario = {};
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`scenario ${url}: HTTP ${res.status}`);
    scenario = (await res.json()) as Scenario;
  }
  const reply = scenario.reply === undefined ? { t: "queued" as const } : scenario.reply;
  const transport = scriptedTransport({
    clock: now,
    ...(reply ? { autoReply: reply } : {}),
    ...(scenario.catalog ? { catalog: scenario.catalog } : {}),
  });
  return { transport, envelopes: scenario.envelopes ?? [] };
}

/** Where the page keeps the last game asked for (the old client's key, so a device keeps its choice across clients). */
const LAST_GAME = "seat-game";

/** The last game asked for on this device, or null: best effort (storage may be off, or hold something else). */
function lastGame(): NewGameRequest | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LAST_GAME) ?? "null");
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const opponents = Array.isArray(o["opponents"]) ? o["opponents"].filter((x): x is string => typeof x === "string") : [];
    const mana = o["mana"] === "always" || o["mana"] === "auto" ? o["mana"] : "creatures";
    return typeof o["deck"] === "string" ? { deck: o["deck"], opponents, mana } : null;
  } catch {
    return null;
  }
}

const prefs = {
  save(req: NewGameRequest): void {
    try {
      localStorage.setItem(LAST_GAME, JSON.stringify(req));
    } catch {
      // not remembered: storage is off
    }
  },
};

async function main(): Promise<void> {
  await fontsReady();
  const canvas = document.getElementById("stage");
  const ui = document.getElementById("ui");
  if (!(canvas instanceof HTMLCanvasElement) || !ui) throw new Error("index.html lacks #stage or #ui");
  const script = await scripted();
  const transport: Transport = script ? script.transport : longPollTransport();
  const inputs = new Queue<InputMsg>();
  let loop: Loop | null = null;
  const renderer = pageRenderer({
    canvas,
    ui,
    emit: (m) => inputs.push(m),
    wake: () => loop?.wake(),
    dpr: () => globalThis.devicePixelRatio || 1,
  });
  // Escape dismisses the top layer (focus.ts: the inspector, a sheet, the menu; the stack and the mulligan are set
  // aside), as a tap outside would.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && loop) inputs.push({ t: "dismiss", stamp: { at: now(), commit: loop.state.commit } });
  });
  // Reduced motion: the setting now, and each change of it.
  const reduced = reducedMotionSource(globalThis.window);
  const motion = new Queue<MotionReading>(true);
  reduced.subscribe((r) => motion.push({ at: now(), reduced: r }));
  loop = createLoop(initialState({ clientBuild, lastGame: lastGame(), reducedMotion: reduced.read(), layout: new URLSearchParams(globalThis.location?.search ?? "").get("layout") ?? "die" }), {
    transport,
    // A scripted page reports to no bridge.
    log: script ? null : clientLogSender(),
    renderer,
    inputs: [inputs],
    viewport: viewportSource(),
    motion,
    scheduler: frameScheduler,
    // Faults and a stale build, with Reload, on a surface of the app's own: it still shows if the game renderer fails.
    notice: noticeSurface(document.body, () => location.reload()),
    prefs: script ? null : prefs,
  });
  loop.start();
  for (const e of script?.envelopes ?? []) script!.transport.push(e);
  installDebug(loop, renderer, script ? { script: script.transport } : {});
}

void main();
