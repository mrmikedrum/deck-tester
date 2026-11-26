// A gesture on a group commits only what the player could have meant: the property over every decision in the protocol
// corpus (its battlefields piled in several ways, as layout may pile them) and crowded tables (mixed piles, same-named
// cards in different states or owners, planeswalkers among permanents, mixed mana, a picked twin, refs in another
// order, a choice made after the plan changed).
//
// For every group of several cards and every gesture on it (a tap; a drag from it onto every plate and group; a drag
// from a card onto it), what play does is one of:
//  - nothing meant (no send, no pick changed);
//  - a commit, only when what it means does not hang on which card was meant: every member's gesture alone does the
//    same; or the members it could mean are twins (the same card, state, owner and options, judged here from the wire,
//    apart from play's own reading), the rest share their name, and the group does the same whichever twin it lists
//    first;
//  - a chooser that commits nothing, and that, for each member, completes the very gesture (both ends) with that card.
// And every option the decision's refs put on the table is reachable: driven through its group (and the chooser, the
// mana sheet, the defender, the blocker) to the answer sent, it is there (or its twin's).
import { describe, expect, it } from "vitest";
import type { CardId, Decision } from "../../src/protocol";
import type { Effect, Target } from "../../src/play";
import { Table, corpusNames, decoded, raw, withDecision } from "./rig";

type Raw = Record<string, unknown>;
type Wire = { id: number; name: string; attachedTo?: number } & Raw;
type Gesture = { a: "tap"; at: Target } | { a: "drag"; from: Target; onto: Target };
type End = "at" | "from" | "onto";
type Draft = { sel: number[]; holding: unknown; attackTo: unknown; value: number };
type Group = { id: string; kind: string; seat: string | null; members: CardId[] };

interface Outcome {
  readonly answer: readonly number[] | null;
  readonly draft: Draft | null;
  readonly choose: string | null;
  readonly opened: boolean;
}

const draftOf = (t: Table) => (t.state as unknown as { draft: Draft }).draft;
const groupsOf = (t: Table) => (t.state as unknown as { groups: Group[] }).groups;
const picks = (d: Draft) => JSON.stringify([d.sel, d.holding, d.attackTo, d.value]);

function run(base: Table, g: Gesture): { t: Table; o: Outcome } {
  const t = base.fork();
  const before = picks(draftOf(t)), sheet = JSON.stringify(t.p.controls.sheet);
  const fx: Effect[] = g.a === "tap" ? t.tap(g.at) : t.drag(g.from, g.onto);
  const send = fx.find((e): e is Extract<Effect, { kind: "send" }> => e.kind === "send");
  const choose = fx.find((e): e is Extract<Effect, { kind: "choose" }> => e.kind === "choose");
  return {
    t,
    o: {
      answer: send && "answer" in send.body ? send.body.answer : null,
      draft: picks(draftOf(t)) === before ? null : draftOf(t),
      choose: choose?.group ?? null,
      opened: fx.some((e) => e.kind === "inspect") || JSON.stringify(t.p.controls.sheet) !== sheet,
    },
  };
}

const commits = (o: Outcome) => o.answer !== null || o.draft !== null;
const meaningful = (o: Outcome) => commits(o) || o.choose !== null || o.opened;
const sameCommit = (a: Outcome, b: Outcome) => JSON.stringify([a.answer, a.draft]) === JSON.stringify([b.answer, b.draft]);

const withEnd = (g: Gesture, end: End, t: Target): Gesture => (g.a === "tap" ? { a: "tap", at: t } : end === "from" ? { ...g, from: t } : { ...g, onto: t });
const endOf = (g: Gesture, end: End): Target => (g.a === "tap" ? g.at : end === "from" ? g.from : g.onto);

/** The wire's cards by id (every zone), and the decision: the judge reads the table as sent, not as play reads it. */
function wire(env: Raw): { cards: Map<number, Wire>; d: Decision | null; refs: Raw[] } {
  const v = env["view"] as { players: Record<string, unknown>[] };
  const cards = new Map<number, Wire>();
  for (const p of v.players) for (const z of ["battlefield", "hand", "graveyard", "exile", "command"]) for (const c of (p[z] as Wire[] | undefined) ?? []) cards.set(c.id, c);
  const d = decoded(env).decision;
  return { cards, d, refs: d && "refs" in d && Array.isArray(d.refs) ? (d.refs as Raw[]) : [] };
}
type W = ReturnType<typeof wire>;

/**
 * A card as the wire has it, its identity aside: every field sent but its id and what it is attached to, and what is
 * attached to it, each by the same rule, however deep (a cycle cut where it closes).
 */
function look(w: W, id: number, seen: ReadonlySet<number> = new Set()): string {
  const c = w.cards.get(id);
  if (!c) return String(id);
  const inner = new Set([...seen, id]);
  const bare = JSON.stringify(Object.entries(c).filter(([k]) => k !== "id" && k !== "attachedTo").sort(([a], [b]) => a.localeCompare(b)));
  const dressed = [...w.cards.values()].filter((x) => x.attachedTo === id && !inner.has(x.id)).map((x) => look(w, x.id, inner)).sort();
  return JSON.stringify([bare, dressed]);
}
/** An option as it would play: its ref with every card as it looks, and its label. */
function canonOpt(w: W, o: number): string {
  const r = w.refs[o - 1] ?? {};
  const label = (w.d?.options[o - 1] ?? "").replace(/\b\d+\b/g, (n) => (w.cards.has(+n) ? look(w, +n) : n));
  return JSON.stringify([Object.entries(r).map(([k, v]) => [k, typeof v === "number" && w.cards.has(v) ? look(w, v) : v]), label]);
}
const canonCard = (w: W, v: unknown) => (typeof v === "number" && w.cards.has(v) ? look(w, v) : v);
/** What an outcome commits, with every card and option as it looks: twins' commits read the same. */
const canon = (w: W, o: Outcome) =>
  JSON.stringify([o.answer?.map((x) => canonOpt(w, x)) ?? null, o.draft ? [o.draft.sel.map((x) => canonOpt(w, x)), canonCard(w, o.draft.holding), canonCard(w, o.draft.attackTo), o.draft.value] : null]);
/** The same card in the same state with the same options (its own id aside). */
function twin(w: W, a: number, b: number): boolean {
  const opts = (id: number) => w.refs.flatMap((r, i) => (r && Object.values(r).includes(id) ? [canonOpt(w, i + 1)] : [])).sort().join();
  return look(w, a) === look(w, b) && opts(a) === opts(b);
}

/** Every violation of the property for gestures on the groups of `t`, piled as `piles` (and opened from `env`). */
function violations(t: Table, env: Raw, piles: readonly number[][], label: string): string[] {
  const out: string[] = [];
  const w = wire(env);
  const groups = groupsOf(t);
  const cardGroups = groups.filter((g) => g.kind !== "plate" && g.kind !== "zone" && g.kind !== "stack");
  const asTarget = (g: Group): Target => (g.kind === "plate" ? { seat: g.seat as never } : { group: g.id, members: g.members });
  const multi = cardGroups.filter((g) => g.members.length > 1);
  const plates = groups.filter((g) => g.kind === "plate");
  const gestures: [Gesture, End[]][] = [];
  for (const g of multi) {
    gestures.push([{ a: "tap", at: asTarget(g) }, ["at"]]);
    for (const o of [...plates, ...cardGroups.filter((x) => x !== g)]) gestures.push([{ a: "drag", from: asTarget(g), onto: asTarget(o) }, o.members.length > 1 ? ["from", "onto"] : ["from"]]);
    for (const s of cardGroups.filter((x) => x.members.length === 1)) gestures.push([{ a: "drag", from: asTarget(s), onto: asTarget(g) }, ["onto"]]);
  }
  /** The gesture with the group at `end` listing its members in another order (re-piled). */
  const reordered = (g: Gesture, end: End, members: readonly CardId[]): Outcome => {
    const k = piles.findIndex((p) => p.length === members.length && p.every((m) => members.includes(m as CardId)));
    const again = t.fork();
    again.pile(piles.map((p, i) => (i === k ? [...members] : p)));
    const other = (x: Target): Target => ("group" in x && x.members.every((m) => members.includes(m)) ? { group: `p${members[0]}`, members: [...members] } : x);
    const g2: Gesture = g.a === "tap" ? { a: "tap", at: other(g.at) } : { a: "drag", from: other(g.from), onto: other(g.onto) };
    return run(again, withEnd(g2, end, { group: `p${members[0]}`, members: [...members] })).o;
  };
  for (const [g, ends] of gestures) {
    const name = `${label} ${JSON.stringify(g)}`;
    const { t: after, o } = run(t, g);
    // The gesture on each member alone, end by end (the other end as it was).
    const alone = ends.map((end) => {
      const t0 = endOf(g, end), members = "members" in t0 ? t0.members : [];
      return { end, members, each: members.map((m) => ({ m, o: run(t, withEnd(g, end, { card: m })).o })) };
    });
    if (o.choose !== null) {
      if (commits(o)) out.push(`${name}: a chooser that also committed`);
      const end = alone.find((a) => groups.find((x) => x.id === o.choose)?.members.every((m) => a.members.includes(m)));
      if (!end) {
        out.push(`${name}: a chooser for ${o.choose}, not an end of the gesture`);
        continue;
      }
      for (const { m } of end.each) {
        const done = run(after, { a: "tap", at: { card: m } }).o, direct = run(t, withEnd(g, end.end, { card: m })).o;
        if (!sameCommit(done, direct) || (done.choose !== null) !== (direct.choose !== null)) out.push(`${name}: choosing ${m} did ${JSON.stringify(done)}, the gesture on it ${JSON.stringify(direct)}`);
      }
      continue;
    }
    if (!commits(o)) continue;
    for (const a of alone) {
      const meant = a.each.filter((x) => meaningful(x.o));
      // the end does not matter: each member's gesture commits the very same
      if (meant.length && meant.every((x) => commits(x.o) && sameCommit(x.o, meant[0]!.o)) && sameCommit(o, meant[0]!.o)) continue;
      const first = meant[0]?.m;
      if (first === undefined) continue;
      if (!meant.every((x) => twin(w, first, x.m))) {
        out.push(`${name}: committed while its ${a.end} could mean distinct cards ${JSON.stringify(meant.map((x) => x.m))}`);
        continue;
      }
      if (!a.members.every((m) => meant.some((x) => x.m === m) || w.cards.get(m)?.name === w.cards.get(first)?.name)) {
        out.push(`${name}: committed for ${first}, hidden among others ${JSON.stringify(a.members)}`);
        continue;
      }
      // twins: the same whichever of them the group lists first
      const mine = canon(w, o);
      for (let k = 1; k < a.members.length; k++) {
        const order = [...a.members.slice(k), ...a.members.slice(0, k)];
        const other = reordered(g, a.end, order);
        if (canon(w, other) !== mine) out.push(`${name}: committed ${mine}, but ${other.choose ? "a chooser" : canon(w, other)} with its ${a.end} listed ${JSON.stringify(order)}`);
      }
    }
  }
  // Every option the refs put on the table reaches the answer sent.
  for (let o = 1; o <= w.refs.length; o++) {
    const why = unreached(t, w, o);
    if (why) out.push(`${label}: option ${o} ${JSON.stringify(w.refs[o - 1])} ${why}`);
  }
  return out;
}

/** Tap a card through what layout drew: its group, and the chooser that group opens. */
function through(t: Table, card: number): Effect[] {
  const g = groupsOf(t).find((x) => x.kind !== "plate" && x.kind !== "zone" && x.members.includes(card as CardId));
  if (!g || g.members.length === 1) return t.tapCard(card);
  const fx = t.tap({ group: g.id, members: g.members });
  return fx.some((e) => e.kind === "choose") ? [...fx, ...t.tapCard(card)] : fx;
}

/**
 * Why option `o` (by its wire ref) cannot be driven to an answer sent with it in, or null when it can: only an answer
 * sent counts, never picks left in the draft. A pick already made is sent as it stands.
 */
function unreached(base: Table, w: W, o: number): string | null {
  const d = w.d, r = w.refs[o - 1] as Record<string, unknown> | undefined;
  if (!d || !r || !["pay", "targets", "choose", "attack", "block", "play"].includes(d.kind)) return null;
  const card = typeof r["card"] === "number" ? r["card"] : null;
  if (card === null && !(d.kind === "targets" || d.kind === "choose")) return null;
  const t = base.fork();
  const fx: Effect[] = [];
  const sent = () => fx.find((e): e is Extract<Effect, { kind: "send" }> => e.kind === "send");
  const press = (b: { id: string } | undefined) => void (b && fx.push(...t.act({ a: "press", button: b.id })));
  const picked = () => draftOf(t).sel.includes(o);
  if (!picked())
    switch (d.kind) {
      case "pay":
        fx.push(...through(t, card!));
        if (t.p.controls.sheet?.kind === "mana") fx.push(...t.pick(o));
        break;
      case "targets":
      case "choose":
        if (t.p.controls.sheet?.kind === "chooser") fx.push(...t.pick(o));
        else if (card !== null) fx.push(...through(t, card));
        else if (typeof r["player"] === "string") fx.push(...t.tapSeat(r["player"]));
        break;
      case "attack": {
        const to = r["to"];
        if (typeof to === "number") fx.push(...through(t, to));
        else if (typeof to === "string") fx.push(...t.tapSeat(to));
        if (!picked()) fx.push(...through(t, card!)); // (a pick re-aimed there already has it)
        break;
      }
      case "block":
        fx.push(...through(t, card!));
        if (draftOf(t).holding === card && typeof r["blocks"] === "number") fx.push(...through(t, r["blocks"]));
        break;
      case "play":
        fx.push(...through(t, card!));
        if (fx.some((e) => e.kind === "inspect")) fx.push(...t.pick(o, card!));
        break;
    }
  // Too few picks to send (a choice of at least two): the others from the list.
  if ((d.kind === "targets" || d.kind === "choose") && !sent())
    for (let k = 1; k <= w.refs.length && draftOf(t).sel.length < d.min && !sent(); k++) {
      if (draftOf(t).sel.includes(k)) continue;
      if (t.p.controls.sheet?.kind !== "chooser") press(t.allButtons().find((b) => b.label === "List"));
      fx.push(...t.pick(k));
    }
  if (!sent()) press(t.allButtons().find((b) => b.enabled && (b.role === "done" || /^(Pay|Attack \(|Block \()/.test(b.label))));
  const send = sent();
  if (!send || !("answer" in send.body)) return `is not sent (picks ${JSON.stringify(draftOf(t).sel)})`;
  const want = canonOpt(w, o);
  return send.body.answer.some((x) => x === o || canonOpt(w, x) === want) ? null : `is not in the answer sent ${JSON.stringify(send.body.answer)}`;
}

/** The battlefields piled as layout may pile them: runs of three (mixed piles), and by name (copies, in any state). */
function pilings(t: Table): number[][][] {
  const m = t.model;
  if (!m) return [];
  const bySeat = m.seats.map((s) => [...m.zone(s.id, "battlefield")] as number[]);
  const runs = bySeat.flatMap((ids) => Array.from({ length: Math.floor(ids.length / 3) }, (_, i) => ids.slice(i * 3, i * 3 + 3)));
  const named = bySeat.flatMap((ids) => {
    const by = new Map<string, number[]>();
    for (const id of ids) by.set(m.cards.get(id as CardId)!.name, [...(by.get(m.cards.get(id as CardId)!.name) ?? []), id]);
    return [...by.values()].filter((g) => g.length > 1);
  });
  // offset runs, so each card meets other neighbours
  const shifted = bySeat.flatMap((ids) => Array.from({ length: Math.floor((ids.length - 1) / 2) }, (_, i) => ids.slice(1 + i * 2, 3 + i * 2)));
  return [runs, named, shifted].filter((p) => p.length);
}

function check(env: Raw, label: string, piles?: number[][], prepare?: (t: Table) => void): string[] {
  const t = new Table();
  t.open(env);
  prepare?.(t);
  const out: string[] = [];
  for (const p of piles ? [piles] : pilings(t)) {
    t.pile(p);
    out.push(...violations(t, env, p, `${label} piles ${JSON.stringify(p)}`));
  }
  return out;
}

// ---- crowded tables -------------------------------------------------------------------------------------------------

const DEFENDERS = ["Atraxa", 872, "Dack", 873, "Princess", 874] as const;
/** 037 with my face-down creature (829) attacking too, and `more` defenders for both. */
function attack037(more: (number | string)[] = [], view?: (v: Raw) => void): Raw {
  const to = [...DEFENDERS, ...more];
  return withDecision(
    "037-attack-poison.json",
    { kind: "attack", prompt: "attackers", options: [871, 829].flatMap((c) => to.map((d) => `${c} -> ${d}`)), refs: [871, 829].flatMap((card) => to.map((t) => ({ card, to: t }))), min: 0, max: 2 * to.length },
    view,
  );
}
const player = (v: Raw, name: string) => (v["players"] as { name: string; battlefield: Wire[] }[]).find((p) => p.name === name)!;
/** A second Gideon Jura for Atraxa (900), at another loyalty. */
const twoGideons = (v: Raw) => {
  const bf = player(v, "Atraxa").battlefield;
  bf.push({ ...structuredClone(bf.find((c) => c.id === 872)!), id: 900, loyalty: 6 });
};

const CROWDED: { name: string; env: () => Raw; piles: number[][]; prepare?: (t: Table) => void }[] = [
  { name: "1. attackers piled, dragged onto a player", env: () => attack037(), piles: [[871, 829]] },
  { name: "1. an attacker dragged onto piled planeswalkers", env: () => attack037([900], twoGideons), piles: [[872, 900]] },
  { name: "2. same-named planeswalkers at different loyalty", env: () => attack037([900], twoGideons), piles: [[872, 900]] },
  { name: "3. a planeswalker among an opponent's permanents", env: () => attack037(), piles: [[834, 872]] },
  {
    name: "4. a mixed pile of mana rocks, one with a play",
    env: () =>
      withDecision("040-play-watching.json", { kind: "play", prompt: "", options: ["Pass", "Sol Ring: add {C}{C}"], refs: [{}, { card: 55, spell: false }], min: 1, max: 1 }, (v) => {
        const bf = player(v, "You").battlefield;
        bf.find((c) => c.id === 55)!.tapped = false;
        bf.push({ ...structuredClone(bf.find((c) => c.id === 55)!), id: 990, name: "Arcane Signet" });
      }),
    piles: [[990, 55]],
  },
  { name: "5. a target picked, then piled with another (043)", env: () => raw("043-choose-poison.json"), piles: [[856, 853]], prepare: (t) => void t.tapCard(856) },
  {
    name: "6. same-named lands with different mana",
    env: () => withDecision("011-pay-my-planeswalker.json", { kind: "pay", prompt: "mana to pay {1}{G}", options: ["Mountain (R)", "Mountain (R)", "Mountain (G)"], refs: [{ card: 807 }, { card: 808 }, { card: 808 }], min: 0, max: 2 }),
    piles: [[807, 808]],
  },
];

// 011 (my Islands 810 and 816, my Grizzly Bears 817 and 818), changed so the twins are not twins, or are.
const PAY011 = "011-pay-my-planeswalker.json";
const card011 = (mine: Wire[], id: number) => mine.find((c) => c.id === id)!;
/** 011 with my second bear (818) made a twin of the first (817), then `f`. */
const edit011 = (f: (mine: Wire[], v: Raw) => void) => (v: Raw) => {
  const mine = player(v, "You").battlefield;
  Object.assign(card011(mine, 818), { ...structuredClone(card011(mine, 817)), id: 818 });
  f(mine, v);
};
/** Target one of my bears (817, 818). */
const bears = (f: (mine: Wire[], v: Raw) => void) =>
  withDecision(PAY011, { kind: "targets", prompt: "target creature", options: ["Grizzly Bears", "Grizzly Bears"], refs: [{ card: 817 }, { card: 818 }], min: 1, max: 1 }, edit011(f));
/** My bears attack Atraxa or Dack, with `refs` as given. */
const bearsAttack = (refs: { card: number; to: string | number }[]) =>
  withDecision(PAY011, { kind: "attack", prompt: "attackers", options: refs.map((r) => `${r.card} -> ${r.to}`), refs, min: 0, max: refs.length }, edit011(() => {}));

CROWDED.push(
  {
    name: "1. a well of Islands, one owned by another player",
    env: () =>
      withDecision(PAY011, { kind: "pay", prompt: "mana to pay {U}", options: ["Island (U)", "Island (U)"], refs: [{ card: 810 }, { card: 816 }], min: 0, max: 1 }, edit011((mine) => void (card011(mine, 816).owner = "Dack"))),
    piles: [[810, 816]],
  },
  { name: "1. twin bears (the rule commits for twins)", env: () => bears(() => {}), piles: [[817, 818]] },
  { name: "1. a token and a card of the same name", env: () => bears((mine) => void (card011(mine, 818).token = true)), piles: [[817, 818]] },
  {
    name: "1. two face-down cards whose names their controller sees",
    env: () =>
      bears((mine) => {
        Object.assign(card011(mine, 817), { faceDown: true, name: "Willbender" });
        Object.assign(card011(mine, 818), { faceDown: true, name: "Hystrodon" });
      }),
    piles: [[817, 818]],
  },
  {
    name: "1. same-named Auras controlled by different players",
    env: () =>
      bears((mine, v) => {
        mine.push({ id: 991, name: "Rancor", type: "Enchantment - Aura", owner: "You", controller: "You", attachedTo: 817 });
        player(v, "Dack").battlefield.push({ id: 992, name: "Rancor", type: "Enchantment - Aura", owner: "Dack", controller: "Dack", attachedTo: 818 });
      }),
    piles: [[817, 818]],
  },
  {
    name: "1. twin bears with a Rancor each, Volition Reins on one Rancor",
    env: () =>
      bears((mine) => {
        mine.push({ id: 991, name: "Rancor", type: "Enchantment - Aura", owner: "You", controller: "You", attachedTo: 817 });
        mine.push({ id: 992, name: "Rancor", type: "Enchantment - Aura", owner: "You", controller: "You", attachedTo: 818 });
        mine.push({ id: 993, name: "Volition Reins", type: "Enchantment - Aura", owner: "You", controller: "You", attachedTo: 992 });
      }),
    piles: [[817, 818]],
  },
  { name: "1. twin bears, one my commander", env: () => bears((mine) => void (card011(mine, 818).commander = true)), piles: [[817, 818]] },
  {
    name: "2. one of two twin attackers picked",
    env: () => bearsAttack([817, 818].flatMap((card) => ["Atraxa", "Dack"].map((to) => ({ card, to })))),
    piles: [[817, 818]],
    prepare: (t) => void t.tapCard(817),
  },
  {
    name: "2. twin attackers whose refs come in another order (their fallback defenders differ)",
    env: () => bearsAttack([{ card: 819, to: "Princess" }, { card: 817, to: "Dack" }, { card: 817, to: "Atraxa" }, { card: 818, to: "Atraxa" }, { card: 818, to: "Dack" }]),
    piles: [[817, 818]],
  },
);

describe("a gesture on a group commits only what the player could have meant", () => {
  it.each(CROWDED)("$name", ({ name, env, piles, prepare }) => {
    expect(check(env(), name, piles, prepare)).toEqual([]);
  });

  it.each(corpusNames.filter((n) => decoded(raw(n)).decision !== null))("%s, piled three ways", (name) => {
    expect(check(raw(name), name)).toEqual([]);
  });

  it("3. a choice refused in the chooser keeps the gesture: the next card chosen completes it", () => {
    // 871 may attack Atraxa or Princess; 829 only Atraxa
    const refs = [{ card: 871, to: "Atraxa" }, { card: 871, to: "Princess" }, { card: 829, to: "Atraxa" }];
    const t = new Table();
    t.open(withDecision("037-attack-poison.json", { kind: "attack", prompt: "attackers", options: refs.map((r) => `${r.card} -> ${r.to}`), refs, min: 0, max: 3 }));
    t.pile([[871, 829]]);
    expect(t.drag({ group: "p871", members: [871, 829] as CardId[] }, { seat: "Princess" as never }).some((e) => e.kind === "choose")).toBe(true);
    expect(t.tapCard(829).some((e) => e.kind === "toast")).toBe(true); // it can't attack Princess
    t.tapCard(871);
    t.press("Attack (1)");
    expect(t.answers()).toEqual([[2]]); // 871 at Princess
  });

  it("5. a chooser open holds auto-pass: nothing is passed while the player chooses", () => {
    // 040: an opponent's spell on the stack and only mana abilities to answer it: auto-pass counts
    const t = new Table();
    t.open("040-play-watching.json");
    expect(t.due.size).toBe(1);
    t.pile([[75, 30]]);
    expect(t.drag({ group: "p75", members: [75, 30] as CardId[] }, { seat: "You" as never }).some((e) => e.kind === "choose")).toBe(true);
    t.advance(10_000);
    expect(t.sends()).toEqual([]);
  });

  it("7. an end the action ignores is not asked about: a rock dragged onto a mixed pile activates at once", () => {
    const t = new Table();
    t.open(withDecision("040-play-watching.json", { kind: "play", prompt: "", options: ["Pass", "Sol Ring: add {C}{C}"], refs: [{}, { card: 55, spell: false }], min: 1, max: 1 }, (v) => void (player(v, "You").battlefield.find((c) => c.id === 55)!.tapped = false)));
    t.pile([[75, 30]]);
    expect(t.drag({ card: 55 as CardId }, { group: "p75", members: [75, 30] as CardId[] }).some((e) => e.kind === "choose")).toBe(false);
    expect(t.answers()).toEqual([[2]]);
  });

  it("2. a choice made after the plan changed: a card that has left its pile is refused, not taken as a fresh tap", () => {
    const t = new Table();
    t.open(attack037());
    t.pile([[871, 829]]);
    t.drag({ group: "p871", members: [871, 829] as CardId[] }, { seat: "Princess" as never });
    t.pile([]); // replanned: the pile is gone
    expect(t.tapCard(829)).toEqual([{ kind: "toast", text: "That card has moved: choose again" }]);
    expect(draftOf(t).sel).toEqual([]);
  });

  it("2. a pending drag whose chosen card left play goes with the snapshot that says so", () => {
    const env = attack037([900], twoGideons);
    const t = new Table();
    t.open(env);
    t.pile([[871, 829], [872, 900]]);
    t.drag({ group: "p871", members: [871, 829] as CardId[] }, { group: "p872", members: [872, 900] as CardId[] });
    expect(t.tapCard(871).some((e) => e.kind === "choose")).toBe(true); // the attacker chosen; now which planeswalker
    expect(t.p.controls.choosing).toBe("p872");
    // the same decision, with 871 gone from the battlefield
    const gone = structuredClone(env);
    const me = player(gone["view"] as Raw, "You");
    me.battlefield = me.battlefield.filter((c) => c.id !== 871);
    expect(t.open(gone, { continuity: "same", piles: [[872, 900]] })).toContainEqual({ kind: "toast", text: "The table changed: choose again" });
    expect(t.p.controls.choosing).toBeNull();
    t.tapCard(900);
    expect(draftOf(t).sel).toEqual([]); // 871 at 900 is not picked
  });
});

