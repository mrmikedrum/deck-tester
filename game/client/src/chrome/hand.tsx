// The hand (live.js `renderHeld`): the fan in the bottom-left corner, cards that were let go held where they were,
// and the peek. A pure projection of the HandView and the hand's motion for this commit (chrome/frame/hand.ts): the
// gestures are read on the host element by the renderer, not here. Cards are focusable: Enter taps, arrows turn.
import type { JSX } from "preact";
import type { CardId } from "../protocol";
import type { ScreenPose } from "../play";
import type { HandFrame } from "./frame";
import { Pips } from "./pips";
import type { CardLook, HandCard, HandView } from "./view";

interface HandProps {
  readonly hand: HandView;
  readonly frame: HandFrame;
  readonly looks: ReadonlyMap<CardId, CardLook>;
  /** The fan's origin on screen and the card's size (CSS px). */
  readonly ox: number;
  readonly oy: number;
  readonly vh: number;
  readonly cardW: number;
  readonly cardH: number;
  readonly onKey: (card: CardId, key: string) => boolean;
}

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;
const deg = (n: number): string => `${Math.round(n * 1000) / 1000}deg`;
// A card is its printed image. Under it, as the stand-in while the image loads or where there is none, the painted face:
// the art under a name strip as wide as the fan gives it, rounded up; a name breaks only between words, and where a
// bunched card's strip is narrower than its longest word the name shrinks to fit (`--label-k`), ellipsized at the floor
// (`tight`). The image covers it as soon as it decodes, with no motion.

function Face({ card, tight = false }: { card: HandCard; tight?: boolean }): JSX.Element {
  return (
    <div class="l-hand-face">
      <StandIn card={card} tight={tight} />
      {card.image ? <div class="l-hand-print" style={`background-image:url("${card.image}")`} /> : null}
    </div>
  );
}

/** A bunched card's cost, on a small vellum ribbon above its top-left corner. */
function Ribbon({ cost }: { cost: string }): JSX.Element {
  return (
    <div class="l-hand-cost" aria-hidden="true">
      <Pips text={cost} />
    </div>
  );
}

function StandIn({ card, tight }: { card: HandCard; tight: boolean }): JSX.Element {
  return (
    <>
      <div class="l-hand-art" style={card.art ? `background-image:url("${card.art}")` : undefined} />
      <div class={tight ? "l-hand-label tight" : "l-hand-label"}>
        {card.name}
        {card.cost ? (
          <>
            {" "}
            <span class="cost">
              <Pips text={card.cost} />
            </span>
          </>
        ) : null}
      </div>
      {card.rules ? (
        <div class="l-hand-rules">
          <Pips text={card.rules} />
        </div>
      ) : null}
    </>
  );
}

function lookOf(id: CardId, cards: ReadonlyMap<CardId, HandCard>, looks: ReadonlyMap<CardId, CardLook>): HandCard {
  const c = cards.get(id);
  if (c) return c;
  const l = looks.get(id);
  return { id, name: l?.name ?? "", cost: l?.cost ?? null, art: l?.art ?? null, image: l?.image ?? null, rules: null, playable: false };
}

/** A card held at a screen pose: its box centred on the pose's rect, pivoting on its bottom middle like the fan's. */
function looseStyle(pose: ScreenPose, w: number, h: number): string {
  const cx = (pose.rect.left + pose.rect.right) / 2;
  const s = w > 0 ? (pose.rect.right - pose.rect.left) / w : 1;
  return `left:${px(cx - w / 2)};top:${px(pose.rect.bottom - h)};transform:rotate(${deg(pose.rotation)}) scale(${s});z-index:39`;
}

export function Hand(p: HandProps): JSX.Element {
  const cards = new Map(p.hand.cards.map((c) => [c.id, c]));
  const fresh = new Set(p.hand.fresh);
  const peek = p.frame.peek ? cards.get(p.frame.peek.id) : undefined;
  return (
    <div class={p.hand.away ? "g-hand away" : "g-hand"} data-audit="hand" style={`--hw:${px(p.cardW)};--hh:${px(p.cardH)}`}>
      <div class="held" style={`left:${px(p.ox)};bottom:${px(p.vh - p.oy)}`}>
        {p.frame.cards.map((d) => {
          const c = lookOf(d.id, cards, p.looks);
          const cls = [
            "hcard",
            c.image ? "printed" : "",
            c.playable ? "playable" : "",
            d.reading ? "reading" : "",
            d.dragging ? "dragging" : "",
            d.ready ? "ready" : "",
            fresh.has(d.id) ? "drawn" : "",
          ];
          const bunched = !d.dragging && p.frame.focus !== d.id && d.label < p.cardW * 0.8;
          const scale = d.scale !== 1 ? ` scale(${d.scale})` : "";
          return (
            <div
              key={d.id}
              class={cls.filter(Boolean).join(" ")}
              data-id={d.id}
              data-fk={`h:${d.id}`}
              role="button"
              tabIndex={p.hand.away ? -1 : 0}
              aria-label={c.name}
              aria-current={p.frame.focus === d.id ? "true" : undefined}
              style={`transform:translate(${px(d.x)}, ${px(d.y)}) rotate(${deg(d.rot)})${scale};z-index:${d.z};--label-w:${Math.ceil(d.label)}px${d.fit.k < 1 ? `;--label-k:${d.fit.k}` : ""}`}
              onKeyDown={(e) => {
                if (p.onKey(d.id, e.key)) e.preventDefault();
              }}
            >
              <Face card={c} tight={d.fit.tight} />
              {bunched && c.cost ? <Ribbon cost={c.cost} /> : null}
            </div>
          );
        })}
      </div>
      <div class="l-loose">
        {p.frame.loose.map((l) => (
          <div key={l.id} class="hcard casting" data-card={l.id} aria-hidden="true" style={looseStyle(l.pose, p.cardW, p.cardH)}>
            <Face card={lookOf(l.id, cards, p.looks)} />
          </div>
        ))}
      </div>
      {p.frame.peek && peek?.image ? (
        <div
          class="g-peek"
          aria-hidden="true"
          style={`left:${px(p.frame.peek.left)};top:${px(p.frame.peek.top)};width:${px(p.frame.peek.width)};background-image:url("${peek.image}")`}
        />
      ) : null}
    </div>
  );
}
