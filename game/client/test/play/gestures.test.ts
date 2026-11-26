// A gesture on a group commits only what the player could have meant: the property over every decision in the protocol
// corpus (its battlefields piled in several ways, as layout may pile them) and crowded tables (mixed piles, same-named
// cards in different states, planeswalkers among permanents, mixed mana, a choice made after the plan changed).
//
// For every group of several cards and every gesture on it (a tap; a drag from it onto every plate and group; a drag
// from a card onto it), what play does is one of:
//  - nothing meant (no send, no pick changed);
//  - a commit that is exactly what the same gesture on one of its members alone would do, where every member it could
//    mean is the same card in the same state with the same options (judged here from the wire, apart from play's own
//    reading), and the members it cannot mean share their name;
//  - a chooser that commits nothing, and that, for each member, completes the very gesture (both ends) with that card.
// And every option on the table is reachable: a tap on its group commits it (or its twin), or opens a chooser.
import { describe, expect, it } from "vitest";
import type { CardId, Decision } from "../../src/protocol";
import type { Effect, Target } from "../../src/play";
import { Table, corpusNames, decoded, raw, withDecision } from "./rig";

type Raw = Record<string, unknown>;
type Wire = { id: number; name: string; attachedTo?: number } & Raw;
type Gesture = { a: "tap"; at: Target } | { a: "drag"; from: Target; onto: Target };
type End = "at" | "from" | "onto";

interface Outcome {
  readonly sent: string | null;
  readonly picks: string;
  readonly choose: string | null;
  readonly opened: boolean;
}

const draftOf = (t: Table) => (t.state as unknown as { draft: { sel: number[]; holding: unknown; attackTo: unknown; value: number } }).draft;
const picksOf = (t: Table) => {
  const d = draftOf(t);
  return JSON.stringify([d.sel, d.holding, d.attackTo, d.value]);
};

function run(base: Table, g: Gesture): { t: Table; o: Outcome } {
  const t = base.fork();
  const before = picksOf(t), sheet = JSON.stringify(t.p.controls.sheet);
  const fx: Effect[] = g.a === "tap" ? t.tap(g.at) : t.drag(g.from, g.onto);
  const send = fx.find((e) => e.kind === "send");
  const picks = picksOf(t);
  return {
    t,
    o: {
      sent: send && send.kind === "send" ? JSON.stringify(send.body) : null,
      picks: picks === before ? "" : picks,
      choose: fx.find((e) => e.kind === "choose")?.kind === "choose" ? (fx.find((e) => e.kind === "choose") as { group: string }).group : null,
      opened: fx.some((e) => e.kind === "inspect") || JSON.stringify(t.p.controls.sheet) !== sheet,
    },
  };
}

const commits = (o: Outcome) => o.sent !== null || o.picks !== "";
const meaningful = (o: Outcome) => commits(o) || o.choose !== null || o.opened;
const sameCommit = (a: Outcome, b: Outcome) => a.sent === b.sent && a.picks === b.picks;

const withEnd = (g: Gesture, end: End, t: Target): Gesture => (g.a === "tap" ? { a: "tap", at: t } : end === "from" ? { ...g, from: t } : { ...g, onto: t });
const endOf = (g: Gesture, end: End): Target => (g.a === "tap" ? g.at : end === "from" ? g.from : g.onto);

/** The wire's cards by id (every zone), and the decision: the judge reads the table as sent, not as play reads it. */
function wire(env: Raw): { cards: Map<number, Wire>; d: Decision | null } {
  const v = env["view"] as { players: Record<string, unknown>[] };
  const cards = new Map<number, Wire>();
  for (const p of v.players) for (const z of ["battlefield", "hand", "graveyard", "exile", "command"]) for (const c of (p[z] as Wire[] | undefined) ?? []) cards.set(c.id, c);
  return { cards, d: decoded(env).decision };
}

/** The same card in the same state with the same options (its own id aside). */
function twin(env: ReturnType<typeof wire>, a: number, b: number): boolean {
  const look = (id: number) => {
    const c = env.cards.get(id) ?? ({ id, name: String(id) } as Wire);
    const rest = Object.entries(c).filter(([k]) => k !== "id").sort(([x], [y]) => x.localeCompare(y));
    const dressed = [...env.cards.values()].filter((x) => x.attachedTo === id).map((x) => x.name).sort();
    const d = env.d, refs = d && "refs" in d && Array.isArray(d.refs) ? (d.refs as Raw[]) : [];
    const opts = refs.flatMap((r, i) => (r && Object.values(r).includes(id) ? [JSON.stringify([Object.entries(r).map(([k, v]) => [k, v === id ? "*" : v]), (d!.options[i] ?? "").split(String(id)).join("*")])] : [])).sort();
    return JSON.stringify([rest, dressed, opts]);
  };
  return look(a) === look(b);
}

/** Every violation of the property for gestures on the groups of `t` (as opened from `env`). */
function violations(t: Table, env: Raw, label: string): string[] {
  const out: string[] = [];
  const w = wire(env);
  const groups = (t.state as unknown as { groups: { id: string; kind: string; seat: string | null; members: CardId[] }[] }).groups;
  const cardGroups = groups.filter((g) => g.kind !== "plate" && g.kind !== "zone" && g.kind !== "stack");
  const asTarget = (g: (typeof groups)[number]): Target => (g.kind === "plate" ? { seat: g.seat as never } : { group: g.id, members: g.members });
  const multi = cardGroups.filter((g) => g.members.length > 1);
  const plates = groups.filter((g) => g.kind === "plate");
  const gestures: [Gesture, End[]][] = [];
  for (const g of multi) {
    gestures.push([{ a: "tap", at: asTarget(g) }, ["at"]]);
    for (const o of [...plates, ...cardGroups.filter((x) => x !== g)]) gestures.push([{ a: "drag", from: asTarget(g), onto: asTarget(o) }, o.members.length > 1 ? ["from", "onto"] : ["from"]]);
    for (const s of cardGroups.filter((x) => x.members.length === 1)) gestures.push([{ a: "drag", from: asTarget(s), onto: asTarget(g) }, ["onto"]]);
  }
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
        if (!sameCommit(done, direct) || done.choose !== direct.choose) out.push(`${name}: choosing ${m} did ${JSON.stringify(done)}, the gesture on it ${JSON.stringify(direct)}`);
      }
      continue;
    }
    if (!commits(o)) continue;
    // A commit: exactly what one member's gesture would do...
    const combos = alone.length === 1 ? alone[0]!.each.map((x) => x.o) : alone.flatMap((a) => a.each.map((x) => x.o));
    if (!combos.some((x) => sameCommit(x, o))) out.push(`${name}: committed ${JSON.stringify(o)}, which no member alone would`);
    // ...and every member it could mean is that member's twin; those it cannot share their name.
    for (const a of alone) {
      const meant = a.each.filter((x) => meaningful(x.o)).map((x) => x.m);
      if (meant.length < 2 && a.members.every((m) => meant.includes(m) || w.cards.get(m)?.name === w.cards.get(meant[0] ?? m)?.name)) continue;
      const first = meant[0];
      if (first === undefined) continue;
      if (!meant.every((m) => twin(w, first, m))) out.push(`${name}: committed while its ${a.end} could mean distinct cards ${JSON.stringify(meant)}`);
      else if (!a.members.every((m) => meant.includes(m) || w.cards.get(m)?.name === w.cards.get(first)?.name)) out.push(`${name}: committed for ${first}, hidden among others ${JSON.stringify(a.members)}`);
    }
  }
  // Every option on the table is reachable from its group.
  const d = w.d, refs = d && "refs" in d && Array.isArray(d.refs) ? (d.refs as Raw[]) : [];
  for (const id of new Set(refs.flatMap((r) => Object.values(r ?? {}).filter((v): v is number => typeof v === "number")))) {
    const g = multi.find((x) => x.members.includes(id as CardId));
    if (!g) continue;
    const direct = run(t, { a: "tap", at: { card: id as CardId } }).o;
    if (!meaningful(direct)) continue;
    const { t: after, o } = run(t, { a: "tap", at: asTarget(g) });
    if (o.choose !== null) {
      const done = run(after, { a: "tap", at: { card: id as CardId } }).o;
      if (!sameCommit(done, direct)) out.push(`${label}: ${id} chosen from ${g.id} did ${JSON.stringify(done)}, a tap on it ${JSON.stringify(direct)}`);
    } else if (!meaningful(o)) out.push(`${label}: ${id} is unreachable in ${g.id}`);
  }
  return out;
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
    out.push(...violations(t, env, `${label} piles ${JSON.stringify(p)}`));
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

describe("a gesture on a group commits only what the player could have meant", () => {
  it.each(CROWDED)("$name", ({ name, env, piles, prepare }) => {
    expect(check(env(), name, piles, prepare)).toEqual([]);
  });

  it.each(corpusNames.filter((n) => decoded(raw(n)).decision !== null))("%s, piled three ways", (name) => {
    expect(check(raw(name), name)).toEqual([]);
  });

  it("a choice made after the plan changed: only the card chosen, and only while its group holds it", () => {
    const t = new Table();
    t.open(attack037());
    t.pile([[871, 829]]);
    t.drag({ group: "p871", members: [871, 829] as CardId[] }, { seat: "Princess" as never });
    // replanned: the pile is gone; a tap on 829 is a tap on 829, the drag is not completed with it
    t.pile([]);
    t.tapCard(829);
    t.press("Attack (1)");
    expect(t.answers()).toEqual([[7]]); // 829 at the first opponent, not at Princess
  });
});
