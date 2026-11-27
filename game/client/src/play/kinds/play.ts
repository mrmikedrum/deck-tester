// play: what I may do with priority. Option 1 is pass. Hand cards with a play glow and are played by dragging them up
// 90 px (one play sends, several open a sheet named for the card, none toasts); a glowing permanent or a commander
// portrait opens the inspector with its plays as buttons; "Choose a play" lists everything. Mana abilities
// light their permanent but are not plays: not counted, not listed, never a reason to stop auto-pass.
// The pass button's label by phase and the auto-pass decoration are assembled in prompt.ts.
import type { CardId, PlayDecision } from "../../protocol";
import type { Facts } from "../facts";
import { cardOf, seatName, topItem } from "../facts";
import { costOf, itemLine, phaseName, playLabel } from "../text";
import type { SheetItem } from "../types";
import { base, btn } from "./kind";
import type { Btn, Ctx, Kind, Reaction } from "./kind";

/** A hand card let go this far up (px, negative is up) over the table is played. */
export const HAND_PLAY_DY = -90;

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

/** The responses: one is cast by name ("Cast Arcane Denial {1}{U}"); several are "Respond (n)", which lists them. */
function response(c: Ctx<PlayDecision>, opts: readonly number[]): Btn {
  const { d, f } = c;
  if (opts.length !== 1) return btn("responses", `Respond (${opts.length})`, () => offer(opts, "Respond"), { role: "choice" });
  const o = opts[0]!;
  return btn("respond", playLabel(d.options[o - 1] ?? ""), () => ({ answer: { answer: [o] } }), { tone: "primary", role: "choice", cost: costOf(d, o, f) });
}

const pass = (label: string, tone: Btn["tone"]): Btn => btn("pass", label, () => ({ answer: { answer: [1] } }), { tone, role: "pass" });

export const play: Kind<PlayDecision> = {
  ...base<PlayDecision>(),
  // live.js `status`: not when a spell is up and nothing can answer it.
  defers: (c) => !(topItem(c.f) && playOptions(c.d).length === 0),
  // Only what the table does not already say: someone else's item on the stack, attackers at me, blockers declared.
  // What can be played is lit on the table; my own item on top is on screen.
  words(c) {
    const { f } = c, top = topItem(f);
    if (top && (top.controller !== f.me || top.targets.length || top.abilityTargets.length || top.x !== null || top.modes.length)) return { headline: itemLine(f, top) };
    if (top) return { headline: "" };
    if (f.attackersAtMe.length) return { headline: `${seatName(f, f.active)} attacks you with ${f.attackersAtMe.length}` };
    if (f.blockerSeats.length) return { headline: "Blockers declared" };
    return { headline: "" };
  },
  // The pass: "OK" with someone else's item up and nothing to answer it with (an acknowledgment), "Resolve" when I could
  // (a choice) or the item is mine, the destination on an empty stack ("To combat", "To blocks", "End turn"), else
  // "Pass". One primary: the pass, unless a single response is the answer.
  buttons(c) {
    const { f } = c, top = topItem(f), opts = playOptions(c.d);
    if (top && top.controller !== f.me) {
      if (!opts.length) return [pass("OK", "primary")];
      const r = response(c, opts);
      return [r, pass("Resolve", r.tone === "primary" ? "secondary" : "primary")];
    }
    const attacking = f.attackersAtMe.length > 0, phase = phaseName(f.phase), mine = f.active === f.me;
    const label = top ? "Resolve" : attacking ? "To blocks" : mine && phase === "Main phase" ? "To combat" : mine && phase === "Second main" ? "End turn" : "Pass";
    const out = [pass(label, "primary")];
    if (opts.length)
      out.unshift(
        attacking
          ? { ...response(c, opts), tone: "secondary" as const }
          : btn("plays", `All plays (${opts.length})`, () => offer(opts, "Everything you can play", null, false), { role: "choice" }),
      );
    return out;
  },
  marks(c, m) {
    for (const r of c.d.refs) {
      const card = cardOf(c.f, r.card);
      if (!card || r.card === null) continue;
      if (card.zone === "hand") m.hand(r.card);
      else if (card.zone === "battlefield") m.card(r.card, "option");
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
  // A tap on a card opens its inspector, with any legal plays as buttons.
  tap(c, at) {
    // (a group of copies: the first with a play)
    const id = at.ids.find((x) => optsFor(c.d, x).length) ?? at.ids[0];
    if (id == null || (!optsFor(c.d, id).length && !cardOf(c.f, id)?.commander)) return null;
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
