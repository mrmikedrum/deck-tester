// Hand-built boards and faces for the workbench: a handful of real cards (art in the bridge's cache) laid out as a
// four-seat table. Each card has a `FaceSpec` for the painters and a `BoardCard` for layout; model/ will derive both
// from a Card later (the gap this file stands in for is the mapping listed in the lane report).
import type { BoardCard, CardId, SeatBoard, SeatId } from "../../layout";
import { faceSpec, seat as seatColours } from "../../theme";
import type { FaceSpec, FrameKey, SeatPlace } from "../../theme";

export const artUrl = (slug: string): string => `cache/cards/art/${slug}.jpg`;

export interface Entry {
  readonly name: string;
  readonly art?: string;
  readonly frame: FrameKey;
  readonly kind: "creature" | "land" | "artifact" | "enchantment" | "walker" | "rock";
  readonly power?: number;
  readonly toughness?: number;
  readonly basePower?: number;
  readonly baseToughness?: number;
  readonly mana?: readonly string[];
  readonly keywords?: readonly string[];
  readonly tapped?: boolean;
  readonly token?: boolean;
  readonly commander?: boolean;
  readonly gem?: "none" | "idle" | "lit";
  readonly loyalty?: string;
  readonly tags?: readonly string[];
  readonly typeLine?: string;
  readonly text?: string;
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/['’]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-+/g, "-");

export const SEAT_IDS = ["you", "ana", "bo", "cy"] as const;
export const SEAT_PLACES: Readonly<Record<(typeof SEAT_IDS)[number], SeatPlace>> = {
  you: "near",
  ana: "left",
  bo: "across",
  cy: "right",
};

/** The face a card wears. `far` is true for everyone's but the viewer's. */
export function faceOf(e: Entry, far: boolean, ready: (url: string) => boolean): FaceSpec {
  const url = e.art === undefined ? slug(e.name) : e.art;
  const art = url && ready(artUrl(url)) ? artUrl(url) : null;
  const foot: FaceSpec["foot"] =
    e.kind === "creature"
      ? {
          kind: "creature",
          power: e.power ?? 1,
          toughness: e.toughness ?? 1,
          basePower: e.basePower ?? e.power ?? 1,
          baseToughness: e.baseToughness ?? e.toughness ?? 1,
        }
      : e.kind === "walker"
        ? { kind: "walker", loyalty: e.loyalty ?? "4" }
        : e.kind === "land"
          ? { kind: "land", mana: e.mana ?? [] }
          : { kind: "type", typeLine: e.typeLine ?? (e.kind === "enchantment" ? "Enchantment" : "Artifact") };
  return faceSpec({
    name: e.name,
    frame: e.frame,
    far,
    art,
    foot,
    text: e.text ?? "",
    keywords: e.keywords ?? [],
    tapped: e.tapped ?? false,
    token: e.token ?? false,
    commander: e.commander ?? false,
    gem: e.gem ?? "none",
    tags: e.tags ?? [],
  });
}

let nextId = 1;
const cid = (n: number): CardId => n as CardId;

function boardCard(e: Entry, id: number): BoardCard {
  const land = e.kind === "land",
    creature = e.kind === "creature";
  return {
    id: cid(id),
    name: e.name,
    cardKey: e.name,
    sig: `${e.name}|${e.tapped ?? false}|${e.power ?? ""}/${e.toughness ?? ""}`,
    land,
    creature,
    planeswalker: e.kind === "walker",
    artifact: e.kind === "artifact" || e.kind === "rock",
    enchantment: e.kind === "enchantment",
    manaRock: e.kind === "rock",
    specialLand: false,
    treasure: false,
    basic: land && !e.name.includes(" "),
    typeWord: land
      ? "Land"
      : creature
        ? "Creature"
        : e.kind === "walker"
          ? "Planeswalker"
          : e.kind === "enchantment"
            ? "Enchantment"
            : "Artifact",
    legendary: e.commander === true || e.kind === "walker",
    token: e.token ?? false,
    commander: e.commander ?? false,
    tapped: e.tapped ?? false,
    power: creature ? (e.power ?? 1) : null,
    toughness: creature ? (e.toughness ?? 1) : null,
    keywords: e.keywords ?? [],
    sick: false,
    loyalty: null,
    reach: "self",
    manaSource: e.kind === "rock",
    counted: false,
    attachedTo: null,
  };
}

export type SeatKey = (typeof SEAT_IDS)[number];

export interface Fixture {
  /** Plate names and life by seat. */
  readonly names: ReadonlyMap<SeatId, { readonly name: string; readonly life: number }>;
  readonly boards: readonly { readonly seat: SeatId; readonly board: SeatBoard }[];
  readonly entries: ReadonlyMap<CardId, { readonly entry: Entry; readonly seat: SeatId }>;
}

const basics = (n: number, name: string, mana: string, frame: FrameKey = "L"): Entry[] =>
  Array.from({ length: n }, (_, i) => ({ name, frame, kind: "land" as const, mana: [mana], tapped: i % 3 === 1 }));

const YOU: Entry[] = [
  {
    name: "Brimaz, Blight of Oreskos",
    frame: "W",
    kind: "creature",
    power: 5,
    toughness: 4,
    basePower: 3,
    baseToughness: 4,
    keywords: ["Vigilance", "Lifelink", "First strike"],
    gem: "lit",
    commander: true,
  },
  { name: "Herd Baloth", frame: "G", kind: "creature", power: 4, toughness: 4, keywords: ["Trample"] },
  {
    name: "Restoration Angel",
    frame: "W",
    kind: "creature",
    power: 3,
    toughness: 4,
    keywords: ["Flying"],
    tapped: true,
    gem: "idle",
  },
  { name: "Beast", frame: "T", kind: "creature", power: 3, toughness: 3, token: true },
  { name: "Wrenn and Realmbreaker", frame: "G", kind: "walker", loyalty: "5", gem: "idle" },
  { name: "Sol Ring", frame: "C", kind: "rock", typeLine: "Artifact" },
  { name: "Smothering Tithe", frame: "W", kind: "enchantment" },
  ...basics(3, "Plains", "W"),
  ...basics(2, "Forest", "G"),
  { name: "Sacred Foundry", frame: "L", kind: "land", mana: ["R", "W"] },
];
const OPP: Entry[][] = [
  [
    { name: "Meloku the Clouded Mirror", frame: "U", kind: "creature", power: 2, toughness: 2, keywords: ["Flying"] },
    { name: "Mulldrifter", frame: "U", kind: "creature", power: 2, toughness: 2, keywords: ["Flying"], tapped: true },
    { name: "Thopter", frame: "T", kind: "creature", power: 1, toughness: 1, token: true, keywords: ["Flying"] },
    ...basics(4, "Island", "U"),
  ],
  [
    {
      name: "Glissa, Herald of Predation",
      frame: "M",
      kind: "creature",
      power: 3,
      toughness: 3,
      keywords: ["Deathtouch", "Trample"],
    },
    { name: "Marath, Will of the Wild", frame: "M", kind: "creature", power: 3, toughness: 3 },
    { name: "Mana Vault", frame: "C", kind: "rock" },
    ...basics(3, "Forest", "G"),
  ],
  [
    { name: "Tezzeret, Cruel Captain", frame: "C", kind: "walker", loyalty: "4" },
    { name: "Hangarback Walker", frame: "C", kind: "creature", power: 2, toughness: 2 },
    { name: "Chrome Mox", frame: "C", kind: "rock" },
    ...basics(3, "Swamp", "B", "L"),
  ],
];

export function fixture(): Fixture {
  nextId = 1;
  const entries = new Map<CardId, { entry: Entry; seat: SeatId }>();
  const boards = [YOU, ...OPP].map((list, i) => {
    const seat = SEAT_IDS[i] as SeatId;
    const cards = list.map((e) => {
      const bc = boardCard(e, nextId++);
      entries.set(bc.id, { entry: e, seat });
      return bc;
    });
    return {
      seat,
      board: {
        seat,
        mine: i === 0,
        cards,
        fixtures: { graveyard: i + 1, exile: i === 1 ? 2 : 0, commandZone: false },
      } satisfies SeatBoard,
    };
  });
  const names = new Map<SeatId, { name: string; life: number }>(
    SEAT_IDS.map((id, i) => [
      id as SeatId,
      { name: ["You", "Ana", "Bo", "Cy"][i] ?? id, life: [40, 23, 31, 18][i] ?? 40 },
    ]),
  );
  return { names, boards, entries };
}

export const seatColour = (id: (typeof SEAT_IDS)[number]): string => seatColours[SEAT_PLACES[id]];
