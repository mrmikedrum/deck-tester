// The log as the old client drew it (live.js `feed`, `fullLog`, `recapHTML`, `lostSheet`): a strip of parchment at the
// top left with the turn and the newest one or two lines, a tap away from the whole log ("What happened"), turns newest
// first; the loss notice beside the decision, a tap away from the loss report ("What you lost"); and the stack summary
// the prompt carries (`stackSummary`). Pure projections of the narrative's and play's views; opening and closing are
// the caller's (the app's focus layers).
import type { JSX } from "preact";
import type { LogSheetView, LogStripView, LossRow, RecapView } from "../narrative";
import type { StackSummaryRow } from "../play";
import { Pips } from "./pips";

const STRIP_TONE: Readonly<Record<LogStripView["tone"], string>> = {
  summary: "l-feed-events summary",
  recent: "l-feed-events recent",
  one: "l-feed-events",
};

/** The strip: hidden until a turn has begun; a tap opens the log. */
export function LogStrip({
  view,
  width = null,
  onOpen,
}: {
  readonly view: LogStripView;
  /** Narrower than its own where a card would be under it (app/seats.ts `feedWidthOf`). */
  readonly width?: number | null;
  readonly onOpen: () => void;
}): JSX.Element | null {
  if (!view.heading) return null;
  return (
    <button type="button" class="l-feed" data-audit="log" data-fk="log" aria-label="What happened" onClick={onOpen} {...(width !== null ? { style: `max-width:${width}px` } : {})}>
      <span class="l-feed-turn">{view.heading}</span>
      {view.lines.length ? (
        <span class={STRIP_TONE[view.tone]}>
          {view.lines.map((l, i) => (
            <span key={i} class={l.draw ? "l-feed-event l-feed-draw" : "l-feed-event"}>
              <Pips text={l.text} />
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

interface SheetFrameProps {
  readonly title: string;
  readonly id: string;
  /** The focus layer it is drawn for (its box takes keyboard focus when it comes up). */
  readonly layer: "log" | "losses";
  readonly style?: string | undefined;
  readonly onClose: () => void;
  readonly children: JSX.Element | (JSX.Element | null)[];
}

/** A wide sheet, as sheet.tsx draws one: the scrim (a press that starts and ends on it closes), the box, its title and
 * the close stud. */
function SheetFrame({ title, id, layer, style, onClose, children }: SheetFrameProps): JSX.Element {
  return (
    <div
      class="l-sheet wide"
      data-audit="sheet"
      data-layer={layer}
      data-scrim=""
      style={style}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="l-box" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <h3 id={id}>{title}</h3>
        {children}
        <button type="button" class="g-close" aria-label="Close" onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </div>
  );
}

const Row = ({ type, text }: { readonly type: string; readonly text: string }): JSX.Element => (
  <div class={`t-${type}`}>
    <Pips text={text} />
  </div>
);

/** "What happened": every turn, newest first, its heading over its lines, newest first; my losses a tap away. */
export function LogSheet({
  view,
  onClose,
  onLosses,
  style,
}: {
  readonly view: LogSheetView;
  readonly onClose: () => void;
  readonly onLosses: () => void;
  readonly style?: string;
}): JSX.Element {
  return (
    <SheetFrame title="What happened" id="l-log-title" layer="log" style={style} onClose={onClose}>
      {view.losses ? (
        <button type="button" class="l-opt l-history-losses" data-fk="log-losses" onClick={onLosses}>
          <b>{view.losses}</b>
        </button>
      ) : null}
      <div class="l-log">
        {view.groups.length ? (
          view.groups.map((g, i) => (
            <section key={i} class="l-log-turn">
              <Row type={g.heading.type} text={g.heading.text} />
              {g.rows.map((r, j) => (
                <Row key={j} type={r.type} text={r.text} />
              ))}
            </section>
          ))
        ) : (
          <div>Nothing yet</div>
        )}
      </div>
    </SheetFrame>
  );
}

/** "What you lost": each card, where it went, and the line that says why. */
export function LossSheet({
  rows,
  onClose,
  style,
}: {
  readonly rows: readonly LossRow[];
  readonly onClose: () => void;
  readonly style?: string;
}): JSX.Element {
  return (
    <SheetFrame title="What you lost" id="l-loss-title" layer="losses" style={style} onClose={onClose}>
      <div class="l-log">
        {rows.length ? (
          rows.map((r, i) => (
            <div key={i}>
              <b>{r.name}</b> {r.fate}
              {r.why ? (
                <small>
                  <Pips text={r.why} />
                </small>
              ) : null}
            </div>
          ))
        ) : (
          <div>Nothing yet</div>
        )}
      </div>
    </SheetFrame>
  );
}

/** The loss notice, set into the prompt: what I lost while the others played, the report a tap away. */
export function LossRecap({
  view,
  onOpen,
  onDismiss,
}: {
  readonly view: RecapView;
  readonly onOpen: () => void;
  readonly onDismiss: () => void;
}): JSX.Element {
  return (
    <div class="l-recap" data-audit="recap">
      <button type="button" class="l-lost" data-fk="recap" onClick={onOpen}>
        <b>{view.title}</b>
        {view.summary ? <small>{view.summary}</small> : null}
      </button>
      <button type="button" class="g-close" aria-label="Dismiss loss notice" onClick={onDismiss}>
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}

/**
 * The stack summary set into the prompt while two or more items are up: one line each, top first, numbered ("1 Arcane
 * Denial → Swords to Plowshares"); what is aimed at me or mine in the danger ink.
 */
export function StackSummary({ rows }: { readonly rows: readonly StackSummaryRow[] }): JSX.Element | null {
  if (!rows.length) return null;
  return (
    <ol class="l-stackinfo" aria-label="Stack, top first">
      {rows.map((r) => (
        <li key={r.item} class={r.aimed ? "aimed" : undefined}>
          <span class="l-order">{r.n}</span> {r.title}
          {r.at ? ` → ${r.at}` : ""}
        </li>
      ))}
    </ol>
  );
}
