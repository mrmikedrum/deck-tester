import type { BoardCard, SeatBoard } from "../../src/layout/board";
import type { StackEntry, TableInput } from "../../src/layout/plan";
import type { CardId, SeatId } from "../../src/layout/types";

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

type CardInput = Omit<Partial<BoardCard>, "id" | "attachedTo"> & { name: string; id?: number; attachedTo?: number | null };

export function card(o: CardInput): BoardCard {
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
    sick: false,
    loyalty: null,
    reach: "self",
    ...rest,
    attachedTo: attachedTo == null ? null : cid(attachedTo),
  };
}

/** `n` permanents of a plausible mix, deterministic in `seed`. */
export function randomBoard(seed: number, n: number, seat: string, mine: boolean): SeatBoard & { seat: SeatId } {
  const rnd = prng(seed), cards: BoardCard[] = [];
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
  return { seat: sid(seat), mine, cards, fixtures: { graveyard: Math.floor(rnd() * 3), exile: Math.floor(rnd() * 2), commandZone: rnd() < 0.5 } };
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
  return { viewport: vp, mode: "normal", seats, involved, settling: false, memory: null, stack, ...more };
}
