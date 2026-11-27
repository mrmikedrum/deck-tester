import type { BoardCard, SeatBoard } from "../../src/layout/board";
import type { StackEntry, TableInput } from "../../src/layout/plan";
import type { CardId, SeatId } from "../../src/layout/types";
import type { ArrCard } from "../../src/layout/arrange/contract";
import type { EngineInput, LeafInput } from "../../src/layout/arrange/leaves";
import { REST } from "../../src/layout/arrange/moment";
import { arrangedMemory } from "../../src/layout/arrange/adapter";
import type { LayoutMemory } from "../../src/layout/seat";

/** Ids for hand-written boards: the layout takes the model's branded ids. */
export const cid = (n: number): CardId => n as CardId;
export const cids = (...n: number[]): CardId[] => n as CardId[];
export const sid = (s: string): SeatId => s as SeatId;
export const SEATS: readonly SeatId[] = ["you", "ana", "bo", "cy"].map(sid);

// A seeded generator of seat boards (a local PRNG: layout and its tests never touch Math.random).
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CREATURES = ["Elf", "Beast", "Angel", "Goblin", "Wurm", "Spirit", "Knight", "Drake"];
const SUPPORT = [
  ["Sol Ring", "Artifact"],
  ["Rhystic Study", "Enchantment"],
  ["Swiftfoot Boots", "Equipment"],
  ["Smothering Tithe", "Enchantment"],
] as const;

let nextId = 1;
export const resetIds = (n = 1): void => {
  nextId = n;
};

/** A hand-written permanent: the board's facts and the type flags the engine's card is read from (`arrOf`). */
export interface TestCard extends BoardCard {
  readonly name: string;
  readonly cardKey: string;
  readonly land: boolean;
  readonly creature: boolean;
  readonly planeswalker: boolean;
  readonly artifact: boolean;
  readonly enchantment: boolean;
  readonly manaRock: boolean;
  readonly specialLand: boolean;
  readonly treasure: boolean;
  readonly basic: boolean;
  readonly typeWord: string;
  readonly legendary: boolean;
  readonly token: boolean;
  readonly commander: boolean;
  readonly toughness: number | null;
  readonly keywords: readonly string[];
}
export interface TestBoard extends SeatBoard {
  readonly cards: readonly TestCard[];
}

type CardInput = Omit<Partial<TestCard>, "id" | "attachedTo"> & { name: string; id?: number; attachedTo?: number | null };

export function card(o: CardInput): TestCard {
  const { id: given, attachedTo, ...rest } = o;
  const id = cid(given ?? nextId++);
  return {
    id,
    cardKey: o.name,
    sig: `${o.name}|${o.tapped ?? false}|${o.power ?? ""}/${o.toughness ?? ""}`,
    land: false,
    creature: false,
    planeswalker: false,
    artifact: false,
    enchantment: false,
    manaRock: false,
    specialLand: false,
    treasure: false,
    basic: false,
    typeWord: "Artifact",
    legendary: false,
    token: false,
    commander: false,
    tapped: false,
    power: null,
    toughness: null,
    keywords: [],
    ...rest,
    attachedTo: attachedTo == null ? null : cid(attachedTo),
  };
}

/** `n` permanents of a plausible mix, deterministic in `seed`. */
export function randomBoard(seed: number, n: number, seat: string, mine: boolean): TestBoard & { seat: SeatId } {
  const rnd = prng(seed), cards: TestCard[] = [];
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  for (let i = 0; i < n; i++) {
    const r = rnd(), tapped = rnd() < 0.3;
    if (r < 0.4) {
      const basic = rnd() < 0.7, name = basic ? pick(["Forest", "Island", "Swamp"]) : `Land ${Math.floor(rnd() * 12)}`;
      cards.push(card({ name, land: true, basic, tapped, typeWord: "Land", legendary: !basic && rnd() < 0.1 }));
    } else if (r < 0.5) {
      cards.push(card({ name: pick(["Mana Vault", "Arcane Signet", "Fellwar Stone"]), manaRock: true, artifact: true, tapped }));
    } else if (r < 0.85) {
      const token = rnd() < 0.4, p = 1 + Math.floor(rnd() * 3), name = token ? pick(["Beast Token", "Elf Token", "Thopter"]) : `${pick(CREATURES)} ${Math.floor(rnd() * 20)}`;
      cards.push(
        card({
          name,
          creature: true,
          token,
          tapped,
          power: p,
          toughness: p,
          legendary: !token && rnd() < 0.1,
          commander: false,
          keywords: rnd() < 0.3 ? ["flying"] : [],
          typeWord: "Creature",
        }),
      );
    } else if (r < 0.9) {
      cards.push(card({ name: `Walker ${Math.floor(rnd() * 5)}`, planeswalker: true, typeWord: "Planeswalker", legendary: true }));
    } else {
      const [name, typeWord] = pick(SUPPORT);
      cards.push(card({ name, typeWord, artifact: typeWord !== "Enchantment", enchantment: typeWord === "Enchantment" }));
    }
  }
  // an aura or two on creatures, to exercise dressing
  const hosts = cards.filter((c) => c.creature && !c.token);
  if (hosts.length > 2) cards.push(card({ name: "Aura", typeWord: "Aura", enchantment: true, attachedTo: hosts[0]!.id }));
  return { seat: sid(seat), mine, cards };
}

/** A hand-written card as the arrangement engine reads it (arrange/card.ts reads a model's card the same way). */
export function arrOf(c: TestCard, seat: SeatId): ArrCard {
  const creature = c.creature && !c.land ? true : c.creature, land = c.land;
  const types = { creature, land, artifact: c.artifact || c.manaRock, enchantment: c.enchantment, planeswalker: c.planeswalker, battle: false };
  return {
    id: c.id,
    controller: seat,
    owner: seat,
    name: c.name,
    cardKey: c.cardKey,
    lookKey: `${c.name}|${Object.entries(types).filter(([, v]) => v).map(([k]) => k[0]).join("")}|${c.power ?? ""}/${c.toughness ?? ""}|${[...c.keywords].sort().join(",")}`,
    types,
    subtypes: [],
    supertypes: { legendary: c.legendary || c.commander, basic: c.basic },
    token: c.token,
    commander: c.commander,
    copy: false,
    faceDown: false,
    manaSource: land || c.manaRock || c.treasure,
    tapped: c.tapped,
    sick: false,
    power: creature ? c.power : null,
    toughness: creature ? c.toughness : null,
    loyalty: c.planeswalker ? 4 : null,
    defense: null,
    keywords: c.keywords,
    counters: 0,
    attachedTo: c.attachedTo,
    reach: "self",
    manaValue: 2,
    produces: land || c.manaRock ? ["G"] : [],
  };
}

/** Every seat of a hand-written table as the engine is given it: the first seat mine, nothing acting but `involved`, each
 *  seat's memory what the last plan's layout memory carries (as `tableInputOf` hands it on). */
export function engineOf(
  seats: readonly { readonly seat: SeatId; readonly board: SeatBoard }[],
  involved: ReadonlySet<CardId> = new Set(),
  o: { readonly memory?: ReadonlyMap<SeatId, LayoutMemory> | null; readonly settling?: boolean } = {},
): EngineInput {
  const me = seats[0]!.seat;
  const leaf = ({ seat, board }: { seat: SeatId; board: SeatBoard }): LeafInput => ({
    seat,
    viewer: me,
    cards: (board.cards as readonly TestCard[]).map((c) => arrOf(c, seat)),
    involved,
    offered: new Set(),
    choosing: false,
    moment: REST,
    clock: { turn: 6, phase: "MAIN1", active: me, settling: o.settling ?? false },
    memory: arrangedMemory(o.memory?.get(seat)),
  });
  return { leaves: seats.slice(1).map(leaf), mine: leaf(seats[0]!) };
}

export const SUPPORTED = [
  { w: 1024, h: 768 },
  { w: 1180, h: 820 },
  { w: 1366, h: 1024 },
] as const;

/** Four seats of `n` permanents, a stack of `depth` (abilities and answers mixed in), and some of each seat's creatures acting. */
export function stress(seed: number, n: number, depth: number, vp: { w: number; h: number }, more: Partial<TableInput> = {}): TableInput {
  resetIds(1);
  const seats = SEATS.map((s, i) => ({ seat: s, board: randomBoard(seed * 31 + i, n, s, i === 0) }));
  const involved = new Set<CardId>();
  for (const { board } of seats) board.cards.filter((c) => c.creature).slice(0, 2).forEach((c) => involved.add(c.id));
  const stack: StackEntry[] = Array.from({ length: depth }, (_, i) => ({ key: `s${i}`, card: cid(9000 + i), ability: i % 3 === 1, answers: i % 5 === 4 }));
  return { viewport: vp, mode: "normal", seats, involved, settling: false, memory: null, stack, engine: engineOf(seats, involved), ...more };
}
