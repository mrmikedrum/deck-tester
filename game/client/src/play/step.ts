// The reducer. A snapshot adopts a new stop (draft, sheet and auto-pass start over) only when the engine parked a new
// decision or the view was cut; acts apply only to the stop they were drawn for; the answer in flight blocks every
// other answer until the host settles it (`settled`: the one way an answer is freed) or a new stop arrives; deadlines
// and settlements for anything older are no-ops. Play reads neither the transport's outcomes nor the bridge's answer
// status: the host's ledger does, by attempt.
import { answerProblem, answerRequest } from "../protocol";
import type { Answer, Decision } from "../protocol";
import { AUTO_PASS_MS, autoArms, autoId } from "./auto";
import { factsOf } from "./facts";
import type { Facts } from "./facts";
import { playOptions } from "./kinds/play";
import { kindOf } from "./kinds";
import type { Reaction } from "./kinds/kind";
import { ctxOf, promptOf, sheetOf } from "./prompt";
import { cardActionsOf } from "./present";
import { offTableNames } from "./needs";
import { groupsOf, reached } from "./reach";
import { completed, meaningful, resolve, still } from "./resolve";
import { EMPTY_DRAFT, open, reset, seal } from "./state";
import type { Reached } from "./reach";
import type { Gesture, S } from "./state";
import type { AnswerToken, Carried, Effect, Event, Step, StopId } from "./types";

type Out = { state: S; effects: Effect[] };

const UNCLAIMED: Effect = { kind: "unclaimed" };
const same = (s: S): Out => ({ state: s, effects: [] });
const cancelAuto = (s: S): Effect[] => (s.auto ? [{ kind: "deadline", id: s.auto.id, ms: null }] : []);

/** Send an answer for the current stop, unless one is in flight or the answer cannot fit the decision. */
function send(s: S, answer: Answer, carried: Carried | null): Out {
  const d = s.decision;
  if (!d || !s.stop || s.inflight || !s.facts?.mayAnswer) return same(s);
  if ("answer" in answer) {
    const problem = answerProblem(d, answer.answer);
    if (problem) return { state: s, effects: [{ kind: "toast", text: problem }] };
  }
  const token = (s.tokens + 1) as AnswerToken;
  const effects: Effect[] = [
    ...cancelAuto(s),
    { kind: "send", token, stop: s.stop, body: answerRequest(d, answer), carried },
  ];
  return {
    state: {
      ...s,
      tokens: token,
      inflight: { token, stop: s.stop },
      auto: null,
      sheet: null,
      choice: choiceOf(d, answer, token) ?? s.choice,
    },
    effects,
  };
}

/** live.js `send`: the cards a play answer plays (not mana abilities), and who chose them; null when it plays none. */
function choiceOf(d: Decision, answer: Answer, token: AnswerToken): S["choice"] {
  if (d.kind !== "play") return null;
  const options = "defer" in answer ? playOptions(d) : answer.answer;
  const refs = options.flatMap((o) => {
    const r = d.refs[o - 1];
    return r && r.card !== null && !r.mana ? [{ card: r.card, spell: r.spell }] : [];
  });
  return refs.length ? { token, refs, label: "defer" in answer ? "Forge chose" : "Your choice" } : null;
}

/**
 * live.js `take`: my stack items new in this snapshot that play the cards of the play I sent are labelled with who
 * chose it (once: the choice is used up); labels go with their items. A first view or a cut back forgets them all.
 */
function actorsOf(s: S, facts: Facts, cut: boolean): Pick<S, "choice" | "actors"> {
  if (cut || !s.facts) return { choice: null, actors: [] };
  const was = new Set(s.facts.stack.map((st) => st.id));
  let choice = s.choice;
  const actors = s.actors.filter((a) => facts.stack.some((st) => st.id === a.item));
  for (const st of [...facts.stack].reverse()) {
    if (was.has(st.id) || st.controller !== facts.me || !choice) continue;
    if (!choice.refs.some((r) => r.card === st.source && r.spell === st.spell)) continue;
    actors.push({ item: st.id, label: choice.label });
    choice = null;
  }
  return { choice, actors };
}

function apply(s: S, r: Reaction, before: Effect[] = []): Out {
  let next = s;
  const effects = [...before];
  if (r.draft) next = { ...next, draft: r.draft };
  if (r.sheet !== undefined) next = { ...next, sheet: r.sheet };
  if (r.chooserClosed !== undefined) next = { ...next, chooserClosed: r.chooserClosed };
  if (r.hold && next.auto) {
    effects.push(...cancelAuto(next));
    next = { ...next, auto: null };
  }
  if (r.toast) effects.push({ kind: "toast", text: r.toast });
  if (r.inspect !== undefined) effects.push({ kind: "inspect", card: r.inspect });
  if (r.pending === null) next = { ...next, pending: null };
  if (r.pending) {
    const rev = next.choosers + 1;
    next = { ...next, choosers: rev, pending: { ...r.pending, rev } };
  }
  if (r.choose !== undefined) effects.push({ kind: "choose", group: r.choose, rev: next.pending?.rev ?? 0 });
  // A chooser open for a gesture holds auto-pass: nothing is passed while the player chooses.
  if (r.pending && next.auto) {
    effects.push(...cancelAuto(next));
    next = { ...next, auto: null };
  }
  if (r.answer) {
    const sent = send(next, r.answer, r.carried ?? null);
    next = sent.state;
    effects.push(...sent.effects);
  }
  return { state: next, effects };
}

function onSnapshot(s: S, e: Extract<Event, { t: "snapshot" }>): Out {
  if (!e.model) return { state: reset(s), effects: cancelAuto(s) };
  const held = e.held === true && e.decision === null;
  const effects: Effect[] = [];
  let cur = s;
  const newGame = e.continuity === "newGame" || e.continuity === "restart" || (s.facts !== null && s.facts.gen !== e.model.gen);
  if (newGame) {
    effects.push(...cancelAuto(cur));
    cur = reset(cur);
  }
  const facts = factsOf(e.model), d = e.decision, prev = cur.decision;
  const fresh =
    !cur.facts ||
    e.continuity === "rewind" ||
    (d?.id ?? null) !== (prev?.id ?? null) ||
    (d !== null && prev !== null && d.key !== prev.key);
  const labelled = actorsOf(cur, facts, e.continuity === "rewind");
  cur = { ...cur, ...labelled, choice: fresh && d?.kind === "play" ? null : labelled.choice };
  if (!fresh) {
    // The answer out stays out: only the host's ledger says when it is finished (`settled`).
    let next: S = { ...cur, facts, decision: d, held };
    // A gesture waiting for a choice whose cards moved (left play, changed hands) goes: it would act on what is gone.
    if (next.pending && !still(next.pending, facts)) {
      next = { ...next, pending: null };
      effects.push({ kind: "toast", text: "The table changed: choose again" });
    }
    // Auto-pass holds only while the decision still qualifies: the same decision with the table changed under it (a
    // target now aimed at me, a real play on offer) stops it.
    if (next.auto && (!d || !autoArms(d, facts))) {
      effects.push(...cancelAuto(next));
      next = { ...next, auto: null };
    }
    return { state: next, effects };
  }
  effects.push(...cancelAuto(cur));
  const serial = d ? cur.serial + 1 : cur.serial;
  const stop = d ? (`${facts.gen}.${d.id}.${serial}` as StopId) : null;
  let next: S = {
    ...cur,
    serial,
    facts,
    decision: d,
    stop,
    held,
    draft: d ? kindOf(d).start(d, facts) : EMPTY_DRAFT,
    sheet: null,
    chooserClosed: false,
    pending: null,
    inflight: null,
    auto: null,
  };
  if (d && stop) {
    if (autoArms(d, facts)) {
      const id = autoId(stop);
      next = { ...next, auto: { id, from: e.at, ms: AUTO_PASS_MS } };
      effects.push({ kind: "deadline", id, ms: AUTO_PASS_MS });
    }
    const known = new Set(Object.values(facts.cards).filter((c) => c.catalogued).map((c) => c.name));
    const names = offTableNames(e.model, d).filter((n) => !known.has(n));
    if (names.length) effects.push({ kind: "cards", names });
    if (d.kind === "unknown") effects.push({ kind: "warn", text: `unknown decision kind "${d.wireKind}": shown by its labels` });
  }
  return { state: next, effects };
}

function onAct(was: S, e: Extract<Event, { t: "act" }>): Out {
  if (e.stop !== was.stop) return same(was); // drawn for another stop: the player acts again on what is shown now
  // A gesture waiting for a choice is completed by a tap on a card of its group, as the group is drawn now; any other act
  // lets it go.
  const s: S = was.pending ? { ...was, pending: null } : was;
  const f = s.facts, act = e.act;
  const defaultable = act.a === "tap" || act.a === "drag" || act.a === "dismiss";
  if (!f) return defaultable ? { state: s, effects: [UNCLAIMED] } : same(s);
  const c = ctxOf(s);
  const live = !!c && !s.inflight && f.mayAnswer;
  switch (act.a) {
    case "press": {
      const all = [...(promptOf(s)?.buttons ?? []), ...(sheetOf(s)?.buttons ?? [])];
      const b = all.find((x) => x.id === act.button);
      return b && b.enabled ? apply(s, b.run()) : same(s);
    }
    case "tap":
    case "drag": {
      // A drag let go over nothing has no destination: nothing happens (live.js `H.drag` returned without one).
      if (act.a === "drag" && "nothing" in act.onto) return { state: s, effects: [UNCLAIMED] };
      // A card chosen in a chooser that is gone (done, put away, dropped with the table it was for): refused, whatever
      // waits now is left as it is.
      if (act.a === "tap" && "card" in act.on && act.on.chooser !== undefined && act.on.chooser !== was.pending?.rev)
        return { state: was, effects: [{ kind: "toast", text: "That choice has gone: choose again" }] };
      let g: Gesture = act.a === "tap" ? { a: "tap", at: act.on } : { a: "drag", from: act.from, onto: act.onto };
      const c0 = was.pending && act.a === "tap" && "card" in act.on ? completed(was.pending, act.on.card, s.groups.find((x) => x.id === was.pending!.group)?.members) : "other";
      if (c0 === "stale") return { state: s, effects: [{ kind: "toast", text: "That card has moved: choose again" }] };
      const done = c0 === "other" ? null : c0.done;
      if (done) g = done;
      let cur = s;
      const before: Effect[] = [];
      if (act.a === "tap") {
        const at = reached(act.on, s.groups, f);
        if (!at) return same(s);
        if (cur.auto && at.table) {
          // touching the table while auto-pass counts holds it
          before.push(...cancelAuto(cur));
          cur = { ...cur, auto: null };
        }
      }
      const cc = ctxOf(cur);
      const reach = (t: Parameters<typeof reached>[0]) => reached(t, cur.groups, f);
      if (!live || !cc) {
        const stale = g.a === "tap" ? !reach(g.at) : !reach(g.from) || !reach(g.onto);
        return stale ? same(cur) : { state: cur, effects: [...before, UNCLAIMED] };
      }
      const k = kindOf(cc.d);
      const kind = { tap: (at: Reached) => k.tap(cc, at), drag: (from: Reached, onto: Reached) => k.drag(cc, from, onto) };
      // The one rule for a gesture on a group (resolve.ts): it commits only what cannot hang on which card was meant.
      const out = resolve(g, cc.d, f, cc.draft, reach, kind);
      if (!out) return same(cur);
      const step = out.r ? apply(cur, out.r, before) : { state: cur, effects: [...before, UNCLAIMED] };
      // A card the chooser offers that the gesture cannot use (refused, with a toast): the gesture waits for another.
      return done && !meaningful(out.r, cur.draft) ? { ...step, state: { ...step.state, pending: was.pending } } : step;
    }
    case "putBack":
      return same(s);
    case "release": {
      const r = live && c ? kindOf(c.d).release(c, act.card, act.dy, act.pose, act.overTable) : null;
      return r ? apply(s, r) : same(s);
    }
    case "pick": {
      if (!live || !c) return same(s);
      // An inspector action is checked against its card's actions, even with a sheet open under it (the stack's rules);
      // anything else against the sheet's items.
      const sheet = sheetOf(s);
      const offered =
        act.card !== undefined
          ? (cardActionsOf(s).get(act.card) ?? []).some((a) => a.option === act.option)
          : sheet
            ? sheet.items.some((i) => i.option === act.option)
            : [...cardActionsOf(s).values()].some((list) => list.some((a) => a.option === act.option));
      const r = offered ? kindOf(c.d).pick(c, act.option) : null;
      return r ? apply(s, r) : same(s);
    }
    case "step": {
      if (!live || !c || sheetOf(s)?.kind !== "number") return same(s);
      const r = kindOf(c.d).step(c, act.by);
      return r ? apply(s, r) : same(s);
    }
    case "dismiss": {
      if (s.sheet) return same({ ...s, sheet: null });
      if (sheetOf(s)) return same({ ...s, chooserClosed: true });
      return { state: s, effects: [UNCLAIMED] };
    }
  }
}

const SAID: Readonly<Record<Extract<Event, { t: "settled" }>["how"], ((reason: string | null) => string) | null>> = {
  applied: null,
  unseen: null,
  superseded: null,
  refused: (reason) => reason || "Forge refused that",
  // pinned: the old client freed the prompt; resending is safe (the bridge and engine refuse a duplicate)
  lost: () => "Lost the bridge",
};

function onSettled(s: S, e: Extract<Event, { t: "settled" }>): Out {
  if (!s.inflight || s.inflight.token !== e.token) return same(s); // not the answer out (or already freed)
  const say = SAID[e.how];
  // A play refused or lost plays nothing: who chose it labels nothing (live.js cleared `playChoice`).
  const choice = s.choice?.token === e.token && (e.how === "refused" || e.how === "lost") ? null : s.choice;
  return { state: { ...s, inflight: null, choice }, effects: say ? [{ kind: "toast", text: say(e.reason) }] : [] };
}

function onWorking(s: S, e: Extract<Event, { t: "working" }>): Out {
  if (!s.stop || e.stop !== s.stop || s.inflight) return same(s);
  return { state: { ...s, inflight: { token: null, stop: s.stop }, auto: null, sheet: null }, effects: cancelAuto(s) };
}

function onDeadline(s: S, e: Extract<Event, { t: "deadline" }>): Out {
  if (!s.auto || s.auto.id !== e.id) return same(s);
  if (s.pending) return same({ ...s, auto: null }); // a chooser open holds it
  if (!s.decision || !s.facts || !autoArms(s.decision, s.facts)) return same({ ...s, auto: null });
  return send({ ...s, auto: null }, { answer: [1] }, null);
}

function reduce(s: S, e: Event): Out {
  switch (e.t) {
    case "snapshot":
      return onSnapshot(s, e);
    case "hits":
      return same({ ...s, groups: groupsOf(e.hits) });
    case "act":
      return onAct(s, e);
    case "settled":
      return onSettled(s, e);
    case "working":
      return onWorking(s, e);
    case "deadline":
      return onDeadline(s, e);
    case "link":
      return same(s);
    default:
      return same(s); // nothing play knows (a raw transport outcome is the ledger's, never play's)
  }
}

/**
 * Total over the player's input and timers: an exception in a kind while handling an act, a deadline or a settlement is
 * reported as a warning and the state is left as it was (a no-op, like any stale act). A snapshot is different: one
 * play could not take is not swallowed, since the host would then keep the new table with play's old decision. It
 * throws, so the host treats it as an ingest fault (reported, not acknowledged, read again).
 */
export function step(state: Parameters<typeof open>[0], e: Event): Step {
  const s = open(state);
  try {
    const out = reduce(s, e);
    return { state: seal(out.state), effects: out.effects };
  } catch (err) {
    if (e.t === "snapshot") throw err;
    return { state, effects: [{ kind: "warn", text: `play: ${e.t} failed: ${String(err)}` }] };
  }
}
