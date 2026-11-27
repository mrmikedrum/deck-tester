// The focus containers (§2.8): a seat's spread and a pile, each a sheet brought nearer. Every card stands square to the
// camera at the table's one mesh size (`S_TABLE`), carried toward the eye until it reads `step` times as large as a card
// square to the camera where it came from (§4.1, "Nearer"): moving in animates distance, never scale. The sheet is the
// largest step at which it fits the room it is given, keeping its rows apart where it can (each caption's tier, then
// each run the break rules make), then sharing rows, then paging at its smallest step. The order is the policy's
// (policies/sheet.ts); this only places. Pure.
import type { Projector } from "../projector";
import type { Quad } from "../shape";
import type { CardId, Point, Rect, V3 } from "../types";
import { BREAK_RULES, mayShare } from "./breaks";
import type { BreakRule } from "./breaks";
import type { CaptionKind, PickTarget } from "./contract";
import { CARD, NOTCH } from "./frame";
import type { SheetUnit } from "./policies/sheet";
import { S_TABLE } from "./scale";

/** The steps a sheet tries, largest first: how much larger than a table card where it came from it reads (§4.1). */
export const SHEET_STEPS = [2, 1.8, 1.6, 1.4, 1.2] as const;

/** Spacing, design px: between cards across, between rows, and a caption's line (designer §7.2: 24 CSS px, never
 *  scaled down) with the gap under it. */
export const SHEET_GAP = { x: 10, y: 12, caption: 24, under: 4 } as const;

export interface SheetInput {
  /** "spread:<seat>", "pile:<group>". */
  readonly id: string;
  readonly role: "spread" | "pile";
  /** In the policy's order. */
  readonly units: readonly SheetUnit[];
  readonly projector: Projector;
  /** Where the sheet may lie on screen, CSS px. */
  readonly area: Rect;
  /** Chrome on screen inside the area that no card may cover (the prompt in its corner): rows beside it are shorter. */
  readonly keepouts?: readonly Rect[];
  /** The design unit (CSS px per design px). */
  readonly u: number;
  /** How tall a table card square to the camera is on screen where the sheet's cards come from (my field line for mine,
   *  a leaf's front line for theirs), CSS px: the steps' reference. */
  readonly ref: number;
  readonly page: number;
  /** The decision up is choosing cards: an offered card's target selects it. */
  readonly choosing: boolean;
  readonly rules?: readonly BreakRule[];
}

export interface SheetPlace {
  readonly key: string;
  /** Its cards, the top first: more than one for a stack of copies. */
  readonly cards: readonly CardId[];
  readonly top: CardId;
  readonly tier: CaptionKind | null;
  readonly offered: boolean;
  /** Its face's middle in the world, and the card's own right and up: square to the camera, untapped. */
  readonly mid: V3;
  readonly right: V3;
  readonly up: V3;
  /** A tapped card lies a notch turned (designer §2), in the room its cell keeps for it. */
  readonly turn: "none" | "notch";
  /** Its face on screen. */
  readonly quad: Quad;
  /** A stack's count and where its marker sits on screen (its face's foot, right), or null for a single card. */
  readonly count: { readonly n: number; readonly at: Point } | null;
}

export interface SheetCaption {
  readonly kind: CaptionKind;
  /** Its foot-left on screen, CSS px: over the top-left of the first unit under it. */
  readonly at: Point;
  /** Its tier began on an earlier row or page. */
  readonly more: boolean;
}

export interface Sheet {
  readonly id: string;
  readonly role: "spread" | "pile";
  readonly step: number;
  /** The card mesh's scale: the table's, always. */
  readonly scale: number;
  /** How far from the eye the sheet stands, along the camera's axis (world units). */
  readonly depth: number;
  /** This page's places, in order. */
  readonly places: readonly SheetPlace[];
  readonly captions: readonly SheetCaption[];
  /** What this page covers on screen, CSS px: its cards and captions. */
  readonly box: Rect;
  readonly pages: { readonly count: number; readonly current: number; readonly offeredOn: readonly number[] };
  /** In pick precedence, highest first: each place's face. */
  readonly targets: readonly PickTarget[];
  /** How its rows were kept apart: "apart" (tiers and break runs), "tiers", or "shared". */
  readonly rows: Mode;
}

type Mode = "apart" | "tiers" | "shared";

interface Row {
  readonly units: SheetUnit[];
  /** Captions in this row: at which unit index each starts. */
  readonly captions: { readonly at: number; readonly kind: CaptionKind; readonly more: boolean }[];
  /** Its top on screen (its caption's line first), and the span across it may use. */
  readonly y: number;
  readonly lo: number;
  readonly hi: number;
}

const add = (a: V3, b: V3, k = 1): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** The camera's axis (from the eye into the screen) and its focal length in CSS px. */
function lens(proj: Projector): { fwd: V3; f: number } {
  const fwd = cross(proj.up, proj.right);
  const p = add(proj.eye, fwd);
  const f = Math.abs(proj.project(add(p, proj.up, 0.5)).y - proj.project(add(p, proj.up, -0.5)).y);
  return { fwd, f };
}

/** How tall a card of the table's mesh, square to the camera, stands on screen at `at` (CSS px): a sheet's reference. */
export function referenceHeight(proj: Projector, at: V3): number {
  const { fwd, f } = lens(proj);
  return (f * CARD.h * S_TABLE) / Math.max(1e-6, dot(sub(at, proj.eye), fwd));
}

/** The point at screen (x, y) that lies `depth` from the eye along the camera's axis. */
function atDepth(proj: Projector, fwd: V3, x: number, y: number, depth: number): V3 {
  const dir = unit(sub(proj.onTable(x, y, 0), proj.eye));
  return add(proj.eye, dir, depth / Math.max(1e-6, dot(dir, fwd)));
}

/**
 * The units in the order a mode lays them: "apart" orders each tier's units by break run (the break stage's runs, each
 * in the order its first unit appears), so a run is never split by another; the others keep the policy's order.
 */
function ordered(units: readonly SheetUnit[], mode: Mode, rules: readonly BreakRule[]): SheetUnit[] {
  if (mode !== "apart") return [...units];
  const out: SheetUnit[] = [];
  let i = 0;
  while (i < units.length) {
    let j = i;
    while (j < units.length && units[j]!.tier === units[i]!.tier) j++;
    const runs: { cls: SheetUnit["cls"]; xs: SheetUnit[] }[] = [];
    for (const x of units.slice(i, j)) {
      const r = runs.find((r) => mayShare(r.cls, x.cls, rules));
      if (r) r.xs.push(x);
      else runs.push({ cls: x.cls, xs: [x] });
    }
    out.push(...runs.flatMap((r) => r.xs));
    i = j;
  }
  return out;
}

interface Geometry {
  readonly h: number;
  readonly w: number;
  /** A tapped card's room: turned a notch, its corners reach wider and taller. */
  readonly tw: number;
  readonly th: number;
  readonly gx: number;
  readonly gy: number;
  readonly cap: number;
}

function geometry(input: SheetInput, step: number): Geometry {
  const { u } = input, h = step * input.ref, w = CARD.w * h;
  const tw = w * Math.cos(NOTCH) + h * Math.sin(NOTCH), th = h * Math.cos(NOTCH) + w * Math.sin(NOTCH);
  const cap = input.role === "spread" ? SHEET_GAP.caption + SHEET_GAP.under * u : 0;
  return { h, w, tw, th, gx: SHEET_GAP.x * u, gy: SHEET_GAP.y * u, cap };
}

const cellW = (g: Geometry, x: SheetUnit): number => (x.tapped ? g.tw : g.w);
const cardsH = (g: Geometry, r: Row): number => (r.units.some((x) => x.tapped) ? g.th : g.h);
const rowH = (g: Geometry, r: Row): number => (r.captions.length ? g.cap : 0) + cardsH(g, r);
const rowW = (g: Geometry, r: Row): number => r.units.reduce((t, x) => t + cellW(g, x), 0) + Math.max(0, r.units.length - 1) * g.gx;

/** The span across a row from `top` may use: the area, less the chrome beside it (the prompt in the screen's corner). */
function span(input: SheetInput, g: Geometry, top: number): { lo: number; hi: number } {
  const a = input.area, bottom = top + g.cap + g.th, mid = (a.left + a.right) / 2;
  let lo = a.left, hi = a.right;
  for (const k of input.keepouts ?? [])
    if (k.top < bottom && k.bottom > top) {
      if ((k.left + k.right) / 2 >= mid) hi = Math.min(hi, k.left - g.gx);
      else lo = Math.max(lo, k.right + g.gx);
    }
  return { lo, hi };
}

/**
 * The units laid in rows from `y0` down, pages where the area ends: a row ends where its span does, and, keeping rows
 * apart, where a caption's tier starts ("tiers") or a break run does too ("apart"). A tier going on at a page's top says
 * so. `onePage`: give up (null) rather than go past the area's foot.
 */
function pack(input: SheetInput, g: Geometry, units: readonly SheetUnit[], mode: Mode, y0: number, onePage: boolean, rules: readonly BreakRule[]): Row[][] | null {
  const foot = input.area.bottom;
  const pages: Row[][] = [];
  let page: Row[] = [], cur: Row | null = null, used = 0, prev: SheetUnit | null = null;
  const start = (y: number, lead: SheetUnit): Row => {
    // (a tier going on onto a new row or page says so again at the row's start, so no row reads as the tier before)
    const goesOn = lead.tier !== null && prev?.tier === lead.tier;
    const r: Row = { units: [], captions: goesOn ? [{ at: 0, kind: lead.tier!, more: true }] : [], y, ...span(input, g, y) };
    page.push(r);
    used = 0;
    return r;
  };
  for (const x of units) {
    const tierStart = !prev || prev.tier !== x.tier;
    const breaks = !!cur && cur.units.length > 0 && mode !== "shared" && (tierStart || (mode === "apart" && !mayShare(prev!.cls, x.cls, rules)));
    const wide = !!cur && cur.units.length > 0 && used + g.gx + cellW(g, x) > cur.hi - cur.lo;
    if (!cur || breaks || wide) {
      let y = cur ? cur.y + rowH(g, cur) + g.gy : y0;
      if (cur && y + g.cap + g.th > foot) {
        if (onePage) return null;
        pages.push(page);
        page = [];
        y = input.area.top;
      }
      cur = start(y, x);
    }
    if (tierStart && x.tier) cur.captions.push({ at: cur.units.length, kind: x.tier, more: false });
    used += (cur.units.length ? g.gx : 0) + cellW(g, x);
    cur.units.push(x);
    prev = x;
  }
  if (page.length) pages.push(page);
  if (onePage && pages.length === 1) {
    const last = pages[0]!.at(-1);
    if (last && last.y + rowH(g, last) > foot) return null;
  }
  return pages;
}

/**
 * A sheet: the largest step at which its rows fit the area, keeping rows apart where it can ("apart", then "tiers", then
 * "shared"), centred in the room it leaves; where none fits, pages at the smallest step, rows kept by tier.
 */
export function arrangeSheet(input: SheetInput): Sheet {
  const rules = input.rules ?? BREAK_RULES, a = input.area;
  const modes: Mode[] = input.role === "spread" ? ["apart", "tiers", "shared"] : ["apart", "shared"];
  for (const mode of modes)
    for (const step of SHEET_STEPS) {
      const g = geometry(input, step), units = ordered(input.units, mode, rules);
      const top = pack(input, g, units, mode, a.top, true, rules);
      if (!top) continue;
      const rows = top[0]!, last = rows.at(-1)!, free = a.bottom - (last.y + rowH(g, last));
      const centred = free > 0 ? pack(input, g, units, mode, a.top + free / 2, true, rules) : null;
      return laid(input, step, g, mode, [centred?.[0] ?? rows], 0);
    }
  const step = SHEET_STEPS[SHEET_STEPS.length - 1]!, mode: Mode = input.role === "spread" ? "tiers" : "shared";
  const g = geometry(input, step), pages = pack(input, g, ordered(input.units, mode, rules), mode, a.top, false, rules)!;
  return laid(input, step, g, mode, pages, Math.max(0, Math.min(pages.length - 1, input.page)));
}

function laid(input: SheetInput, step: number, g: Geometry, mode: Mode, pages: readonly (readonly Row[])[], current: number): Sheet {
  const proj = input.projector, { fwd, f } = lens(proj), depth = (f * CARD.h * S_TABLE) / g.h;
  const rows = pages[current] ?? [];
  const a = input.area, mid = (a.left + a.right) / 2;
  const widest = Math.max(0, ...rows.map((r) => rowW(g, r)));
  // A spread's rows share one left edge where their spans allow (its captions line up); a pile's rows are each centred.
  const left = (r: Row): number => {
    const w = rowW(g, r);
    if (input.role === "pile") return Math.max(r.lo, Math.min(r.hi - w, (r.lo + r.hi) / 2 - w / 2));
    return Math.max(r.lo, Math.min(r.hi - w, mid - widest / 2));
  };
  const places: SheetPlace[] = [], captions: SheetCaption[] = [];
  const c = Math.cos(-NOTCH), s = Math.sin(-NOTCH);
  for (const r of rows) {
    const top = r.y + (r.captions.length ? g.cap : 0), ch = cardsH(g, r);
    let x = left(r);
    const xs: number[] = [];
    for (const u of r.units) {
      xs.push(x);
      x += cellW(g, u) + g.gx;
    }
    for (const cap of r.captions) captions.push({ kind: cap.kind, at: { x: xs[cap.at]! + (cellW(g, r.units[cap.at]!) - g.w) / 2, y: top }, more: cap.more });
    r.units.forEach((u, i) => {
      const cx = xs[i]! + cellW(g, u) / 2, cy = top + ch / 2;
      // (a notch turns it clockwise as I see it: its right edge goes down)
      const k = u.tapped;
      const pt = (dx: number, dy: number): Point => ({ x: cx + (k ? dx * c - dy * s : dx), y: cy - (k ? dx * s + dy * c : dy) });
      const hw = g.w / 2, hh = g.h / 2;
      const quad: Quad = [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)];
      places.push({
        key: u.key,
        cards: u.cards,
        top: u.cards[0]!,
        tier: u.tier,
        offered: u.offered,
        mid: atDepth(proj, fwd, cx, cy, depth),
        right: proj.right,
        up: proj.up,
        turn: k ? "notch" : "none",
        quad,
        count: u.cards.length > 1 ? { n: u.cards.length, at: pt(hw, -hh) } : null,
      });
    });
  }
  const xs = [...places.flatMap((p) => p.quad.map((q) => q.x)), ...captions.map((k) => k.at.x)];
  const ys = [...places.flatMap((p) => p.quad.map((q) => q.y)), ...captions.map((k) => k.at.y - SHEET_GAP.caption)];
  const box = xs.length ? { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) } : { left: mid, top: a.top, right: mid, bottom: a.top };
  const offeredOn = pages.flatMap((p, i) => (i !== current && p.some((r) => r.units.some((x) => x.offered)) ? [i] : []));
  const targets: PickTarget[] = places
    .map((p, i): PickTarget => ({ id: `card:${p.top}`, piece: p.key, region: p.quad, order: i, members: p.cards, action: input.choosing && p.offered ? { select: p.top } : { inspect: p.top } }))
    .reverse();
  return { id: input.id, role: input.role, step, scale: S_TABLE, depth, places, captions, box, pages: { count: pages.length, current, offeredOn }, targets, rows: mode };
}
