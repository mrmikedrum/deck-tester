// The seats' nameplates and the nameplate focus. A nameplate is chrome: square to the screen, always lit, never covered
// by the table. It carries the seat's sigil, name and life, and its summary as a few icons with figures; a tap on it is
// the tap on its plate (a target when a decision asks for a player; otherwise it opens the seat in words). The focus
// lays the summary out in words, one line led by each icon, so the page teaches the plate, with the seat's zones picked
// up as printed cards. Pure projections; each sends an act for play or an order for the app.
import type { JSX } from "preact";
import { useMemo, useRef } from "preact/hooks";
import type { CardId } from "../protocol";
import { SEAT_GLYPHS } from "../theme";
import type { GlyphPart } from "../theme";
import type { Send } from "./send";
import { Close, onScrim } from "./sheet";
import type { IconKind, PickedCard, PlateView, SeatFocusView } from "./view";

/** A seat glyph (theme's SEAT_GLYPHS): ink on a 24 box, the same on the plate and in its focus; struck through when the
 * absence is the answer. */
export function Icon({ kind, none }: { kind: IconKind; none?: boolean | undefined }): JSX.Element {
  return (
    <svg class={none ? "l-icon none" : "l-icon"} viewBox="0 0 24 24" aria-hidden="true">
      {SEAT_GLYPHS[kind].map((part: GlyphPart, i) => (
        <path key={i} d={part.d} class={part.cut ? "cut" : undefined} transform={part.turn ? `rotate(${part.turn.join(" ")})` : undefined} />
      ))}
      {none ? (
        <>
          <path class="strike-rim" d="M4 20 20 4" />
          <path class="strike" d="M4 20 20 4" />
        </>
      ) : null}
    </svg>
  );
}

const WORD: Readonly<Record<IconKind, string>> = {
  power: "power on the table",
  creatures: "creatures",
  wing: "fliers",
  shield: "untapped creatures",
  mana: "untapped mana sources",
  hand: "cards in hand",
  graveyard: "cards in the graveyard",
  exile: "cards in exile",
  command: "in the command zone",
};

/** How far a portrait moves before a press on it is a drag, CSS px. */
const DRAG_PX = 6;

/**
 * A commander waiting in the command zone, as a small framed portrait of its art tucked against its seat's plate (every
 * seat alike: on the plate, not on the table, it never reads as a permanent). A tap reads it (the plate's click sends it);
 * mine may also be dragged onto the table to cast it, as a hand card is let go (play's rule: far enough up, over the
 * table).
 */
function Portrait({ card, seat, mine, send }: { card: PickedCard & { readonly cast?: boolean }; seat: string; mine: boolean; send: Send }): JSX.Element {
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const el = useRef<HTMLSpanElement>(null);
  const down = (e: PointerEvent): void => {
    if (!mine || card.id === null) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    el.current?.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !el.current) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    d.moved = true;
    el.current.classList.add("dragging");
    el.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const up = (e: PointerEvent): void => {
    const d = drag.current, node = el.current;
    if (!d || d.id !== e.pointerId || !node) return;
    drag.current = null;
    if (!d.moved) return;
    // (the click the press ends in is not a tap)
    node.dataset["dragged"] = "1";
    const r = node.getBoundingClientRect();
    node.classList.remove("dragging");
    node.style.transform = "";
    // Over the table: the first thing under the finger, past the portrait itself, is the table's canvas.
    const under = (node.ownerDocument.elementsFromPoint?.(e.clientX, e.clientY) ?? []).find((x) => !node.contains(x) && x !== node);
    // (under the decision it was pressed on: a release under a newer one is dropped, as a hand card's is)
    send({ a: "release", card: card.id as CardId, dy: e.clientY - d.y, pose: { rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, rotation: 0, scale: 1 }, overTable: under?.tagName === "CANVAS" }, { pressed: true });
  };
  const cancel = (): void => {
    drag.current = null;
    el.current?.classList.remove("dragging");
    if (el.current) el.current.style.transform = "";
  };
  return (
    <span
      ref={el}
      class={["cmd", card.cast ? "option" : "", card.art ? "" : "bare"].filter(Boolean).join(" ")}
      data-cmd={card.id ?? ""}
      title={`${card.name}, ${mine ? "your" : `${seat}'s`} commander in the command zone`}
      style={card.art ? `background-image:url("${card.art}")` : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
    >
      <Icon kind="command" />
      {card.art ? null : <i class="cmd-name">{card.name}</i>}
    </span>
  );
}

/**
 * Every seat's nameplate: opponents' along the top, mine at the bottom. Always lit, but `inert` under a modal layer
 * of another kind (a menu, a sheet, the inspector): a plate answers decisions, so it is reached only from the table or
 * from the nameplate focus, where another plate is the way to another seat.
 */
export function Plates({ plates, open, inert, send }: { plates: readonly PlateView[]; open: string | null; inert: boolean; send: Send }): JSX.Element {
  return (
    <div class="l-plates" inert={inert}>
      {plates.map((p) => {
        const waiting = (p.commanders ?? []).map((c) => `, ${c.name} ${WORD.command}`).join("");
        const said = p.out ? `${p.name}, out of the game` : `${p.name}, ${p.life} life, ${p.icons.map((i) => `${i.figure} ${WORD[i.kind]}`).join(", ")}${waiting}${p.tally ? `, ${p.tally.figure.slice(1)} unblocked` : ""}`;
        return (
          <button
            key={p.seat}
            type="button"
            class={["l-plate", p.mine ? "mine" : "", p.active ? "turn" : "", p.ring ?? "", p.out ? "out" : "", p.attacking ? "attacking" : "", open === p.seat ? "open" : ""].filter(Boolean).join(" ")}
            data-plate={p.seat}
            data-fk={`plate:${p.seat}`}
            aria-label={said}
            aria-expanded={open === p.seat}
            style={`left:${p.x}px;top:${p.y}px;${p.mine ? "transform:translate(-50%,-100%);" : ""}--u:${p.unit}px;--seat:var(--seat-${p.place})`}
            onClick={(e) => {
              // (my graveyard's and exile's counts open those zones, whatever else a tap on my plate means: my commander)
              const zone = (e.target as Element).closest?.("[data-zone]")?.getAttribute("data-zone");
              if (zone === "graveyard" || zone === "exile") return send({ t: "zone", seat: p.seat, zone });
              // A waiting commander's portrait: that card (to read it; mine, to cast it), unless it was just dragged.
              const cmd = (e.target as Element).closest?.<HTMLElement>("[data-cmd]");
              if (cmd) {
                if (cmd.dataset["dragged"]) return void delete cmd.dataset["dragged"];
                if (cmd.dataset["cmd"]) return send({ a: "tap", on: { card: Number(cmd.dataset["cmd"]) as CardId } });
              }
              send(p.out ? { t: "seat", seat: p.seat } : { a: "tap", on: { group: p.group as never, members: [] } });
            }}
          >
            {(p.commanders ?? []).map((c) => (
              <Portrait key={c.id ?? c.name} card={c} seat={p.name} mine={p.mine} send={send} />
            ))}
            <span class="bronze">
              <i class="sigil" />
              <b class="name">{p.name}</b>
              {p.out ? (
                <span class="gone">Out</span>
              ) : (
                <span class="life">
                  {p.life}
                  {/* In a combat, the damage coming: hung from the life toward the table, a debit against it. */}
                  {p.tally ? (
                    <span class={`tally ${p.tally.tone}`} style={`--tally-ink:var(--seat-${p.tally.place})`}>
                      {p.tally.figure}
                    </span>
                  ) : null}
                </span>
              )}
            </span>
            {p.icons.length ? (
              <span class="tab">
                {p.icons.map((i) => (
                  <span key={i.kind} class="fig" {...(i.kind === "graveyard" || i.kind === "exile" ? { "data-zone": i.kind } : {})}>
                    <Icon kind={i.kind} none={i.none} />
                    {i.figure}
                  </span>
                ))}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** A zone's cards picked up: the first `max` as printed cards, fanned a little; past them a card-sized "+N" that opens
 * the zone in full (its sift, which pages), as does any card shown. */
function Picked({ cards, max, more }: { cards: readonly PickedCard[]; max: number; more?: (() => void) | undefined }): JSX.Element {
  if (!cards.length) return <div class="l-zone-empty">Empty</div>;
  const rest = cards.length - max;
  const shown = cards.slice(0, rest > 0 ? max - 1 : max);
  const left = cards.length - shown.length;
  return (
    <div class="l-picked">
      {shown.map((c, i) =>
        more ? (
          <button key={c.id ?? `b${i}`} type="button" class={c.image ? "pc" : "pc back"} aria-label={c.name} style={c.image ? `background-image:url("${c.image}")` : undefined} onClick={more} />
        ) : (
          <span key={c.id ?? `b${i}`} class={c.image ? "pc" : "pc back"} role="img" aria-label={c.name} style={c.image ? `background-image:url("${c.image}")` : undefined} />
        ),
      )}
      {rest > 0 ? (
        more ? (
          <button type="button" class="pc l-more" aria-label={`${left} more`} onClick={more}>
            +{left}
          </button>
        ) : (
          <span class="pc l-more" role="img" aria-label={`${left} more`}>
            +{left}
          </span>
        )
      ) : null}
    </div>
  );
}

/** A zone's heading; with cards in it, the way to open it in full. */
function ZoneHead({ label, n, open }: { label: string; n: number; open?: (() => void) | undefined }): JSX.Element {
  return (
    <h4>
      {open ? (
        <button type="button" class="l-zone-open" aria-label={`Open ${label.toLowerCase()}, ${n} card${n === 1 ? "" : "s"}`} onClick={open}>
          {label} <b>{n}</b> <span aria-hidden="true">›</span>
        </button>
      ) : (
        <>
          {label} <b>{n}</b>
        </>
      )}
    </h4>
  );
}

function CommanderDamage({ rows }: { rows: SeatFocusView["commanderDamage"] }): JSX.Element | null {
  return useMemo(() => rows.length ? (
    <section class="commander-damage">
      <h4>Commander damage</h4>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            {row.source} · <strong class={row.danger ? "danger" : undefined}>{row.figure}</strong>
          </li>
        ))}
      </ul>
    </section>
  ) : null, [rows]);
}

/** A nameplate opened: the seat in words, a line per icon; its zones picked up; the way to its board and back. */
export function SeatFocus({ view: v, send, style }: { view: SeatFocusView; send: Send; style?: string }): JSX.Element {
  const openZone = (zone: "graveyard" | "exile") => () => send({ t: "zone", seat: v.seat, zone });
  return (
    <div class="l-seat-scrim" data-layer="seat" data-scrim="" style={style} onClick={onScrim(send)}>
      <div class="l-seat" role="dialog" aria-modal="true" aria-labelledby="l-seat-title" tabIndex={-1} data-focus="" style={`--seat:var(--seat-${v.place})`}>
        <header>
          <h3 id="l-seat-title">{v.name}</h3>
          <b class="life">{v.life} life</b>
        </header>
        <div class="cols">
          <div class="summary">
            <ul class="lines">
              {v.lines.map((l) => (
                <li key={l.icon} class={l.none ? "none" : undefined}>
                  <Icon kind={l.icon} none={l.none} />
                  <span>
                    <b>{l.head}</b>
                    {l.sub ? <small>{l.sub}</small> : null}
                  </span>
                </li>
              ))}
            </ul>
            <CommanderDamage rows={v.commanderDamage} />
          </div>
          <div class="zones">
            <section class="gy">
              <ZoneHead label="Graveyard" n={v.graveyard.length} open={v.graveyard.length ? openZone("graveyard") : undefined} />
              <Picked cards={v.graveyard} max={7} more={openZone("graveyard")} />
            </section>
            <div class="row">
              <section class="ex">
                <ZoneHead label="Exile" n={v.exile.length} open={v.exile.length ? openZone("exile") : undefined} />
                <Picked cards={v.exile} max={v.hand.length ? 2 : 3} more={openZone("exile")} />
              </section>
              {v.command.length ? (
                <section>
                  <h4>
                    Command <b>{v.command.length}</b>
                  </h4>
                  <Picked cards={v.command} max={2} />
                </section>
              ) : null}
              {v.hand.length ? (
                <section>
                  <h4>
                    Hand <b>{v.handCount}</b>
                  </h4>
                  <Picked cards={v.hand} max={2} />
                </section>
              ) : null}
              <section>
                <h4>
                  Library <b>{v.library}</b>
                </h4>
                <div class="l-library" style={`--n:${Math.min(12, Math.ceil(v.library / 6))}`} role="img" aria-label={`${v.library} cards in the library`} />
              </section>
            </div>
            {v.also ? <p class="also">{v.also}</p> : null}
          </div>
        </div>
        <div class="l-row">
          {!v.mine && v.board ? (
            <button type="button" data-fk={`board:${v.seat}`} onClick={() => send({ t: "board", seat: v.seat })}>
              See {v.name}'s board
            </button>
          ) : null}
          <button type="button" class="l-done" onClick={() => send({ t: "dismiss" })}>
            Back to the table
          </button>
        </div>
        <Close send={send} />
      </div>
    </div>
  );
}
