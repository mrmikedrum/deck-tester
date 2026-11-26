// The wire: what GET /api/view sends (deckmaster/game.py's envelope around the engine's `view` reply,
// engine/src/main/java/deckmaster/engine/Session.java `view()`, Decision.java, ManualController.java).
//
// Policy. A field is required when its absence or a wrong type would make the client draw or send something
// wrong: ids, names, zones, the stack, a decision's options, bounds and refs. Everything else is optional and
// normalised to a default (false, 0, [], {}, null), so the model never tests for undefined. Unknown keys are
// dropped, unknown phases pass, and an unknown decision kind decodes as `kind: "unknown"` with its `wireKind`.
import * as v from "valibot";
import { decisionKey } from "./key";

// ---- Ids -------------------------------------------------------------------------------------------------------

/** A Forge card id: the same card keeps it across zones while Forge keeps the object (face-down cards included). */
export type CardId = number & v.Brand<"CardId">;
/** A stack item's id: Forge's spell-ability instance, not the card it came from. */
export type StackId = number & v.Brand<"StackId">;
/** A player's name as Forge knows it ("You" for the person's seat). Names are the only player ids on the wire. */
export type PlayerName = string & v.Brand<"PlayerName">;
/** A parked decision's number, from the engine: strictly increasing per seat, never reused. An answer names it, and
 * the engine refuses an answer whose decision is no longer parked. The client's StopId comes from it. */
export type DecisionId = number & v.Brand<"DecisionId">;
/** The bridge's older identity for a decision, computed exactly as game.py's `key()` (see key.ts): kept for the
 * old client, and not unique (the same question asked twice has the same key). */
export type DecisionKey = string & v.Brand<"DecisionKey">;

const int = v.pipe(v.number(), v.integer());
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const flag = v.optional(v.boolean(), false);
const cardId = v.pipe(v.number(), v.integer(), v.brand("CardId"));
const stackId = v.pipe(v.number(), v.integer(), v.brand("StackId"));
const playerName = v.pipe(v.string(), v.brand("PlayerName"));
const decisionKeyText = v.pipe(v.string(), v.brand("DecisionKey"));
const decisionId = v.pipe(v.number(), v.integer(), v.minValue(1), v.brand("DecisionId"));
/** A card or a player: targets, defenders. Numbers are card ids, strings player names. */
const cardOrPlayer = v.union([cardId, playerName]);
const counts = v.optional(v.record(v.string(), count), () => ({}));

// ---- The view ----------------------------------------------------------------------------------------------------

export const CardSchema = v.object({
  id: cardId,
  /** "" for a face-down card. */
  name: v.string(),
  owner: playerName,
  controller: playerName,
  type: v.string(),
  /** Forge's short string: bare generic, braced colours ("1 {G} {G}", "X {R}"); null for no cost (lands). */
  cost: v.nullish(v.string(), null),
  power: v.nullish(int, null),
  toughness: v.nullish(int, null),
  loyalty: v.nullish(int, null),
  faceDown: flag,
  sick: flag,
  tapped: flag,
  token: flag,
  commander: flag,
  copy: flag,
  attachedTo: v.nullish(cardId, null),
  /** Counter name ("+1/+1", "LOYALTY"...) to count. */
  counters: counts,
  keywords: v.optional(v.array(v.string()), () => []),
  /** Abilities as they are now on the battlefield, Oracle text elsewhere; null when face down or blank. */
  text: v.nullish(v.string(), null),
});

const cards = v.array(CardSchema);

export const PlayerSchema = v.object({
  name: playerName,
  life: int,
  /** Floating mana: colour letter ("W", "U", "B", "R", "G", "C") to amount. */
  manaPool: counts,
  poison: v.optional(count, 0),
  monarch: flag,
  lost: flag,
  /** Only the viewer's own hand; null for everyone else. */
  hand: v.nullish(cards, null),
  /** Everyone else's hand size; null for the viewer. */
  handCount: v.nullish(count, null),
  library: count,
  battlefield: cards,
  command: cards,
  graveyard: cards,
  exile: cards,
  /** Commander damage taken, keyed by the commander's card id as a string. */
  commanderDamage: counts,
});

export const StackItemSchema = v.object({
  id: stackId,
  /** The card the item came from, drawn as a card (a spell's own card, an ability's source). */
  source: v.nullish(CardSchema, null),
  controller: v.nullish(playerName, null),
  spell: v.boolean(),
  text: v.string(),
  /** Every target of the item and its sub-abilities: card ids and player names. A card may be gone from the game (a
   * token exiled while the item resolves): its id is then in no zone, and `text` still names it ("Soldier Token (868)"). */
  targets: v.optional(v.array(cardOrPlayer), () => []),
});

export const CombatSchema = v.object({
  /** Forge's ordinal of this combat in its turn (1 for the first); null from an engine that does not say. */
  ordinal: v.nullish(count, null),
  /** defender: a player's name, a planeswalker's or battle's card id, or null. blocked: Forge's verdict (it stays true
   *  when the blockers leave, and turns false when an effect unblocks); null from an engine that does not say. */
  attackers: v.array(v.object({ id: cardId, defender: v.nullish(cardOrPlayer, null), blocked: v.nullish(v.boolean(), null) })),
  /** One entry per blocker and attacker it blocks. */
  blockers: v.array(v.object({ id: cardId, blocking: cardId })),
  /** The combat damage dealt in this combat so far, after prevention, summed by source and target (a player's name or a
   *  card id) over its damage steps. Empty before damage, and from an engine that does not say. */
  damage: v.optional(v.array(v.object({ source: cardId, target: cardOrPlayer, amount: count })), () => []),
});

export const LogEntrySchema = v.object({
  /** The entry's index in Forge's whole game log: increasing, with gaps (phase and mana entries are dropped). */
  i: count,
  type: v.string(),
  text: v.string(),
  card: v.nullish(cardId, null),
});

/** Forge's phase names (PhaseType) and "setup" before the first turn. Others may appear and are allowed. */
export const KNOWN_PHASES = [
  "setup",
  "UNTAP",
  "UPKEEP",
  "DRAW",
  "MAIN1",
  "COMBAT_BEGIN",
  "COMBAT_DECLARE_ATTACKERS",
  "COMBAT_DECLARE_BLOCKERS",
  "COMBAT_FIRST_STRIKE_DAMAGE",
  "COMBAT_DAMAGE",
  "COMBAT_END",
  "MAIN2",
  "END_OF_TURN",
  "CLEANUP",
] as const;

export const ViewSchema = v.object({
  /** Forge's global turn number (every player's turn counts), not the label's per-player round. */
  turn: count,
  /** A display label: "T3 main1" on my turn, "T3 Dack main1" on another's. */
  label: v.string(),
  active: v.nullish(playerName, null),
  phase: v.string(),
  priority: v.nullish(playerName, null),
  /** The viewer. After the viewer loses, `players` no longer lists them. */
  me: playerName,
  /** Turn order from the viewer while they are in the game. Players who have lost are gone. */
  players: v.array(PlayerSchema),
  /** Top of the stack first. */
  stack: v.array(StackItemSchema),
  combat: v.nullish(CombatSchema, null),
  /** The last entries of Forge's game log (up to 60), oldest first. */
  log: v.optional(v.array(LogEntrySchema), () => []),
  over: flag,
});

const isEmptyObject = (x: unknown): boolean =>
  typeof x === "object" && x !== null && !Array.isArray(x) && Object.keys(x).length === 0;
const emptyView = v.pipe(
  v.object({}),
  v.transform(() => null),
);
/** The engine sends `{}` before its game exists: that decodes to null, like a missing view. */
const viewOrEmpty = v.nullish(
  v.lazy((input) => (isEmptyObject(input) ? emptyView : ViewSchema)),
  null,
);

// ---- Decisions ---------------------------------------------------------------------------------------------------

/** A play option's ref. The pass option's is all empty; a mana ability has `mana`. Refs can repeat (a morph's face-down cast). */
export const PlayRefSchema = v.object({ card: v.nullish(cardId, null), spell: flag, mana: flag });
/** pay, targets, choose: what the option points at, when it is a card, a player or a card name; all null otherwise (a
 * colour, a spell). A choose may offer hidden cards (a library search): their ids are in no zone of the view. */
export const ChoiceRefSchema = v.object({
  card: v.nullish(cardId, null),
  player: v.nullish(playerName, null),
  name: v.nullish(v.string(), null),
});
/** pay: the mana ability's source; `repeats` when its cost does not tap it, so the same option may be picked again (one
 *  activation each: Workhorse's counters). */
export const PayRefSchema = v.object({ ...ChoiceRefSchema.entries, repeats: flag });
export const AttackRefSchema = v.object({ card: cardId, to: cardOrPlayer });
export const BlockRefSchema = v.object({ card: cardId, blocks: cardId });

const common = {
  id: decisionId,
  /** turnLabel() when asked: "T3 main1" or "T3 Dack main1". */
  turn: v.string(),
  prompt: v.optional(v.string(), ""),
  /** Labels, answered by 1-based position. Empty for `number`. Labels can repeat. */
  options: v.array(v.string()),
  /** Each option's full text, when the engine sends it. */
  details: v.nullish(v.array(v.string()), null),
  /** Choices: how many options to pick. number: the range of the value. */
  min: int,
  max: int,
  /** Whether an option may be picked more than once. */
  repeat: v.boolean(),
  /** Whether it is asked during the viewer's own turn (not whether it is the viewer's to answer: every decision is). */
  mine: flag,
};

interface Lists {
  readonly kind: string;
  readonly turn: string;
  readonly prompt: string;
  readonly options: readonly string[];
  readonly details: readonly string[] | null;
  readonly refs?: readonly unknown[] | null;
  readonly min: number;
  readonly max: number;
  readonly repeat: boolean;
}

/** Problems a client would act on wrongly: refs or details misaligned with options, impossible bounds. */
function inconsistency(d: Lists): string | null {
  if (d.details && d.details.length !== d.options.length)
    return `details has ${d.details.length} entries for ${d.options.length} options`;
  if (d.refs && d.refs.length !== d.options.length)
    return `refs has ${d.refs.length} entries for ${d.options.length} options`;
  if (d.min > d.max) return `min ${d.min} is above max ${d.max}`;
  if (d.options.length > 0 && d.min < 0) return `min ${d.min} is negative`;
  if (d.options.length > 0 && !d.repeat && d.max > d.options.length)
    return `max ${d.max} is above the ${d.options.length} options of a choice without repeats`;
  return null;
}

/**
 * Checks a decision's consistency, then stamps its key, and a `gen` the envelope fills in: the game it was asked in
 * (decision ids restart with each engine session, so an answer names the game too).
 */
function finish<S extends v.GenericSchema<unknown, Lists>>(schema: S) {
  return v.pipe(
    schema,
    v.rawCheck<v.InferOutput<S>>(({ dataset, addIssue }) => {
      if (!dataset.typed) return;
      const problem = inconsistency(dataset.value);
      if (problem) addIssue({ message: problem });
    }),
    v.transform((d: v.InferOutput<S>) => ({ ...d, key: decisionKey(d), gen: null as number | null })),
  );
}

export const MulliganSchema = finish(v.object({ kind: v.literal("mulligan"), ...common }));
/** A value between min and max; options is empty and the answer is [value]. */
export const NumberSchema = finish(v.object({ kind: v.literal("number"), ...common }));
export const ModeSchema = finish(v.object({ kind: v.literal("mode"), ...common }));
/** Options are ["yes", "no"]. */
export const ConfirmSchema = finish(v.object({ kind: v.literal("confirm"), ...common }));
/** Put every option in order: the answer lists all of them. */
export const OrderSchema = finish(v.object({ kind: v.literal("order"), ...common }));
/** Option 1 is "pass". */
export const PlaySchema = finish(v.object({ kind: v.literal("play"), ...common, refs: v.array(PlayRefSchema) }));
export const PaySchema = finish(v.object({ kind: v.literal("pay"), ...common, refs: v.array(PayRefSchema) }));
export const TargetsSchema = finish(
  v.object({ kind: v.literal("targets"), ...common, refs: v.array(ChoiceRefSchema) }),
);
const EMPTY_REF = { card: null, player: null, name: null } as const;
/**
 * Forge asks some choices by label only (a colour, a creature type, a yes-or-no question): the engine sends no refs
 * (Gson leaves the null list out), and each option gets an empty ref. Refs that are sent must still line up.
 */
export const ChooseSchema = finish(
  v.pipe(
    v.object({ kind: v.literal("choose"), ...common, refs: v.nullish(v.array(ChoiceRefSchema)) }),
    v.transform(({ refs, ...d }) => ({ ...d, refs: refs ?? d.options.map(() => ({ ...EMPTY_REF })) })),
  ),
);
/** One option per attacker and defender it may attack. */
export const AttackSchema = finish(v.object({ kind: v.literal("attack"), ...common, refs: v.array(AttackRefSchema) }));
/** One option per blocker and attacker it may block. */
export const BlockSchema = finish(v.object({ kind: v.literal("block"), ...common, refs: v.array(BlockRefSchema) }));

/** A kind this client does not know: shown by its labels, answered by number, keyed by its wire kind. */
export const UnknownDecisionSchema = v.pipe(
  finish(v.object({ kind: v.string(), ...common, refs: v.nullish(v.array(v.record(v.string(), v.unknown())), null) })),
  v.transform(({ kind: wireKind, ...rest }) => ({ ...rest, kind: "unknown" as const, wireKind })),
);

const KINDS = {
  mulligan: MulliganSchema,
  number: NumberSchema,
  mode: ModeSchema,
  confirm: ConfirmSchema,
  order: OrderSchema,
  play: PlaySchema,
  pay: PaySchema,
  targets: TargetsSchema,
  choose: ChooseSchema,
  attack: AttackSchema,
  block: BlockSchema,
} as const;

export type KnownKind = keyof typeof KINDS;
export const KNOWN_KINDS = Object.keys(KINDS) as readonly KnownKind[];

const isKnownKind = (k: unknown): k is KnownKind => typeof k === "string" && Object.hasOwn(KINDS, k);

export const DecisionSchema = v.lazy((input) => {
  const k = typeof input === "object" && input !== null ? (input as { kind?: unknown }).kind : undefined;
  return isKnownKind(k) ? KINDS[k] : UnknownDecisionSchema;
});

// ---- The envelope ------------------------------------------------------------------------------------------------

export const STATES = ["no game", "starting", "playing", "over", "error"] as const;

/** What happened to the last answer the bridge forwarded to the engine. */
export const AnswerStatusSchema = v.object({
  key: decisionKeyText,
  /** The decision's id; null when the engine sent none. */
  id: v.nullish(decisionId, null),
  /** The bridge's number for this forwarded answer: a later answer (in this game or the next) has a higher one, so
   * a client can tell its own answer's status (the reply carries the same number) from a later one's. Restarts with
   * the bridge; absent from a bridge that predates it. */
  attempt: v.optional(count),
  state: v.picklist(["working", "applied", "refused"]),
  /** Why the engine refused it. */
  error: v.nullish(v.string(), null),
});

const SnapshotFields = v.object({
  state: v.picklist(STATES),
  /** The game's generation: a new game, a new gen. Null before the first game and on a failed start. */
  gen: v.nullish(count, null),
  /** The bridge's version of this snapshot: the long poll's cursor. Goes backwards when the bridge restarts. */
  v: count,
  /** The bridge's last error (a failed start, an engine that stopped answering), alongside whatever state. */
  error: v.nullish(v.string(), null),
  /** The client build the bridge serves (dist/build.json); null when it has none. */
  build: v.nullish(v.string(), null),
  answer: v.nullish(AnswerStatusSchema, null),
  view: viewOrEmpty,
  decision: v.nullish(DecisionSchema, null),
  /** The engine's result line ("over: Atraxa won") once the game ends. */
  over: v.nullish(v.string(), null),
  /** Seat name to who pilots it ("human", "jev + advisor", "forge ai"). */
  pilots: v.optional(v.record(v.string(), v.string()), () => ({})),
});

/** The envelope, its decision stamped with the envelope's gen. */
export const SnapshotSchema = v.pipe(
  SnapshotFields,
  v.transform((s) => (s.decision ? { ...s, decision: { ...s.decision, gen: s.gen } } : s)),
);

/** POST /api/answer's reply. `attempt`, once the bridge forwarded the answer: the number its answer status carries. */
export const AnswerReplySchema = v.variant("ok", [
  v.object({ ok: v.literal(true), attempt: v.optional(count) }),
  v.object({ ok: v.literal(false), error: v.optional(v.string(), "refused"), attempt: v.optional(count) }),
]);
