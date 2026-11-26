/// <reference types="node" />
// Inputs for the model's tests: the protocol corpus (decoded with its decision set aside, since the model never reads
// decisions), a catalog of real /api/cards entries, and a builder for hand-made tables decoded through the protocol.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { decodeSnapshot } from "../../src/protocol";
import type { Snapshot } from "../../src/protocol";
import { decodeCatalog, modelOf, seatId } from "../../src/model";
import type { CardCatalog, TableModel, Viewer } from "../../src/model";

const CORPUS = resolve(import.meta.dirname, "../../../../tests/fixtures/protocol");

export const corpusNames = readdirSync(CORPUS)
  .filter((n) => /^\d.*\.json$/.test(n))
  .sort();

export const rawCorpus = new Map(corpusNames.map((n) => [n, JSON.parse(readFileSync(resolve(CORPUS, n), "utf8")) as Record<string, unknown>]));

/** An envelope decoded as the model sees it: its decision is not the model's input, so it is left out. */
export function corpusSnapshot(name: string): Snapshot {
  const r = decodeSnapshot({ ...rawCorpus.get(name), decision: null });
  if (!r.ok) throw new Error(`${name}: ${r.error.summary}`);
  return r.value;
}

/** Real catalog entries (Scryfall data the bridge served) for the corpus's cards, from the old client's data.js. */
export const catalogJson = JSON.parse(readFileSync(resolve(import.meta.dirname, "catalog.json"), "utf8")) as Record<string, unknown>;
export const catalog: CardCatalog = decodeCatalog(catalogJson);

export const viewerOf = (name = "You"): Viewer => ({ perspective: seatId(name), seat: seatId(name), mayAnswer: true });

/** The corpus as runs: a new run starts where the bridge's `v` goes backwards (each run is one game's sequence). */
export function corpusRuns(): string[][] {
  const runs: string[][] = [];
  let last = Infinity;
  for (const n of corpusNames) {
    const v = Number(rawCorpus.get(n)!["v"]);
    if (!(v > last) || !runs.length) runs.push([]);
    runs[runs.length - 1]!.push(n);
    last = v;
  }
  return runs;
}

// ---- hand-made tables ----------------------------------------------------------------------------------------------

export const SEATS = ["You", "Atraxa", "Dack", "Princess"] as const;
export type Name = (typeof SEATS)[number];

export interface WireCard {
  readonly id: number;
  readonly name: string;
  readonly owner: string;
  readonly controller: string;
  readonly type: string;
  readonly [k: string]: unknown;
}

/** A wire card: `seat` owns and controls it unless `more` says otherwise. */
export const card = (id: number, name: string, seat: Name, type: string, more: Record<string, unknown> = {}): WireCard => ({
  id,
  name,
  owner: seat,
  controller: seat,
  type,
  ...more,
});
export const creature = (id: number, name: string, seat: Name, p = 2, t = 2, more: Record<string, unknown> = {}) =>
  card(id, name, seat, "Creature - Soldier", { power: p, toughness: t, ...more });
export const token = (id: number, name: string, seat: Name, p = 1, t = 1, more: Record<string, unknown> = {}) =>
  creature(id, name, seat, p, t, { token: true, ...more });
export const land = (id: number, name: string, seat: Name) => card(id, name, seat, "Basic Land - Plains");
export const spell = (id: number, name: string, seat: Name, text: string, type = "Instant") => card(id, name, seat, type, { text });

interface SeatSpec {
  readonly battlefield?: readonly WireCard[];
  readonly hand?: readonly WireCard[];
  readonly graveyard?: readonly WireCard[];
  readonly exile?: readonly WireCard[];
  readonly command?: readonly WireCard[];
  readonly life?: number;
  readonly library?: number;
  readonly handCount?: number;
  readonly commanderDamage?: Readonly<Record<number, number>>;
}

interface StackSpec {
  readonly id: number;
  readonly source: WireCard;
  readonly targets?: readonly (number | string)[];
  readonly spell?: boolean;
  readonly text?: string;
}

export interface TableSpec {
  readonly gen?: number;
  readonly turn?: number;
  readonly phase?: string;
  readonly active?: Name;
  readonly priority?: Name | null;
  readonly seats: Partial<Record<Name, SeatSpec>>;
  /** Bottom first, as the model holds it (the builder sends the wire's top first). */
  readonly stack?: readonly StackSpec[];
  readonly combat?: { readonly attackers: readonly { id: number; defender: number | string }[]; readonly blockers?: readonly { id: number; blocking: number }[] } | null;
  readonly log?: readonly { i: number; type: string; text: string; card?: number | null }[];
  readonly out?: readonly Name[];
}

/** A decoded snapshot for a hand-made table: every seat present (unless `out`), "You" the viewer. */
export function snapshotOf(spec: TableSpec): Snapshot {
  const players = SEATS.filter((n) => !spec.out?.includes(n)).map((name) => {
    const s = spec.seats[name] ?? {};
    return {
      name,
      life: s.life ?? 40,
      library: s.library ?? 60,
      battlefield: s.battlefield ?? [],
      graveyard: s.graveyard ?? [],
      exile: s.exile ?? [],
      command: s.command ?? [],
      commanderDamage: s.commanderDamage,
      ...(name === "You" ? { hand: s.hand ?? [] } : { handCount: s.handCount ?? 5 }),
    };
  });
  const json = {
    state: "playing",
    gen: spec.gen ?? 1,
    v: 1,
    pilots: Object.fromEntries(SEATS.map((n) => [n, n === "You" ? "human" : "forge ai"])),
    view: {
      turn: spec.turn ?? 5,
      label: "T5",
      active: spec.active ?? "Atraxa",
      phase: spec.phase ?? "MAIN1",
      priority: spec.priority === undefined ? "You" : spec.priority,
      me: "You",
      players,
      stack: [...(spec.stack ?? [])].reverse().map((s) => ({
        id: s.id,
        source: s.source,
        controller: s.source.controller,
        spell: s.spell ?? true,
        text: s.text ?? `${s.source.name} (${s.source.id})`,
        targets: s.targets ?? [],
      })),
      combat: spec.combat ? { attackers: spec.combat.attackers, blockers: spec.combat.blockers ?? [] } : null,
      log: spec.log ?? [],
    },
  };
  const r = decodeSnapshot(json);
  if (!r.ok) throw new Error(r.error.summary);
  return r.value;
}

export function tableOf(spec: TableSpec, cat: CardCatalog = catalog): TableModel {
  const m = modelOf(snapshotOf(spec), cat, viewerOf());
  if (!m) throw new Error("no model");
  return m;
}
