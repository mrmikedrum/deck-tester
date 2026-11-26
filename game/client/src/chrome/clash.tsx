// The clash's chrome (app/clash.ts): a brass plaque over each wing saying who attacks whom and how much is unblocked; a
// brand in each unblocked attacker's empty slot (its power, a hollow ring at 0) with a chevron toward its defender; a
// bronze clasp between each attacker and its blockers. Drawn over the table at the gathering's screen positions; none
// takes a tap (the table's hit test reaches the slot and the cards). Pure.
import type { JSX } from "preact";
import type { ClashView } from "./view";

export function Clash({ view: v }: { view: ClashView }): JSX.Element {
  return (
    <div class="l-clash" aria-hidden="true" style={`--u:${v.unit}px`}>
      {v.plaques.map((p) => (
        <div key={p.key} class={`l-clash-plaque ${p.tone}`} data-focus="" style={`left:${p.x}px;top:${p.y}px;max-width:${p.w + 24}px;--seat:var(--seat-${p.place})`}>
          {p.words}
        </div>
      ))}
      {v.tallies.map((t) => (
        <span key={t.key} class={`l-clash-tally ${t.tone}`} style={`left:${t.x}px;top:${t.y}px`}>
          {t.figure}
        </span>
      ))}
      {v.more ? (
        <div class="l-clash-more" style={`left:${v.more.x}px;top:${v.more.y}px;width:${v.more.w}px;height:${v.more.h}px`}>
          {v.more.words}
        </div>
      ) : null}
      {v.clasps.map((c) => (
        <i key={c.key} class="l-clash-clasp" style={`left:${c.x}px;top:${c.y}px`} />
      ))}
      {v.brands.map((b) => (
        <div
          key={b.key}
          class={`l-clash-brand ${b.tone}${b.figure ? "" : " hollow"}${b.down ? " down" : " up"}`}
          style={`left:${b.x}px;top:${b.y}px;--size:${b.size}px;--seat:var(--seat-${b.place})`}
        >
          <span class="ring">{b.figure ? <b>{b.figure}</b> : null}</span>
          {b.count ? <small class="count">×{b.count}</small> : null}
          <svg class="chev" viewBox="0 0 24 12">
            <path d="M3 2l9 8 9-8" />
          </svg>
        </div>
      ))}
    </div>
  );
}
