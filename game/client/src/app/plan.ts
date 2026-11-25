// The table plan is the app's: computed from the model, the viewport and its safe-area insets, the chrome's mode, play's
// combat draft, whether the stage still has cards in flight, and the layout memory the last plan kept; recomputed only
// when one of those inputs (other than the memory it feeds back) changes. Play reads its hit groups; the scene draws it.
// Planning is pure: a board layout cannot plan yet is reported once and leaves the table unplanned (play then offers
// every choice in a sheet), never a thrown frame.
import type { ChromeMode } from "../layout";
import { planTable, questionKey, questionOf, ranks, reservations, tableInputOf } from "../layout";
import type { DecisionFacts } from "../layout";
import type { TableModel } from "../model";
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

function keyOf(model: TableModel, s: AppState, mode: ChromeMode, pairs: string, settling: boolean, question: string): string {
  const { w, h, safe } = s.viewport;
  return `${model.gen}|${model.rev}|${w}x${h}|${safe.top},${safe.right},${safe.bottom},${safe.left}|${mode}|${pairs}|${question}|${settling ? "settling" : ""}`;
}

/** The decision in hand as layout takes it: its kind, the cards its options name, my attack draft. */
function decisionFacts(s: AppState, cues: BoardCues): DecisionFacts {
  const d = s.session.decision;
  const options: CardId[] = [];
  if (d && "refs" in d && Array.isArray(d.refs))
    for (const r of d.refs as readonly unknown[]) {
      const card = r && typeof r === "object" && "card" in r ? (r as { card: unknown }).card : null;
      if (typeof card === "number" && !options.includes(card as CardId)) options.push(card as CardId);
    }
  return { kind: d?.kind ?? null, options, draft: cues.combat?.attacks.map((a) => a.attacker) ?? [] };
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
  const decision = decisionFacts(s, cues);
  const key = keyOf(model, s, mode, pairsKey(cues), settling, questionKey(questionOf(model, decision)));
  if (key === s.planKey) return { state: s, error: null };
  try {
    const plan = planTable(
      tableInputOf(model, {
        viewport: { w: s.viewport.w, h: s.viewport.h },
        safe: s.viewport.safe,
        mode,
        memory: s.layoutMemory,
        settling,
        involved: new Set(involved),
        combat: cues.combat,
        decision,
        layout: ranks,
      }),
    );
    return { state: { ...s, plan, planKey: key, layoutMemory: plan.memory, reserve: plan.reserve }, error: null };
  } catch (e) {
    return { state: { ...s, plan: null, planKey: key, reserve }, error: e instanceof Error ? e.message : String(e) };
  }
}
