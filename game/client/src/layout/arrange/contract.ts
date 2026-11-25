// The arrangement engine's contract (docs/game-arrangement-engine.md §1–§3): what a caller gives `arrange`, what it
// returns, what a policy is, and what memory it keeps. Plain data throughout: no functions but a policy's own, so an
// arrangement is a golden and memory survives JSON.
import type { Phase } from "../../model";
import type { Projector } from "../projector";
import type { Quad } from "../shape";
import type { CardId, Rect, SeatId, V3 } from "../types";
import type { Moment } from "./moment";

export type ContainerId = string;
export type UnitId = string;
export type EntryId = string;
export type TierId = string;
export type GroupKey = string;
/** A unit's identity for memory: a single card `c<id>`, a group's stack `s<group>`, a tier's fan `f<tier>`, `sum`. */
export type UnitKey = string;
export type TargetId = string;

// ---- 1.1 the container --------------------------------------------------------------------------------------------

export type ContainerRole = "rest" | "spread" | "pile" | "plate" | "hand" | "gathering";

/** An orthonormal, right-handed frame. Rows run along `across`, laid from the anchor edge along `away`. */
export interface SurfaceFrame {
  /** The middle of the anchor edge. `u` runs along `across` from it (−w/2 to w/2), `v` along `away` (0 to d). */
  readonly anchor: V3;
  readonly across: V3;
  readonly away: V3;
  readonly normal: V3;
  readonly w: number;
  readonly d: number;
}

export type Layer =
  | { readonly kind: "table" }
  | { readonly kind: "nearer"; readonly steps: readonly number[] }
  | { readonly kind: "held"; readonly widthsPx: readonly number[] };

export type Keepout =
  | { readonly on: "screen"; readonly rect: Rect; readonly kind: "hand" | "prompt" | "rail" | "stack" | "plate" | "other" }
  | {
      readonly on: "frame";
      readonly u0: number;
      readonly u1: number;
      readonly v0: number;
      readonly v1: number;
      readonly kind: "plate" | "zones" | "commander" | "other";
    };

/** A focus's group captions, CSS px, never scaled down (designer §7.2). Null at rest: no words on the table. */
export interface CaptionRoom {
  readonly linePx: 24;
  readonly typePx: 16;
  readonly minWidthPx: 88;
  readonly attach: "above-far-left";
  readonly summaryMinWidthPx: 120;
}

/** Floors in design px (intent.md's hard limits) and the tap patch in CSS px. */
export interface Floors {
  readonly creature: number;
  readonly any: number;
  readonly tapPx: number;
}

export interface Container {
  readonly id: ContainerId;
  readonly role: ContainerRole;
  readonly owner: SeatId | null;
  readonly viewer: SeatId;
  readonly frame: SurfaceFrame;
  readonly projector: Projector;
  /** Every other table pose the frame must hold under (§5.3); [] until the template has poses. */
  readonly poses: readonly Projector[];
  readonly layer: Layer;
  /** A presented card's lean from the frame's normal, radians (25°). */
  readonly stand: { readonly lean: number };
  readonly floors: Floors;
  readonly keepouts: readonly Keepout[];
  /** The screen a target may be in (the safe area), CSS px. */
  readonly safe: Rect;
  readonly captions: CaptionRoom | null;
  readonly growth: { readonly d: readonly number[] } | "fixed";
  readonly entry: EntryId;
  readonly paging: { readonly page: number } | null;
}

// ---- 1.2 cards, relations, acting -----------------------------------------------------------------------------------

/** The card's current types, non-exclusive: an animated Mutavault is a creature and a land. */
export interface TypeSet {
  readonly creature: boolean;
  readonly land: boolean;
  readonly artifact: boolean;
  readonly enchantment: boolean;
  readonly planeswalker: boolean;
  readonly battle: boolean;
}

export interface ArrCard {
  readonly id: CardId;
  readonly controller: SeatId;
  readonly owner: SeatId;
  readonly name: string;
  readonly cardKey: string;
  /** Identical to the eye but for tapped and summoning sick; includes the current types. */
  readonly lookKey: string;
  /** From the card's current type line, rebuilt every plan. */
  readonly types: TypeSet;
  readonly subtypes: readonly string[];
  readonly supertypes: { readonly legendary: boolean; readonly basic: boolean };
  readonly token: boolean;
  readonly commander: boolean;
  readonly copy: boolean;
  readonly faceDown: boolean;
  /** It makes mana (the catalog's `produces`, a Treasure, or a "{T}: Add" in its text). */
  readonly manaSource: boolean;
  readonly tapped: boolean;
  readonly sick: boolean;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly loyalty: number | null;
  readonly defense: number | null;
  readonly keywords: readonly string[];
  /** How many counters of any kind it carries. */
  readonly counters: number;
  readonly attachedTo: CardId | null;
  /** Its text binds other players. */
  readonly reach: "table" | "self";
  readonly manaValue: number;
  readonly produces: readonly string[];
}

export interface Relations {
  readonly combat: {
    readonly attacks: readonly { readonly attacker: CardId; readonly defender: { readonly seat: SeatId } | { readonly card: CardId } }[];
    readonly blocks: readonly { readonly blocker: CardId; readonly attacker: CardId }[];
    readonly wasBlocked: readonly CardId[];
  } | null;
  readonly homes: ReadonlyMap<CardId, { readonly container: ContainerId; readonly unit: UnitId; readonly slot: SlotRef }>;
}

export interface Acting {
  /** Acting now (fighting, aimed at): they leave their units and stand. */
  readonly involved: ReadonlySet<CardId>;
  /** Options of the decision up. */
  readonly offered: ReadonlySet<CardId>;
  /** Mine with something I could use while I hold priority (light only). */
  readonly usable: ReadonlySet<CardId>;
  readonly choosing: boolean;
}

export const NO_ACTING: Acting = { involved: new Set(), offered: new Set(), usable: new Set(), choosing: false };
export const NO_RELATIONS: Relations = { combat: null, homes: new Map() };

export interface Clock {
  readonly turn: number;
  readonly phase: Phase;
  readonly active: SeatId | null;
  /** Cards are in flight: places hold, nothing re-sorts or unfolds. */
  readonly settling: boolean;
}

export interface ArrangeInput {
  readonly container: Container;
  /** Any order: the output never depends on it. */
  readonly cards: readonly ArrCard[];
  readonly relations: Relations;
  readonly acting: Acting;
  readonly moment: Moment;
  readonly policy: Policy;
  readonly memory: ContainerMemory | null;
  readonly clock: Clock;
  /** Start the ladder at least this far (the composer's retry). */
  readonly minEdit?: number;
}

// ---- 1.3 the output -----------------------------------------------------------------------------------------------

/** A place: its row, the interval within the row, and the place in the interval counted centre-out. */
export interface SlotRef {
  readonly row: number;
  readonly interval: number;
  readonly place: number;
}

export interface Row {
  readonly tiers: readonly TierId[];
  /** Depth of the row's feet from the anchor edge. */
  readonly v: number;
  readonly posture: "stand" | "lie";
  /** The row's usable spans along `across`, disjoint, in order. */
  readonly intervals: readonly { readonly lo: number; readonly hi: number }[];
  /** How many of the row's narrowest slots fit. */
  readonly places: number;
}

export type UnitKind = "card" | "fan" | "stack" | "summary" | "formation";

/** What a unit holds, in the terms that matter: always present, whether or not anything is drawn (a closed set). */
export type UnitFacts =
  | { readonly kind: "card"; readonly card: CardId; readonly power: number | null }
  | { readonly kind: "stack"; readonly name: string; readonly count: number; readonly power: number }
  | {
      readonly kind: "fan";
      readonly count: number;
      readonly power: number;
      readonly keywords: readonly string[];
      readonly biggest: CardId | null;
      readonly tapped: number;
      readonly kinds: readonly ("creature" | "planeswalker" | "battle" | "artifact" | "enchantment" | "land")[];
    }
  | { readonly kind: "well"; readonly lands: number; readonly open: number; readonly produces: readonly string[]; readonly rocks: number }
  | { readonly kind: "summary"; readonly count: number; readonly power: number; readonly creatures: number }
  | { readonly kind: "formation"; readonly power: number; readonly blocked: number; readonly unblocked: number };

export type CaptionKind = "ready" | "tapped" | "works" | "lands" | "summary";
export type Emphasis = "forward" | "ease" | "down";

export interface CardPlace {
  readonly card: CardId;
  /** Its face's frame: the middle of its foot edge, its right and its up (unit vectors). */
  readonly foot: V3;
  readonly right: V3;
  readonly up: V3;
  readonly posture: "stand" | "lie" | "held";
  /** Tapped: a quarter turn in standing tiers, a notch elsewhere. */
  readonly turn: "none" | "notch" | "quarter";
  /** Its height in a stack (0 the bottom), for thickness. */
  readonly layer: number;
  /** Its face on screen. */
  readonly quad: Quad;
}

export interface ArrUnit {
  readonly id: UnitId;
  readonly key: UnitKey;
  readonly lineage: readonly UnitId[];
  readonly kind: UnitKind;
  readonly tier: TierId;
  readonly slot: SlotRef;
  /** In order; the first is on top (none for a summary of nothing). */
  readonly members: readonly CardId[];
  readonly top: CardId | null;
  readonly dressing: readonly CardId[];
  /** Every card drawn, bottom first. */
  readonly cards: readonly CardPlace[];
  /** A stack's count marker: where it lies on the surface and the room it owns there. */
  readonly marker: { readonly count: number; readonly at: V3; readonly room: Quad } | null;
  readonly facts: UnitFacts;
  readonly caption: { readonly kind: CaptionKind; readonly box: Quad } | null;
  /** Light only (§2.3). */
  readonly emphasis: Emphasis | null;
  readonly lit: readonly CardId[];
  readonly acting: boolean;
}

export type PaintItem =
  | { readonly kind: "card"; readonly unit: UnitId; readonly card: CardId }
  | { readonly kind: "marker"; readonly unit: UnitId };

export interface PickTarget {
  /** The unit id, or "card:<id>" for a member's own. */
  readonly id: TargetId;
  /** The drawn piece it moves with: the unit id. */
  readonly piece: UnitId;
  /** Where it is hit: its slot's reserved envelope on screen. */
  readonly region: Quad;
  /** Precedence: higher wins. */
  readonly order: number;
  /** The membership stamp: a tap whose stamp no longer matches does nothing. */
  readonly members: readonly CardId[];
  readonly action:
    | { readonly select: CardId }
    | { readonly open: { readonly role: ContainerRole; readonly from: UnitId | EntryId; readonly page: number } }
    | { readonly inspect: CardId }
    | { readonly seat: SeatId };
}

export type AttentionWhy = "threat" | "can-hurt-me" | "binds-me" | "offered" | "aimed" | "in-danger" | "answers";

export interface Attention {
  /** The unit hiding it (or the entry, past the last resort). */
  readonly unit: UnitId | EntryId;
  readonly cards: readonly CardId[];
  readonly why: AttentionWhy;
}

/** A rest container's summary, for the plate's icons and the plate focus's words. */
export interface SeatFacts {
  readonly creatures: number;
  readonly power: number;
  readonly flyingPower: number;
  readonly keywords: readonly string[];
  readonly lands: number;
  readonly open: number;
  readonly works: number;
}

export interface EditRecord {
  readonly index: number;
  readonly op: FoldStep["op"];
  readonly groups: readonly GroupKey[];
  /** Run, or skipped because the rows it frees already fit. */
  readonly ran: boolean;
}

export interface Arrangement {
  readonly container: ContainerId;
  readonly policy: string;
  readonly frame: SurfaceFrame;
  readonly step: number;
  /** The card mesh's scale: S_table on the table and nearer (§4). */
  readonly scale: number;
  readonly rows: readonly Row[];
  readonly units: readonly ArrUnit[];
  /** Cards and markers in total paint order, back first. */
  readonly paint: readonly PaintItem[];
  /** In pick precedence, highest first. */
  readonly targets: readonly PickTarget[];
  /** Derived from units, never trusted. */
  readonly home: ReadonlyMap<CardId, UnitId>;
  readonly pages: { readonly count: number; readonly current: number; readonly offeredOn: readonly number[] } | null;
  readonly attention: readonly Attention[];
  readonly seat: SeatFacts | null;
  readonly used: { readonly frame: Rect; readonly screen: Rect };
  readonly report: {
    readonly edits: readonly EditRecord[];
    readonly candidates: number;
    readonly audits: number;
    /** The policy's intent was rejected and `ready-tapped` stood in for this plan. */
    readonly policyInvalid: string | null;
    readonly violations: readonly ArrViolation[];
  };
  readonly memory: ContainerMemory;
}

export interface ArrViolation {
  readonly rule: "floor" | "tap-patch" | "place" | "covers-name" | "covers-foot" | "off-frame";
  readonly unit: UnitId;
  readonly measured: number;
  readonly limit: number;
}

// ---- 1.5 overflow ---------------------------------------------------------------------------------------------------

export interface Overflow {
  readonly reason: "container" | "actors" | "offered" | "page" | "space";
  readonly cards: readonly CardId[];
  readonly ask:
    | { readonly kind: "region"; readonly minW: number; readonly minD: number }
    | { readonly kind: "focus"; readonly role: ContainerRole }
    | { readonly kind: "entry" };
}

export type ArrangeResult =
  | { readonly fit: Arrangement; readonly overflow: null }
  | { readonly fit: Arrangement; readonly overflow: Overflow };

// ---- 2.1 the policy -------------------------------------------------------------------------------------------------

export interface Group {
  readonly key: GroupKey;
  /** In order; the first is the default top. */
  readonly members: readonly CardId[];
  /** Auras and Equipment on its members: they ride with the unit and never stand alone. */
  readonly dressing: readonly CardId[];
  /** Its members are identical to the eye (copies): it may stack. */
  readonly copies: boolean;
}

export interface TierSpec {
  readonly id: TierId;
  readonly posture: "stand" | "lie";
  /** Which row of the container it takes (0 nearest the anchor edge). Tiers sharing a row share it in `fixed` order. */
  readonly row: number;
  /** Units in a fixed order across (the leaf's back: rest, works, lands), by tier. */
  readonly order?: "fixed";
  /** It may hold stacks: reserve the count strip in front of its row. */
  readonly markers?: boolean;
}

/** Which groups a fold step takes. */
export type Selector =
  | { readonly tier: TierId; readonly copies?: boolean; readonly tokens?: boolean; readonly spent?: boolean; readonly creatures?: boolean }
  | { readonly all: true };

export type FoldStep =
  | { readonly op: "split-spent"; readonly where: Selector; readonly to: TierId }
  | { readonly op: "stack"; readonly where: Selector }
  | { readonly op: "fan"; readonly where: Selector; readonly show: number }
  | { readonly op: "demote"; readonly where: Selector; readonly to: TierId }
  | { readonly op: "summary"; readonly where: Selector };

/** What a policy sees beyond the cards: who looks, whose they are, what acts. Never the moment, but where it says so. */
export interface PolicyCtx {
  readonly viewer: SeatId;
  readonly owner: SeatId | null;
  readonly mine: boolean;
  readonly cards: ReadonlyMap<CardId, ArrCard>;
  readonly acting: Acting;
  readonly clock: Clock;
}

/** A unit before it has a place: what `facts`, `emphasis` and `seat` read. */
export interface DraftUnit {
  readonly key: UnitKey;
  readonly kind: UnitKind;
  readonly tier: TierId;
  readonly members: readonly CardId[];
  readonly dressing: readonly CardId[];
  readonly groups: readonly GroupKey[];
}

export interface Formation {
  readonly key: GroupKey;
  readonly parts: readonly { readonly group: GroupKey; readonly at: "far" | "near" | "after" }[];
}

export interface Policy {
  readonly id: string;
  readonly tiers: readonly TierSpec[];
  /** Every card in exactly one group, as member or dressing. */
  group(cards: readonly ArrCard[], ctx: PolicyCtx): readonly Group[];
  /** At rest; never reads the moment. */
  importance(g: Group, ctx: PolicyCtx): number;
  tier(g: Group, ctx: PolicyCtx): TierId;
  /** Stands; validated against §2.2's constraints. */
  presented(g: Group, ctx: PolicyCtx): boolean;
  top(g: Group, prevTop: CardId | null, ctx: PolicyCtx): CardId;
  readonly ladder: readonly FoldStep[];
  /** If hidden, cue it. */
  matters(c: ArrCard, moment: Moment, ctx: PolicyCtx): AttentionWhy | null;
  facts(u: DraftUnit, ctx: PolicyCtx): UnitFacts;
  seat?(units: readonly DraftUnit[], ctx: PolicyCtx): SeatFacts;
  emphasis(u: DraftUnit, moment: Moment, ctx: PolicyCtx): { readonly emphasis: Emphasis | null; readonly lit: readonly CardId[] };
  readonly acting: "in-place" | "away";
  /** Whether the front re-deals by rank now (§2.4's tidy), given the last tidy. */
  tidy(clock: Clock, last: PolicyMemory["tidy"] | null, rankingChanged: boolean): boolean;
  readonly promote: (incumbent: number, challenger: number) => boolean;
}

// ---- 3 memory -------------------------------------------------------------------------------------------------------

export interface PolicyMemory {
  readonly step: number;
  readonly page: number;
  readonly slots: Readonly<Record<UnitKey, SlotRef>>;
  readonly lineage: Readonly<Record<UnitKey, UnitId>>;
  readonly tops: Readonly<Record<UnitKey, CardId>>;
  /** The tier each unit stood in at the last plan: a newcomer and a retype are told apart from a stayer. */
  readonly tiers: Readonly<Record<UnitKey, TierId>>;
  readonly edits: number;
  readonly tidy: { readonly turn: number; readonly phase: Phase; readonly ranking: readonly UnitKey[] } | null;
}

/** Plain JSON, versioned. Places and keys, never classifications. */
export interface ContainerMemory {
  readonly v: 2;
  readonly container: ContainerId;
  /** Survives a policy switch. */
  readonly selection: { readonly policy: string; readonly since: number };
  readonly arrivals: { readonly next: number; readonly seq: Readonly<Record<string, number>> };
  /** Each policy's own, so switching back restores places. */
  readonly policies: Readonly<Record<string, PolicyMemory>>;
}
