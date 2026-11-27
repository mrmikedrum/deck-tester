// The table plan is the app's: computed from the model, the viewport and its safe-area insets, the chrome's mode, play's
// combat draft, whether the stage still has cards in flight, and the layout memory the last plan kept; recomputed only
// when one of those inputs (other than the memory it feeds back) changes. Play reads its hit groups; the scene draws it.
// Planning is pure: a board layout cannot plan yet is reported once and leaves the table unplanned (play then offers
// every choice in a sheet), never a thrown frame.
import type { ChromeMode } from "../layout";
import { NO_DECISION, planTable, reservations, tableInputOf } from "../layout";
import type { DecisionFacts } from "../layout";
import type { TableModel } from "../model";
import type { BoardCues } from "../play";
import type { CardId, Decision } from "../protocol";
import type { AppState } from "./state";
import { blockedOf } from "./clash";
import { stackKeyOf, tableTop } from "./focus";

/** The chrome's mode for layout's reservations: the mulligan puts the hand away, a sheet too (a pile, a seat's spread). */
export function chromeMode(s: AppState, cues: BoardCues): ChromeMode {
  if (s.focus.layers.some((f) => f.layer === "sift" || f.layer === "lean")) return "sifting";
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

function keyOf(model: TableModel, s: AppState, mode: ChromeMode, pairs: string, settling: boolean, d: DecisionFacts): string {
  const { w, h, safe } = s.viewport;
  return `${model.gen}|${model.rev}|${w}x${h}|${safe.top},${safe.right},${safe.bottom},${safe.left}|${mode}|${pairs}|${asideOf(s) ? "aside" : ""}|${stackHeldOf(s, model) ? "held" : ""}|${blockedOf(model).join(",")}|${d.kind ?? ""}:${d.options.join(",")}:${d.draft.join(",")}|${settling ? "settling" : ""}`;
}

/**
 * What the layout reads of the decision in hand (layout/arrange `DecisionFacts`): its kind, the cards it offers (an
 * attacker, a blocker, a target, a card to play or a source to pay with) and my attack draft. A card the decision offers
 * steps out of a fold where it would hide, and the moment the leaves light follows from it.
 */
export function decisionFactsOf(d: Decision | null, cues: BoardCues): DecisionFacts {
  if (!d) return NO_DECISION;
  const options = new Set<CardId>();
  for (const r of ("refs" in d ? (d.refs as readonly unknown[]) : []) ?? []) {
    const ref = r as { readonly card?: CardId | null; readonly blocks?: CardId };
    if (ref.card != null) options.add(ref.card);
  }
  const draft = d.kind === "attack" ? (cues.combat?.attacks.map((a) => a.attacker) ?? []) : [];
  return { kind: d.kind, options: [...options].sort((a, b) => a - b), draft };
}

/** The order the clash first stood its attackers in, kept for the combat (so no column jumps as the table replans). */
function ordered(s: AppState): AppState {
  const g = s.plan?.gathering;
  const c = s.focus.combat;
  if (!c || c.order.length || !g?.focus) return s;
  return { ...s, focus: { ...s.focus, combat: { ...c, order: [...g.wings.flatMap((w) => w.columns.flatMap((col) => col.attackers)), ...g.more] } } };
}

/** The clash set aside: the combat takes the table form until it ends. */
const asideOf = (s: AppState): boolean => s.focus.aside.some((e) => e.layer === "clash");

/**
 * The stack held up as the table's focus: its layer is the topmost table layer, or a new item is about to bring it up
 * (focus.ts `sync` opens it for every new stack, after the plan is made). Held, it floats over the table and the mats
 * do not part for it; set aside (or under a sift or a lean-in) it rests in the middle at table size, and they do.
 */
export function stackHeldOf(s: AppState, model: TableModel): boolean {
  if (!model.stack.length) return false;
  if (stackKeyOf(model) !== s.focus.stackKey) return true;
  return tableTop(s.focus)?.layer === "stack";
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
  const decision = decisionFactsOf(s.session.decision, cues);
  const key = keyOf(model, s, mode, pairsKey(cues), settling, decision);
  if (key === s.planKey) return { state: ordered(s), error: null };
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
        ...(asideOf(s) ? { combatForm: "table" as const } : {}),
        ...(blockedOf(model).length ? { blocked: new Set(blockedOf(model)) } : {}),
        ...(s.focus.combat?.order.length ? { order: s.focus.combat.order } : {}),
        // Every opponent's leaf is the arrangement engine's (docs/game-arrangement-engine.md, steps 6 and 8): its
        // memory rides in the layout memory like any seat's.
        engine: { draw: true, decision },
        stackHeld: stackHeldOf(s, model),
      }),
    );
    return { state: ordered({ ...s, plan, planKey: key, layoutMemory: plan.memory, reserve: plan.reserve }), error: null };
  } catch (e) {
    return { state: { ...s, plan: null, planKey: key, reserve }, error: e instanceof Error ? e.message : String(e) };
  }
}
