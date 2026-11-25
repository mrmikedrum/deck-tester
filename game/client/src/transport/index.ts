// transport: the client's edge to the bridge (deckmaster/game.py). See docs/game-client-architecture.md.
//
//   Transport                   the interface: an event source; start/stop; ack; answer; newGame; decks
//   longPollTransport(opts)     production: long polls and POSTs on relative api/ URLs
//   scriptedTransport(opts)     tests, the workbench and recordings: envelopes and replies fed by a script
//   clientLogSender(opts)       batched, bounded reports to api/clientlog
//
// Imports only protocol and platform; time only through platform.
export type { Ack, AnswerOutcome, AnswerToken, Continuity, NewGameRequest, Transport, TransportEvent } from "./types";
export { classify, rewound } from "./continuity";
export { longPollTransport } from "./longpoll";
export type { LongPollOptions } from "./longpoll";
export { scriptedTransport } from "./scripted";
export type { ScriptedOptions, ScriptedTransport, SentAnswer } from "./scripted";
export { clientLogSender, fit, fitBytes } from "./clientlog";
export type { ClientLog, ClientLogOptions } from "./clientlog";
export type { Fetch } from "./http";
