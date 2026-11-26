// The table plan's input from a model: what `planTable` is handed (the seats' boards, who is acting, the stack). The
// app owns planning (app/plan.ts decides when to plan and keeps the layout memory); this pure mapping is on layout's
// boundary so the app and the scene's workbench plan the corpus exactly alike. It takes plain facts, never play's types:
// the cards a combat draft involves come in as ids.
import { boards } from "./board";
import type { StackEntry, TableInput } from "./plan";
import type { ChromeMode } from "./reservations";
import type { LayoutMemory } from "./seat";
import type { CardId, Insets, SeatId, Viewport } from "./types";
import { engineCombat, fighters, mergeCombat } from "./combat";
import type { CombatPairs } from "./combat";
import type { CombatForm } from "./arrange/gathering";
import type { TableModel } from "../model";
import { leafInputOf } from "./arrange/leaves";
import { arrangedMemory } from "./arrange/adapter";
import type { EngineOptions } from "./arrange/leaves";

export interface TableInputOptions {
  readonly viewport: Viewport;
  /** The safe-area insets, CSS px: the reservations keep clear of them. None by default. */
  readonly safe?: Insets;
  readonly mode?: ChromeMode;
  readonly memory?: ReadonlyMap<SeatId, LayoutMemory> | null;
  /** Cards still flying off the battlefield (the stage reports flights in progress): pages hold their shape. */
  readonly settling?: boolean;
  /** Cards acting that the model does not know of yet (a combat draft's attackers and blockers). */
  readonly involved?: ReadonlySet<CardId>;
  /** A combat draft (play's `cues.combat`, as plain pairs): drawn over the engine's combat, its fighters in the row. */
  readonly combat?: CombatPairs | null;
  /** How the combat is shown (the app's: the clash set aside is the table form); absent, the form it takes by itself. */
  readonly combatForm?: CombatForm;
  /** Attackers that have had a blocker this combat (the app remembers them). */
  readonly blocked?: ReadonlySet<CardId>;
  /** The clash's attackers in the order it first stood them (the app keeps it for the combat). */
  readonly order?: readonly CardId[];
  /** Lay every opponent's leaf out with the arrangement engine (`TablePlan.leaves`); drawn when `draw` (the app). */
  readonly engine?: EngineOptions;
}

export function tableInputOf(model: TableModel, o: TableInputOptions): TableInput {
  const involved = new Set<CardId>(o.involved ?? []);
  for (const a of model.combat?.attackers ?? []) involved.add(a.attacker);
  for (const b of model.combat?.blockers ?? []) involved.add(b.blocker);
  // Only what is on the battlefield fights: a blocker that has died is in its graveyard pile, which stays where it lies.
  const merged = mergeCombat(engineCombat(model), o.combat ?? null);
  const combat = merged && {
    attacks: merged.attacks.filter((a) => model.cards.get(a.attacker)?.zone === "battlefield"),
    blocks: merged.blocks.filter((b) => model.cards.get(b.blocker)?.zone === "battlefield"),
  };
  for (const id of fighters(combat)) involved.add(id);
  const blocked = new Set<CardId>([...(o.blocked ?? []), ...(model.combat?.attackers.filter((a) => a.blocked === true).map((a) => a.attacker) ?? [])]);
  for (const it of model.stack) for (const t of it.targets) if ("card" in t) involved.add(t.card);
  const spells = new Set(model.stack.filter((s) => s.spell && s.source !== null).map((s) => s.source));
  const stack: StackEntry[] = model.stack.map((s) => ({
    key: String(s.id),
    card: (s.source ?? s.id) as CardId,
    ability: !s.spell,
    answers: s.targets.some((t) => "card" in t && spells.has(t.card) && t.card !== s.source),
    targets: s.targets.flatMap((t) => ("card" in t ? [t.card] : [])),
    seats: s.targets.flatMap((t) => ("seat" in t ? [t.seat] : [])),
    controller: s.controller,
  }));
  return {
    viewport: o.viewport,
    ...(o.safe ? { safe: o.safe } : {}),
    mode: o.mode ?? "normal",
    seats: boards(model),
    involved,
    settling: o.settling ?? false,
    memory: o.memory ?? null,
    stack,
    combat,
    ...(o.combatForm ? { combatForm: o.combatForm } : {}),
    // Forge's verdict on each attacker (it holds when the blockers leave), and any the app adds.
    ...(blocked.size ? { blocked } : {}),
    ...(o.order?.length ? { order: o.order } : {}),
    ...(o.engine && model.seats.length === 4 ? { engine: engineInputOf(model, involved, o.settling ?? false, o.engine, o.memory ?? null) } : {}),
  };
}

/** Every opponent's leaf (every seat but the perspective's), each with its own memory: given, or carried in the layout
 *  memory. */
function engineInputOf(model: TableModel, involved: ReadonlySet<CardId>, settling: boolean, o: EngineOptions, memory: ReadonlyMap<SeatId, LayoutMemory> | null) {
  const leaves = model.seats.slice(1).map((st) => {
    const m = o.memory?.has(st.id) ? (o.memory.get(st.id) ?? null) : arrangedMemory(memory?.get(st.id));
    return leafInputOf(model, st.id, involved, settling, { ...o, memory: m });
  });
  return { leaves, draw: !!o.draw };
}
