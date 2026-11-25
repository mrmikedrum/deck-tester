// The gathering (§2.8, `clash`): every creature in a fight leaves its place for one container, as formations: each
// attacking unit with its blockers in front of it (between it and who it attacks), in the order the attackers stood.
// When I am in the combat it is a focus: the formations stand on a plane carried toward the eye, so they read larger and
// over the dimmed table, at the largest step at which they fit one tier, then two; between opponents it stays at table
// size in the open middle. One placement, never a search over candidates: what cannot fit fights from its page.
import { reserved } from "../reservations";
import type { Reservations } from "../reservations";
import { fightUnits, fighters } from "../combat";
import type { CombatPairs, Middle } from "../combat";
import type { Projector } from "../projector";
import type { SeatPlan, Unit } from "../seat";
import { CH, CW, TAP_LEAN } from "../seat/geometry";
import type { CardId, SeatId, V3 } from "../types";
import { S_TABLE } from "./scale";

export interface GatherInput {
  readonly combat: CombatPairs;
  readonly plans: readonly SeatPlan[];
  readonly perspective: SeatId;
  readonly projector: Projector;
  readonly reserve: Reservations;
  /** The open middle (design units): where the gathering stands between opponents. */
  readonly middle: Middle;
  readonly u: number;
}

export interface Gathering {
  /** The seats with their fighters moved into the gathering (`fighting`); the rest fight from their pages. */
  readonly plans: SeatPlan[];
  /** The step it stands at: how much nearer than the table (1: the table; a focus is nearer). */
  readonly step: number;
  readonly tiers: number;
  /** It is a focus (I am in the combat): drawn over the table, which it may cover. */
  readonly focus: boolean;
  /** Fighters that fight from their pages (no room). */
  readonly left: readonly CardId[];
}

/** The nearer steps a focus tries, largest first (§4.1). Between opponents, just off the table. */
const STEPS = [2, 1.8, 1.6, 1.4, 1.2] as const;
const TABLE_STEP = 1.02;
/** A focus stands this high over the table at the least, over every card standing there. */
const FOCUS_CLEAR = 2.4;
const GAP_PX = 10;

interface Formation {
  readonly k: Unit;
  readonly from: SeatId;
  readonly bs: Unit[];
}

const add = (a: V3, b: V3, k: number): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });

export function gathering(input: GatherInput): Gathering {
  const { combat, plans, projector: proj, perspective, u } = input;
  const units = fightUnits(plans, fighters(combat));
  const none: Gathering = { plans: [...plans], step: 1, tiers: 0, focus: false, left: [] };
  if (!units.size) return none;
  // Formations: one per attacking unit, its blockers' units in front of it.
  const forms: Formation[] = [];
  for (const a of combat.attacks) {
    const f = units.get(a.attacker);
    if (!f) continue;
    let fm = forms.find((x) => x.k.id === f.unit.id);
    if (!fm) forms.push((fm = { k: f.unit, from: f.seat, bs: [] }));
    for (const b of combat.blocks)
      if (b.attacker === a.attacker) {
        const fb = units.get(b.blocker);
        if (fb && fb.unit.id !== fm.k.id && !forms.some((x) => x.bs.includes(fb.unit)) && !fm.bs.includes(fb.unit)) fm.bs.push(fb.unit);
      }
  }
  if (!forms.length) return none;
  // In the order they stood: blockers come to the attackers, never the attackers trading places.
  const seenX = (un: Unit): number => proj.project(un.placement.pos).x;
  forms.sort((x, y) => seenX(x.k) - seenX(y.k) || (x.k.id < y.k.id ? -1 : 1));
  const mine = [...units.values()].some((f) => f.seat === perspective);
  const mineAtk = forms[0]!.from === perspective;
  const blocked = forms.some((f) => f.bs.length > 0);

  // Where it may stand on screen (CSS px): a focus, the whole table between the top and the chrome; between opponents,
  // the open middle.
  const safe = input.reserve.safe;
  const chromeTop = Math.min(...(["hand", "prompt"] as const).map((k) => reserved(input.reserve, k)?.top ?? safe.bottom));
  const focusArea = { l: safe.left + 16, r: safe.right - 16, t: safe.top + 70 * u, b: Math.min(chromeTop, safe.bottom) - 8 };
  const M = input.middle, tableArea = { l: M.l * u + 8, r: M.r * u - 8, t: M.t * u, b: M.b * u };

  /** The plane `step` times nearer than the table at the area's middle: its height over the table. */
  const planeAt = (area: typeof focusArea, step: number): number => {
    const c = proj.onTable((area.l + area.r) / 2, (area.t + area.b) / 2, 0), e = proj.eye;
    return e.y + (c.y - e.y) / step;
  };
  /** A unit's width and height on screen standing on that plane with its foot at screen height `y` (px). */
  const measure = (area: typeof focusArea, h: number) => {
    const cx = (area.l + area.r) / 2;
    const px = (y: number): number => {
      const c = proj.onTable(cx, y, h);
      return Math.abs(proj.project(add(c, { x: 1, y: 0, z: 0 }, 0.5)).x - proj.project(add(c, { x: 1, y: 0, z: 0 }, -0.5)).x);
    };
    const tall = (un: Unit, y: number): number => {
      const c = proj.onTable(cx, y, h), th = proj.pitch + (un.tapped ? TAP_LEAN : 0), up = { x: 0, y: Math.cos(th), z: -Math.sin(th) };
      return Math.abs(proj.project(c).y - proj.project(add(c, up, (un.tapped ? CW : CH) * S_TABLE)).y);
    };
    return { wide: (un: Unit, y: number) => (un.tapped ? CH : CW) * 1.06 * S_TABLE * px(y), tall };
  };

  interface Laid {
    readonly step: number;
    readonly h: number;
    readonly area: typeof focusArea;
    /** Each band's formations, and the feet of its near and far rows (screen px). */
    readonly bands: { readonly fs: Formation[]; readonly near: number; readonly far: number }[];
    readonly m: ReturnType<typeof measure>;
  }
  const spanAt = (m: ReturnType<typeof measure>, f: Formation, y: number) =>
    blocked ? Math.max(m.wide(f.k, y), f.bs.reduce((t, b) => t + m.wide(b, y), 0)) : m.wide(f.k, y) + f.bs.reduce((t, b) => t + m.wide(b, y), 0);
  /**
   * Formations in at most `tiers` bands, laid from the area's foot up: each band's near row at its foot, the far row's
   * feet just above the near row's tops (so a blocker never covers its attacker's foot), the next band above that; each
   * band no wider than the area at its near row (the widest, being nearest). Null when they do not fit.
   */
  const fit = (fs: readonly Formation[], area: typeof focusArea, step: number, tiers: number): Laid | null => {
    const h = planeAt(area, step), m = measure(area, h), W = area.r - area.l;
    const bands: Laid["bands"][number][] = [];
    const rest = [...fs];
    let foot = area.b;
    while (rest.length) {
      if (bands.length === tiers) return null;
      const band: Formation[] = [];
      let used = 0;
      while (rest.length) {
        const w = spanAt(m, rest[0]!, foot) + (band.length ? GAP_PX : 0);
        if (used + w > W) break;
        band.push(rest.shift()!);
        used += w;
      }
      if (!band.length) return null;
      const units = band.flatMap((f) => [f.k, ...f.bs]);
      const nearTop = foot - Math.max(...units.map((un) => m.tall(un, foot)));
      const far = blocked ? nearTop - GAP_PX : foot;
      const top = blocked ? far - Math.max(...units.map((un) => m.tall(un, far))) : nearTop;
      if (top < area.t) return null;
      bands.push({ fs: band, near: foot, far });
      foot = top - GAP_PX;
    }
    return { step, h, area, bands, m };
  };

  let kept = [...forms];
  const tryAll = (fs: readonly Formation[]): Laid | null => {
    if (mine)
      for (const tiers of [1, 2])
        for (const step of STEPS) {
          const l = fit(fs, focusArea, step, tiers);
          if (l && l.h >= FOCUS_CLEAR) return l;
        }
    return fit(fs, mine ? focusArea : tableArea, mine ? STEPS.at(-1)! : TABLE_STEP, 2);
  };
  let laid = tryAll(kept);
  // What has no room fights from its page: the widest formation first (the rest keep their order).
  while (!laid && kept.length > 1) {
    const widest = kept.reduce((a, b) => ([b.k, ...b.bs].length > [a.k, ...a.bs].length ? b : a));
    kept = kept.filter((f) => f !== widest);
    laid = tryAll(kept);
  }
  if (!laid) return { ...none, left: [...units.keys()] };

  // Place each band centred across; in a band the near row stands at its foot and the far row behind it (the
  // attackers' row is the far one unless the attackers are mine).
  const { area, bands, m, h } = laid;
  const placed = new Map<string, V3>();
  const at = (sx: number, sy: number) => proj.onTable(sx, sy, h);
  for (const { fs, near, far } of bands) {
    const width = fs.reduce((t, f) => t + spanAt(m, f, near), 0) + GAP_PX * Math.max(0, fs.length - 1);
    let x = (area.l + area.r) / 2 - width / 2;
    for (const f of fs) {
      const w = spanAt(m, f, near);
      if (blocked) {
        placed.set(f.k.id, at(x + w / 2, mineAtk ? near : far));
        const y = mineAtk ? far : near;
        let bx = x + w / 2 - f.bs.reduce((t, b) => t + m.wide(b, y), 0) / 2;
        for (const b of f.bs) {
          placed.set(b.id, at(bx + m.wide(b, y) / 2, y));
          bx += m.wide(b, y);
        }
      } else placed.set(f.k.id, at(x + w / 2, near));
      x += w + GAP_PX;
    }
  }
  const moved = plans.map((p) =>
    p.units.some((un) => placed.has(un.id))
      ? { ...p, units: p.units.map((un) => (placed.has(un.id) ? { ...un, fighting: true, placement: { pos: placed.get(un.id)!, scale: S_TABLE, posture: "stand" as const } } : un)) }
      : p,
  );
  const inside = new Set(kept.flatMap((f) => [f.k, ...f.bs]).flatMap((un) => un.members));
  return { plans: moved, step: laid.step, tiers: laid.bands.length, focus: mine, left: [...units.keys()].filter((id) => !inside.has(id)) };
}
