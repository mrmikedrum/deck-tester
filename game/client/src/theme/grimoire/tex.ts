// URLs of the baked Grimoire surfaces, used by the scene's asset loader:
// the painters take image sources, never urls.
import bronze from "./tex/bronze.jpg?url";
import bronzeClean from "./tex/bronze-clean.jpg?url";
import tome from "./tex/tome.jpg?url";
import tomeNormal from "./tex/tome-n.png?url";
import vellum from "./tex/vellum.jpg?url";
import frameB from "./tex/frame-B.jpg?url";
import frameC from "./tex/frame-C.jpg?url";
import frameG from "./tex/frame-G.jpg?url";
import frameL from "./tex/frame-L.jpg?url";
import frameM from "./tex/frame-M.jpg?url";
import frameR from "./tex/frame-R.jpg?url";
import frameT from "./tex/frame-T.jpg?url";
import frameU from "./tex/frame-U.jpg?url";
import frameW from "./tex/frame-W.jpg?url";
import type { FrameKey } from "./surfaces";

export const TEXTURE_URLS = { vellum, bronze, bronzeClean, tome, tomeNormal } as const;
export const FRAME_URLS: Readonly<Record<FrameKey, string>> = {
  W: frameW,
  U: frameU,
  B: frameB,
  R: frameR,
  G: frameG,
  C: frameC,
  M: frameM,
  L: frameL,
  T: frameT,
};
