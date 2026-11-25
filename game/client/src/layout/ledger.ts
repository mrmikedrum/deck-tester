import type { SeatPlan, Unit, UnitId } from "./seat";
import type { CardId } from "./types";

// Inventory by construction: a plan leaves a layout only through `seal`, which derives `home` from the units and refuses
// a plan where a card is held twice. A card no unit holds goes into one catch-all pile instead of vanishing.

export type Unsealed = Omit<SeatPlan, "home">;

export class Ledger {
  constructor(private readonly permanents: readonly CardId[]) {}

  seal(plan: Unsealed): SeatPlan {
    const home = new Map<CardId, UnitId>();
    const claim = (id: CardId, unit: UnitId): void => {
      const had = home.get(id);
      if (had !== undefined) throw new Error(`card ${id} is held by both ${had} and ${unit}`);
      home.set(id, unit);
    };
    for (const u of plan.units) {
      u.members.forEach((id) => claim(id, u.id));
      u.dressing.forEach((id) => claim(id, u.id));
    }
    const known = new Set(this.permanents);
    for (const id of home.keys()) if (!known.has(id)) throw new Error(`card ${id} is not a permanent of this seat`);
    const missing = this.permanents.filter((id) => !home.has(id));
    if (!missing.length) return { ...plan, home };
    // A layout bug, kept visible and reachable: the cards no unit holds are one pile at the page's fixed edge.
    const first = plan.units[0];
    const rest: Unit = {
      id: "rest",
      role: "support",
      kind: "pile",
      members: missing,
      dressing: [],
      top: missing[0]!,
      title: `Rest ${missing.length}`,
      mixed: true,
      acting: false,
      tapped: false,
      placement: first ? first.placement : { pos: plan.fixtures.page.pos, scale: 1, posture: "prop" },
    };
    missing.forEach((id) => home.set(id, rest.id));
    return { ...plan, units: [...plan.units, rest], home, report: { ...plan.report, overflow: true } };
  }
}
