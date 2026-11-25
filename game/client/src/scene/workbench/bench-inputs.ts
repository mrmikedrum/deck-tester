// The arrangement engine's timing inputs (docs/game-arrangement-engine.md §7.3), shared by the Node bench
// (tools/bench-plan.mjs) and the workbench's bench page (`workbench.html?only=bench`) so both time exactly the same
// tables. Every input goes the app's way: a snapshot decoded, a model, `tableInputOf` with the shadow plan on, and
// `planTable`, with memory carried from one plan to the next. Pure: no DOM, no clock (the callers time it).
import { decodeCatalog, modelOf, playerViewer } from "../../model";
import type { TableModel } from "../../model";
import { clearArrangeCaches, planTable, tableInputOf } from "../../layout";
import type { TablePlan } from "../../layout";
import { decodeSnapshot } from "../../protocol";

export interface Frame {
  readonly model: TableModel;
  readonly settling: boolean;
}

export interface Named {
  readonly name: string;
  readonly what: string;
  /** Planned in order, memory carried; a single-frame input is planned again and again from its own memory. */
  readonly frames: readonly Frame[];
}

/** One plan of `f`, carrying the last plan's memory (mat's and the shadow's). */
export function planFrame(f: Frame, prev: TablePlan | null): TablePlan {
  return planTable(
    tableInputOf(f.model, {
      viewport: VIEWPORT,
      mode: "normal",
      memory: prev?.memory ?? null,
      settling: f.settling,
      shadow: { memory: prev?.shadow?.result?.fit.memory ?? null },
    }),
  );
}

export const VIEWPORT = { w: 1180, h: 820 } as const;

/**
 * The same plan as if the shadow leaf's cards had just changed: what the engine keeps between plans is forgotten (all but
 * its rows, which follow the container's geometry), so the leaf is arranged from scratch. A snapshot that changes a seat
 * costs this; one that does not, `planFrame`'s.
 */
export function planFrameChanged(f: Frame, prev: TablePlan | null): TablePlan {
  clearArrangeCaches(true);
  return planFrame(f, prev);
}

/** The same frame planned by `mat` alone, memory carried the same way: what the shadow leaf adds is the difference. */
export function planMatOnly(f: Frame, prev: TablePlan | null): TablePlan {
  return planTable(tableInputOf(f.model, { viewport: VIEWPORT, mode: "normal", memory: prev?.memory ?? null, settling: f.settling }));
}

/** Plans to warm the JIT before timing, in every runner. */
export const WARM = 150;

/**
 * The order every runner plans an input in, and the memory each plan carries (the Node bench and the bench page share
 * it, so the device gate times what Node times): the frames in order, round and round; a sequence starts each pass
 * fresh, a single frame is planned again and again from its own last plan.
 */
export function course(input: Named): { next(): readonly [Frame, TablePlan | null]; keep(plan: TablePlan): void } {
  const fs = input.frames;
  let i = 0, prev: TablePlan | null = null;
  return {
    next() {
      const k = i++ % fs.length;
      if (k === 0 && fs.length > 1) prev = null;
      return [fs[k]!, prev] as const;
    },
    keep(plan) {
      prev = plan;
    },
  };
}

// ---- a seeded table, decoded through the protocol like any snapshot -------------------------------------------------

const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SEATS = ["You", "Marath", "Atraxa", "Dack"] as const;
type Wire = Record<string, unknown> & { id: number; name: string; tapped?: boolean };

/** `n` permanents for `seat`: lands, rocks, creatures (copies, tokens, keywords), works, walkers, an attachment. */
function permanents(seat: string, n: number, rnd: () => number, ids: { next: number }, unique: boolean): Wire[] {
  const out: Wire[] = [];
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const tag = (base: string) => (unique ? `${base} ${seat[0]}${ids.next}` : base);
  for (let i = 0; i < n; i++) {
    const r = rnd(), tapped = rnd() < 0.3, id = ids.next++;
    const card = (name: string, type: string, more: Record<string, unknown> = {}): Wire => ({ id, name, type, owner: seat, controller: seat, tapped, ...more });
    if (r < 0.35) out.push(card(tag(pick(["Forest", "Island", "Swamp", "Plains"])), unique ? "Land" : "Basic Land - Forest", { text: "{T}: Add {G}." }));
    else if (r < 0.43) out.push(card(tag(pick(["Sol Ring", "Arcane Signet", "Fellwar Stone"])), "Artifact", { text: "{T}: Add {C}." }));
    else if (r < 0.8) {
      const token = rnd() < 0.45, p = 1 + Math.floor(rnd() * 5);
      out.push(card(tag(token ? pick(["Beast", "Elemental", "Thopter"]) : pick(["Elf", "Angel", "Wurm", "Knight"]) + ` ${Math.floor(rnd() * 9)}`), rnd() < 0.1 ? "Artifact Creature - Construct" : "Creature - Beast", {
        power: token ? 3 : p,
        toughness: token ? 3 : p,
        token,
        keywords: rnd() < 0.3 ? [pick(["Flying", "Trample", "Deathtouch", "Menace"])] : [],
      }));
    } else if (r < 0.93) out.push(card(tag(`Work ${Math.floor(rnd() * 12)}`), pick(["Enchantment", "Artifact", "Legendary Artifact"]), { text: rnd() < 0.2 ? "Each opponent can't cast more than one spell each turn." : "" }));
    else out.push(card(tag(`Walker ${Math.floor(rnd() * 4)}`), "Legendary Planeswalker - Test", { loyalty: 3 + Math.floor(rnd() * 4) }));
  }
  const host = out.find((c) => (c["type"] as string).includes("Creature") && !c["token"]);
  if (host) out.push({ id: ids.next++, name: "Rancor", type: "Enchantment - Aura", owner: seat, controller: seat, attachedTo: host.id });
  return out;
}

function envelope(battlefields: readonly Wire[][], o: { turn: number; stack?: number; combat?: { attackers: { id: number; defender: string | number }[]; blockers: { id: number; blocking: number }[] } | null }) {
  return {
    state: "playing",
    gen: 1,
    v: o.turn,
    pilots: Object.fromEntries(SEATS.map((n) => [n, n === "You" ? "human" : "forge ai"])),
    view: {
      turn: o.turn,
      label: `T${o.turn}`,
      active: "Atraxa",
      phase: o.combat ? "COMBAT_DECLARE_BLOCKERS" : "MAIN1",
      priority: "You",
      me: "You",
      players: SEATS.map((name, i) => ({ name, life: 40, library: 60, battlefield: battlefields[i] ?? [], graveyard: [], exile: [], command: [], ...(name === "You" ? { hand: [] } : { handCount: 5 }) })),
      stack: Array.from({ length: o.stack ?? 0 }, (_, i) => {
        const target = battlefields[2]![i] ?? null;
        return { id: 9000 + i, source: { id: 9000 + i, name: `Spell ${i}`, owner: "Dack", controller: "Dack", type: "Instant" }, controller: "Dack", spell: true, text: `Spell ${i}`, targets: target ? [target.id] : [] };
      }),
      combat: o.combat ?? null,
      log: [],
    },
    decision: null,
  };
}

function modelFrom(json: unknown, catalog = decodeCatalog({})): TableModel {
  const r = decodeSnapshot(json);
  if (!r.ok) throw new Error(`a bench table did not decode: ${r.error.summary}`);
  const viewer = playerViewer(r.value);
  const m = viewer && modelOf(r.value, catalog, viewer);
  if (!m) throw new Error("a bench table has no model");
  return m;
}

function seeded(seed: number, n: number, o: { unique?: boolean; stack?: number; turn?: number } = {}): Wire[][] {
  const rnd = rng(seed), ids = { next: 1000 };
  return SEATS.map((s) => permanents(s, n, rnd, ids, !!o.unique));
}

/** The design pass's tables (tests/fixtures/boards/design-pass.json), by turn. */
export function designModels(designPass: unknown): Map<number, TableModel> {
  const d = designPass as { stages: { turn: number; envelope: unknown }[]; catalog: unknown };
  const catalog = decodeCatalog(d.catalog);
  return new Map(d.stages.map((s) => [s.turn, modelFrom(s.envelope, catalog)]));
}

/** The named inputs of §7.3. */
export function benchInputs(designPass: unknown): Named[] {
  const design = designModels(designPass);
  const dense = seeded(7, 40);
  // A combat of twelve: six of Atraxa's creatures attack me, six of mine block.
  const fighters = (bf: Wire[]) => bf.filter((c) => String(c["type"]).includes("Creature")).slice(0, 6);
  const att = fighters(dense[2]!), blk = fighters(dense[0]!);
  const combat = { attackers: att.map((c) => ({ id: c.id, defender: "You" })), blockers: blk.map((c, i) => ({ id: c.id, blocking: att[i % att.length]!.id })) };
  // Thirty snapshots: cards tap and untap, arrive and leave; cards fly between zones every third.
  const seq: Frame[] = [];
  let bf = dense.map((s) => s.map((c) => ({ ...c })));
  const rnd = rng(99), ids = { next: 5000 };
  for (let i = 0; i < 30; i++) {
    bf = bf.map((s, k) => {
      let next = s.map((c) => (rnd() < 0.08 ? { ...c, tapped: !c.tapped } : c));
      if (rnd() < 0.5) next = [...next, ...permanents(SEATS[k]!, 1, rnd, ids, false)];
      if (rnd() < 0.3 && next.length > 5) next = next.filter((_, j) => j !== Math.floor(rnd() * next.length));
      return next;
    });
    seq.push({ model: modelFrom(envelope(bf, { turn: 10 + Math.floor(i / 10) })), settling: i % 3 === 1 });
  }
  return [
    { name: "marath15", what: "the design pass's turn-15 table", frames: [{ model: design.get(15)!, settling: false }] },
    { name: "dense", what: "four seats, 40 permanents each, a stack of four", frames: [{ model: modelFrom(envelope(dense, { turn: 12, stack: 4 })), settling: false }] },
    { name: "unique", what: "40 distinct names per seat", frames: [{ model: modelFrom(envelope(seeded(11, 40, { unique: true }), { turn: 12 })), settling: false }] },
    { name: "combat12", what: "a combat of 12 fighters (no gathering yet: mat's combat row)", frames: [{ model: modelFrom(envelope(dense, { turn: 12, combat })), settling: false }] },
    { name: "sequence30", what: "30 consecutive snapshots, memory carried, settling toggling", frames: seq },
  ];
}
