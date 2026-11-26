// A sheet: a choice the board can't show (live.js `sheet`, `offer`, `chooser`, `pickColor`, `openStackRules`). A pure
// projection of play's SheetView, but for the page a card sheet is on. One card's plays, every play, which source and
// which mana are lists of `l-opt` rows (live.js `offer`); a chooser whose options are cards (a library search, a
// graveyard, revealed cards) deals the printed cards, one size, in at most two rows, with pages past what fits
// (chrome/deal.ts); a chooser of words is rows; the number stepper; the stack's rules from the model, top first.
// Tapping an item picks its option, the stepper steps, the pager turns, the buttons press; the stud or a press that
// starts and ends on the scrim dismisses (by the focus stack's rule: play says whether its sheet may go).
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { Button, SheetItem, SheetView } from "../play";
import type { CardId } from "../protocol";
import { CARD_GAP, deal, tapOf, tilesOf } from "./deal";
import type { Deal, Tile } from "./deal";
import { Pips } from "./pips";
import type { Send } from "./send";
import type { CardLook, StackRow } from "./view";

const ROW_TONE: Readonly<Record<Button["tone"], string>> = { primary: "l-done", secondary: "" };
/** The sheet's Clear keeps the class the behaviour suite finds it by (it was the pill tier's); it is a secondary plate. */
const CLEAR_HOOK = "l-ghost";

/** The room a sheet has: the viewport, its safe area and the design unit. */
interface SheetArea {
  readonly w: number;
  readonly h: number;
  readonly safe: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly u: number;
}

interface SheetProps {
  readonly sheet: SheetView;
  readonly looks: ReadonlyMap<CardId, CardLook>;
  /** Looks for items off the table, by name. */
  readonly named: ReadonlyMap<string, CardLook>;
  /** The stack, top first, for the stack's rules. */
  readonly stack: readonly StackRow[];
  readonly send: Send;
  readonly style?: string;
  /** Where a card sheet deals its cards (the iPad's landscape screen when not given). */
  readonly area?: SheetArea;
}

const IPAD: SheetArea = { w: 1210, h: 834, safe: { top: 0, right: 0, bottom: 0, left: 0 }, u: Math.min(1210 / 1180, 834 / 820) };

/** What a card sheet keeps off its cards, design px: the plates above and below it, the scrim's margin, the box's
 * padding, its title and its foot (the pager and the buttons), room round the cards for a picked one's lift and ring,
 * and a row's height for each option with no card. */
const ROOM = { plates: 58, side: 16, pad: 22, title: 54, foot: 66, lift: 14, row: 56 } as const;

/** The grid area a card sheet has for its cards, CSS px. */
function gridArea(a: SheetArea, rows: number): { w: number; h: number } {
  const u = a.u;
  const w = a.w - a.safe.left - a.safe.right - 2 * ROOM.side - 2 * (ROOM.pad * u + ROOM.lift);
  const h = a.h - a.safe.top - a.safe.bottom - 2 * ROOM.plates * u - (2 * ROOM.pad + ROOM.title + ROOM.foot + rows * ROOM.row) * u - 2 * ROOM.lift;
  return { w: Math.max(0, w), h: Math.max(0, h) };
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

/** One place on a card sheet: the printed card (or copies of it lying as a pile, with their count), as a control.
 * Picked: lifted in a gold ring with a seal. Full (the choice takes no more): dimmed. */
function CardTile({ tile, picked, max, send }: { tile: Tile; picked: number; max: number; send: Send }): JSX.Element {
  const mine = tile.items.filter((i) => i.picked).length;
  const copies = tile.items.length;
  const option = tapOf(tile, picked, max);
  const full = !mine && picked >= max && max > 1;
  const badge = copies === 1 ? tile.items[0]!.badge : mine > 1 ? mine : null;
  const cls = ["l-card", mine ? "on" : "", full || option === null ? "full" : "", copies > 1 ? "pile" : ""].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      class={cls}
      data-n={badge !== null ? String(badge) : undefined}
      data-option={option ?? tile.items[0]!.option}
      aria-pressed={mine > 0}
      onClick={() => (option !== null && !full ? send({ a: "pick", option }) : undefined)}
    >
      <span class="pic" style={tile.image ? `background-image:url("${tile.image}")` : undefined}>
        {tile.image ? null : <b aria-hidden="true">{tile.name}</b>}
      </span>
      <span class="sr">{copies > 1 ? `${tile.label}, ${copies} copies` : tile.label}</span>
      {copies > 1 || tile.tag ? (
        <span class="count" aria-hidden="true">
          {tile.tag ? <Pips text={tile.tag} /> : null}
          {copies > 1 ? `×${copies}` : null}
        </span>
      ) : null}
      {mine ? (
        <span class="seal" aria-hidden="true">
          {badge !== null ? (
            badge
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          )}
        </span>
      ) : null}
    </button>
  );
}

/** The pager: back, a stud per page with the current one lit, on. */
function Pager({ page, pages, turn }: { page: number; pages: number; turn: (to: number) => void }): JSX.Element {
  return (
    <div class="l-pager" role="group" aria-label={`Page ${page + 1} of ${pages}`}>
      <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => turn(page - 1)}>
        <span aria-hidden="true">‹</span>
      </button>
      <span class="studs" aria-hidden="true">
        {Array.from({ length: pages }, (_, i) => (
          <i key={i} class={i === page ? "on" : undefined} />
        ))}
      </span>
      <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => turn(page + 1)}>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

/** A chooser's cards as dealt: the page shown, in a grid of one card size; the rows; the pager. */
function CardGrid({ tiles, rows, d, sheet, send }: { tiles: readonly Tile[]; rows: readonly SheetItem[]; d: Deal; sheet: SheetView; send: Send }): JSX.Element {
  // The page is the chrome's own: the same sheet keeps it while picks change; another sheet starts at the first.
  const [at, setAt] = useState<{ key: string; page: number }>({ key: "", page: 0 });
  const key = `${sheet.title}|${sheet.items.length}`;
  const page = at.key === key ? Math.min(at.page, d.pages - 1) : 0;
  const turn = (to: number) => setAt({ key, page: Math.max(0, Math.min(d.pages - 1, to)) });
  const shown = tiles.slice(page * d.perPage, (page + 1) * d.perPage);
  const picked = sheet.items.filter((i) => i.picked).length;
  const max = sheet.pick?.max ?? sheet.items.length;
  return (
    <>
      <div
        class="l-grid l-deal"
        style={`--cw:${d.w}px;--cols:${Math.min(d.cols, Math.max(1, tiles.length))};--rows:${d.pages > 1 ? d.rows : Math.ceil(tiles.length / d.cols)}`}
        onKeyDown={(e) => {
          if (d.pages > 1 && (e.key === "ArrowRight" || e.key === "ArrowLeft")) turn(page + (e.key === "ArrowRight" ? 1 : -1));
        }}
      >
        {shown.map((t) => (
          <CardTile key={t.key} tile={t} picked={picked} max={max} send={send} />
        ))}
        {rows.map((item) => (
          <Row key={item.option} item={item} mana={false} send={send} />
        ))}
      </div>
      {d.pages > 1 ? <Pager page={page} pages={d.pages} turn={turn} /> : null}
    </>
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
  const area = p.area ?? IPAD;
  // A chooser with any option the table or the catalogue can picture is dealt as cards; the rest go under them as rows.
  const dealt =
    s.kind === "chooser"
      ? tilesOf(s, (item) => {
          const l = item.card !== null ? p.looks.get(item.card) : item.name !== null ? p.named.get(item.name) : undefined;
          return l ? { name: l.name, image: l.image } : null;
        })
      : null;
  const cards = dealt && dealt.tiles.length ? dealt : null;
  let body: JSX.Element | JSX.Element[];
  let width: string | undefined;
  if (cards) {
    const g = gridArea(area, cards.rows.length);
    const d = deal(cards.tiles.length, g.w, g.h, area.u);
    const cols = Math.min(d.cols, cards.tiles.length);
    width = `width:${Math.max(cols * d.w + (cols - 1) * CARD_GAP * area.u + 2 * (ROOM.pad * area.u + ROOM.lift), 560 * area.u)}px`;
    body = <CardGrid tiles={cards.tiles} rows={cards.rows} d={d} sheet={s} send={send} />;
  } else if (s.kind === "stack") body = <StackRules rows={p.stack} />;
  else if (s.kind === "chooser")
    body = (
      <div class="l-grid">
        {s.items.map((item) => (
          <Row key={item.option} item={item} mana={false} send={send} />
        ))}
      </div>
    );
  else body = s.items.map((item) => <Row key={item.option} item={item} mana={s.kind === "mana"} send={send} />);
  const cls = ["l-sheet", s.wide && !cards ? "wide" : "", cards ? "cards" : ""].filter(Boolean).join(" ");
  return (
    <div class={cls} data-audit="sheet" data-layer="sheet" data-scrim="" style={p.style} onClick={onScrim(send)}>
      <div class="l-box" role="dialog" aria-modal="true" aria-labelledby="l-sheet-title" tabIndex={-1} style={width}>
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
                class={[ROW_TONE[b.tone], b.role === "clear" ? CLEAR_HOOK : ""].filter(Boolean).join(" ") || undefined}
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
