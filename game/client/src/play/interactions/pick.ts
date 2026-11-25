// Picking options: subsets, multisets and ordered picks, on the table and in a sheet (live.js `toggle` and `chooser`).
// A pick that completes a single-option choice reports `done`, and the caller sends it.
interface Bounds {
  readonly min: number;
  readonly max: number;
  readonly repeat: boolean;
}
export interface Picked {
  readonly sel: readonly number[];
  /** Exactly one wanted and now picked: send at once. */
  readonly done: boolean;
}

/** live.js `toggle`: a tap on the table takes an option back, adds it, or (one wanted) swaps it. */
export function toggle(sel: readonly number[], o: number, d: Bounds): Picked {
  let next: number[];
  if (sel.includes(o)) next = sel.filter((x) => x !== o);
  else if (sel.length < d.max) next = [...sel, o];
  else if (d.max === 1) next = [o];
  else next = [...sel];
  return { sel: next, done: d.max === 1 && d.min === 1 && next.length === 1 && !d.repeat };
}

/** live.js `chooser`: a sheet pick. A repeatable option is added again until max; at max a pick takes one back. */
export function choose(sel: readonly number[], o: number, d: Bounds, ordered: boolean): Picked {
  let next: number[];
  if (d.repeat && sel.length < d.max) next = [...sel, o];
  else if (sel.includes(o)) {
    const at = sel.indexOf(o);
    next = [...sel.slice(0, at), ...sel.slice(at + 1)];
  } else if (sel.length < d.max) next = [...sel, o];
  else if (d.max === 1) next = [o];
  else next = [...sel];
  return { sel: next, done: d.max === 1 && d.min === 1 && !ordered };
}

/** A sheet item's badge: its place in an ordered pick, or how often a repeatable option is picked. */
export function badge(sel: readonly number[], o: number, ordered: boolean, repeat: boolean): number | null {
  const n = sel.filter((x) => x === o).length;
  if (!n || !(ordered || repeat)) return null;
  return ordered ? sel.indexOf(o) + 1 : n;
}

/** live.js `chooser`'s Done label: "Done (n)", "Pick 2–3", "Pick 2" or "None". */
export function doneLabel(sel: readonly number[], d: Bounds): string {
  if (sel.length) return `Done (${sel.length})`;
  if (d.min) return `Pick ${d.min === d.max ? d.min : `${d.min}–${d.max}`}`;
  return "None";
}
