// model: the table as the client sees it. See docs/game-client-architecture.md ("model").
//
//   modelOf(snap, catalog, viewer, commanders?)   a decoded snapshot -> TableModel (null before a game); the last
//                                    model's commanders of the same game keep a commander out of sight on its plate
//   decodeCatalog(json, base)        /api/cards replies -> CardCatalog, tolerantly
//   diff(prev, next, seq)            two models -> ChangeSet (atomic changes, grouped into moments, in order)
//   predicates and readings          how a card looks and how a spell reads (never what is legal)
//
// Pure: no DOM, no clock, no random; imports only protocol.
export type { SeatId, Zone, Phase, Keyword, Target } from "./ids";
export { seatId, isCardTarget, ZONES } from "./ids";
export type { CardCatalog, CatalogEntry, CatalogFace } from "./catalog";
export { decodeCatalog, decodeEntry, EMPTY_CATALOG } from "./catalog";
export type { Card, CardFace } from "./card";
export { FACE_DOWN } from "./card";
export type { Attack, Block, Combat, CommanderMemory, Seat, StackItem, TableModel, Viewer } from "./table";
export { modelOf, playerViewer } from "./table";
export * from "./predicates";
export * from "./readings";
export type { Back, Change, ChangeType, MoveKind, PopKind, SetAside } from "./delta/changes";
export type { Cause, CounterDetail, MomentDetail, MomentKind, ReadingId } from "./delta/moments";
export { ROWS } from "./delta/moments";
export type { ChangeSet, Moment } from "./delta";
export { diff } from "./delta";
