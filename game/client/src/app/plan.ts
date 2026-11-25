// The table plan is the app's: computed from the model, the viewport and its safe-area insets, the chrome's mode, play's
// combat draft, whether the stage still has cards in flight, and the layout memory the last plan kept; recomputed only
// when one of those inputs (other than the memory it feeds back) changes. Play reads its hit groups; the scene draws it.
// Planning is pure: a board layout cannot plan yet is reported once and leaves the table unplanned (play then offers
// every choice in a sheet), never a thrown frame.
import type { ChromeMode } from "../layout";
import { planTable, reservations, tableInputOf } from "../layout";
import type { SeatId, TableModel } from "../model";
import type { BoardCues } from "../play";
import type { CardId } from "../protocol";
import type { AppState } from "./state";

/** The chrome's mode for layout's reservations: the mulligan puts the hand away, a sift too. */
export function chromeMode(s: AppState, cues: BoardCues): ChromeMode {
  if (s.focus.layers.some((f) => f.layer === "sift")) return "sifting";
  return cues.handAway ? "mulligan" : "normal";
}

/** The cards play's combat draft has acting, as layout takes them: ids. */
function drafted(cues: BoardCues): CardId[] {
  const d = cues.combat;
  return d ? [...d.attacks.map((a) => a.attacker), ...d.blocks.map((b) => b.blocker)] : [];
}

/** The draft's pairs, as a key: a blocker dragged from one attacker to another moves in the row though its id stays. */
function pairsKey(cues: BoardCues): string {
  const d = cues.combat;
  if (!d) return "";
  const to = (t: { seat: string } | { card: CardId }) => ("seat" in t ? `s${t.seat}` : `c${t.card}`);
  return [...d.attacks.map((a) => `${a.attacker}>${to(a.defender)}`), ...d.blocks.map((b) => `${b.blocker}|${b.attacker}`)].join(",");
}

/** Focus-first: the seat whose leaf is spread over the table (the look's layer), which the plan lays out as a sheet. */
export function spreadOf(s: AppState): SeatId | null {
  return s.paradigm === "front" ? (s.focus.layers.find((e) => e.layer === "lean")?.seat ?? null) : null;
}

/** Focus-first: the combat is the table's focus while the clash layer is open (not set aside), and no look is over it. */
export function clashOf(s: AppState): boolean {
  return s.paradigm === "front" && s.focus.layers.some((e) => e.layer === "clash") && spreadOf(s) === null;
}

function keyOf(model: TableModel, s: AppState, mode: ChromeMode, pairs: string, settling: boolean): string {
  const { w, h, safe } = s.viewport;
  return `${s.paradigm}|${spreadOf(s) ?? ""}|${clashOf(s) ? "clash" : ""}|${model.gen}|${model.rev}|${w}x${h}|${safe.top},${safe.right},${safe.bottom},${safe.left}|${mode}|${pairs}|${settling ? "settling" : ""}`;
}

export interface Replanned {
  readonly state: AppState;
  /** Planning failed for these inputs (reported once per inputs). */
  readonly error: string | null;
}

/**
 * The plan for the state's current inputs: kept when they are unchanged, recomputed otherwise. `settling` is true while
 * the stage reports cards still in flight: pages then hold their shape while cards leave them, and re-fit once it turns
 * false (the caller replans then).
 */
export function replan(s: AppState, cues: BoardCues, settling = false): Replanned {
  const mode = chromeMode(s, cues);
  const reserve = reservations(s.viewport, mode, s.viewport.safe);
  const model = s.model;
  if (!model || s.viewport.w <= 0 || s.viewport.h <= 0) {
    return { state: s.plan || s.planKey ? { ...s, plan: null, planKey: null, reserve } : { ...s, reserve }, error: null };
  }
  const involved = drafted(cues);
  const key = keyOf(model, s, mode, pairsKey(cues), settling);
  if (key === s.planKey) return { state: s, error: null };
  try {
    const plan = planTable({
      spread: spreadOf(s),
      clash: clashOf(s),
      ...tableInputOf(model, {
        viewport: { w: s.viewport.w, h: s.viewport.h },
        safe: s.viewport.safe,
        mode,
        memory: s.layoutMemory,
        settling,
        involved: new Set(involved),
        combat: cues.combat,
        paradigm: s.paradigm,
      }),
    });
    return { state: { ...s, plan, planKey: key, layoutMemory: plan.memory, reserve: plan.reserve }, error: null };
  } catch (e) {
    return { state: { ...s, plan: null, planKey: key, reserve }, error: e instanceof Error ? e.message : String(e) };
  }
}
