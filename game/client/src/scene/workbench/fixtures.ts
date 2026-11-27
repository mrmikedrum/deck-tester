// Hand-built boards and faces for the workbench: a handful of real cards (art in the bridge's cache) laid out as a
// four-seat table. Each card has a `FaceSpec` for the painters, and a `BoardCard` and the engine's `ArrCard` for layout
// (what a model's card gives them in play).
import type { BoardCard, CardId, EngineInput, LeafInput, SeatBoard, SeatId } from "../../layout";
import type { ArrCard } from "../../layout/arrange/contract";
import { REST } from "../../layout/arrange/moment";
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
  /** What it is also made of (an artifact creature, a land creature), its whole face if it has one, a basic land. */
  readonly made?: FaceSpec["made"];
  readonly whole?: FaceSpec["whole"];
  readonly basic?: boolean;
  /** Figures it has but is not a creature now (a vehicle). */
  readonly hollow?: boolean;
  readonly defense?: string;
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
    e.kind === "creature" || e.hollow
      ? {
          kind: "creature",
          power: e.power ?? 1,
          toughness: e.toughness ?? 1,
          basePower: e.basePower ?? e.power ?? 1,
          baseToughness: e.baseToughness ?? e.toughness ?? 1,
          ...(e.hollow ? { hollow: true } : {}),
        }
      : e.kind === "walker"
        ? { kind: "walker", loyalty: e.loyalty ?? "4" }
        : e.defense !== undefined
          ? { kind: "battle", defense: e.defense }
          : e.kind === "land"
            ? { kind: "land", mana: e.mana ?? [] }
            : { kind: "type", typeLine: e.typeLine ?? (e.kind === "enchantment" ? "Enchantment" : "Artifact") };
  const mana = e.mana ?? [];
  const made: FaceSpec["made"] =
    e.made ?? (e.kind === "artifact" || e.kind === "rock" ? ["artifact"] : e.kind === "enchantment" ? ["enchantment"] : e.kind === "land" ? ["land"] : []);
  const whole: FaceSpec["whole"] =
    e.whole !== undefined
      ? e.whole
      : e.kind === "walker"
        ? "walker"
        : e.kind !== "land"
          ? null
          : e.basic
            ? "basic"
            : mana.length >= 4
              ? "any"
              : mana.length >= 2
                ? "dual"
                : "utility";
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
    made,
    whole,
    mana,
  });
}

let nextId = 1;
const cid = (n: number): CardId => n as CardId;

function boardCard(e: Entry, id: number): BoardCard {
  return { id: cid(id), sig: `${e.name}|${e.tapped ?? false}|${e.power ?? ""}/${e.toughness ?? ""}`, tapped: e.tapped ?? false, power: e.kind === "creature" ? (e.power ?? 1) : null, attachedTo: null };
}

/** A card as the arrangement engine reads it (arrange/card.ts reads a model's card the same way). */
function arrCardOf(e: Entry, id: CardId, seat: SeatId): ArrCard {
  const k = e.kind, creature = k === "creature", land = k === "land";
  const types = { creature, land, artifact: k === "artifact" || k === "rock", enchantment: k === "enchantment", planeswalker: k === "walker", battle: false };
  const power = creature ? (e.power ?? 1) : null, toughness = creature ? (e.toughness ?? 1) : null;
  return {
    id,
    controller: seat,
    owner: seat,
    name: e.name,
    cardKey: e.name,
    lookKey: `${e.name}|${k}|${power ?? ""}/${toughness ?? ""}|${(e.keywords ?? []).join(",")}`,
    types,
    subtypes: [],
    supertypes: { legendary: e.commander === true || k === "walker", basic: e.basic ?? (land && !e.name.includes(" ")) },
    token: e.token ?? false,
    commander: e.commander ?? false,
    copy: false,
    faceDown: false,
    manaSource: land || k === "rock" || (e.mana?.length ?? 0) > 0,
    tapped: e.tapped ?? false,
    sick: false,
    power,
    toughness,
    loyalty: k === "walker" ? Number(e.loyalty ?? 0) : null,
    defense: null,
    keywords: e.keywords ?? [],
    counters: 0,
    attachedTo: null,
    reach: "self",
    manaValue: 0,
    produces: e.mana ?? [],
  };
}

export type SeatKey = (typeof SEAT_IDS)[number];

export interface Fixture {
  /** Plate names and life by seat. */
  readonly names: ReadonlyMap<SeatId, { readonly name: string; readonly life: number }>;
  readonly boards: readonly { readonly seat: SeatId; readonly board: SeatBoard }[];
  readonly entries: ReadonlyMap<CardId, { readonly entry: Entry; readonly seat: SeatId }>;
  /** Every seat as the arrangement engine is given it. */
  readonly engine: EngineInput;
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
  const arr = new Map<SeatId, ArrCard[]>();
  const boards = [YOU, ...OPP].map((list, i) => {
    const seat = SEAT_IDS[i] as SeatId;
    const cards = list.map((e) => {
      const bc = boardCard(e, nextId++);
      entries.set(bc.id, { entry: e, seat });
      arr.set(seat, [...(arr.get(seat) ?? []), arrCardOf(e, bc.id, seat)]);
      return bc;
    });
    return { seat, board: { seat, mine: i === 0, cards } satisfies SeatBoard };
  });
  // Every seat on the engine, at rest, nothing acting.
  const me = boards[0]!.seat;
  const leaf = (seat: SeatId): LeafInput => ({
    seat,
    viewer: me,
    cards: arr.get(seat) ?? [],
    involved: new Set(),
    offered: new Set(),
    choosing: false,
    moment: REST,
    clock: { turn: 6, phase: "MAIN1", active: me, settling: false },
    memory: null,
  });
  const engine: EngineInput = { leaves: boards.slice(1).map((b) => leaf(b.seat)), mine: leaf(me) };
  const names = new Map<SeatId, { name: string; life: number }>(
    SEAT_IDS.map((id, i) => [
      id as SeatId,
      { name: ["You", "Ana", "Bo", "Cy"][i] ?? id, life: [40, 23, 31, 18][i] ?? 40 },
    ]),
  );
  return { names, boards, entries, engine };
}

export const seatColour = (id: (typeof SEAT_IDS)[number]): string => seatColours[SEAT_PLACES[id]];
