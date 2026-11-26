// My own side as a container (§1.1, §2.6, step 9): my field stands on the template's field line (`TableTemplate.mine.field`),
// square to me and as wide as my slot, facing the leaves with no middle held back (the facing band); in front of it, from
// just over my nameplate, lies my mana, in the space the hand and the prompt leave (keepouts by their shapes, not a band
// across the screen: the hand holds only the screen's left third). The parting slides my side toward me as it slides the
// leaves away (its one pose). My nameplate stands at the screen's foot right of the hand; my graveyard, exile and a
// commander waiting in the command zone are not on the table: the nameplate counts them and its focus holds them, as an
// opponent's does.
import type { Projector } from "../projector";
import type { Reservations } from "../reservations";
import type { Placement } from "../seat";
import { bounds, plateShape } from "../shape";
import type { SeatSlot, TableTemplate } from "../template";
import type { SeatId } from "../types";
import { designUnit } from "../types";
import type { ArrangeInput, Container, SurfaceFrame } from "./contract";
import { NO_RELATIONS } from "./contract";
import { CARD, LEAN, onFrame, slotFrame } from "./frame";
import { partShift } from "./leaf";
import type { LeafInput, LeafPlan } from "./leaves";
import { mine } from "./policies/mine";
import { S_TABLE } from "./scale";
import { arrange } from "./solver";

/** My nameplate's table place: its scale (about the chrome plate's width) and its gaps, design px. */
export const MY_PLATE = { scale: 0.7, gap: 8, bottom: 8 } as const;

/**
 * My side's frame: the near slot's, square to me, anchored on the table just over my nameplate (so far over it that the
 * parting, sliding my side toward me, keeps clear of it), reaching to the top of my field: its feet at `facing`, on the
 * field line.
 */
export function mineFrame(slot: SeatSlot, tpl: Pick<TableTemplate, "mine" | "part">, proj: Projector, reserve: Reservations): { frame: SurfaceFrame; facing: number } {
  const f = slotFrame({ ...slot, yaw: 0 }), u = designUnit(proj.viewport);
  const top = bounds(plateShape(proj, "", myPlate(proj, reserve)).face).t - MY_PLATE.gap * u;
  const at = proj.onTable(proj.viewport.w / 2, top);
  const k = (at.z - f.anchor.z) / f.away.z + partShift(tpl.part.most);
  const anchor = onFrame(f, 0, k);
  const facing = (tpl.mine.field - anchor.z) / f.away.z;
  return { frame: { ...f, anchor, d: facing + CARD.h * S_TABLE * 1.3 + 0.05 }, facing };
}

/** Where my nameplate stands (a table place the chrome plate is drawn at): its foot at the screen's bottom, just right
 *  of the hand, where it has always been. */
export function myPlate(proj: Projector, reserve: Reservations): Placement {
  const u = designUnit(proj.viewport);
  const hand = reserve.items.find((i) => i.kind === "hand")?.rect;
  const left = (hand ? hand.right : reserve.safe.left) + MY_PLATE.gap * u;
  // A plate 3.2 wide (shape.ts) at its scale, measured where it stands.
  const y = reserve.safe.bottom - MY_PLATE.bottom * u;
  const probe = proj.onTable(left, y);
  const w = Math.abs(proj.project({ ...probe, x: probe.x + 1.6 * MY_PLATE.scale }).x - proj.project({ ...probe, x: probe.x - 1.6 * MY_PLATE.scale }).x);
  return { pos: proj.onTable(left + w / 2, y), scale: MY_PLATE.scale, posture: "stand" };
}

export interface MineOptions {
  readonly seat: SeatId;
  readonly slot: SeatSlot;
  readonly tpl: Pick<TableTemplate, "mine" | "part">;
  readonly projector: Projector;
  readonly reserve: Reservations;
}

export function mineContainer(o: MineOptions): Container {
  const { frame, facing } = mineFrame(o.slot, o.tpl, o.projector, o.reserve), u = designUnit(o.projector.viewport);
  const plate = bounds(plateShape(o.projector, o.seat, myPlate(o.projector, o.reserve)).face), pad = MY_PLATE.gap * u;
  return {
    id: `rest:${o.seat}`,
    role: "rest",
    owner: o.seat,
    viewer: o.seat,
    frame,
    facing,
    projector: o.projector,
    // the parting at its most slides my row toward me (along `away`'s opposite): it holds there too
    poses: [{ id: "parted", shift: -partShift(o.tpl.part.most) }],
    layer: { kind: "table" },
    stand: { lean: LEAN },
    floors: { creature: 72, any: 44, tapPx: 44 },
    // The hand and the prompt where they rest (a hand put away leaves its place: the board never shifts for it), and my
    // nameplate.
    keepouts: [
      ...o.reserve.items.map((i) => ({ on: "screen" as const, rect: i.rect, kind: i.kind })),
      { on: "screen", rect: { left: plate.l - pad, top: plate.t - pad, right: plate.r + pad, bottom: plate.b }, kind: "plate" },
    ],
    safe: o.reserve.safe,
    captions: null,
    growth: "fixed",
    entry: `plate:${o.seat}`,
    paging: null,
  };
}

/** My side arranged at rest by `mine`. A plan never throws: an engine error is recorded and the caller falls back. */
export function planMine(s: LeafInput, o: Omit<MineOptions, "seat">): LeafPlan {
  try {
    const container = mineContainer({ ...o, seat: s.seat });
    const here = new Set(s.cards.map((c) => c.id));
    // What I may play while I hold priority is usable (light), never stepped out: my row holds still at every stop.
    const play = s.decision === "play", mineOffered = new Set([...s.offered].filter((id) => here.has(id)));
    const input: ArrangeInput = {
      container,
      cards: s.cards,
      relations: NO_RELATIONS,
      acting: { involved: new Set([...s.involved].filter((id) => here.has(id))), aimed: new Set([...(s.aimed ?? [])].filter((id) => here.has(id))), offered: play ? new Set() : s.offered, usable: play ? mineOffered : new Set(), choosing: s.choosing },
      moment: s.moment,
      policy: mine,
      memory: s.memory,
      clock: s.clock,
    };
    const result = arrange(input);
    return { seat: s.seat, policy: result.fit.policy, result, input, error: null };
  } catch (e) {
    return { seat: s.seat, policy: mine.id, result: null, input: null, error: e instanceof Error ? e.message : String(e) };
  }
}
