// The seats' nameplates and the nameplate focus. A nameplate is chrome: square to the screen, always lit, never covered
// by the table. It carries the seat's sigil, name and life, and its summary as a few icons with figures; a tap on it is
// the tap on its plate (a target when a decision asks for a player; otherwise it opens the seat in words). The focus
// lays the summary out in words, one line led by each icon, so the page teaches the plate, with the seat's zones picked
// up as printed cards. Pure projections; each sends an act for play or an order for the app.
import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import type { Send } from "./send";
import { Close, onScrim } from "./sheet";
import type { IconKind, PickedCard, PlateView, SeatFocusView } from "./view";

/** The icons, drawn in ink on a 24 box. */
const ICON: Readonly<Record<IconKind, JSX.Element>> = {
  power: (
    <>
      <path d="M19.5 4.5 9 15" />
      <path d="M19.5 4.5h-3.2M19.5 4.5v3.2" />
      <path d="M6.6 12.6l4.8 4.8M8 18.8l-3 3M5.4 16.2 3 18.6" />
    </>
  ),
  creatures: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M9 17h6" />
    </>
  ),
  wing: <path d="M20 4C12 5 6 10 4 20c3-4 6-6 10-7l-3-1c3-1 5-3 6-5l-3 .5C16.5 6 18.5 5 20 4z" />,
  shield: <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z" />,
  mana: <path d="M12 3.5S6.5 10.6 6.5 14.6a5.5 5.5 0 0 0 11 0C17.5 10.6 12 3.5 12 3.5z" />,
  hand: (
    <>
      <rect x="3.5" y="6" width="9.5" height="14" rx="1.6" transform="rotate(-12 8 13)" />
      <rect x="10.5" y="5" width="9.5" height="14" rx="1.6" transform="rotate(10 15 12)" />
    </>
  ),
};

export function Icon({ kind, none }: { kind: IconKind; none?: boolean | undefined }): JSX.Element {
  return (
    <svg class={none ? "l-icon none" : "l-icon"} viewBox="0 0 24 24" aria-hidden="true">
      {ICON[kind]}
      {none ? <path class="strike" d="M4 20 20 4" /> : null}
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
};

/**
 * Every seat's nameplate: opponents' along the top, mine at the bottom. Always lit, but `inert` under a modal layer
 * of another kind (a menu, a sheet, the inspector): a plate answers decisions, so it is reached only from the table or
 * from the nameplate focus, where another plate is the way to another seat.
 */
export function Plates({ plates, open, inert, send }: { plates: readonly PlateView[]; open: string | null; inert: boolean; send: Send }): JSX.Element {
  return (
    <div class="l-plates" inert={inert}>
      {plates.map((p) => {
        const said = `${p.name}, ${p.life} life, ${p.icons.map((i) => `${i.figure} ${WORD[i.kind]}`).join(", ")}${p.tally ? `, ${p.tally.figure.slice(1)} unblocked` : ""}`;
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
            onClick={() => send({ a: "tap", on: { group: p.group as never, members: [] } })}
          >
            <span class="bronze">
              <i class="sigil" />
              <b class="name">{p.name}</b>
              <span class="life">{p.life}</span>
            </span>
            {p.tally ? (
              <span class={`tally ${p.tally.tone}`} style={`--tally-ink:var(--seat-${p.tally.place})`}>
                {p.tally.figure}
              </span>
            ) : null}
            {p.icons.length ? (
              <span class="tab">
                {p.icons.map((i) => (
                  <span key={i.kind} class="fig">
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

function Picked({ cards, max, empty, more }: { cards: readonly PickedCard[]; max: number; empty: string; more?: (() => void) | undefined }): JSX.Element {
  if (!cards.length) return <div class="l-zone-empty">{empty}</div>;
  const shown = cards.slice(0, max);
  const rest = cards.length - max;
  return (
    <div class="l-picked">
      {shown.map((c, i) => (
        <span
          key={c.id ?? `b${i}`}
          class={c.image ? "pc" : "pc back"}
          role="img"
          aria-label={c.name}
          style={c.image ? `background-image:url("${c.image}")` : undefined}
        />
      ))}
      {rest > 0 ? (
        more ? (
          <button type="button" class="l-more" onClick={more}>
            {rest} more
          </button>
        ) : (
          <small>{rest} more</small>
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
              <Picked cards={v.graveyard} max={5} empty="Empty" more={openZone("graveyard")} />
              {v.graveyard.length ? <small class="note">newest first</small> : null}
            </section>
            <div class="row">
              <section>
                <ZoneHead label="Exile" n={v.exile.length} open={v.exile.length ? openZone("exile") : undefined} />
                <Picked cards={v.exile} max={3} empty="Empty" more={openZone("exile")} />
              </section>
              <section>
                <h4>
                  Hand <b>{v.handCount}</b>
                </h4>
                <Picked cards={v.hand} max={v.mine ? 7 : 4} empty="Empty" />
              </section>
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
          {!v.mine ? (
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
