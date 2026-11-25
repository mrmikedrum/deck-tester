// play: the decision controller. See docs/game-client-architecture.md ("play").
//
//   initial                 the state before any snapshot
//   step(state, event)      -> {state, effects}: the only way the state changes; effects are data (send an answer,
//                              schedule or cancel a deadline, toast, open the inspector, tell the app an act is its own)
//   present(state)          -> {board, controls}: marks and combat lanes for the scene, prompt and sheet for the chrome
//   cardsWanted(model, d)   -> the card names a decision is about: the host has their data before it offers it
//
// Pure: no DOM, no three.js, no platform, no clock (time arrives in events); imports protocol, model and layout.
import { INITIAL, seal } from "./state";
import type { State } from "./types";

export const initial: State = seal(INITIAL);
export { step } from "./step";
export { present } from "./present";
export { AUTO_PASS_MS } from "./auto";
export { HAND_PLAY_DY } from "./kinds/play";
export { cardsWanted } from "./needs";
export type * from "./types";
