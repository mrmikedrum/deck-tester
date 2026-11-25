/// <reference types="node" />
// A table for driving play at the reducer level: real corpus envelopes (optionally with a hand-made decision), decoded
// through protocol and modelled through model; hit groups built from the model the way layout would hand them over
// (one group per permanent, plates per seat, the stack's items, optional piles); deadlines kept and fired by time
// like the app's loop; every effect recorded.
import { decodeSnapshot } from "../../src/protocol";
import type { CardId, Snapshot } from "../../src/protocol";
import { modelOf, playerViewer } from "../../src/model";
import type { SeatId, TableModel } from "../../src/model";
import type { HitGroup, HitGroups } from "../../src/layout";
import { initial, present, step } from "../../src/play";
import type {
  Act,
  AnswerToken,
  Button,
  Continuity,
  Effect,
  Event,
  Presentation,
  ScreenPose,
  State,
  StopId,
  Target,
} from "../../src/play";
import { catalog, corpusNames, rawCorpus } from "../model/fixtures";

export { corpusNames };

type Raw = Record<string, unknown>;

/** A deep copy of a corpus envelope, as the wire sent it. */
export const raw = (name: string): Raw => {
  const r = rawCorpus.get(name);
  if (!r) throw new Error(`no corpus envelope ${name}`);
  return structuredClone(r);
};

let handMade = 90000;
/**
 * A corpus envelope with a hand-made decision in place of its own (for what the corpus lacks). The decision is
 * completed with a fresh id, the envelope's turn, and the usual bounds; `view` edits the view in place.
 */
export function withDecision(name: string, d: Raw, view?: (v: Raw) => void): Raw {
  const r = raw(name);
  const own = r["decision"] as Raw | null;
  r["decision"] = {
    id: ++handMade,
    turn: own?.["turn"] ?? "T1 main1",
    prompt: "",
    min: 1,
    max: 1,
    repeat: false,
    mine: true,
    ...d,
  };
  if (view) view(r["view"] as Raw);
  return r;
}

/** A corpus envelope with its view edited in place (its own decision kept). */
export function edited(name: string, view: (v: Raw) => void): Raw {
  const r = raw(name);
  view(r["view"] as Raw);
  return r;
}

/** The same envelope with its decision asked again: a new engine id, everything else as it was. */
export function askedAgain(r: Raw, more: Raw = {}): Raw {
  const c = structuredClone(r);
  c["decision"] = { ...(c["decision"] as Raw), id: ++handMade, ...more };
  return c;
}

/** Ids of a seat's battlefield cards with this name, from the wire view. */
export function idsOf(r: Raw, seat: string, name: string): number[] {
  const players = (r["view"] as { players: { name: string; battlefield: { id: number; name: string }[]; hand?: { id: number; name: string }[] }[] }).players;
  const p = players.find((x) => x.name === seat);
  return [...(p?.battlefield ?? []), ...(p?.hand ?? [])].filter((c) => c.name === name).map((c) => c.id);
}

export function decoded(r: Raw): Snapshot {
  const s = decodeSnapshot(r);
  if (!s.ok) throw new Error(s.error.summary);
  return s.value;
}

export function modelFor(r: Raw, mayAnswer = true): TableModel | null {
  const snap = decoded(r);
  const viewer = playerViewer(snap);
  if (!viewer) return null;
  return modelOf(snap, catalog, { ...viewer, mayAnswer });
}

const QUAD = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
] as const;

/**
 * Hit groups for a model: a plate per seat, a card group per permanent (or one group per listed pile, its members in
 * the order given), and one per stack item. Quads are placeholders: play reads only ids, kinds, seats and members.
 */
export function hitsFor(m: TableModel | null, piles: readonly (readonly number[])[] = [], rev = 1): HitGroups {
  if (!m) return { rev, groups: [] };
  const groups: HitGroup[] = [];
  const piled = new Set(piles.flat());
  for (const s of m.seats) {
    groups.push({ id: `plate:${s.id}`, kind: "plate", seat: s.id, members: [], quad: QUAD as unknown as HitGroup["quad"], order: 0 });
    for (const id of m.zone(s.id, "battlefield")) {
      if (piled.has(id)) continue;
      groups.push({ id: `c${id}`, kind: "card", seat: s.id, members: [id], quad: QUAD as unknown as HitGroup["quad"], order: 0 });
    }
    const gy = m.zone(s.id, "graveyard");
    if (gy.length) groups.push({ id: `zone:graveyard:${s.id}`, kind: "zone", seat: s.id, members: gy, quad: QUAD as unknown as HitGroup["quad"], order: 0 });
  }
  for (const p of piles) {
    const first = p[0] as CardId;
    const seat = m.cards.get(first)?.controller ?? null;
    groups.push({ id: `p${first}`, kind: "pile", seat, members: p as CardId[], quad: QUAD as unknown as HitGroup["quad"], order: 0 });
  }
  for (const it of m.stack)
    if (it.source !== null) groups.push({ id: `stack:${it.id}`, kind: "stack", seat: it.controller, members: [it.source], quad: QUAD as unknown as HitGroup["quad"], order: 0 });
  return { rev, groups };
}

const POSE: ScreenPose = { rect: { x: 100, y: 500, w: 80, h: 112 } as unknown as ScreenPose["rect"], rotation: 0, scale: 1 };

export interface OpenOptions {
  readonly continuity?: Continuity;
  readonly mayAnswer?: boolean;
  readonly piles?: readonly (readonly number[])[];
  /** Skip the hits event (the plan has not arrived yet). */
  readonly noHits?: boolean;
}

export class Table {
  state: State = initial;
  now = 0;
  commit = 0;
  readonly effects: Effect[] = [];
  /** Deadlines scheduled and not cancelled: id -> when due. */
  readonly due = new Map<string, number>();
  model: TableModel | null = null;
  private hitRev = 0;

  /** A copy to branch from: the same state (immutable, so shared), time, deadlines, model and plan; no effects. */
  fork(): Table {
    const t = new Table();
    t.state = this.state;
    t.now = this.now;
    t.commit = this.commit;
    t.model = this.model;
    t.hitRev = this.hitRev;
    t.piles = this.piles;
    for (const [k, v] of this.due) t.due.set(k, v);
    return t;
  }

  feed(e: Event): Effect[] {
    const out = step(this.state, e);
    this.state = out.state;
    for (const fx of out.effects) {
      this.effects.push(fx);
      if (fx.kind === "deadline") {
        if (fx.ms === null) this.due.delete(fx.id);
        else this.due.set(fx.id, this.now + fx.ms);
      }
    }
    this.commit++;
    return [...out.effects];
  }

  /** A snapshot (by corpus name or raw envelope), then the hits for its model. */
  open(env: string | Raw, o: OpenOptions = {}): Effect[] {
    const r = typeof env === "string" ? raw(env) : env;
    const snap = decoded(r);
    const viewer = playerViewer(snap);
    const m = viewer ? modelOf(snap, catalog, { ...viewer, mayAnswer: o.mayAnswer ?? true }) : null;
    this.model = m;
    const fx = this.feed({
      t: "snapshot",
      at: this.now,
      model: m,
      decision: m ? snap.decision : null,
      continuity: o.continuity ?? (this.effects.length || this.commit ? "advance" : "first"),
    });
    if (!o.noHits) fx.push(...this.hits(o.piles ?? []));
    return fx;
  }

  hits(piles: readonly (readonly number[])[] = []): Effect[] {
    return this.feed({ t: "hits", at: this.now, hits: hitsFor(this.model, piles, ++this.hitRev) });
  }

  get p(): Presentation {
    return present(this.state);
  }
  get stop(): StopId | null {
    return this.p.controls.stop;
  }

  act(a: Act, stop: StopId | null = this.stop): Effect[] {
    return this.feed({ t: "act", stamp: { at: this.now, commit: this.commit }, stop, act: a });
  }
  tap(on: Target): Effect[] {
    return this.act({ a: "tap", on });
  }
  tapCard(id: number): Effect[] {
    return this.tap({ card: id as CardId });
  }
  tapSeat(seat: string): Effect[] {
    return this.tap({ seat: seat as SeatId });
  }
  /** A tap on the group holding this card, as layout drew it. */
  tapGroupOf(id: number): Effect[] {
    const g = hitsFor(this.model, this.pilesNow()).groups.find((x) => x.members.includes(id as CardId));
    if (!g) throw new Error(`no group holds ${id}`);
    return this.tap({ group: g.id, members: g.members });
  }
  private piles: readonly (readonly number[])[] = [];
  private pilesNow() {
    return this.piles;
  }
  /** Hits with these piles (remembered for `tapGroupOf`). */
  pile(piles: readonly (readonly number[])[]): Effect[] {
    this.piles = piles;
    return this.hits(piles);
  }
  drag(from: Target, onto: Target): Effect[] {
    return this.act({ a: "drag", from, onto });
  }
  release(card: number, dy: number, pose: ScreenPose = POSE, overTable = true): Effect[] {
    return this.act({ a: "release", card: card as CardId, dy, pose, overTable });
  }
  /** A sheet item by its option; with `card`, the inspector's action on that card. */
  pick(option: number, card?: number): Effect[] {
    return this.act(card === undefined ? { a: "pick", option } : { a: "pick", option, card: card as CardId });
  }
  stepBy(by: number): Effect[] {
    return this.act({ a: "step", by });
  }
  dismiss(): Effect[] {
    return this.act({ a: "dismiss" });
  }

  /** Every button on show: the prompt's, then the sheet's. */
  allButtons(): readonly Button[] {
    const c = this.p.controls;
    return [...(c.prompt?.buttons ?? []), ...(c.sheet?.buttons ?? [])];
  }
  buttons(): string[] {
    return (this.p.controls.prompt?.buttons ?? []).map((b) => b.label);
  }
  sheetButtons(): string[] {
    return (this.p.controls.sheet?.buttons ?? []).map((b) => b.label);
  }
  button(label: string): Button {
    const b = this.allButtons().find((x) => x.label === label);
    if (!b) throw new Error(`no button "${label}" in ${JSON.stringify(this.allButtons().map((x) => x.label))}`);
    return b;
  }
  press(label: string): Effect[] {
    return this.act({ a: "press", button: this.button(label).id });
  }

  /** Moves time on, firing every deadline due by then, in time order. */
  advance(ms: number): Effect[] {
    const until = this.now + ms, out: Effect[] = [];
    for (;;) {
      const next = [...this.due.entries()].filter(([, at]) => at <= until).sort((a, b) => a[1] - b[1])[0];
      if (!next) break;
      this.now = next[1];
      this.due.delete(next[0]);
      out.push(...this.feed({ t: "deadline", at: this.now, id: next[0] }));
    }
    this.now = until;
    return out;
  }

  /** The host's ledger settled the answer under `token` (by default the last sent). */
  settled(
    how: Extract<Event, { t: "settled" }>["how"],
    reason: string | null = null,
    token: AnswerToken | null | undefined = this.lastSend()?.token,
  ): Effect[] {
    if (token === undefined) throw new Error("nothing sent");
    return this.feed({ t: "settled", at: this.now, token, how, reason });
  }

  /** The bridge is working on an answer to the stop on screen that this page did not send. */
  working(stop: StopId | null = this.stop): Effect[] {
    if (!stop) throw new Error("no stop");
    return this.feed({ t: "working", at: this.now, stop });
  }

  sends(): Extract<Effect, { kind: "send" }>[] {
    return this.effects.filter((e): e is Extract<Effect, { kind: "send" }> => e.kind === "send");
  }
  lastSend(): Extract<Effect, { kind: "send" }> | undefined {
    return this.sends().at(-1);
  }
  /** The answers sent so far: picks, or "defer". */
  answers(): (readonly number[] | "defer")[] {
    return this.sends().map((s) => ("defer" in s.body ? "defer" : s.body.answer));
  }
  toasts(): string[] {
    return this.effects.flatMap((e) => (e.kind === "toast" ? [e.text] : []));
  }
  forget(): void {
    this.effects.length = 0;
  }
}

/** Effects of a kind, from a list. */
export const ofKind = <K extends Effect["kind"]>(fx: readonly Effect[], kind: K): Extract<Effect, { kind: K }>[] =>
  fx.filter((e): e is Extract<Effect, { kind: K }> => e.kind === kind);
