import type { Account } from "./account";

// How an account is lettered, in ems of its block (seat.ts `InkBlock.em`): layout sizes the block by it and describe hands
// the same rows to the painter, so what the audit measures is what is written.

/** Type sizes (design px on screen, at their smallest: the line furthest from me). The tally's numeral is the glance. */
export const INK_PX = { line: 13, tally: 28, slip: 14 } as const;
/** Rows, in ems: the tally's row holds its numeral; every other line a row of its own. */
export const ROW = { tally: 2.4, line: 1.3 } as const;
/** The tally numeral's size, in ems of a line. */
export const TALLY_EM = INK_PX.tally / INK_PX.line;
/** A line's average letter, in ems, for packing words into a width (the serif the ink is written in). */
export const LETTER_EM = 0.47;

export type InkLine =
  | { readonly t: "tally"; readonly power: number; readonly rest: string }
  | { readonly t: "trait"; readonly text: string }
  | { readonly t: "entry"; readonly text: string; readonly marks: readonly boolean[]; readonly trait: string | null }
  | { readonly t: "works"; readonly text: string };

/** The account's lines, in the order they are written. */
export function inkLines(a: Account): InkLine[] {
  return [
    ...(a.tally ? [{ t: "tally" as const, power: a.tally.power, rest: `power · ${a.tally.creatures} creature${a.tally.creatures === 1 ? "" : "s"}` }] : []),
    ...a.traits.map((c) => ({ t: "trait" as const, text: c.text })),
    ...a.entries.map((e) => ({ t: "entry" as const, text: e.text, marks: e.marks, trait: e.trait })),
    ...a.works.map((w) => ({ t: "works" as const, text: w.text })),
  ];
}

/** Each line's row: where its baseline band starts, from the block's far edge, in ems, and the depth of all of them. */
export function inkRows(lines: readonly InkLine[]): { at: number[]; depth: number } {
  const at: number[] = [];
  let y = 0;
  for (const l of lines) {
    at.push(y);
    y += l.t === "tally" ? ROW.tally : ROW.line;
  }
  return { at, depth: y };
}
