// An actor: one piece the stage draws, across frames. The stage's reconciler owns the set of actors (creates, re-keys,
// retargets, folds and drops them); `Membership` alone writes what each shows; flights only read them. Pure.
import type { Card, TableModel } from "../../model";
import type { CardId } from "../../protocol";
import type { FaceSpec } from "../../theme";
import type { Actor } from "./animator";
import { LOOK } from "./types";
import type { Piece, Sample } from "./types";

export interface ActorState {
  id: string;
  piece: Piece;
  readonly actor: Actor;
  /** No longer described: it shows only cards still waiting their turn to leave it. */
  remnant: boolean;
  /** Folding into this piece: gone when it gets there. */
  into: string | null;
  intoEnd: number;
  /** What it shows now (written by `Membership` only). */
  shown: CardId[];
  /** Its face and the face's key, kept while the card (or the kept face), its mark and the model are the same. */
  face?: FaceMemo;
}

export interface FaceMemo {
  readonly src: Card | FaceSpec;
  readonly mark: Piece["mark"];
  readonly model: TableModel | null;
  readonly face: FaceSpec;
  readonly key: string;
}

/** The actor states the stage keeps, as the rest of the stage reads them. */
export type Actors = ReadonlyMap<string, ActorState>;

export const sampleOf = (p: Piece): Sample => ({ ...p.look, ...p.pose });
/** A sample's pose with a plain look (a flight's). */
export const plain = (s: Sample): Sample => ({ ...LOOK, pos: s.pos, rx: s.rx, ry: s.ry, s: s.s });
