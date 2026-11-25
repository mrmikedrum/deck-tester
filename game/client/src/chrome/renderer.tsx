// The chrome's renderer: the app calls `show(view, now)` once per commit; it renders every component synchronously
// from the view, steps the hand's motion to `now`, and reports whether anything is still moving. It owns two stable
// hosts under `root`: the hand's (where the gesture classifier is bound) and the layer's (prompt, sheet, toast).
//
// Acts are stamped here, with what the player saw as they acted. A control pressed with a pointer answers the control,
// option and stop it was pressed on: its act carries the stop and commit drawn at pointer-down, and if by the release
// the control under the pointer is another one (its button or option changed, or Preact reused the element for a new
// stop) the press sends nothing. A control activated from the keyboard (Enter or Space: a click with no pointer) acts on
// the stop drawn now. A hand gesture's act carries the stop and commit drawn when it was pressed, so a card held through
// a new decision is let go under the old one and play drops it. A release says whether it was let go over the table:
// on screen and outside the hand's and the prompt's reserves. They leave through `ports.emit`; the chrome never calls play or the
// transport. A throw while drawing is a fault (reported, not thrown); the next commit is a cut (the motion forgotten).
//
// The focus stack's layers are drawn in its order, each over the one below; everything under the top modal layer is
// inert (no taps, no keyboard), except the fan under play's sheet, which stays in full over it as it always did. A
// layer that comes up on top takes keyboard focus; one that goes returns it to the control that opened it.
import { render } from "preact";
import { designUnit, reserved } from "../layout";
import { now as clockNow } from "../platform";
import type { Act, Carried, Ms, ScreenPose } from "../play";
import type { CardId } from "../protocol";
import { installCss } from "../theme";
import { bindPointer } from "../input";
import { HAND_INSET, cardSize, fanLeft, labelFont } from "./fan";
import { HandMotion, progress, running, sameScreen } from "./frame";
import { Hand } from "./hand";
import { Inspector } from "./inspector";
import { LogSheet, LogStrip, LossSheet } from "./log";
import { BackBar, Chips, GameButton, HandList, Menu, Mulligan, SiftBar, ViewHand } from "./layers";
import { Plates, SeatFocus } from "./plates";
import { Prompt, WaitingPrompt } from "./prompt";
import { isOrder } from "./send";
import type { Send } from "./send";
import { Sheet } from "./sheet";
import { installSurfaces } from "./style/surfaces";
import type { ChromeIntent, ChromeLayer, ChromePorts, ChromeReport, ChromeView, LayerView, Order } from "./view";
import "./chrome.css";

export interface ChromeRenderer {
  show(view: ChromeView, now: Ms): ChromeReport;
  dispose(): void;
}

/** Measured words are kept up to this many (the hand's names; a long game sees a few hundred). */
const MEASURE_CACHE = 2000;

/**
 * Text widths from a canvas, cached; a rough estimate where no canvas is available (a test DOM). The fonts gate loads
 * every face the client uses before the first draw; should one still be missing (a page that skipped the gate), it is
 * loaded here: until it lands its widths are the fallback font's and are not kept, and `loaded` is called when it does,
 * so the next commit measures again.
 */
export function canvasMeasure(doc: Document, loaded: () => void = () => {}): (text: string, font: string) => number {
  const ctx = doc.createElement("canvas").getContext?.("2d") ?? null;
  const fonts = doc.fonts as FontFaceSet | undefined;
  const cache = new Map<string, number>();
  const loading = new Set<string>();
  const ready = (font: string): boolean => {
    if (!fonts?.check || fonts.check(font)) return true;
    if (!loading.has(font)) {
      loading.add(font);
      void fonts.load(font).then(loaded, loaded);
    }
    return false;
  };
  return (text, font) => {
    const key = `${font}\u0000${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let w: number;
    if (ctx) {
      ctx.font = font;
      w = ctx.measureText(text).width;
    } else w = text.length * (Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? "14") * 0.5);
    if (!ready(font)) return w;
    if (cache.size >= MEASURE_CACHE) cache.clear();
    cache.set(key, w);
    return w;
  };
}

const errorText = (e: unknown): string => (e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));

/** The control an event reached in the layer: a button, or a layer's scrim itself (not the box laid on it). */
function controlOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("button, [data-scrim]");
  return el && el.hasAttribute("data-scrim") && el !== target ? null : el;
}

/** The control a layer's focus returns to: its `data-fk`. */
const originOf = (el: Element | null): string | null => el?.closest<HTMLElement>("[data-fk]")?.dataset["fk"] ?? null;

/** The chrome's own layers: modal, drawn over the table. */
const MODAL: ReadonlySet<ChromeLayer> = new Set<ChromeLayer>(["sheet", "inspector", "mulligan", "menu", "hand", "log", "losses", "seat"]);
/** A sheet of the chrome's own on top: the prompt steps back. */
const SHEETS: ReadonlySet<ChromeLayer> = new Set<ChromeLayer>(["sheet", "menu", "hand", "log", "losses"]);

/** Each modal layer's stacking: in the focus stack's order, over the fan (41) and every fixture, under the toast; play's
 * sheet, when it is the lowest, stays under the fan as it always did (a released card's offer keeps the hand in full). */
function zOf(modals: readonly ChromeLayer[], layer: ChromeLayer): number {
  const i = modals.indexOf(layer);
  return i === 0 && layer === "sheet" ? 40 : 42 + 2 * i;
}

/** What a control answers as drawn now: its button or option (or its name, for the stepper and the stud). */
const controlKey = (el: HTMLElement): string =>
  [el.tagName, el.dataset["button"] ?? "", el.dataset["option"] ?? "", el.getAttribute("aria-label") ?? ""].join("|");

/** A pointer press on a control, as drawn when it went down. */
interface ControlPress {
  readonly el: HTMLElement;
  readonly key: string;
  readonly commit: number;
  readonly stop: ChromeView["controls"]["stop"];
}

function pickCard(host: HTMLElement): (target: EventTarget | null) => CardId | null {
  return (target) => {
    if (!(target instanceof Element)) return null;
    const card = target.closest<HTMLElement>(".held [data-id]");
    if (!card || !host.contains(card)) return null;
    const id = Number(card.dataset["id"]);
    return Number.isFinite(id) ? (id as CardId) : null;
  };
}

/** The carried cards the hand drew away from the pose the view gave them (re-anchored by a layout change). */
function reanchored(given: readonly Carried[], drawn: readonly { readonly id: Carried["card"]; readonly pose: ScreenPose }[]): Carried[] {
  const out: Carried[] = [];
  for (const c of given) {
    const d = drawn.find((l) => l.id === c.card);
    if (d && !sameScreen(d.pose, c.pose)) out.push({ card: c.card, pose: d.pose });
  }
  return out;
}

export function chromeRenderer(root: HTMLElement, ports: ChromePorts): ChromeRenderer {
  const doc = root.ownerDocument;
  installCss(doc);
  installSurfaces(doc);
  const el = doc.createElement("div");
  el.className = "dm-chrome";
  const handHost = doc.createElement("div");
  handHost.className = "l-hand-host";
  const layer = doc.createElement("div");
  layer.className = "l-layer";
  el.append(handHost, layer);
  root.append(el);

  const now = ports.now ?? clockNow;
  const measure = ports.measure ?? canvasMeasure(doc, () => ports.wake());
  /** The stop and commit the hand was last drawn for: its gestures' acts carry them. */
  let drawn: Pick<ChromeView, "commit"> & { stop: ChromeView["controls"]["stop"] } = { commit: -1, stop: null };
  const stamped =
    (commit: number, stop: ChromeView["controls"]["stop"], origin: string | null = null) =>
    (what: Act | Order, at: Ms): void => {
      const stamp = { at, commit };
      const from = origin === null ? {} : { origin };
      const intent: ChromeIntent = isOrder(what) ? { ...what, stamp, ...from } : { t: "act", stamp, stop, act: what, ...from };
      ports.emit(intent);
    };
  /** What was drawn when the pointer was pressed: the gesture's acts carry it. Null outside a gesture's dispatch. */
  let pressed: typeof drawn = drawn;
  let inGesture = false;
  const handAct = (act: Act, at: Ms): void => {
    const by = inGesture ? pressed : drawn; // a key on a focused card acts on what is drawn now
    stamped(by.commit, by.stop, act.a === "tap" && "card" in act.on ? `h:${act.on.card}` : null)(act, at);
  };
  /** The viewport and reserves last drawn: where the table is. */
  let area: Pick<ChromeView, "viewport" | "reserve"> | null = null;
  const overTable = (x: number, y: number): boolean => {
    if (!area) return false;
    const { w, h } = area.viewport;
    if (!(x >= 0 && y >= 0 && x < w && y < h)) return false;
    const inside = (r: { left: number; top: number; right: number; bottom: number } | null) => !!r && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    return !inside(reserved(area.reserve, "hand")) && !inside(reserved(area.reserve, "prompt"));
  };
  const motion = new HandMotion(
    {
      tap: (card, at) => handAct({ a: "tap", on: { card } }, at),
      release: (card, dy, pose, at, x, y) => handAct({ a: "release", card, dy, pose, overTable: overTable(x, y) }, at),
    },
    ports.wake,
    overTable,
  );
  const binding = bindPointer<CardId>(handHost, {
    pick: pickCard(handHost),
    now,
    on: (gestures) => {
      inGesture = true;
      try {
        for (const g of gestures) motion.gesture(g);
      } finally {
        inGesture = false;
      }
    },
  });
  // A press starts a hold that only the frames can fire: ask for them. It also fixes what the gesture acts under; a
  // second finger only cancels the gesture, so it changes nothing.
  const wakeOnPress = (): void => {
    if (!binding.active) pressed = drawn;
    ports.wake();
  };
  handHost.addEventListener("pointerdown", wakeOnPress, true); // capture: before the classifier hears the press

  // The layer's controls: a pointer press is noted as it goes down, and each click is classed as it starts (capture,
  // before the control's own handler sends) and forgotten once it is done (bubbling back up to the layer).
  let control: ControlPress | null = null;
  let clicking: { readonly pointer: boolean; readonly el: HTMLElement | null } | null = null;
  const onControlDown = (e: PointerEvent): void => {
    const el = controlOf(e.target);
    control = el ? { el, key: controlKey(el), commit: drawn.commit, stop: drawn.stop } : null;
  };
  const onControlCancel = (): void => {
    control = null;
  };
  const onClickStart = (e: MouseEvent): void => {
    clicking = { pointer: e.detail > 0, el: controlOf(e.target) };
  };
  const onClickEnd = (): void => {
    if (clicking?.pointer) control = null; // one press, one click
    clicking = null;
  };
  layer.addEventListener("pointerdown", onControlDown, true);
  layer.addEventListener("pointercancel", onControlCancel, true);
  layer.addEventListener("click", onClickStart, true);
  layer.addEventListener("click", onClickEnd);
  /** A control's act or order: under what was pressed, for a pointer; under what is drawn now, for the keyboard. */
  const send: Send = (what) => {
    const c = clicking;
    if (!c?.pointer) return stamped(drawn.commit, drawn.stop, originOf(doc.activeElement))(what, now());
    const p = control;
    if (!p || !c.el || p.el !== c.el || p.key !== controlKey(c.el) || p.stop !== drawn.stop) return; // changed since pointer-down
    stamped(p.commit, p.stop, originOf(p.el))(what, now());
  };
  let toast = "";
  let cut = false;
  /** The layers last drawn: one coming up takes focus, one going gives it back. */
  let shown: readonly LayerView[] = [];
  let shownTop: ChromeLayer | null = null;
  const settleFocus = (layers: readonly LayerView[], top: ChromeLayer | null): void => {
    const before = shown, beforeTop = shownTop;
    shown = layers;
    shownTop = top;
    const active = doc.activeElement;
    const lost = !active || active === doc.body || !doc.contains(active);
    const intoTop = (): void => {
      const box = layer.querySelector<HTMLElement>(`[data-layer="${top}"] [tabindex="-1"]`);
      if (box && !box.contains(active)) box.focus({ preventScroll: true });
    };
    // A layer that comes up takes focus.
    if (top && !before.some((l) => l.layer === top)) return intoTop();
    // One that goes gives it back to the control that opened it, even inside the layer under it (a card opened from the
    // hand's list goes back to its row); failing that, the new top takes it.
    const gone = before.filter((g) => !layers.some((l) => l.layer === g.layer));
    if (gone.length && (lost || top !== beforeTop)) {
      for (const g of [...gone].reverse()) {
        const back = g.restore ? el.querySelector<HTMLElement>(`[data-fk="${CSS.escape(g.restore)}"]`) : null;
        if (back && !back.closest("[inert]")) {
          back.focus({ preventScroll: true });
          return;
        }
      }
    }
    if (top && top !== beforeTop) intoTop();
  };

  return {
    show(view, t) {
      try {
        if (cut) {
          motion.cut();
          binding.reset();
          cut = false;
        }
        const { w, h, safe } = view.viewport;
        const u = designUnit(view.viewport);
        el.style.setProperty("--u", `${u}px`);
        el.style.setProperty("--safe-top", `${safe.top}px`);
        el.style.setProperty("--safe-right", `${safe.right}px`);
        el.style.setProperty("--safe-bottom", `${safe.bottom}px`);
        el.style.setProperty("--safe-left", `${safe.left}px`);
        const c = view.controls;
        drawn = { commit: view.commit, stop: c.stop };
        area = { viewport: view.viewport, reserve: view.reserve };
        const promptRect = reserved(view.reserve, "prompt") ?? { left: w, top: h, right: w, bottom: h };
        const inset = { right: w - promptRect.right, bottom: h - promptRect.bottom };
        if (view.toast !== null) toast = view.toast;
        const sheet = c.mayAnswer && view.waiting === null ? c.sheet : null;
        // The modal layers with something to show, in the focus stack's order (one the stack does not list yet goes on
        // top); what is under the top one is inert.
        const prompt0 = view.waiting === null ? c.prompt : null;
        const shows: Readonly<Record<ChromeLayer, boolean>> = {
          sheet: sheet !== null,
          inspector: view.inspector !== null,
          mulligan: view.mulligan !== null && prompt0 !== null,
          menu: view.menu !== null,
          hand: view.handSheet !== null,
          log: view.logSheet !== null,
          losses: view.losses !== null,
          seat: view.seatFocus !== null,
          stack: false,
          lean: false,
          sift: false,
        };
        const modals = [...new Set([...view.layers.map((l) => l.layer), ...MODAL])].filter((l) => MODAL.has(l) && shows[l]);
        const topModal = modals[modals.length - 1] ?? null;
        const under = (l: ChromeLayer): boolean => modals.indexOf(l) < modals.length - 1;
        const layerStyle = (l: ChromeLayer): string => `z-index:${zOf(modals, l)}`;
        el.classList.toggle("sheet-open", topModal !== null && SHEETS.has(topModal));
        el.classList.toggle("watching", view.watch !== null); // the hand's plays are not lit while the table moves
        handHost.inert = topModal !== null && topModal !== "sheet";

        binding.tick(t);
        let handActive = false;
        let carried: Carried[] = [];
        if (view.waiting === null) {
          const handRect = reserved(view.reserve, "hand") ?? { left: 0, top: h, right: 0, bottom: h };
          const size = cardSize(u);
          const ox = handRect.left + fanLeft(u), oy = handRect.bottom - HAND_INSET.bottom * u;
          const font = labelFont(u);
          const frame = motion.step(view.hand, { u, ox, oy, vw: w, vh: h, measure: (word) => measure(word, font) }, view.commit, t);
          handActive = frame.active;
          carried = reanchored(view.hand.carried, frame.loose);
          render(
            <Hand
              hand={view.hand}
              frame={frame}
              looks={view.looks}
              ox={ox}
              oy={oy}
              vh={h}
              cardW={size.w}
              cardH={size.h}
              onKey={(card, key) => motion.key(card, key, now())}
            />,
            handHost,
          );
        } else render(null, handHost);

        const prompt = prompt0;
        // The mulligan's question is its overlay's, not the prompt's (set aside, its chip brings it back); with neither
        // (a spectator), the prompt asks it in the middle on its own.
        const overlaid = shows.mulligan || view.chips.some((x) => x.layer === "mulligan");
        const bar = prompt && !(prompt.style === "overlay" && overlaid) ? prompt : null;
        const base = topModal !== null; // the fixtures and the prompt sit under any modal layer
        const handShown = view.waiting === null && !view.hand.away && view.hand.cards.length > 0;
        const hold = c.mayAnswer ? (c.prompt?.buttons.find((b) => b.role === "hold") ?? null) : null;
        // Auto-pass's countdown, for the layers that cover the prompt (the hand's list, the inspector).
        const fill = hold && c.prompt?.countdown ? progress(c.prompt.countdown, t) : null;
        const drawLayer = (l: ChromeLayer) => {
          const style = layerStyle(l);
          switch (l) {
            case "sheet":
              return sheet ? <Sheet key="sheet" sheet={sheet} looks={view.looks} named={view.named} stack={view.stack} send={send} style={style} /> : null;
            case "inspector":
              return view.inspector ? (
                <Inspector key="inspector" view={view.inspector} send={send} style={style} hold={hold} fill={fill} />
              ) : null;
            case "mulligan":
              return view.mulligan && prompt ? <Mulligan key="mulligan" view={view.mulligan} prompt={prompt} now={t} send={send} style={style} /> : null;
            case "menu":
              return view.menu ? <Menu key="menu" view={view.menu} send={send} style={style} /> : null;
            case "hand":
              return view.handSheet ? (
                <HandList key="hand" view={view.handSheet} hold={hold} fill={fill} send={send} style={style} />
              ) : null;
            case "log":
              return view.logSheet ? (
                <LogSheet
                  key="log"
                  view={view.logSheet}
                  style={style}
                  onClose={() => send({ t: "dismiss" })}
                  onLosses={() => send({ t: "open", layer: "losses", card: null })}
                />
              ) : null;
            case "losses":
              return view.losses ? <LossSheet key="losses" rows={view.losses} style={style} onClose={() => send({ t: "dismiss" })} /> : null;
            case "seat":
              return view.seatFocus ? <SeatFocus key="seat" view={view.seatFocus} send={send} style={style} /> : null;
            default:
              return null;
          }
        };
        render(
          <>
            <div class="l-base" inert={base}>
              {view.waiting !== null ? <WaitingPrompt text={view.waiting} inset={inset} newGame={view.newGame} send={send} /> : null}
              {bar ? (
                <Prompt
                  prompt={bar}
                  mayAnswer={c.mayAnswer}
                  now={t}
                  send={send}
                  inset={inset}
                  newGame={view.newGame}
                  stackOpen={view.stackOpen}
                  watch={view.watch}
                  recap={view.recap}
                  restore={view.restore}
                />
              ) : null}
              <GameButton send={send} />
              {view.waiting === null ? <LogStrip view={view.log} onOpen={() => send({ t: "open", layer: "log", card: null })} /> : null}
              {handShown ? <ViewHand send={send} /> : null}
              {view.chips.length || view.back !== null ? (
                <div class="l-corner">
                  <Chips chips={view.chips} send={send} />
                  {view.back !== null ? <BackBar text={view.back} send={send} /> : null}
                </div>
              ) : null}
              {view.sift !== null ? <SiftBar view={view.sift} send={send} /> : null}
            </div>
            {modals.map((l) => (
              <div key={l} class="l-layer-slot" inert={under(l)}>
                {drawLayer(l)}
              </div>
            ))}
            {view.waiting === null ? <Plates plates={view.plates} open={view.seatFocus?.seat ?? null} send={send} /> : null}
            <div class={view.toast !== null ? "l-toast on" : "l-toast"} role="status" aria-live="polite">
              {toast}
            </div>
          </>,
          layer,
        );
        settleFocus(view.layers, topModal);
        const counting = bar !== null && c.mayAnswer && running(bar.countdown, t);
        return { active: handActive || binding.active || counting, fault: null, ...(carried.length ? { carried } : {}) };
      } catch (e) {
        cut = true;
        return { active: false, fault: errorText(e) };
      }
    },
    dispose() {
      binding.dispose();
      handHost.removeEventListener("pointerdown", wakeOnPress, true);
      layer.removeEventListener("pointerdown", onControlDown, true);
      layer.removeEventListener("pointercancel", onControlCancel, true);
      layer.removeEventListener("click", onClickStart, true);
      layer.removeEventListener("click", onClickEnd);
      render(null, handHost);
      render(null, layer);
      el.remove();
    },
  };
}
