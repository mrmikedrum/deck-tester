// A sheet: a choice the board can't show (live.js `sheet`, `offer`, `chooser`, `pickColor`, `openStackRules`). A pure
// projection of play's SheetView. One card's plays, every play, which source and which mana are lists of `l-opt` rows
// (live.js `offer`); a chooser is a grid where a card the table or the catalogue can picture is drawn as the card and
// anything else as a row (live.js `chooser`); the number stepper; the stack's rules from the model, top first. Tapping
// an item picks its option, the stepper steps, the buttons press; the stud or a press that starts and ends on the scrim
// dismisses (by the focus stack's rule: play says whether its sheet may go).
import type { JSX } from "preact";
import type { Button, SheetItem, SheetView } from "../play";
import type { CardId } from "../protocol";
import { Pips } from "./pips";
import type { Send } from "./send";
import type { CardLook, StackRow } from "./view";

/** More cards than this share two balanced rows (live.js `chooser`). */
const TWO_ROWS_OVER = 6;

const ROW_TONE: Readonly<Record<Button["tone"], string>> = { primary: "l-done", secondary: "", ghost: "l-ghost" };

interface SheetProps {
  readonly sheet: SheetView;
  readonly looks: ReadonlyMap<CardId, CardLook>;
  /** Looks for items off the table, by name. */
  readonly named: ReadonlyMap<string, CardLook>;
  /** The stack, top first, for the stack's rules. */
  readonly stack: readonly StackRow[];
  readonly send: Send;
  readonly style?: string;
}

function itemImage(item: SheetItem, looks: ReadonlyMap<CardId, CardLook>, named: ReadonlyMap<string, CardLook>): string | null {
  if (item.card !== null) return looks.get(item.card)?.image ?? null;
  return item.name !== null ? (named.get(item.name)?.image ?? null) : null;
}

function Row({ item, mana, send }: { item: SheetItem; mana: boolean; send: Send }): JSX.Element {
  const cls = ["l-opt", mana ? "l-mana" : "", item.picked ? "on" : ""].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      class={cls}
      data-n={item.badge !== null ? String(item.badge) : undefined}
      data-option={item.option}
      onClick={() => send({ a: "pick", option: item.option })}
    >
      <b>
        <Pips text={item.label} />
        {item.cost ? (
          <span class="cost">
            <Pips text={item.cost} />
          </span>
        ) : null}
      </b>
      {item.detail && item.detail !== item.label ? (
        <small>
          <Pips text={item.detail} />
        </small>
      ) : null}
    </button>
  );
}

function CardItem({ item, image, send }: { item: SheetItem; image: string; send: Send }): JSX.Element {
  return (
    <button
      type="button"
      class={item.picked ? "l-card on" : "l-card"}
      data-n={item.badge !== null ? String(item.badge) : undefined}
      data-option={item.option}
      onClick={() => send({ a: "pick", option: item.option })}
    >
      <span class="pic" style={`background-image:url("${image}")`} />
      <small>{item.label}</small>
    </button>
  );
}

/** A chooser's grid: cards as cards, everything else as rows; past six cards, two balanced rows. */
function Grid({ sheet: s, looks, named, send }: SheetProps): JSX.Element {
  const images = s.items.map((item) => itemImage(item, looks, named));
  const cards = images.filter(Boolean).length;
  const two = cards > TWO_ROWS_OVER;
  return (
    <div class={two ? "l-grid two" : "l-grid"} style={two ? `--cols:${Math.ceil(cards / 2)}` : undefined}>
      {s.items.map((item, i) => {
        const image = images[i];
        return image ? <CardItem key={item.option} item={item} image={image} send={send} /> : <Row key={item.option} item={item} mana={false} send={send} />;
      })}
    </div>
  );
}

/** The stack's rules, first to resolve first: whose each is, what an ability does, the card's rules text. */
function StackRules({ rows }: { rows: readonly StackRow[] }): JSX.Element {
  return (
    <>
      {rows.map((r) => (
        <section key={r.id} class="l-rules">
          <b>{r.title}</b>
          {r.effect ? (
            <div>
              <Pips text={r.effect} />
            </div>
          ) : null}
          {r.rules ? (
            <div>
              <Pips text={r.rules} />
            </div>
          ) : null}
        </section>
      ))}
    </>
  );
}

/** The stud set into a sheet or a leaf: ✕, a 44px target. */
export function Close({ send, label = "Close" }: { send: Send; label?: string }): JSX.Element {
  return (
    <button type="button" class="g-close" aria-label={label} onClick={() => send({ t: "dismiss" })}>
      <span aria-hidden="true">✕</span>
    </button>
  );
}

/** A scrim's click: only on the scrim itself (a press that went down and came up outside the box). */
export const onScrim =
  (send: Send) =>
  (e: MouseEvent): void => {
    if (e.target === e.currentTarget) send({ t: "dismiss" });
  };

export function Sheet(p: SheetProps): JSX.Element {
  const { sheet: s, send } = p;
  const body =
    s.kind === "stack" ? (
      <StackRules rows={p.stack} />
    ) : s.kind === "chooser" ? (
      <Grid {...p} />
    ) : (
      s.items.map((item) => <Row key={item.option} item={item} mana={s.kind === "mana"} send={send} />)
    );
  return (
    <div class={s.wide ? "l-sheet wide" : "l-sheet"} data-audit="sheet" data-layer="sheet" data-scrim="" style={p.style} onClick={onScrim(send)}>
      <div class="l-box" role="dialog" aria-modal="true" aria-labelledby="l-sheet-title" tabIndex={-1}>
        <h3 id="l-sheet-title">{s.title}</h3>
        {s.stepper ? (
          <div class="l-number">
            {/* Never disabled (live.js `chooser`): a step past a bound stays at it (play clamps); the end only dims. */}
            <button type="button" aria-label="Less" class={s.stepper.value <= s.stepper.min ? "end" : undefined} onClick={() => send({ a: "step", by: -1 })}>
              −
            </button>
            <output aria-live="polite">{s.stepper.value}</output>
            <button type="button" aria-label="More" class={s.stepper.value >= s.stepper.max ? "end" : undefined} onClick={() => send({ a: "step", by: 1 })}>
              +
            </button>
          </div>
        ) : null}
        {body}
        {s.buttons.length ? (
          <div class="l-row">
            {s.buttons.map((b) => (
              <button
                type="button"
                key={b.id}
                class={ROW_TONE[b.tone] || undefined}
                data-button={b.id}
                disabled={!b.enabled}
                onClick={() => send({ a: "press", button: b.id })}
              >
                <Pips text={b.label} />
              </button>
            ))}
          </div>
        ) : null}
        <Close send={send} />
      </div>
    </div>
  );
}
