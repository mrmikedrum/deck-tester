// The stage's pieces as three.js objects: a unit (its top card, the copies under it, its title sign and chips; a standee
// in its ash on its shadow, Auras and Equipment peeking out from behind it; a well of its mana's light under its signed
// lands), a zone pile (a box of cards with the top one face up and its sign), a plate, a stack card (sleeved in its
// owner's colour on its drop shadow, its mana crackling off its rim, igniting as it is cast) with its owner's tag, a
// page (its turn's edge handed over in 300 ms), a sifted card and the sift's shade, and a flying card (a ghost) with its
// flare. A mark brings its effect: embers under what you can act on, gilt under what you chose, the sigil under what is
// in danger. Each is built for a `form`, patched for its `mods` and posed every frame from the stage's sample. Ported
// from old h.js `cardMesh`, `standee`/`flat`/`well`, `zonePile`/`zoneLean`, `banner`, `buildStack`, `sift` and the floors;
// the static table's page and plate share the builders here.
import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Vector3,
} from "three";
import type { Material, Object3D, Texture } from "three";
import { CH, CW, PILE_LEAN, TAP_LEAN, TH } from "../../layout/seat/geometry";
import { SIGN_FONT, SIGN_U, colour, faceKey, materials, motion, seatInk } from "../../theme";
import type { FaceSpec, SeatPlace } from "../../theme";
import type { ActorView, Draw, GhostView, Sample } from "../stage/types";
import { pileHeight, siftRoll } from "../stage/poses";
import { LABEL_PX } from "../stage/labels";
import { SIFT_SHADE } from "../stage/describe";
import { createCard } from "./card";
import { Block, CastShadow, Contact, blockHeight } from "./slab";
import type { CardObject, CardOptions } from "./card";
import { burstFx, chosenFx, emberFx, moteFx, sigilFx, spellFx, standFx, wellFx } from "./fx";
import type { StandTone } from "./fx";
import type { Effect, FxKit } from "./fx";
import type { Host } from "./host";
import { setLook, setSignal } from "./materials";
import type { Lease } from "./textures";

const { slab } = materials;
const FOOT = new Vector3();

/** Stands (or is propped nearly upright): its stock runs behind it and its shadow is the lamp's, cast behind it. */
const uprightOf = (p: Extract<Draw, { t: "unit" }>["posture"]): boolean => p === "stand" || p === "prop";

/** Sizes the pieces are drawn at (old h.js), world units: a card is 1 tall. */
const SIZE = {
  /** Copies under a pile's top card, each a little behind and up (old standee: up to three stacked). */
  copies: 3,
  copyStep: { x: 0.035, y: 0.045, z: -0.03 },
  /** Counter chips: on the face, from the right just above the foot, stepping left (h.js `chipsOn`). */
  chip: 0.26,
  chipStep: 0.27,
  chipAt: { x: CW / 2 - 0.12, y: -CH / 2 + 0.34, z: TH / 2 + 0.03 },
  /** A stack card's tag under it (h.js `buildStack`: 0.62 x 0.2). */
  tag: { w: 0.62, h: 0.2, y: -CH / 2 - 0.02 },
  /** The plaque (static table: 3.2 x 0.8, standing 0.42 up). */
  plate: { w: 3.2, h: 0.8, y: 0.42 },
  /** A zone pile's sign: above the pile, propped up 0.5 from flat, narrow enough for two side by side. */
  zoneSignTilt: 0.5,
  /** Exile's top card lies a little turned (`zoneLean`). */
  exileTurn: 0.12,
  /** The flare where a card burns out or an ability is done: how big it grows. */
  flare: 1.6,
  /** A well's lands lie a little proud of the page, its pool under them; at most this many show (h.js `well`). */
  well: { proud: 0.03, step: TH + 0.002, glow: 0.028, show: 4 },
  /** A well's sign (h.js: propped up 0.95 from flat, in front of mine, over the card on theirs), its world size. */
  wellSign: { tilt: 0.95, mine: [-0.14, -0.66] as const, theirs: -CH * 0.32, up: 0.12, upFar: 0.2, theirsFit: CW * 1.15 },
  /** Auras and Equipment peek out from behind their host, up and to the right, a size smaller (h.js `standee`). */
  dressing: { s: 0.8, x: 0.16, dx: 0.1, y: 0.34, dy: 0.2, z: -0.03, dz: -0.02, turn: -0.08 },
  /** A stack card's drop shadow (h.js `buildStack`), keeping it off the page. */
  drop: { x: 0.05, y: -0.08, z: -TH * 3, s: 0.95 },
} as const;

/** The frame's clock for the effects: seconds, and whether motion is reduced. */
export interface Clock {
  readonly t: number;
  readonly still: boolean;
}

/** How strong a piece's effects are at its dim (h.js: to a quarter in the background of a side leaned in on). */
const fxLevel = (fade: number): number => Math.round((1 - 0.75 * Math.min(1, fade / 0.92)) * 50) / 50;


const VELLUM_TILE = 9;

/** What every piece view does. */
export interface PieceView {
  readonly group: Group;
  /** Its mods changed (or art arrived): repaint what it shows. */
  patch(v: ActorView): void;
  /** Every frame: the cheap channels (tap, dim, the mark's glow) and its effects' clock. */
  look(v: ActorView, clock: Clock): void;
  /** The face of the card it shows on top, for the layout audit's measures (view.ts `measure`); none for a page or plate. */
  front?(): Mesh | null;
  dispose(): void;
}

/**
 * What stands in front of what it is drawn over, for the layout audit (view.ts `under`): cards and their edges, and the
 * labels drawn on or over them (signs, tabs, chips, plates, tags). Effects, shadows and the pages are not.
 */
export const COVERS = "covers";
/** Marks a label (a pile's title, a well's or a zone's sign): its lines' font sizes on its canvas, and the canvas's
 * height, so the layout audit can read its text's size on screen (view.ts `labels`). */
export const LABEL = "label";
/**
 * A label's tag: its lines' fonts and its canvas's height; the text size it keeps on screen (`want`, CSS px: the renderer
 * scales it each frame, `fitLabels`); and for a tab standing on a card, the card's top edge it stands on and how far it
 * overlaps it (px).
 */
export interface LabelTag {
  readonly fonts: readonly number[];
  readonly h: number;
  readonly want?: number;
  readonly foot?: number;
  readonly overlap?: number;
}
const LABEL_OVERLAP = 3;
/**
 * A sign's lesser forms (a well's, a zone's), on its mesh: hidden until the renderer falls back on one where the sign
 * would meet another label (view.ts `settleSigns`): the sign on one line (its second dropped, never shrunk under the
 * floor), then its count as a chip on its card's face, which cannot meet anything.
 */
export const SIGN_ALTS = "signAlts";
export interface SignAlts {
  readonly line: Mesh | null;
  readonly chip: Mesh | null;
}
const labelled = (d: { mesh: Mesh }, lease: Lease, fonts: readonly number[], want?: number): void =>
  void (d.mesh.userData[LABEL] = { fonts, h: lease.height, ...(want ? { want } : {}) } satisfies LabelTag);
const covers = (o: Mesh): Mesh => ((o.userData[COVERS] = true), o);

/** What pieces are made with: the host, its effects kit and the camera's pitch. */
export interface PieceEnv {
  readonly host: Host;
  readonly fx: FxKit;
  readonly pitch: number;
}

/** The pose channels onto a group: position (lifted), rotation (yaw then pitch), scale. */
export function placeGroup(g: Group, s: Sample): void {
  g.position.set(s.pos.x, s.pos.y + s.lift, s.pos.z);
  g.rotation.order = "YXZ";
  g.rotation.set(s.rx, s.ry, 0);
  g.scale.setScalar(Math.max(1e-4, s.s));
}

/**
 * Leases a face's texture, with its art only once it is decoded (a face repaints when its art arrives). A face already
 * painted with its art is kept as it is: its bitmap may since have been evicted, and asking for it again would load
 * it again for nothing (and, with more art on show than the decoded-art budget holds, for ever).
 */
function faceLease(host: Host, spec: FaceSpec | null): Lease {
  if (!spec) return host.painter.back();
  if (!spec.art) return host.painter.face(spec);
  const painted = host.painter.paintedFace(spec);
  if (painted) return painted;
  return host.painter.face(host.art(spec.art) ? spec : { ...spec, art: null });
}

/** The art urls a view's faces want: the art arriving for one of them is what repaints it. */
export function artWanted(v: ActorView): readonly string[] {
  const urls: string[] = [];
  if (v.face?.art) urls.push(v.face.art);
  if (v.draw.t === "plate" && v.draw.spec.art) urls.push(v.draw.spec.art);
  if (v.draw.t === "unit") for (const d of v.draw.dressed) if (d.face.art) urls.push(d.face.art);
  if (v.draw.t === "stack" && v.draw.img) urls.push(v.draw.img);
  return urls;
}

/** One card: its object and the face it wears, re-leased when the face changes. */
class CardPart {
  readonly obj: CardObject;
  private lease: Lease;
  constructor(
    private readonly host: Host,
    spec: FaceSpec | null,
    options: CardOptions = {},
  ) {
    this.lease = faceLease(host, spec);
    this.obj = createCard(host.kit, this.lease.texture, options);
    this.obj.group.traverse((o) => (o as Mesh).isMesh && covers(o as Mesh));
  }
  face(spec: FaceSpec | null): void {
    const next = faceLease(this.host, spec);
    if (next.key === this.lease.key) return next.release();
    this.lease.release();
    this.lease = next;
    this.obj.material.map = next.texture;
  }
  /** `shaded`: tapped without the turn (a spent well's card, a sifted tapped card). */
  look(tap: number, fade: number, mark: ActorView["mark"], glow: number, shaded = false): void {
    this.obj.body.rotation.z = -tap * (Math.PI / 2);
    setLook(this.obj.material, { tap: tap > 0.5 || shaded ? 1 : 0, dim: fade, turn: tap });
    setSignal(this.obj.material, this.host.rim, glow > 0.5 ? mark : null);
  }
  dispose(): void {
    this.lease.release();
    this.obj.dispose();
  }
}

/** A textured plane, its lease and material owned. */
class Decal {
  readonly mesh: Mesh;
  private readonly geo: PlaneGeometry;
  private readonly mat: MeshBasicMaterial;
  constructor(
    private lease: Lease,
    w: number,
    h: number,
    opts: { depthTest?: boolean; renderOrder?: number; covers?: boolean } = {},
  ) {
    this.geo = new PlaneGeometry(w, h);
    this.mat = new MeshBasicMaterial({ map: lease.texture, transparent: true, depthWrite: false, depthTest: opts.depthTest ?? true });
    this.mat.toneMapped = false;
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.renderOrder = opts.renderOrder ?? 5;
    if (opts.covers !== false) covers(this.mesh);
  }
  set(lease: Lease): void {
    if (lease.key === this.lease.key) return lease.release();
    this.lease.release();
    this.lease = lease;
    this.mat.map = lease.texture;
  }
  tone(k: number): void {
    this.mat.color.setScalar(k);
  }
  dispose(): void {
    this.lease.release();
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---- a unit ---------------------------------------------------------------------------------------------------------

/**
 * A group lying on the page at a card's foot, its axes the world's (+y up off the page, +z toward me), however the card
 * stands: where ash, shadows, brands, pools and a well's sign lie. Re-aimed every frame against the card's pitch.
 */
/** Marks a ground: what lies on the page stays under the stack's scrim when its piece stands above it. */
export const GROUND = "ground";

class Ground {
  readonly group = new Group();
  constructor(parent: Group) {
    this.group.userData[GROUND] = true;
    this.group.position.set(0, -CH / 2, 0);
    parent.add(this.group);
  }
  follow(rx: number): void {
    this.group.rotation.x = -rx;
  }
}

/** The effect a mark brings, under a piece: embers (option), gilt (selected) or the sigil (danger). */
class MarkFx {
  private effect: Effect | null = null;
  private kind: ActorView["mark"] = null;
  constructor(
    private readonly kit: FxKit,
    private readonly ground: Group,
    private readonly seed: number,
    private readonly embers: boolean,
    private readonly flat: boolean,
  ) {}
  set(mark: ActorView["mark"]): void {
    if (mark === this.kind) return;
    this.clear();
    this.kind = mark;
    if (mark === "danger") this.effect = sigilFx(this.kit, this.seed);
    else if (mark === "option" && this.embers) this.effect = emberFx(this.kit, this.seed);
    else if (mark === "selected") {
      this.effect = chosenFx(this.kit);
      if (this.flat) this.effect.object.scale.set(1.1, 1, 1.2);
    }
    if (this.effect) this.ground.add(this.effect.object);
  }
  tick(c: Clock, level: number): void {
    this.effect?.tick(c.t, level, c.still);
  }
  clear(): void {
    if (this.effect) {
      this.ground.remove(this.effect.object);
      this.effect.dispose();
    }
    this.effect = null;
    this.kind = null;
  }
}

/**
 * A pile's tapped copy shows this share of a card's height past the front card's right edge (a creature's place is 1.06
 * card heights: this much still clears a turned neighbour's stats); a well's lies turned 15°.
 */
const TAPPED_SHOW = 0.18;
const WELL_TURN = Math.PI / 12;

class UnitView implements PieceView {
  readonly group = new Group();
  /** What lies under the cards and turns with the pile's tap: its block and its contact shadow. */
  private readonly pile = new Group();
  private block: Block | null = null;
  private contact: Contact | null = null;
  private readonly cast: CastShadow;
  private lift = 0;
  private cards: CardPart[] = [];
  private dress: CardPart[] = [];
  private dressKey = "";
  private sign: Decal | null = null;
  private chips: Decal[] = [];
  private key = "";
  private copyKey = "";
  private readonly ground: Ground;
  private readonly marks: MarkFx;
  /** The light it stands in: a pale pool, or mist while it is not yet awake. */
  private stand: { effect: Effect; tone: StandTone } | null = null;
  /** The cue on a pile that holds something that matters. */
  private mote: { effect: Effect; cue: "act" | "threat" } | null = null;
  private well: { effect: Effect; key: string } | null = null;
  private wellSign: Decal | null = null;
  private wellAlts: Decal[] = [];

  constructor(
    private readonly env: PieceEnv,
    v: ActorView,
  ) {
    const d = v.draw as Extract<Draw, { t: "unit" }>;
    this.group.add(this.pile);
    this.cast = new CastShadow(env.host);
    this.group.add(this.cast.mesh);
    this.ground = new Ground(this.group);
    this.marks = new MarkFx(env.fx, this.ground.group, d.seed, d.unit !== "well", d.posture !== "stand");
    this.patch(v);
  }

  private get host(): Host {
    return this.env.host;
  }

  front(): Mesh | null {
    return this.cards[0]?.obj.front ?? null;
  }

  patch(v: ActorView): void {
    const d = v.draw as Extract<Draw, { t: "unit" }>;
    const well = d.well;
    const copies = Math.min(Math.max(1, d.copies.length), well ? Math.max(1, Math.min(well.shown, v.shown)) : Math.max(1, Math.min(SIZE.copies, v.shown)));
    // Each copy stands for members of the pile and wears their state (while members are still arriving, the first).
    const plan = d.copies.length ? d.copies.slice(0, copies) : [{ face: null, tapped: false }];
    const copyKey = plan.map((c) => (c.tapped ? "t" : "r")).join("") + `|${copies}|${d.posture}|${d.mixed}`;
    if (this.cards.length !== this.drawnOf(plan, d).length || this.copyKey !== copyKey) {
      for (const c of this.cards) {
        this.group.remove(c.obj.group);
        c.dispose();
      }
      this.cards = [];
      this.copyKey = copyKey;
      this.lift = 0;
      const drawn = this.drawnOf(plan, d);
      const mixedTap = drawn.some((c) => c.tapped) && drawn.some((c) => !c.tapped);
      const upright = uprightOf(d.posture);
      const ready = drawn.filter((c) => !c.tapped).length;
      drawn.forEach((cp, i) => {
        const c = new CardPart(this.host, cp.face ?? v.face, { token: d.token });
        if (well) {
          // A well's lands lie in a short stack, the top one first; its tapped ones at the bottom, turned 15° about the
          // stack's middle (all of them, when every one is spent). Each is one slab over the one under it.
          c.obj.group.position.set(0, 0, slab.depth * (drawn.length - 1 - i));
          if (cp.tapped) c.obj.group.rotation.z = -WELL_TURN;
        } else if (mixedTap && cp.tapped) {
          // Behind the ready ones, turned as a lone tapped card is, a share of it showing past the front card's right
          // edge, feet on the front card's foot line (a standee leans back as a tapped one does).
          const cx = CW / 2 + TAPPED_SHOW * CH - CH / 2, cy = -CH / 2 + CW / 2, z = -slab.depth * (i - ready + 1);
          if (d.posture === "stand") {
            c.obj.group.rotation.x = -TAP_LEAN;
            c.obj.group.position.set(cx, cy - (CW / 2) * (1 - Math.cos(TAP_LEAN)), z - (CW / 2) * Math.sin(TAP_LEAN));
          } else c.obj.group.position.set(cx, cy, z);
        } else {
          // Unlike cards are a staircase: each one slab under the one over it, turned a little past it, its edge showing.
          const st = SIZE.copyStep;
          c.obj.group.position.set(st.x * i, st.y * i, upright ? -slab.depth * i : slab.depth * (ready - 1 - i));
          c.obj.group.rotation.z = slab.stairTurn * i;
        }
        c.obj.group.userData["tapped"] = cp.tapped && (mixedTap || !!well);
        this.cards.push(c);
        this.group.add(c.obj.group);
      });
    } else {
      const drawn = this.drawnOf(plan, d);
      this.cards.forEach((c, i) => c.face(drawn[i]?.face ?? v.face));
    }
    this.presence(v, d);
    this.light(d, v.mark);
    this.dressing(d);
    this.wellLook(d);
    const turned = !!v.face?.tapped;
    // A pile whose title gave way (no room on screen) shows its count as a chip on its face.
    const chip = (d.title === null || d.label === null) && v.shown > 1 && !well;
    const key = `${d.tapNote ?? ""}|${d.title ?? ""}|${d.label ? `${d.label.name}|${d.label.px}|${d.label.slide}` : ""}|${turned}|${d.chips.map((c) => c.text + c.sub).join(",")}|${chip ? v.shown : ""}|${!!well}`;
    if (key === this.key) return;
    this.key = key;
    this.sign?.dispose();
    if (this.sign) this.group.remove(this.sign.mesh);
    this.sign = null;
    if (d.title && d.label && !well) this.sign = this.titleTab(d, turned);
    for (const c of this.chips) {
      this.cards[0]!.obj.body.remove(c.mesh);
      c.dispose();
    }
    this.chips = [];
    // (A well's count is on its sign.)
    const specs = [...d.chips, ...(chip ? [{ text: `×${v.shown}`, ink: colour.ink, sub: null }] : [])];
    specs.forEach((spec, i) => {
      const chip = new Decal(this.host.painter.chip(spec), SIZE.chip, SIZE.chip, { renderOrder: 6 });
      chip.mesh.position.set(SIZE.chipAt.x - i * SIZE.chipStep, SIZE.chipAt.y, SIZE.chipAt.z);
      this.cards[0]!.obj.body.add(chip.mesh);
      this.chips.push(chip);
    });
  }

  /**
   * The light under it: a presented (standing) card is lifted on a pale pool, or stands in mist while it is not yet
   * awake; a pile holding something that matters glows low under it and a mote rises from it.
   */
  private light(d: Extract<Draw, { t: "unit" }>, mark: ActorView["mark"]): void {
    const tone: StandTone | null = mark === "option" ? "ember" : d.posture === "stand" ? (d.sick ? "mist" : "pale") : null;
    if (this.stand && this.stand.tone !== tone) {
      this.ground.group.remove(this.stand.effect.object);
      this.stand.effect.dispose();
      this.stand = null;
    }
    if (tone && !this.stand) {
      this.stand = { effect: standFx(this.env.fx, tone), tone };
      this.ground.group.add(this.stand.effect.object);
    }
    if (this.mote && this.mote.cue !== d.cue) {
      this.ground.group.remove(this.mote.effect.object);
      this.mote.effect.dispose();
      this.mote = null;
    }
    if (d.cue && !this.mote) {
      this.mote = { effect: moteFx(this.env.fx, d.seed, d.cue), cue: d.cue };
      // On the page under the pile's middle: behind a standing pile's foot, a card's length in from a lying one's.
      this.ground.group.add(this.mote.effect.object);
      this.mote.effect.object.position.set(0, 0, uprightOf(d.posture) ? -0.25 : -CH / 2);
    }
  }

  /**
   * The cards a unit draws whole: a well's short stack; a staircase of unlike cards; of identical cards only the top one
   * (and a tapped copy behind it), the rest being the block under it.
   */
  private drawnOf(plan: readonly { face: FaceSpec | null; tapped: boolean }[], d: Extract<Draw, { t: "unit" }>): readonly { face: FaceSpec | null; tapped: boolean }[] {
    if (d.well) return plan;
    if (d.mixed) return plan.slice(0, slab.stairShow);
    const top = plan.find((c) => !c.tapped) ?? plan[0];
    const spent = plan.find((c) => c.tapped);
    return [top, top !== spent ? spent : undefined].filter((c): c is { face: FaceSpec | null; tapped: boolean } => !!c);
  }

  /**
   * The unit as a thing on the vellum: the block of the cards it does not draw whole under (lying) or behind (standing)
   * the ones it does, its height its count; a lying unit rides on its block, its contact shadow under the lot.
   */
  private presence(v: ActorView, d: Extract<Draw, { t: "unit" }>): void {
    const upright = uprightOf(d.posture);
    const rest = Math.max(0, v.shown - this.cards.length);
    const h = d.well || d.mixed ? blockHeight(rest, slab.depth) : blockHeight(rest);
    const ready = this.cards.filter((c) => c.obj.group.userData["tapped"] !== true).length;
    const base = TH / 2 - slab.depth;
    if (h > 0 && !this.block) {
      this.block = new Block(this.host, d.token);
      this.pile.add(this.block.mesh);
    }
    this.block?.set(rest, h);
    // Standing, the block stands behind the hindmost card; lying, under the lowest, and everything rides up on it.
    if (this.block) this.block.mesh.position.z = upright ? base - slab.depth * Math.max(0, ready - 1) : base + h;
    const lift = upright ? 0 : h;
    if (lift !== this.lift) {
      for (const c of this.cards) c.obj.group.position.z += lift - this.lift;
      this.lift = lift;
    }
    if (!upright && !this.contact) {
      this.contact = new Contact(this.host);
      this.pile.add(this.contact.mesh);
    }
    if (this.contact) this.contact.mesh.position.z = base - 0.002;
    // The cast shadow is the top card's (a block's top throws it past the block's far edge).
    const top = this.cards[0];
    if (top && this.cast.anchor.parent !== top.obj.body) top.obj.body.add(this.cast.anchor);
    this.cast.anchor.position.z = TH / 2;
  }

  /**
   * A pile's title on a tab standing up from its top card's top edge, as the ledger placed it (stage labels.ts): one
   * line, its text kept at its size on screen by the renderer (`fitLabels`), slid along the edge by its share of a card.
   */
  private titleTab(d: Extract<Draw, { t: "unit" }>, turned: boolean): Decal {
    const l = d.label!;
    const count = /(\d+)$/.exec(d.title ?? "")?.[1] ?? "";
    const lease = this.host.painter.sign({ text: [l.name, count, d.tapNote].filter(Boolean).join(" "), colour: null, sub: null });
    const top = turned ? CW / 2 : CH / 2, across = turned ? CH : CW;
    const tab = new Decal(lease, lease.width * SIGN_U, lease.height * SIGN_U);
    tab.mesh.userData[LABEL] = { fonts: [SIGN_FONT.text], h: lease.height, want: l.px, foot: top, overlap: LABEL_OVERLAP } satisfies LabelTag;
    tab.mesh.position.set(l.slide * across, top, TH / 2 + 0.03);
    this.group.add(tab.mesh);
    return tab;
  }

  /** Auras and Equipment on the top card, peeking out from behind it (h.js `standee`/`flat`: up and to the right). */
  private dressing(d: Extract<Draw, { t: "unit" }>): void {
    const want = d.dressed.map((x) => x.face);
    const key = want.map(faceKey).join(",");
    // The same cards: each re-leases its face only if its art has since arrived (a painted face replaces the plain one).
    if (key === this.dressKey) {
      this.dress.forEach((c, k) => c.face(want[k]!));
      return;
    }
    this.dressKey = key;
    for (const c of this.dress) {
      this.group.remove(c.obj.group);
      c.dispose();
    }
    const z = SIZE.dressing;
    this.dress = want.map((face, k) => {
      const c = new CardPart(this.host, face, { token: face.token });
      c.obj.group.scale.setScalar(z.s);
      c.obj.group.position.set(z.x + k * z.dx, z.y + k * z.dy, z.z + k * z.dz);
      c.obj.group.rotation.z = z.turn;
      this.group.add(c.obj.group);
      return c;
    });
  }

  /** A well's pool under its lands and its sign (mine in front, alternating rows; theirs over the card in its seat's colour). */
  private wellLook(d: Extract<Draw, { t: "unit" }>): void {
    const w = d.well;
    const key = w ? `${w.colours.join("")}|${w.spent}|${d.seed}` : "";
    if (this.well && this.well.key !== key) {
      this.group.remove(this.well.effect.object);
      this.well.effect.dispose();
      this.well = null;
    }
    if (w && !this.well) {
      const effect = wellFx(this.env.fx, w.colours, d.seed, w.spent, CW, CH);
      // Its light lies on the vellum under the lands, spilling round them.
      effect.object.position.set(0, 0, TH / 2 - slab.depth - 0.003);
      this.group.add(effect.object);
      this.well = { effect, key };
    }
    if (this.wellSign) {
      this.ground.group.remove(this.wellSign.mesh);
      this.wellSign.dispose();
      this.wellSign = null;
    }
    for (const a of this.wellAlts) {
      a.mesh.removeFromParent();
      a.dispose();
    }
    this.wellAlts = [];
    if (!w) return;
    const ws = SIZE.wellSign, z = w.theirs ? ws.theirs : ws.mine[w.alt ? 1 : 0];
    const signOf = (sub: string | null): Decal => {
      const lease = this.host.painter.sign({ text: w.sign, colour: w.theirs ? d.seatColour : null, sub });
      const sign = new Decal(lease, lease.width * SIGN_U, lease.height * SIGN_U);
      labelled(sign, lease, sub ? [SIGN_FONT.text, SIGN_FONT.sub] : [SIGN_FONT.text], LABEL_PX.theirs);
      sign.mesh.rotation.x = -Math.PI / 2 + ws.tilt;
      // Its size in the world: theirs fits the card's width; mine is a sign's own size, a little smaller in a long row.
      const fit = w.theirs ? Math.min(1, ws.theirsFit / (lease.width * SIGN_U)) : w.small ? 0.8 : 1;
      sign.mesh.userData["fit"] = fit;
      const clear = ((lease.height * SIGN_U * fit) / 2) * Math.sin(ws.tilt) + 0.05;
      sign.mesh.position.set(0, Math.max(z < 0 ? ws.upFar : ws.up, clear) + this.lift, z);
      sign.mesh.renderOrder = 6;
      this.ground.group.add(sign.mesh);
      return sign;
    };
    const sign = signOf(w.sub), line = w.sub ? signOf(null) : null;
    const chip = this.cards[0] ? countChip(this.host, w.sign, this.cards[0].obj.body) : null;
    this.wellAlts = [line, chip].filter((x): x is Decal => x !== null);
    for (const a of this.wellAlts) a.mesh.visible = false;
    sign.mesh.userData[SIGN_ALTS] = { line: line?.mesh ?? null, chip: chip?.mesh ?? null } satisfies SignAlts;
    this.wellSign = sign;
  }

  look(v: ActorView, clock: Clock): void {
    const d = v.draw as Extract<Draw, { t: "unit" }>;
    const s = v.sample;
    // A well's card lies square however spent it is: its shade (and its badge) say tapped, never a turn.
    const spent = !!d.well?.spent;
    // A copy standing for tapped members is turned (a pile's) or shaded (a well's) on its own; the rest follow the pile.
    for (const c of this.cards) {
      const own = c.obj.group.userData["tapped"] === true;
      c.look(d.well ? 0 : own ? 1 : s.tap, s.fade, v.mark, s.glow, spent || own);
    }
    for (const c of this.dress) c.look(0, s.fade, null, 0);
    this.sign?.tone(1 - 0.8 * s.fade);
    this.ground.follow(s.rx);
    for (const sign of this.wellSign ? [this.wellSign, ...this.wellAlts] : []) {
      // Mine are a sign's own size in the world, whatever the well's scale; theirs fit the card. (The chip has no fit.)
      const fit = sign.mesh.userData["fit"] as number | undefined;
      if (fit !== undefined) sign.mesh.scale.setScalar(d.well?.theirs ? fit : fit / Math.max(1e-3, s.s));
      sign.tone(1 - 0.8 * s.fade);
    }
    const level = fxLevel(s.fade);
    this.marks.set(v.mark);
    this.marks.tick(clock, level);
    // Tapped loses the light (but what I can act on keeps its ember); gilt and the sigil replace the pale pool.
    const lit = this.stand?.tone === "ember" ? 1 : s.tap > 0.5 || v.mark ? 0 : 1;
    this.stand?.effect.tick(clock.t, level * lit, clock.still);
    this.mote?.effect.tick(clock.t, level, clock.still);
    this.well?.effect.tick(clock.t, level, clock.still);
    // The block and the contact shadow turn with the pile; the cast shadow is the lamp's own.
    this.pile.rotation.z = d.well ? 0 : -s.tap * (Math.PI / 2);
    this.block?.tone(1 - 0.75 * s.fade);
    this.contact?.fade(1 - 0.5 * s.fade);
    this.cast.fade(1 - 0.6 * s.fade);
    this.cast.ground = this.ground.group.getWorldPosition(FOOT).y - slab.depth * s.s;
  }

  dispose(): void {
    for (const c of this.cards) c.dispose();
    for (const c of this.dress) c.dispose();
    this.sign?.dispose();
    this.wellSign?.dispose();
    for (const a of this.wellAlts) a.dispose();
    for (const c of this.chips) c.dispose();
    this.marks.clear();
    this.stand?.effect.dispose();
    this.mote?.effect.dispose();
    this.well?.effect.dispose();
    this.block?.dispose();
    this.contact?.dispose();
    this.cast.dispose();
  }
}

/** A sign's count ("Mountain ×4", "Graveyard 3": its last number) as a chip on its card's face, where the counter chips sit. */
function countChip(host: Host, sign: string, on: Object3D): Decal {
  const n = /(\d+)\s*$/.exec(sign)?.[1] ?? "";
  const chip = new Decal(host.painter.chip({ text: `×${n}`, ink: colour.ink, sub: null }), SIZE.chip, SIZE.chip, { renderOrder: 6 });
  chip.mesh.position.set(SIZE.chipAt.x, SIZE.chipAt.y, SIZE.chipAt.z);
  on.add(chip.mesh);
  return chip;
}

// ---- a zone pile ----------------------------------------------------------------------------------------------------

class ZoneView implements PieceView {
  readonly group = new Group();
  private readonly lean = new Group();
  private readonly body = new Group();
  private readonly block: Block;
  private readonly contact: Contact;
  private readonly cast: CastShadow;
  private top: CardPart | null = null;
  private sign: Decal | null = null;
  private chip: Decal | null = null;
  private key = "";

  constructor(
    private readonly host: Host,
    v: ActorView,
  ) {
    const d = v.draw as Extract<Draw, { t: "zone" }>;
    // h.js `zoneLean`: propped from its near edge for an opponent, so its top card and count read across the table.
    this.lean.position.z = CH / 2;
    this.lean.rotation.x = d.mine ? 0 : PILE_LEAN;
    this.body.position.z = -CH / 2;
    this.lean.add(this.body);
    this.group.add(this.lean);
    // The cards under the top one: a block of stock, its height its count, its strata on its walls.
    this.block = new Block(host, false);
    this.contact = new Contact(host);
    this.cast = new CastShadow(host);
    this.group.add(this.cast.mesh);
    this.patch(v);
  }

  patch(v: ActorView): void {
    const d = v.draw as Extract<Draw, { t: "zone" }>;
    const n = v.shown;
    const h = pileHeight(n);
    if (!this.top) {
      this.top = new CardPart(this.host, v.face);
      this.top.obj.group.rotation.x = -Math.PI / 2;
      if (d.zone === "exile") this.top.obj.group.rotation.z = SIZE.exileTurn;
      this.body.add(this.top.obj.group);
      this.top.obj.group.add(this.block.mesh, this.contact.mesh, this.cast.anchor);
      this.cast.anchor.position.z = TH / 2;
    } else this.top.face(v.face);
    // The top card's stock rests on the block, the block on the vellum.
    this.top.obj.group.position.y = h + slab.depth - TH / 2;
    this.block.set(Math.max(0, n - 1), h);
    this.block.mesh.position.z = TH / 2 - slab.depth;
    this.contact.mesh.position.z = TH / 2 - slab.depth - h - 0.002;
    const word = d.zone === "graveyard" ? "Graveyard" : "Exile";
    const key = `${word} ${n}|${d.colour}`;
    if (key === this.key) return;
    this.key = key;
    const lease = this.host.painter.sign({ text: `${word} ${n}`, colour: d.colour, sub: null });
    if (this.sign) this.sign.set(lease);
    else {
      this.sign = new Decal(lease, 1, 1, { renderOrder: 6 });
      this.body.add(this.sign.mesh);
    }
    if (this.sign) labelled(this.sign, lease, [SIGN_FONT.text], LABEL_PX.theirs);
    // Both signs take the size the longer word fits at, so their counts read alike (h.js: "Graveyard 00").
    const ref = this.host.painter.sign({ text: "Graveyard 00", colour: d.colour, sub: null });
    const w = lease.width * SIGN_U,
      hh = lease.height * SIGN_U,
      k = Math.min(1, (CW + 0.3) / Math.max(w, ref.width * SIGN_U));
    ref.release();
    this.sign.mesh.scale.set(w * k, hh * k, 1);
    this.sign.mesh.rotation.x = -Math.PI / 2 + SIZE.zoneSignTilt;
    this.sign.mesh.position.set(0, h + 0.06, d.mine ? 0.3 : 0.12);
    this.chip?.mesh.removeFromParent();
    this.chip?.dispose();
    this.chip = countChip(this.host, `${n}`, this.top.obj.body);
    this.chip.mesh.visible = false;
    this.sign.mesh.userData[SIGN_ALTS] = { line: null, chip: this.chip.mesh } satisfies SignAlts;
  }

  front(): Mesh | null {
    return this.top?.obj.front ?? null;
  }

  look(v: ActorView): void {
    this.top?.look(0, v.sample.fade, v.mark, v.sample.glow);
    this.cast.fade(1 - 0.6 * v.sample.fade);
    this.cast.ground = this.group.getWorldPosition(FOOT).y;
    this.sign?.tone(1 - 0.8 * v.sample.fade);
  }

  dispose(): void {
    this.top?.dispose();
    this.sign?.dispose();
    this.chip?.dispose();
    this.block.dispose();
    this.contact.dispose();
    this.cast.dispose();
  }
}

// ---- a plate --------------------------------------------------------------------------------------------------------

/** A plaque standing at its placement, leaned back by the camera's pitch, drawn over everything on the table. */
export function buildPlate(lease: Lease, pitch: number): { outer: Group; decal: Decal; set(l: Lease): void; dispose(): void } {
  const decal = new Decal(lease, SIZE.plate.w, SIZE.plate.h, { depthTest: false, renderOrder: 10 });
  decal.mesh.position.y = SIZE.plate.y;
  const pivot = new Group(),
    outer = new Group();
  pivot.add(decal.mesh);
  pivot.rotation.x = -pitch;
  outer.add(pivot);
  return { outer, decal, set: (l) => decal.set(l), dispose: () => decal.dispose() };
}

class PlateView implements PieceView {
  readonly group = new Group();
  private readonly plate: ReturnType<typeof buildPlate>;
  constructor(
    private readonly host: Host,
    v: ActorView,
    pitch: number,
  ) {
    this.plate = buildPlate(this.lease(v), pitch);
    this.group.add(this.plate.outer);
  }
  private lease(v: ActorView): Lease {
    const d = v.draw as Extract<Draw, { t: "plate" }>;
    // As faces: a plate painted with its portrait keeps it, decoded or not.
    const painted = d.spec.art ? this.host.painter.paintedPlate(d.spec) : null;
    if (painted) return painted;
    const art = d.spec.art && this.host.art(d.spec.art) ? d.spec.art : null;
    return this.host.painter.plate({ ...d.spec, art });
  }
  patch(v: ActorView): void {
    this.plate.set(this.lease(v));
  }
  look(v: ActorView): void {
    // Dimmed, never dark: the name and life still read (h.js: `1 - 0.55 * f`). Gone under a sift's shade.
    this.plate.decal.tone(1 - 0.55 * v.sample.fade);
    this.plate.outer.visible = v.sample.alpha > 0.02;
  }
  dispose(): void {
    this.plate.dispose();
  }
}

// ---- a stack card ---------------------------------------------------------------------------------------------------

/**
 * A spell or ability on the stack: the card on a drop shadow (never a glow, so it can't be read as a halo), its owner's
 * tag under it (the size it was set aside, however large the card stands as the focus), its mana crackling off its rim
 * (an ability's half as strong), igniting as it comes. As the table's focus it draws over everything on the table.
 */
/** How long the printed card takes to come up over the painted face as the stack rises (and back as it is set aside). */
const PRINT_FADE_S = motion.stackPrint / 1000;
/** Set aside, a stack card is edged in its controller's seat ink (about 3 px at that size) instead of its tag. */
const STACK_EDGE = 0.06;
/** The tag's least scale under a card held up (about 22 px tall at the focus's size). */
const STACK_TAG_MIN = 0.26;

class StackView implements PieceView {
  readonly group = new Group();
  private readonly card: CardPart;
  private readonly tag: Decal;
  private readonly drop: Decal;
  private readonly crackle: Effect;
  private burst: Effect | null = null;
  private born: number | null = null;
  private up = false;
  /** The printed card over the painted face, and the seat's edge round it set aside. */
  private readonly print: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private printLease: Lease | null = null;
  private printUrl: string | null = null;
  private readonly edge: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private slip: Decal | null = null;
  private slipText: string | null = null;
  /** When `up` last changed (the clock's seconds; null: not yet drawn), and how far the print had come then. */
  private turned: number | null = null;
  private fadeFrom = 0;
  private fade = 0;
  private wanted = 0;
  private tagScale = 1;
  constructor(
    private readonly env: PieceEnv,
    v: ActorView,
  ) {
    const host = env.host;
    const d = v.draw as Extract<Draw, { t: "stack" }>;
    this.card = new CardPart(host, v.face);
    this.tag = new Decal(host.painter.tag(d.tag, d.colour), SIZE.tag.w, SIZE.tag.h, { renderOrder: 6 });
    this.tag.mesh.position.set(0, SIZE.tag.y, 0.02);
    this.drop = new Decal(host.painter.drop(), CW * 1.62 * SIZE.drop.s, CH * 1.46 * SIZE.drop.s, { renderOrder: 4, covers: false });
    this.drop.mesh.position.set(SIZE.drop.x, SIZE.drop.y, SIZE.drop.z);
    (this.drop.mesh.material as MeshBasicMaterial).opacity = materials.surface.drop.opacity;
    this.print = new Mesh(new PlaneGeometry(CW, CH), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.print.position.z = this.card.obj.front.position.z + 0.002;
    this.print.visible = false;
    covers(this.print);
    this.edge = new Mesh(new PlaneGeometry(CW + STACK_EDGE, CH + STACK_EDGE * (CW / CH) * 1.4), new MeshBasicMaterial({ color: new Color(d.colour), toneMapped: false }));
    this.edge.position.z = -0.001;
    const seed = typeof v.id === "string" ? [...v.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) : 7;
    this.crackle = spellFx(env.fx, d.colours, seed, d.ability ? 0.5 : 1, CW);
    this.burst = burstFx(env.fx, d.colours, seed, Number.NaN);
    this.group.add(this.drop.mesh, this.edge, this.card.obj.group, this.print, this.tag.mesh, this.crackle.object, this.burst.object);
    this.dress(d);
    this.raise(d.up);
    this.sizeTag(d.tagScale);
  }
  /** Over everything on the table while it is the focus (h.js: renderOrder 10). */
  private raise(up: boolean): void {
    this.up = up;
    this.group.traverse((o) => {
      if (o === this.crackle.object || o.parent === this.crackle.object || o === this.burst?.object) return;
      if ((o as Mesh).isMesh) o.renderOrder = up ? (o === this.print ? 12 : o === this.tag.mesh || o === this.slip?.mesh ? 13 : 11) : o === this.drop.mesh ? 4 : o === this.tag.mesh ? 6 : o === this.print ? 1 : 0;
    });
  }
  /** The printed image (leased once it is decoded) and an ability's slip. */
  private dress(d: Extract<Draw, { t: "stack" }>): void {
    if (d.img !== this.printUrl || !this.printLease) {
      const next = d.img ? this.env.host.painter.printed(d.img) : null;
      if (next && next.key === this.printLease?.key) next.release();
      else {
        this.printLease?.release();
        this.printLease = next;
        this.print.material.map = next ? next.texture : null;
        this.print.material.needsUpdate = true;
      }
      this.printUrl = d.img;
    }
    if (d.slip !== this.slipText) {
      if (this.slip) {
        this.group.remove(this.slip.mesh);
        this.slip.dispose();
        this.slip = null;
      }
      if (d.slip) {
        const lease = this.env.host.painter.slip(d.slip);
        const w = CW * 1.15, h = (w * lease.height) / lease.width;
        this.slip = new Decal(lease, w, h, { renderOrder: 6 });
        this.slip.mesh.position.set(0, SIZE.tag.y - SIZE.tag.h / 2 - 0.015 - h / 2, 0.02);
        this.group.add(this.slip.mesh);
        if (this.up) this.raise(true);
        this.sizeTag(this.tagScale);
      }
      this.slipText = d.slip;
    }
  }
  front(): Mesh | null {
    return this.card.obj.front;
  }
  patch(v: ActorView): void {
    const d = v.draw as Extract<Draw, { t: "stack" }>;
    this.card.face(v.face);
    this.tag.set(this.env.host.painter.tag(d.tag, d.colour));
    this.edge.material.color.set(d.colour);
    this.dress(d);
    if (d.up !== this.up) this.raise(d.up);
    this.sizeTag(d.tagScale);
  }
  /** Held up as the focus the controller's tag hangs under the printed card, about the size it reads at set aside (h.js:
   * `mid / hPx`) but never smaller than a readable share; an ability's slip hangs under it. */
  private sizeTag(k: number): void {
    this.tagScale = k;
    const s = this.up ? Math.max(STACK_TAG_MIN, k) : k;
    this.tag.mesh.scale.setScalar(s);
    this.tag.mesh.position.y = this.up ? -CH / 2 - 0.01 - (SIZE.tag.h * s) / 2 : SIZE.tag.y;
    if (this.slip) {
      const h = (this.slip.mesh.geometry as PlaneGeometry).parameters.height;
      this.slip.mesh.position.y = this.tag.mesh.position.y - (SIZE.tag.h * s) / 2 - 0.012 - h / 2;
    }
  }
  look(v: ActorView, clock: Clock): void {
    this.card.look(0, v.sample.fade, v.mark, v.sample.glow);
    // It ignites the first frame it is drawn (h.js `buildStack`: a burst as it is cast).
    if (this.born === null) {
      this.born = clock.t;
      if (this.burst) {
        this.group.remove(this.burst.object);
        this.burst.dispose();
      }
      this.burst = burstFx(this.env.fx, (v.draw as Extract<Draw, { t: "stack" }>).colours, 11, clock.t);
      this.group.add(this.burst.object);
      if (this.up) this.raise(true);
    }
    // The printed card comes up over the painted face as it rises, and goes as it is set aside (no motion of its own).
    const want = this.up ? 1 : 0;
    if (this.turned === null || want !== this.wanted) {
      this.turned = clock.t;
      this.fadeFrom = this.fade;
      this.wanted = want;
    }
    const k = clock.still ? 1 : Math.min(1, Math.max(0, (clock.t - this.turned) / PRINT_FADE_S));
    this.fade = this.fadeFrom + (want - this.fadeFrom) * k;
    const shown = this.printLease ? this.fade : 0;
    this.print.material.opacity = shown;
    this.print.visible = shown > 0.001;
    this.tag.mesh.visible = this.up;
    this.edge.visible = !this.up;
    if (this.slip) {
      (this.slip.mesh.material as MeshBasicMaterial).opacity = this.fade;
      this.slip.mesh.visible = this.fade > 0.001;
    }
    const level = fxLevel(v.sample.fade);
    this.crackle.tick(clock.t, level, clock.still);
    this.burst?.tick(clock.t, level, clock.still);
  }
  dispose(): void {
    this.card.dispose();
    this.tag.dispose();
    this.drop.dispose();
    this.crackle.dispose();
    this.burst?.dispose();
    this.printLease?.release();
    this.print.geometry.dispose();
    this.print.material.dispose();
    this.edge.geometry.dispose();
    this.edge.material.dispose();
    this.slip?.dispose();
  }
}

// ---- a page ---------------------------------------------------------------------------------------------------------

export interface PageParts {
  readonly group: Group;
  tone(k: number): void;
  /** The turn's edge, 0 (none) .. 1 (inked in). */
  glow(k: number): void;
  dispose(): void;
}

/** A seat's page: vellum laid in world units under a ragged mask, its ink (rules, mounts) on top, the turn's edge. */
export function buildPage(host: Host, w: number, d: number, place: SeatPlace, mine: boolean, seed: number): PageParts {
  const painter = host.painter;
  const leases: Lease[] = [];
  const own: { dispose(): void }[] = [];
  const lease = (l: Lease) => (leases.push(l), l);
  const spec = { w, d, ink: seatInk[place], seed };
  const tile = lease(painter.vellumTile(mine, colour.page.base)).texture;
  tile.wrapS = tile.wrapT = RepeatWrapping;
  const vel: Texture = tile.clone();
  own.push(vel);
  vel.needsUpdate = true;
  vel.repeat.set(w / VELLUM_TILE, d / VELLUM_TILE);
  const geo = new PlaneGeometry(w, d);
  own.push(geo);
  const baseMat = new MeshStandardMaterial({
    map: vel,
    alphaMap: lease(painter.page({ ...spec, layer: "mask" })).texture,
    transparent: true,
    roughness: 0.95,
    depthWrite: false,
  });
  const inkMat = new MeshBasicMaterial({ map: lease(painter.page({ ...spec, layer: "ink" })).texture, transparent: true, depthWrite: false });
  const glowMat = new MeshBasicMaterial({ map: lease(painter.page({ ...spec, layer: "glow" })).texture, transparent: true, depthWrite: false, opacity: 0 });
  own.push(baseMat, inkMat, glowMat);
  const layer = (m: Material, y: number, order: number) => {
    const mesh = new Mesh(geo, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.renderOrder = order;
    return mesh;
  };
  const group = new Group();
  group.add(layer(baseMat, 0, -3), layer(inkMat, 0.002, -2), layer(glowMat, 0.0025, -2));
  return {
    group,
    tone: (k) => {
      baseMat.color.setScalar(k);
      inkMat.color.setScalar(k);
    },
    glow: (k) => {
      glowMat.opacity = Math.max(0, Math.min(1, k));
    },
    dispose: () => {
      for (const l of leases) l.release();
      for (const o of own) o.dispose();
    },
  };
}

/** The turn's edge handed from page to page (h.js `floorGlowTex`, LOOK.md): out in the first half, in in the second. */
const HANDOFF_S = motion.turnHandoff / 1000;

class PageView implements PieceView {
  readonly group = new Group();
  private parts: PageParts | null = null;
  private w = 0;
  private d = 0;
  private turn: boolean;
  /** When the turn last changed on this page (s), or null for never (it shows as it is). */
  private turnAt: number | null = null;
  private changed = false;
  constructor(
    private readonly host: Host,
    v: ActorView,
  ) {
    this.turn = (v.draw as Extract<Draw, { t: "page" }>).turn;
    this.build(v);
  }
  private build(v: ActorView): void {
    const d = v.draw as Extract<Draw, { t: "page" }>;
    if (this.parts) {
      this.group.remove(this.parts.group);
      this.parts.dispose();
    }
    this.w = Math.max(0.5, v.sample.w);
    this.d = Math.max(0.5, v.sample.d);
    this.parts = buildPage(this.host, this.w, this.d, d.place, d.mine, d.seed);
    this.parts.glow(d.turn ? 1 : 0);
    this.group.add(this.parts.group);
  }
  patch(v: ActorView): void {
    const turn = (v.draw as Extract<Draw, { t: "page" }>).turn;
    if (turn !== this.turn) {
      this.turn = turn;
      this.changed = true;
    }
  }
  look(v: ActorView, clock: Clock): void {
    // A page grows or shrinks with its rows: stretched while it moves, painted again at its new size once it rests.
    const sx = v.sample.w / this.w,
      sz = v.sample.d / this.d;
    const off = Math.abs(sx - 1) > 0.01 || Math.abs(sz - 1) > 0.01;
    if (off && this.settled(v)) this.build(v);
    else this.parts?.group.scale.set(sx, 1, sz);
    this.parts?.tone((1 - v.sample.fade) * 1.1);
    if (this.changed) {
      this.changed = false;
      this.turnAt = clock.t;
    }
    // The old page's edge clears in the first half of the handover, the new one's inks in over the second.
    const k = this.turnAt === null || clock.still ? 1 : Math.max(0, Math.min(1, (clock.t - this.turnAt) / HANDOFF_S));
    const half = Math.max(0, Math.min(1, this.turn ? k * 2 - 1 : 1 - k * 2));
    this.parts?.glow(this.turnAt === null || clock.still ? (this.turn ? 1 : 0) : half);
  }
  private last: { w: number; d: number } | null = null;
  private settled(v: ActorView): boolean {
    const same = !!this.last && Math.abs(this.last.w - v.sample.w) < 1e-4 && Math.abs(this.last.d - v.sample.d) < 1e-4;
    this.last = { w: v.sample.w, d: v.sample.d };
    return same;
  }
  dispose(): void {
    this.parts?.dispose();
  }
}

// ---- a sift ---------------------------------------------------------------------------------------------------------

/** A pile's card fanned out in front of the camera: a tapped one turned 15° and shaded, as it lies on the table. */
class SiftView implements PieceView {
  readonly group = new Group();
  private readonly card: CardPart;
  constructor(host: Host, v: ActorView) {
    // Sift cards share the transparent pass with the vellum so render order puts them above it.
    this.card = new CardPart(host, v.face, { transparent: true });
    this.group.add(this.card.obj.group);
    this.card.obj.group.traverse((o) => (o.renderOrder = 16));
  }
  front(): Mesh | null {
    return this.card.obj.front;
  }
  patch(v: ActorView): void {
    this.card.face(v.face);
  }
  look(v: ActorView): void {
    const d = v.draw as Extract<Draw, { t: "sift" }>;
    this.card.look(0, 0, null, 0, d.tapped);
    // (Turned as it lies, as far as it has risen.)
    this.card.obj.body.rotation.z = siftRoll(d.tapped, v.sample.alpha);
  }
  dispose(): void {
    this.card.dispose();
  }
}

/**
 * The shade a sift lays over the table, square to the camera (its pose spans the screen's height: one unit here is the
 * screen's height), and the sheet of vellum its cards lie on.
 */
class ScrimView implements PieceView {
  readonly group = new Group();
  private readonly shade: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly back: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly lease: Lease;
  constructor(host: Host, v: ActorView) {
    this.shade = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial({ color: colour.siftShade, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.shade.renderOrder = 15;
    this.lease = host.painter.vellumTile(true, colour.page.base);
    this.back = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.lease.texture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.back.renderOrder = 15;
    this.group.add(this.shade, this.back);
    this.patch(v);
  }
  patch(v: ActorView): void {
    const d = v.draw as Extract<Draw, { t: "scrim" }>;
    const r = d.back,
      u = 1 / d.screen.h;
    this.back.scale.set((r.right - r.left) * u, (r.bottom - r.top) * u, 1);
    this.back.position.set(((r.left + r.right) / 2 - d.screen.w / 2) * u, (d.screen.h / 2 - (r.top + r.bottom) / 2) * u, 0.01);
  }
  look(v: ActorView): void {
    const k = Math.max(0, Math.min(1, v.sample.alpha));
    this.shade.material.opacity = k;
    this.back.material.opacity = Math.min(1, (k / SIFT_SHADE) * 1.25);
  }
  dispose(): void {
    this.shade.geometry.dispose();
    this.shade.material.dispose();
    this.back.geometry.dispose();
    this.back.material.dispose();
    this.lease.release();
  }
}

/** A piece view for an actor's form. */
export function createPiece(env: PieceEnv, v: ActorView): PieceView | null {
  switch (v.draw.t) {
    case "unit":
      return new UnitView(env, v);
    case "zone":
      return new ZoneView(env.host, v);
    case "plate":
      return new PlateView(env.host, v, env.pitch);
    case "stack":
      return new StackView(env, v);
    case "page":
      return new PageView(env.host, v);
    case "sift":
      return new SiftView(env.host, v);
    case "scrim":
      return new ScrimView(env.host, v);
    case "hidden":
      return null;
  }
}

// ---- a flying card and its flare ----------------------------------------------------------------------------------

export class GhostPiece {
  readonly group = new Group();
  private readonly card: CardPart;
  private flare: { mesh: Mesh; mat: MeshBasicMaterial; geo: PlaneGeometry; lease: Lease } | null = null;
  constructor(
    private readonly host: Host,
    v: GhostView,
  ) {
    this.card = new CardPart(host, v.face, { token: v.token });
    this.group.add(this.card.obj.group);
  }
  front(): Mesh {
    return this.card.obj.front;
  }
  update(v: GhostView): void {
    placeGroup(this.group, v.sample);
    this.card.face(v.face);
    this.card.look(0, v.sample.fade, null, 0);
    if (v.flare === null) return;
    if (!this.flare) {
      // A soft disc of the card's mana light, brighter than white so the bloom takes it (fx.js `burst`, much simplified).
      const lease = this.host.painter.halo("option");
      const geo = new PlaneGeometry(CW * SIZE.flare, CH * SIZE.flare);
      const mat = new MeshBasicMaterial({ map: lease.texture, transparent: true, depthWrite: false, blending: AdditiveBlending });
      mat.toneMapped = false;
      mat.color = new Color(v.colours[0] ?? "#ffd9a0").multiplyScalar(2.6);
      const mesh = new Mesh(geo, mat);
      mesh.renderOrder = 8;
      this.group.add(mesh);
      this.flare = { mesh, mat, geo, lease };
    }
    const k = v.flare;
    // Up fast, out slow: the flare peaks a fifth of the way in and is gone at the end.
    const level = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
    this.flare.mat.opacity = Math.max(0, level);
    this.flare.mesh.scale.setScalar(1 + k * 0.8);
  }
  dispose(): void {
    this.card.dispose();
    if (this.flare) {
      this.flare.lease.release();
      this.flare.geo.dispose();
      this.flare.mat.dispose();
    }
  }
}
