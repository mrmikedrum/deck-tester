// The prompt (live.js `status`'s markup): where the game is, what is asked, the stack summary or what it is about, the
// loss notice, and the buttons that answer it. A pure projection of play's PromptView and the narrative's views: play
// decides every word and button; this draws them, with the auto-pass countdown filled at the commit's time. While the
// table moves (the narrative's `watch`) the prompt says so instead of asking. A spectator sees the words and no buttons.
// With no game to show, or a game over, the app's own "New game" (the Game menu) joins the buttons.
import type { JSX } from "preact";
import type { RecapView, RestoreView, WatchView } from "../narrative";
import type { Button, Ms, PromptView } from "../play";
import { progress } from "./frame";
import { LossRecap, StackSummary } from "./log";
import { Pips } from "./pips";
import type { Send } from "./send";

const TONE: Readonly<Record<Button["tone"], string>> = { primary: "act", secondary: "" };
const ROLE: Readonly<Record<NonNullable<Button["role"]>, string>> = {
  pass: "l-pass",
  choice: "l-choice",
  hold: "l-hold",
  defer: "l-delegate",
  stack: "l-stack-rules",
  done: "l-done",
  clear: "l-clear",
};

/** A button's classes: its tier, its role, and `auto` while it counts down. */
export function buttonClass(b: Button, counting: boolean): string {
  return [TONE[b.tone], b.role ? ROLE[b.role] : "", b.countdown && counting ? "auto" : ""].filter(Boolean).join(" ");
}

interface PromptProps {
  readonly prompt: PromptView;
  readonly mayAnswer: boolean;
  readonly now: Ms;
  readonly send: Send;
  /** Where the prompt's reserve ends, from the viewport's right and bottom edges (px). */
  readonly inset: { readonly right: number; readonly bottom: number };
  /** Offer "New game" (the game is over). */
  readonly newGame?: boolean;
  /** The stack layer is up: the stack summary stands in for the context (set aside, the context shows again). */
  readonly stackOpen?: boolean;
  /** While the table moves: its headline in place of the question. */
  readonly watch?: WatchView | null;
  /** The loss notice, above the buttons. */
  readonly recap?: RecapView | null;
  /** Back at an earlier position: its cue, then "Your decision · <phase>" in the headline's place. */
  readonly restore?: RestoreView | null;
}

/** "New game": opens the Game menu. */
function NewGame({ send }: { send: Send }): JSX.Element {
  return (
    <button type="button" class="act" data-fk="new-game" onClick={() => send({ t: "open", layer: "menu", card: null })}>
      New game
    </button>
  );
}

export function PromptButton({ b, busy, fill, send }: { b: Button; busy: boolean; fill: number | null; send: Send }): JSX.Element {
  const label = b.detail ? (
    <>
      <span class="l-choice-label">
        <Pips text={b.label} />
      </span>
      <span class="l-response-names">
        <Pips text={b.detail} />
      </span>
    </>
  ) : (
    <>
      <Pips text={b.label} />
      {b.cost ? (
        <span class="cost">
          <Pips text={b.cost} />
        </span>
      ) : null}
    </>
  );
  return (
    <button
      type="button"
      class={buttonClass(b, fill !== null)}
      data-button={b.id}
      data-fk={`b:${b.id}`}
      disabled={!b.enabled || busy}
      onClick={() => send({ a: "press", button: b.id })}
    >
      {label}
      {b.countdown && fill !== null ? <span class="l-auto-bar" aria-hidden="true" style={`transform:scaleX(${fill})`} /> : null}
    </button>
  );
}

export function Prompt(props: PromptProps): JSX.Element {
  const {
    prompt: p,
    mayAnswer,
    now,
    send,
    inset,
    newGame = false,
    stackOpen = false,
    watch = null,
    recap = null,
  } = props;
  const restore = watch ? null : (props.restore ?? null);
  const restoring = !!restore?.restoring;
  // On the way to the stack, the play kind's "Choose a play" is not offered (live.js `status`).
  const buttons = !mayAnswer ? [] : watch?.toStack ? p.buttons.filter((b) => b.role !== "choice") : p.buttons;
  const play = buttons.some((b) => b.role === "pass" || b.role === "stack");
  const asking = mayAnswer && !p.busy && !watch && !restoring && buttons.some((b) => b.enabled);
  // Red while something is aimed at me, or while Sunfall exiles; never while a spell is still on its way to the stack.
  const threat = !p.busy && (watch ? !watch.toStack && (p.tone === "threat" || watch.sweeping) : p.tone === "threat");
  const cls = [
    "l-prompt",
    p.style === "overlay" ? "overlay" : "",
    play ? "play" : "",
    asking ? "asking" : "",
    threat ? "threat" : "",
    watch ? "moving" : "",
    p.busy ? "busy" : "",
    restoring ? "restoring" : "",
  ].filter(Boolean);
  // On the way to the stack the prompt already says the line it will ask with (unlit until it lands), so the words do
  // not change as it lands.
  const headline = watch ? (watch.toStack ? p.headline : watch.headline) : restore ? restore.headline : p.headline;
  const summary = stackOpen ? p.stack : [];
  const ctx = [watch ? null : p.hint, watch || stackOpen ? null : p.context, p.floating].filter((s): s is string => !!s).join(" · ");
  const fill = p.countdown ? progress(p.countdown, now) : null;
  return (
    <div
      class={cls.join(" ")}
      data-audit="prompt"
      aria-busy={p.busy ? "true" : undefined}
      style={`--res-right:${inset.right}px;--res-bottom:${inset.bottom}px`}
    >
      {p.where ? <div class="l-where">{p.where}</div> : null}
      {headline && restore ? (
        <div class="l-what" aria-live="polite">
          <span>
            <Pips text={headline} />
          </span>
          <span class="l-restore-cue">{restore.cue}</span>
        </div>
      ) : headline ? (
        <div class="l-what" aria-live="polite">
          <Pips text={headline} />
        </div>
      ) : null}
      <StackSummary rows={summary} />
      {ctx ? (
        <div class="l-ctx">
          <Pips text={ctx} />
        </div>
      ) : null}
      {recap ? (
        <LossRecap view={recap} onOpen={() => send({ t: "open", layer: "losses", card: null })} onDismiss={() => send({ t: "dismissRecap" })} />
      ) : null}
      {buttons.length || newGame ? (
        <div class={play ? "l-buttons l-play-buttons" : "l-buttons"}>
          {buttons.map((b) => (
            <PromptButton key={b.id} b={b} busy={p.busy} fill={fill} send={send} />
          ))}
          {newGame ? <NewGame send={send} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Before a game: the prompt's place holds one line (no game yet, shuffling up, couldn't start), and "New game" when
 * one can be asked for. */
export function WaitingPrompt(p: { readonly text: string; readonly inset: PromptProps["inset"]; readonly newGame: boolean; readonly send: Send }): JSX.Element {
  return (
    <div class="l-prompt l-waiting" data-audit="prompt" style={`--res-right:${p.inset.right}px;--res-bottom:${p.inset.bottom}px`}>
      <div class="l-what" aria-live="polite">
        {p.text}
      </div>
      {p.newGame ? (
        <div class="l-buttons">
          <NewGame send={p.send} />
        </div>
      ) : null}
    </div>
  );
}
