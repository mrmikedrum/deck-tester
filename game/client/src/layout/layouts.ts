import type { SeatLayout } from "./seat";
import { mat } from "./seat/mat";
import { told } from "./seat/told";

// The seat layouts a table may be planned with, by id: `mat` (the base page) and `told` (a crowded page written down).

export const SEAT_LAYOUTS = { mat, told } as const satisfies Record<string, SeatLayout>;
export type SeatLayoutId = keyof typeof SEAT_LAYOUTS;

/** A layout id from a page's `?layout=`, or the fallback when it names none. */
export function seatLayoutId(s: string | null | undefined, fallback: SeatLayoutId): SeatLayoutId {
  return s && s in SEAT_LAYOUTS ? (s as SeatLayoutId) : fallback;
}
