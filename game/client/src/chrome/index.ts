// chrome: the HTML layer. See docs/game-client-architecture.md ("chrome: the HTML layer").
//
//   chromeRenderer(root, {emit, wake})  -> {show(view, now) -> {active, fault}, dispose()}: called once per commit
//   ChromeView                          what it draws: play's Controls, the hand, the reserve, the toast, the viewport
//   ChromeIntent                        what it sends: acts stamped with the stop and commit they were drawn for
//
// Components are pure projections of the view; the hand's physics and gestures live in chrome/frame/, stepped by the
// commit's time.
export { chromeRenderer, canvasMeasure } from "./renderer";
export type { ChromeRenderer } from "./renderer";
export type {
  CardLook,
  CardTile,
  ChipView,
  ChromeIntent,
  ChromeLayer,
  ChromePorts,
  ChromeReport,
  ChromeView,
  GameRequest,
  HandCard,
  HandSheetView,
  HandView,
  InspectorView,
  LayerView,
  MenuView,
  MulliganView,
  SiftView,
  Order,
  StackRow,
} from "./view";
export { CARD_ASPECT, HELD, cardSize, fan, labelFont } from "./fan";
export { Waiting } from "./waiting";
