// The inspector (common.js `inspect`, with live.js `inspectWith`'s actions): the card large, and a parchment leaf with
// its name, whose it is and where, its facts in words, what I can do with it now (play's `cardActions`: each a pick of
// its option), what is attached, and its rules text. A related card opens in its place. Closes with ✕, a press on the
// scrim or Escape.
import type { JSX } from "preact";
import type { Button } from "../play";
import { AutoPass } from "./layers";
import { Pips } from "./pips";
import type { Send } from "./send";
import { Close, onScrim } from "./sheet";
import type { InspectorView } from "./view";

/** `hold`: auto-pass is running under it (the prompt's Hold), shown with its countdown (`fill`) atop the leaf. */
export function Inspector({
  view: v,
  send,
  style,
  hold = null,
  fill = null,
}: {
  view: InspectorView;
  send: Send;
  style?: string;
  hold?: Button | null;
  fill?: number | null;
}): JSX.Element {
  if (v.held) return <Held view={v} send={send} {...(style ? { style } : {})} hold={hold} fill={fill} />;
  return (
    <div class="scrim" data-layer="inspector" data-scrim="" style={style} onClick={onScrim(send)}>
      <div class="inspector" style={`--seat:var(--seat-${v.place})`} role="dialog" aria-modal="true" aria-label={v.name} tabIndex={-1}>
        <div class="faces">
          <div class={v.faceDown ? "big back" : "big"} style={v.image ? `background-image:url("${v.image}")` : undefined}>
            {v.caption ? <div class="facecap">{v.caption}</div> : null}
          </div>
        </div>
        <div class="info">
          {hold ? <AutoPass hold={hold} fill={fill} send={send} /> : null}
          <h3>{v.name}</h3>
          <div class="owner">{v.owner}</div>
          {v.stack?.length ? (
            <div class="l-onstack">
              <div class="label">On the stack</div>
              {v.stack.map((line, i) => (
                <div key={i}>
                  <Pips text={line} />
                </div>
              ))}
            </div>
          ) : null}
          {v.chips.length ? (
            <div class="chips">
              {v.chips.map((c, i) => (
                <span key={i} class="chip">
                  {c}
                </span>
              ))}
            </div>
          ) : null}
          {v.actions.length ? (
            <div class="l-actions">
              {v.actions.map((a) => (
                <button key={a.option} type="button" class="l-opt" data-option={a.option} onClick={() => send({ a: "pick", option: a.option, card: v.card })}>
                  <b>
                    <Pips text={a.label} />
                  </b>
                  {a.cost ? (
                    <span class="cost">
                      <Pips text={a.cost} />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {v.related.map((r) => (
            <div key={r.label} class="l-related">
              <div class="label">{r.label}</div>
              <div class="rel">
                {r.cards.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    class="tile"
                    aria-label={c.name}
                    data-fk={`i:${c.id}`}
                    style={c.image ? `background-image:url("${c.image}")` : undefined}
                    onClick={() => send({ t: "open", layer: "inspector", card: c.id })}
                  >
                    {c.image ? null : <span>{c.name}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {v.rules ? (
            <>
              <div class="label">Rules text</div>
              <div class="oracle">
                <Pips text={v.rules} />
              </div>
            </>
          ) : null}
          <Close send={send} />
        </div>
      </div>
    </div>
  );
}

/**
 * The hand as a focus: the card I touched held up at reading size, to the right of the fan so it covers as little of my
 * board as it can, the table under a light shade. The fan stays live over the shade: another card swaps up, and playing
 * is a drag as ever. What I can do with the card now sits under it. Its words (name, facts, rules) are its description,
 * and are shown in its place where its picture has not loaded.
 */
function Held({
  view: v,
  send,
  style,
  hold,
  fill,
}: {
  view: InspectorView;
  send: Send;
  style?: string;
  hold: Button | null;
  fill: number | null;
}): JSX.Element {
  return (
    <div class="scrim from-hand" data-layer="inspector" data-scrim="" style={style} onClick={onScrim(send)}>
      <div class="inspector from-hand" role="dialog" aria-modal="true" aria-label={v.name} aria-describedby="l-held-text" tabIndex={-1} data-focus="">
        <div class={v.faceDown ? "big back" : "big"} style={v.image ? `background-image:url("${v.image}")` : undefined}>
          {/* What the card says, in words: read out always, and shown where its picture is missing. */}
          <div id="l-held-text" class={v.image || v.faceDown ? "held-text sr" : "held-text"}>
            <h3>{v.name}</h3>
            {v.chips.length ? <div class="chips">{v.chips.join(" · ")}</div> : null}
            {v.rules ? (
              <div class="oracle">
                <Pips text={v.rules} />
              </div>
            ) : null}
          </div>
        </div>
        {hold || v.actions.length ? (
          <div class="info">
            {hold ? <AutoPass hold={hold} fill={fill} send={send} /> : null}
            {v.actions.length ? (
              <div class="l-actions">
                {v.actions.map((a) => (
                  <button key={a.option} type="button" class="l-opt" data-option={a.option} onClick={() => send({ a: "pick", option: a.option, card: v.card })}>
                    <b>
                      <Pips text={a.label} />
                    </b>
                    {a.cost ? (
                      <span class="cost">
                        <Pips text={a.cost} />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <Close send={send} />
      </div>
    </div>
  );
}
