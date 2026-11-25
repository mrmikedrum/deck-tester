// play: what I may do with priority. Option 1 is pass. Hand cards with a play glow and are played by dragging them up
// 90 px (one play sends, several open a sheet named for the card, none toasts); a glowing permanent or my plate (for
// the commander) opens the inspector with its plays as buttons; "Choose a play" lists everything. Mana abilities
// light their permanent but are not plays: not counted, not listed, never a reason to stop auto-pass.
// The pass button's label by phase and the auto-pass decoration are assembled in prompt.ts.
import type { CardId, PlayDecision } from "../../protocol";
import type { Facts } from "../facts";
import { cardOf, seatName, topItem } from "../facts";
import { costOf, lists, phaseName, playLabel } from "../text";
import type { SheetItem } from "../types";
import { base, btn } from "./kind";
import type { Btn, Ctx, Kind, Reaction } from "./kind";

const HAND_PLAY_DY = -90;

/** live.js `optsFor`: every option whose ref is this card (mana abilities included). */
export const optsFor = (d: PlayDecision, id: CardId | null | undefined): number[] =>
  id == null ? [] : d.refs.flatMap((r, i) => (r.card === id ? [i + 1] : []));

/** live.js `playOptions`: the real plays: not pass, not a mana ability. */
export const playOptions = (d: PlayDecision): number[] => d.refs.flatMap((r, i) => (i && !r.mana && i < d.options.length ? [i + 1] : []));

const sheetItem = (d: PlayDecision, f: Facts, o: number): SheetItem => ({
  option: o,
  label: playLabel(d.options[o - 1] ?? ""),
  cost: costOf(d, o, f),
  detail: d.details?.[o - 1] ?? null,
  card: d.refs[o - 1]?.card ?? null,
  name: null,
  picked: false,
  badge: null,
});

/** live.js `offer`: one card's plays; a single one goes at once (unless `autoSingle` is off). */
function offer(opts: readonly number[], title: string, carried: Reaction["carried"] = null, autoSingle = true): Reaction {
  if (autoSingle && opts.length === 1) return { answer: { answer: [opts[0]!] }, carried };
  return { sheet: { k: "plays", title, options: opts, carried } };
}

/** live.js `responseButton`. */
function response(c: Ctx<PlayDecision>, opts: readonly number[]): Btn {
  const { d, f } = c;
  if (opts.length !== 1) {
    const detail = opts.map((o) => [d.options[o - 1], costOf(d, o, f)].filter(Boolean).join(" ")).join(" · ");
    return btn("responses", `Choose a response (${opts.length})`, () => offer(opts, "Choose a response"), { tone: "primary", role: "choice", detail });
  }
  const o = opts[0]!;
  return btn("respond", playLabel(d.options[o - 1] ?? ""), () => ({ answer: { answer: [o] } }), { tone: "primary", role: "choice", cost: costOf(d, o, f) });
}

const pass = (label: string, tone: Btn["tone"]): Btn => btn("pass", label, () => ({ answer: { answer: [1] } }), { tone, role: "pass" });

export const play: Kind<PlayDecision> = {
  ...base<PlayDecision>(),
  // live.js `status`: not when a spell is up and nothing can answer it.
  defers: (c) => !(topItem(c.f) && playOptions(c.d).length === 0),
  words(c) {
    const { d, f } = c, top = topItem(f), opts = playOptions(d), canFloat = d.refs.some((r) => r.mana);
    if (top && top.controller !== f.me) {
      return { headline: opts.length ? "You can respond" : "No responses offered", ...(canFloat && !opts.length ? { hint: "You can float mana from a marked source." } : {}) };
    }
    const attacking = f.attackersAtMe.length > 0;
    const blocking = f.blockerSeats.length
      ? f.blockerSeats.length === 1 && f.blockerSeats[0] === f.me
        ? "You declared blockers"
        : `${lists(f.blockerSeats.map((s) => seatName(f, s)))} declared blockers`
      : "";
    const main = !top && f.active === f.me && ["Main phase", "Second main"].includes(phaseName(f.phase));
    const zones = new Set(opts.map((o) => cardOf(f, d.refs[o - 1]?.card)?.zone));
    const places = ([["hand", "in your hand"], ["battlefield", "on the battlefield"]] as const).filter(([z]) => zones.has(z)).map(([, p]) => p);
    const other = ([["graveyard", "the graveyard"], ["exile", "exile"]] as const).filter(([z]) => zones.has(z)).map(([, p]) => p);
    const unmarked = [...zones].some((z) => !z || !["hand", "battlefield", "command", "graveyard", "exile"].includes(z));
    const hint = attacking
      ? "Passing advances toward your chance to block."
      : [
          places.length && `Highlights ${lists(places)} mark available plays.`,
          zones.has("command") && `Tap the marked “${seatName(f, f.me)}” life plaque for your commander play.`,
          other.length && `Open Choose a play for plays from ${lists(other)}${unmarked ? " and other unmarked options" : ""}.`,
          !other.length && unmarked && "Open Choose a play for unmarked options.",
        ]
          .filter(Boolean)
          .join(" ");
    const headline =
      (attacking ? "Before blocks" : blocking) ||
      (main ? (opts.length ? "Available plays" : canFloat ? "Tap a marked mana source to float mana" : "You have priority") : "You have priority");
    return { headline, ...(hint ? { hint } : {}) };
  },
  buttons(c) {
    const { d, f } = c, top = topItem(f), opts = playOptions(d);
    if (top && top.controller !== f.me) {
      const out = [pass("Pass priority", opts.length ? "secondary" : "primary")];
      if (opts.length) out.unshift(response(c, opts));
      return out;
    }
    const attacking = f.attackersAtMe.length > 0, phase = phaseName(f.phase), mine = f.active === f.me;
    const label = top
      ? "Pass priority"
      : attacking
        ? "Pass toward blocks"
        : mine && phase === "Main phase"
          ? "To combat"
          : mine && phase === "Second main"
            ? "End turn"
            : "Pass";
    const out = [pass(label, opts.length ? "secondary" : "primary")];
    if (opts.length)
      out.unshift(
        attacking
          ? response(c, opts)
          : btn("plays", `Choose a play (${opts.length})`, () => offer(opts, "Everything you can play", null, false), { tone: "primary", role: "choice" }),
      );
    return out;
  },
  marks(c, m) {
    for (const r of c.d.refs) {
      const card = cardOf(c.f, r.card);
      if (!card || r.card === null) continue;
      if (card.zone === "hand") m.hand(r.card);
      else if (card.zone === "battlefield") m.card(r.card, "option");
      else if (card.commander) m.seat(c.f.me, "option");
    }
  },
  sheet(c, open) {
    if (open.k !== "plays") return null;
    return {
      kind: "plays",
      title: open.title,
      wide: false,
      items: open.options.map((o) => sheetItem(c.d, c.f, o)),
      stepper: null,
      buttons: [],
      carried: open.carried,
    };
  },
  // live.js `tapDecision`: a tap looks; the card's plays are buttons on it. My plate means my commander.
  tap(c, at) {
    const id = at.seat !== null ? (at.seat === c.f.me ? c.f.commander : null) : at.ids[0];
    if (id == null || !optsFor(c.d, id).length) return null;
    return { inspect: id };
  },
  // live.js `H.drag`: a permanent dragged onto something in play offers its plays (step.ts drops a drag onto nothing).
  drag(c, from) {
    const opts = from.ids.flatMap((id) => optsFor(c.d, id));
    return opts.length ? offer(opts, cardOf(c.f, from.ids[0])?.display ?? "") : {};
  },
  // live.js `H.handOpts.onDrop`, and only over the table (the old client played a card let go anywhere 90 px up).
  release(c, card, dy, pose, overTable) {
    if (dy > HAND_PLAY_DY || !overTable) return {};
    const opts = optsFor(c.d, card);
    if (!opts.length) return { toast: "You can't play that now" };
    return offer(opts, cardOf(c.f, card)?.display ?? "", { card, pose });
  },
  // An inspector action or a plays-sheet item: that play.
  pick(c, o) {
    if (!Number.isInteger(o) || o < 1 || o > c.d.options.length) return null;
    const carried = c.s.sheet?.k === "plays" ? c.s.sheet.carried : null;
    return { answer: { answer: [o] }, carried };
  },
};
