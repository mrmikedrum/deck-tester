// protocol: the contract between the bridge (deckmaster/game.py) and this client. The source of truth for the wire's
// shapes; docs/architecture.md ("The game's protocol") states the rules, tests/fixtures/protocol holds real samples.
//
//   decodeSnapshot(json)        a GET /api/view body -> Snapshot (each decision with its key), or why not
//   answerRequest(d, answer)    the POST /api/answer body for a decision
//   answerProblem(d, picks)     the engine's own check of an answer, before sending it
//   decodeAnswerReply(json)     the POST /api/answer reply
//   ClientLogRequest            the POST /api/clientlog body, with the bridge's limits
//
// Pure: no DOM, no clock, imports nothing from the app.
export { decodeSnapshot, decodeAnswerReply } from "./decode";
export type {
  AnswerReply,
  AnswerStatus,
  AttackDecision,
  AttackRef,
  BlockDecision,
  BlockRef,
  Card,
  CastCost,
  ChoiceRef,
  ChooseDecision,
  Combat,
  ConfirmDecision,
  Decision,
  DecodeError,
  DecodeIssue,
  LogEntry,
  ModeDecision,
  MulliganDecision,
  NumberDecision,
  OrderDecision,
  PayDecision,
  PlayDecision,
  Player,
  PlayRef,
  Result,
  Snapshot,
  StackItem,
  TargetsDecision,
  UnknownDecision,
  View,
} from "./decode";
export type { CardId, DecisionId, DecisionKey, KnownKind, PlayerName, StackId } from "./schema";
export { KNOWN_KINDS, KNOWN_PHASES, STATES } from "./schema";
export { answerProblem, answerRequest } from "./answer";
export type { Answer, AnswerRequest } from "./answer";
export { CLIENT_LOG_LIMITS } from "./clientlog";
export type { ClientLogEntry, ClientLogRequest } from "./clientlog";
export type { AnswerOutcome, AnswerToken, CommitId, Continuity, Stamp, StopId } from "./client";
