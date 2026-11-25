// The kind table: one entry per decision kind. Adding a kind using existing interactions is one file and one row.
import type { Decision } from "../../protocol";
import { attack } from "./attack";
import { block } from "./block";
import { choose, targets } from "./choice";
import { confirm } from "./confirm";
import type { Kind } from "./kind";
import { mode } from "./mode";
import { mulligan } from "./mulligan";
import { number } from "./number";
import { order } from "./order";
import { pay } from "./pay";
import { play } from "./play";
import { unknown } from "./unknown";

type Table = { readonly [K in Decision["kind"]]: Kind<Extract<Decision, { kind: K }>> };

const KINDS: Table = { mulligan, number, mode, confirm, order, play, pay, targets, choose, attack, block, unknown };

/** The kind for a decision. (The table is exhaustive by type; the cast only joins its entries for one decision.) */
export const kindOf = <D extends Decision>(d: D): Kind<D> => KINDS[d.kind] as unknown as Kind<D>;
