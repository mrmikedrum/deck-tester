// What a decision kind supplies: its draft's start, its words and buttons, its marks, its sheet, and how taps, drags,
// releases, picks and steps change the draft. A kind returns a Reaction (data); step.ts applies it. Buttons carry
// their own `run`, so what a press does is defined where the button is, and a press of a button that is not
// presented (or is disabled) does nothing.
import type { Answer, CardId, Decision } from "../../protocol";
import type { SeatId } from "../../model";
import type { Facts } from "../facts";
import type { Reached } from "../reach";
import type { Draft, S, Sheet } from "../state";
import type { Button, Carried, CombatDraft, Mark, ScreenPose, SheetView } from "../types";

export interface Ctx<D extends Decision = Decision> {
  readonly d: D;
  readonly f: Facts;
  readonly s: S;
  readonly draft: Draft;
}

/** What an act does. Everything optional; an empty reaction claims the act and changes nothing. */
export interface Reaction {
  readonly draft?: Draft;
  /** Open (or close, null) play's sheet. */
  readonly sheet?: Sheet | null;
  /** Show (false) or set aside (true) a sheet-mode choice's chooser. */
  readonly chooserClosed?: boolean;
  readonly answer?: Answer;
  readonly carried?: Carried | null;
  readonly toast?: string;
  readonly inspect?: CardId;
  /** Stop the auto-pass countdown (Hold). */
  readonly hold?: boolean;
  /** Open this group's members to choose one from (its sift): a tap on a member then acts on that card alone. */
  readonly choose?: string;
}

export interface Btn extends Button {
  readonly run: () => Reaction;
}

export interface Words {
  readonly headline: string;
  readonly hint?: string;
}

export interface MarkSink {
  card(id: CardId, m: Mark): void;
  seat(id: SeatId, m: Mark): void;
  hand(id: CardId): void;
}

export interface Kind<D extends Decision> {
  /** "Let Forge decide" is offered. */
  defers(c: Ctx<D>): boolean;
  /** The draft a new stop starts with. */
  start(d: D, f: Facts): Draft;
  words(c: Ctx<D>): Words;
  buttons(c: Ctx<D>): Btn[];
  marks(c: Ctx<D>, m: MarkSink): void;
  /** The sheet this kind shows by itself (a sheet-mode chooser), or null. */
  ownSheet(c: Ctx<D>): (SheetView & { readonly buttons: readonly Btn[] }) | null;
  /** A sheet the player opened, as this kind draws it; null to let the common sheets draw it. */
  sheet(c: Ctx<D>, open: Sheet): (SheetView & { readonly buttons: readonly Btn[] }) | null;
  /** Null: not this kind's (the app's default applies). */
  tap(c: Ctx<D>, at: Reached): Reaction | null;
  drag(c: Ctx<D>, from: Reached, onto: Reached): Reaction | null;
  release(c: Ctx<D>, card: CardId, dy: number, pose: ScreenPose, overTable: boolean): Reaction | null;
  pick(c: Ctx<D>, option: number): Reaction | null;
  step(c: Ctx<D>, by: number): Reaction | null;
  combat(c: Ctx<D>): CombatDraft | null;
  /** Prefetch card data for the names its options carry (a sheet will show them). */
  readonly prefetch: boolean;
  readonly style: "bar" | "overlay";
  readonly handAway: boolean;
}

/** A button: secondary, enabled, no role, unless said otherwise. */
export function btn(id: string, label: string, run: () => Reaction, more: Partial<Omit<Btn, "id" | "label" | "run">> = {}): Btn {
  return { id, label, tone: "secondary", role: null, enabled: true, detail: null, cost: null, countdown: false, ...more, run };
}

/** Defaults: nothing on the table, no sheet, no draft but the empty one. A kind spreads this and overrides. */
export function base<D extends Decision>(): Kind<D> {
  return {
    defers: () => true,
    start: () => ({ sel: [], holding: null, attackTo: null, value: 0, mode: null }),
    words: () => ({ headline: "" }),
    buttons: () => [],
    marks: () => {},
    ownSheet: () => null,
    sheet: () => null,
    tap: () => null,
    drag: () => null,
    release: () => null,
    pick: () => null,
    step: () => null,
    combat: () => null,
    prefetch: false,
    style: "bar",
    handAway: false,
  };
}
