// The chrome's other layers and fixtures: the opening hand over a dimmed table (live.js `mulligan`), the Game menu with
// its new game form (live.js `menu`), the hand as a list (`handSheet`), and the fixtures always on the table's edge:
// the Game button, "View hand", the chips of set-aside layers and the back bar of a lean-in. Pure projections; each
// sends an act for play or an order for the app.
import type { JSX } from "preact";
import type { Button, Ms, PromptView } from "../play";
import { PromptButton } from "./prompt";
import { Pips } from "./pips";
import type { Send } from "./send";
import { Close, onScrim } from "./sheet";
import type { ChipView, GameRequest, HandSheetView, MenuView, MulliganView, SiftView } from "./view";

/** The opening hand: the question, the cards (a tap inspects one), and play's buttons (Mulligan, Keep). */
export function Mulligan(p: { view: MulliganView; prompt: PromptView; now: Ms; send: Send; style?: string }): JSX.Element {
  return (
    <div class="l-mull" data-layer="mulligan" data-scrim="" style={p.style} onClick={onScrim(p.send)}>
      <div class="l-mullbox" role="dialog" aria-modal="true" aria-labelledby="l-mull-title" tabIndex={-1}>
        <h2 id="l-mull-title">{p.view.title}</h2>
        <div class="cards">
          {p.view.cards.map((c) => (
            <button
              key={c.id}
              type="button"
              class="pic"
              aria-label={c.name}
              data-fk={`m:${c.id}`}
              style={c.image ? `background-image:url("${c.image}")` : undefined}
              onClick={() => p.send({ t: "open", layer: "inspector", card: c.id })}
            />
          ))}
        </div>
        <div class="l-buttons">
          {p.prompt.buttons.map((b) => (
            <PromptButton key={b.id} b={b} busy={p.prompt.busy} fill={null} send={p.send} />
          ))}
        </div>
      </div>
    </div>
  );
}

const MANA: readonly (readonly [GameRequest["mana"], string])[] = [
  ["creatures", "Ask when a creature could pay"],
  ["always", "Always ask"],
  ["auto", "Forge pays"],
];
/** live.js `menu`'s first choices, before a game has been asked for on this device. */
const DEFAULTS = ["blue-moon-combat-revision", "eternities-living-worlds-iii", "eternities-assimilation-iii", "dack-cedh"] as const;
const SEATS = ["Your deck", "Left (Jev)", "Across (Jev)", "Right (Jev)"] as const;
const FIELDS = ["deck", "left", "across", "right"] as const;

/** A deck name as the bridge lists it matches a remembered one with or without its `.txt`. */
const same = (listed: string, wanted: string): boolean => listed.replace(/\.txt$/, "") === wanted.replace(/\.txt$/, "");

/**
 * A select starts on what was wanted, once: from then on the form holds the player's choice until Start reads it (a
 * redraw never resets it, as a controlled `value` would on every commit).
 */
const startOn =
  (wanted: (options: readonly string[]) => string | undefined) =>
  (el: HTMLSelectElement | null): void => {
    if (!el || el.dataset["started"]) return;
    const v = wanted([...el.options].map((o) => o.value));
    if (v !== undefined) el.value = v;
    el.dataset["started"] = "1";
  };

function DeckField({ label, name, decks, wanted }: { label: string; name: string; decks: readonly string[]; wanted: string }): JSX.Element {
  return (
    <label class="l-field">
      <span>{label}</span>
      <select name={name} ref={startOn((options) => options.find((d) => same(d, wanted)))}>
        {decks.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The Game menu: a new game, a deck for me and one for each of the others, and how mana is paid. */
export function Menu({ view: v, send, style }: { view: MenuView; send: Send; style?: string }): JSX.Element {
  const last = v.last;
  const wanted = [last?.deck ?? DEFAULTS[0], ...[0, 1, 2].map((i) => last?.opponents[i] ?? DEFAULTS[i + 1]!)];
  const start = (e: Event): void => {
    const form = (e.currentTarget as HTMLButtonElement).form;
    if (!form) return;
    const value = (n: string): string => (form.elements.namedItem(n) as HTMLSelectElement | null)?.value ?? "";
    const mana = value("mana");
    send({
      t: "newGame",
      req: {
        deck: value("deck"),
        opponents: FIELDS.slice(1).map(value),
        mana: mana === "always" || mana === "auto" ? mana : "creatures",
      },
    });
  };
  const decks = v.decks;
  return (
    <div class="l-sheet" data-layer="menu" data-scrim="" style={style} onClick={onScrim(send)}>
      <form class="l-box l-menu-box" aria-modal="true" aria-labelledby="l-menu-title" tabIndex={-1} onSubmit={(e) => e.preventDefault()}>
        <h3 id="l-menu-title">New game</h3>
        {decks === null ? (
          <p class="l-note">Listing the decks…</p>
        ) : decks.length === 0 ? (
          <p class="l-note">{v.error ? `Couldn't list the decks: ${v.error}` : "No decks to play with."}</p>
        ) : (
          <>
            {SEATS.map((label, i) => (
              <DeckField key={label} label={label} name={FIELDS[i]!} decks={decks} wanted={wanted[i] ?? ""} />
            ))}
            <label class="l-field">
              <span>Paying mana</span>
              <select name="mana" ref={startOn(() => last?.mana ?? "creatures")}>
                {MANA.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <div class="l-row">
          <button type="button" class={v.inProgress ? "danger" : "l-done"} disabled={!decks?.length} onClick={start}>
            Start
          </button>
        </div>
        <p class="l-note">Jev and the deck advisors pilot the other three seats. Starting a game ends the one in progress.</p>
        <Close send={send} />
      </form>
    </div>
  );
}

/**
 * Auto-pass running, over a layer that covers the prompt (live.js `handSheet`'s `l-hand-pass`): "Auto-pass" and Hold, its
 * bar filling as the prompt's pass button's does (`fill`, the countdown's share at the commit's time).
 */
export function AutoPass(p: { hold: Button; fill: number | null; send: Send }): JSX.Element {
  return (
    <div class="l-hand-pass l-buttons">
      <span>Auto-pass</span>
      <button
        type="button"
        class={p.fill !== null ? "auto" : undefined}
        data-button={p.hold.id}
        onClick={() => p.send({ a: "press", button: p.hold.id })}
      >
        {p.hold.label}
        {p.fill !== null ? <span class="l-auto-bar" aria-hidden="true" style={`transform:scaleX(${p.fill})`} /> : null}
      </button>
    </div>
  );
}

/** "Your hand" as a list: each card with its cost; one with a play now is marked so; a tap inspects it (with its plays). */
export function HandList(p: {
  view: HandSheetView;
  hold: Button | null;
  fill: number | null;
  send: Send;
  style?: string;
}): JSX.Element {
  return (
    <div class="l-sheet" data-layer="hand" data-scrim="" style={p.style} onClick={onScrim(p.send)}>
      <div class="l-box" role="dialog" aria-modal="true" aria-labelledby="l-hand-title" tabIndex={-1}>
        <h3 id="l-hand-title">Your hand</h3>
        {p.hold ? <AutoPass hold={p.hold} fill={p.fill} send={p.send} /> : null}
        {p.view.cards.map((c) => {
          const detail = [c.fresh ? "Last added" : "", c.playable ? "Available play" : ""].filter(Boolean).join(" · ");
          return (
            <button
              key={c.id}
              type="button"
              class={c.playable ? "l-opt" : "l-opt l-read"}
              data-fk={`l:${c.id}`}
              onClick={() => p.send({ t: "open", layer: "inspector", card: c.id })}
            >
              <b>
                {c.name}
                {c.cost ? (
                  <>
                    {" "}
                    <span class="cost">
                      <Pips text={c.cost} />
                    </span>
                  </>
                ) : null}
              </b>
              {detail ? <small>{detail}</small> : null}
            </button>
          );
        })}
        <Close send={p.send} />
      </div>
    </div>
  );
}

/** The Game button, top left: the menu. */
export function GameButton({ send }: { send: Send }): JSX.Element {
  return (
    <button type="button" class="l-menu" data-fk="menu" onClick={() => send({ t: "open", layer: "menu", card: null })}>
      Game
    </button>
  );
}

/** "View hand": the hand as a list, above the fan. */
export function ViewHand({ send }: { send: Send }): JSX.Element {
  return (
    <button type="button" class="l-hand-view" data-fk="hand" onClick={() => send({ t: "open", layer: "hand", card: null })}>
      View hand
    </button>
  );
}

/** Set-aside layers, top centre: each chip brings its layer back. */
export function Chips({ chips, send }: { chips: readonly ChipView[]; send: Send }): JSX.Element | null {
  if (!chips.length) return null;
  return (
    <div class="l-chips">
      {chips.map((c) => (
        <button key={c.layer} type="button" class="l-stackchip" data-fk={`chip:${c.layer}`} onClick={() => send({ t: "restore", layer: c.layer })}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** Leaning in on a seat: whose side this is, and the way back. */
export function BackBar({ text, sub, send }: { text: string; sub?: string | null; send: Send }): JSX.Element {
  return (
    <div class="l-back" data-focus="">
      <span>
        {text}
        {sub ? <small>{sub}</small> : null}
      </span>
      <button type="button" onClick={() => send({ t: "dismiss" })}>
        Back to the table
      </button>
    </div>
  );
}

/**
 * A sift up (h.js `sift`'s caption), just above its cards: what the pile is and how many, the way back; and, for a pile
 * bigger than a page, its pages.
 */
export function SiftBar({ view, send }: { view: SiftView; send: Send }): JSX.Element {
  return (
    <div class="l-sift" data-focus="" style={`top:${view.top.toFixed(1)}px`}>
      <span>
        <b>
          {view.title}
          {view.tapped ? <i> · {view.tapped} tapped</i> : null}
        </b>
      </span>
      {view.range !== null ? (
        <span class="pager">
          <button type="button" aria-label="Previous cards" data-fk="sift:prev" disabled={view.page === 0} onClick={() => send({ t: "siftPage", group: view.group, delta: -1 })}>
            ‹
          </button>
          <span>{view.range}</span>
          <button type="button" aria-label="More cards" data-fk="sift:next" disabled={view.page >= view.pages - 1} onClick={() => send({ t: "siftPage", group: view.group, delta: 1 })}>
            ›
          </button>
        </span>
      ) : null}
      <Close label="Put back" send={send} />
    </div>
  );
}
