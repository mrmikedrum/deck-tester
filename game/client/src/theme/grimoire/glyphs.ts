// Paths on a 24 box: mana symbols, keyword icons. The same ones live.css draws for the HTML.
import type { ManaKey } from "../tokens";

/** Mana as its symbols, not letters: a sun, a drop, a skull, a flame, a tree, a diamond. The skull's eyes are holes (even-odd). */
export const GLYPH: Readonly<Record<ManaKey, string>> = {
  W: "M12 2.6l1.5 4 3.8-1.9-1.9 3.8 4 1.5-4 1.5 1.9 3.8-3.8-1.9-1.5 4-1.5-4-3.8 1.9 1.9-3.8-4-1.5 4-1.5-1.9-3.8 3.8 1.9z",
  U: "M12 3C12 3 6.4 10.4 6.4 14.6a5.6 5.6 0 0 0 11.2 0C17.6 10.4 12 3 12 3z",
  B: "M12 3.4a7.2 7.2 0 0 0-7.2 7.2c0 2.6 1.3 4.3 2.9 5.3V19.6h8.6v-3.7c1.6-1 2.9-2.7 2.9-5.3A7.2 7.2 0 0 0 12 3.4zM7.4 11.2a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM12.8 11.2a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM12 13.4l-1.1 2.2h2.2z",
  R: "M12 2.4c.9 3.4 5.2 5.6 5.2 10.6a5.2 5.2 0 0 1-10.4 0c0-2.6 1.3-3.9 2.4-5.2.2 1.7 1 2.6 1.8 3C10.6 8 11.2 5 12 2.4z",
  G: "M12 2.8a4.1 4.1 0 0 0-4 3.3A3.7 3.7 0 0 0 5.8 12.8a3.7 3.7 0 0 0 4.3 3H11V21.2h2V15.8h.9a3.7 3.7 0 0 0 4.3-3 3.7 3.7 0 0 0-2.2-6.7A4.1 4.1 0 0 0 12 2.8z",
  C: "M12 3.6l6.2 8.4-6.2 8.4-6.2-8.4z",
};

/** A pip's fill and glyph colours, per mana colour. */
export const PIP: Readonly<Record<ManaKey, readonly [string, string]>> = {
  W: ["#f3edd2", "#3b3420"],
  U: ["#5fa4e8", "#0b1a2a"],
  B: ["#7b6c88", "#120c16"],
  R: ["#e2694f", "#2a0d06"],
  G: ["#4fae63", "#062010"],
  C: ["#c2c8d0", "#1a1d22"],
};

/** Keyword icons (Arena-style shorthand), in the order a face shows them. */
export const KEYWORD_ICONS: Readonly<Record<string, string>> = {
  Flying: "M2 15c5 0 9-3 12-10 1 3 1 6-1 9 2-1 5-1 8 0-2 2-5 3-8 3 1 1 3 1 5 2-3 1-7 1-10-1-2 0-4-1-6-3z",
  Reach: "M12 2l5 6h-3.5v6h-3V8H7zM5 16c4 3 10 3 14 0v2.5c-4 3-10 3-14 0z",
  Trample: "M3 5l7 7-7 7zm9 0l7 7-7 7z",
  Deathtouch:
    "M12 2a8 8 0 00-8 8c0 3 1.5 5 3 6v3h2v-2h2v2h2v-2h2v2h2v-3c1.5-1 3-3 3-6a8 8 0 00-8-8zM8.5 9a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4z",
  Lifelink:
    "M12 21l-1.5-1.3C5 15 2 12 2 8.5 2 5.5 4.5 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.5 3 22 5.5 22 8.5c0 3.5-3 6.5-8.5 11.2z",
  Vigilance: "M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z",
  Haste: "M13 2L4 14h6l-1 8 9-12h-6z",
  Hexproof: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zm-3.5 6.5l7 7 1.4-1.4-7-7z",
  Indestructible: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zm0 5l-3 3 3 3 3-3z",
  Menace: "M4 3c0 6 2 10 6 11l-1 7h6l-1-7c4-1 6-5 6-11-2 3-4 5-7 5S6 6 4 3z",
  "First strike": "M20 2l2 2-11 11 2 2-2 2-2-2-4 4-2-2 4-4-2-2 2-2 2 2z",
  "Double strike": "M20 2l2 2-9 9 2 2-2 2-2-2-3 3-2-2 3-3-2-2 2-2 2 2zM4 2l7 7-2 2-7-7z",
  Ward: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zm0 5l-4 4 4 4 4-4z",
  Protection: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zm-1 13l6-6-1.4-1.4L11 12.2 8.4 9.6 7 11z",
  Toxic: "M12 2s7 8 7 13a7 7 0 01-14 0c0-5 7-13 7-13z",
  Infect: "M12 2s7 8 7 13a7 7 0 01-14 0c0-5 7-13 7-13z",
  Defender: "M2 5h20v4H2zm0 5h9v4H2zm11 0h9v4h-9zM2 15h20v4H2z",
};
const KEYWORD_ORDER = Object.keys(KEYWORD_ICONS);

/** The keywords a face shows: those with an icon, in the icon table's order, each once. */
export function faceKeywords(names: readonly string[]): string[] {
  const have = new Set(names);
  return KEYWORD_ORDER.filter((k) => have.has(k));
}
