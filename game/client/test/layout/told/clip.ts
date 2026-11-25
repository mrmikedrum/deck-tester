/// <reference types="node" />
// The reels' clips as models: a clip's envelope at a beat, decoded with the clip's own card data, as the new entry sees it.
import { createRequire } from "node:module";
import { decodeCatalog, modelOf, seatId } from "../../../src/model";
import type { TableModel } from "../../../src/model";
import { decodeSnapshot } from "../../../src/protocol";

interface Clip {
  readonly name: string;
  readonly liveNew: Record<string, unknown>;
  readonly catalogNew: Record<string, unknown>;
  readonly beats: readonly { readonly label: string; readonly new?: { readonly push?: Record<string, unknown> } }[];
}

const clips = (): readonly Clip[] => createRequire(import.meta.url)("../../../../tools/clips.js") as Clip[];

/** The envelope a clip shows at a beat ("first" for the one it opens on), with its decision. */
export function clipEnvelope(name: string, beat: number | "first"): { env: Record<string, unknown>; clip: Clip } {
  const clip = clips().find((c) => c.name === name);
  if (!clip) throw new Error(`no clip ${name}`);
  const env = beat === "first" ? clip.liveNew : clip.beats[beat]?.new?.push;
  if (!env) throw new Error(`${name} beat ${beat}: no envelope`);
  return { env, clip };
}

/** The table a clip shows at a beat, as I (You) see it. */
export function clipModel(name: string, beat: number | "first"): TableModel {
  const { env, clip } = clipEnvelope(name, beat);
  const snap = decodeSnapshot(env);
  if (!snap.ok) throw new Error(snap.error.summary);
  const m = modelOf(snap.value, decodeCatalog(clip.catalogNew), { perspective: seatId("You"), seat: seatId("You"), mayAnswer: true });
  if (!m) throw new Error(`${name} beat ${beat}: no model`);
  return m;
}

/** The game clip's board at a turn (4, 6, 9, 12 or 15). */
export const gameAt = (turn: 4 | 6 | 9 | 12 | 15): TableModel => clipModel("game", [4, 6, 9, 12, 15].indexOf(turn));
