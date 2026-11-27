import * as v from "valibot";
import {
  AnswerReplySchema,
  AttackSchema,
  BlockSchema,
  ChooseSchema,
  ConfirmSchema,
  MulliganSchema,
  ModeSchema,
  NumberSchema,
  OrderSchema,
  PaySchema,
  PlaySchema,
  SnapshotSchema,
  TargetsSchema,
  UnknownDecisionSchema,
} from "./schema";
import type {
  AnswerStatusSchema,
  AttackRefSchema,
  BlockRefSchema,
  CardSchema,
  ChoiceRefSchema,
  CombatSchema,
  LogEntrySchema,
  PlayerSchema,
  PlayRefSchema,
  StackItemSchema,
  ViewSchema,
} from "./schema";

type DeepReadonly<T> = T extends string | number | boolean | null | undefined
  ? T // branded primitives stay as they are
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;
type Out<S extends v.GenericSchema> = DeepReadonly<v.InferOutput<S>>;

export type Card = Out<typeof CardSchema>;
export type CastCost = NonNullable<Card["castCost"]>;
export type Player = Out<typeof PlayerSchema>;
export type StackItem = Out<typeof StackItemSchema>;
export type Combat = Out<typeof CombatSchema>;
export type LogEntry = Out<typeof LogEntrySchema>;
export type View = Out<typeof ViewSchema>;
export type PlayRef = Out<typeof PlayRefSchema>;
export type ChoiceRef = Out<typeof ChoiceRefSchema>;
export type AttackRef = Out<typeof AttackRefSchema>;
export type BlockRef = Out<typeof BlockRefSchema>;
export type AnswerStatus = Out<typeof AnswerStatusSchema>;

export type MulliganDecision = Out<typeof MulliganSchema>;
export type NumberDecision = Out<typeof NumberSchema>;
export type ModeDecision = Out<typeof ModeSchema>;
export type ConfirmDecision = Out<typeof ConfirmSchema>;
export type OrderDecision = Out<typeof OrderSchema>;
export type PlayDecision = Out<typeof PlaySchema>;
export type PayDecision = Out<typeof PaySchema>;
export type TargetsDecision = Out<typeof TargetsSchema>;
export type ChooseDecision = Out<typeof ChooseSchema>;
export type AttackDecision = Out<typeof AttackSchema>;
export type BlockDecision = Out<typeof BlockSchema>;
export type UnknownDecision = Out<typeof UnknownDecisionSchema>;
/** Every decision, by `kind`; each carries its `key`. */
export type Decision =
  | MulliganDecision
  | NumberDecision
  | ModeDecision
  | ConfirmDecision
  | OrderDecision
  | PlayDecision
  | PayDecision
  | TargetsDecision
  | ChooseDecision
  | AttackDecision
  | BlockDecision
  | UnknownDecision;

/** One GET /api/view reply, decoded. */
export type Snapshot = Omit<Out<typeof SnapshotSchema>, "decision"> & { readonly decision: Decision | null };
export type AnswerReply = Out<typeof AnswerReplySchema>;

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export interface DecodeIssue {
  /** Where, as a dot path ("view.players.0.battlefield.3.id"), or "" for the whole value. */
  readonly path: string;
  readonly message: string;
}

export interface DecodeError {
  /** One line naming the first few problems, for the client log. */
  readonly summary: string;
  readonly issues: readonly DecodeIssue[];
}

function decode<S extends v.GenericSchema>(schema: S, json: unknown): Result<Out<S>, DecodeError> {
  const r = v.safeParse(schema, json);
  if (r.success) return { ok: true, value: r.output as Out<S> };
  const issues = r.issues.map((i) => ({ path: v.getDotPath(i) ?? "", message: i.message }));
  const shown = issues.slice(0, 3).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
  const more = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";
  return { ok: false, error: { summary: shown.join("; ") + more, issues } };
}

/** Decodes a parsed GET /api/view body. Never throws. */
export function decodeSnapshot(json: unknown): Result<Snapshot, DecodeError> {
  return decode(SnapshotSchema, json) as Result<Snapshot, DecodeError>;
}

/** Decodes a parsed POST /api/answer reply. */
export function decodeAnswerReply(json: unknown): Result<AnswerReply, DecodeError> {
  return decode(AnswerReplySchema, json);
}
