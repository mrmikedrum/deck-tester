// The table plan's input from a model: what `planTable` is handed (the seats' boards, who is acting, the stack). The
// app owns planning (app/plan.ts decides when to plan and keeps the layout memory); this pure mapping is on layout's
// boundary so the app and the scene's workbench plan the corpus exactly alike. It takes plain facts, never play's types:
// the cards a combat draft involves come in as ids.
import { boards } from "./board";
import type { StackEntry, TableInput } from "./plan";
import type { ChromeMode } from "./reservations";
import type { LayoutMemory, SeatLayout } from "./seat";
import type { CardId, Insets, SeatId, Viewport } from "./types";
import { engineCombat, fighters, mergeCombat } from "./combat";
import type { CombatPairs } from "./combat";
import type { TableModel } from "../model";
import { entryText, sweepHarms, sweeps } from "../model";
import type { Ask } from "./told/answers";

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
  /** How the seats' pages are laid out (`mat` if absent). */
  readonly layout?: SeatLayout;
  /**
   * The decision on screen, as the answers need it: whom I may attack, the legal blocks; null for none (a sweep on the
   * stack is read here). Absent: the table writes no answers (the base page).
   */
  readonly ask?: Ask | null;
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
  for (const it of model.stack) for (const t of it.targets) if ("card" in t) involved.add(t.card);
  const spells = new Set(model.stack.filter((s) => s.spell && s.source !== null).map((s) => s.source));
  // A sweep on the stack asks what each page would lose (the reading the scene already lights in danger).
  const sweepers = o.ask === undefined ? [] : model.stack.filter((it) => sweepHarms(entryText(it, model), it.controller) !== null);
  const hits = sweepers.length
    ? model.seats.flatMap((s) => model.zone(s.id, "battlefield")).filter((id) => {
        const c = model.cards.get(id);
        return !!c && sweepers.some((it) => sweeps(it, model, c));
      })
    : [];
  const ask: Ask | null = o.ask ?? (hits.length ? { kind: "sweep", hits } : null);
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
    ...(o.layout ? { layout: o.layout } : {}),
    ...(o.ask !== undefined ? { ask } : {}),
  };
}
