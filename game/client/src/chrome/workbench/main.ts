// The chrome's workbench (chrome-workbench.html): the hand, the prompt and the chrome's layers over sample controls,
// drawn by the real renderer on the platform's frames, with a stand-in for play and the app so the gestures can be
// tried: let a card go 90 px up and Frantic Search offers its plays, anything else says it can't be played; Hold stops
// the countdown; the Game button, "View hand", a hand card in the list and ✕ open and close their layers.
//   ?s=main|threat|targets|offer|many|number|busy|spectator|waiting|nogame|over|inspector|mulligan|menu|hand|stack|words|
//      aside|back                                               the sample (main by default)
//   ?away=1                                                       the hand slid away
//   ?hand=crowded                                                 a crowded hand of long names
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import { reservations } from "../../layout";
import { NO_INSETS, fontsReady, frame, now } from "../../platform";
import type { Act, Controls, PromptView, SheetView } from "../../play";
import { chromeRenderer } from "../renderer";
import type { ChipView, ChromeIntent, ChromeLayer, ChromeView, HandView, Order } from "../view";
import {
  BUSY,
  CROWDED,
  HAND,
  HAND_SHEET,
  INSPECTOR,
  MAIN,
  MANY,
  MANY_LOOKS,
  MENU,
  MULLIGAN,
  MULLIGAN_PROMPT,
  NUMBER,
  OFFER,
  STACK_ROWS,
  STACK_SHEET,
  TARGETS,
  THREAT,
  WORDS,
  controls,
  view as sampleView,
} from "./samples";

const params = new URLSearchParams(location.search);
const sample = params.get("s") ?? "main";

interface Bench {
  prompt: PromptView | null;
  sheet: SheetView | null;
  mayAnswer: boolean;
  waiting: string | null;
  newGame: boolean;
  toast: string | null;
  hand: HandView;
  /** The chrome's layers open, bottom first, and those set aside. */
  layers: ChromeLayer[];
  aside: ChipView[];
  back: string | null;
}

function initial(start: number): Bench {
  const hand: HandView = { cards: params.get("hand") === "crowded" ? CROWDED : HAND, away: params.get("away") === "1", respond: false, carried: [], fresh: [] };
  const b: Bench = { prompt: MAIN, sheet: null, mayAnswer: true, waiting: null, newGame: false, toast: null, hand, layers: [], aside: [], back: null };
  switch (sample) {
    case "threat":
      return { ...b, prompt: { ...THREAT, countdown: { from: start, ms: 3200 } } };
    case "targets":
      return { ...b, prompt: TARGETS };
    case "offer":
      return { ...b, sheet: OFFER, layers: ["sheet"], hand: { ...hand, carried: OFFER.carried ? [OFFER.carried] : [] } };
    case "many":
      return { ...b, prompt: null, sheet: MANY, layers: ["sheet"] };
    case "number":
      return { ...b, prompt: null, sheet: NUMBER, layers: ["sheet"] };
    case "words":
      return { ...b, sheet: WORDS, layers: ["sheet"] };
    case "stack":
      return { ...b, prompt: THREAT, sheet: STACK_SHEET, layers: ["stack", "sheet"] };
    case "busy":
      return { ...b, prompt: BUSY };
    case "spectator":
      return { ...b, mayAnswer: false };
    case "waiting":
      return { ...b, waiting: "Shuffling up… (the first game takes about a minute)" };
    case "nogame":
      return { ...b, waiting: "No game yet", newGame: true };
    case "over":
      return { ...b, prompt: { ...MAIN, headline: "Game over", hint: null, buttons: [] }, newGame: true };
    case "inspector":
      return { ...b, layers: ["inspector"] };
    case "mulligan":
      return { ...b, prompt: MULLIGAN_PROMPT, hand: { ...hand, away: true }, layers: ["mulligan"] };
    case "aside":
      return { ...b, prompt: THREAT, aside: [{ layer: "stack", label: "Stack: 2" }] };
    case "menu":
      return { ...b, layers: ["menu"] };
    case "hand":
      return { ...b, prompt: { ...THREAT, countdown: { from: start, ms: 3200 } }, layers: ["hand"] };
    case "back":
      return { ...b, layers: ["lean"], back: "Ana's side", aside: [{ layer: "stack", label: "Stack: 1" }] };
    default:
      return b;
  }
}

async function main(): Promise<void> {
  await fontsReady();
  const ui = document.getElementById("ui");
  if (!ui) throw new Error("chrome-workbench.html lacks #ui");
  let bench = initial(now());
  let commit = 0;
  let scheduled = false;
  let toastUntil = 0;
  const log = document.getElementById("log");
  const without = (l: ChromeLayer): ChromeLayer[] => bench.layers.filter((x) => x !== l);

  function act(a: Act): void {
    if (a.a === "release") {
      if (a.dy > -90 || !a.overTable) return;
      if (a.card === OFFER.carried?.card) {
        const carried = { card: a.card, pose: a.pose };
        bench = { ...bench, sheet: { ...OFFER, carried }, layers: [...without("sheet"), "sheet"], hand: { ...bench.hand, carried: [carried] } };
      } else {
        bench = { ...bench, toast: "You can't play that now" };
        toastUntil = now() + 2600;
      }
    } else if (a.a === "dismiss" || a.a === "pick") {
      const keep = sample === "number" || sample === "many" || sample === "words";
      bench = { ...bench, sheet: keep ? bench.sheet : null, layers: keep ? bench.layers : without("sheet"), hand: { ...bench.hand, carried: [] } };
    } else if (a.a === "press" && a.button === "hold" && bench.prompt) {
      bench = { ...bench, prompt: { ...bench.prompt, countdown: null, buttons: bench.prompt.buttons.filter((b) => b.role !== "hold").map((b) => ({ ...b, countdown: false })) } };
    } else if (a.a === "step" && bench.sheet?.stepper) {
      const s = bench.sheet.stepper;
      bench = { ...bench, sheet: { ...bench.sheet, stepper: { ...s, value: Math.max(s.min, Math.min(s.max, s.value + a.by)) } } };
    }
  }

  /** The app's focus rule, in miniature: the top layer goes (the stack is set aside); a chip restores. */
  function order(o: Order): void {
    if (o.t === "dismiss") {
      const top = bench.layers[bench.layers.length - 1];
      if (!top) return;
      if (top === "sheet") return act({ a: "dismiss" });
      bench = { ...bench, layers: without(top), back: top === "lean" ? null : bench.back, aside: top === "stack" ? [...bench.aside, { layer: "stack", label: "Stack: 2" }] : bench.aside };
    } else if (o.t === "restore") {
      bench = { ...bench, aside: bench.aside.filter((c) => c.layer !== o.layer), layers: [o.layer, ...without(o.layer)] };
    } else if (o.t === "open") {
      bench = { ...bench, layers: [...without(o.layer).filter((l) => !(o.layer === "inspector" && l === "hand")), o.layer] };
    } else if (o.t === "newGame") {
      bench = { ...bench, layers: [], toast: `New game: ${o.req.deck} against ${o.req.opponents.join(", ")}` };
      toastUntil = now() + 2600;
    }
  }

  const emit = (i: ChromeIntent): void => {
    if (log) log.textContent = `${JSON.stringify(i.t === "act" ? i.act : { ...i, stamp: undefined })} · commit ${i.stamp.commit}${i.origin ? ` · from ${i.origin}` : ""}`;
    if (i.t === "act") act(i.act);
    else order(i);
    wake();
  };
  const renderer = chromeRenderer(ui, { emit, wake: () => wake() });

  function view(): ChromeView {
    const w = innerWidth, h = innerHeight;
    const c: Controls = controls(bench.prompt, { mayAnswer: bench.mayAnswer, sheet: bench.sheet });
    const has = (l: ChromeLayer): boolean => bench.layers.includes(l);
    return sampleView(
      {
        commit,
        viewport: { w, h, safe: NO_INSETS },
        reserve: reservations({ w, h }),
        controls: c,
        hand: bench.hand,
        looks: sample === "many" ? MANY_LOOKS : new Map(),
        toast: bench.toast,
        waiting: bench.waiting,
        newGame: bench.newGame,
        layers: bench.layers.map((layer) => ({ layer, restore: null })),
        chips: bench.aside,
        inspector: has("inspector") ? INSPECTOR : null,
        mulligan: has("mulligan") ? MULLIGAN : null,
        menu: has("menu") ? MENU : null,
        handSheet: has("hand") ? HAND_SHEET : null,
        stack: bench.sheet?.kind === "stack" ? STACK_ROWS : [],
        back: has("lean") ? bench.back : null,
      },
      w,
      h,
    );
  }

  function draw(at: number): void {
    scheduled = false;
    if (bench.toast !== null && at >= toastUntil) bench = { ...bench, toast: null };
    commit++;
    const report = renderer.show(view(), at);
    if (report.fault) console.error(report.fault);
    if (report.active || bench.toast !== null) wake();
    document.documentElement.dataset["ready"] = "1";
  }
  function wake(): void {
    if (scheduled) return;
    scheduled = true;
    frame(draw);
  }
  addEventListener("resize", wake);
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    order({ t: "dismiss" });
    wake();
  });
  wake();
}

void main();
