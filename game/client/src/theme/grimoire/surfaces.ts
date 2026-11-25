// The Grimoire's baked surfaces (vellum, bronze, leather, the card frames) as image sources the painters fill with.
// Each may be missing (still loading, or a test): every use has a flat colour to fall back on, so a painting never fails.
import { colour } from "../tokens";
import type { Ctx } from "./shapes";

/** A card frame's key: one per colour, matte and quiet (W marble, U slate, B leather, R stone, G leaf, C pewter, M brass, L earth, T paper). */
export type FrameKey = "W" | "U" | "B" | "R" | "G" | "C" | "M" | "L" | "T";
export const FRAME_KEYS: readonly FrameKey[] = ["W", "U", "B", "R", "G", "C", "M", "L", "T"];

export type Source = CanvasImageSource;

export interface Surfaces {
  readonly vellum: Source | null;
  readonly bronze: Source | null;
  readonly bronzeClean: Source | null;
  readonly tome: Source | null;
  readonly frame: Readonly<Partial<Record<FrameKey, Source>>>;
}

export const NO_SURFACES: Surfaces = { vellum: null, bronze: null, bronzeClean: null, tome: null, frame: {} };

/** A frame's flat colour where its texture is missing (the old kit's frame colours). */
export const FRAME_FALLBACK: Readonly<Record<FrameKey, string>> = {
  W: "#e7dfc4",
  U: "#3f7fcc",
  B: "#4b4157",
  R: "#c94b3c",
  G: "#3f8b50",
  M: "#c9a64a",
  C: "#a3abb5",
  L: "#8d7457",
  T: "#cfc4a8",
};

/** A repeating pattern of a surface, or `fallback` where it is missing. */
export function pattern(x: Ctx, src: Source | null | undefined, fallback: string): CanvasPattern | string {
  return (src && x.createPattern(src, "repeat")) || fallback;
}

export const bronzeColour = colour.bronze;
