// describe: the plan, the cues and the focus in, every piece's target out: its pose and look, a structural `form` key
// (rebuild when it changes) and a cheap `mods` key (patched in place). Every card in the model is drawn or counted by
// exactly one piece. Pure. The looks are old h.js `targets` (dims for a lean-in, the stack and the turn; a chosen card
// lifted) and `pieceSig`/`plateSig` (what rebuilds and what is patched). The table's focus layers move pieces from where
// the plan put them (keeping that pose as `base`, which taps are measured from): the stack as the focus stands large in
// the middle (the plan's `stackUp`), a lean-in carries one seat's page up over the middle (layout `leanOf`), and a sift
// fans a pile's cards out in front of the camera (layout `siftOf`).
import { abilityText, entryText, isLand, isTreasure, sweepHarms, sweeps } from "../../model";
import type { Card, SeatId, TableModel } from "../../model";
import type { CardId } from "../../protocol";
import { SIFT_PAGE, carry, combatLanes, engineCombat, leanOf, mergeCombat, siftOf, siftPages } from "../../layout";
import type { Lean, TablePlan, Unit } from "../../layout";
import type { BoardCues, Mark } from "../../play";
import { canonical, faceKey, shortName } from "../../theme";
import type { FaceSpec } from "../../theme";
import { DIM, SCRIM } from "./motion";
import { LABEL_PX, estimate, placeLabels, shorter } from "./labels";
import type { LabelAsk, Measure } from "./labels";
import { chipsOf, colourOf, faceOfCard, inkOf, placeOf, plateOf, strongest } from "./faces";
import { pagePose, platePose, poseQuad, screenPose, stackPose, unitPose, zonePose } from "./poses";
import { LOOK, tableFocus } from "./types";
import type { Aim, Description, Draw, FocusTop, Lane, Look, Piece, Pose, WellLook } from "./types";

export interface DescribeInput {
  readonly model: TableModel;
  readonly plan: TablePlan;
  readonly cues: BoardCues;
  readonly focus: FocusTop;
  /** The hit group under a mouse pointer. */
  readonly hover: string | null;
  /** The labels' text widths (the sign's font measured); an estimate without one. */
  readonly measure?: Measure;
}

/** The hover lift: a card under the pointer comes up off its page (a guess; the old client peeked in HTML instead). */
const HOVER_LIFT = 0.06;
/** How high over the table a sift's cards stand, and the shade behind them: over everything else on the table. */
const SIFT_HEIGHT = { cards: 9, scrim: 8 } as const;
/** The shade a sift lays over the table (live.js `laySift`, which the old client ran: 0.32 of near-black). */
export const SIFT_SHADE = 0.32;

export function describe(input: DescribeInput): Description {
  const { model, plan, cues, focus } = input;
  const me = model.viewer.perspective;
  const pieces = new Map<string, Piece>();
  const home = new Map<CardId, string>();
  // What a pending sweep would harm is in danger as plainly as a target is (h.js `swept`): the blood band and the sigil.
  const sweepers = model.stack.filter((it) => sweepHarms(entryText(it, model), it.controller) !== null);
  const markOf = (id: CardId): Mark | undefined => {
    const m = cues.marks.cards.get(id);
    if (m || !sweepers.length) return m;
    const c = model.cards.get(id);
    return c && c.zone === "battlefield" && sweepers.some((it) => sweeps(it, model, c)) ? "danger" : undefined;
  };
  const put = (p: Piece): void => {
    pieces.set(p.id, p);
    for (const id of p.members) if (!home.has(id)) home.set(id, p.id);
  };

  // The table follows its topmost open layer, even under a chrome layer (a sheet over the stack keeps it dimmed).
  const table = tableFocus(focus);
  const stackUp = table?.layer === "stack" && model.stack.length > 0;
  const leanSeat = table?.layer === "lean" ? table.seat : null;
  const softSeat = model.active !== null && model.active !== me ? model.active : null;
  const lean: Lean | null = leanSeat ? leanOf(plan, leanSeat) : null;
  const sifting = table?.layer === "sift" && table.group !== null ? table.group : null;
  /** A pose carried by the lean-in: the leaning seat's things up over the middle, the page across slid aside. */
  const leaned = (seat: SeatId, p: Pose, yawed = false): Pose | null => {
    if (!lean) return null;
    if (lean.seat === seat) return { pos: carry(lean, p.pos), rx: p.rx, ry: yawed ? 0 : p.ry, s: p.s * lean.scale };
    if (lean.slide?.seat === seat) return { ...p, pos: { ...p.pos, x: p.pos.x + lean.slide.dx } };
    return null;
  };
  /** Its pose under the focus, and where the plan put it (taps are measured from there). */
  const placed = (seat: SeatId, p: Pose, yawed = false): { pose: Pose; base?: Pose } => {
    const l = leaned(seat, p, yawed);
    return l ? { pose: l, base: p } : { pose: p };
  };
  /** How far a seat's things dim (h.js `dimTo`), or 0. Under the stack's scrim nothing dims again. */
  const dimOf = (seat: SeatId): number => {
    if (leanSeat) return seat === me ? DIM.leanMine : seat === leanSeat ? 0 : DIM.leanOther;
    if (stackUp) return 0;
    if (softSeat && seat !== softSeat && seat !== me) return DIM.soft;
    return 0;
  };
  // In a fight, what doesn't fight steps back: dimmer, the creatures less than the rest (h.js `targets`), while the
  // fighters stand in the open middle. (Never the plaques or the pages.)
  const fighting = [...plan.seats.values()].some((sp) => sp.units.some((u) => u.fighting));
  const lookOf = (fade: number, mark: Mark | null, hovered: boolean, tapped: boolean): Look => ({
    ...LOOK,
    fade,
    lift: (mark === "selected" ? DIM.selectedLift : 0) + (hovered ? HOVER_LIFT : 0),
    tap: tapped ? 1 : 0,
    glow: mark ? 1 : 0,
  });

  for (const [seat, sp] of plan.seats) {
    const mine = seat === me;
    const place = placeOf(model, seat);
    // The page (h.js floors): lit on its turn or focus, in shadow out of it, dimmer under the stack.
    const page = sp.fixtures.page;
    const lit = leanSeat ? leanSeat === seat : softSeat ? softSeat === seat : mine && model.active === me;
    const tone = (lit ? 1.1 : 1) * (leanSeat && leanSeat !== seat && !mine ? 0.72 : 1);
    const pageDraw: Draw = { t: "page", place, mine, seed: 7 + seat.length * 131 + seat.charCodeAt(0), turn: model.active === seat };
    put({
      id: `page:${seat}`,
      kind: "page",
      seat,
      members: [],
      face: null,
      ...placed(seat, pagePose(page), true),
      look: { ...LOOK, fade: 1 - tone / 1.1, w: page.w, d: page.d },
      form: `page|${seat}|${place}|${mine}`,
      mods: `${pageDraw.turn}`,
      mark: null,
      draw: pageDraw,
      needsMembers: false,
    });

    const rows = mine ? wellRows(sp.units) : new Map<string, { alt: boolean; small: boolean }>();
    for (const u of sp.units) {
      const dim = dimOf(seat);
      const off = fighting && !u.fighting ? (u.role === "creature" ? DIM.fightCreature : DIM.fightOther) : 0;
      const piece = unitPiece(input, seat, u, mine, Math.max(dim, off), lookOf, markOf, rows.get(u.id));
      // Leaned in, a card grows where it stands (about its foot) as well as with its page; taps are still measured from
      // where the plan put it.
      const grow = lean && lean.seat === seat && !u.fighting && lean.grow !== 1 ? lean.grow : 1;
      const grown = grow !== 1 ? unitPose(plan.projector, { ...u.placement, scale: u.placement.scale * grow }, u.tapped) : null;
      put({ ...piece, ...placed(seat, grown ?? piece.pose), ...(grown ? { base: piece.pose } : {}), ...(u.fighting ? { fight: true } : {}) });
    }

    for (const z of sp.fixtures.zones) {
      const members = model.zone(seat, z.zone);
      const mark = strongest(members.map(markOf));
      put({
        id: `zone:${z.zone}:${seat}`,
        kind: "zone",
        seat,
        members,
        face: members[members.length - 1] ?? null,
        ...placed(seat, zonePose(z.placement)),
        look: lookOf(dimOf(seat), mark, false, false),
        form: `zone|${z.zone}|${mine}`,
        mods: `${mark ?? ""}`,
        mark,
        draw: { t: "zone", zone: z.zone, mine, colour: colourOf(model, seat) },
        needsMembers: true,
      });
    }

    // The commander leans beside the plaque while it waits in the command zone (h.js `banner`): a card of its own, which
    // a tap reaches and a cast flies from.
    const cmd = sp.fixtures.commander;
    const cmdCard = cmd ? model.cards.get(cmd.card) : undefined;
    if (cmd && cmdCard) {
      const mark = markOf(cmd.card) ?? null;
      const face = faceOfCard(model, cmdCard, mark);
      const id = `command:${seat}`;
      put({
        id,
        kind: "unit",
        seat,
        members: [cmd.card],
        face: cmd.card,
        ...placed(seat, unitPose(plan.projector, cmd.placement, false)),
        look: lookOf(Math.max(dimOf(seat), fighting ? DIM.fightOther : 0), mark, input.hover === id, false),
        form: `command|${cmd.card}`,
        mods: faceKey(face) + (mark ?? ""),
        mark,
        // (It leans with the plaque, no standee's ash or shadow under it.)
        draw: {
          t: "unit",
          unit: "card",
          posture: "prop",
          token: false,
          title: null,
          sub: null,
          mixed: false,
          mine,
          chips: [],
          dressed: [],
          colours: cmdCard.face.colors,
          well: null,
          copies: [{ face: null, tapped: false }],
          tapNote: null,
          label: null,
          seatColour: colourOf(model, seat),
          seed: cmd.card,
          sick: false,
          cue: null,
        },
        needsMembers: true,
      });
    }

    const plateMark = cues.marks.seats.get(seat) ?? null;
    const spec = plateOf(model, seat, plateMark);
    // The rest of the command zone (a partner) is shown by its plate (the seal's art); it is counted there.
    const command = model.zone(seat, "command").filter((id) => id !== cmd?.card);
    put({
      id: `plate:${seat}`,
      kind: "plate",
      seat,
      members: command,
      face: null,
      ...placed(seat, platePose(sp.fixtures.plate)),
      // (Under a sift's shade it goes: a plaque draws over everything, and would over the sifted cards.)
      look: { ...LOOK, fade: leanSeat && leanSeat !== seat && !mine ? 0.6 : 0, glow: plateMark ? 1 : 0, alpha: sifting ? 0 : 1 },
      form: `plate|${seat}`,
      mods: canonical(spec) + (plateMark ?? ""),
      mark: plateMark,
      draw: { t: "plate", spec },
      needsMembers: false,
    });

    // A hand is the chrome's (mine) or a count on the plate (theirs, never visible): counted, never drawn here.
    const hand = model.zone(seat, "hand");
    if (hand.length)
      put({
        id: `hand:${seat}`,
        kind: "hidden",
        seat,
        members: hand,
        face: null,
        pose: platePose(sp.fixtures.plate),
        look: LOOK,
        form: "hidden",
        mods: "",
        mark: null,
        draw: { t: "hidden" },
        needsMembers: false,
      });
  }

  // The stack, top first: as layout set it aside, or large in the middle while it is the table's focus.
  plan.stack.forEach((entry, i) => {
    const item = model.stack.find((s) => String(s.id) === entry.key);
    if (!item) return;
    const src = item.source === null ? undefined : model.cards.get(item.source);
    const members = src && src.zone === "stack" ? [src.id] : [];
    const mark = src ? (markOf(src.id) ?? null) : null;
    const face = src ? faceOfCard(model, src, mark) : null;
    const seat = item.controller;
    const rest: Pose = stackPose(plan.projector, entry.quad, i);
    const upQuad = stackUp ? plan.stackUp[i]?.quad : undefined;
    const up = !!upQuad;
    const colours = src ? (src.face.colors.length ? src.face.colors : src.face.produces) : [];
    put({
      id: `stack:${entry.key}`,
      kind: "stack",
      seat,
      members,
      face: src?.id ?? null,
      pose: upQuad ? stackPose(plan.projector, upQuad, i, true) : rest,
      ...(upQuad ? { base: rest } : {}),
      look: { ...LOOK, glow: mark ? 1 : 0 },
      form: `stack|${entry.key}|${src?.id ?? ""}`,
      mods: (face ? faceKey(face) : "") + (mark ?? "") + (up ? "|up" : ""),
      mark,
      draw: {
        t: "stack",
        tag: item.spell ? String(seat ?? "") : "Ability",
        colour: colourOf(model, seat),
        ability: !item.spell,
        colours,
        up,
        // (Set aside a card stands 0.75 of the middle's size: as the focus its tag stays the middle's.)
        tagScale: upQuad ? Math.min(1, quadHeight(entry.quad) / 0.75 / quadHeight(upQuad)) : 1,
        img: src && !src.faceDown ? src.face.img : null,
        slip: !item.spell && src ? abilityText(item.text, src.face.name) || null : null,
      },
      needsMembers: members.length > 0,
    });
  });

  // A sift: the pile's cards fanned out in front of the camera over a shade, each flying out of the pile.
  if (sifting) for (const p of siftPieces(model, plan, sifting, table?.page ?? 0)) pieces.set(p.id, p);

  // While I lean in on a seat the stack is set aside, and its arcs with it.
  const aims = lean ? [] : aimsOf(model, pieces, home, stackUp);
  // Every pile's title, sized on screen and placed so none meets another label or another card's name or stats; a title
  // with no room gives way to the count chip (labels.ts).
  const asks: LabelAsk[] = [];
  for (const p of pieces.values()) {
    if (p.draw.t !== "unit" || !p.draw.title || p.draw.well) continue;
    const m = /^(.*?)\s*(\d+)$/.exec(p.draw.title);
    if (m) asks.push({ id: p.id, seat: p.seat, mine: p.seat === me, name: m[1]!, count: +m[2]!, tap: p.draw.tapNote });
  }
  const labelled = placeLabels(plan, asks, input.measure);
  for (const a of asks) {
    const p = pieces.get(a.id)!, d = p.draw as Extract<Draw, { t: "unit" }>, l = labelled.get(a.id) ?? null;
    pieces.set(a.id, { ...p, draw: { ...d, label: l }, mods: `${p.mods}#${l ? `${l.name}|${l.px}|${l.slide}` : "chip"}` });
  }

  // The stack as the focus lays one scrim over the table; the stack's cards, what they aim at and the arcs stand above it,
  // each in its own place (one dim, never a second one per piece).
  const above = new Set<string>();
  if (stackUp) {
    for (const id of pieces.keys()) if (id.startsWith("stack:")) above.add(id);
    for (const a of aims) above.add(a.to);
  }
  return {
    pieces,
    home,
    lanes: lean ? [] : lanesOf(model, plan, cues, pieces),
    aims,
    tableTone: sifting ? DIM.table : 1,
    scrim: stackUp ? SCRIM.alpha : 0,
    above,
    perspective: me,
  };
}

const quadHeight = (q: readonly { readonly y: number }[]): number => Math.max(...q.map((p) => p.y)) - Math.min(...q.map((p) => p.y));

/** A sift of a group: its cards in the order it fans them, and which of them lie turned (tapped on the battlefield). */
export interface SiftCards {
  readonly ids: readonly CardId[];
  readonly tapped: readonly boolean[];
  /** A graveyard or exile, which keeps its order; else a pile on the battlefield. */
  readonly zone: "graveyard" | "exile" | null;
}

/**
 * A group's cards as its sift fans them: a pile on the battlefield with like cards together (the most first, ready
 * before tapped); a graveyard or exile in its order. Null when the plan has no such group.
 */
export function siftCards(model: TableModel, plan: TablePlan, group: string): SiftCards | null {
  const g = plan.hits.groups.find((x) => x.id === group);
  if (!g) return null;
  const m = /^zone:(graveyard|exile):(.+)$/.exec(group);
  const zone = m ? (m[1] as "graveyard" | "exile") : null;
  let ids: CardId[] = zone ? [...model.zone(g.seat!, zone)] : [...g.members];
  if (!zone) {
    const by = new Map<string, CardId[]>();
    for (const id of ids) {
      const k = model.cards.get(id)?.name ?? "";
      by.set(k, [...(by.get(k) ?? []), id]);
    }
    const tapped = (id: CardId) => model.cards.get(id)?.tapped ?? false;
    ids = [...by.values()].sort((a, b) => b.length - a.length).flatMap((cs) => [...cs.filter((id) => !tapped(id)), ...cs.filter(tapped)]);
  }
  return { ids, tapped: ids.map((id) => (!zone && model.cards.get(id)?.tapped) || false), zone };
}

/** A sift's pieces: the shade, and one page of the group's cards in rows (`siftCards`'s order). */
function siftPieces(model: TableModel, plan: TablePlan, group: string, page: number): Piece[] {
  const all = siftCards(model, plan, group);
  if (!all || !all.ids.length) return [];
  const g = plan.hits.groups.find((x) => x.id === group)!;
  const zone = all.zone;
  const p = Math.max(0, Math.min(siftPages(all.ids.length) - 1, page));
  const ids = all.ids.slice(p * SIFT_PAGE, (p + 1) * SIFT_PAGE);
  const tapped = all.tapped.slice(p * SIFT_PAGE, (p + 1) * SIFT_PAGE);
  const places = siftOf(plan.viewport, tapped);
  const proj = plan.projector;
  const xs = places.flatMap((p) => [p.rect.left, p.rect.right]),
    ys = places.flatMap((p) => [p.rect.top, p.rect.bottom]);
  const gap = 12 * Math.min(plan.viewport.w / 1180, plan.viewport.h / 820);
  const back = { left: Math.min(...xs) - gap, top: Math.min(...ys) - gap, right: Math.max(...xs) + gap, bottom: Math.max(...ys) + gap };
  const screen = { rect: { left: 0, top: 0, right: plan.viewport.w, bottom: plan.viewport.h }, rotation: 0, scale: 1 };
  const out: Piece[] = [
    {
      id: "sift:scrim",
      kind: "sift",
      seat: null,
      members: [],
      face: null,
      pose: screenPose(proj, screen, SIFT_HEIGHT.scrim),
      look: { ...LOOK, alpha: SIFT_SHADE },
      form: "sift|scrim",
      mods: `${back.left.toFixed(1)},${back.top.toFixed(1)},${back.right.toFixed(1)},${back.bottom.toFixed(1)}`,
      mark: null,
      draw: { t: "scrim", back, screen: { w: plan.viewport.w, h: plan.viewport.h } },
      needsMembers: false,
    },
  ];
  ids.forEach((id, i) => {
    const pl = places[i]!;
    const c = model.cards.get(id);
    out.push({
      id: `sift:${id}`,
      kind: "sift",
      seat: g.seat,
      members: [],
      face: id,
      pose: screenPose(proj, { rect: pl.rect, rotation: 0, scale: 1 }, SIFT_HEIGHT.cards),
      look: { ...LOOK, tap: pl.turn !== 0 ? 1 : 0 },
      form: `sift|${id}`,
      mods: `${pl.turn}`,
      mark: null,
      draw: { t: "sift", card: id, tapped: !!c?.tapped && !zone, from: group },
      needsMembers: false,
    });
  });
  return out;
}

/** Each stack item's aim at each thing it targets that is drawn: a card's piece, a seat's plaque, a spell on the stack.
 * Faint under the top, and every one while the stack is set aside. */
function aimsOf(model: TableModel, pieces: ReadonlyMap<string, Piece>, home: ReadonlyMap<CardId, string>, up: boolean): Aim[] {
  const out: Aim[] = [];
  const top = model.stack[model.stack.length - 1];
  for (const it of model.stack) {
    const from = `stack:${it.id}`;
    if (!pieces.has(from)) continue;
    const src = it.source === null ? undefined : model.cards.get(it.source);
    const colours = src ? (src.face.colors.length ? src.face.colors : src.face.produces) : [];
    it.targets.forEach((t, j) => {
      let to: string | undefined, onto: Aim["onto"] = "card";
      if ("seat" in t) {
        to = `plate:${t.seat}`;
        onto = "plate";
      } else {
        // (A card is the spell only while that card is on the stack; an ability's card is its source, on the table.)
        const spell = model.stack.find((x) => x !== it && x.spell && x.source === t.card);
        if (spell && model.cards.get(t.card)?.zone === "stack") {
          to = `stack:${spell.id}`;
          onto = "spell";
        } else to = home.get(t.card);
      }
      if (!to || !pieces.has(to) || pieces.get(to)!.kind === "hidden") return;
      out.push({ id: `aim:${it.id}:${j}`, from, to, onto, colours, faint: it !== top || !up });
    });
  }
  return out;
}

function unitPiece(
  input: DescribeInput,
  seat: SeatId,
  u: Unit,
  mine: boolean,
  fade: number,
  lookOf: (fade: number, mark: Mark | null, hovered: boolean, tapped: boolean) => Look,
  markOf: (id: CardId) => Mark | undefined,
  row: { alt: boolean; small: boolean } = { alt: false, small: false },
): Piece {
  const { model, plan } = input;
  const members = [...u.members, ...u.dressing];
  const top = model.cards.get(u.top);
  const mark = strongest(u.members.map(markOf));
  const pose = unitPose(plan.projector, u.placement, u.tapped);
  // Under 56 px on screen a card wears its small form: one word, one figure or one glyph.
  const q = poseQuad(plan.projector, pose);
  const small = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) < SMALL_FACE_PX;
  const face = top ? faceOfCard(model, top, mark, small) : null;
  const chips = top ? chipsOf(top) : [];
  const looked = u.kind === "well" ? wellLook(model, u, mine) : null;
  const well = looked ? { ...looked, sign: looked.theirs ? looked.sign : fitWellSign(plan, u.id, looked.sign, input.measure ?? estimate), ...row } : null;
  const dressed = u.dressing
    .map((id) => model.cards.get(id))
    .filter((c): c is Card => !!c)
    .map((c) => ({ card: c.id, face: faceOfCard(model, c) }));
  const { copies, tapNote } = copiesOf(model, u);
  // A pile of a creature's copies is titled by its name and count, so a count of bodies never reads as a counter's chip.
  const title = u.title ?? (u.role === "creature" && u.members.length > 1 && top ? `${shortName(top.face.name)} ${u.members.length}` : null);
  const draw: Draw = {
    t: "unit",
    unit: u.kind,
    posture: u.placement.posture,
    token: top?.token ?? false,
    title,
    sub: title && u.kind !== "well" ? pileSub(model, u, title) : null,
    mixed: u.mixed,
    mine,
    chips,
    dressed,
    colours: well ? well.colours : top ? top.face.colors : [],
    well,
    copies,
    tapNote,
    label: null,
    seatColour: colourOf(model, seat),
    seed: u.members[0] ?? 0,
    sick: !!top && top.sick && model.active === seat,
    // A pile with an option or a danger inside it signals it (the arrangement engine's `notable` will say which, and why).
    cue: u.members.length > 1 ? (mark === "option" ? "act" : mark === "danger" ? "threat" : null) : null,
  };
  return {
    id: u.id,
    kind: "unit",
    seat,
    members,
    face: u.top,
    pose,
    look: lookOf(fade, mark, input.hover === u.id, u.tapped),
    form: `unit|${u.kind}|${u.placement.posture}|${u.top}|${draw.token}|${u.title !== null}`,
    // Everything its tab says is here (the title shown, its second line, whether it is mixed): the view repaints on this.
    mods: [face ? faceKey(face) : "", draw.title ?? "", tapNote ?? "", copies.map((c) => (c.face ? faceKey(c.face) : "") + c.tapped).join(","), draw.sub ?? "", draw.mixed, chips.map((c) => canonical(c)).join(","), mark ?? "", well ? canonical(well) : "", dressed.map((d) => faceKey(d.face)).join(","), draw.sick, draw.cue ?? ""].join("#"),
    mark,
    draw,
    needsMembers: true,
  };
}

/** A card narrower than this on screen (CSS px) wears its small face. */
const SMALL_FACE_PX = 56;

/** How many copies a pile draws (a well's short stack: four). */
export const PILE_COPIES = { pile: 3, well: 4 } as const;

/**
 * Of `k` copies drawn for `n` members with `t` tapped, how many are drawn tapped: none for none, every one for all, else
 * the share, at least one and leaving one ready. Up to three members this is exact.
 */
export function tappedCopies(k: number, n: number, t: number): number {
  if (t === 0 || n === 0) return 0;
  return Math.max(1, Math.min(t === n ? k : k - 1, Math.round((k * t) / n)));
}

/** The copies a unit draws, ready first, each tapped one a tapped member's face; and its tapped count where inexact. */
function copiesOf(model: TableModel, u: Unit): { copies: { face: FaceSpec | null; tapped: boolean }[]; tapNote: string | null } {
  const cs = u.members.map((id) => model.cards.get(id)).filter((c): c is Card => !!c);
  const n = cs.length, k = Math.max(1, Math.min(n, u.kind === "well" ? PILE_COPIES.well : PILE_COPIES.pile));
  const tapped = cs.filter((c) => c.tapped), t = tapped.length, kt = tappedCopies(k, n, t);
  const copies = [
    ...Array.from({ length: k - kt }, () => ({ face: null, tapped: false })),
    ...tapped.slice(0, kt).map((c) => ({ face: faceOfCard(model, c), tapped: true })),
  ];
  return { copies, tapNote: t > 0 && n > k && u.kind !== "well" ? `↷${t}` : null };
}

/**
 * A pile's second line. A mixed pile of noncreatures: what it holds by kind, most first ("Artifact 4 · Equipment 2",
 * h.js `kindLine`). Creatures (h.js `tabSub`): where it holds unlike cards, its largest groups by name ("Elemental 8 · Cat
 * Beast 6", or "5 kinds" where nothing repeats); and where some are tapped and some not, how many are tapped.
 */
function pileSub(model: TableModel, u: Unit, title: string): string | null {
  const cs = u.members.map((id) => model.cards.get(id)).filter((c): c is Card => !!c);
  if (u.role !== "creature") {
    if (!u.mixed) return null;
    const kind = (c: Card): string => {
      const t = c.face.type;
      if (/Equipment/.test(t)) return "Equipment";
      if (/\bAura\b/.test(t)) return "Aura";
      return t.split(/\s[—-]\s/)[0]!.replace(/Legendary|Snow|Basic|Token|Kindred|Tribal/g, "").trim().split(" ").pop() ?? "";
    };
    const by = new Map<string, number>();
    for (const c of cs) by.set(kind(c), (by.get(kind(c)) ?? 0) + 1);
    return by.size > 1 ? [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(" · ") : null;
  }
  const tapped = cs.filter((c) => c.tapped).length, by = new Map<string, Card[]>();
  if (title) for (const c of cs) by.set(c.face.name, [...(by.get(c.face.name) ?? []), c]);
  const groups = [...by.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length).slice(0, 2).map((g) => `${shortName(g[0]!.face.name)} ${g.length}`);
  const kinds = by.size > 1 ? (groups.length ? groups.join(" · ") : `${by.size} kinds`) : null;
  // (How many are tapped the copies show, and the title's ↷ where they cannot.)
  void tapped;
  return kinds;
}

/** The mana a source makes (h.js `manaOf`): the catalog's `produces`, else its own colours. */
const manaOf = (c: Card): readonly string[] => (c.face.produces.length ? c.face.produces : c.face.colors);

/**
 * A well's colours (h.js `wellColors`): what its sources make, weighted, so a basin of Plains is white even beside a
 * Treasure that could be anything. A source of any colour shows its own colour, never a spray of all five; the one or
 * two strongest win.
 */
function wellColours(cards: readonly Card[]): string[] {
  const w = new Map<string, number>();
  for (const c of cards) {
    let ms = manaOf(c);
    if (ms.length >= 5) ms = c.face.colors.length && c.face.colors.length < 5 ? c.face.colors : ["C"];
    for (const k of ms) w.set(k, (w.get(k) ?? 0) + 1 / ms.length);
  }
  const ks = [...w.keys()].sort((a, b) => w.get(b)! - w.get(a)! || (a < b ? -1 : 1));
  return ks.length ? ks.filter((k) => w.get(k)! >= w.get(ks[0]!)! * 0.5).slice(0, 2) : ["C"];
}

/**
 * A well's sign (h.js `buildBoard`): mine say what they hold and how many are tapped ("Mountain ×4" over "1 tapped");
 * theirs is one well signed with its count of lands, and what else makes their mana under it ("+ 1 mana rock").
 */
function wellLook(model: TableModel, u: Unit, mine: boolean): Omit<WellLook, "alt" | "small"> {
  const cards = u.members.map((id) => model.cards.get(id)).filter((c): c is Card => !!c);
  const n = cards.length,
    tapped = cards.filter((c) => c.tapped).length;
  const colours = wellColours(cards),
    spent = n > 0 && tapped === n,
    shown = Math.min(n, 4);
  if (!mine && !u.title) {
    const lands = cards.filter(isLand).length,
      tr = cards.filter(isTreasure).length,
      rocks = n - lands - tr;
    const more = [rocks ? `${rocks}${tr ? "" : " mana"} rock${rocks > 1 ? "s" : ""}` : "", tr ? `${tr} Treasure${tr > 1 ? "s" : ""}` : ""].filter(Boolean);
    return { sign: `Lands ${lands}`, sub: more.length ? `+ ${more.join(" · ")}` : null, colours, spent, shown, theirs: true };
  }
  const rep = model.cards.get(u.top);
  const sign = u.title ?? `${shortName(rep?.face.name ?? "")}${n > 1 ? ` ×${n}` : ""}`;
  return { sign, sub: tapped ? (n > 1 ? `${tapped} tapped` : "tapped") : null, colours, spent, shown, theirs: false };
}

/**
 * My well's sign, said short enough to stop short of its neighbours' cards at 12 px: no wider than twice the row's pitch
 * less a card and 8 px; its name shortened (labels.ts `shorter`), never its count.
 */
function fitWellSign(plan: TablePlan, id: string, sign: string, measure: Measure): string {
  const g = plan.hits.groups.find((x) => x.id === id);
  if (!g) return sign;
  const box = (q: typeof g.quad) => ({ l: Math.min(...q.map((p) => p.x)), r: Math.max(...q.map((p) => p.x)), t: Math.min(...q.map((p) => p.y)), b: Math.max(...q.map((p) => p.y)) });
  const me = box(g.quad), w = me.r - me.l, cx = (me.l + me.r) / 2;
  const row = plan.hits.groups.filter((x) => x.id !== id && x.seat === g.seat && x.kind === "well").map((x) => box(x.quad)).filter((b) => b.t < me.b && b.b > me.t);
  if (!row.length) return sign;
  const pitch = Math.min(...row.map((b) => Math.abs((b.l + b.r) / 2 - cx)));
  const room = 2 * pitch - w - 8;
  const m = /^(.*?)( ×\d+)?$/.exec(sign)!, count = m[2] ?? "";
  for (const name of shorter(m[1]!)) if (measure(name + count, LABEL_PX.theirs) + LABEL_PX.pad * LABEL_PX.theirs <= room) return name + count;
  return (shorter(m[1]!).at(-1) ?? m[1]!) + count;
}

/** My wells by row (h.js `rowsOf(plan.L)`): neighbours' signs alternate near and far; a row of more than 5, smaller. */
function wellRows(units: readonly Unit[]): Map<string, { alt: boolean; small: boolean }> {
  const out = new Map<string, { alt: boolean; small: boolean }>();
  const byRow = new Map<string, Unit[]>();
  for (const u of units) if (u.kind === "well") {
    const k = u.placement.pos.z.toFixed(2);
    byRow.set(k, [...(byRow.get(k) ?? []), u]);
  }
  for (const row of byRow.values()) {
    row.sort((a, b) => a.placement.pos.x - b.placement.pos.x);
    row.forEach((u, i) => out.set(u.id, { alt: i % 2 === 1, small: row.length > 5 }));
  }
  return out;
}

/**
 * Each attack as a lane (layout `combatLanes`, the old `drawLanes`): the draft while one is being picked, over the
 * engine's combat (a block draft keeps the engine's attackers). Its ends are pieces drawn now, or a point on a page.
 */
function lanesOf(model: TableModel, plan: TablePlan, cues: BoardCues, pieces: ReadonlyMap<string, Piece>): Lane[] {
  const combat = mergeCombat(engineCombat(model), cues.combat);
  const out: Lane[] = [];
  for (const l of combatLanes(plan.seats, model.viewer.perspective, combat)) {
    if (!pieces.has(l.from.unit)) continue;
    if ("unit" in l.to && !pieces.has(l.to.unit)) continue;
    out.push({
      id: l.id,
      attacker: l.attacker,
      from: l.from.unit,
      fromOffset: l.from.offset,
      to: "unit" in l.to ? { piece: l.to.unit, offset: l.to.offset } : { at: l.to.at },
      apex: l.apex,
      colour: inkOf(model, l.seat),
      blocked: l.blocked,
    });
  }
  return out;
}
